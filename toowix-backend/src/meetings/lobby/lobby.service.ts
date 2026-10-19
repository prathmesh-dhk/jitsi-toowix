import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Meeting } from '../../models/Meeting';
import { User } from '../../models/User';
import { Company } from '../../models/Company';
import { generateJitsiToken } from '../../auth/jitsi-token.service';
import { jitsiConfig } from '../../config/jitsi';
import { notifyUser } from '../../notifications/notification.service';
import { mayManageResource } from '../../middleware/ownership';
import { SimpleCache } from '../../lib/simpleCache';
import { buildMeetingPath } from '../../lib/meetingPath';
import { publishLobbyEvent, publishLobbyQueue, publishLobbyStatus, issueLobbyStreamTicket } from './lobby.realtime';

// All business rules for the waiting room / lobby / direct-admission flow live here as plain
// functions -- no `req`/`res` anywhere in this file. lobby.controller.ts parses HTTP in, calls
// one of these, and sends the result back out; lobby.realtime.ts owns the SSE pub/sub plumbing
// these call into to notify connected subscribers.

export interface IServiceResult<T = any> {
  body: T;
  httpStatus: number;
}

// ---- Eligibility rules (who may see / who may join a meeting) ----

export function mayAttend(meeting: any, user: any, company: any): boolean {
  if (meeting.cancelledAt || (meeting.companyId && (!company || company.status !== 'ACTIVE'))) return false;
  const creatorId = typeof meeting.createdBy === 'object' && meeting.createdBy !== null
    ? (meeting.createdBy._id || meeting.createdBy.id)
    : meeting.createdBy;
  if (user && String(creatorId) === String(user._id)) return true;
  if (meeting.type === 'Private') return !!user && (meeting.invitees || []).includes(user.email.toLowerCase());
  if (meeting.type === 'Internal') {
    return !!user?.companyId && String(user.companyId) === String(meeting.companyId);
  }
  return !!user || company?.meetingPolicy?.allowGuestAccess !== false;
}

// Joining a Private meeting is gated by its password plus the host admitting the person from the
// waiting room -- not by workspace membership or the invitee list (mayAttend, which still governs
// who is shown the password in listings).
export function mayJoin(meeting: any, user: any, company: any): boolean {
  if (meeting.type === 'Private') {
    return !meeting.cancelledAt && !(meeting.companyId && (!company || company.status !== 'ACTIVE'));
  }
  return mayAttend(meeting, user, company);
}

/**
 * Host-only lobby/meeting-control actions (admit, deny, announce, end-for-everyone, list
 * pending) must only be callable by the meeting's creator or a company admin of the same
 * tenant -- the routes themselves use `optionalAccount` (guests need the sibling `knock`/
 * `status` routes unauthenticated), so each function re-derives and checks identity here.
 */
async function isHostUser(firebaseUid: string | undefined, meeting: any): Promise<boolean> {
  if (!firebaseUid) return false;
  const user = await User.findOne({ firebaseUid });
  if (!user) return false;
  return mayManageResource(user, meeting);
}

function generateCredentials(room: string, identity: { email: string; id: string; name: string }, moderator: boolean, companyId?: string | null) {
  const participantEntryId = crypto.randomBytes(12).toString('hex');
  const attendanceToken = jwt.sign(
    { room, participantEntryId, identity, moderator, purpose: 'attendance' },
    jitsiConfig.appSecret,
    { algorithm: 'HS256', audience: 'toowix-attendance', issuer: 'toowix-backend', expiresIn: '12h' }
  );
  const jitsiToken = generateJitsiToken({
    user: identity,
    room,
    requireLobby: false,
    companyId: companyId || null,
    features: { moderator, recording: moderator, screenShare: true },
  });
  return { attendanceToken, jitsiToken, participantEntryId };
}

export type IMeetingEndReason = 'LINK_EXPIRED' | 'HOST_ENDED' | 'DURATION_LIMIT';

// Shared by getLiveStatus and admitToRoom -- both need "why did this ended meeting end" and must
// agree on the answer. meeting.endReason exists for any document written after this field was
// added; a document from before that (endedAt set, endReason missing) is inferred from timing
// instead of guessed outright: this backend only ever sets endedAt at or after a meeting's own
// scheduled end (the auto-expiry path) or on an explicit host click (which could happen at any
// time, including before the scheduled end) -- so "ended at/after its own scheduled end" is read
// as the scheduled window having run out, and anything else as a genuine host decision. This is
// the best backward-compatible guess available without a data migration; it cannot be exact for
// every historical row, but it is never wrong in the common case either path produces.
function inferEndReason(meeting: any): IMeetingEndReason {
  return meeting.endReason
    ?? (meeting.scheduledAt && meeting.durationMinutes
      && meeting.endedAt.getTime() >= new Date(meeting.scheduledAt).getTime() + meeting.durationMinutes * 60000
      ? 'LINK_EXPIRED'
      : 'HOST_ENDED');
}

// Maps roomSlug -> why it ended, not just whether it did -- so every participant polling
// live-status (not just whichever client's own timer happened to notice first) can be routed to
// the correct outcome page. Was a plain Set<string> before this distinction existed.
const endedMeetingSlugs = new Map<string, IMeetingEndReason>();

// Pilot cache (see src/lib/simpleCache.ts): GET live-status is polled every 10s by every
// participant in a room for the whole call. Keyed by roomSlug so all of a room's participants
// polling within the same 5s window share one real DB read instead of one each. Invalidated at
// every write site that already touches endedMeetingSlugs above (same reasoning -- this cache
// additionally covers hostJoined/cancelledAt, which that Set does not), plus cancelMeetingHandler
// in meetings.ts.
const liveStatusCache = new SimpleCache<{ cancelled: boolean; ended: boolean; hostJoined: boolean; live: boolean; reason: IMeetingEndReason | null }>(5000);
const liveStatusCacheEnabled = () => process.env.CACHE_LIVE_STATUS !== 'false';

/**
 * Call at every write site that changes a meeting's endedAt/cancelledAt/hostJoined, so a cached
 * live-status answer is never served stale past that write.
 */
export function invalidateLiveStatusCache(roomSlug: string): void {
  liveStatusCache.delete(roomSlug.toLowerCase());
}

/**
 * Clears the "ended" state (both the in-memory flag the live-status poll checks, and the
 * persisted endedAt on the Meeting document) for a meeting that has a saved conversation and is
 * being rejoined from Conversations. Without this, joining is allowed (admitToRoom's own expiry
 * bypass), but the still-live-status poll (every 3s, see MeetingRoomPage.tsx) sees the leftover
 * "ended" state from the meeting's original end and immediately kicks the rejoining participant
 * back out -- the meeting must behave like a fresh instant meeting once reopened.
 */
export async function reactivateMeetingForConversation(roomSlug: string): Promise<void> {
  endedMeetingSlugs.delete(roomSlug);
  invalidateLiveStatusCache(roomSlug);
  await Meeting.updateOne({ roomSlug }, { $set: { endedAt: null, endReason: null } });
}

// ---- Knock / waiting-room entry request ----

interface IRequestEntryParams {
  email?: string;
  firebaseUid?: string;
  fromConversation: boolean;
  name?: string;
  passcode?: string;
  requestId?: string;
}

/**
 * Participant / guest requests entry to the meeting (POST .../lobby/knock).
 * If the caller is host/moderator or quick-access is active, admits immediately.
 * Otherwise, enqueues in waitingQueue.
 */
export async function requestEntry(room: string, params: IRequestEntryParams): Promise<IServiceResult> {
  const meeting = await Meeting.findOne({ roomSlug: room });
  // Ad-hoc rooms (instant-*/twx-*) are allowed to have no Meeting document -- anything else
  // with no document is a nonexistent/mistyped/deleted room, not a valid room to auto-admit
  // or queue into. Same distinction admitToRoom makes for the direct-join path.
  if (!meeting && !room.startsWith('instant-') && !room.startsWith('twx-')) {
    return { body: { error: 'Meeting not found. Create a public instant room from the homepage.' }, httpStatus: 404 };
  }
  if (meeting?.cancelledAt) {
    return { body: { error: 'Meeting has been cancelled' }, httpStatus: 403 };
  }
  if (meeting?.endedAt) {
    return { body: { error: 'Meeting has already ended' }, httpStatus: 403 };
  }
  // Same expiry rule as the direct-admission path: a scheduled meeting's link stops working
  // once start + chosen duration has elapsed (unless accessed from conversation).
  if (!params.fromConversation && meeting?.scheduledAt && meeting?.durationMinutes) {
    const expiresAt = new Date(new Date(meeting.scheduledAt).getTime() + meeting.durationMinutes * 60000);
    if (Date.now() > expiresAt.getTime()) {
      return { body: { error: 'This meeting link has expired.' }, httpStatus: 410 };
    }
  }

  const user = params.firebaseUid ? await User.findOne({ firebaseUid: params.firebaseUid }) : null;
  const company = meeting?.companyId ? await Company.findById(meeting.companyId) : null;
  const isHost = !!meeting && !!user && String(meeting.createdBy) === String(user._id);

  // Password gate -- the host bypasses their own meeting's password. A mid-meeting lock
  // password takes precedence over the original passcode.
  const activePassword = meeting?.lockedPassword || meeting?.passcode || null;
  if (activePassword && !isHost) {
    const submitted = typeof params.passcode === 'string' ? params.passcode.trim() : '';
    if (!submitted || submitted !== activePassword) {
      return { body: { error: 'Incorrect meeting password.', passwordRequired: true }, httpStatus: 401 };
    }
  }

  const displayName = user?.fullName || String(params.name || 'Guest').trim().slice(0, 100);
  const userEmail = user?.email || params.email || '';
  const userId = user ? String(user._id) : crypto.randomUUID();
  const identity = { email: userEmail, id: userId, name: displayName };

  // If caller is host, automatically admit and mark host joined
  if (isHost) {
    if (meeting) {
      meeting.hostJoined = true;
      await meeting.save({ validateBeforeSave: false });
      invalidateLiveStatusCache(room);
    }
    const creds = generateCredentials(room, identity, true, meeting?.companyId ? String(meeting.companyId) : null);
    return {
      body: { status: 'ADMITTED', isHost: true, hostAnnouncement: meeting?.hostAnnouncement || null, ...creds },
      httpStatus: 200,
    };
  }

  // Check if waiting room is bypassed:
  // When company policy doesn't enforce lobby, quick access is enabled, and meeting exists
  const requireLobbyPolicy = company?.meetingPolicy?.requireLobby === true;
  const canAutoAdmit = !requireLobbyPolicy && meeting?.type !== 'Private' && !meeting?.lockedPassword
    && (meeting?.quickAccessEnabled !== false) && (meeting?.hostJoined === true || !meeting);

  if (canAutoAdmit) {
    const creds = generateCredentials(room, identity, false, meeting?.companyId ? String(meeting.companyId) : null);
    return {
      body: { status: 'ADMITTED', isHost: false, hostAnnouncement: meeting?.hostAnnouncement || null, ...creds },
      httpStatus: 200,
    };
  }

  // Otherwise, place participant in the waitingQueue
  const participantId = params.requestId || crypto.randomUUID();
  if (meeting) {
    const existingIdx = (meeting.waitingQueue || []).findIndex(p => p.id === participantId);
    const queueItem = {
      id: participantId,
      name: displayName,
      email: userEmail,
      requestedAt: new Date(),
      status: 'WAITING' as const,
      admittedAt: null,
      deniedAt: null,
      jitsiToken: null,
      attendanceToken: null,
      participantEntryId: null,
    };

    if (existingIdx >= 0) {
      meeting.waitingQueue![existingIdx] = queueItem;
    } else {
      meeting.waitingQueue = meeting.waitingQueue || [];
      meeting.waitingQueue.push(queueItem);
    }
    await meeting.save({ validateBeforeSave: false });
    publishLobbyQueue(room, meeting);

    // Notify host if present -- actionUrl takes the host straight into the meeting (where
    // they're auto-admitted as creator, see the isHost branch above) so clicking the
    // notification actually gets them somewhere to admit/deny, not just a static message.
    if (meeting.createdBy) {
      notifyUser({
        userId: meeting.createdBy as any,
        companyId: meeting.companyId as any,
        category: 'MEETINGS',
        type: 'GUEST_WAITING_IN_LOBBY',
        title: `${displayName} is waiting to join`,
        description: `Waiting for admission to ${meeting.name}`,
        actionLabel: 'Join',
        actionUrl: buildMeetingPath(room),
      });
    }
  }

  return {
    body: { status: 'WAITING', requestId: participantId, name: displayName, hostAnnouncement: meeting?.hostAnnouncement || null },
    httpStatus: 200,
  };
}

// ---- Lobby status / cancel / pending / admit / deny / announce ----

/** Polled by waiting participants (GET .../lobby/status?requestId=...). */
export async function getStatus(room: string, requestId: string): Promise<IServiceResult> {
  const meeting = await Meeting.findOne({ roomSlug: room });

  if (!meeting) {
    // Same ad-hoc-room distinction as requestEntry: instant-*/twx-* rooms legitimately have no
    // Meeting document and should resolve as admitted; anything else means the room doesn't
    // exist, so the client must be told that -- not silently told it was admitted.
    if (room.startsWith('instant-') || room.startsWith('twx-')) {
      return { body: { status: 'ADMITTED', ended: false }, httpStatus: 200 };
    }
    return { body: { status: 'NOT_FOUND', ended: true, error: 'Meeting not found' }, httpStatus: 404 };
  }

  if (meeting.endedAt) {
    return { body: { status: 'ENDED', ended: true, message: 'This meeting was ended by the host' }, httpStatus: 200 };
  }

  const participant = (meeting.waitingQueue || []).find(p => p.id === requestId);
  if (!participant) {
    return { body: { status: 'WAITING', hostAnnouncement: meeting.hostAnnouncement || null, ended: false }, httpStatus: 200 };
  }

  return {
    body: {
      status: participant.status,
      hostAnnouncement: meeting.hostAnnouncement || null,
      ended: false,
      jitsiToken: participant.jitsiToken || null,
      attendanceToken: participant.attendanceToken || null,
      participantEntryId: participant.participantEntryId || null,
    },
    httpStatus: 200,
  };
}

/** Participant cancels their join request (POST .../lobby/cancel). */
export async function cancelRequest(room: string, requestId: string | undefined): Promise<IServiceResult> {
  if (requestId) {
    const meeting = await Meeting.findOne({ roomSlug: room });
    if (meeting) {
      meeting.waitingQueue = (meeting.waitingQueue || []).filter(item => item.id !== requestId);
      await meeting.save({ validateBeforeSave: false });
      publishLobbyQueue(room, meeting);
    }
  }
  return { body: { cancelled: true }, httpStatus: 200 };
}

/** Moderator fetches the list of participants currently waiting (GET .../lobby/pending). */
export async function listPending(room: string, firebaseUid: string | undefined): Promise<IServiceResult> {
  const meeting = await Meeting.findOne({ roomSlug: room });
  if (!meeting) {
    return { body: { waiting: [], count: 0 }, httpStatus: 200 };
  }
  if (!(await isHostUser(firebaseUid, meeting))) {
    return { body: { error: 'Only the meeting host can view the waiting room' }, httpStatus: 403 };
  }
  const waiting = (meeting.waitingQueue || []).filter(p => p.status === 'WAITING');
  return { body: { waiting, count: waiting.length, hostAnnouncement: meeting.hostAnnouncement || null }, httpStatus: 200 };
}

/** Moderator admits one or all waiting participants (POST .../lobby/admit). */
export async function admitParticipants(
    room: string, firebaseUid: string | undefined, opts: { admitAll?: boolean; requestId?: string }
): Promise<IServiceResult> {
  const meeting = await Meeting.findOne({ roomSlug: room });
  if (!meeting) {
    return { body: { error: 'Meeting not found' }, httpStatus: 404 };
  }
  if (!(await isHostUser(firebaseUid, meeting))) {
    return { body: { error: 'Only the meeting host can admit participants' }, httpStatus: 403 };
  }
  if (meeting.cancelledAt || meeting.endedAt) {
    return { body: { error: 'Meeting has ended or been cancelled' }, httpStatus: 403 };
  }
  if (meeting.scheduledAt && meeting.durationMinutes) {
    const expiresAt = new Date(new Date(meeting.scheduledAt).getTime() + meeting.durationMinutes * 60000);
    if (Date.now() > expiresAt.getTime()) {
      return { body: { error: 'This meeting link has expired.' }, httpStatus: 410 };
    }
  }

  let admittedCount = 0;
  const queue = meeting.waitingQueue || [];

  for (const item of queue) {
    if (item.status === 'WAITING' && (opts.admitAll || item.id === opts.requestId)) {
      const identity = { id: crypto.randomUUID(), name: item.name, email: item.email || '' };
      const creds = generateCredentials(room, identity, false, meeting.companyId ? String(meeting.companyId) : null);
      item.status = 'ADMITTED';
      item.admittedAt = new Date();
      item.jitsiToken = creds.jitsiToken;
      item.attendanceToken = creds.attendanceToken;
      item.participantEntryId = creds.participantEntryId;
      admittedCount++;
    }
  }

  await meeting.save({ validateBeforeSave: false });
  for (const item of queue) {
    if (item.status === 'ADMITTED' && (opts.admitAll || item.id === opts.requestId)) {
      publishLobbyStatus(room, item);
    }
  }
  publishLobbyQueue(room, meeting);
  return { body: { success: true, admittedCount }, httpStatus: 200 };
}

/** Moderator denies entry to a waiting participant (POST .../lobby/deny). */
export async function denyParticipant(room: string, firebaseUid: string | undefined, requestId: string | undefined): Promise<IServiceResult> {
  const meeting = await Meeting.findOne({ roomSlug: room });
  if (!meeting) {
    return { body: { error: 'Meeting not found' }, httpStatus: 404 };
  }
  if (!(await isHostUser(firebaseUid, meeting))) {
    return { body: { error: 'Only the meeting host can deny participants' }, httpStatus: 403 };
  }

  const item = (meeting.waitingQueue || []).find(p => p.id === requestId);
  if (item) {
    item.status = 'DENIED';
    item.deniedAt = new Date();
    await meeting.save({ validateBeforeSave: false });
    publishLobbyStatus(room, item);
    publishLobbyQueue(room, meeting);
  }
  return { body: { success: true, message: 'Participant denied entry' }, httpStatus: 200 };
}

/** Moderator broadcasts a one-way announcement to participants in the waiting room. */
export async function broadcastAnnouncement(room: string, firebaseUid: string | undefined, message: string | undefined): Promise<IServiceResult> {
  const meeting = await Meeting.findOne({ roomSlug: room });
  if (!meeting) {
    return { body: { error: 'Meeting not found' }, httpStatus: 404 };
  }
  if (!(await isHostUser(firebaseUid, meeting))) {
    return { body: { error: 'Only the meeting host can broadcast an announcement' }, httpStatus: 403 };
  }

  meeting.hostAnnouncement = String(message || '').slice(0, 300);
  await meeting.save({ validateBeforeSave: false });
  publishLobbyEvent(room, {
    type: 'LOBBY_ANNOUNCEMENT',
    payload: { hostAnnouncement: meeting.hostAnnouncement || null }
  });
  return { body: { success: true, hostAnnouncement: meeting.hostAnnouncement }, httpStatus: 200 };
}

// ---- End meeting / live status ----

/**
 * Moderator ends the meeting for everyone in the call.
 * `reason` defaults to 'HOST_ENDED' (an explicit human decision) for backward compatibility with
 * any existing caller that doesn't pass one -- only the auto-expiry path in MeetingRoomPage.tsx
 * passes 'LINK_EXPIRED' explicitly, since authorization (isHostUser, right below) is identical
 * either way: this parameter only changes which outcome page participants land on, never who is
 * allowed to call this.
 */
export async function endForEveryone(
  room: string, firebaseUid: string | undefined, reason: IMeetingEndReason = 'HOST_ENDED'
): Promise<IServiceResult> {
  const meeting = await Meeting.findOne({ roomSlug: room });
  if (!meeting) {
    // Ad-hoc rooms (instant-*/twx-*, e.g. the homepage's free instant meeting) never get a
    // persisted Meeting document -- see admitToRoom/requestEntry's identical prefix check --
    // so there's nothing here to look up or check ownership against. The "End for everyone"
    // button is only ever shown client-side to Jitsi's own live moderator role for these rooms
    // (admitToRoom's `moderator` flag is always false with no Meeting doc), so just honour the
    // request instead of 404ing on every attempt to end one of these meetings.
    if (!room.startsWith('instant-') && !room.startsWith('twx-')) {
      return { body: { error: 'Meeting not found' }, httpStatus: 404 };
    }
    endedMeetingSlugs.set(room, reason);
    invalidateLiveStatusCache(room);
    publishLobbyEvent(room, {
      type: 'LOBBY_ENDED',
      payload: { message: 'This meeting was ended by the host', reason }
    });
    return { body: { success: true, message: 'Meeting ended for everyone', endedAt: new Date(), reason }, httpStatus: 200 };
  }
  if (!(await isHostUser(firebaseUid, meeting))) {
    return { body: { error: 'Only the meeting host can end the meeting for everyone' }, httpStatus: 403 };
  }
  endedMeetingSlugs.set(room, reason);
  invalidateLiveStatusCache(room);

  meeting.endedAt = new Date();
  meeting.endReason = reason;
  meeting.waitingQueue = [];
  meeting.hostJoined = false;
  publishLobbyEvent(room, {
    type: 'LOBBY_ENDED',
    // reason is a closed, non-sensitive enum (see IMeetingEndReason) -- never anything from the
    // meeting document itself, so this broadcast can't leak participant/meeting details.
    payload: { message: 'This meeting was ended by the host', reason }
  });

  // Per the retention policy, an instant meeting (no scheduledAt, not part of a recurring
  // series -- scheduled/company/recurring meetings have their own time-based expiry handled
  // by the retention sweep in retention.service.ts) is destroyed immediately when the host ends it.
  // getLiveStatus below still reports the correct "ended" status afterwards via the in-memory
  // endedMeetingSlugs set, so deleting the document here doesn't break polling clients that
  // check live-status after this point.
  const isInstantMeeting = !meeting.scheduledAt && !meeting.recurrence;
  // Keep the record while a recording is running or still being processed; the retention sweep
  // removes it afterwards.
  const recordingPending = !!meeting.recordingHoldUntil && new Date(meeting.recordingHoldUntil).getTime() > Date.now();
  // A saved conversation (chatMessages) lives on this same document -- deleting the meeting
  // record would destroy it the instant the host ends the call, which defeats the whole point
  // of the Conversations feature persisting chat for dashboard-created meetings in the first
  // place. Keep the record (same as a pending recording) whenever there's chat to preserve;
  // the retention sweep also skips it going forward (see hasNoChatHistory in retention.service.ts).
  const hasChatHistory = (meeting.chatMessages?.length || 0) > 0;

  if (isInstantMeeting && !recordingPending && !hasChatHistory) {
    await meeting.deleteOne();
  } else {
    await meeting.save({ validateBeforeSave: false });
  }

  return { body: { success: true, message: 'Meeting ended for everyone', endedAt: meeting.endedAt, reason }, httpStatus: 200 };
}

/** Checks whether the meeting has ended or is still live (GET .../live-status). */
export async function getLiveStatus(room: string): Promise<IServiceResult> {
  const cacheOn = liveStatusCacheEnabled();

  if (cacheOn) {
    const cached = liveStatusCache.get(room);
    if (cached) {
      return { body: cached, httpStatus: 200 };
    }
  }

  const cachedReason = endedMeetingSlugs.get(room);

  if (cachedReason) {
    const result = { live: false, ended: true, cancelled: false, hostJoined: false, reason: cachedReason };
    if (cacheOn) liveStatusCache.set(room, result);
    return { body: result, httpStatus: 200 };
  }

  const meeting = await Meeting.findOne({ roomSlug: room });
  let reason: IMeetingEndReason | null = null;

  if (meeting?.endedAt) {
    reason = inferEndReason(meeting);
    endedMeetingSlugs.set(room, reason);
  }
  const result = {
    live: !!meeting && !meeting.endedAt && !meeting.cancelledAt,
    ended: !!meeting?.endedAt,
    cancelled: !!meeting?.cancelledAt,
    hostJoined: !!meeting?.hostJoined,
    reason,
  };

  if (cacheOn) liveStatusCache.set(room, result);
  return { body: result, httpStatus: 200 };
}

// ---- Lock / unlock ----

/**
 * Host-only. While locked, everyone who is not already in the call must enter the password and
 * then be admitted from the waiting room -- the same rules as a Private meeting.
 */
export async function lockMeeting(room: string, firebaseUid: string | undefined, password: string): Promise<IServiceResult> {
  if (!password || password.length > 100) {
    return { body: { error: 'Enter a password to lock the meeting.' }, httpStatus: 400 };
  }
  const meeting = await Meeting.findOne({ roomSlug: room });
  if (!meeting) {
    return { body: { error: 'Locking is available for meetings created from the dashboard.' }, httpStatus: 404 };
  }
  if (!(await isHostUser(firebaseUid, meeting))) {
    return { body: { error: 'Only the meeting host can lock the meeting.' }, httpStatus: 403 };
  }
  await Meeting.updateOne({ _id: meeting._id }, { $set: { lockedPassword: password } });
  return { body: { success: true, locked: true }, httpStatus: 200 };
}

export async function unlockMeeting(room: string, firebaseUid: string | undefined): Promise<IServiceResult> {
  const meeting = await Meeting.findOne({ roomSlug: room });
  if (!meeting) {
    return { body: { error: 'Meeting not found' }, httpStatus: 404 };
  }
  if (!(await isHostUser(firebaseUid, meeting))) {
    return { body: { error: 'Only the meeting host can unlock the meeting.' }, httpStatus: 403 };
  }
  await Meeting.updateOne({ _id: meeting._id }, { $set: { lockedPassword: null } });
  return { body: { success: true, locked: false }, httpStatus: 200 };
}

// ---- Waiting-room SSE stream ticket ----

export async function createStreamTicket(room: string, firebaseUid: string | undefined): Promise<IServiceResult> {
  const meeting = await Meeting.findOne({ roomSlug: room });
  if (!meeting || !(await isHostUser(firebaseUid, meeting))) {
    return { body: { error: 'Only the meeting host can stream the waiting room' }, httpStatus: 403 };
  }
  const { ticket, expiresAt } = issueLobbyStreamTicket(room);
  return { body: { expiresAt, ticket }, httpStatus: 200 };
}

// ---- Direct room admission (GET /room/:roomSlug, POST /room/:roomSlug/admission) ----

interface IAdmitToRoomParams {
  firebaseUid?: string;
  fromConversation: boolean;
  method: string;
  name?: string;
  passcode?: string;
}

export async function admitToRoom(room: string, params: IAdmitToRoomParams): Promise<IServiceResult> {
  try {
    if (!/^[a-z0-9-]{3,100}$/.test(room)) {
      return { body: { error: 'Invalid room code' }, httpStatus: 400 };
    }
    const meeting = await Meeting.findOne({ roomSlug: room });
    const user = params.firebaseUid ? await User.findOne({ firebaseUid: params.firebaseUid }) : null;
    const company = meeting?.companyId ? await Company.findById(meeting.companyId) : null;
    // Allow instant-* and twx-* room slugs for ad-hoc and shared links even if not pre-persisted
    if (!meeting && !room.startsWith('instant-') && !room.startsWith('twx-')) {
      return { body: { error: 'Meeting not found. Create a public instant room from the homepage.' }, httpStatus: 404 };
    }
    // Check attendance eligibility
    if (meeting && !mayJoin(meeting, user, company)) {
      return {
        body: { error: meeting.cancelledAt ? 'Meeting cancelled' : 'Sign in with an invited or workspace account to join.' },
        httpStatus: 403,
      };
    }
    // A scheduled meeting's link expires once its scheduled window (start + chosen duration)
    // has elapsed -- an instant meeting (no scheduledAt) or a scheduled one with no duration
    // set never expires this way. Meetings accessed via conversation section never expire.
    const expiresAt = meeting?.scheduledAt && meeting?.durationMinutes
      ? new Date(new Date(meeting.scheduledAt).getTime() + meeting.durationMinutes * 60000)
      : null;
    const expired = !params.fromConversation && !!expiresAt && Date.now() > expiresAt.getTime();
    // Real reported bug: a meeting the host ended for everyone could still be rejoined -- the
    // browser would get a fresh Jitsi token and actually join the call, only to be ejected a few
    // seconds later once the client's own live-status poll (or a lobby/signal fallback) noticed
    // endedAt was set. Root cause: this direct-admission path (unlike requestEntry, the waiting-
    // room path, and admitParticipants -- see their own `meeting.endedAt` checks) never checked
    // endedAt at all before minting a token. fromConversation is the one explicit, already-
    // trusted exception (reactivateMeetingForConversation clears endedAt for that flow, further
    // down in this same function) -- every other caller must be rejected authoritatively, before
    // a token is ever issued, not discovered after the fact by polling.
    const ended = !params.fromConversation && !!meeting?.endedAt;
    const endReason = ended ? inferEndReason(meeting) : null;
    const creatorId = meeting ? String(meeting.createdBy) : '';
    const isCreator = !!user && creatorId === String(user._id);
    const activePassword = meeting?.lockedPassword || meeting?.passcode || null;
    const isLocked = !!meeting?.lockedPassword;
    const passwordRequired = !!activePassword && !isCreator;
    const policy = company?.meetingPolicy;
    const moderator = !!meeting && !!user && String(meeting.createdBy) === String(user._id)
      && (user.role === 'SUPER_ADMIN' || !policy?.whoCanHost || policy.whoCanHost.includes(user.role));
    const requireLobbyPolicy = !!policy?.requireLobby;
    // requireLobbyPolicy only becomes real protection if Prosody/JVB actually enforces the
    // `context.room.lobby` claim below -- otherwise a company that turned "Require lobby" on
    // gets a JWT that *claims* lobby enforcement while the server silently ignores it, which is
    // worse than not offering the setting at all. JITSI_SERVER_POLICY_VERIFIED is set by
    // deployment/ops only once the Prosody lobby module has been confirmed active on this
    // server; until then, fail closed (503) rather than mint a falsely-reassuring token.
    if (requireLobbyPolicy && process.env.JITSI_SERVER_POLICY_VERIFIED !== 'true') {
      throw new Error('Lobby enforcement is required by company policy but this deployment has not attested that the server enforces it');
    }
    const recordingEnabled = !!meeting && moderator && policy?.recordingEnabled !== false && company?.limits?.featureFlags?.recordingEnabled !== false;
    const info = {
      type: meeting?.type || 'Guest', organizerId: meeting ? String(meeting.createdBy) : '',
      organizerName: '', description: meeting?.description || null,
      accessAllowed: true, cancelled: false, expired, expiresAt: expiresAt ? expiresAt.toISOString() : null,
      // Metadata-level visibility (GET, before a Join click) for the same reason `expired`/
      // `cancelled` are already exposed here -- lets the prejoin screen route to the correct
      // outcome page immediately, the same way it already does for an expired scheduled link,
      // instead of only discovering it after a POST admission attempt.
      ended, endReason,
      passwordRequired, inviteRestricted: meeting?.type === 'Private', locked: isLocked,
      recordingEnabled, autoRecording: recordingEnabled && !!policy?.autoRecording,
      requireLobbyPolicy, allowScreenShare: policy?.allowScreenShare !== false,
      micLockEnabled: !!policy?.micLockEnabled,
      // True only for a meeting created from the dashboard (instant or scheduled) -- has a real
      // Meeting document to persist a saved conversation against. False for an ad-hoc room (the
      // public homepage's free instant meeting, or any bare room code), whose chat stays
      // ephemeral and is never written to the database.
      persisted: !!meeting,
    };
    if (params.method === 'GET') {
      return { body: { meeting: info }, httpStatus: 200 };
    }
    // Authoritative rejection -- checked BEFORE a token is ever minted, not discovered afterward
    // by the client's own live-status poll. endedAt takes priority over the clock-based `expired`
    // check below: a meeting that was explicitly ended (for whatever persisted reason) stays
    // ended even if its scheduled window also happens to have elapsed, and reports the REAL
    // reason rather than guessing LINK_EXPIRED just because the clock also agrees.
    if (ended) {
      return { body: { error: 'Meeting has already ended', reason: endReason }, httpStatus: 403 };
    }
    if (expired) {
      return { body: { error: 'This meeting link has expired.' }, httpStatus: 410 };
    }
    // Private meetings always go through the host-controlled waiting room; only the host may enter directly.
    if ((meeting?.type === 'Private' || isLocked) && !isCreator) {
      return { body: { error: 'Ask to join from the waiting room.', useLobby: true }, httpStatus: 403 };
    }
    if (passwordRequired) {
      const submitted = typeof params.passcode === 'string' ? params.passcode.trim() : '';
      if (!submitted || submitted !== activePassword) {
        return { body: { error: 'Incorrect meeting password.', passwordRequired: true }, httpStatus: 401 };
      }
    }
    // Rejoining a previously-ended meeting from Conversations must behave like a fresh instant
    // meeting, not immediately get kicked back out by the "was this meeting ended?" poll every
    // client runs every 3s -- see reactivateMeetingForConversation's own comment.
    if (params.fromConversation && meeting) {
      await reactivateMeetingForConversation(room);
    } else {
      // Real reported bug: rejoining an ad-hoc room (instant-*/twx-*, no persisted Meeting
      // document) after a previous "end for everyone" let the join through here -- `ended`
      // above is only ever computed from a Meeting document's endedAt, and there is none for
      // these rooms -- but left the in-memory endedMeetingSlugs entry from that earlier end in
      // place. The rejoining client's own live-status poll then read it a few seconds later and
      // kicked the participant right back out. We're about to actually admit this join, so any
      // stale "ended" opinion recorded for this room no longer applies.
      endedMeetingSlugs.delete(room);
      invalidateLiveStatusCache(room);
    }
    const identity = {
      id: user ? String(user._id) : crypto.randomUUID(),
      name: user?.fullName || String(params.name || 'Guest').slice(0, 100),
      email: user?.email || '',
      avatar: user?.avatarUrl || undefined,
    };
    const participantEntryId = crypto.randomBytes(12).toString('hex');
    const attendanceToken = jwt.sign({ room, participantEntryId, identity, moderator, purpose: 'attendance' }, jitsiConfig.appSecret,
      { algorithm: 'HS256', audience: 'toowix-attendance', issuer: 'toowix-backend', expiresIn: '12h' });
    return {
      body: {
        meeting: info, moderator, userId: user ? String(user._id) : null,
        participation: user ? 'account' : 'guest', attendanceToken, participantEntryId,
        jitsiToken: generateJitsiToken({
          user: identity, room, requireLobby: requireLobbyPolicy, companyId: meeting?.companyId ? String(meeting.companyId) : null,
          features: { moderator, recording: recordingEnabled, screenShare: info.allowScreenShare },
        }),
      },
      httpStatus: 200,
    };
  } catch {
    return { body: { error: 'Meeting admission unavailable' }, httpStatus: 503 };
  }
}

// ---- Attendance join/leave ----

export async function recordAttendance(room: string, attendanceToken: string, leaving: boolean): Promise<IServiceResult<undefined | { error: string }>> {
  try {
    const claim = jwt.verify(attendanceToken, jitsiConfig.appSecret,
      { algorithms: ['HS256'], audience: 'toowix-attendance', issuer: 'toowix-backend' }) as jwt.JwtPayload;
    if (claim.purpose !== 'attendance' || claim.room !== room) {
      return { body: undefined, httpStatus: 403 };
    }
    if (leaving) {
      await Meeting.updateOne({ roomSlug: room, participants: { $elemMatch: { _id: claim.participantEntryId, leftAt: null } } },
        { $set: { 'participants.$.leftAt': new Date() } });
    } else {
      const meeting = await Meeting.findOne({ roomSlug: room });
      if (meeting?.cancelledAt) {
        return { body: { error: 'Meeting cancelled' }, httpStatus: 403 };
      }
      await Meeting.updateOne({ roomSlug: room, 'participants._id': { $ne: claim.participantEntryId } },
        { $push: { participants: { _id: claim.participantEntryId, name: claim.identity.name, email: claim.identity.email, avatarUrl: claim.identity.avatar || null, role: claim.moderator ? 'Organizer' : 'Participant', joinedAt: new Date() } } });
    }
    return { body: undefined, httpStatus: 200 };
  } catch {
    return { body: undefined, httpStatus: 403 };
  }
}

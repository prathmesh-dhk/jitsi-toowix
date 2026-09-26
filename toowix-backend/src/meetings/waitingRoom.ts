import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { Meeting } from '../models/Meeting';
import { User } from '../models/User';
import { Company } from '../models/Company';
import { generateJitsiToken } from '../auth/jitsi-token';
import { jitsiConfig } from '../config/jitsi';
import { notifyUser } from '../notifications/createNotification';
import { mayManageResource } from '../middleware/ownership';

/**
 * Host-only lobby/meeting-control actions (admit, deny, announce, end-for-everyone, list
 * pending) must only be callable by the meeting's creator or a company admin of the same
 * tenant -- the routes themselves use `optionalAccount` (guests need the sibling `knock`/
 * `status` routes unauthenticated), so each handler re-derives and checks identity here.
 */
async function requireHost(req: AuthenticatedRequest, meeting: any): Promise<boolean> {
  if (!req.firebaseUid) return false;
  const user = await User.findOne({ firebaseUid: req.firebaseUid });
  if (!user) return false;
  return mayManageResource(user, meeting);
}

function generateCredentials(room: string, identity: { id: string; name: string; email: string }, moderator: boolean, companyId?: string | null) {
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
  return { participantEntryId, attendanceToken, jitsiToken };
}

/**
 * POST /api/meetings/room/:roomSlug/lobby/knock
 * Participant / guest requests entry to the meeting.
 * If user is host/moderator or quick-access is active, admits immediately.
 * Otherwise, enqueues in waitingQueue.
 */
export async function knockLobbyHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const room = String(req.params.roomSlug).toLowerCase();
    const { name, email, requestId, passcode } = req.body;
    const meeting = await Meeting.findOne({ roomSlug: room });
    if (meeting?.cancelledAt) {
      res.status(403).json({ error: 'Meeting has been cancelled' });
      return;
    }
    if (meeting?.endedAt) {
      res.status(403).json({ error: 'Meeting has already ended' });
      return;
    }
    // Same expiry rule as the direct-admission path: a scheduled meeting's link stops working
    // once start + chosen duration has elapsed (unless accessed from conversation).
    const isFromConversation = req.query.fromConversation === '1' || req.body?.fromConversation === true;
    if (!isFromConversation && meeting?.scheduledAt && meeting?.durationMinutes) {
      const expiresAt = new Date(new Date(meeting.scheduledAt).getTime() + meeting.durationMinutes * 60000);
      if (Date.now() > expiresAt.getTime()) {
        res.status(410).json({ error: 'This meeting link has expired.' });
        return;
      }
    }

    const user = req.firebaseUid ? await User.findOne({ firebaseUid: req.firebaseUid }) : null;
    const company = meeting?.companyId ? await Company.findById(meeting.companyId) : null;
    const isHost = !!meeting && !!user && String(meeting.createdBy) === String(user._id);

    // Password gate -- the host bypasses their own meeting's password. A mid-meeting lock
    // password takes precedence over the original passcode.
    const activePassword = meeting?.lockedPassword || meeting?.passcode || null;
    if (activePassword && !isHost) {
      const submitted = typeof passcode === 'string' ? passcode.trim() : '';
      if (!submitted || submitted !== activePassword) {
        res.status(401).json({ error: 'Incorrect meeting password.', passwordRequired: true });
        return;
      }
    }

    const displayName = user?.fullName || String(name || 'Guest').trim().slice(0, 100);
    const userEmail = user?.email || email || '';
    const userId = user ? String(user._id) : crypto.randomUUID();
    const identity = { id: userId, name: displayName, email: userEmail };

    // If caller is host, automatically admit and mark host joined
    if (isHost) {
      if (meeting) {
        meeting.hostJoined = true;
        await meeting.save({ validateBeforeSave: false });
      }
      const creds = generateCredentials(room, identity, true, meeting?.companyId ? String(meeting.companyId) : null);
      res.json({
        status: 'ADMITTED',
        isHost: true,
        hostAnnouncement: meeting?.hostAnnouncement || null,
        ...creds,
      });
      return;
    }

    // Check if waiting room is bypassed:
    // When company policy doesn't enforce lobby, quick access is enabled, and meeting exists
    const requireLobbyPolicy = company?.meetingPolicy?.requireLobby === true;
    const canAutoAdmit = !requireLobbyPolicy && meeting?.type !== 'Private' && !meeting?.lockedPassword && (meeting?.quickAccessEnabled !== false) && (meeting?.hostJoined === true || !meeting);

    if (canAutoAdmit) {
      const creds = generateCredentials(room, identity, false, meeting?.companyId ? String(meeting.companyId) : null);
      res.json({
        status: 'ADMITTED',
        isHost: false,
        hostAnnouncement: meeting?.hostAnnouncement || null,
        ...creds,
      });
      return;
    }

    // Otherwise, place participant in the waitingQueue
    const participantId = requestId || crypto.randomUUID();
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
          actionUrl: `/meet/${encodeURIComponent(room)}`,
        });
      }
    }

    res.json({
      status: 'WAITING',
      requestId: participantId,
      name: displayName,
      hostAnnouncement: meeting?.hostAnnouncement || null,
    });
  } catch (err: any) {
    console.error('[WaitingRoom] Knock error:', err.message);
    res.status(500).json({ error: 'Failed to request entry to meeting' });
  }
}

/**
 * GET /api/meetings/room/:roomSlug/lobby/status?requestId=...
 * Polled by waiting participants.
 */
export async function getLobbyStatusHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const room = String(req.params.roomSlug).toLowerCase();
    const requestId = String(req.query.requestId || '');
    const meeting = await Meeting.findOne({ roomSlug: room });

    if (!meeting) {
      res.json({ status: 'ADMITTED', ended: false });
      return;
    }

    if (meeting.endedAt) {
      res.json({ status: 'ENDED', ended: true, message: 'This meeting was ended by the host' });
      return;
    }

    const participant = (meeting.waitingQueue || []).find(p => p.id === requestId);
    if (!participant) {
      res.json({
        status: 'WAITING',
        hostAnnouncement: meeting.hostAnnouncement || null,
        ended: false,
      });
      return;
    }

    res.json({
      status: participant.status,
      hostAnnouncement: meeting.hostAnnouncement || null,
      ended: false,
      jitsiToken: participant.jitsiToken || null,
      attendanceToken: participant.attendanceToken || null,
      participantEntryId: participant.participantEntryId || null,
    });
  } catch (err: any) {
    console.error('[WaitingRoom] Status error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve lobby status' });
  }
}

/**
 * POST /api/meetings/room/:roomSlug/lobby/cancel
 * Participant cancels their join request.
 */
export async function cancelLobbyHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const room = String(req.params.roomSlug).toLowerCase();
    const { requestId } = req.body;
    if (requestId) {
      const meeting = await Meeting.findOne({ roomSlug: room });
      if (meeting) {
        meeting.waitingQueue = (meeting.waitingQueue || []).filter(item => item.id !== requestId);
        await meeting.save({ validateBeforeSave: false });
        publishLobbyQueue(room, meeting);
      }
    }
    res.json({ cancelled: true });
  } catch (err: any) {
    console.error('[WaitingRoom] Cancel error:', err.message);
    res.status(500).json({ error: 'Failed to cancel join request' });
  }
}

/**
 * GET /api/meetings/room/:roomSlug/lobby/pending
 * Moderator fetches list of participants currently waiting in the queue.
 */
export async function listPendingLobbyHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const room = String(req.params.roomSlug).toLowerCase();
    const meeting = await Meeting.findOne({ roomSlug: room });
    if (!meeting) {
      res.json({ waiting: [], count: 0 });
      return;
    }
    if (!(await requireHost(req, meeting))) {
      res.status(403).json({ error: 'Only the meeting host can view the waiting room' });
      return;
    }
    const waiting = (meeting.waitingQueue || []).filter(p => p.status === 'WAITING');
    res.json({ waiting, count: waiting.length, hostAnnouncement: meeting.hostAnnouncement || null });
  } catch (err: any) {
    console.error('[WaitingRoom] List pending error:', err.message);
    res.status(500).json({ error: 'Failed to list waiting participants' });
  }
}

/**
 * POST /api/meetings/room/:roomSlug/lobby/admit
 * Moderator admits one or all waiting participants.
 */
export async function admitLobbyHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const room = String(req.params.roomSlug).toLowerCase();
    const { requestId, admitAll } = req.body;
    const meeting = await Meeting.findOne({ roomSlug: room });
    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found' });
      return;
    }
    if (!(await requireHost(req, meeting))) {
      res.status(403).json({ error: 'Only the meeting host can admit participants' });
      return;
    }
    if (meeting.cancelledAt || meeting.endedAt) {
      res.status(403).json({ error: 'Meeting has ended or been cancelled' });
      return;
    }
    if (meeting.scheduledAt && meeting.durationMinutes) {
      const expiresAt = new Date(new Date(meeting.scheduledAt).getTime() + meeting.durationMinutes * 60000);
      if (Date.now() > expiresAt.getTime()) {
        res.status(410).json({ error: 'This meeting link has expired.' });
        return;
      }
    }

    let admittedCount = 0;
    const queue = meeting.waitingQueue || [];

    for (const item of queue) {
      if (item.status === 'WAITING' && (admitAll || item.id === requestId)) {
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
      if (item.status === 'ADMITTED' && (admitAll || item.id === requestId)) {
        publishLobbyStatus(room, item);
      }
    }
    publishLobbyQueue(room, meeting);
    res.json({ success: true, admittedCount });
  } catch (err: any) {
    console.error('[WaitingRoom] Admit error:', err.message);
    res.status(500).json({ error: 'Failed to admit participant' });
  }
}

/**
 * POST /api/meetings/room/:roomSlug/lobby/deny
 * Moderator denies entry to a waiting participant.
 */
export async function denyLobbyHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const room = String(req.params.roomSlug).toLowerCase();
    const { requestId } = req.body;
    const meeting = await Meeting.findOne({ roomSlug: room });
    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found' });
      return;
    }
    if (!(await requireHost(req, meeting))) {
      res.status(403).json({ error: 'Only the meeting host can deny participants' });
      return;
    }

    const item = (meeting.waitingQueue || []).find(p => p.id === requestId);
    if (item) {
      item.status = 'DENIED';
      item.deniedAt = new Date();
      await meeting.save({ validateBeforeSave: false });
      publishLobbyStatus(room, item);
      publishLobbyQueue(room, meeting);
    }
    res.json({ success: true, message: 'Participant denied entry' });
  } catch (err: any) {
    console.error('[WaitingRoom] Deny error:', err.message);
    res.status(500).json({ error: 'Failed to deny participant' });
  }
}

/**
 * POST /api/meetings/room/:roomSlug/lobby/announce
 * Moderator broadcasts a one-way announcement message to participants in the waiting room.
 */
export async function announceLobbyHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const room = String(req.params.roomSlug).toLowerCase();
    const { message } = req.body;
    const meeting = await Meeting.findOne({ roomSlug: room });
    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found' });
      return;
    }
    if (!(await requireHost(req, meeting))) {
      res.status(403).json({ error: 'Only the meeting host can broadcast an announcement' });
      return;
    }

    meeting.hostAnnouncement = String(message || '').slice(0, 300);
    await meeting.save({ validateBeforeSave: false });
    publishLobbyEvent(room, {
      type: 'LOBBY_ANNOUNCEMENT',
      payload: { hostAnnouncement: meeting.hostAnnouncement || null }
    });
    res.json({ success: true, hostAnnouncement: meeting.hostAnnouncement });
  } catch (err: any) {
    console.error('[WaitingRoom] Announce error:', err.message);
    res.status(500).json({ error: 'Failed to broadcast announcement' });
  }
}

const endedMeetingSlugs = new Set<string>();

/**
 * Clears the "ended" state (both the in-memory flag the live-status poll checks, and the
 * persisted endedAt on the Meeting document) for a meeting that has a saved conversation and is
 * being rejoined from Conversations. Without this, joining is allowed (admission.ts's own
 * expiry bypass), but the still-live-status poll (every 3s, see MeetingRoomPage.tsx) sees the
 * leftover "ended" state from the meeting's original end and immediately kicks the rejoining
 * participant back out -- the meeting must behave like a fresh instant meeting once reopened.
 */
export async function reactivateMeetingForConversation(roomSlug: string): Promise<void> {
  endedMeetingSlugs.delete(roomSlug);
  await Meeting.updateOne({ roomSlug }, { $set: { endedAt: null } });
}

/**
 * POST /api/meetings/room/:roomSlug/end-for-everyone
 * Moderator ends the meeting for everyone in the call.
 */
export async function endMeetingForEveryoneHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const room = String(req.params.roomSlug).toLowerCase();

    const meeting = await Meeting.findOne({ roomSlug: room });
    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found' });
      return;
    }
    if (!(await requireHost(req, meeting))) {
      res.status(403).json({ error: 'Only the meeting host can end the meeting for everyone' });
      return;
    }
    endedMeetingSlugs.add(room);

    meeting.endedAt = new Date();
    meeting.waitingQueue = [];
    meeting.hostJoined = false;
    publishLobbyEvent(room, {
      type: 'LOBBY_ENDED',
      payload: { message: 'This meeting was ended by the host' }
    });

    // Per the retention policy, an instant meeting (no scheduledAt, not part of a recurring
    // series -- scheduled/company/recurring meetings have their own time-based expiry handled
    // by the retention sweep in retention.ts) is destroyed immediately when the host ends it.
    // getLiveMeetingStatusHandler below still reports the correct "ended" status afterwards via
    // the in-memory endedMeetingSlugs set, so deleting the document here doesn't break polling
    // clients that check live-status after this point.
    const isInstantMeeting = !meeting.scheduledAt && !meeting.recurrence;
    // Keep the record while a recording is running or still being processed; the retention sweep
    // removes it afterwards.
    const recordingPending = !!meeting.recordingHoldUntil && new Date(meeting.recordingHoldUntil).getTime() > Date.now();
    // A saved conversation (chatMessages) lives on this same document -- deleting the meeting
    // record would destroy it the instant the host ends the call, which defeats the whole point
    // of the Conversations feature persisting chat for dashboard-created meetings in the first
    // place. Keep the record (same as a pending recording) whenever there's chat to preserve;
    // the retention sweep also skips it going forward (see hasNoChatHistory in retention.ts).
    const hasChatHistory = (meeting.chatMessages?.length || 0) > 0;

    if (isInstantMeeting && !recordingPending && !hasChatHistory) {
      await meeting.deleteOne();
    } else {
      await meeting.save({ validateBeforeSave: false });
    }

    res.json({ success: true, message: 'Meeting ended for everyone', endedAt: meeting.endedAt });
  } catch (err: any) {
    console.error('[WaitingRoom] End for everyone error:', err.message);
    res.status(500).json({ error: 'Failed to end meeting' });
  }
}

/**
 * GET /api/meetings/room/:roomSlug/live-status
 * Check if the meeting has ended or is still live.
 */
export async function getLiveMeetingStatusHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const room = String(req.params.roomSlug).toLowerCase();
    if (endedMeetingSlugs.has(room)) {
      res.json({
        live: false,
        ended: true,
        cancelled: false,
        hostJoined: false,
      });
      return;
    }

    const meeting = await Meeting.findOne({ roomSlug: room });
    if (meeting?.endedAt) {
      endedMeetingSlugs.add(room);
    }
    res.json({
      live: !!meeting && !meeting.endedAt && !meeting.cancelledAt,
      ended: !!meeting?.endedAt,
      cancelled: !!meeting?.cancelledAt,
      hostJoined: !!meeting?.hostJoined,
    });
  } catch (err: any) {
    console.error('[WaitingRoom] Live status error:', err.message);
    res.status(500).json({ error: 'Failed to fetch live meeting status' });
  }
}

/**
 * POST /api/meetings/room/:roomSlug/lock  { password }
 * POST /api/meetings/room/:roomSlug/unlock
 * Host-only. While locked, everyone who is not already in the call must enter the password and
 * then be admitted from the waiting room -- the same rules as a Private meeting.
 */
export async function lockMeetingHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const room = String(req.params.roomSlug).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password.trim() : '';
    if (!password || password.length > 100) {
      res.status(400).json({ error: 'Enter a password to lock the meeting.' });
      return;
    }
    const meeting = await Meeting.findOne({ roomSlug: room });
    if (!meeting) {
      res.status(404).json({ error: 'Locking is available for meetings created from the dashboard.' });
      return;
    }
    if (!(await requireHost(req, meeting))) {
      res.status(403).json({ error: 'Only the meeting host can lock the meeting.' });
      return;
    }
    await Meeting.updateOne({ _id: meeting._id }, { $set: { lockedPassword: password } });
    res.json({ success: true, locked: true });
  } catch (err: any) {
    console.error('[WaitingRoom] Lock error:', err.message);
    res.status(500).json({ error: 'Failed to lock the meeting' });
  }
}

export async function unlockMeetingHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const room = String(req.params.roomSlug).toLowerCase();
    const meeting = await Meeting.findOne({ roomSlug: room });
    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found' });
      return;
    }
    if (!(await requireHost(req, meeting))) {
      res.status(403).json({ error: 'Only the meeting host can unlock the meeting.' });
      return;
    }
    await Meeting.updateOne({ _id: meeting._id }, { $set: { lockedPassword: null } });
    res.json({ success: true, locked: false });
  } catch (err: any) {
    console.error('[WaitingRoom] Unlock error:', err.message);
    res.status(500).json({ error: 'Failed to unlock the meeting' });
  }
}

interface ILobbyStreamTicket {
  expiresAt: number;
  room: string;
}

interface ILobbySubscriber {
  moderator: boolean;
  requestId: string | null;
  response: Response;
}

interface ILobbyEvent {
  payload: Record<string, unknown>;
  requestId?: string;
  type: 'LOBBY_ANNOUNCEMENT' | 'LOBBY_ENDED' | 'LOBBY_QUEUE' | 'LOBBY_STATUS';
}

const lobbyStreamTickets = new Map<string, ILobbyStreamTicket>();
const lobbySubscribers = new Map<string, Set<ILobbySubscriber>>();
const LOBBY_STREAM_TICKET_TTL_MS = 8 * 60 * 60 * 1000;

function safeWaitingQueue(meeting: any): Array<Record<string, unknown>> {
  return (meeting?.waitingQueue || [])
    .filter((item: any) => item.status === 'WAITING')
    .map((item: any) => ({
      id: item.id,
      name: item.name,
      email: item.email || '',
      requestedAt: item.requestedAt,
      status: item.status,
    }));
}

function writeLobbyEvent(response: Response, event: ILobbyEvent): void {
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function publishLobbyEvent(room: string, event: ILobbyEvent): void {
  const subscribers = lobbySubscribers.get(room);
  if (!subscribers) return;
  for (const subscriber of subscribers) {
    const allowed = event.type === 'LOBBY_QUEUE'
      ? subscriber.moderator
      : event.type === 'LOBBY_STATUS'
        ? subscriber.requestId === event.requestId
        : true;
    if (!allowed) continue;
    try {
      writeLobbyEvent(subscriber.response, event);
    } catch {
      subscribers.delete(subscriber);
    }
  }
  if (subscribers.size === 0) lobbySubscribers.delete(room);
}

function publishLobbyQueue(room: string, meeting: any): void {
  publishLobbyEvent(room, {
    type: 'LOBBY_QUEUE',
    payload: {
      count: safeWaitingQueue(meeting).length,
      hostAnnouncement: meeting?.hostAnnouncement || null,
      waiting: safeWaitingQueue(meeting),
    }
  });
}

function publishLobbyStatus(room: string, participant: any): void {
  publishLobbyEvent(room, {
    type: 'LOBBY_STATUS',
    requestId: participant.id,
    payload: {
      attendanceToken: participant.attendanceToken || null,
      hostAnnouncement: null,
      jitsiToken: participant.jitsiToken || null,
      participantEntryId: participant.participantEntryId || null,
      status: participant.status,
    }
  });
}

function configureSseResponse(res: Response): void {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write('retry: 5000\n\n');
}

/** Issues an opaque, short-lived ticket because EventSource cannot send Authorization headers. */
export async function createLobbyStreamTicketHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const room = String(req.params.roomSlug).toLowerCase();
    const meeting = await Meeting.findOne({ roomSlug: room });
    if (!meeting || !(await requireHost(req, meeting))) {
      res.status(403).json({ error: 'Only the meeting host can stream the waiting room' });
      return;
    }
    const now = Date.now();
    for (const [ ticket, record ] of lobbyStreamTickets) {
      if (record.expiresAt <= now) lobbyStreamTickets.delete(ticket);
    }
    const ticket = crypto.randomBytes(32).toString('base64url');
    lobbyStreamTickets.set(ticket, { room, expiresAt: now + LOBBY_STREAM_TICKET_TTL_MS });
    res.json({ expiresAt: now + LOBBY_STREAM_TICKET_TTL_MS, ticket });
  } catch (err: any) {
    console.error('[WaitingRoom] Stream ticket error:', err.message);
    res.status(500).json({ error: 'Failed to create waiting-room stream' });
  }
}

/**
 * A waiting guest subscribes using its unguessable lobby request id; a moderator subscribes
 * using the one-time authenticated ticket above. Tokens and the queue are never broadcast to
 * the general room-signal stream.
 */
export async function streamLobbyHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const room = String(req.params.roomSlug).toLowerCase();
    const requestId = typeof req.query.requestId === 'string' ? req.query.requestId.slice(0, 120) : '';
    const ticket = typeof req.query.ticket === 'string' ? req.query.ticket : '';
    const ticketRecord = ticket ? lobbyStreamTickets.get(ticket) : undefined;
    const moderator = Boolean(ticketRecord && ticketRecord.room === room && ticketRecord.expiresAt > Date.now());
    if (!moderator && !requestId) {
      res.status(400).json({ error: 'A lobby request or moderator ticket is required' });
      return;
    }
    if (ticket && !moderator) {
      res.status(401).json({ error: 'Waiting-room stream ticket expired' });
      return;
    }

    const meeting = await Meeting.findOne({ roomSlug: room });
    configureSseResponse(res);
    const subscriber: ILobbySubscriber = { moderator, requestId: moderator ? null : requestId, response: res };
    const subscribers = lobbySubscribers.get(room) || new Set<ILobbySubscriber>();
    subscribers.add(subscriber);
    lobbySubscribers.set(room, subscribers);

    if (moderator) {
      publishLobbyQueue(room, meeting);
    } else if (meeting?.endedAt) {
      writeLobbyEvent(res, { type: 'LOBBY_ENDED', payload: { message: 'This meeting was ended by the host' } });
    } else {
      const participant = (meeting?.waitingQueue || []).find((item: any) => item.id === requestId);
      writeLobbyEvent(res, participant
        ? {
          type: 'LOBBY_STATUS',
          requestId,
          payload: {
            attendanceToken: participant.attendanceToken || null,
            hostAnnouncement: meeting?.hostAnnouncement || null,
            jitsiToken: participant.jitsiToken || null,
            participantEntryId: participant.participantEntryId || null,
            status: participant.status,
          }
        }
        : { type: 'LOBBY_STATUS', requestId, payload: { hostAnnouncement: meeting?.hostAnnouncement || null, status: 'WAITING' } });
    }

    const heartbeat = setInterval(() => {
      try { res.write(': keepalive\n\n'); } catch { /* close handler releases the subscription */ }
    }, 25000);
    req.on('close', () => {
      clearInterval(heartbeat);
      subscribers.delete(subscriber);
      if (subscribers.size === 0) lobbySubscribers.delete(room);
    });
  } catch (err: any) {
    console.error('[WaitingRoom] Stream error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to open waiting-room stream' });
  }
}

interface IRoomSignal {
  id: string;
  msgId?: string;
  senderSessionId?: string;
  targetSessionId?: string | null;
  sender: string;
  type: string;
  payload: any;
  timestamp: number;
}

const roomSignalsMap = new Map<string, IRoomSignal[]>();
// One long-lived SSE response per joined browser. This replaces repeated GET polling while
// preserving the existing HTTP POST and short in-memory replay buffer as reliable fallbacks.
const roomSignalSubscribers = new Map<string, Set<Response>>();

function writeSignalEvent(res: Response, signal: IRoomSignal): void {
  res.write(`data: ${JSON.stringify(signal)}\n\n`);
}

function publishRoomSignal(room: string, signal: IRoomSignal): void {
  const subscribers = roomSignalSubscribers.get(room);
  if (!subscribers) return;
  for (const subscriber of subscribers) {
    try {
      writeSignalEvent(subscriber, signal);
    } catch {
      subscribers.delete(subscriber);
    }
  }
  if (subscribers.size === 0) roomSignalSubscribers.delete(room);
}

/**
 * POST /api/meetings/room/:roomSlug/signal
 * Broadcast a real-time WebRTC signal (offer, answer, candidate, screen-share state).
 */
export async function postSignalHandler(req: any, res: Response): Promise<void> {
  const room = String(req.params.roomSlug).toLowerCase();
  const { sender, type, payload, msgId, senderSessionId, targetSessionId } = req.body;
  if (!roomSignalsMap.has(room)) {
    roomSignalsMap.set(room, []);
  }
  const signals = roomSignalsMap.get(room)!;
  const signal: IRoomSignal = {
    id: crypto.randomUUID(),
    // Kept so receivers can recognise (and ignore) their own broadcast coming back, and so
    // targeted signals still reach only their intended session.
    msgId: typeof msgId === 'string' ? msgId.slice(0, 120) : undefined,
    senderSessionId: typeof senderSessionId === 'string' ? senderSessionId.slice(0, 120) : undefined,
    targetSessionId: typeof targetSessionId === 'string' ? targetSessionId.slice(0, 120) : null,
    sender: String(sender || 'Anonymous'),
    type: String(type || ''),
    payload: payload || null,
    timestamp: Date.now(),
  };
  signals.push(signal);
  // Keep signals within last 2 minutes, max 100 entries
  const cutoff = Date.now() - 120000;
  roomSignalsMap.set(room, signals.filter((s) => s.timestamp > cutoff).slice(-100));
  publishRoomSignal(room, signal);
  res.json({ success: true, signalId: signal.id });
}

/**
 * GET /api/meetings/room/:roomSlug/signal/stream?since=timestamp
 * A single Server-Sent Events connection delivers room signals immediately. The optional
 * `since` replay closes the short gap between a page joining and its stream becoming ready.
 */
export function streamSignalsHandler(req: any, res: Response): void {
  const room = String(req.params.roomSlug).toLowerCase();
  const since = Number(req.query.since) || 0;
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write('retry: 5000\n\n');

  const replay = (roomSignalsMap.get(room) || []).filter(signal => signal.timestamp > since);
  replay.forEach(signal => writeSignalEvent(res, signal));

  const subscribers = roomSignalSubscribers.get(room) || new Set<Response>();
  subscribers.add(res);
  roomSignalSubscribers.set(room, subscribers);
  // Keeps reverse proxies from closing an idle but healthy event stream. This is a single tiny
  // comment frame, not a request, and it is cleaned up as soon as the browser disconnects.
  const heartbeat = setInterval(() => {
    try {
      res.write(': keepalive\n\n');
    } catch {
      // `close` normally handles this; retaining no timer is more important than logging.
    }
  }, 25000);
  req.on('close', () => {
    clearInterval(heartbeat);
    subscribers.delete(res);
    if (subscribers.size === 0) roomSignalSubscribers.delete(room);
  });
}

/**
 * GET /api/meetings/room/:roomSlug/signal?since=timestamp
 * Poll signals for this room since given timestamp.
 */
export async function getSignalsHandler(req: any, res: Response): Promise<void> {
  const room = String(req.params.roomSlug).toLowerCase();
  const since = Number(req.query.since) || 0;
  const signals = roomSignalsMap.get(room) || [];
  const filtered = signals.filter((s) => s.timestamp > since);
  res.json({ signals: filtered, timestamp: Date.now() });
}

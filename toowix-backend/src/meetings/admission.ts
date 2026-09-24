import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { Meeting } from '../models/Meeting';
import { User } from '../models/User';
import { Company } from '../models/Company';
import { generateJitsiToken } from '../auth/jitsi-token';
import { jitsiConfig } from '../config/jitsi';
import { reactivateMeetingForConversation } from './waitingRoom';

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

export async function roomAdmission(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const room = String(req.params.roomSlug).toLowerCase();
    if (!/^[a-z0-9-]{3,100}$/.test(room)) { res.status(400).json({ error: 'Invalid room code' }); return; }
    const meeting = await Meeting.findOne({ roomSlug: room });
    const user = req.firebaseUid ? await User.findOne({ firebaseUid: req.firebaseUid }) : null;
    const company = meeting?.companyId ? await Company.findById(meeting.companyId) : null;
    // Allow instant-* and twx-* room slugs for ad-hoc and shared links even if not pre-persisted
    if (!meeting && !room.startsWith('instant-') && !room.startsWith('twx-')) { res.status(404).json({ error: 'Meeting not found. Create a public instant room from the homepage.' }); return; }
    // Check attendance eligibility
    if (meeting && !mayJoin(meeting, user, company)) {
      res.status(403).json({ error: meeting.cancelledAt ? 'Meeting cancelled' : 'Sign in with an invited or workspace account to join.' }); return;
    }
    // A scheduled meeting's link expires once its scheduled window (start + chosen duration)
    // has elapsed -- an instant meeting (no scheduledAt) or a scheduled one with no duration
    // set never expires this way. Meetings accessed via conversation section never expire.
    const isFromConversation = req.query.fromConversation === '1' || req.body?.fromConversation === true;
    const expiresAt = meeting?.scheduledAt && meeting?.durationMinutes
      ? new Date(new Date(meeting.scheduledAt).getTime() + meeting.durationMinutes * 60000)
      : null;
    const expired = !isFromConversation && !!expiresAt && Date.now() > expiresAt.getTime();
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
    if (req.method === 'GET') { res.json({ meeting: info }); return; }
    if (expired) { res.status(410).json({ error: 'This meeting link has expired.' }); return; }
    // Private meetings always go through the host-controlled waiting room; only the host may enter directly.
    if ((meeting?.type === 'Private' || isLocked) && !isCreator) {
      res.status(403).json({ error: 'Ask to join from the waiting room.', useLobby: true }); return;
    }
    if (passwordRequired) {
      const submitted = typeof req.body.passcode === 'string' ? req.body.passcode.trim() : '';
      if (!submitted || submitted !== activePassword) {
        res.status(401).json({ error: 'Incorrect meeting password.', passwordRequired: true }); return;
      }
    }
    // Rejoining a previously-ended meeting from Conversations must behave like a fresh instant
    // meeting, not immediately get kicked back out by the "was this meeting ended?" poll every
    // client runs every 3s -- see reactivateMeetingForConversation's own comment.
    if (isFromConversation && meeting) {
      await reactivateMeetingForConversation(room);
    }
    const identity = {
      id: user ? String(user._id) : crypto.randomUUID(),
      name: user?.fullName || String(req.body.name || 'Guest').slice(0, 100),
      email: user?.email || '',
      avatar: user?.avatarUrl || undefined,
    };
    const participantEntryId = crypto.randomBytes(12).toString('hex');
    const attendanceToken = jwt.sign({ room, participantEntryId, identity, moderator, purpose: 'attendance' }, jitsiConfig.appSecret,
      { algorithm: 'HS256', audience: 'toowix-attendance', issuer: 'toowix-backend', expiresIn: '12h' });
    res.json({ meeting: info, moderator, userId: user ? String(user._id) : null,
      participation: user ? 'account' : 'guest', attendanceToken, participantEntryId,
      jitsiToken: generateJitsiToken({ user: identity, room, requireLobby: requireLobbyPolicy, companyId: meeting?.companyId ? String(meeting.companyId) : null,
        features: { moderator, recording: recordingEnabled, screenShare: info.allowScreenShare } }) });
  } catch { res.status(503).json({ error: 'Meeting admission unavailable' }); }
}

export async function attendance(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const claim = jwt.verify(String(req.body.attendanceToken || ''), jitsiConfig.appSecret,
      { algorithms: ['HS256'], audience: 'toowix-attendance', issuer: 'toowix-backend' }) as jwt.JwtPayload;
    const room = String(req.params.roomSlug).toLowerCase();
    if (claim.purpose !== 'attendance' || claim.room !== room) { res.sendStatus(403); return; }
    const leaving = req.path.endsWith('/leave');
    if (leaving) {
      await Meeting.updateOne({ roomSlug: room, participants: { $elemMatch: { _id: claim.participantEntryId, leftAt: null } } },
        { $set: { 'participants.$.leftAt': new Date() } });
    } else {
      const meeting = await Meeting.findOne({ roomSlug: room });
      if (meeting?.cancelledAt) { res.status(403).json({ error: 'Meeting cancelled' }); return; }
      await Meeting.updateOne({ roomSlug: room, 'participants._id': { $ne: claim.participantEntryId } },
        { $push: { participants: { _id: claim.participantEntryId, name: claim.identity.name, email: claim.identity.email, avatarUrl: claim.identity.avatar || null, role: claim.moderator ? 'Organizer' : 'Participant', joinedAt: new Date() } } });
    }
    res.sendStatus(200);
  } catch { res.sendStatus(403); }
}

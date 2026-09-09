import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { Meeting } from '../models/Meeting';
import { User } from '../models/User';
import { Company } from '../models/Company';
import { generateJitsiToken } from '../auth/jitsi-token';
import { jitsiConfig } from '../config/jitsi';

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
    if (meeting && !mayAttend(meeting, user, company)) {
      res.status(403).json({ error: meeting.cancelledAt ? 'Meeting cancelled' : 'Sign in with an invited or workspace account to join.' }); return;
    }
    const policy = company?.meetingPolicy;
    const moderator = !!meeting && !!user && String(meeting.createdBy) === String(user._id)
      && (user.role === 'SUPER_ADMIN' || !policy?.whoCanHost || policy.whoCanHost.includes(user.role));
    const requireLobbyPolicy = !!policy?.requireLobby;
    // This flag is an operator attestation, not a replacement for Prosody enforcement.
    if (requireLobbyPolicy && process.env.JITSI_SERVER_POLICY_VERIFIED !== 'true') {
      res.status(503).json({ error: 'Required server-side lobby policy has not been verified.' }); return;
    }
    const recordingEnabled = !!meeting && moderator && policy?.recordingEnabled !== false && company?.limits?.featureFlags?.recordingEnabled !== false;
    const info = {
      type: meeting?.type || 'Guest', organizerId: meeting ? String(meeting.createdBy) : '',
      organizerName: '', description: meeting?.description || null,
      accessAllowed: true, cancelled: false, inviteRestricted: meeting?.type === 'Private',
      recordingEnabled, autoRecording: recordingEnabled && !!policy?.autoRecording,
      requireLobbyPolicy, allowScreenShare: policy?.allowScreenShare !== false,
      micLockEnabled: !!policy?.micLockEnabled,
    };
    if (req.method === 'GET') { res.json({ meeting: info }); return; }
    const identity = { id: user ? String(user._id) : crypto.randomUUID(), name: user?.fullName || String(req.body.name || 'Guest').slice(0, 100), email: user?.email || '' };
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
        { $push: { participants: { _id: claim.participantEntryId, name: claim.identity.name,
          email: claim.identity.email || `${claim.identity.id}@unauthenticated.local`,
          role: claim.moderator ? 'Organizer' : 'Participant', joinedAt: new Date(), attendanceStatus: 'Attended' } } });
    }
    res.json({ participantEntryId: claim.participantEntryId });
  } catch { res.status(401).json({ error: 'Invalid attendance credential' }); }
}

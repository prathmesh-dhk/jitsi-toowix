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
    const { name, email, requestId } = req.body;
    const meeting = await Meeting.findOne({ roomSlug: room });
    if (meeting?.cancelledAt) {
      res.status(403).json({ error: 'Meeting has been cancelled' });
      return;
    }
    if (meeting?.endedAt) {
      res.status(403).json({ error: 'Meeting has already ended' });
      return;
    }

    const user = req.firebaseUid ? await User.findOne({ firebaseUid: req.firebaseUid }) : null;
    const company = meeting?.companyId ? await Company.findById(meeting.companyId) : null;
    const isHost = !!meeting && !!user && String(meeting.createdBy) === String(user._id);

    const displayName = user?.fullName || String(name || 'Guest').trim().slice(0, 100);
    const userEmail = user?.email || email || '';
    const userId = user ? String(user._id) : crypto.randomUUID();
    const identity = { id: userId, name: displayName, email: userEmail };

    // If caller is host, automatically admit and mark host joined
    if (isHost) {
      if (meeting) {
        meeting.hostJoined = true;
        await meeting.save();
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
    const canAutoAdmit = !requireLobbyPolicy && (meeting?.quickAccessEnabled !== false) && (meeting?.hostJoined === true || !meeting);

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
      await meeting.save();

      // Notify host if present
      if (meeting.createdBy) {
        notifyUser({
          userId: meeting.createdBy as any,
          companyId: meeting.companyId as any,
          category: 'MEETINGS',
          type: 'GUEST_WAITING_IN_LOBBY',
          title: `${displayName} is waiting to join`,
          description: `Waiting for admission to ${meeting.name}`,
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
      await Meeting.updateOne(
        { roomSlug: room },
        { $pull: { waitingQueue: { id: requestId } } }
      );
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

    await meeting.save();
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

    const item = (meeting.waitingQueue || []).find(p => p.id === requestId);
    if (item) {
      item.status = 'DENIED';
      item.deniedAt = new Date();
      await meeting.save();
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

    meeting.hostAnnouncement = String(message || '').slice(0, 300);
    await meeting.save();
    res.json({ success: true, hostAnnouncement: meeting.hostAnnouncement });
  } catch (err: any) {
    console.error('[WaitingRoom] Announce error:', err.message);
    res.status(500).json({ error: 'Failed to broadcast announcement' });
  }
}

const endedMeetingSlugs = new Set<string>();

/**
 * POST /api/meetings/room/:roomSlug/end-for-everyone
 * Moderator ends the meeting for everyone in the call.
 */
export async function endMeetingForEveryoneHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const room = String(req.params.roomSlug).toLowerCase();
    endedMeetingSlugs.add(room);

    const meeting = await Meeting.findOne({ roomSlug: room });
    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found' });
      return;
    }

    meeting.endedAt = new Date();
    meeting.waitingQueue = [];
    meeting.hostJoined = false;
    await meeting.save();

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

interface IRoomSignal {
  id: string;
  sender: string;
  type: string;
  payload: any;
  timestamp: number;
}

const roomSignalsMap = new Map<string, IRoomSignal[]>();

/**
 * POST /api/meetings/room/:roomSlug/signal
 * Broadcast a real-time WebRTC signal (offer, answer, candidate, screen-share state).
 */
export async function postSignalHandler(req: any, res: Response): Promise<void> {
  const room = String(req.params.roomSlug).toLowerCase();
  const { sender, type, payload } = req.body;
  if (!roomSignalsMap.has(room)) {
    roomSignalsMap.set(room, []);
  }
  const signals = roomSignalsMap.get(room)!;
  const signal: IRoomSignal = {
    id: crypto.randomUUID(),
    sender: String(sender || 'Anonymous'),
    type: String(type || ''),
    payload: payload || null,
    timestamp: Date.now(),
  };
  signals.push(signal);
  // Keep signals within last 2 minutes, max 100 entries
  const cutoff = Date.now() - 120000;
  roomSignalsMap.set(room, signals.filter((s) => s.timestamp > cutoff).slice(-100));
  res.json({ success: true, signalId: signal.id });
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

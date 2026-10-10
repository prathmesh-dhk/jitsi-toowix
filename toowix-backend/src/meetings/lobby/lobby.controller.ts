import { Response } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';
import * as lobbyService from './lobby.service';

// Every function here does exactly one thing: parse the HTTP request, call one lobby.service.ts
// function, and send the result back out. No business logic lives in this file -- see
// lobby.service.ts for the actual rules (eligibility, password gates, admit/deny, etc).

/**
 * POST /api/meetings/room/:roomSlug/lobby/knock
 * Participant / guest requests entry to the meeting.
 */
export async function knockLobbyHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const room = String(req.params.roomSlug).toLowerCase();
    const { name, email, requestId, passcode } = req.body;
    const fromConversation = req.query.fromConversation === '1' || req.body?.fromConversation === true;
    const result = await lobbyService.requestEntry(room, { firebaseUid: req.firebaseUid, name, email, requestId, passcode, fromConversation });
    res.status(result.httpStatus).json(result.body);
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
    const result = await lobbyService.getStatus(room, requestId);
    res.status(result.httpStatus).json(result.body);
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
    const result = await lobbyService.cancelRequest(room, requestId);
    res.status(result.httpStatus).json(result.body);
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
    const result = await lobbyService.listPending(room, req.firebaseUid);
    res.status(result.httpStatus).json(result.body);
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
    const result = await lobbyService.admitParticipants(room, req.firebaseUid, { requestId, admitAll });
    res.status(result.httpStatus).json(result.body);
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
    const result = await lobbyService.denyParticipant(room, req.firebaseUid, requestId);
    res.status(result.httpStatus).json(result.body);
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
    const result = await lobbyService.broadcastAnnouncement(room, req.firebaseUid, message);
    res.status(result.httpStatus).json(result.body);
  } catch (err: any) {
    console.error('[WaitingRoom] Announce error:', err.message);
    res.status(500).json({ error: 'Failed to broadcast announcement' });
  }
}

/**
 * POST /api/meetings/room/:roomSlug/end-for-everyone
 * Moderator ends the meeting for everyone in the call.
 */
export async function endMeetingForEveryoneHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const room = String(req.params.roomSlug).toLowerCase();
    const result = await lobbyService.endForEveryone(room, req.firebaseUid);
    res.status(result.httpStatus).json(result.body);
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
    const result = await lobbyService.getLiveStatus(room);
    res.status(result.httpStatus).json(result.body);
  } catch (err: any) {
    console.error('[WaitingRoom] Live status error:', err.message);
    res.status(500).json({ error: 'Failed to fetch live meeting status' });
  }
}

/**
 * POST /api/meetings/room/:roomSlug/lock  { password }
 * Host-only. While locked, everyone who is not already in the call must enter the password and
 * then be admitted from the waiting room -- the same rules as a Private meeting.
 */
export async function lockMeetingHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const room = String(req.params.roomSlug).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password.trim() : '';
    const result = await lobbyService.lockMeeting(room, req.firebaseUid, password);
    res.status(result.httpStatus).json(result.body);
  } catch (err: any) {
    console.error('[WaitingRoom] Lock error:', err.message);
    res.status(500).json({ error: 'Failed to lock the meeting' });
  }
}

/** POST /api/meetings/room/:roomSlug/unlock */
export async function unlockMeetingHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const room = String(req.params.roomSlug).toLowerCase();
    const result = await lobbyService.unlockMeeting(room, req.firebaseUid);
    res.status(result.httpStatus).json(result.body);
  } catch (err: any) {
    console.error('[WaitingRoom] Unlock error:', err.message);
    res.status(500).json({ error: 'Failed to unlock the meeting' });
  }
}

/** Issues an opaque, short-lived ticket because EventSource cannot send Authorization headers. */
export async function createLobbyStreamTicketHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const room = String(req.params.roomSlug).toLowerCase();
    const result = await lobbyService.createStreamTicket(room, req.firebaseUid);
    res.status(result.httpStatus).json(result.body);
  } catch (err: any) {
    console.error('[WaitingRoom] Stream ticket error:', err.message);
    res.status(500).json({ error: 'Failed to create waiting-room stream' });
  }
}

/**
 * GET /api/meetings/room/:roomSlug
 * POST /api/meetings/room/:roomSlug/admission
 * Direct (non-lobby) room admission check / join.
 */
export async function roomAdmission(req: AuthenticatedRequest, res: Response): Promise<void> {
  const room = String(req.params.roomSlug).toLowerCase();
  const fromConversation = req.query.fromConversation === '1' || req.body?.fromConversation === true;
  const result = await lobbyService.admitToRoom(room, {
    method: req.method,
    firebaseUid: req.firebaseUid,
    passcode: req.body?.passcode,
    name: req.body?.name,
    fromConversation,
  });
  res.status(result.httpStatus).json(result.body);
}

/**
 * POST /api/meetings/room/:roomSlug/attendance/join
 * POST /api/meetings/room/:roomSlug/attendance/leave
 */
export async function attendance(req: AuthenticatedRequest, res: Response): Promise<void> {
  const room = String(req.params.roomSlug).toLowerCase();
  const leaving = req.path.endsWith('/leave');
  const result = await lobbyService.recordAttendance(room, String(req.body.attendanceToken || ''), leaving);
  if (result.body) {
    res.status(result.httpStatus).json(result.body);
  } else {
    res.sendStatus(result.httpStatus);
  }
}

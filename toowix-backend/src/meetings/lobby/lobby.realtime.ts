import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Response } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';
import { Meeting } from '../../models/Meeting';
import { jitsiConfig } from '../../config/jitsi';

// ---- Lobby (waiting-room) SSE pub/sub ----

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

export function publishLobbyEvent(room: string, event: ILobbyEvent): void {
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

export function publishLobbyQueue(room: string, meeting: any): void {
  publishLobbyEvent(room, {
    type: 'LOBBY_QUEUE',
    payload: {
      count: safeWaitingQueue(meeting).length,
      hostAnnouncement: meeting?.hostAnnouncement || null,
      waiting: safeWaitingQueue(meeting),
    }
  });
}

export function publishLobbyStatus(room: string, participant: any): void {
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

/**
 * Issues an opaque, short-lived ticket because EventSource cannot send Authorization headers.
 * Caller (lobby.service.ts) must already have verified the requester is the meeting host.
 */
export function issueLobbyStreamTicket(room: string): { expiresAt: number; ticket: string } {
  const now = Date.now();
  for (const [ ticket, record ] of lobbyStreamTickets) {
    if (record.expiresAt <= now) lobbyStreamTickets.delete(ticket);
  }
  const ticket = crypto.randomBytes(32).toString('base64url');
  const expiresAt = now + LOBBY_STREAM_TICKET_TTL_MS;
  lobbyStreamTickets.set(ticket, { room, expiresAt });
  return { expiresAt, ticket };
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

// ---- Room-wide WebRTC signaling (offer/answer/candidate relay) ----

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
 * Every conference participant receives this room-scoped token only after admission. Signal
 * transport is not media transport, but it carries actions that the meeting UI acts on (for
 * example, the host ending a meeting), so it must not be an unauthenticated side channel.
 *
 * EventSource cannot attach an Authorization header, therefore the browser supplies the same
 * token in its query string for SSE and the polling fallback. POST sends it in the JSON body.
 */
interface IAttendanceClaim {
  room: string;
  moderator: boolean;
  identity: { email: string; id: string; name: string };
}

// Signal types that only the real meeting moderator may broadcast -- a plain participant's
// attendance token proves they're IN the room, not that they're allowed to act as its host.
const MODERATOR_ONLY_SIGNAL_TYPES = new Set(['MEETING_ENDED_FOR_EVERYONE']);
// Every real payload here is small text/metadata (a chat message, a poll question, a boolean
// away-status, an emoji) -- file/image attachments go through their own upload endpoints and are
// referenced by URL, never embedded here. Confirmed via QA load testing (2026-11-06) that without
// this cap the global body-size limit (16MB) was the only ceiling, letting a single signal's
// payload occupy up to ~15MB x 100 stored signals (the per-room cap below) = over 1GB of server
// RAM for one room alone, with no limit on how many rooms do this simultaneously. 32KB comfortably
// covers even a very long chat message or a poll with many options.
const MAX_SIGNAL_PAYLOAD_BYTES = 32 * 1024;

function requireSignalAttendanceToken(req: AuthenticatedRequest, res: Response): IAttendanceClaim | null {
  const rawToken = typeof req.body?.attendanceToken === 'string'
    ? req.body.attendanceToken
    : typeof req.query?.attendanceToken === 'string'
      ? req.query.attendanceToken
      : '';
  const room = String(req.params.roomSlug).toLowerCase();

  if (!rawToken) {
    res.status(401).json({ error: 'Meeting admission is required to use room signals.' });
    return null;
  }

  try {
    const claim = jwt.verify(rawToken, jitsiConfig.appSecret, {
      algorithms: ['HS256'],
      audience: 'toowix-attendance',
      issuer: 'toowix-backend',
    }) as jwt.JwtPayload;

    if (claim.purpose !== 'attendance' || claim.room !== room) {
      res.status(403).json({ error: 'This meeting token does not grant access to this room.' });
      return null;
    }

    return { room, moderator: !!claim.moderator, identity: claim.identity };
  } catch {
    res.status(401).json({ error: 'A valid meeting admission token is required to use room signals.' });
    return null;
  }
}

/**
 * POST /api/meetings/room/:roomSlug/signal
 * Broadcast a real-time WebRTC signal (offer, answer, candidate, screen-share state).
 */
export async function postSignalHandler(req: any, res: Response): Promise<void> {
  const claim = requireSignalAttendanceToken(req, res);
  if (!claim) return;
  const room = String(req.params.roomSlug).toLowerCase();
  const { type, payload, msgId, senderSessionId, targetSessionId } = req.body;
  const signalType = String(type || '');

  if (MODERATOR_ONLY_SIGNAL_TYPES.has(signalType) && !claim.moderator) {
    res.status(403).json({ error: 'Only the meeting host can send this signal.' });
    return;
  }
  if (payload !== undefined && payload !== null) {
    // JSON.stringify recurses per nesting level, so a deeply-nested (but byte-small) payload can
    // blow V8's call stack before the byte-size check below ever runs. That throw happens inside
    // this async handler, so without a catch it becomes an unhandled rejection -- which crashes
    // the whole process, not just this request (confirmed live: a 50,000-level-deep payload well
    // under MAX_SIGNAL_PAYLOAD_BYTES took the entire backend down). Reject it as a plain 400
    // instead of letting the stack overflow escape.
    let serialized: string;

    try {
      serialized = JSON.stringify(payload);
    } catch {
      res.status(400).json({ error: 'Signal payload is malformed.' });
      return;
    }
    if (Buffer.byteLength(serialized, 'utf8') > MAX_SIGNAL_PAYLOAD_BYTES) {
      res.status(413).json({ error: 'Signal payload is too large.' });
      return;
    }
  }
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
    // Taken from the verified attendance token, never the request body -- the token's identity
    // IS the display name the participant was admitted under, so this loses nothing legitimate
    // while closing off sender spoofing/impersonation (e.g. claiming to be "the host").
    sender: claim.identity?.name ? String(claim.identity.name).slice(0, 120) : 'Participant',
    type: signalType,
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
  if (!requireSignalAttendanceToken(req, res)) return;
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
  if (!requireSignalAttendanceToken(req, res)) return;
  const room = String(req.params.roomSlug).toLowerCase();
  const since = Number(req.query.since) || 0;
  const signals = roomSignalsMap.get(room) || [];
  const filtered = signals.filter((s) => s.timestamp > since);
  res.json({ signals: filtered, timestamp: Date.now() });
}

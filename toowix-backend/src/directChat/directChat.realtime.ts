import type { Response } from 'express';

// In-process pub/sub for the direct-chat Server-Sent-Events stream, same single-process model the
// lobby realtime module already relies on. Every user can have a few open streams (several tabs or
// devices); an event published to a user is written to all of them.
export type DirectChatEvent =
  | { type: 'ready'; totalUnread: number }
  // `peer` is the OTHER person in the chat from the receiver's point of view (the sender, for the recipient),
  // so a brand-new chat can be shown instantly without a second request.
  | { type: 'message'; conversationId: string; message: Record<string, unknown>; peer: { id: string; name: string; avatarUrl: string | null }; unreadCount: number; totalUnread: number }
  // A call just started and is ringing for this person (the caller is `peer`). roomSlug is the meeting room to join.
  | { type: 'callIncoming'; conversationId: string; callId: string; mode: 'video' | 'voice'; roomSlug: string; peer: { id: string; name: string; avatarUrl: string | null } }
  // A call's chat entry changed (answered / declined / missed / cancelled): replace the bubble, stop any ringing.
  | { type: 'callUpdate'; conversationId: string; message: Record<string, unknown> }
  // This person's own settings for a chat changed (mute / block), so their other tabs follow.
  | { type: 'settings'; conversationId: string; mutedUntil: string | null; blockedByMe: boolean }
  | { type: 'cleared'; conversationId: string }
  | { type: 'removed'; conversationId: string }
  | { type: 'delivered'; conversationId: string; messageIds: string[]; at: string }
  | { type: 'read'; conversationId: string; readerId: string; at: string }
  | { type: 'unread'; conversationId: string; unreadCount: number; totalUnread: number };

const MAX_STREAMS_PER_USER = 5;
const HEARTBEAT_MS = 25_000;

const subscribers = new Map<string, Set<Response>>();
let heartbeat: ReturnType<typeof setInterval> | null = null;

function startHeartbeat(): void {
  if (heartbeat) return;
  heartbeat = setInterval(() => {
    for (const [ userId, streams ] of subscribers) {
      for (const stream of streams) {
        try {
          // A comment frame: keeps reverse proxies from closing an idle but healthy stream, and
          // surfaces a dead socket (the write throws) so it is dropped instead of leaking.
          stream.write(': ping\n\n');
        } catch {
          streams.delete(stream);
        }
      }
      if (streams.size === 0) subscribers.delete(userId);
    }
    if (subscribers.size === 0) stopHeartbeat();
  }, HEARTBEAT_MS);
  heartbeat.unref?.();
}

function stopHeartbeat(): void {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
}

export function configureSseResponse(res: Response): void {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write('retry: 3000\n\n');
}

function writeEvent(stream: Response, event: DirectChatEvent): void {
  stream.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

/** Registers an open stream for a user. Returns the function that unregisters it. */
export function subscribeDirectChat(userId: string, stream: Response): () => void {
  let streams = subscribers.get(userId);

  if (!streams) {
    streams = new Set();
    subscribers.set(userId, streams);
  }
  // Bound the number of simultaneous streams per user: a buggy client reconnecting in a loop must not
  // be able to pile up sockets. The oldest one is closed first.
  while (streams.size >= MAX_STREAMS_PER_USER) {
    const oldest = streams.values().next().value as Response;

    streams.delete(oldest);
    try { oldest.end(); } catch { /* already closed */ }
  }
  streams.add(stream);
  startHeartbeat();

  return () => {
    const current = subscribers.get(userId);

    if (!current) return;
    current.delete(stream);
    if (current.size === 0) subscribers.delete(userId);
    if (subscribers.size === 0) stopHeartbeat();
  };
}

export function isDirectChatOnline(userId: string): boolean {
  return (subscribers.get(userId)?.size ?? 0) > 0;
}

/** Writes an event to every open stream of one user. Never throws: delivery is best-effort. */
export function publishToUser(userId: string, event: DirectChatEvent): void {
  const streams = subscribers.get(userId);

  if (!streams) return;
  for (const stream of streams) {
    try {
      writeEvent(stream, event);
    } catch {
      streams.delete(stream);
    }
  }
  if (streams.size === 0) subscribers.delete(userId);
}

export function writeDirectChatEvent(stream: Response, event: DirectChatEvent): void {
  writeEvent(stream, event);
}

/** Test hook: drops every subscriber and the heartbeat. */
export function resetDirectChatRealtimeForTests(): void {
  subscribers.clear();
  stopHeartbeat();
}

import crypto from 'crypto';
import { Types } from 'mongoose';
import { User } from '../models/User';
import { Meeting } from '../models/Meeting';
import { Notification } from '../models/Notification';
import { DirectConversation } from '../models/DirectConversation';
import { DirectMessage, DirectCallMode, DirectCallStatus } from '../models/DirectMessage';
import { isDirectChatOnline, publishToUser } from './directChat.realtime';
import {
  IServiceResult, fail, toPeer, serializeMessage, otherParticipant, loadConversationForActor, blockState,
  ringMs, effectiveCallStatus, getTotalUnread, unreadByConversation,
} from './directChat.shared';

// 1:1 voice / video calls started from a chat. A call is a throwaway meeting room (the same Toowix meeting
// room people already use for video) plus a "call" entry in the chat that shows how it went. Nothing here
// emails anyone -- unlike creating a normal meeting -- and the room is removed a day later (TTL index).

const CALL_ROOM_LIFETIME_MS = 24 * 60 * 60 * 1000;
const SLUG_LETTERS = 'abcdefghijklmnopqrstuvwxyz';

const slugChunk = (length: number): string => Array.from(crypto.randomBytes(length), (byte) => SLUG_LETTERS[byte % SLUG_LETTERS.length]).join('');
const newRoomSlug = (): string => `twx-${slugChunk(3)}-${slugChunk(3)}-${slugChunk(3)}`;

const ringTimers = new Map<string, ReturnType<typeof setTimeout>>();

const clearRingTimer = (messageId: string): void => {
  const timer = ringTimers.get(messageId);

  if (timer) clearTimeout(timer);
  ringTimers.delete(messageId);
};

/** Test hook: forget every pending ring timer. */
export const resetCallTimersForTests = (): void => {
  for (const timer of ringTimers.values()) clearTimeout(timer);
  ringTimers.clear();
};

const callLabel = (mode: DirectCallMode): string => (mode === 'voice' ? 'Voice call' : 'Video call');

/** Atomically moves a call out of "ringing". Returns the updated message, or null if it already left that state. */
async function transitionCall(messageId: string, status: DirectCallStatus, actorFilter: Record<string, unknown> = {}): Promise<any | null> {
  const now = new Date();
  // Answered, declined and cancelled calls need no attention afterwards; a missed call stays unread, like on a phone.
  const settles = status === 'answered' || status === 'declined' || status === 'cancelled';
  const updated = await DirectMessage.findOneAndUpdate(
    { _id: new Types.ObjectId(messageId), kind: 'call', 'call.status': 'ringing', ...actorFilter },
    { $set: { 'call.status': status, ...(status === 'answered' ? { 'call.answeredAt': now } : {}), ...(settles ? { readAt: now, deliveredAt: now } : {}) } },
    { new: true },
  ).lean();

  if (updated) clearRingTimer(messageId);

  return updated;
}

async function announceCallUpdate(message: any): Promise<void> {
  const conversationId = String(message.conversationId);
  const recipientId = String(message.recipientId);
  const payload = { type: 'callUpdate' as const, conversationId, message: serializeMessage(message) as unknown as Record<string, unknown> };

  publishToUser(String(message.senderId), payload);
  publishToUser(recipientId, payload);

  const unreadCount = (await unreadByConversation(recipientId)).get(conversationId) || 0;

  publishToUser(recipientId, { type: 'unread', conversationId, unreadCount, totalUnread: await getTotalUnread(recipientId) });
}

async function notifyMissedCall(message: any): Promise<void> {
  try {
    const caller = await User.findById(message.senderId).select('fullName').lean();
    const name = (caller as any)?.fullName || 'Someone';

    await Notification.create({
      userId: message.recipientId,
      type: 'CHAT_MESSAGE',
      category: 'PEOPLE_TEAMS',
      title: `Missed ${message.call.mode === 'voice' ? 'voice' : 'video'} call from ${name}`,
      description: 'Open the chat to call back.',
      relatedName: name,
      actionLabel: 'View',
      actionUrl: `/dashboard?tab=chats&chat=${message.conversationId}`,
      companyId: null,
    });
  } catch (error: any) {
    console.error('[DirectChat] could not create missed-call notification:', error.message);
  }
}

async function markMissed(messageId: string): Promise<void> {
  try {
    const missed = await transitionCall(messageId, 'missed');

    if (!missed) return; // answered / declined / cancelled in the meantime
    await announceCallUpdate(missed);
    await notifyMissedCall(missed);
  } catch (error: any) {
    console.error('[DirectChat] could not mark call missed:', error.message);
  }
}

export async function startCall(actorId: string, conversationId: string, rawMode: unknown): Promise<IServiceResult> {
  if (rawMode !== 'voice' && rawMode !== 'video') return fail(400, 'Choose a voice or video call.', 'INVALID_CALL_MODE');

  const mode: DirectCallMode = rawMode;

  try {
    const conversation = await loadConversationForActor(actorId, conversationId);

    if (!conversation) return fail(404, 'Chat not found.', 'CHAT_NOT_FOUND');

    const recipientId = otherParticipant(conversation, actorId);
    const [ caller, recipient ] = await Promise.all([
      User.findById(actorId).select('fullName avatarUrl').lean(),
      User.findById(recipientId).select('fullName avatarUrl status').lean(),
    ]);

    if (!recipient || (recipient as any).status !== 'ACTIVE') return fail(409, 'This person is no longer available to call.', 'PEER_UNAVAILABLE');

    const blocked = await blockState(actorId, recipientId, conversationId);

    if (blocked === 'by_me') return fail(403, 'You blocked this person. Unblock them to call.', 'BLOCKED_BY_ME');
    if (blocked === 'by_peer') return fail(403, 'You cannot call this person right now.', 'BLOCKED');

    // One live call per chat: pressing the button twice must not ring the other person twice.
    const existing = await DirectMessage.findOne({ conversationId: conversation._id, kind: 'call', 'call.status': 'ringing' }).sort({ createdAt: -1 }).lean();

    if (existing && effectiveCallStatus(existing) === 'ringing') {
      return fail(409, 'A call is already ringing in this chat.', 'CALL_IN_PROGRESS');
    }

    const online = isDirectChatOnline(recipientId);
    const roomSlug = newRoomSlug();
    const now = new Date();

    await Meeting.create({
      createdBy: new Types.ObjectId(actorId),
      companyId: null,
      name: callLabel(mode),
      roomSlug,
      type: 'Guest',
      purpose: 'DIRECT_CALL',
      callExpiresAt: new Date(now.getTime() + CALL_ROOM_LIFETIME_MS),
    });

    const message = (await DirectMessage.create({
      conversationId: conversation._id,
      senderId: new Types.ObjectId(actorId),
      recipientId: new Types.ObjectId(recipientId),
      text: callLabel(mode),
      kind: 'call',
      call: { mode, status: 'ringing', roomSlug },
      deliveredAt: online ? now : null,
    })).toObject();

    await DirectConversation.updateOne(
      { _id: conversation._id, $or: [ { lastMessageAt: null }, { lastMessageAt: { $lte: message.createdAt } } ] },
      { $set: { lastMessage: { messageId: message._id, senderId: message.senderId, text: message.text, at: message.createdAt }, lastMessageAt: message.createdAt } },
    );

    const serialized = serializeMessage(message);
    const unreadCount = (await unreadByConversation(recipientId)).get(conversationId) || 0;

    publishToUser(actorId, { type: 'message', conversationId, message: serialized, peer: toPeer(recipient), unreadCount: 0, totalUnread: await getTotalUnread(actorId) });
    publishToUser(recipientId, { type: 'message', conversationId, message: serialized, peer: toPeer(caller), unreadCount, totalUnread: await getTotalUnread(recipientId) });

    if (online) {
      publishToUser(recipientId, { type: 'callIncoming', conversationId, callId: String(message._id), mode, roomSlug, peer: toPeer(caller) });

      const timer = setTimeout(() => { void markMissed(String(message._id)); }, ringMs());

      timer.unref?.();
      ringTimers.set(String(message._id), timer);
    } else {
      // Nobody to ring: it is a missed call straight away, and shows up in their bell.
      await markMissed(String(message._id));
    }

    const current = await DirectMessage.findById(message._id).lean();

    return { body: { message: serializeMessage(current), callId: String(message._id), roomSlug, ringing: online }, httpStatus: 201 };
  } catch (error: any) {
    console.error('[DirectChat] start call failed:', error.message);

    return fail(500, 'Could not start the call. Please try again.', 'CALL_FAILED');
  }
}

async function loadCallForActor(callId: string, actorId: string, role: 'recipient' | 'sender'): Promise<any | null> {
  if (!Types.ObjectId.isValid(callId)) return null;

  return DirectMessage.findOne({ _id: callId, kind: 'call', [role === 'recipient' ? 'recipientId' : 'senderId']: new Types.ObjectId(actorId) }).lean();
}

/** The callee picks up. Returns the room to join. */
export async function acceptCall(actorId: string, callId: string): Promise<IServiceResult> {
  try {
    const call = await loadCallForActor(callId, actorId, 'recipient');

    if (!call) return fail(404, 'Call not found.', 'CALL_NOT_FOUND');
    if (effectiveCallStatus(call) !== 'ringing') return fail(409, 'This call has ended.', 'CALL_ENDED');
    if ((await blockState(actorId, String(call.senderId), String(call.conversationId))) !== 'none') return fail(403, 'You cannot join this call.', 'BLOCKED');

    const answered = await transitionCall(callId, 'answered', { recipientId: new Types.ObjectId(actorId) });

    if (!answered) return fail(409, 'This call has ended.', 'CALL_ENDED');
    await announceCallUpdate(answered);

    return { body: { ok: true, mode: answered.call.mode, roomSlug: answered.call.roomSlug, conversationId: String(answered.conversationId) }, httpStatus: 200 };
  } catch (error: any) {
    console.error('[DirectChat] accept call failed:', error.message);

    return fail(500, 'Could not answer the call. Please try again.', 'CALL_FAILED');
  }
}

export async function declineCall(actorId: string, callId: string): Promise<IServiceResult> {
  try {
    const call = await loadCallForActor(callId, actorId, 'recipient');

    if (!call) return fail(404, 'Call not found.', 'CALL_NOT_FOUND');

    const declined = await transitionCall(callId, 'declined', { recipientId: new Types.ObjectId(actorId) });

    if (declined) await announceCallUpdate(declined);

    return { body: { ok: true }, httpStatus: 200 };
  } catch (error: any) {
    console.error('[DirectChat] decline call failed:', error.message);

    return fail(500, 'Could not decline the call. Please try again.', 'CALL_FAILED');
  }
}

/** The caller hangs up before anyone answered. */
export async function cancelCall(actorId: string, callId: string): Promise<IServiceResult> {
  try {
    const call = await loadCallForActor(callId, actorId, 'sender');

    if (!call) return fail(404, 'Call not found.', 'CALL_NOT_FOUND');

    const cancelled = await transitionCall(callId, 'cancelled', { senderId: new Types.ObjectId(actorId) });

    if (cancelled) await announceCallUpdate(cancelled);

    return { body: { ok: true }, httpStatus: 200 };
  } catch (error: any) {
    console.error('[DirectChat] cancel call failed:', error.message);

    return fail(500, 'Could not cancel the call. Please try again.', 'CALL_FAILED');
  }
}

import mongoose, { Types } from 'mongoose';
import { User } from '../models/User';
import { Notification } from '../models/Notification';
import { DirectConversation, buildParticipantKey } from '../models/DirectConversation';
import { DirectChatSettings, MUTE_FOREVER } from '../models/DirectChatSettings';
import { DIRECT_MESSAGE_MAX_LENGTH, DirectMessage, directMessageStatus } from '../models/DirectMessage';
import { isDirectChatOnline, publishToUser } from './directChat.realtime';
import {
  IServiceResult, fail, toPeer, serializeMessage, otherParticipant, loadConversationForActor,
  IChatSettingsView, getSettings, getSettingsMap, isMuted, mutedUntilIso, blockState, unreadByConversation, getTotalUnread,
} from './directChat.shared';

export { IServiceResult, serializeMessage, getTotalUnread };

// All business rules for 1:1 direct chat live here as plain functions -- no `req`/`res` -- following
// the same service/controller split as account.service.ts. directChat.controller.ts parses HTTP in,
// calls one of these with the already-authenticated user's id, and sends the result back out.

const SEARCH_MIN_LENGTH = 2;
const SEARCH_MAX_LENGTH = 64;
const SEARCH_RESULT_LIMIT = 15;
const MESSAGE_PAGE_DEFAULT = 50;
const MESSAGE_PAGE_MAX = 100;
const NOTIFICATION_PREVIEW_LENGTH = 140;

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** j***@example.com -- enough to tell two same-named people apart without publishing everyone's email. */
export const maskEmail = (email: string): string => {
  const [ local = '', domain = '' ] = String(email).split('@');

  if (!domain) return '';

  return `${local.charAt(0)}***@${domain}`;
};

// ---- Search ----

/** Finds registered, verified, active Toowix users by name (any word) or the start of their email. */
export async function searchUsers(actorId: string, rawQuery: unknown): Promise<IServiceResult> {
  if (typeof rawQuery !== 'string') return fail(400, 'A search term is required.', 'QUERY_REQUIRED');

  const query = rawQuery.trim();

  if (query.length < SEARCH_MIN_LENGTH) {
    return fail(400, `Type at least ${SEARCH_MIN_LENGTH} characters to search.`, 'QUERY_TOO_SHORT');
  }
  if (query.length > SEARCH_MAX_LENGTH) return fail(400, 'That search term is too long.', 'QUERY_TOO_LONG');

  try {
    const escaped = escapeRegex(query);
    const users = await User.find({
      _id: { $ne: new Types.ObjectId(actorId) },
      status: 'ACTIVE',
      // An account that never verified its email cannot sign in, so it can never chat -- do not list it.
      emailVerifiedAt: { $ne: null },
      $or: [
        { fullName: { $regex: `(^|\\s)${escaped}`, $options: 'i' } },
        { email: { $regex: `^${escaped}`, $options: 'i' } },
      ],
    })
      .sort({ fullName: 1 })
      .limit(SEARCH_RESULT_LIMIT)
      .select('fullName avatarUrl email')
      .lean();

    return {
      body: { users: users.map((user: any) => ({ ...toPeer(user), emailHint: maskEmail(user.email) })) },
      httpStatus: 200,
    };
  } catch (error: any) {
    console.error('[DirectChat] search failed:', error.message);

    return fail(500, 'Could not search right now. Please try again.', 'SEARCH_FAILED');
  }
}

// ---- Conversations ----

async function summarize(conversation: any, actorId: string, peer: any, unreadCount: number, lastStatus?: string, settings?: IChatSettingsView) {
  // "Clear chat" hides everything up to that moment, including the preview in the list.
  const cleared = settings?.clearedAt && conversation.lastMessage && new Date(conversation.lastMessage.at) <= new Date(settings.clearedAt);
  const last = cleared ? null : conversation.lastMessage;

  return {
    id: String(conversation._id),
    peer: toPeer(peer),
    lastMessage: last
      ? {
          id: String(last.messageId),
          text: last.text,
          senderId: String(last.senderId),
          at: new Date(last.at).toISOString(),
          status: String(last.senderId) === String(actorId) ? (lastStatus || 'sent') : undefined,
        }
      : null,
    unreadCount,
    mutedUntil: mutedUntilIso(settings),
    blockedByMe: Boolean(settings?.blocked),
    updatedAt: new Date(conversation.lastMessageAt || conversation.updatedAt || Date.now()).toISOString(),
  };
}

/** Opens (or creates) the one conversation between the caller and another registered user. */
export async function openConversation(actorId: string, targetUserId: unknown): Promise<IServiceResult> {
  if (typeof targetUserId !== 'string' || !mongoose.isValidObjectId(targetUserId)) {
    return fail(400, 'Choose a person to chat with.', 'INVALID_USER');
  }
  if (targetUserId === actorId) return fail(400, 'You cannot start a chat with yourself.', 'SELF_CHAT');

  try {
    const target = await User.findById(targetUserId).select('fullName avatarUrl status emailVerifiedAt').lean();

    if (!target || target.status !== 'ACTIVE' || !target.emailVerifiedAt) {
      return fail(404, 'That person is not available.', 'USER_NOT_FOUND');
    }

    const participantKey = buildParticipantKey(actorId, targetUserId);
    const participants = [ new Types.ObjectId(actorId), new Types.ObjectId(targetUserId) ];
    let conversation: any;

    try {
      conversation = await DirectConversation.findOneAndUpdate(
        { participantKey },
        { $setOnInsert: { participantKey, participants, lastMessage: null, lastMessageAt: null } },
        { upsert: true, new: true },
      ).lean();
    } catch (error: any) {
      // Two people opening the chat at the same instant: the loser of the upsert race hits the unique
      // index. The conversation now exists, so just read it.
      if (error?.code !== 11000) throw error;
      conversation = await DirectConversation.findOne({ participantKey }).lean();
    }

    const unread = (await unreadByConversation(actorId)).get(String(conversation._id)) || 0;

    return { body: { conversation: await summarize(conversation, actorId, target, unread, undefined, await getSettings(actorId, String(conversation._id))) }, httpStatus: 200 };
  } catch (error: any) {
    console.error('[DirectChat] open conversation failed:', error.message);

    return fail(500, 'Could not open this chat. Please try again.', 'OPEN_FAILED');
  }
}

/** The caller's conversations that actually have messages, newest first, each with its unread count. */
export async function listConversations(actorId: string): Promise<IServiceResult> {
  try {
    const conversations = await DirectConversation.find({
      participants: new Types.ObjectId(actorId),
      lastMessageAt: { $ne: null },
    })
      .sort({ lastMessageAt: -1 })
      .limit(100)
      .lean();

    const peerIds = conversations.map((conversation: any) => otherParticipant(conversation, actorId));
    const lastMessageIds = conversations.map((conversation: any) => conversation.lastMessage?.messageId).filter(Boolean);
    const [ peers, unread, lastMessages, totalUnread, settingsMap ] = await Promise.all([
      User.find({ _id: { $in: peerIds } }).select('fullName avatarUrl').lean(),
      unreadByConversation(actorId),
      DirectMessage.find({ _id: { $in: lastMessageIds } }).select('deliveredAt readAt').lean(),
      getTotalUnread(actorId),
      getSettingsMap(actorId),
    ]);
    const peerById = new Map(peers.map((peer: any) => [ String(peer._id), peer ]));
    const statusById = new Map(lastMessages.map((message: any) => [ String(message._id), directMessageStatus(message) ]));

    // "Delete chat" hides a chat from the list until a newer message arrives.
    const visible = conversations.filter((conversation: any) => {
      const hiddenAt = settingsMap.get(String(conversation._id))?.hiddenAt;

      return !hiddenAt || new Date(conversation.lastMessageAt) > new Date(hiddenAt);
    });
    const summaries = await Promise.all(visible.map((conversation: any) => summarize(
      conversation,
      actorId,
      peerById.get(otherParticipant(conversation, actorId)) || { _id: otherParticipant(conversation, actorId), fullName: 'Toowix user' },
      unread.get(String(conversation._id)) || 0,
      statusById.get(String(conversation.lastMessage?.messageId)),
      settingsMap.get(String(conversation._id)),
    )));

    return { body: { conversations: summaries, totalUnread }, httpStatus: 200 };
  } catch (error: any) {
    console.error('[DirectChat] list conversations failed:', error.message);

    return fail(500, 'Could not load your chats. Please try again.', 'LIST_FAILED');
  }
}

/** One page of messages (oldest first within the page). `before` is an ISO time for paging further back. */
export async function getMessages(actorId: string, conversationId: string, before?: unknown, limit?: unknown): Promise<IServiceResult> {
  try {
    const conversation = await loadConversationForActor(actorId, conversationId);

    if (!conversation) return fail(404, 'Chat not found.', 'CHAT_NOT_FOUND');

    const pageSize = Math.min(Math.max(parseInt(String(limit ?? MESSAGE_PAGE_DEFAULT), 10) || MESSAGE_PAGE_DEFAULT, 1), MESSAGE_PAGE_MAX);
    const filter: Record<string, any> = { conversationId: conversation._id };
    const { clearedAt } = await getSettings(actorId, conversationId);

    if (clearedAt) filter.createdAt = { $gt: new Date(clearedAt) };

    if (typeof before === 'string' && before) {
      const beforeDate = new Date(before);

      if (Number.isNaN(beforeDate.getTime())) return fail(400, 'Invalid paging value.', 'INVALID_BEFORE');
      filter.createdAt = { ...(filter.createdAt || {}), $lt: beforeDate };
    }

    const rows = await DirectMessage.find(filter).sort({ createdAt: -1, _id: -1 }).limit(pageSize + 1).lean();
    const hasMore = rows.length > pageSize;
    const page = rows.slice(0, pageSize).reverse();

    return { body: { messages: page.map(serializeMessage), hasMore }, httpStatus: 200 };
  } catch (error: any) {
    console.error('[DirectChat] get messages failed:', error.message);

    return fail(500, 'Could not load this chat. Please try again.', 'MESSAGES_FAILED');
  }
}

async function notifyOfflineRecipient(recipientId: string, sender: any, conversationId: string, text: string): Promise<void> {
  try {
    const senderName = sender?.fullName || 'Someone';
    const actionUrl = `/dashboard?tab=chats&chat=${conversationId}`;

    // One collapsing notification per conversation: ten messages while someone is away are one bell
    // entry showing the latest text, not ten.
    await Notification.findOneAndUpdate(
      { userId: new Types.ObjectId(recipientId), type: 'CHAT_MESSAGE', isRead: false, actionUrl },
      {
        $set: {
          title: `New message from ${senderName}`,
          description: text.slice(0, NOTIFICATION_PREVIEW_LENGTH),
          relatedName: senderName,
        },
        $setOnInsert: { category: 'PEOPLE_TEAMS', actionLabel: 'View', companyId: null },
      },
      { upsert: true },
    );
  } catch (error: any) {
    // A notification problem must never fail or delay the message itself.
    console.error('[DirectChat] could not create notification:', error.message);
  }
}

/** Sends a message. `clientId` makes a retried request idempotent (no duplicate bubbles). */
export async function sendMessage(actorId: string, conversationId: string, rawText: unknown, clientId?: unknown): Promise<IServiceResult> {
  if (typeof rawText !== 'string') return fail(400, 'Write a message first.', 'TEXT_REQUIRED');

  const text = rawText.replace(/\r\n/g, '\n').trim();

  if (!text) return fail(400, 'Write a message first.', 'TEXT_REQUIRED');
  if (text.length > DIRECT_MESSAGE_MAX_LENGTH) {
    return fail(400, `Messages can be at most ${DIRECT_MESSAGE_MAX_LENGTH} characters.`, 'TEXT_TOO_LONG');
  }
  if (clientId !== undefined && clientId !== null && (typeof clientId !== 'string' || !clientId || clientId.length > 64)) {
    return fail(400, 'Invalid client id.', 'INVALID_CLIENT_ID');
  }

  try {
    const conversation = await loadConversationForActor(actorId, conversationId);

    if (!conversation) return fail(404, 'Chat not found.', 'CHAT_NOT_FOUND');

    const recipientId = otherParticipant(conversation, actorId);
    const [ sender, recipient ] = await Promise.all([
      User.findById(actorId).select('fullName avatarUrl').lean(),
      User.findById(recipientId).select('fullName avatarUrl status').lean(),
    ]);

    if (!recipient || recipient.status !== 'ACTIVE') {
      return fail(409, 'This person is no longer available to chat.', 'PEER_UNAVAILABLE');
    }

    const blocked = await blockState(actorId, recipientId, String(conversation._id));

    if (blocked === 'by_me') return fail(403, 'You blocked this person. Unblock them to send messages.', 'BLOCKED_BY_ME');
    if (blocked === 'by_peer') return fail(403, 'You cannot send messages to this person right now.', 'BLOCKED');

    const recipientOnline = isDirectChatOnline(recipientId);
    const now = new Date();
    let message: any;
    let duplicate = false;

    try {
      message = (await DirectMessage.create({
        conversationId: conversation._id,
        senderId: new Types.ObjectId(actorId),
        recipientId: new Types.ObjectId(recipientId),
        text,
        ...(typeof clientId === 'string' ? { clientId } : {}),
        deliveredAt: recipientOnline ? now : null,
      })).toObject();
    } catch (error: any) {
      if (error?.code !== 11000 || typeof clientId !== 'string') throw error;
      // The same send arrived twice (a retry after a dropped response): return the original.
      message = await DirectMessage.findOne({ senderId: new Types.ObjectId(actorId), clientId }).lean();
      duplicate = true;
    }

    if (!message) throw new Error('message missing after duplicate-key');

    if (!duplicate) {
      // Only move the conversation forward if this message is the newest one -- two sends racing
      // must never leave an older message as the "last message".
      await DirectConversation.updateOne(
        { _id: conversation._id, $or: [ { lastMessageAt: null }, { lastMessageAt: { $lte: message.createdAt } } ] },
        { $set: { lastMessage: { messageId: message._id, senderId: message.senderId, text, at: message.createdAt }, lastMessageAt: message.createdAt } },
      );

      const [ unreadCount, totalUnread ] = await Promise.all([
        DirectMessage.countDocuments({ conversationId: conversation._id, recipientId: new Types.ObjectId(recipientId), readAt: null }),
        getTotalUnread(recipientId),
      ]);
      const serialized = serializeMessage(message);

      publishToUser(recipientId, { type: 'message', conversationId: String(conversation._id), message: serialized, peer: toPeer(sender), unreadCount, totalUnread });
      // The sender's other tabs/devices see their own message too.
      publishToUser(actorId, { type: 'message', conversationId: String(conversation._id), message: serialized, peer: toPeer(recipient), unreadCount: 0, totalUnread: await getTotalUnread(actorId) });

      const recipientSettings = await getSettings(recipientId, String(conversation._id));

      if (!recipientOnline && !isMuted(recipientSettings)) await notifyOfflineRecipient(recipientId, sender, String(conversation._id), text);
    }

    return { body: { message: serializeMessage(message), duplicate }, httpStatus: duplicate ? 200 : 201 };
  } catch (error: any) {
    console.error('[DirectChat] send failed:', error.message);

    return fail(500, 'Your message could not be sent. Please try again.', 'SEND_FAILED');
  }
}

/** Marks everything the other person sent in this chat as read, and tells both sides. */
export async function markConversationRead(actorId: string, conversationId: string): Promise<IServiceResult> {
  try {
    const conversation = await loadConversationForActor(actorId, conversationId);

    if (!conversation) return fail(404, 'Chat not found.', 'CHAT_NOT_FOUND');

    const now = new Date();
    const result = await DirectMessage.updateMany(
      { conversationId: conversation._id, recipientId: new Types.ObjectId(actorId), readAt: null },
      [ { $set: { readAt: now, deliveredAt: { $ifNull: [ '$deliveredAt', now ] } } } ],
    );

    // Opening the chat also clears the (collapsed) bell notification for it.
    await Notification.updateMany(
      { userId: new Types.ObjectId(actorId), type: 'CHAT_MESSAGE', isRead: false, actionUrl: `/dashboard?tab=chats&chat=${conversationId}` },
      { $set: { isRead: true } },
    ).catch(() => undefined);

    const totalUnread = await getTotalUnread(actorId);

    if (result.modifiedCount > 0) {
      publishToUser(otherParticipant(conversation, actorId), { type: 'read', conversationId, readerId: actorId, at: now.toISOString() });
    }
    publishToUser(actorId, { type: 'unread', conversationId, unreadCount: 0, totalUnread });

    return { body: { ok: true, totalUnread }, httpStatus: 200 };
  } catch (error: any) {
    console.error('[DirectChat] mark read failed:', error.message);

    return fail(500, 'Could not update this chat. Please try again.', 'READ_FAILED');
  }
}

/** Called when a user's realtime stream connects: everything waiting for them is now delivered. */
export async function markPendingDelivered(userId: string): Promise<void> {
  try {
    const pending = await DirectMessage.find({ recipientId: new Types.ObjectId(userId), deliveredAt: null })
      .select('_id conversationId senderId')
      .limit(500)
      .lean();

    if (pending.length === 0) return;

    const now = new Date();

    await DirectMessage.updateMany({ _id: { $in: pending.map((message: any) => message._id) } }, { $set: { deliveredAt: now } });

    const grouped = new Map<string, { senderId: string; conversationId: string; ids: string[] }>();

    for (const message of pending as any[]) {
      const key = `${message.senderId}:${message.conversationId}`;
      const entry = grouped.get(key) || { senderId: String(message.senderId), conversationId: String(message.conversationId), ids: [] };

      entry.ids.push(String(message._id));
      grouped.set(key, entry);
    }
    for (const entry of grouped.values()) {
      publishToUser(entry.senderId, { type: 'delivered', conversationId: entry.conversationId, messageIds: entry.ids, at: now.toISOString() });
    }
  } catch (error: any) {
    console.error('[DirectChat] mark delivered failed:', error.message);
  }
}

// ---- Per-person chat settings (the three-dot menu): mute, clear, delete, block ----
// Each person's choices are theirs alone -- the other side never sees that they muted, cleared or deleted.

const MUTE_DURATIONS_MS: Record<string, number> = { '8h': 8 * 60 * 60 * 1000, '1w': 7 * 24 * 60 * 60 * 1000 };

async function updateSettings(actorId: string, conversationId: string, set: Record<string, unknown>): Promise<IChatSettingsView> {
  const row = await DirectChatSettings.findOneAndUpdate(
    { userId: new Types.ObjectId(actorId), conversationId: new Types.ObjectId(conversationId) },
    { $set: set },
    { upsert: true, new: true },
  ).lean();

  return row as unknown as IChatSettingsView;
}

async function markAllRead(actorId: string, conversationId: string): Promise<number> {
  const now = new Date();
  const result = await DirectMessage.updateMany(
    { conversationId: new Types.ObjectId(conversationId), recipientId: new Types.ObjectId(actorId), readAt: null },
    [ { $set: { readAt: now, deliveredAt: { $ifNull: [ '$deliveredAt', now ] } } } ],
  );

  await Notification.updateMany(
    { userId: new Types.ObjectId(actorId), type: 'CHAT_MESSAGE', isRead: false, actionUrl: `/dashboard?tab=chats&chat=${conversationId}` },
    { $set: { isRead: true } },
  ).catch(() => undefined);

  return result.modifiedCount;
}

const publishSettings = (actorId: string, conversationId: string, settings: IChatSettingsView): void =>
  publishToUser(actorId, { type: 'settings', conversationId, mutedUntil: mutedUntilIso(settings), blockedByMe: Boolean(settings.blocked) });

/** duration: '8h' | '1w' | 'always' | 'off' (unmute). */
export async function setMute(actorId: string, conversationId: string, duration: unknown): Promise<IServiceResult> {
  if (duration !== 'off' && duration !== 'always' && !(typeof duration === 'string' && MUTE_DURATIONS_MS[duration])) {
    return fail(400, 'Choose how long to mute: 8 hours, 1 week or always.', 'INVALID_DURATION');
  }

  try {
    if (!(await loadConversationForActor(actorId, conversationId))) return fail(404, 'Chat not found.', 'CHAT_NOT_FOUND');

    const mutedUntil = duration === 'off' ? null : duration === 'always' ? MUTE_FOREVER : new Date(Date.now() + MUTE_DURATIONS_MS[duration as string]);
    const settings = await updateSettings(actorId, conversationId, { mutedUntil });

    publishSettings(actorId, conversationId, settings);
    publishToUser(actorId, { type: 'unread', conversationId, unreadCount: (await unreadByConversation(actorId)).get(conversationId) || 0, totalUnread: await getTotalUnread(actorId) });

    return { body: { ok: true, mutedUntil: mutedUntilIso(settings) }, httpStatus: 200 };
  } catch (error: any) {
    console.error('[DirectChat] mute failed:', error.message);

    return fail(500, 'Could not change notifications for this chat. Please try again.', 'MUTE_FAILED');
  }
}

/** Empties the chat for this person only (the other person keeps their copy). */
export async function clearChat(actorId: string, conversationId: string): Promise<IServiceResult> {
  try {
    if (!(await loadConversationForActor(actorId, conversationId))) return fail(404, 'Chat not found.', 'CHAT_NOT_FOUND');

    await updateSettings(actorId, conversationId, { clearedAt: new Date() });
    await markAllRead(actorId, conversationId);
    publishToUser(actorId, { type: 'cleared', conversationId });
    publishToUser(actorId, { type: 'unread', conversationId, unreadCount: 0, totalUnread: await getTotalUnread(actorId) });

    return { body: { ok: true }, httpStatus: 200 };
  } catch (error: any) {
    console.error('[DirectChat] clear failed:', error.message);

    return fail(500, 'Could not clear this chat. Please try again.', 'CLEAR_FAILED');
  }
}

/** Removes the chat from this person's list (and empties it); it comes back if the other person writes again. */
export async function deleteChat(actorId: string, conversationId: string): Promise<IServiceResult> {
  try {
    if (!(await loadConversationForActor(actorId, conversationId))) return fail(404, 'Chat not found.', 'CHAT_NOT_FOUND');

    const now = new Date();

    await updateSettings(actorId, conversationId, { clearedAt: now, hiddenAt: now });
    await markAllRead(actorId, conversationId);
    publishToUser(actorId, { type: 'removed', conversationId });
    publishToUser(actorId, { type: 'unread', conversationId, unreadCount: 0, totalUnread: await getTotalUnread(actorId) });

    return { body: { ok: true }, httpStatus: 200 };
  } catch (error: any) {
    console.error('[DirectChat] delete failed:', error.message);

    return fail(500, 'Could not delete this chat. Please try again.', 'DELETE_FAILED');
  }
}

/** While blocked, neither person can message or call the other in this chat. */
export async function setBlocked(actorId: string, conversationId: string, blocked: unknown): Promise<IServiceResult> {
  if (typeof blocked !== 'boolean') return fail(400, 'Say whether to block or unblock.', 'INVALID_BLOCK');

  try {
    if (!(await loadConversationForActor(actorId, conversationId))) return fail(404, 'Chat not found.', 'CHAT_NOT_FOUND');

    const settings = await updateSettings(actorId, conversationId, { blocked });

    publishSettings(actorId, conversationId, settings);

    return { body: { ok: true, blockedByMe: blocked }, httpStatus: 200 };
  } catch (error: any) {
    console.error('[DirectChat] block failed:', error.message);

    return fail(500, 'Could not update the block. Please try again.', 'BLOCK_FAILED');
  }
}

import mongoose, { Types } from 'mongoose';
import { DirectConversation } from '../models/DirectConversation';
import { DirectChatSettings } from '../models/DirectChatSettings';
import { DirectMessage, directMessageStatus } from '../models/DirectMessage';

// Helpers shared by the chat service (directChat.service.ts) and the call logic (directChat.calls.ts).
export interface IServiceResult<T = any> {
  body: T;
  httpStatus: number;
}

export const fail = (httpStatus: number, error: string, code: string, extra: Record<string, unknown> = {}): IServiceResult =>
  ({ body: { error, code, ...extra }, httpStatus });

export interface IPeer {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export const toPeer = (user: any): IPeer => ({
  id: String(user._id),
  name: user.fullName || 'Toowix user',
  avatarUrl: user.avatarUrl || null,
});

/** How long a call rings before it counts as missed. Read at call time so tests (and ops) can change it. */
export const ringMs = (): number => Math.max(100, parseInt(process.env.DIRECT_CALL_RING_MS || '45000', 10) || 45_000);
// A ringing call whose timer was lost (server restarted) is still shown as missed once this much longer has passed.
const STALE_GRACE_MS = 15_000;

export const effectiveCallStatus = (message: any): string => {
  const status = message?.call?.status;

  if (status === 'ringing' && Date.now() - new Date(message.createdAt).getTime() > ringMs() + STALE_GRACE_MS) return 'missed';

  return status;
};

export const serializeMessage = (message: any) => ({
  id: String(message._id),
  conversationId: String(message.conversationId),
  senderId: String(message.senderId),
  recipientId: String(message.recipientId),
  text: message.text,
  kind: message.kind === 'call' ? 'call' : 'text',
  ...(message.kind === 'call' && message.call ? { call: { mode: message.call.mode, status: effectiveCallStatus(message) } } : {}),
  clientId: message.clientId ?? null,
  createdAt: new Date(message.createdAt).toISOString(),
  status: directMessageStatus(message),
});

export const otherParticipant = (conversation: any, actorId: string): string =>
  String((conversation.participants || []).find((id: any) => String(id) !== String(actorId)) ?? '');

export async function loadConversationForActor(actorId: string, conversationId: string): Promise<any | null> {
  if (!mongoose.isValidObjectId(conversationId)) return null;

  // Not a participant is answered exactly like "does not exist": never reveal other people's chats.
  return DirectConversation.findOne({ _id: conversationId, participants: new Types.ObjectId(actorId) }).lean();
}

// ---- this person's own settings for a chat ----

export interface IChatSettingsView {
  mutedUntil: Date | null;
  clearedAt: Date | null;
  hiddenAt: Date | null;
  blocked: boolean;
}

const EMPTY_SETTINGS: IChatSettingsView = { mutedUntil: null, clearedAt: null, hiddenAt: null, blocked: false };

export async function getSettingsMap(userId: string): Promise<Map<string, IChatSettingsView>> {
  const rows = await DirectChatSettings.find({ userId: new Types.ObjectId(userId) }).lean();

  return new Map(rows.map((row: any) => [ String(row.conversationId), row as IChatSettingsView ]));
}

export async function getSettings(userId: string, conversationId: string): Promise<IChatSettingsView> {
  const row = await DirectChatSettings.findOne({ userId: new Types.ObjectId(userId), conversationId: new Types.ObjectId(conversationId) }).lean();

  return (row as IChatSettingsView | null) || EMPTY_SETTINGS;
}

export const isMuted = (settings: IChatSettingsView | undefined): boolean => Boolean(settings?.mutedUntil && new Date(settings.mutedUntil).getTime() > Date.now());

export const mutedUntilIso = (settings: IChatSettingsView | undefined): string | null =>
  isMuted(settings) ? new Date(settings!.mutedUntil as Date).toISOString() : null;

export type BlockState = 'none' | 'by_me' | 'by_peer';

export async function blockState(actorId: string, peerId: string, conversationId: string): Promise<BlockState> {
  const rows: any[] = await DirectChatSettings.find({
    conversationId: new Types.ObjectId(conversationId),
    blocked: true,
    userId: { $in: [ new Types.ObjectId(actorId), new Types.ObjectId(peerId) ] },
  }).select('userId').lean();

  if (rows.some((row) => String(row.userId) === String(actorId))) return 'by_me';
  if (rows.length > 0) return 'by_peer';

  return 'none';
}

// ---- unread counts ----

export async function unreadByConversation(userId: string): Promise<Map<string, number>> {
  const rows = await DirectMessage.aggregate([
    { $match: { recipientId: new Types.ObjectId(userId), readAt: null } },
    { $group: { _id: '$conversationId', count: { $sum: 1 } } },
  ]);

  return new Map(rows.map((row: any) => [ String(row._id), Number(row.count) ]));
}

/** Total unread across chats, not counting muted chats (their badge is quiet, like WhatsApp). */
export async function getTotalUnread(userId: string): Promise<number> {
  const [ unread, settings ] = await Promise.all([ unreadByConversation(userId), getSettingsMap(userId) ]);
  let total = 0;

  for (const [ conversationId, count ] of unread) {
    if (!isMuted(settings.get(conversationId))) total += count;
  }

  return total;
}

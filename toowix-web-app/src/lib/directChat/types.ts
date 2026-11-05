export type ChatMessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface ChatPeer {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface ChatSearchResult extends ChatPeer {
  emailHint: string;
}

export type ChatCallMode = 'voice' | 'video';
export type ChatCallStatus = 'ringing' | 'answered' | 'declined' | 'missed' | 'cancelled';

export interface ChatMessage {
  id: string;
  // Present for messages this browser sent: lets a retried send, the server's answer and the live
  // echo from the stream all be recognised as the SAME message (never a duplicate bubble).
  clientId: string | null;
  conversationId: string;
  senderId: string;
  recipientId: string;
  text: string;
  // 'call' entries are the voice/video call lines in a chat ("Missed voice call"); absent means plain text.
  kind?: 'text' | 'call';
  call?: { mode: ChatCallMode; status: ChatCallStatus };
  createdAt: string;
  status: ChatMessageStatus;
}

export interface ChatLastMessage {
  id: string;
  text: string;
  senderId: string;
  at: string;
  status?: ChatMessageStatus;
}

export interface ChatConversation {
  id: string;
  peer: ChatPeer;
  lastMessage: ChatLastMessage | null;
  unreadCount: number;
  // This person's own choices for the chat (never visible to the other side).
  mutedUntil?: string | null;
  blockedByMe?: boolean;
  updatedAt: string;
}

export interface ChatState {
  conversations: ChatConversation[];
  messages: Record<string, ChatMessage[]>;
  hasMore: Record<string, boolean>;
  totalUnread: number;
}

/** Events pushed by GET /api/direct-chat/stream. */
export type ChatStreamEvent =
  | { type: 'ready'; totalUnread: number }
  | { type: 'message'; conversationId: string; message: ChatMessage; peer: ChatPeer; unreadCount: number; totalUnread: number }
  | { type: 'delivered'; conversationId: string; messageIds: string[]; at: string }
  | { type: 'read'; conversationId: string; readerId: string; at: string }
  | { type: 'unread'; conversationId: string; unreadCount: number; totalUnread: number }
  | { type: 'callIncoming'; conversationId: string; callId: string; mode: ChatCallMode; roomSlug: string; peer: ChatPeer }
  | { type: 'callUpdate'; conversationId: string; message: ChatMessage }
  | { type: 'settings'; conversationId: string; mutedUntil: string | null; blockedByMe: boolean }
  | { type: 'cleared'; conversationId: string }
  | { type: 'removed'; conversationId: string };

/** A call that is ringing for this person right now. */
export interface IncomingCall {
  callId: string;
  conversationId: string;
  mode: ChatCallMode;
  roomSlug: string;
  peer: ChatPeer;
}

/** A call this person started and is waiting on. */
export interface OutgoingCall {
  callId: string;
  conversationId: string;
  mode: ChatCallMode;
  roomSlug: string;
  peer: ChatPeer;
}

export type MuteDuration = '8h' | '1w' | 'always' | 'off';

export const MAX_MESSAGE_LENGTH = 4000;

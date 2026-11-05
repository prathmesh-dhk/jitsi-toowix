import type { ChatConversation, ChatMessage, ChatMessageStatus, ChatState, ChatStreamEvent } from './types';

// The whole client-side chat model as one pure reducer: no React, no network, no clock. Everything the
// screen shows (the chat list order, unread badges, message bubbles, the ticks) is a function of this
// state, which is what makes the behaviour testable without a browser.
export const initialChatState: ChatState = { conversations: [], messages: {}, hasMore: {}, totalUnread: 0 };

export type ChatAction =
  | { type: 'conversationsLoaded'; conversations: ChatConversation[]; totalUnread: number }
  | { type: 'conversationOpened'; conversation: ChatConversation }
  | { type: 'messagesLoaded'; conversationId: string; messages: ChatMessage[]; hasMore: boolean }
  | { type: 'optimisticSend'; message: ChatMessage }
  | { type: 'sendSucceeded'; clientId: string; message: ChatMessage }
  | { type: 'sendFailed'; conversationId: string; clientId: string }
  | { type: 'sendRetrying'; conversationId: string; clientId: string }
  | { type: 'stream'; event: ChatStreamEvent; meId: string }
  | { type: 'markedRead'; conversationId: string; totalUnread: number };

const STATUS_RANK: Record<ChatMessageStatus, number> = { failed: 0, pending: 0, sent: 1, delivered: 2, read: 3 };

/** A status only ever moves forward (sent -> delivered -> read); a late, out-of-order event can't undo a tick. */
export const advanceStatus = (current: ChatMessageStatus, next: ChatMessageStatus): ChatMessageStatus =>
  STATUS_RANK[next] > STATUS_RANK[current] ? next : current;

const byTime = (a: ChatMessage, b: ChatMessage): number => {
  const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();

  return diff !== 0 ? diff : a.id.localeCompare(b.id);
};

/** Merges messages by id (and by clientId, so a local pending bubble and the server copy are one). */
export function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const merged: ChatMessage[] = [ ...existing ];

  for (const message of incoming) {
    const index = merged.findIndex((m) => m.id === message.id || (message.clientId && m.clientId === message.clientId));

    if (index === -1) {
      merged.push(message);
    } else {
      const current = merged[index];

      merged[index] = { ...message, status: advanceStatus(current.status === 'failed' ? 'pending' : current.status, message.status) };
    }
  }

  return merged.sort(byTime);
}

const sortConversations = (list: ChatConversation[]): ChatConversation[] =>
  [ ...list ].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

const withConversation = (state: ChatState, id: string, change: (c: ChatConversation) => ChatConversation): ChatState => ({
  ...state,
  conversations: state.conversations.map((c) => (c.id === id ? change(c) : c)),
});

const setLastMessage = (conversation: ChatConversation, message: ChatMessage): ChatConversation => ({
  ...conversation,
  lastMessage: { id: message.id, text: message.text, senderId: message.senderId, at: message.createdAt, status: message.status },
  updatedAt: message.createdAt,
});

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'conversationsLoaded': {
      const serverIds = new Set(action.conversations.map((c) => c.id));
      // A chat the user just opened has no message yet, so the server does not list it; keep it until
      // the first message is sent instead of making it vanish on the next refresh.
      const drafts = state.conversations.filter((c) => !c.lastMessage && !serverIds.has(c.id));

      return { ...state, conversations: [ ...sortConversations(action.conversations), ...drafts ], totalUnread: action.totalUnread };
    }

    case 'conversationOpened': {
      if (state.conversations.some((c) => c.id === action.conversation.id)) {
        return withConversation(state, action.conversation.id, (c) => ({ ...c, peer: action.conversation.peer }));
      }

      return { ...state, conversations: [ action.conversation, ...state.conversations ] };
    }

    case 'messagesLoaded': {
      const merged = mergeMessages(state.messages[action.conversationId] || [], action.messages);

      return {
        ...state,
        messages: { ...state.messages, [action.conversationId]: merged },
        hasMore: { ...state.hasMore, [action.conversationId]: action.hasMore },
      };
    }

    case 'optimisticSend': {
      const { message } = action;
      const withMessage: ChatState = {
        ...state,
        messages: { ...state.messages, [message.conversationId]: mergeMessages(state.messages[message.conversationId] || [], [ message ]) },
      };
      const updated = withConversation(withMessage, message.conversationId, (c) => setLastMessage(c, message));

      return { ...updated, conversations: sortConversations(updated.conversations) };
    }

    case 'sendSucceeded': {
      const list = state.messages[action.message.conversationId] || [];
      const replaced = list.some((m) => m.clientId === action.clientId)
        ? list.map((m) => (m.clientId === action.clientId ? { ...action.message, clientId: action.clientId, status: advanceStatus(m.status === 'pending' || m.status === 'failed' ? 'sent' : m.status, action.message.status) } : m))
        : mergeMessages(list, [ action.message ]);
      const next: ChatState = { ...state, messages: { ...state.messages, [action.message.conversationId]: replaced.sort(byTime) } };

      return withConversation(next, action.message.conversationId, (c) => (
        c.lastMessage && c.lastMessage.at > action.message.createdAt ? c : setLastMessage(c, action.message)
      ));
    }

    case 'sendFailed':
    case 'sendRetrying': {
      const status: ChatMessageStatus = action.type === 'sendFailed' ? 'failed' : 'pending';
      const list = (state.messages[action.conversationId] || []).map((m) => (
        m.clientId === action.clientId && (m.status === 'pending' || m.status === 'failed') ? { ...m, status } : m
      ));

      return { ...state, messages: { ...state.messages, [action.conversationId]: list } };
    }

    case 'markedRead':
      return { ...withConversation(state, action.conversationId, (c) => ({ ...c, unreadCount: 0 })), totalUnread: action.totalUnread };

    case 'stream':
      return applyStreamEvent(state, action.event, action.meId);

    default:
      return state;
  }
}

function applyStreamEvent(state: ChatState, event: ChatStreamEvent, meId: string): ChatState {
  switch (event.type) {
    case 'ready':
      return { ...state, totalUnread: event.totalUnread };

    case 'message': {
      const { message } = event;
      const mine = message.senderId === meId;
      const known = state.conversations.some((c) => c.id === event.conversationId);
      const conversation: ChatConversation = {
        id: event.conversationId,
        peer: event.peer,
        lastMessage: null,
        unreadCount: 0,
        updatedAt: message.createdAt,
      };
      const base: ChatState = known ? state : { ...state, conversations: [ conversation, ...state.conversations ] };
      const withMessage: ChatState = {
        ...base,
        messages: { ...base.messages, [event.conversationId]: mergeMessages(base.messages[event.conversationId] || [], [ message ]) },
        totalUnread: event.totalUnread,
      };
      const updated = withConversation(withMessage, event.conversationId, (c) => ({
        ...setLastMessage(c, message),
        peer: event.peer,
        // The server's count is the truth; for my own message (echoed from another tab) there is no unread.
        unreadCount: mine ? c.unreadCount : event.unreadCount,
      }));

      return { ...updated, conversations: sortConversations(updated.conversations) };
    }

    case 'delivered': {
      const ids = new Set(event.messageIds);
      const list = (state.messages[event.conversationId] || []).map((m) => (ids.has(m.id) ? { ...m, status: advanceStatus(m.status, 'delivered') } : m));
      const next: ChatState = { ...state, messages: { ...state.messages, [event.conversationId]: list } };

      return withConversation(next, event.conversationId, (c) => (
        c.lastMessage && ids.has(c.lastMessage.id)
          ? { ...c, lastMessage: { ...c.lastMessage, status: advanceStatus(c.lastMessage.status || 'sent', 'delivered') } }
          : c
      ));
    }

    case 'read': {
      // The OTHER person read the chat: every message I sent in it is now read (blue ticks).
      const list = (state.messages[event.conversationId] || []).map((m) => (m.senderId === meId ? { ...m, status: advanceStatus(m.status, 'read') } : m));
      const next: ChatState = { ...state, messages: { ...state.messages, [event.conversationId]: list } };

      return withConversation(next, event.conversationId, (c) => (
        c.lastMessage && c.lastMessage.senderId === meId
          ? { ...c, lastMessage: { ...c.lastMessage, status: advanceStatus(c.lastMessage.status || 'sent', 'read') } }
          : c
      ));
    }

    case 'unread':
      return { ...withConversation(state, event.conversationId, (c) => ({ ...c, unreadCount: event.unreadCount })), totalUnread: event.totalUnread };

    case 'callUpdate': {
      // The call line in the chat changes in place (Calling... -> Answered / Declined / Missed).
      const list = (state.messages[event.conversationId] || []).map((m) => (m.id === event.message.id ? { ...m, call: event.message.call } : m));

      return { ...state, messages: { ...state.messages, [event.conversationId]: list } };
    }

    case 'settings':
      return withConversation(state, event.conversationId, (c) => ({ ...c, mutedUntil: event.mutedUntil, blockedByMe: event.blockedByMe }));

    case 'cleared': {
      const emptied = withConversation({ ...state, messages: { ...state.messages, [event.conversationId]: [] }, hasMore: { ...state.hasMore, [event.conversationId]: false } }, event.conversationId, (c) => ({ ...c, lastMessage: null, unreadCount: 0 }));

      return emptied;
    }

    case 'removed': {
      const { [event.conversationId]: _messages, ...messages } = state.messages;
      const { [event.conversationId]: _more, ...hasMore } = state.hasMore;

      return { ...state, conversations: state.conversations.filter((c) => c.id !== event.conversationId), messages, hasMore };
    }

    default:
      return state;
  }
}

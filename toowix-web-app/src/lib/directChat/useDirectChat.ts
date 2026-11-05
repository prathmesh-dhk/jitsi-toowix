import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { playCallRingTone, playChatMessageTone } from '../notificationSounds';
import {
  CHAT_STREAM_URL, chatHeaders, ChatApiError, deleteChatRequest, fetchConversations, fetchMessages, openChatWith, postAcceptCall, postBlock,
  postCancelCall, postClearChat, postDeclineCall, postMessage, postMute, postRead, postStartCall,
} from './api';
import { newClientId } from './format';
import { startChatStream, type StreamStatus } from './sse';
import { chatReducer, initialChatState } from './state';
import {
  MAX_MESSAGE_LENGTH, type ChatCallMode, type ChatConversation, type ChatMessage, type ChatPeer, type ChatStreamEvent, type IncomingCall, type MuteDuration, type OutgoingCall,
} from './types';

export interface IChatToast {
  id: string;
  conversationId: string;
  peer: ChatPeer;
  text: string;
}

interface IOptions {
  /** Start the live connection only once the user is signed in. */
  enabled: boolean;
  meId: string;
  /** True while the Chats screen is actually on screen (so a message in the open chat counts as read). */
  panelVisible: boolean;
  /** Called when a call is answered, with the meeting room to go to. The dashboard navigates there. */
  onJoinCall?: (roomSlug: string, mode: ChatCallMode) => void;
}

/** True while a chat's notifications are muted (a mute has an end time; "always" is the year 9999). */
export const isChatMuted = (conversation: Pick<ChatConversation, 'mutedUntil'> | null | undefined, now: number = Date.now()): boolean =>
  Boolean(conversation?.mutedUntil && new Date(conversation.mutedUntil).getTime() > now);

const RING_REPEAT_MS = 2500;

const TOAST_LIMIT = 3;
const isWindowActive = (): boolean => typeof document !== 'undefined' && document.visibilityState === 'visible' && document.hasFocus();

export function useDirectChat({ enabled, meId, panelVisible, onJoinCall }: IOptions) {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const [status, setStatus] = useState<StreamStatus>('connecting');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<IChatToast[]>([]);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [outgoingCall, setOutgoingCall] = useState<OutgoingCall | null>(null);
  const [callNotice, setCallNotice] = useState<string | null>(null);
  const [menuBusy, setMenuBusy] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  );

  // Latest values for callbacks that outlive a render (the stream handler, timers).
  const live = useRef({ state, activeId, panelVisible, meId, incomingCall, outgoingCall, onJoinCall });

  live.current = { state, activeId, panelVisible, meId, incomingCall, outgoingCall, onJoinCall };
  const markingRead = useRef<Set<string>>(new Set());

  // ---- reading ----

  const markRead = useCallback(async (conversationId: string, optimisticTotal?: number) => {
    if (markingRead.current.has(conversationId)) return;
    markingRead.current.add(conversationId);
    if (optimisticTotal !== undefined) dispatch({ type: 'markedRead', conversationId, totalUnread: optimisticTotal });
    try {
      const result = await postRead(conversationId);

      dispatch({ type: 'markedRead', conversationId, totalUnread: result.totalUnread });
    } catch {
      // Not fatal: the next incoming message, focus change or reconnect retries it.
    } finally {
      markingRead.current.delete(conversationId);
    }
  }, []);

  // ---- loading ----

  const loadConversations = useCallback(async () => {
    setListLoading(true);
    try {
      const result = await fetchConversations();

      dispatch({ type: 'conversationsLoaded', conversations: result.conversations, totalUnread: result.totalUnread });
      setListError(null);
    } catch (error) {
      setListError(error instanceof ChatApiError ? error.message : 'Could not load your chats.');
    } finally {
      setListLoading(false);
    }
  }, []);

  const loadMessages = useCallback(async (conversationId: string, before?: string) => {
    setMessagesLoading(true);
    try {
      const result = await fetchMessages(conversationId, before);

      dispatch({ type: 'messagesLoaded', conversationId, messages: result.messages, hasMore: result.hasMore });
    } catch (error) {
      setSendError(error instanceof ChatApiError ? error.message : 'Could not load this chat.');
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  // ---- incoming live events ----

  const notifyIncoming = useCallback((event: Extract<ChatStreamEvent, { type: 'message' }>) => {
    const { conversationId, peer, message } = event;

    setToasts((previous) => [
      { id: message.id, conversationId, peer, text: message.text },
      ...previous.filter((toast) => toast.conversationId !== conversationId),
    ].slice(0, TOAST_LIMIT));
    playChatMessageTone();

    if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && !isWindowActive()) {
      try {
        // `tag` makes a burst from one person replace itself instead of stacking.
        const shown = new Notification(peer.name, { body: message.text.slice(0, 140), tag: `toowix-chat-${conversationId}`, icon: peer.avatarUrl || undefined });

        shown.onclick = () => { window.focus(); shown.close(); };
      } catch {
        // some browsers only allow notifications from a service worker; the toast and badge still work
      }
    }
  }, []);

  const handleStreamEvent = useCallback((event: ChatStreamEvent) => {
    const current = live.current;

    dispatch({ type: 'stream', event, meId: current.meId });

    if (event.type === 'callIncoming') {
      setIncomingCall({ callId: event.callId, conversationId: event.conversationId, mode: event.mode, roomSlug: event.roomSlug, peer: event.peer });

      return;
    }
    if (event.type === 'callUpdate') {
      const callId = event.message.id;
      const status = event.message.call?.status;

      // Whoever else answered / hung up / timed out: the ringing stops here too.
      setIncomingCall((c) => (c && c.callId === callId ? null : c));
      const out = current.outgoingCall;

      if (out && out.callId === callId && status && status !== 'ringing') {
        setOutgoingCall(null);
        if (status === 'answered') current.onJoinCall?.(out.roomSlug, out.mode);
        else if (status === 'declined') setCallNotice(`${out.peer.name} declined the call.`);
        else if (status === 'missed') setCallNotice(`${out.peer.name} did not answer.`);
      }

      return;
    }
    if (event.type !== 'message' || event.message.senderId === current.meId) return;

    const watching = current.panelVisible && current.activeId === event.conversationId && isWindowActive();

    if (watching) {
      // The person is looking at this very chat: it is read the moment it arrives.
      void markRead(event.conversationId, Math.max(0, event.totalUnread - event.unreadCount));
    } else if (event.message.kind !== 'call' && !isChatMuted(current.state.conversations.find((c) => c.id === event.conversationId))) {
      // Calls ring (see callIncoming) instead of toasting, and a muted chat stays quiet.
      notifyIncoming(event);
    }
  }, [markRead, notifyIncoming]);

  // ---- the live connection ----

  useEffect(() => {
    if (!enabled || !meId) return undefined;
    let firstOpen = true;

    void loadConversations();

    const stop = startChatStream({
      url: CHAT_STREAM_URL,
      getHeaders: chatHeaders,
      onEvent: handleStreamEvent,
      onStatus: setStatus,
      onOpen: () => {
        // After a reconnect, anything that happened while offline is fetched again (merged, never duplicated).
        if (firstOpen) { firstOpen = false; return; }
        void loadConversations();
        if (live.current.activeId) void loadMessages(live.current.activeId);
      },
    });

    return stop;
  }, [enabled, meId, handleStreamEvent, loadConversations, loadMessages]);

  // ---- tab title badge: "(3) Toowix Meet" ----

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const base = document.title.replace(/^\(\d+\+?\)\s*/, '');

    document.title = state.totalUnread > 0 ? `(${state.totalUnread > 99 ? '99+' : state.totalUnread}) ${base}` : base;

    return () => { document.title = base; };
  }, [state.totalUnread]);

  // ---- opening a chat ----

  useEffect(() => {
    if (!activeId || !panelVisible) return;
    if (!live.current.state.messages[activeId]) void loadMessages(activeId);
  }, [activeId, panelVisible, loadMessages]);

  const activeUnread = state.conversations.find((c) => c.id === activeId)?.unreadCount || 0;

  useEffect(() => {
    if (activeId && panelVisible && activeUnread > 0 && isWindowActive()) void markRead(activeId);
  }, [activeId, panelVisible, activeUnread, markRead]);

  // Coming back to the tab/window marks the open chat read.
  useEffect(() => {
    const onFocus = () => {
      const { activeId: id, panelVisible: visible, state: s } = live.current;

      if (id && visible && (s.conversations.find((c) => c.id === id)?.unreadCount || 0) > 0 && isWindowActive()) void markRead(id);
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);

    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [markRead]);

  // ---- actions ----

  const selectConversation = useCallback((id: string | null) => {
    setActiveId(id);
    setSendError(null);
    if (id) setToasts((previous) => previous.filter((toast) => toast.conversationId !== id));
  }, []);

  /** Opens (creating if needed) the chat with someone chosen from search, and shows it. */
  const startChatWith = useCallback(async (peer: ChatPeer): Promise<boolean> => {
    setSendError(null);
    try {
      const result = await openChatWith(peer.id);

      dispatch({ type: 'conversationOpened', conversation: result.conversation });
      selectConversation(result.conversation.id);

      return true;
    } catch (error) {
      setSendError(error instanceof ChatApiError ? error.message : 'Could not open this chat.');

      return false;
    }
  }, [selectConversation]);

  const deliver = useCallback(async (conversationId: string, text: string, clientId: string) => {
    try {
      const result = await postMessage(conversationId, text, clientId);

      dispatch({ type: 'sendSucceeded', clientId, message: result.message });
      setSendError(null);
    } catch (error) {
      dispatch({ type: 'sendFailed', conversationId, clientId });
      setSendError(error instanceof ChatApiError ? error.message : 'Your message could not be sent.');
    }
  }, []);

  /** Sends to the open chat. Returns false (and sends nothing) for an empty or too-long message. */
  const send = useCallback((rawText: string): boolean => {
    const { activeId: conversationId, state: s, meId: me } = live.current;
    const text = rawText.replace(/\r\n/g, '\n').trim();

    if (!conversationId || !text) return false;
    if (text.length > MAX_MESSAGE_LENGTH) {
      setSendError(`Messages can be at most ${MAX_MESSAGE_LENGTH} characters.`);

      return false;
    }
    const peer = s.conversations.find((c) => c.id === conversationId)?.peer;

    if (!peer) return false;

    const clientId = newClientId();
    const message: ChatMessage = {
      id: `local-${clientId}`, clientId, conversationId, senderId: me, recipientId: peer.id,
      text, createdAt: new Date().toISOString(), status: 'pending',
    };

    dispatch({ type: 'optimisticSend', message });
    void deliver(conversationId, text, clientId);

    return true;
  }, [deliver]);

  /** Re-sends a failed message with the SAME client id, so even if the first try actually arrived it is not doubled. */
  const retry = useCallback((conversationId: string, clientId: string) => {
    const message = live.current.state.messages[conversationId]?.find((m) => m.clientId === clientId);

    if (!message || message.status !== 'failed') return;
    dispatch({ type: 'sendRetrying', conversationId, clientId });
    void deliver(conversationId, message.text, clientId);
  }, [deliver]);

  const loadOlder = useCallback(() => {
    const { activeId: id, state: s } = live.current;
    const oldest = id ? s.messages[id]?.find((m) => !m.id.startsWith('local-')) : undefined;

    if (id && oldest && s.hasMore[id]) void loadMessages(id, oldest.createdAt);
  }, [loadMessages]);

  const dismissToast = useCallback((id: string) => setToasts((previous) => previous.filter((toast) => toast.id !== id)), []);

  const requestNotifications = useCallback(async () => {
    if (typeof Notification === 'undefined') return;
    try {
      setPermission(await Notification.requestPermission());
    } catch {
      setPermission(Notification.permission);
    }
  }, []);

  // ---- calls ----

  // The ring repeats while a call is incoming or outgoing.
  useEffect(() => {
    if (!incomingCall && !outgoingCall) return undefined;
    playCallRingTone();
    const timer = window.setInterval(playCallRingTone, RING_REPEAT_MS);

    return () => window.clearInterval(timer);
  }, [incomingCall, outgoingCall]);

  const startCall = useCallback(async (mode: ChatCallMode): Promise<boolean> => {
    const { activeId: conversationId, state: s, outgoingCall: ongoing } = live.current;
    const peer = s.conversations.find((c) => c.id === conversationId)?.peer;

    if (!conversationId || !peer || ongoing) return false;
    setSendError(null);
    setCallNotice(null);
    try {
      const result = await postStartCall(conversationId, mode);

      if (result.ringing) setOutgoingCall({ callId: result.callId, conversationId, mode, roomSlug: result.roomSlug, peer });
      else setCallNotice(`${peer.name} is not online right now. They will see a missed call.`);

      return true;
    } catch (error) {
      setSendError(error instanceof ChatApiError ? error.message : 'Could not start the call.');

      return false;
    }
  }, []);

  const answerCall = useCallback(async () => {
    const call = live.current.incomingCall;

    if (!call) return;
    try {
      const result = await postAcceptCall(call.callId);

      setIncomingCall(null);
      live.current.onJoinCall?.(result.roomSlug, result.mode);
    } catch (error) {
      setIncomingCall(null);
      setCallNotice(error instanceof ChatApiError ? error.message : 'Could not answer the call.');
    }
  }, []);

  const declineCall = useCallback(async () => {
    const call = live.current.incomingCall;

    if (!call) return;
    setIncomingCall(null);
    try {
      await postDeclineCall(call.callId);
    } catch {
      // The call times out on its own if this did not reach the server.
    }
  }, []);

  const cancelOutgoingCall = useCallback(async () => {
    const call = live.current.outgoingCall;

    if (!call) return;
    setOutgoingCall(null);
    try {
      await postCancelCall(call.callId);
    } catch {
      // It becomes a missed call by itself after the ring time.
    }
  }, []);

  const dismissCallNotice = useCallback(() => setCallNotice(null), []);

  // ---- the three-dot menu ----

  const runMenuAction = useCallback(async (action: (conversationId: string) => Promise<unknown>, failure: string): Promise<boolean> => {
    const conversationId = live.current.activeId;

    if (!conversationId) return false;
    setMenuBusy(true);
    setSendError(null);
    try {
      await action(conversationId);

      return true;
    } catch (error) {
      setSendError(error instanceof ChatApiError ? error.message : failure);

      return false;
    } finally {
      setMenuBusy(false);
    }
  }, []);

  const settingsOf = (id: string) => live.current.state.conversations.find((c) => c.id === id);

  const muteChat = useCallback((duration: MuteDuration) => runMenuAction(async (id) => {
    const result = await postMute(id, duration);

    dispatch({ type: 'stream', event: { type: 'settings', conversationId: id, mutedUntil: result.mutedUntil, blockedByMe: Boolean(settingsOf(id)?.blockedByMe) }, meId: live.current.meId });
  }, 'Could not change notifications.'), [runMenuAction]);

  const clearChat = useCallback(() => runMenuAction(async (id) => {
    await postClearChat(id);
    dispatch({ type: 'stream', event: { type: 'cleared', conversationId: id }, meId: live.current.meId });
  }, 'Could not clear this chat.'), [runMenuAction]);

  const deleteChat = useCallback(() => runMenuAction(async (id) => {
    await deleteChatRequest(id);
    dispatch({ type: 'stream', event: { type: 'removed', conversationId: id }, meId: live.current.meId });
    setActiveId(null);
  }, 'Could not delete this chat.'), [runMenuAction]);

  const setBlocked = useCallback((blocked: boolean) => runMenuAction(async (id) => {
    const result = await postBlock(id, blocked);

    dispatch({ type: 'stream', event: { type: 'settings', conversationId: id, mutedUntil: settingsOf(id)?.mutedUntil ?? null, blockedByMe: result.blockedByMe }, meId: live.current.meId });
  }, 'Could not update the block.'), [runMenuAction]);

  const active = useMemo(() => state.conversations.find((c) => c.id === activeId) || null, [state.conversations, activeId]);

  return {
    state,
    status,
    active,
    activeId,
    activeMessages: activeId ? state.messages[activeId] || [] : [],
    hasMoreOlder: activeId ? Boolean(state.hasMore[activeId]) : false,
    listLoading,
    listError,
    messagesLoading,
    sendError,
    clearSendError: () => setSendError(null),
    toasts,
    dismissToast,
    permission,
    requestNotifications,
    reloadConversations: loadConversations,
    selectConversation,
    startChatWith,
    send,
    retry,
    loadOlder,
    incomingCall,
    outgoingCall,
    callNotice,
    dismissCallNotice,
    startCall,
    answerCall,
    declineCall,
    cancelOutgoingCall,
    menuBusy,
    muteChat,
    clearChat,
    deleteChat,
    setBlocked,
  };
}

export type DirectChat = ReturnType<typeof useDirectChat>;

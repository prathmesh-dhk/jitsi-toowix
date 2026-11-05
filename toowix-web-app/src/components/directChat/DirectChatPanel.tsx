import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Bell, BellOff, Ban, ChevronDown, ChevronUp, MessageCircle, Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, Search, Send, Video, X } from 'lucide-react';
import { ChatApiError, searchChatUsers } from '../../lib/directChat/api';
import { badgeLabel, buildMessageRows, formatBubbleTime, formatListTime, previewText } from '../../lib/directChat/format';
import { isChatMuted, type DirectChat } from '../../lib/directChat/useDirectChat';
import { MAX_MESSAGE_LENGTH, type ChatConversation, type ChatMessage, type ChatSearchResult } from '../../lib/directChat/types';
import { Avatar, Ticks } from './parts';
import { ChatHeaderActions, ContactInfo } from './ChatHeaderActions';
import './directChat.css';

interface IProps {
  chat: DirectChat;
  isDark: boolean;
  meId: string;
  /** A conversation id from a deep link / notification (?chat=...) to open once the list has loaded. */
  initialChatId?: string;
}

const COUNTER_FROM = 3500;
const isTouchDevice = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

function SkeletonRows() {
  return (
    <>
      {[ 0, 1, 2, 3 ].map((i) => (
        <div className="dc-skeleton" key={i} aria-hidden="true">
          <i style={{ width: 49, height: 49, borderRadius: '50%' }} />
          <span style={{ flex: 1, display: 'grid', gap: 8 }}>
            <i style={{ width: `${55 + i * 8}%`, height: 12 }} />
            <i style={{ width: `${35 + i * 10}%`, height: 10 }} />
          </span>
        </div>
      ))}
    </>
  );
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Wraps every occurrence of the in-chat search term in <mark>. */
function Highlighted({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>;
  const parts = text.split(new RegExp(`(${escapeRegExp(term)})`, 'ig'));

  return <>{parts.map((part, i) => (part.toLowerCase() === term.toLowerCase() ? <mark key={i}>{part}</mark> : part))}</>;
}

/** The body of a call entry in the chat: "Missed voice call" / "Voice call · Answered" with a Call back button. */
function CallLine({ message, mine, onCallBack, disabled }: { message: ChatMessage; mine: boolean; onCallBack: () => void; disabled: boolean }) {
  const mode = message.call?.mode === 'voice' ? 'voice' : 'video';
  const status = message.call?.status || 'ringing';
  const missed = status === 'missed' && !mine;
  const Icon = missed ? PhoneMissed : mine ? PhoneOutgoing : PhoneIncoming;
  const noun = mode === 'voice' ? 'Voice call' : 'Video call';
  const detail = status === 'ringing' ? 'Calling…' : status === 'answered' ? 'Answered' : status === 'declined' ? 'Declined' : status === 'cancelled' ? 'Cancelled' : mine ? 'No answer' : 'Missed';

  return (
    <span className={`dc-callline${missed ? ' dc-callline-missed' : ''}`} data-testid="dc-callline">
      <span className="dc-callline-icon"><Icon size={18} aria-hidden="true" /></span>
      <span className="dc-callline-text">
        <strong>{missed ? `Missed ${mode} call` : noun}</strong>
        <small>{detail}</small>
      </span>
      {status !== 'ringing' && (
        <button type="button" className="dc-callback" disabled={disabled} onClick={onCallBack} aria-label={`Call back (${mode})`}>
          {mode === 'voice' ? <Phone size={14} /> : <Video size={14} />} Call back
        </button>
      )}
    </span>
  );
}

function ChatListItem({ conversation, meId, active, onOpen }: { conversation: ChatConversation; meId: string; active: boolean; onOpen: () => void }) {
  const last = conversation.lastMessage;
  const unread = conversation.unreadCount > 0;
  const mine = Boolean(last && last.senderId === meId);

  return (
    <div role="listitem">
      <button
        type="button"
        className={`dc-item${active ? ' dc-active' : ''}`}
        onClick={onOpen}
        aria-current={active ? 'true' : undefined}
        aria-label={`${conversation.peer.name}${unread ? `, ${conversation.unreadCount} unread` : ''}`}
      >
        <Avatar name={conversation.peer.name} url={conversation.peer.avatarUrl} />
        <span className="dc-item-body">
          <span className="dc-item-top">
            <span className="dc-name">{conversation.peer.name}</span>
            {last && <span className={`dc-time${unread ? ' dc-unread-time' : ''}`}>{formatListTime(last.at)}</span>}
          </span>
          <span className="dc-item-bottom">
            <span className={`dc-preview${unread ? ' dc-unread-preview' : ''}`}>
              {mine && last?.status && <Ticks status={last.status} size={16} />}
              <span>{previewText(conversation, meId)}</span>
            </span>
            {isChatMuted(conversation) && <BellOff size={15} className="dc-muted-icon" aria-label="Muted" role="img" />}
            {unread && <span className={`dc-badge${isChatMuted(conversation) ? ' dc-badge-muted' : ''}`} aria-hidden="true">{badgeLabel(conversation.unreadCount)}</span>}
          </span>
        </span>
      </button>
    </div>
  );
}

export function DirectChatPanel({ chat, isDark, meId, initialChatId }: IProps) {
  const { state, active, activeId, activeMessages } = chat;

  // ---- search inside the open chat + contact info (both belong to one chat; switching chat closes them) ----
  const [findOpen, setFindOpen] = useState(false);
  const [findTerm, setFindTerm] = useState('');
  const [findIndex, setFindIndex] = useState(0);
  const [infoOpen, setInfoOpen] = useState(false);
  const term = findOpen ? findTerm.trim() : '';
  const matchIds = useMemo(
    () => (term ? activeMessages.filter((m) => m.kind !== 'call' && m.text.toLowerCase().includes(term.toLowerCase())).map((m) => m.id) : []),
    [activeMessages, term],
  );
  const currentMatch = matchIds.length > 0 ? matchIds[Math.min(findIndex, matchIds.length - 1)] : null;

  useEffect(() => { setFindOpen(false); setFindTerm(''); setFindIndex(0); setInfoOpen(false); }, [activeId]);
  useEffect(() => { setFindIndex(matchIds.length > 0 ? matchIds.length - 1 : 0); }, [term, matchIds.length]);
  useEffect(() => {
    if (!currentMatch) return;
    scrollRef.current?.querySelector(`[data-mid="${currentMatch}"]`)?.scrollIntoView({ block: 'center' });
  }, [currentMatch]);
  const stepMatch = (direction: 1 | -1) => {
    if (matchIds.length === 0) return;
    setFindIndex((i) => (Math.min(i, matchIds.length - 1) + direction + matchIds.length) % matchIds.length);
  };

  // ---- search ----
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ChatSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const trimmed = query.trim();
  const searchMode = trimmed.length > 0;

  useEffect(() => {
    if (trimmed.length < 2) {
      setResults([]);
      setSearching(false);
      setSearchError(null);

      return undefined;
    }
    setSearching(true);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const found = await searchChatUsers(trimmed, controller.signal);

        setResults(found.users);
        setSearchError(null);
      } catch (error) {
        if ((error as { name?: string })?.name === 'AbortError') return;
        setResults([]);
        setSearchError(error instanceof ChatApiError ? error.message : 'Search failed. Please try again.');
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed]);

  const openPerson = useCallback(async (person: ChatSearchResult) => {
    if (await chat.startChatWith({ id: person.id, name: person.name, avatarUrl: person.avatarUrl })) setQuery('');
  }, [chat]);

  // ---- which chats the left column shows ----
  const listed = useMemo(() => state.conversations.filter((c) => c.lastMessage || c.id === activeId), [state.conversations, activeId]);
  const matchingChats = useMemo(
    () => (searchMode ? listed.filter((c) => c.peer.name.toLowerCase().includes(trimmed.toLowerCase())) : listed),
    [listed, searchMode, trimmed],
  );
  const peopleNotChattedYet = useMemo(() => results, [results]);

  // ---- deep link (?chat=<id>) ----
  const deepLinkHandled = useRef(false);

  useEffect(() => {
    if (!initialChatId || deepLinkHandled.current) return;
    if (state.conversations.some((c) => c.id === initialChatId)) {
      deepLinkHandled.current = true;
      chat.selectConversation(initialChatId);
    } else if (!chat.listLoading && state.conversations.length > 0) {
      deepLinkHandled.current = true;
    }
  }, [initialChatId, state.conversations, chat]);

  // ---- composer (drafts are kept per chat, like WhatsApp) ----
  const [text, setText] = useState('');
  const drafts = useRef<Record<string, string>>({});
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const shownChat = useRef<string | null>(null);

  useEffect(() => {
    if (shownChat.current) drafts.current[shownChat.current] = textRef.current;
    shownChat.current = activeId;
    setText(activeId ? drafts.current[activeId] || '' : '');
    if (activeId && !isTouchDevice()) textareaRef.current?.focus();
  }, [activeId]);

  const textRef = useRef(text);

  textRef.current = text;

  useLayoutEffect(() => {
    const el = textareaRef.current;

    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text, activeId]);

  const submit = useCallback(() => {
    if (chat.send(textRef.current)) {
      setText('');
      if (activeId) drafts.current[activeId] = '';
      if (!isTouchDevice()) textareaRef.current?.focus();
    }
  }, [chat, activeId]);

  // ---- scrolling ----
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const previous = useRef({ id: null as string | null, count: 0, first: '', last: '' });
  const [newBelow, setNewBelow] = useState(0);

  useLayoutEffect(() => {
    const el = scrollRef.current;

    if (!el) return;
    const p = previous.current;
    const first = activeMessages[0]?.id || '';
    const lastMessage = activeMessages[activeMessages.length - 1];
    const last = lastMessage?.id || '';

    if (p.id !== activeId || (p.count === 0 && activeMessages.length > 0)) {
      el.scrollTop = el.scrollHeight;
      stickToBottom.current = true;
      setNewBelow(0);
    } else if (first !== p.first && last === p.last && anchor.current) {
      // Older messages were added above: keep the reader exactly where they were.
      el.scrollTop = el.scrollHeight - anchor.current.height + anchor.current.top;
      anchor.current = null;
    } else if (last !== p.last && lastMessage) {
      if (lastMessage.senderId === meId || stickToBottom.current) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      else setNewBelow((n) => n + 1);
    }
    previous.current = { id: activeId, count: activeMessages.length, first, last };
  }, [activeId, activeMessages, meId]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;

    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;

    stickToBottom.current = nearBottom;
    if (nearBottom) setNewBelow(0);
    if (el.scrollTop < 60 && chat.hasMoreOlder && !chat.messagesLoading && !anchor.current) {
      anchor.current = { height: el.scrollHeight, top: el.scrollTop };
      chat.loadOlder();
    }
  }, [chat]);

  const jumpToLatest = () => {
    const el = scrollRef.current;

    el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setNewBelow(0);
  };

  const rows = useMemo(() => buildMessageRows(activeMessages), [activeMessages]);
  const connectionOk = chat.status === 'open';
  const over = text.length > MAX_MESSAGE_LENGTH;

  return (
    <div className={`dc-root ${isDark ? 'dc-dark' : 'dc-light'}${active ? ' dc-has-active' : ''}`}>
      {/* ===================== left: search + chat list ===================== */}
      <aside className="dc-sidebar" aria-label="Chats">
        <header className="dc-sidebar-header">
          <h2 className="dc-title">Chats</h2>
          <span className="dc-conn" role="status">
            <span className={`dc-conn-dot${connectionOk ? '' : ' dc-off'}`} />
            {connectionOk ? 'Live' : chat.status === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
          </span>
        </header>

        <div className="dc-search-wrap">
          <label className="dc-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search or start a new chat"
              aria-label="Search people or start a new chat"
              autoComplete="off"
              maxLength={64}
            />
            {query && (
              <button type="button" className="dc-icon-btn" onClick={() => setQuery('')} aria-label="Clear search"><X size={16} /></button>
            )}
          </label>
        </div>

        {chat.permission === 'default' && !searchMode && (
          <div className="dc-banner">
            <Bell size={16} aria-hidden="true" />
            <span>Get a desktop notification for new messages.</span>
            <button type="button" onClick={() => void chat.requestNotifications()}>Turn on</button>
          </div>
        )}
        {chat.listError && (
          <div className="dc-banner dc-error" role="alert">
            <span>{chat.listError}</span>
            <button type="button" onClick={() => void chat.reloadConversations()}>Retry</button>
          </div>
        )}

        <div className="dc-list" role="list">
          {searchMode ? (
            <>
              {matchingChats.length > 0 && <div className="dc-section">Chats</div>}
              {matchingChats.map((c) => (
                <ChatListItem key={c.id} conversation={c} meId={meId} active={c.id === activeId} onOpen={() => { chat.selectConversation(c.id); setQuery(''); }} />
              ))}
              <div className="dc-section">People on Toowix</div>
              {trimmed.length < 2 && <div className="dc-hint">Type at least 2 characters to search.</div>}
              {trimmed.length >= 2 && searching && <SkeletonRows />}
              {trimmed.length >= 2 && !searching && searchError && <div className="dc-hint" role="alert">{searchError}</div>}
              {trimmed.length >= 2 && !searching && !searchError && peopleNotChattedYet.length === 0 && (
                <div className="dc-hint">No one found for “{trimmed}”.</div>
              )}
              {!searching && peopleNotChattedYet.map((person) => (
                <div role="listitem" key={person.id}>
                  <button type="button" className="dc-item" onClick={() => void openPerson(person)} aria-label={`Start a chat with ${person.name}`}>
                    <Avatar name={person.name} url={person.avatarUrl} />
                    <span className="dc-item-body">
                      <span className="dc-item-top"><span className="dc-name">{person.name}</span></span>
                      <span className="dc-item-bottom"><span className="dc-preview"><span>{person.emailHint}</span></span></span>
                    </span>
                  </button>
                </div>
              ))}
            </>
          ) : chat.listLoading && listed.length === 0 ? (
            <SkeletonRows />
          ) : listed.length === 0 ? (
            <div className="dc-hint">No chats yet.<br />Search for a teammate above to start your first conversation.</div>
          ) : (
            listed.map((c) => (
              <ChatListItem key={c.id} conversation={c} meId={meId} active={c.id === activeId} onOpen={() => chat.selectConversation(c.id)} />
            ))
          )}
        </div>
      </aside>

      {/* ===================== right: the open chat ===================== */}
      <section className="dc-main" aria-label={active ? `Chat with ${active.peer.name}` : 'No chat selected'}>
        {!active ? (
          <div className="dc-empty">
            <span className="dc-empty-icon"><MessageCircle size={42} aria-hidden="true" /></span>
            <h3>Toowix Chats</h3>
            <p>Search for a teammate on the left to start a conversation. Messages arrive instantly, and you&apos;ll see when they&apos;ve been delivered and read.</p>
          </div>
        ) : (
          <>
            <header className="dc-chat-header">
              <button type="button" className="dc-icon-btn dc-back" onClick={() => chat.selectConversation(null)} aria-label="Back to chats"><ArrowLeft size={20} /></button>
              <Avatar name={active.peer.name} url={active.peer.avatarUrl} size={40} />
              <span className="dc-chat-title">
                <strong>{active.peer.name}</strong>
                {!connectionOk ? <small>{chat.status === 'connecting' ? 'Connecting…' : 'Reconnecting…'}</small> : active.blockedByMe ? <small>Blocked</small> : isChatMuted(active) ? <small>Notifications muted</small> : null}
              </span>
              <ChatHeaderActions chat={chat} active={active} onSearchInChat={() => setFindOpen(true)} onOpenInfo={() => setInfoOpen(true)} />
            </header>

            {findOpen && (
              <div className="dc-find" role="search">
                <Search size={16} aria-hidden="true" />
                <input
                  autoFocus
                  type="search"
                  value={findTerm}
                  onChange={(e) => setFindTerm(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); stepMatch(e.shiftKey ? -1 : 1); } else if (e.key === 'Escape') { setFindOpen(false); setFindTerm(''); } }}
                  placeholder="Search in this chat"
                  aria-label="Search in this chat"
                  data-testid="dc-find-input"
                />
                <span className="dc-find-count" data-testid="dc-find-count">{term ? (matchIds.length ? `${Math.min(findIndex, matchIds.length - 1) + 1} of ${matchIds.length}` : 'No results') : ''}</span>
                <button type="button" className="dc-icon-btn" onClick={() => stepMatch(-1)} disabled={matchIds.length === 0} aria-label="Previous match"><ChevronUp size={18} /></button>
                <button type="button" className="dc-icon-btn" onClick={() => stepMatch(1)} disabled={matchIds.length === 0} aria-label="Next match"><ChevronDown size={18} /></button>
                <button type="button" className="dc-icon-btn" onClick={() => { setFindOpen(false); setFindTerm(''); }} aria-label="Close search"><X size={18} /></button>
              </div>
            )}

            <div className="dc-scroll" ref={scrollRef} onScroll={onScroll} role="log" aria-label={`Messages with ${active.peer.name}`}>
              {chat.messagesLoading && activeMessages.length > 0 && <div className="dc-older">Loading earlier messages…</div>}
              {chat.messagesLoading && activeMessages.length === 0 && <div className="dc-older">Loading messages…</div>}
              {rows.map((row) => (
                row.kind === 'day' ? (
                  <div className="dc-day" key={row.key}><span>{row.label}</span></div>
                ) : (
                  <div
                    key={row.key}
                    data-mid={row.message.id}
                    className={`dc-row ${row.message.senderId === meId ? 'dc-out' : 'dc-in'}${row.groupStart ? ' dc-tail' : ''}${row.message.status === 'failed' ? ' dc-failed' : ''}${row.message.id === currentMatch ? ' dc-hit' : ''}`}
                  >
                    <div className="dc-bubble">
                      {row.message.kind === 'call' ? (
                        <CallLine
                          message={row.message}
                          mine={row.message.senderId === meId}
                          disabled={Boolean(active.blockedByMe) || Boolean(chat.outgoingCall)}
                          onCallBack={() => void chat.startCall(row.message.call?.mode === 'voice' ? 'voice' : 'video')}
                        />
                      ) : (
                        <span className="dc-text"><Highlighted text={row.message.text} term={term} /></span>
                      )}
                      <span className="dc-meta">
                        {row.message.status === 'failed' && (
                          <button type="button" className="dc-retry" onClick={() => chat.retry(row.message.conversationId, row.message.clientId || '')}>
                            Not sent · Retry
                          </button>
                        )}
                        <time dateTime={row.message.createdAt}>{formatBubbleTime(row.message.createdAt)}</time>
                        {row.message.senderId === meId && <Ticks status={row.message.status} />}
                      </span>
                    </div>
                  </div>
                )
              ))}
              {!chat.messagesLoading && activeMessages.length === 0 && (
                <div className="dc-older">No messages yet. Say hi 👋</div>
              )}
            </div>

            {newBelow > 0 && (
              <button type="button" className="dc-jump" onClick={jumpToLatest} aria-label={`${newBelow} new messages, jump to latest`}>
                <ChevronDown size={16} aria-hidden="true" /> New messages <b>{newBelow}</b>
              </button>
            )}

            <div className="dc-composer-wrap">
              {chat.sendError && (
                <div className="dc-send-error" role="alert">
                  <span>{chat.sendError}</span>
                  <button type="button" onClick={chat.clearSendError} aria-label="Dismiss"><X size={14} /></button>
                </div>
              )}
              {active.blockedByMe ? (
                <div className="dc-blocked" data-testid="dc-blocked-bar">
                  <Ban size={16} aria-hidden="true" />
                  <span>You blocked {active.peer.name}. Unblock to send messages or call.</span>
                  <button type="button" className="dc-btn" disabled={chat.menuBusy} onClick={() => void chat.setBlocked(false)}>Unblock</button>
                </div>
              ) : (
              <form className="dc-composer" onSubmit={(e) => { e.preventDefault(); submit(); }}>
                <div className="dc-input-box">
                  <textarea
                    ref={textareaRef}
                    rows={1}
                    value={text}
                    placeholder="Type a message"
                    aria-label={`Message ${active.peer.name}`}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      // Enter sends, Shift+Enter adds a line. Never while an IME (e.g. Hindi, Japanese) is composing
                      // a word, and not on touch keyboards where Enter is expected to start a new line.
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !isTouchDevice()) {
                        e.preventDefault();
                        submit();
                      }
                    }}
                  />
                  {text.length >= COUNTER_FROM && (
                    <div className={`dc-count${over ? ' dc-over' : ''}`}>{text.length}/{MAX_MESSAGE_LENGTH}</div>
                  )}
                </div>
                <button type="submit" className="dc-send" disabled={!text.trim() || over} aria-label="Send message"><Send size={19} /></button>
              </form>
              )}
            </div>
            {infoOpen && <ContactInfo chat={chat} active={active} onClose={() => setInfoOpen(false)} />}
          </>
        )}
      </section>
    </div>
  );
}

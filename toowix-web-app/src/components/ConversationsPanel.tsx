import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckCheck,
  Download,
  ExternalLink,
  FileText,
  Info,
  Loader2,
  MessageSquare,
  Paperclip,
  Search,
  Send,
  Smile,
  Video,
  X,
} from 'lucide-react';
import {
  fetchChatHistory,
  fetchConversations,
  IConversationSummary,
  ISavedChatMessage,
  persistChatMessage,
  resolveChatImageUrl,
  uploadChatImage,
} from '../lib/chatApi';
import { auth } from '../lib/firebase';

interface IConversationsPanelProps {
  isDark: boolean;
}

const AVATAR_COLORS = [
  '#4F46E5', // Indigo
  '#0284C7', // Sky Blue
  '#10B981', // Emerald Green
  '#EA580C', // Orange
  '#EC4899', // Pink
  '#8B5CF6', // Purple
  '#F59E0B', // Amber
  '#06B6D4', // Cyan
];

const EMOJI_LIST = ['👍', '🙏', '❤️', '🔥', '😊', '🚀', '🎉', '👏', '✅', '💡', '🙌', '💯'];

function getColorForString(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = input.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index];
}

function initialsOf(name: string): string {
  const clean = (name || '').trim();
  if (!clean) return '?';
  const parts = clean.split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() || '').join('') || '?';
}

function formatConversationTime(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  const now = new Date();

  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday';
  }

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatMessageTime(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function getDayLabel(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return 'Today';
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function ConversationsPanel({ isDark }: IConversationsPanelProps) {
  const [conversations, setConversations] = useState<IConversationSummary[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<IConversationSummary | null>(null);
  const [messages, setMessages] = useState<ISavedChatMessage[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [inputText, setInputText] = useState('');
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messagesError, setMessagesError] = useState<string | null>(null);

  const [callOpen, setCallOpen] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showSearchInChat, setShowSearchInChat] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [showInfoDrawer, setShowInfoDrawer] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);

  const currentUserName = useMemo(() => {
    if (auth.currentUser?.displayName) return auth.currentUser.displayName;
    try {
      const user = JSON.parse(localStorage.getItem('toowix_user') || '{}');
      return user.fullName || user.name || user.email || auth.currentUser?.email || '';
    } catch {
      return auth.currentUser?.email || '';
    }
  }, []);

  // Collapse sidebar when call is active
  useEffect(() => {
    document.body.classList.toggle('conversations-call-active', callOpen);
    return () => {
      document.body.classList.remove('conversations-call-active');
    };
  }, [callOpen]);

  // Fetch all conversations from backend
  useEffect(() => {
    let isMounted = true;
    setLoadingConversations(true);
    setError(null);

    fetchConversations()
      .then((items) => {
        if (!isMounted) return;
        setConversations(items || []);
        if (items && items.length > 0 && !selectedConversation) {
          setSelectedConversation(items[0]);
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : 'Failed to load conversations');
      })
      .finally(() => {
        if (isMounted) setLoadingConversations(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  // Fetch messages whenever selected conversation changes
  useEffect(() => {
    if (!selectedConversation?.roomSlug) {
      setMessages([]);
      return;
    }

    let isMounted = true;
    setLoadingMessages(true);
    setMessagesError(null);

    fetchChatHistory(selectedConversation.roomSlug)
      .then((history) => {
        if (!isMounted) return;
        setMessages(history || []);
      })
      .catch((err) => {
        if (!isMounted) return;
        setMessagesError(err instanceof Error ? err.message : 'Failed to load conversation history');
      })
      .finally(() => {
        if (isMounted) setLoadingMessages(false);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedConversation?.roomSlug]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (!callOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loadingMessages, callOpen]);

  const filteredConversations = useMemo(() => {
    return conversations.filter((c) => {
      const matchesSearch =
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.roomSlug.toLowerCase().includes(searchQuery.toLowerCase());
      if (filter === 'unread') {
        return matchesSearch && c.messageCount > 0;
      }
      return matchesSearch;
    });
  }, [conversations, searchQuery, filter]);

  const handleSelectConversation = (conv: IConversationSummary) => {
    setSelectedConversation(conv);
    setCallOpen(false);
    setShowSearchInChat(false);
    setChatSearchQuery('');
    setShowInfoDrawer(false);
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = inputText.trim();
    if (!text || !selectedConversation) return;

    const optimisticId = `msg-${Date.now()}`;
    const optimisticMessage: ISavedChatMessage = {
      id: optimisticId,
      senderName: currentUserName || 'You',
      senderId: auth.currentUser?.uid || null,
      text,
      createdAt: new Date().toISOString(),
    };

    // Optimistically update message stream
    setMessages((prev) => [...prev, optimisticMessage]);
    setInputText('');
    setShowEmojiPicker(false);
    setShowAttachMenu(false);

    // Update conversation snippet in sidebar
    setConversations((prev) =>
      prev.map((c) =>
        c.id === selectedConversation.id
          ? {
              ...c,
              messageCount: (c.messageCount || 0) + 1,
              lastMessageAt: optimisticMessage.createdAt,
            }
          : c
      )
    );

    try {
      await persistChatMessage(selectedConversation.roomSlug, {
        senderName: currentUserName || 'You',
        senderId: auth.currentUser?.uid,
        text,
      });
    } catch {
      // Best-effort error tolerance
    }

    setTimeout(() => {
      chatInputRef.current?.focus();
    }, 50);
  };

  const handleInsertEmoji = (emoji: string) => {
    setInputText((prev) => prev + emoji);
    setShowEmojiPicker(false);
    chatInputRef.current?.focus();
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedConversation) return;

    setUploadingImage(true);
    setShowAttachMenu(false);

    try {
      const uploadedUrl = await uploadChatImage(selectedConversation.roomSlug, file);
      const optimisticMessage: ISavedChatMessage = {
        id: `msg-${Date.now()}`,
        senderName: currentUserName || 'You',
        senderId: auth.currentUser?.uid || null,
        imageUrl: uploadedUrl,
        createdAt: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, optimisticMessage]);

      // Update sidebar
      setConversations((prev) =>
        prev.map((c) =>
          c.id === selectedConversation.id
            ? {
                ...c,
                messageCount: (c.messageCount || 0) + 1,
                lastMessageAt: optimisticMessage.createdAt,
              }
            : c
        )
      );

      await persistChatMessage(selectedConversation.roomSlug, {
        senderName: currentUserName || 'You',
        senderId: auth.currentUser?.uid,
        imageUrl: uploadedUrl,
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to upload image');
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const displayedMessages = useMemo(() => {
    if (!chatSearchQuery.trim()) return messages;
    return messages.filter((m) =>
      (m.text || '').toLowerCase().includes(chatSearchQuery.toLowerCase()) ||
      (m.senderName || '').toLowerCase().includes(chatSearchQuery.toLowerCase())
    );
  }, [messages, chatSearchQuery]);

  return (
    <div className="tm-conversations-container">
      {/* Hidden file input for uploading images/attachments */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleImageUpload}
        accept="image/*"
        style={{ display: 'none' }}
      />

      {/* =========================================================================
          LEFT PANEL: Conversations List & Search
          ========================================================================= */}
      <aside className={`tm-conversations-sidebar ${selectedConversation ? 'has-selected' : ''}`}>
        {/* Header Title */}
        <div className="tm-conversations-sidebar-header">
          <h1 className="tm-conversations-title">Conversations</h1>
          <p className="tm-conversations-subtitle">Chats from your meetings.</p>

          {/* Search Box */}
          <div className="tm-conversations-search-box">
            <Search size={16} className="tm-conversations-search-icon" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search conversations..."
              className="tm-conversations-search-input"
            />
          </div>

          {/* Filter Pills */}
          <div className="tm-conversations-filter-pills">
            <button
              type="button"
              className={`tm-filter-pill ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
            >
              All
            </button>
            <button
              type="button"
              className={`tm-filter-pill ${filter === 'unread' ? 'active' : ''}`}
              onClick={() => setFilter('unread')}
            >
              Unread
            </button>
          </div>
        </div>

        {/* Conversation List Items */}
        <div className="tm-conversations-items-list">
          {loadingConversations ? (
            <div className="tm-conversations-empty-list" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <Loader2 size={16} className="animate-spin" /> Loading conversations...
            </div>
          ) : error ? (
            <div className="tm-conversations-empty-list" style={{ color: '#EF4444' }}>
              {error}
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="tm-conversations-empty-list">
              No conversations found.
            </div>
          ) : (
            filteredConversations.map((conv) => {
              const isSelected = selectedConversation?.id === conv.id;
              const convBg = getColorForString(conv.name || conv.id);

              return (
                <div
                  key={conv.id}
                  className={`tm-conversation-row ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => handleSelectConversation(conv)}
                  role="button"
                  tabIndex={0}
                >
                  {/* Left Chat Icon Square */}
                  <div className="tm-conv-icon-box" style={{ backgroundColor: convBg }}>
                    <MessageSquare size={18} color="#FFFFFF" />
                  </div>

                  {/* Middle Copy */}
                  <div className="tm-conv-info">
                    <div className="tm-conv-title-row">
                      <span className="tm-conv-name">{conv.name}</span>
                      <span className="tm-conv-time">
                        {formatConversationTime(conv.lastMessageAt)}
                      </span>
                    </div>
                    <div className="tm-conv-preview-row">
                      <span className="tm-conv-preview">
                        {conv.messageCount > 0
                          ? `${conv.messageCount} message${conv.messageCount === 1 ? '' : 's'}`
                          : 'No messages yet'}
                      </span>
                      {conv.messageCount > 0 && (
                        <span className="tm-conv-badge">{conv.messageCount}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* =========================================================================
          RIGHT PANEL: Active Conversation Detail & Chat Stream / Call View
          ========================================================================= */}
      <main className="tm-chat-main">
        {selectedConversation ? (
          <>
            {/* Top Chat Header - Shown only in chat mode */}
            {!callOpen && (
              <header className="tm-chat-header">
                <div className="tm-chat-header-left">
                  <button
                    type="button"
                    className="tm-chat-mobile-back"
                    onClick={() => setSelectedConversation(null)}
                    title="Back to conversations"
                  >
                    <ArrowLeft size={18} />
                  </button>

                  {/* Header Icon */}
                  <div
                    className="tm-conv-icon-box header-icon"
                    style={{ backgroundColor: getColorForString(selectedConversation.name || selectedConversation.id) }}
                  >
                    <MessageSquare size={20} color="#FFFFFF" />
                  </div>

                  <div className="tm-chat-header-titles">
                    <h2 className="tm-chat-header-name">{selectedConversation.name}</h2>
                    <p className="tm-chat-header-sub">
                      {`${selectedConversation.participantCount || 1} participant${selectedConversation.participantCount === 1 ? '' : 's'} • Meeting ${selectedConversation.status?.toLowerCase() || 'ended'}`}
                    </p>
                  </div>
                </div>

                {/* Header Right Action Buttons */}
                <div className="tm-chat-header-actions">
                  {/* Call Button beside Search */}
                  <button
                    type="button"
                    className="tm-chat-action-btn"
                    onClick={() => setCallOpen(true)}
                    title="Start / Join video call"
                  >
                    <Video size={16} />
                  </button>
                  <button
                    type="button"
                    className={`tm-chat-action-btn ${showSearchInChat ? 'active' : ''}`}
                    onClick={() => setShowSearchInChat((prev) => !prev)}
                    title="Search in conversation"
                  >
                    <Search size={16} />
                  </button>
                  <button
                    type="button"
                    className={`tm-chat-action-btn ${showInfoDrawer ? 'active' : ''}`}
                    onClick={() => setShowInfoDrawer((prev) => !prev)}
                    title="Conversation information"
                  >
                    <Info size={16} />
                  </button>
                </div>
              </header>
            )}

            {/* In-Chat Search Bar */}
            {!callOpen && showSearchInChat && (
              <div className="tm-chat-search-bar">
                <Search size={15} color="#94A3B8" />
                <input
                  type="text"
                  value={chatSearchQuery}
                  onChange={(e) => setChatSearchQuery(e.target.value)}
                  placeholder="Search messages in this conversation..."
                  autoFocus
                />
                {chatSearchQuery && (
                  <button type="button" onClick={() => setChatSearchQuery('')}>
                    <X size={14} />
                  </button>
                )}
              </div>
            )}

            {/* Embedded Call View OR Message Stream */}
            {callOpen ? (
              <div className="tm-call-view-container">
                <div className="tm-call-status-bar">
                  <div className="tm-call-status-left">
                    <span className="tm-call-live-dot" />
                    <span className="tm-call-status-title">{selectedConversation.name}</span>
                  </div>
                  <div className="tm-call-status-actions">
                    <button
                      type="button"
                      onClick={() => window.open(`/meet/${encodeURIComponent(selectedConversation.roomSlug)}?fromConversation=1`, '_blank')}
                      className="tm-open-tab-btn"
                      title="Open meeting in full screen new tab"
                    >
                      <ExternalLink size={14} /> Open in new tab
                    </button>
                    <button
                      type="button"
                      onClick={() => setCallOpen(false)}
                      className="tm-return-chat-btn"
                      title="Return to chat"
                    >
                      <MessageSquare size={14} /> Return to chat
                    </button>
                  </div>
                </div>
                <iframe
                  title={`${selectedConversation.name} meeting`}
                  src={`/meet/${encodeURIComponent(selectedConversation.roomSlug)}?fromConversation=1`}
                  allow="camera; microphone; fullscreen; display-capture; autoplay"
                  className="tm-call-iframe"
                />
              </div>
            ) : (
              <>
                {/* Main Chat Messages Stream */}
                <div className="tm-chat-stream">
                  {loadingMessages ? (
                    <div className="tm-chat-empty-view">
                      <Loader2 size={24} className="animate-spin" color="#4F46E5" />
                      <p>Loading messages...</p>
                    </div>
                  ) : messagesError ? (
                    <div className="tm-chat-empty-view">
                      <p style={{ color: '#EF4444' }}>{messagesError}</p>
                    </div>
                  ) : displayedMessages.length === 0 ? (
                    <div className="tm-chat-empty-view">
                      <MessageSquare size={36} color="#4F46E5" />
                      <p>No messages in this conversation yet. Send a message to get started.</p>
                    </div>
                  ) : (
                    displayedMessages.map((msg, index) => {
                      const isMine =
                        Boolean(currentUserName) &&
                        msg.senderName?.trim().toLowerCase() === currentUserName.trim().toLowerCase();

                      const previous = displayedMessages[index - 1];
                      const showDate =
                        !previous || getDayLabel(previous.createdAt) !== getDayLabel(msg.createdAt);

                      const avatarBg = getColorForString(msg.senderName || 'User');

                      return (
                        <React.Fragment key={msg.id || index}>
                          {/* Date Separator */}
                          {showDate && (
                            <div className="tm-date-divider">
                              <div className="tm-date-divider-line" />
                              <span className="tm-date-divider-label">{getDayLabel(msg.createdAt)}</span>
                              <div className="tm-date-divider-line" />
                            </div>
                          )}

                          {isMine ? (
                            /* Outgoing Message (Me) */
                            <div className="tm-msg-row outgoing">
                              {msg.text && (
                                <div className="tm-outgoing-bubble-wrap">
                                  <span className="tm-msg-time-outer">{formatMessageTime(msg.createdAt)}</span>
                                  <div className="tm-bubble-outgoing">{msg.text}</div>
                                </div>
                              )}

                              {msg.imageUrl && (
                                <div className="tm-outgoing-attachment-wrap">
                                  <div className="tm-image-bubble">
                                    <img src={resolveChatImageUrl(msg.imageUrl)} alt="Attachment" />
                                  </div>
                                  <div className="tm-msg-status-time">
                                    <span>{formatMessageTime(msg.createdAt)}</span>
                                    <CheckCheck size={14} className="tm-check-read" />
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : (
                            /* Incoming Message */
                            <div className="tm-msg-row incoming">
                              <div className="tm-msg-avatar" style={{ backgroundColor: avatarBg }}>
                                {initialsOf(msg.senderName)}
                              </div>

                              <div className="tm-msg-body">
                                <div className="tm-msg-sender-meta">
                                  <span className="tm-msg-sender-name">{msg.senderName}</span>
                                  <span className="tm-msg-sender-time">
                                    {formatMessageTime(msg.createdAt)}
                                  </span>
                                </div>

                                {msg.text && (
                                  <div className="tm-bubble-incoming">{msg.text}</div>
                                )}

                                {msg.imageUrl && (
                                  <div className="tm-image-bubble">
                                    <img src={resolveChatImageUrl(msg.imageUrl)} alt="Attachment" />
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}

                  {/* Shared Files list from meeting */}
                  {selectedConversation.sharedFiles && selectedConversation.sharedFiles.length > 0 && (
                    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {selectedConversation.sharedFiles.map((file, idx) => (
                        <div key={file.url || idx} className="tm-file-card">
                          <div className="tm-file-badge-pdf">
                            <FileText size={18} color="#FFFFFF" />
                          </div>
                          <div className="tm-file-meta">
                            <span className="tm-file-name">{file.name}</span>
                            <span className="tm-file-size">{file.size || 'File'}</span>
                          </div>
                          <a
                            href={file.url}
                            target="_blank"
                            rel="noreferrer"
                            className="tm-file-download-btn"
                            title="Download file"
                          >
                            <Download size={16} />
                          </a>
                        </div>
                      ))}
                    </div>
                  )}

                  {uploadingImage && (
                    <div className="tm-msg-row outgoing">
                      <div className="tm-outgoing-bubble-wrap">
                        <span className="tm-msg-time-outer">Uploading image...</span>
                        <div className="tm-bubble-outgoing" style={{ opacity: 0.8 }}>
                          <Loader2 size={16} className="animate-spin" />
                        </div>
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>

                {/* Bottom Chat Input Bar */}
                <footer className="tm-chat-input-bar">
                  {/* Plus / Attach Button */}
                  <div className="tm-attach-btn-wrap">
                    <button
                      type="button"
                      className="tm-chat-icon-btn"
                      onClick={() => setShowAttachMenu((prev) => !prev)}
                      title="Attach file"
                    >
                      <Paperclip size={18} />
                    </button>

                    {/* Attach Popup Menu */}
                    {showAttachMenu && (
                      <div className="tm-attach-popup">
                        <button
                          type="button"
                          onClick={() => {
                            fileInputRef.current?.click();
                            setShowAttachMenu(false);
                          }}
                        >
                          <Paperclip size={15} /> Upload Image (max 3MB)
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Emoji Button */}
                  <div className="tm-emoji-btn-wrap">
                    <button
                      type="button"
                      className="tm-chat-icon-btn"
                      onClick={() => setShowEmojiPicker((prev) => !prev)}
                      title="Add emoji"
                    >
                      <Smile size={18} />
                    </button>

                    {/* Emoji Picker Popup */}
                    {showEmojiPicker && (
                      <div className="tm-emoji-popup">
                        <div className="tm-emoji-grid">
                          {EMOJI_LIST.map((emoji) => (
                            <button
                              key={emoji}
                              type="button"
                              className="tm-emoji-item"
                              onClick={() => handleInsertEmoji(emoji)}
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Message Input Box */}
                  <form className="tm-chat-form" onSubmit={handleSendMessage}>
                    <input
                      ref={chatInputRef}
                      type="text"
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      placeholder="Write a message..."
                      className="tm-chat-text-input"
                    />
                    <button
                      type="submit"
                      className="tm-chat-send-btn"
                      title="Send message"
                      disabled={!inputText.trim()}
                    >
                      <Send size={16} />
                    </button>
                  </form>
                </footer>
              </>
            )}
          </>
        ) : (
          <div className="tm-chat-empty-view">
            <MessageSquare size={48} color="#4F46E5" />
            <h3>Select a conversation</h3>
            <p>Choose a meeting chat from the left to view messages.</p>
          </div>
        )}

        {/* Info Drawer */}
        {showInfoDrawer && selectedConversation && (
          <div className="tm-info-drawer">
            <div className="tm-info-drawer-header">
              <h3>Meeting Information</h3>
              <button type="button" onClick={() => setShowInfoDrawer(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="tm-info-drawer-content">
              <div className="tm-info-item">
                <label>Meeting Title</label>
                <span>{selectedConversation.name}</span>
              </div>
              <div className="tm-info-item">
                <label>Room Slug</label>
                <span style={{ fontSize: 12, color: '#94A3B8' }}>{selectedConversation.roomSlug}</span>
              </div>
              <div className="tm-info-item">
                <label>Participants</label>
                <span>{selectedConversation.participantCount || 1} participant(s)</span>
              </div>
              <div className="tm-info-item">
                <label>Status</label>
                <span className="tm-info-status-pill">{selectedConversation.status || 'Ended'}</span>
              </div>
              {selectedConversation.sharedFiles && selectedConversation.sharedFiles.length > 0 && (
                <div className="tm-info-item">
                  <label>Shared Files</label>
                  <div className="tm-info-file-list">
                    {selectedConversation.sharedFiles.map((file, idx) => (
                      <div key={file.url || idx} className="tm-info-file">
                        <FileText size={15} color="#EF4444" />
                        <a href={file.url} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>
                          {file.name} {file.size ? `(${file.size})` : ''}
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

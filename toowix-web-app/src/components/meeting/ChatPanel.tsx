// Extracted from MeetingRoomPage.tsx (Track 3, Phase 2, item 6). Only mounted while the chat panel
// is open (the page still owns the `activePanel === 'chat'` conditional, unchanged). `chatMessages`
// deliberately stays on the page, NOT moved here: the page's own incoming-signal handler (the
// CHAT_MESSAGE branch) pushes received messages into it regardless of whether this panel is open,
// and the history-load-on-join effect needs it too -- owning that state inside a component that
// unmounts whenever the panel closes would silently drop messages received while it was closed.
// Send/attach-image interaction state (input text, upload progress/error) IS fully local to this
// component: in the original code it was only ever visible while this exact panel was rendered, so
// moving it inside changes nothing a user could observe.
import { useRef, useState } from 'react';
import { Check, Copy, Download, File as FileIcon, Paperclip, Pencil, Send, X } from 'lucide-react';
import {
  persistChatMessage, editChatMessage, uploadChatImage, resolveChatImageUrl, MAX_CHAT_IMAGE_BYTES,
  uploadChatFile, resolveChatFileUrl, MAX_CHAT_FILE_BYTES,
} from '../../lib/chatApi';

export interface IChatMessage {
  id: string;
  sender: string;
  senderId?: string;
  time: string;
  text: string;
  imageUrl?: string;
  // Generic file attachment (ZIP, PDF, DOCX, video, or anything else up to 5MB) -- rendered as a
  // download card (name + size + a Download button) rather than an inline preview, distinct from
  // imageUrl's own inline-image path.
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
  uploading?: boolean;
  // Set once this message's text has been changed after sending (see handleSaveEdit below) --
  // shown as a small "(edited)" label, same convention WhatsApp uses, so nobody mistakes an
  // edited message for what was originally sent.
  edited?: boolean;
}

// Matches an http(s) URL inside a larger chat message so it can be rendered as a clickable link
// instead of plain text. Stops at whitespace/quotes/angle-brackets and trims a handful of trailing
// punctuation marks (.,!?)]>'" that are almost always sentence punctuation, not part of the URL
// itself (e.g. "check this out: https://example.com." should not swallow the period into the link).
const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;
const TRAILING_PUNCTUATION_PATTERN = /[.,!?)\]>'"]+$/;

// Splits message text into plain strings and clickable <a> elements for every http(s) URL found.
// Returns the original string unchanged (as a single-item array) when there is nothing to link.
function linkifyText(text: string): Array<string | JSX.Element> {
  const matches = text.match(URL_PATTERN);

  if (!matches) return [text];

  const parts: Array<string | JSX.Element> = [];
  let lastIndex = 0;
  let key = 0;

  for (const rawMatch of matches) {
    const matchIndex = text.indexOf(rawMatch, lastIndex);
    const trailingPunctuation = rawMatch.match(TRAILING_PUNCTUATION_PATTERN)?.[0] || '';
    const url = trailingPunctuation ? rawMatch.slice(0, -trailingPunctuation.length) : rawMatch;

    if (!url) continue;
    if (matchIndex > lastIndex) parts.push(text.slice(lastIndex, matchIndex));
    parts.push(
      <a
        key={`link-${key++}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: '#8AB4F8', textDecoration: 'underline', wordBreak: 'break-all' }}
        onClick={(e) => e.stopPropagation()}
      >
        {url}
      </a>
    );
    lastIndex = matchIndex + url.length;
    if (trailingPunctuation) parts.push(trailingPunctuation);
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));

  return parts;
}

// Formats a byte count as a short human-readable size (e.g. "482 KB", "2.3 MB"), same convention
// as the backend's own 5MB limit, for the download card's second line.
function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Generates the id a message is known by for its entire lifetime: included in the live
// real-time broadcast (postRoomSignal's payload) AND the persisted copy (persistChatMessage's
// clientMessageId) AND this sender's own local copy, so all three agree -- required for a later
// edit (which only ever travels with this id) to find and update the right message everywhere.
function generateMessageId(sessionId: string): string {
  return `${sessionId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

const chatIconButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#9AA0A6',
  cursor: 'pointer',
  padding: '2px 4px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '4px',
};

export interface IChatPanelProps {
  chatMessages: IChatMessage[];
  setChatMessages: React.Dispatch<React.SetStateAction<IChatMessage[]>>;
  displayName: string;
  sessionId: string;
  roomId: string;
  attachmentsEnabled: boolean;
  // Separate from attachmentsEnabled: generic file attachments are also allowed in an ad-hoc
  // room (no Meeting document), unlike image/voice attachments -- see MeetingRoomPage.tsx's own
  // comment on this prop for why.
  fileAttachmentsEnabled: boolean;
  postRoomSignal: (type: string, payload: any, targetSessionId?: string) => Promise<void> | void;
}

export function ChatPanel({
  chatMessages, setChatMessages, displayName, sessionId, roomId, attachmentsEnabled, fileAttachmentsEnabled, postRoomSignal,
}: IChatPanelProps) {
  const [chatInput, setChatInput] = useState('');
  const [chatImageUploading, setChatImageUploading] = useState(false);
  const [chatImageError, setChatImageError] = useState<string | null>(null);
  const chatImageInputRef = useRef<HTMLInputElement | null>(null);
  const [chatFileUploading, setChatFileUploading] = useState(false);
  const [chatFileError, setChatFileError] = useState<string | null>(null);
  const chatFileInputRef = useRef<HTMLInputElement | null>(null);
  // Edit mode: at most one message editable at a time, same as WhatsApp. editingText is a
  // separate draft from the message's own stored text, so Cancel can discard it cleanly without
  // ever having mutated chatMessages.
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  // Brief "Copied to clipboard" toast shown after using the right-click/long-press menu's Copy
  // item -- clears itself.
  const [showCopiedToast, setShowCopiedToast] = useState(false);
  // Right-click (or long-press, see onTouchStart below) context menu: at most one open at a
  // time, positioned at the pointer. null means closed.
  const [contextMenu, setContextMenu] = useState<{ messageId: string; x: number; y: number } | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  // Click-to-enlarge image preview, same lightbox pattern as ConversationsPanel.tsx's dashboard
  // chat -- opens the image bigger in an in-app overlay instead of a new browser tab.
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

  const handleSendChatMessage = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!chatInput.trim()) return;
    const text = chatInput.trim();
    const id = generateMessageId(sessionId);
    const msg: IChatMessage = {
      id,
      sender: displayName || 'You',
      senderId: sessionId,
      time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
      text,
    };

    setChatMessages((prev) => [...prev, msg]);
    setChatInput('');
    // Routed through postRoomSignal (HTTP to our backend + Jitsi datachannel as a latency
    // accelerant) instead of only sendEndpointTextMessage directly -- that datachannel relies
    // on Jitsi's BridgeChannel, which can be unready or unavailable, and had no fallback, so
    // messages could silently never reach other participants. HTTP always works.
    void postRoomSignal('CHAT_MESSAGE', { id, text });
    // Saving the conversation is a no-op on the backend for a meeting with no Meeting document
    // (the homepage's free instant meeting) -- only a dashboard-created meeting actually gets
    // anything written, so there's no persisted check needed here.
    void persistChatMessage(roomId, { senderName: displayName || 'You', senderId: sessionId, text, clientMessageId: id });
  };

  // Copies the message's own text to the clipboard. navigator.clipboard requires a secure
  // context (https, which this app always runs under) -- falls back to the older
  // execCommand('copy') path (a temp, off-screen textarea) for any browser/context where it's
  // unavailable, same fallback pattern as most other copy-to-clipboard UIs.
  const handleCopyMessage = async (msg: IChatMessage) => {
    const text = msg.text || '';

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        throw new Error('Clipboard API unavailable');
      }
    } catch {
      try {
        const textarea = document.createElement('textarea');

        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      } catch {
        return; // Nothing more to do -- silently give up rather than show a broken "Copied".
      }
    }
    setContextMenu(null);
    setShowCopiedToast(true);
    setTimeout(() => setShowCopiedToast(false), 1500);
  };

  // Right-click opens a small "Copy" context menu at the pointer, instead of a permanently
  // visible button on every bubble. clientX/Y position it; a window-level listener (below, in
  // the render) closes it on any click elsewhere, matching how a native context menu behaves.
  const openContextMenu = (e: React.MouseEvent, msg: IChatMessage) => {
    if (!msg.text) return; // nothing to copy
    e.preventDefault();
    setContextMenu({ messageId: msg.id, x: e.clientX, y: e.clientY });
  };

  // Touch devices have no right-click -- a long-press (same gesture WhatsApp itself uses) opens
  // the same menu, centered under the finger. Cancelled by a normal tap/scroll (onTouchEnd/
  // onTouchMove) so it never fires on an ordinary tap.
  const handleTouchStart = (e: React.TouchEvent, msg: IChatMessage) => {
    if (!msg.text) return;
    const touch = e.touches[0];

    if (!touch) return;
    const x = touch.clientX;
    const y = touch.clientY;

    longPressTimerRef.current = window.setTimeout(() => {
      setContextMenu({ messageId: msg.id, x, y });
    }, 500);
  };
  const cancelLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleStartEdit = (msg: IChatMessage) => {
    setEditingMessageId(msg.id);
    setEditingText(msg.text || '');
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditingText('');
  };

  // Saves an edit: updates the LOCAL copy immediately (the sender's own view), broadcasts it
  // live to everyone currently in the call (same postRoomSignal transport every other real-time
  // chat event uses), and persists it so a reload or a later viewer of saved history also sees
  // the edited text -- all three keyed off the SAME message id (see generateMessageId's own
  // comment for why that id has to be shared across all three from the moment the message was
  // first sent).
  const handleSaveEdit = (messageId: string) => {
    const text = editingText.trim();

    if (!text) {
      handleCancelEdit();

      return;
    }
    setChatMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, text, edited: true } : m)));
    setEditingMessageId(null);
    setEditingText('');
    void postRoomSignal('CHAT_MESSAGE_EDITED', { id: messageId, text });
    void editChatMessage(roomId, messageId, sessionId, text);
  };

  const handleAttachChatImage = async (file: File | undefined) => {
    if (!file) return;
    setChatImageError(null);
    const caption = chatInput.trim();

    if (!file.type.startsWith('image/')) {
      setChatImageError('Only image files can be attached here.');
      setTimeout(() => setChatImageError(null), 4000);
      if (chatImageInputRef.current) chatImageInputRef.current.value = '';
      return;
    }
    if (file.size > MAX_CHAT_IMAGE_BYTES) {
      setChatImageError('Image is too large -- the limit is 3MB.');
      setTimeout(() => setChatImageError(null), 4000);
      if (chatImageInputRef.current) chatImageInputRef.current.value = '';
      return;
    }

    // Show the picked image immediately via a local blob URL, rather than waiting on the
    // upload round-trip -- the bubble then swaps to the real hosted URL (or is removed on
    // failure) once uploadChatImage resolves, same "instant preview" feel as WhatsApp/Messenger.
    const localPreviewUrl = URL.createObjectURL(file);
    const id = generateMessageId(sessionId);

    setChatMessages((prev) => [
      ...prev,
      {
        id,
        sender: displayName || 'You',
        senderId: sessionId,
        time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
        text: caption,
        imageUrl: localPreviewUrl,
        uploading: true,
      },
    ]);
    setChatInput('');
    setChatImageUploading(true);
    try {
      const url = await uploadChatImage(roomId, file);
      const resolvedUrl = resolveChatImageUrl(url);

      setChatMessages((prev) => prev.map((m) => (m.id === id ? { ...m, imageUrl: resolvedUrl, uploading: false } : m)));
      URL.revokeObjectURL(localPreviewUrl);
      void postRoomSignal('CHAT_MESSAGE', { id, text: caption, imageUrl: resolvedUrl });
      void persistChatMessage(roomId, {
        senderName: displayName || 'You',
        senderId: sessionId,
        text: caption,
        imageUrl: resolvedUrl,
        clientMessageId: id,
      });
    } catch (err: any) {
      setChatMessages((prev) => prev.filter((m) => m.id !== id));
      URL.revokeObjectURL(localPreviewUrl);
      setChatImageError(err?.message || 'Failed to send image');
      setTimeout(() => setChatImageError(null), 4000);
    } finally {
      setChatImageUploading(false);
      if (chatImageInputRef.current) chatImageInputRef.current.value = '';
    }
  };

  // Generic file attachment (ZIP, PDF, DOCX, video, or anything else up to 5MB) -- distinct from
  // handleAttachChatImage's dedicated inline-preview path above. No local preview is possible for
  // an arbitrary file type, so the bubble shows a "Sending..." download card immediately instead,
  // then swaps to the real hosted URL once uploadChatFile resolves.
  const handleAttachChatFile = async (file: File | undefined) => {
    if (!file) return;
    setChatFileError(null);
    const caption = chatInput.trim();

    if (file.size > MAX_CHAT_FILE_BYTES) {
      setChatFileError('File is too large -- the limit is 5MB.');
      setTimeout(() => setChatFileError(null), 4000);
      if (chatFileInputRef.current) chatFileInputRef.current.value = '';
      return;
    }

    const id = generateMessageId(sessionId);

    setChatMessages((prev) => [
      ...prev,
      {
        id,
        sender: displayName || 'You',
        senderId: sessionId,
        time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
        text: caption,
        fileName: file.name,
        fileSize: file.size,
        uploading: true,
      },
    ]);
    setChatInput('');
    setChatFileUploading(true);
    try {
      const uploaded = await uploadChatFile(roomId, file);
      const resolvedUrl = resolveChatFileUrl(uploaded.url);

      setChatMessages((prev) => prev.map((m) => (
        m.id === id ? { ...m, fileUrl: resolvedUrl, fileName: uploaded.fileName, fileSize: uploaded.fileSize, uploading: false } : m
      )));
      void postRoomSignal('CHAT_MESSAGE', {
        id, text: caption, fileUrl: resolvedUrl, fileName: uploaded.fileName, fileSize: uploaded.fileSize,
      });
      void persistChatMessage(roomId, {
        senderName: displayName || 'You',
        senderId: sessionId,
        text: caption,
        fileUrl: resolvedUrl,
        fileName: uploaded.fileName,
        fileSize: uploaded.fileSize,
        fileType: uploaded.fileType,
        clientMessageId: id,
      });
    } catch (err: any) {
      setChatMessages((prev) => prev.filter((m) => m.id !== id));
      setChatFileError(err?.message || 'Failed to send file');
      setTimeout(() => setChatFileError(null), 4000);
    } finally {
      setChatFileUploading(false);
      if (chatFileInputRef.current) chatFileInputRef.current.value = '';
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' }}>
      <div className="tw-chat-scroll" style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto', flex: 1, paddingBottom: '12px' }}>
        {chatMessages.map((msg) => {
          // senderId alone can't tell "is this me" reliably -- it's a fresh, random
          // Jitsi session id every time you (re)join, so a message loaded from
          // saved conversation history (sent in an earlier session) would never
          // match the CURRENT session's id even if it's the same person. Falling
          // back to a name match catches that case; a live message from this same
          // session still matches on id as before.
          const isMine = msg.senderId === sessionId
            || (msg.sender || '').trim().toLowerCase() === (displayName || 'You').trim().toLowerCase();

          return (
          <div
            key={msg.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: isMine ? 'flex-end' : 'flex-start',
              gap: '3px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexDirection: isMine ? 'row-reverse' : 'row' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: isMine ? '#A8DAB5' : '#8AB4F8' }}>{msg.sender}</span>
              <span style={{ fontSize: '11px', color: '#9AA0A6' }}>{msg.time}</span>
              {msg.edited && (
                <span style={{ fontSize: '11px', color: '#9AA0A6', fontStyle: 'italic' }}>(edited)</span>
              )}
            </div>
            <div
              style={{
                maxWidth: '82%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: isMine ? 'flex-end' : 'flex-start',
                gap: '6px',
                padding: msg.imageUrl || msg.fileName || msg.text ? '8px' : '0',
                borderRadius: '12px',
                backgroundColor: isMine ? '#075E54' : '#263238',
                border: '1px solid rgba(255,255,255,0.1)',
              }}
            >
              {msg.imageUrl && (
                <div style={{ position: 'relative', display: 'inline-block' }}>
                  <img
                    src={resolveChatImageUrl(msg.imageUrl)}
                    alt="Shared attachment"
                    onClick={() => { if (!msg.uploading) setLightboxImage(resolveChatImageUrl(msg.imageUrl!)); }}
                    style={{
                      maxWidth: '220px',
                      maxHeight: '220px',
                      borderRadius: '8px',
                      display: 'block',
                      opacity: msg.uploading ? 0.65 : 1,
                      cursor: msg.uploading ? 'default' : 'pointer',
                    }}
                  />
                  {msg.uploading && (
                    <span style={{ position: 'absolute', left: '8px', bottom: '8px', padding: '3px 7px', borderRadius: '10px', backgroundColor: 'rgba(0, 0, 0, 0.7)', color: '#FFFFFF', fontSize: '11px' }}>
                      Sending...
                    </span>
                  )}
                </div>
              )}
              {msg.fileName && !msg.imageUrl && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    width: '220px',
                    padding: '8px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(0,0,0,0.2)',
                    opacity: msg.uploading ? 0.65 : 1,
                  }}
                >
                  <div style={{ width: '32px', height: '32px', borderRadius: '6px', backgroundColor: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <FileIcon size={16} color="#9AA0A6" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '12px', color: '#FFFFFF', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {msg.fileName}
                    </div>
                    <div style={{ fontSize: '11px', color: '#9AA0A6' }}>
                      {msg.uploading ? 'Sending...' : formatFileSize(msg.fileSize || 0)}
                    </div>
                  </div>
                  {!msg.uploading && msg.fileUrl && (
                    <a
                      href={msg.fileUrl}
                      download={msg.fileName}
                      target="_blank"
                      rel="noreferrer"
                      title="Download"
                      style={{ ...chatIconButtonStyle, color: '#A8DAB5', flexShrink: 0 }}
                    >
                      <Download size={16} />
                    </a>
                  )}
                </div>
              )}
              {editingMessageId === msg.id ? (
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <textarea
                    autoFocus
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSaveEdit(msg.id);
                      } else if (e.key === 'Escape') {
                        handleCancelEdit();
                      }
                    }}
                    rows={2}
                    style={{
                      width: '100%',
                      resize: 'none',
                      backgroundColor: 'rgba(0,0,0,0.25)',
                      border: '1px solid rgba(255,255,255,0.2)',
                      borderRadius: '6px',
                      padding: '6px',
                      color: '#FFFFFF',
                      fontSize: '13px',
                      fontFamily: 'inherit',
                      outline: 'none',
                    }}
                  />
                  <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      title="Cancel"
                      onClick={handleCancelEdit}
                      style={chatIconButtonStyle}
                    >
                      <X size={13} />
                    </button>
                    <button
                      type="button"
                      title="Save"
                      onClick={() => handleSaveEdit(msg.id)}
                      style={{ ...chatIconButtonStyle, color: '#A8DAB5' }}
                    >
                      <Check size={13} />
                    </button>
                  </div>
                </div>
              ) : (
                msg.text && (
                  <div
                    onContextMenu={(e) => openContextMenu(e, msg)}
                    onTouchStart={(e) => handleTouchStart(e, msg)}
                    onTouchEnd={cancelLongPress}
                    onTouchMove={cancelLongPress}
                    style={{ width: '100%', fontSize: '13px', color: '#FFFFFF', lineHeight: 1.4, wordBreak: 'break-word', whiteSpace: 'pre-wrap', textAlign: 'left', cursor: 'context-menu', userSelect: 'text' }}
                  >
                    {linkifyText(msg.text)}
                  </div>
                )
              )}
            </div>
            {editingMessageId !== msg.id && (
              <div style={{ display: 'flex', gap: '4px', flexDirection: isMine ? 'row-reverse' : 'row' }}>
                {isMine && msg.text && !msg.uploading && (
                  <button
                    type="button"
                    title="Edit message"
                    onClick={() => handleStartEdit(msg)}
                    style={chatIconButtonStyle}
                  >
                    <Pencil size={12} />
                  </button>
                )}
              </div>
            )}
          </div>
          );
        })}
      </div>
      {chatImageError && (
        <div style={{ fontSize: '12px', color: '#F28B82', paddingBottom: '6px' }}>{chatImageError}</div>
      )}
      {chatFileError && (
        <div style={{ fontSize: '12px', color: '#F28B82', paddingBottom: '6px' }}>{chatFileError}</div>
      )}
      <form onSubmit={handleSendChatMessage} style={{ display: 'flex', gap: '8px', paddingTop: '10px', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
        {attachmentsEnabled && (
          <>
            <input
              ref={chatImageInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => void handleAttachChatImage(e.target.files?.[0])}
            />
            <button
              type="button"
              title="Attach an image (max 3MB)"
              disabled={chatImageUploading}
              onClick={() => chatImageInputRef.current?.click()}
              style={{
                backgroundColor: 'transparent',
                color: '#9AA0A6',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: '50%',
                width: '36px',
                height: '36px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: chatImageUploading ? 'wait' : 'pointer',
                flexShrink: 0,
              }}
            >
              <Paperclip size={16} />
            </button>
          </>
        )}
        {fileAttachmentsEnabled && (
          <>
            <input
              ref={chatFileInputRef}
              type="file"
              style={{ display: 'none' }}
              onChange={(e) => void handleAttachChatFile(e.target.files?.[0])}
            />
            <button
              type="button"
              title="Attach a file (ZIP, PDF, DOCX, video, etc. -- max 5MB)"
              disabled={chatFileUploading}
              onClick={() => chatFileInputRef.current?.click()}
              style={{
                backgroundColor: 'transparent',
                color: '#9AA0A6',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: '50%',
                width: '36px',
                height: '36px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: chatFileUploading ? 'wait' : 'pointer',
                flexShrink: 0,
              }}
            >
              <FileIcon size={16} />
            </button>
          </>
        )}
        <input
          type="text"
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          placeholder="Send a message..."
          style={{
            flex: 1,
            minWidth: 0,
            backgroundColor: '#2D2E30',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: '20px',
            padding: '8px 14px',
            color: '#FFFFFF',
            fontSize: '13px',
            outline: 'none',
          }}
        />
        <button
          type="submit"
          style={{
            backgroundColor: '#1A73E8',
            color: '#fff',
            border: 'none',
            borderRadius: '50%',
            width: '36px',
            height: '36px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <Send size={16} />
        </button>
      </form>
      {contextMenu && (
        // Fixed-position overlay: an invisible full-screen backdrop closes the menu on any click
        // outside it (mousedown fires before the menu item's own onClick, so a click ON the Copy
        // item still reaches it first -- same layering a native context menu uses), then the
        // actual small menu, positioned at the pointer and nudged back on-screen if it would
        // overflow the panel's own edge.
        <>
          <div
            onMouseDown={() => setContextMenu(null)}
            onTouchStart={() => setContextMenu(null)}
            style={{ position: 'fixed', inset: 0, zIndex: 999 }}
          />
          <div
            style={{
              position: 'fixed',
              top: contextMenu.y,
              left: Math.min(contextMenu.x, window.innerWidth - 140),
              zIndex: 1000,
              backgroundColor: '#2D2E30',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: '8px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
              overflow: 'hidden',
              minWidth: '120px',
            }}
          >
            <button
              type="button"
              onClick={() => {
                const msg = chatMessages.find((m) => m.id === contextMenu.messageId);

                if (msg) void handleCopyMessage(msg);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                width: '100%',
                padding: '9px 12px',
                background: 'transparent',
                border: 'none',
                color: '#E8EAED',
                fontSize: '13px',
                cursor: 'pointer',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <Copy size={14} />
              Copy
            </button>
          </div>
        </>
      )}
      {showCopiedToast && (
        <div
          style={{
            position: 'fixed',
            bottom: '24px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1001,
            backgroundColor: '#2D2E30',
            color: '#FFFFFF',
            fontSize: '12px',
            padding: '7px 14px',
            borderRadius: '16px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            pointerEvents: 'none',
          }}
        >
          Copied to clipboard
        </div>
      )}
      {lightboxImage && (
        <div className="tm-image-lightbox-overlay" onClick={() => setLightboxImage(null)}>
          <button
            type="button"
            className="tm-image-lightbox-close"
            onClick={() => setLightboxImage(null)}
            title="Close"
          >
            <X size={20} />
          </button>
          <a
            href={lightboxImage}
            download
            className="tm-image-lightbox-download"
            title="Download image"
            onClick={(e) => e.stopPropagation()}
          >
            <Download size={18} />
          </a>
          <img
            src={lightboxImage}
            alt="Attachment"
            className="tm-image-lightbox-img"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

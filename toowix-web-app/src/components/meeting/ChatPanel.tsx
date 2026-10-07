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
import { Paperclip, Send } from 'lucide-react';
import { persistChatMessage, uploadChatImage, resolveChatImageUrl, MAX_CHAT_IMAGE_BYTES } from '../../lib/chatApi';

export interface IChatMessage {
  id: string;
  sender: string;
  senderId?: string;
  time: string;
  text: string;
  imageUrl?: string;
  uploading?: boolean;
}

export interface IChatPanelProps {
  chatMessages: IChatMessage[];
  setChatMessages: React.Dispatch<React.SetStateAction<IChatMessage[]>>;
  displayName: string;
  sessionId: string;
  roomId: string;
  attachmentsEnabled: boolean;
  postRoomSignal: (type: string, payload: any, targetSessionId?: string) => Promise<void> | void;
}

export function ChatPanel({
  chatMessages, setChatMessages, displayName, sessionId, roomId, attachmentsEnabled, postRoomSignal,
}: IChatPanelProps) {
  const [chatInput, setChatInput] = useState('');
  const [chatImageUploading, setChatImageUploading] = useState(false);
  const [chatImageError, setChatImageError] = useState<string | null>(null);
  const chatImageInputRef = useRef<HTMLInputElement | null>(null);

  const handleSendChatMessage = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!chatInput.trim()) return;
    const text = chatInput.trim();
    const msg: IChatMessage = {
      id: String(Date.now()),
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
    void postRoomSignal('CHAT_MESSAGE', { text });
    // Saving the conversation is a no-op on the backend for a meeting with no Meeting document
    // (the homepage's free instant meeting) -- only a dashboard-created meeting actually gets
    // anything written, so there's no persisted check needed here.
    void persistChatMessage(roomId, { senderName: displayName || 'You', senderId: sessionId, text });
  };

  const handleAttachChatImage = async (file: File | undefined) => {
    if (!file) return;
    setChatImageError(null);
    const caption = chatInput.trim();

    if (!file.type.startsWith('image/')) {
      setChatImageError('Only image files (JPG, PNG, GIF, WEBP) can be attached.');
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
    const tempId = `local-${Date.now()}`;

    setChatMessages((prev) => [
      ...prev,
      {
        id: tempId,
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

      setChatMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, imageUrl: resolvedUrl, uploading: false } : m)));
      URL.revokeObjectURL(localPreviewUrl);
      void postRoomSignal('CHAT_MESSAGE', { text: caption, imageUrl: resolvedUrl });
      void persistChatMessage(roomId, {
        senderName: displayName || 'You',
        senderId: sessionId,
        text: caption,
        imageUrl: resolvedUrl,
      });
    } catch (err: any) {
      setChatMessages((prev) => prev.filter((m) => m.id !== tempId));
      URL.revokeObjectURL(localPreviewUrl);
      setChatImageError(err?.message || 'Failed to send image');
      setTimeout(() => setChatImageError(null), 4000);
    } finally {
      setChatImageUploading(false);
      if (chatImageInputRef.current) chatImageInputRef.current.value = '';
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
            </div>
            <div
              style={{
                maxWidth: '82%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: isMine ? 'flex-end' : 'flex-start',
                gap: '6px',
                padding: msg.imageUrl || msg.text ? '8px' : '0',
                borderRadius: '12px',
                backgroundColor: isMine ? '#075E54' : '#263238',
                border: '1px solid rgba(255,255,255,0.1)',
              }}
            >
              {msg.imageUrl && (
                <div style={{ position: 'relative', display: 'inline-block' }}>
                  <a href={msg.uploading ? undefined : resolveChatImageUrl(msg.imageUrl)} target="_blank" rel="noreferrer">
                    <img
                      src={resolveChatImageUrl(msg.imageUrl)}
                      alt="Shared attachment"
                      style={{
                        maxWidth: '220px',
                        maxHeight: '220px',
                        borderRadius: '8px',
                        display: 'block',
                        opacity: msg.uploading ? 0.65 : 1,
                      }}
                    />
                  </a>
                  {msg.uploading && (
                    <span style={{ position: 'absolute', left: '8px', bottom: '8px', padding: '3px 7px', borderRadius: '10px', backgroundColor: 'rgba(0, 0, 0, 0.7)', color: '#FFFFFF', fontSize: '11px' }}>
                      Sending...
                    </span>
                  )}
                </div>
              )}
              {msg.text && (
                <div style={{ width: '100%', fontSize: '13px', color: '#FFFFFF', lineHeight: 1.4, wordBreak: 'break-word', whiteSpace: 'pre-wrap', textAlign: 'left' }}>
                  {msg.text}
                </div>
              )}
            </div>
          </div>
          );
        })}
      </div>
      {chatImageError && (
        <div style={{ fontSize: '12px', color: '#F28B82', paddingBottom: '6px' }}>{chatImageError}</div>
      )}
      <form onSubmit={handleSendChatMessage} style={{ display: 'flex', gap: '8px', paddingTop: '10px', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
        {attachmentsEnabled && (
          <>
            <input
              ref={chatImageInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
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
    </div>
  );
}

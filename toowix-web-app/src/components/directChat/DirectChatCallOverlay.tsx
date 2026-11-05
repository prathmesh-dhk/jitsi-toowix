import { useEffect } from 'react';
import { Phone, PhoneOff, Video, X } from 'lucide-react';
import type { DirectChat } from '../../lib/directChat/useDirectChat';
import { Avatar } from './parts';
import './directChat.css';

/** Full-screen "incoming call" / "calling..." cards. Mounted once at the dashboard level so a call rings on every tab. */
export function DirectChatCallOverlay({ chat, isDark }: { chat: DirectChat; isDark: boolean }) {
  const { incomingCall, outgoingCall, callNotice, dismissCallNotice } = chat;

  // "Declined" / "did not answer" notes go away by themselves.
  useEffect(() => {
    if (!callNotice) return undefined;
    const timer = window.setTimeout(dismissCallNotice, 6000);

    return () => window.clearTimeout(timer);
  }, [callNotice, dismissCallNotice]);

  if (!incomingCall && !outgoingCall && !callNotice) return null;

  return (
    <div className={`dc-call-layer ${isDark ? 'dc-dark' : 'dc-light'}`}>
      {incomingCall && (
        <div className="dc-call-card" role="alertdialog" aria-modal="false" aria-label={`Incoming call from ${incomingCall.peer.name}`} data-testid="dc-incoming-call">
          <Avatar name={incomingCall.peer.name} url={incomingCall.peer.avatarUrl} size={72} />
          <div className="dc-call-text">
            <small>Incoming {incomingCall.mode === 'voice' ? 'voice' : 'video'} call</small>
            <strong>{incomingCall.peer.name}</strong>
          </div>
          <div className="dc-call-buttons">
            <button type="button" className="dc-call-btn dc-decline" data-testid="dc-decline-call" onClick={() => void chat.declineCall()} aria-label="Decline call"><PhoneOff size={22} /></button>
            <button type="button" className="dc-call-btn dc-accept" data-testid="dc-accept-call" onClick={() => void chat.answerCall()} aria-label="Accept call">
              {incomingCall.mode === 'voice' ? <Phone size={22} /> : <Video size={22} />}
            </button>
          </div>
        </div>
      )}

      {outgoingCall && !incomingCall && (
        <div className="dc-call-card" role="alertdialog" aria-modal="false" aria-label={`Calling ${outgoingCall.peer.name}`} data-testid="dc-outgoing-call">
          <Avatar name={outgoingCall.peer.name} url={outgoingCall.peer.avatarUrl} size={72} />
          <div className="dc-call-text">
            <small>{outgoingCall.mode === 'voice' ? 'Voice call' : 'Video call'}</small>
            <strong>Calling {outgoingCall.peer.name}…</strong>
          </div>
          <div className="dc-call-buttons">
            <button type="button" className="dc-call-btn dc-decline" data-testid="dc-cancel-call" onClick={() => void chat.cancelOutgoingCall()} aria-label="Cancel call"><PhoneOff size={22} /></button>
          </div>
        </div>
      )}

      {callNotice && !incomingCall && !outgoingCall && (
        <div className="dc-call-notice" role="status" data-testid="dc-call-notice">
          <span>{callNotice}</span>
          <button type="button" onClick={chat.dismissCallNotice} aria-label="Dismiss"><X size={14} /></button>
        </div>
      )}
    </div>
  );
}

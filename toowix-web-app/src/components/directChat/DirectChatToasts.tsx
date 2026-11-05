import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { IChatToast } from '../../lib/directChat/useDirectChat';
import { Avatar } from './parts';
import './directChat.css';

const TOAST_MS = 7000;

function Toast({ toast, onOpen, onDismiss }: { toast: IChatToast; onOpen: () => void; onDismiss: () => void }) {
  // The latest onDismiss is read through a ref so the timer is tied to THIS toast only: a new inline
  // callback from every parent render must not restart (and so postpone forever) the auto-dismiss.
  const dismissRef = useRef(onDismiss);

  dismissRef.current = onDismiss;
  useEffect(() => {
    const timer = setTimeout(() => dismissRef.current(), TOAST_MS);

    return () => clearTimeout(timer);
  }, [toast.id]);

  return (
    <div style={{ position: 'relative' }}>
      <button type="button" className="dc-toast" onClick={onOpen} aria-label={`New message from ${toast.peer.name}: ${toast.text}. Open chat`}>
        <Avatar name={toast.peer.name} url={toast.peer.avatarUrl} size={40} />
        <span className="dc-toast-body">
          <strong>{toast.peer.name}</strong>
          <span>{toast.text}</span>
        </span>
      </button>
      <button
        type="button"
        className="dc-icon-btn"
        onClick={onDismiss}
        aria-label="Dismiss"
        style={{ position: 'absolute', top: 4, right: 4, width: 24, height: 24, color: 'var(--dc-muted)' }}
      >
        <X size={14} />
      </button>
    </div>
  );
}

/** Pops a card (bottom-right) for a message that arrives in a chat you are not looking at. */
export function DirectChatToasts({ toasts, isDark, onOpen, onDismiss }: {
  toasts: IChatToast[];
  isDark: boolean;
  onOpen: (conversationId: string) => void;
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div className={`dc-toasts ${isDark ? 'dc-dark' : 'dc-light'}`} role="status" aria-live="polite">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onOpen={() => { onOpen(toast.conversationId); onDismiss(toast.id); }} onDismiss={() => onDismiss(toast.id)} />
      ))}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Ban, BellOff, ChevronRight, Eraser, Info, MoreVertical, Phone, Search, Trash2, Video, X } from 'lucide-react';
import { isChatMuted } from '../../lib/directChat/useDirectChat';
import type { DirectChat } from '../../lib/directChat/useDirectChat';
import type { ChatConversation, MuteDuration } from '../../lib/directChat/types';
import { Avatar } from './parts';

/** Video (Toowix meeting call), voice call and the three-dot menu in the open chat's header. */

type Confirm = 'clear' | 'delete' | 'block' | null;

const MUTE_CHOICES: Array<{ id: Exclude<MuteDuration, 'off'>; label: string }> = [
  { id: '8h', label: '8 hours' },
  { id: '1w', label: '1 week' },
  { id: 'always', label: 'Always' },
];

export const muteLabel = (conversation: ChatConversation): string => {
  if (!isChatMuted(conversation)) return 'Notifications on';
  const until = new Date(conversation.mutedUntil as string);

  return until.getFullYear() >= 9999 ? 'Muted always' : `Muted until ${until.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`;
};

interface IProps {
  chat: DirectChat;
  active: ChatConversation;
  onSearchInChat: () => void;
  onOpenInfo: () => void;
}

export function ChatHeaderActions({ chat, active, onSearchInChat, onOpenInfo }: IProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [muteOpen, setMuteOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const muted = isChatMuted(active);
  const blocked = Boolean(active.blockedByMe);
  const calling = Boolean(chat.outgoingCall);

  const closeMenu = () => { setMenuOpen(false); setMuteOpen(false); };

  // Click outside / Escape closes the menu.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onPointer = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) closeMenu(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeMenu(); };

    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  // The menu belongs to one chat: switching chat closes it.
  useEffect(() => { closeMenu(); setConfirm(null); }, [active.id]);

  const callDisabled = blocked || calling;
  const callTitle = blocked ? 'Unblock to call' : calling ? 'Already calling' : '';

  const runConfirmed = async () => {
    const kind = confirm;

    if (!kind) return;
    const done = kind === 'clear' ? await chat.clearChat() : kind === 'delete' ? await chat.deleteChat() : await chat.setBlocked(true);

    if (done) setConfirm(null);
  };

  const confirmCopy: Record<Exclude<Confirm, null>, { title: string; body: string; action: string }> = {
    clear: { title: 'Clear this chat?', body: `All messages with ${active.peer.name} will be removed from your view. ${active.peer.name} keeps their copy.`, action: 'Clear chat' },
    delete: { title: 'Delete this chat?', body: `This chat will be removed from your list. It comes back if ${active.peer.name} writes to you again.`, action: 'Delete chat' },
    block: { title: `Block ${active.peer.name}?`, body: `Neither of you will be able to message or call the other in this chat until you unblock. ${active.peer.name} is not told.`, action: 'Block' },
  };

  return (
    <>
      <div className="dc-header-actions" ref={wrapRef}>
        <button
          type="button"
          className="dc-icon-btn dc-action"
          data-testid="dc-video-call"
          aria-label={`Start a Toowix video meeting call with ${active.peer.name}`}
          title={callTitle || 'Video call (Toowix meeting)'}
          disabled={callDisabled}
          onClick={() => void chat.startCall('video')}
        >
          <Video size={20} />
        </button>
        <button
          type="button"
          className="dc-icon-btn dc-action"
          data-testid="dc-voice-call"
          aria-label={`Start a voice call with ${active.peer.name}`}
          title={callTitle || 'Voice call'}
          disabled={callDisabled}
          onClick={() => void chat.startCall('voice')}
        >
          <Phone size={19} />
        </button>
        <button
          type="button"
          className="dc-icon-btn dc-action"
          data-testid="dc-menu-button"
          aria-label="More options"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => { setMenuOpen((open) => !open); setMuteOpen(false); }}
        >
          <MoreVertical size={20} />
        </button>

        {menuOpen && (
          <div className="dc-menu" role="menu" aria-label="Chat options">
            <button type="button" role="menuitem" onClick={() => { closeMenu(); onOpenInfo(); }}><Info size={17} /> Contact info</button>
            <button type="button" role="menuitem" onClick={() => { closeMenu(); onSearchInChat(); }}><Search size={17} /> Search in chat</button>
            {muted ? (
              <button type="button" role="menuitem" disabled={chat.menuBusy} onClick={() => { closeMenu(); void chat.muteChat('off'); }}><BellOff size={17} /> Unmute notifications</button>
            ) : (
              <>
                <button type="button" role="menuitem" aria-expanded={muteOpen} onClick={() => setMuteOpen((open) => !open)}>
                  <BellOff size={17} /> Mute notifications <ChevronRight size={15} className={`dc-menu-chevron${muteOpen ? ' dc-open' : ''}`} />
                </button>
                {muteOpen && (
                  <div className="dc-submenu" role="group" aria-label="Mute for">
                    {MUTE_CHOICES.map((choice) => (
                      <button type="button" role="menuitemradio" aria-checked="false" key={choice.id} disabled={chat.menuBusy} onClick={() => { closeMenu(); void chat.muteChat(choice.id); }}>
                        {choice.label}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            <div className="dc-menu-sep" role="separator" />
            <button type="button" role="menuitem" onClick={() => { closeMenu(); setConfirm('clear'); }}><Eraser size={17} /> Clear chat</button>
            <button type="button" role="menuitem" onClick={() => { closeMenu(); setConfirm('delete'); }}><Trash2 size={17} /> Delete chat</button>
            {blocked ? (
              <button type="button" role="menuitem" disabled={chat.menuBusy} onClick={() => { closeMenu(); void chat.setBlocked(false); }}><Ban size={17} /> Unblock</button>
            ) : (
              <button type="button" role="menuitem" className="dc-danger" onClick={() => { closeMenu(); setConfirm('block'); }}><Ban size={17} /> Block</button>
            )}
            <div className="dc-menu-sep" role="separator" />
            <button type="button" role="menuitem" onClick={() => { closeMenu(); chat.selectConversation(null); }}><X size={17} /> Close chat</button>
          </div>
        )}
      </div>

      {confirm && (
        <div className="dc-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirm(null); }}>
          <div className="dc-modal" role="alertdialog" aria-modal="true" aria-labelledby="dc-confirm-title" aria-describedby="dc-confirm-body">
            <h3 id="dc-confirm-title">{confirmCopy[confirm].title}</h3>
            <p id="dc-confirm-body">{confirmCopy[confirm].body}</p>
            <div className="dc-modal-actions">
              <button type="button" className="dc-btn" autoFocus onClick={() => setConfirm(null)}>Cancel</button>
              <button type="button" className="dc-btn dc-btn-danger" data-testid="dc-confirm-action" disabled={chat.menuBusy} onClick={() => void runConfirmed()}>
                {confirmCopy[confirm].action}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** "Contact info" side sheet: who this is and this person's own settings for the chat. */
export function ContactInfo({ chat, active, onClose }: { chat: DirectChat; active: ChatConversation; onClose: () => void }) {
  const blocked = Boolean(active.blockedByMe);

  return (
    <aside className="dc-info" aria-label="Contact info" data-testid="dc-contact-info">
      <header>
        <button type="button" className="dc-icon-btn" onClick={onClose} aria-label="Close contact info"><X size={20} /></button>
        <strong>Contact info</strong>
      </header>
      <div className="dc-info-body">
        <Avatar name={active.peer.name} url={active.peer.avatarUrl} size={120} />
        <h3>{active.peer.name}</h3>
        <dl>
          <div><dt>Notifications</dt><dd>{muteLabel(active)}</dd></div>
          <div><dt>Status</dt><dd>{blocked ? 'Blocked by you' : 'Can message and call you'}</dd></div>
        </dl>
        <div className="dc-info-actions">
          <button type="button" className="dc-btn" disabled={blocked || Boolean(chat.outgoingCall)} onClick={() => void chat.startCall('voice')}><Phone size={16} /> Voice call</button>
          <button type="button" className="dc-btn" disabled={blocked || Boolean(chat.outgoingCall)} onClick={() => void chat.startCall('video')}><Video size={16} /> Video call</button>
        </div>
      </div>
    </aside>
  );
}

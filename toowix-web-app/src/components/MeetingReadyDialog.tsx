import { useState } from 'react';
import { X, UserPlus, Copy, Check, Lock } from 'lucide-react';

interface IProps {
  isOpen: boolean;
  onClose: () => void;
  onAddOthers: () => void;
  meetingUrl: string;
  joinedAs: string;
  isDark: boolean;
}

export function MeetingReadyDialog({ isOpen, onClose, onAddOthers, meetingUrl, joinedAs, isDark }: IProps) {
  const [ copied, setCopied ] = useState(false);

  if (!isOpen) {
    return null;
  }

  const fg = isDark ? '#E8EAED' : '#202124';
  const muted = isDark ? '#9AA0A6' : '#5F6368';
  const shortUrl = meetingUrl.replace(/^https?:\/\//, '');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(meetingUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <div
      role="dialog"
      aria-label="Your meeting's ready"
      style={{
        position: 'fixed',
        left: '24px',
        bottom: '104px',
        zIndex: 240,
        width: '380px',
        maxWidth: 'calc(100vw - 48px)',
        backgroundColor: isDark ? '#2D2E30' : '#FFFFFF',
        color: fg,
        borderRadius: '16px',
        padding: '24px',
        boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
        border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : '#E5E7EB'}`
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 500 }}>Your meeting&apos;s ready</h3>
        <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: muted, cursor: 'pointer' }}>
          <X size={20} />
        </button>
      </div>

      <button
        onClick={() => { onClose(); onAddOthers(); }}
        style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 20px', borderRadius: '24px', border: 'none', backgroundColor: '#4F46E5', color: '#FFFFFF', fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}
      >
        <UserPlus size={18} /> Add others
      </button>

      <p style={{ fontSize: '14px', color: muted, margin: '16px 0 10px' }}>
        Or share this meeting link with others you want in the meeting
      </p>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', backgroundColor: isDark ? '#202124' : '#F1F3F4', borderRadius: '8px', padding: '12px 14px' }}>
        <span style={{ fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortUrl}</span>
        <button onClick={copy} aria-label="Copy meeting link" style={{ background: 'none', border: 'none', color: copied ? '#34A853' : fg, cursor: 'pointer', display: 'flex' }}>
          {copied ? <Check size={20} /> : <Copy size={20} />}
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', margin: '16px 0 12px', fontSize: '13px', color: muted }}>
        <Lock size={18} color="#8AB4F8" style={{ flexShrink: 0 }} />
        <span>People who use this meeting link must get your permission before they can join.</span>
      </div>
      {joinedAs && <div style={{ fontSize: '12px', color: muted }}>Joined as {joinedAs}</div>}
    </div>
  );
}

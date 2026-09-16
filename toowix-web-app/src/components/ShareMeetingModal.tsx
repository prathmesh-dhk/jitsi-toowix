import React, { useState, useEffect } from 'react';
import {
  X,
  Copy,
  Check,
  Lock,
} from 'lucide-react';
import { useTheme } from '../lib/theme';

export interface IShareMeetingData {
  name: string;
  meetingUrl: string;
  roomSlug?: string;
  scheduledAt?: string | null;
  passcode?: string | null;
  hostName?: string;
  description?: string;
}

export interface IShareMeetingModalProps {
  isOpen: boolean;
  onClose: () => void;
  meeting: IShareMeetingData | null;
}

export function ShareMeetingModal({ isOpen, onClose, meeting }: IShareMeetingModalProps) {
  const { isDark } = useTheme();
  const [copiedPasscode, setCopiedPasscode] = useState(false);
  const [copiedPreview, setCopiedPreview] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !meeting) return null;

  const formattedDate = meeting.scheduledAt
    ? new Date(meeting.scheduledAt).toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;

  // Build the complete Google Meet-style joining info message
  const fullMessage = [
    `To join the video meeting, click this link: ${meeting.meetingUrl}`,
    '',
    `Meeting: ${meeting.name}`,
    formattedDate ? `Date & Time: ${formattedDate}` : null,
    meeting.passcode ? `Meeting Passcode: ${meeting.passcode}` : null,
    meeting.hostName ? `Organizer: ${meeting.hostName}` : null,
    meeting.description ? `Details: ${meeting.description}` : null,
    '',
    `Joined via Toowix Meet — Safe, Fast Video Conferencing`,
  ]
    .filter((line) => line !== null)
    .join('\n');

  const handleCopyPasscode = async () => {
    if (!meeting.passcode) return;
    try {
      await navigator.clipboard.writeText(meeting.passcode);
      setCopiedPasscode(true);
      setTimeout(() => setCopiedPasscode(false), 2000);
    } catch (e) {
      console.error('Failed to copy passcode:', e);
    }
  };

  const handleCopyPreview = async () => {
    try {
      await navigator.clipboard.writeText(fullMessage);
      setCopiedPreview(true);
      setTimeout(() => setCopiedPreview(false), 2000);
    } catch (e) {
      console.error('Failed to copy preview:', e);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(5px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100,
        padding: '16px',
        animation: 'toowixFadeIn 0.15s ease-out',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '460px',
          backgroundColor: isDark ? '#17181C' : '#FFFFFF',
          border: isDark ? '1px solid #2B2D33' : '1px solid #E5E7EB',
          borderRadius: '16px',
          boxShadow: isDark
            ? '0 24px 48px -12px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.05)'
            : '0 20px 40px -12px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.05)',
          color: isDark ? '#FFFFFF' : '#141B2B',
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '90vh',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header with Toowix Logo / Favicon */}
        <div
          style={{
            padding: '18px 20px 14px 20px',
            borderBottom: isDark ? '1px solid #2B2D33' : '1px solid #E5E7EB',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                backgroundColor: isDark ? '#1E293B' : '#EEF2FF',
                border: isDark ? '1px solid #334155' : '1px solid #C7D2FE',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: isDark ? '0 2px 6px rgba(0,0,0,0.3)' : '0 2px 6px rgba(79, 70, 229, 0.12)',
                flexShrink: 0,
              }}
            >
              <img
                src="/assets/toowix-logo.svg"
                alt="Toowix"
                style={{ width: '22px', height: '22px', objectFit: 'contain' }}
                onError={(e) => {
                  (e.currentTarget as HTMLElement).style.display = 'none';
                }}
              />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: isDark ? '#FFFFFF' : '#141B2B', letterSpacing: '-0.2px' }}>
                Share joining information
              </h3>
              <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: isDark ? '#9CA3AF' : '#6B7280' }}>
                Send this to people you want to meet with
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: 'transparent',
              color: isDark ? '#9CA3AF' : '#6B7280',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'background-color 0.15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = isDark ? '#2B2D33' : '#F3F4F6')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div style={{ padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Passcode Row (Only if meeting.passcode is set) */}
          {meeting.passcode && (
            <div
              style={{
                backgroundColor: isDark ? 'rgba(99, 102, 241, 0.08)' : '#EEF2FF',
                border: isDark ? '1px solid rgba(99, 102, 241, 0.25)' : '1px solid #C7D2FE',
                borderRadius: '10px',
                padding: '10px 14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Lock size={16} style={{ color: isDark ? '#A5B4FC' : '#4F46E5' }} />
                <span style={{ fontSize: '13px', color: isDark ? '#9CA3AF' : '#6B7280', fontWeight: 500 }}>Passcode:</span>
                <strong style={{ fontSize: '14px', color: isDark ? '#FFFFFF' : '#141B2B', letterSpacing: '1px', fontFamily: 'monospace' }}>
                  {meeting.passcode}
                </strong>
              </div>
              <button
                onClick={handleCopyPasscode}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '5px 10px',
                  backgroundColor: copiedPasscode ? '#059669' : (isDark ? 'transparent' : '#FFFFFF'),
                  border: `1px solid ${copiedPasscode ? '#059669' : (isDark ? 'rgba(99, 102, 241, 0.4)' : '#C7D2FE')}`,
                  borderRadius: '6px',
                  color: copiedPasscode ? '#FFFFFF' : (isDark ? '#C7D2FE' : '#4338CA'),
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {copiedPasscode ? <Check size={13} /> : <Copy size={13} />}
                <span>{copiedPasscode ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          )}

          {/* Full Invitation Message Box (with "Copy Full Message" button) */}
          <div
            style={{
              backgroundColor: isDark ? '#111215' : '#F8F9FD',
              border: isDark ? '1px solid #2B2D33' : '1px solid #E5E7EB',
              borderRadius: '12px',
              padding: '14px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: isDark ? '#9CA3AF' : '#6B7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Invitation message
              </span>
              <button
                onClick={handleCopyPreview}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 12px',
                  borderRadius: '8px',
                  backgroundColor: copiedPreview ? '#059669' : '#4F46E5',
                  border: 'none',
                  color: '#FFFFFF',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: copiedPreview
                    ? '0 2px 8px rgba(5, 150, 105, 0.3)'
                    : '0 2px 8px rgba(79, 70, 229, 0.3)',
                  transition: 'all 0.15s ease',
                }}
              >
                {copiedPreview ? <Check size={14} /> : <Copy size={14} />}
                <span>{copiedPreview ? 'Message copied!' : 'Copy message'}</span>
              </button>
            </div>

            <pre
              style={{
                margin: 0,
                fontSize: '13px',
                color: isDark ? '#D1D5DB' : '#374151',
                backgroundColor: isDark ? '#0B0C0E' : '#FFFFFF',
                border: isDark ? '1px solid #1F2128' : '1px solid #E5E7EB',
                borderRadius: '8px',
                padding: '12px 14px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: 'inherit',
                lineHeight: 1.5,
                maxHeight: '220px',
                overflowY: 'auto',
              }}
            >
              {fullMessage}
            </pre>
          </div>
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: isDark ? '1px solid #2B2D33' : '1px solid #E5E7EB',
            backgroundColor: isDark ? '#131418' : '#F9FAFB',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <img
              src="/assets/toowix-logo.svg"
              alt="Toowix"
              style={{ width: '16px', height: '16px', objectFit: 'contain', opacity: 0.8 }}
            />
            <span style={{ fontSize: '11px', color: isDark ? '#9CA3AF' : '#6B7280' }}>
              Toowix Meet
            </span>
          </div>

          <button
            onClick={onClose}
            style={{
              padding: '7px 16px',
              borderRadius: '8px',
              border: isDark ? '1px solid #33363F' : '1px solid #D1D5DB',
              backgroundColor: isDark ? '#23252B' : '#FFFFFF',
              color: isDark ? '#FFFFFF' : '#374151',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'background-color 0.15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = isDark ? '#2E313A' : '#F3F4F6')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = isDark ? '#23252B' : '#FFFFFF')}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

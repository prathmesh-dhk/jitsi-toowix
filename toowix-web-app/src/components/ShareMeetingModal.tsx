import React, { useState, useEffect } from 'react';
import {
  X,
  Copy,
  Check,
  Share2,
  Lock,
  Link as LinkIcon,
  Mail,
  ExternalLink,
  MessageSquare,
  Sparkles,
} from 'lucide-react';

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
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedPasscode, setCopiedPasscode] = useState(false);
  const [copiedPreview, setCopiedPreview] = useState(false);
  const [activeTab, setActiveTab] = useState<'options' | 'preview'>('options');

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

  // WhatsApp formatted message
  const whatsappMessage = [
    `*Meeting Invitation: ${meeting.name}*`,
    formattedDate ? `📅 *Date & Time:* ${formattedDate}` : null,
    `🔗 *Join Link:* ${meeting.meetingUrl}`,
    meeting.passcode ? `🔑 *Passcode:* ${meeting.passcode}` : null,
    meeting.hostName ? `👤 *Organizer:* ${meeting.hostName}` : null,
    '',
    `Tap the link to join directly on Toowix Meet!`,
  ]
    .filter((line) => line !== null)
    .join('\n');

  const handleCopyAll = async () => {
    try {
      await navigator.clipboard.writeText(fullMessage);
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2500);
    } catch (e) {
      console.error('Failed to copy joining info:', e);
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(meeting.meetingUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch (e) {
      console.error('Failed to copy link:', e);
    }
  };

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

  const handleShareWhatsApp = () => {
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(whatsappMessage)}`, '_blank');
  };

  const handleShareGmail = () => {
    const subject = encodeURIComponent(`Meeting Invitation: ${meeting.name}`);
    const body = encodeURIComponent(fullMessage);
    window.open(`https://mail.google.com/mail/?view=cm&fs=1&su=${subject}&body=${body}`, '_blank');
  };

  const handleShareDefaultEmail = () => {
    const subject = encodeURIComponent(`Meeting Invitation: ${meeting.name}`);
    const body = encodeURIComponent(fullMessage);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  const handleShareTelegram = () => {
    window.open(
      `https://t.me/share/url?url=${encodeURIComponent(meeting.meetingUrl)}&text=${encodeURIComponent(whatsappMessage)}`,
      '_blank'
    );
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: meeting.name,
          text: fullMessage,
          url: meeting.meetingUrl,
        });
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          handleCopyAll();
        }
      }
    } else {
      handleCopyAll();
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.72)',
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
          backgroundColor: '#17181C',
          border: '1px solid #2B2D33',
          borderRadius: '16px',
          boxShadow: '0 24px 48px -12px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.05)',
          color: '#FFFFFF',
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
            borderBottom: '1px solid #2B2D33',
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
                backgroundColor: '#1E293B',
                border: '1px solid #334155',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
                flexShrink: 0,
              }}
            >
              <img
                src="/favicon.png"
                alt="Toowix"
                style={{ width: '22px', height: '22px', borderRadius: '4px', objectFit: 'contain' }}
                onError={(e) => {
                  (e.currentTarget as HTMLElement).style.display = 'none';
                }}
              />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#FFFFFF', letterSpacing: '-0.2px' }}>
                Share joining information
              </h3>
              <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#9CA3AF' }}>
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
              color: '#9CA3AF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'background-color 0.15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#2B2D33')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div style={{ padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          
          {/* Primary Action: Big Google Meet-Style "Copy Joining Info" Button */}
          <button
            onClick={handleCopyAll}
            style={{
              width: '100%',
              padding: '13px 18px',
              borderRadius: '10px',
              border: 'none',
              backgroundColor: copiedAll ? '#059669' : '#4F46E5',
              color: '#FFFFFF',
              fontSize: '14px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              cursor: 'pointer',
              boxShadow: copiedAll
                ? '0 4px 14px rgba(5, 150, 105, 0.4)'
                : '0 4px 14px rgba(79, 70, 229, 0.4)',
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
            onMouseEnter={(e) => {
              if (!copiedAll) e.currentTarget.style.backgroundColor = '#4338CA';
            }}
            onMouseLeave={(e) => {
              if (!copiedAll) e.currentTarget.style.backgroundColor = '#4F46E5';
            }}
          >
            {copiedAll ? <Check size={18} strokeWidth={2.5} /> : <Copy size={18} />}
            <span>{copiedAll ? 'Joining info copied to clipboard!' : 'Copy joining info'}</span>
          </button>

          {/* Direct Meeting URL Box */}
          <div
            style={{
              backgroundColor: '#111215',
              border: '1px solid #2B2D33',
              borderRadius: '10px',
              padding: '10px 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden', flex: 1 }}>
              <LinkIcon size={15} style={{ color: '#6366F1', flexShrink: 0 }} />
              <span
                style={{
                  fontSize: '13px',
                  color: '#E5E7EB',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontFamily: 'monospace',
                }}
              >
                {meeting.meetingUrl}
              </span>
            </div>
            <button
              onClick={handleCopyLink}
              title="Copy meeting link"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '5px 10px',
                backgroundColor: copiedLink ? '#059669' : '#23252B',
                border: '1px solid #33363F',
                borderRadius: '6px',
                color: copiedLink ? '#FFFFFF' : '#D1D5DB',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                flexShrink: 0,
                transition: 'all 0.15s ease',
              }}
            >
              {copiedLink ? <Check size={13} /> : <Copy size={13} />}
              <span>{copiedLink ? 'Copied' : 'Link'}</span>
            </button>
          </div>

          {/* Passcode Row if present */}
          {meeting.passcode && (
            <div
              style={{
                backgroundColor: 'rgba(99, 102, 241, 0.08)',
                border: '1px solid rgba(99, 102, 241, 0.25)',
                borderRadius: '10px',
                padding: '9px 12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Lock size={15} style={{ color: '#A5B4FC' }} />
                <span style={{ fontSize: '12px', color: '#9CA3AF' }}>Passcode:</span>
                <strong style={{ fontSize: '13px', color: '#FFFFFF', letterSpacing: '1px', fontFamily: 'monospace' }}>
                  {meeting.passcode}
                </strong>
              </div>
              <button
                onClick={handleCopyPasscode}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 8px',
                  backgroundColor: copiedPasscode ? '#059669' : 'transparent',
                  border: `1px solid ${copiedPasscode ? '#059669' : 'rgba(99, 102, 241, 0.4)'}`,
                  borderRadius: '6px',
                  color: copiedPasscode ? '#FFFFFF' : '#C7D2FE',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {copiedPasscode ? <Check size={12} /> : <Copy size={12} />}
                <span>{copiedPasscode ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          )}

          {/* Section Divider with label */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '2px 0' }}>
            <div style={{ height: '1px', flex: 1, backgroundColor: '#2B2D33' }} />
            <span style={{ fontSize: '11px', fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
              Share directly to
            </span>
            <div style={{ height: '1px', flex: 1, backgroundColor: '#2B2D33' }} />
          </div>

          {/* Share Channels Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
            {/* WhatsApp */}
            <button
              onClick={handleShareWhatsApp}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '11px 14px',
                backgroundColor: '#1E293B',
                border: '1px solid #334155',
                borderRadius: '10px',
                color: '#FFFFFF',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#25D366';
                e.currentTarget.style.borderColor = '#25D366';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#1E293B';
                e.currentTarget.style.borderColor = '#334155';
              }}
            >
              <div
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  backgroundColor: '#25D366',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="#FFFFFF">
                  <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
                </svg>
              </div>
              <span>WhatsApp</span>
            </button>

            {/* Gmail */}
            <button
              onClick={handleShareGmail}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '11px 14px',
                backgroundColor: '#1E293B',
                border: '1px solid #334155',
                borderRadius: '10px',
                color: '#FFFFFF',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#EA4335';
                e.currentTarget.style.borderColor = '#EA4335';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#1E293B';
                e.currentTarget.style.borderColor = '#334155';
              }}
            >
              <div
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  backgroundColor: '#EA4335',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Mail size={16} color="#FFFFFF" />
              </div>
              <span>Gmail</span>
            </button>

            {/* Telegram */}
            <button
              onClick={handleShareTelegram}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '11px 14px',
                backgroundColor: '#1E293B',
                border: '1px solid #334155',
                borderRadius: '10px',
                color: '#FFFFFF',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#229ED9';
                e.currentTarget.style.borderColor = '#229ED9';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#1E293B';
                e.currentTarget.style.borderColor = '#334155';
              }}
            >
              <div
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  backgroundColor: '#229ED9',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="#FFFFFF">
                  <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
                </svg>
              </div>
              <span>Telegram</span>
            </button>

            {/* Native Device Share / Email Client */}
            <button
              onClick={handleNativeShare}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '11px 14px',
                backgroundColor: '#1E293B',
                border: '1px solid #334155',
                borderRadius: '10px',
                color: '#FFFFFF',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#6366F1';
                e.currentTarget.style.borderColor = '#6366F1';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#1E293B';
                e.currentTarget.style.borderColor = '#334155';
              }}
            >
              <div
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  backgroundColor: '#6366F1',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Share2 size={15} color="#FFFFFF" />
              </div>
              <span>More apps...</span>
            </button>
          </div>

          {/* Full Invitation Message Box (with "Copy Message" button) */}
          <div
            style={{
              backgroundColor: '#111215',
              border: '1px solid #2B2D33',
              borderRadius: '10px',
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Invitation message preview
              </span>
              <button
                onClick={handleCopyPreview}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  backgroundColor: copiedPreview ? '#059669' : '#1E293B',
                  border: `1px solid ${copiedPreview ? '#059669' : '#334155'}`,
                  color: copiedPreview ? '#FFFFFF' : '#C7D2FE',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {copiedPreview ? <Check size={13} /> : <Copy size={13} />}
                <span>{copiedPreview ? 'Message copied!' : 'Copy full message'}</span>
              </button>
            </div>

            <pre
              style={{
                margin: 0,
                fontSize: '12px',
                color: '#D1D5DB',
                backgroundColor: '#0B0C0E',
                border: '1px solid #1F2128',
                borderRadius: '8px',
                padding: '10px 12px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: 'inherit',
                lineHeight: 1.45,
                maxHeight: '140px',
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
            borderTop: '1px solid #2B2D33',
            backgroundColor: '#131418',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <img
              src="/favicon.png"
              alt="Toowix"
              style={{ width: '16px', height: '16px', borderRadius: '3px', opacity: 0.8 }}
            />
            <span style={{ fontSize: '11px', color: '#6B7280' }}>
              Toowix Meet
            </span>
          </div>

          <button
            onClick={onClose}
            style={{
              padding: '7px 16px',
              borderRadius: '8px',
              border: '1px solid #33363F',
              backgroundColor: '#23252B',
              color: '#FFFFFF',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'background-color 0.15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#2E313A')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#23252B')}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

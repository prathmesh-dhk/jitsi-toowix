import React, { useState, useEffect } from 'react';
import {
  Calendar as CalendarIcon,
  MapPin,
  Users,
  Copy,
  Check,
  MoreHorizontal,
  X,
  Mail,
  CheckCircle2,
  MinusCircle,
  XCircle,
  Pencil,
  ExternalLink,
  Trash2,
  Lock,
  Share2,
} from 'lucide-react';
import { ShareMeetingModal } from './ShareMeetingModal';

export interface IScheduledMeetingDetails {
  id?: string;
  name: string;
  roomSlug: string;
  meetingUrl: string;
  scheduledAt?: string | null;
  durationMinutes?: number | null;
  type?: 'Personal' | 'Internal' | 'Guest' | 'Private' | string;
  description?: string;
  passcode?: string | null;
  organizer?: {
    name: string;
    email?: string;
    avatarUrl?: string;
    initials: string;
  };
  invitees?: Array<{
    name: string;
    email: string;
    initials: string;
    status?: 'accepted' | 'declined' | 'pending' | 'awaiting';
  }>;
}

interface IScheduledMeetingCardModalProps {
  isOpen: boolean;
  meeting: IScheduledMeetingDetails | null;
  onClose: () => void;
  onEdit?: (meeting: IScheduledMeetingDetails) => void;
  onMoreDetails?: (meeting: IScheduledMeetingDetails) => void;
  onDelete?: (meeting: IScheduledMeetingDetails) => void;
}

const getInitials = (str?: string): string => {
  if (!str) return '?';
  const clean = str.replace(/@.*/, '');
  const parts = clean.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase() || '?';
};

const formatDisplayName = (emailOrName: string): string => {
  if (!emailOrName.includes('@')) return emailOrName;
  const username = emailOrName.split('@')[0];
  return username
    .split(/[._-]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

export function ScheduledMeetingCardModal({
  isOpen,
  meeting,
  onClose,
  onEdit,
  onMoreDetails,
  onDelete,
}: IScheduledMeetingCardModalProps) {
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedPasscode, setCopiedPasscode] = useState(false);
  const [copiedAttendees, setCopiedAttendees] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);

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

  const handleCopyEmail = async (email: string) => {
    try {
      await navigator.clipboard.writeText(email);
      setCopiedEmail(email);
      setTimeout(() => setCopiedEmail(null), 2000);
    } catch (e) {
      console.error('Failed to copy email:', e);
    }
  };

  const handleShareWhatsApp = () => {
    const scheduledDateStr = meeting.scheduledAt
      ? new Date(meeting.scheduledAt).toLocaleString(undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })
      : formattedDate;

    let text = `*Meeting Invitation: ${meeting.name}*\n` +
      `📅 Date & Time: ${scheduledDateStr}\n` +
      `🔗 Join Link: ${meeting.meetingUrl}\n`;

    if (meeting.passcode) {
      text += `🔑 Passcode: ${meeting.passcode}\n`;
    }

    text += `\nHosted by ${organizerName} on Toowix Meet.`;
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
  };

  const handleCopyAllAttendees = async () => {
    const list: string[] = [];
    if (meeting.organizer?.email) {
      list.push(`${meeting.organizer.name} <${meeting.organizer.email}> (Organizer - Confirmed)`);
    }
    (meeting.invitees || []).forEach((inv) => {
      const statusText = inv.status === 'accepted' ? 'Confirmed' : inv.status === 'declined' ? 'Declined' : 'Awaiting response';
      list.push(`${inv.name} <${inv.email}> (${statusText})`);
    });
    const scheduledDateStr = meeting.scheduledAt
      ? new Date(meeting.scheduledAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : '';
    let text = `Meeting: ${meeting.name}\nLink: ${meeting.meetingUrl}\nDate: ${scheduledDateStr}\n`;
    if (meeting.passcode) text += `Passcode: ${meeting.passcode}\n`;
    text += `\nAttendees:\n` + list.join('\n');

    try {
      await navigator.clipboard.writeText(text);
      setCopiedAttendees(true);
      setTimeout(() => setCopiedAttendees(false), 2000);
    } catch (e) {
      console.error('Failed to copy attendees:', e);
    }
  };

  const scheduledDate = meeting.scheduledAt ? new Date(meeting.scheduledAt) : new Date();
  const formattedDate = scheduledDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const organizerName = meeting.organizer?.name || 'Organizer';
  const organizerEmail = meeting.organizer?.email || '';
  const organizerInitials = meeting.organizer?.initials || getInitials(organizerName);

  const invitees = meeting.invitees || [];
  const totalAttendees = 1 + invitees.length;
  const confirmedCount = 1 + invitees.filter((i) => i.status === 'accepted').length;
  const declinedCount = invitees.filter((i) => i.status === 'declined').length;
  const awaitingCount = invitees.filter((i) => !i.status || i.status === 'awaiting' || i.status === 'pending').length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(4px)',
        padding: '16px',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '430px',
          backgroundColor: '#17181C',
          borderRadius: '16px',
          border: '1px solid #2B2D33',
          boxShadow: '0 24px 50px -12px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.06)',
          padding: '22px 24px',
          color: '#E5E7EB',
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          boxSizing: 'border-box',
          position: 'relative',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header: Indicator + Type + Actions */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                backgroundColor: '#22C55E',
                display: 'inline-block',
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: '13.5px', fontWeight: 700, color: '#FFFFFF' }}>
              {meeting.type || 'Personal'}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', position: 'relative' }}>
            <button
              type="button"
              aria-label="Options"
              onClick={() => setShowDropdown(!showDropdown)}
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '6px',
                background: 'transparent',
                border: 'none',
                color: '#9CA3AF',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#FFFFFF')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#9CA3AF')}
            >
              <MoreHorizontal size={17} />
            </button>

            {showDropdown && (
              <div
                style={{
                  position: 'absolute',
                  top: '32px',
                  right: 0,
                  backgroundColor: '#202227',
                  border: '1px solid #353840',
                  borderRadius: '8px',
                  boxShadow: '0 10px 25px rgba(0, 0, 0, 0.5)',
                  minWidth: '170px',
                  zIndex: 20,
                  padding: '4px 0',
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    handleCopyLink();
                    setShowDropdown(false);
                  }}
                  style={{
                    width: '100%',
                    padding: '8px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    background: 'transparent',
                    border: 'none',
                    color: '#E5E7EB',
                    fontSize: '12px',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#2B2E35')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <Copy size={13} /> Copy Link
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowDropdown(false);
                    setShowShareModal(true);
                  }}
                  style={{
                    width: '100%',
                    padding: '8px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    background: 'transparent',
                    border: 'none',
                    color: '#818CF8',
                    fontSize: '12px',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#2B2E35')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <Share2 size={13} /> Share Joining Info
                </button>
                <button
                  type="button"
                  onClick={() => {
                    window.open(meeting.meetingUrl, '_blank');
                    setShowDropdown(false);
                  }}
                  style={{
                    width: '100%',
                    padding: '8px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    background: 'transparent',
                    border: 'none',
                    color: '#E5E7EB',
                    fontSize: '12px',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#2B2E35')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <ExternalLink size={13} /> Open Meeting
                </button>
                {onDelete && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowDropdown(false);
                      onDelete(meeting);
                    }}
                    style={{
                      width: '100%',
                      padding: '8px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      background: 'transparent',
                      border: 'none',
                      color: '#F87171',
                      fontSize: '12px',
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#2B2E35')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <Trash2 size={13} /> Delete Meeting
                  </button>
                )}
              </div>
            )}

            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '6px',
                background: 'transparent',
                border: 'none',
                color: '#9CA3AF',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#FFFFFF')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#9CA3AF')}
            >
              <X size={17} />
            </button>
          </div>
        </div>

        {/* Title */}
        <h2
          style={{
            margin: '6px 0 16px',
            fontSize: '22px',
            fontWeight: 800,
            color: '#FFFFFF',
            letterSpacing: '-0.3px',
            wordBreak: 'break-word',
          }}
        >
          {meeting.name}
        </h2>

        {/* Row 1: Calendar Date */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
          <CalendarIcon size={16} color="#9CA3AF" style={{ flexShrink: 0 }} />
          <span style={{ fontSize: '13.5px', color: '#D1D5DB', fontWeight: 500 }}>
            {formattedDate}
          </span>
        </div>

        {/* Row 2: Location / Meeting Link */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: meeting.passcode ? '12px' : '18px' }}>
          <MapPin size={16} color="#9CA3AF" style={{ flexShrink: 0 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
            <a
              href={meeting.meetingUrl}
              target="_blank"
              rel="noreferrer"
              title="Click to open meeting room"
              style={{
                fontSize: '13.5px',
                color: '#93C5FD',
                textDecoration: 'underline',
                fontWeight: 500,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
              }}
            >
              {meeting.meetingUrl}
            </a>
            <button
              type="button"
              aria-label="Copy meeting link"
              title="Copy link"
              onClick={handleCopyLink}
              style={{
                background: 'transparent',
                border: 'none',
                color: copiedLink ? '#34D399' : '#9CA3AF',
                cursor: 'pointer',
                padding: '2px',
                display: 'flex',
                alignItems: 'center',
                flexShrink: 0,
              }}
            >
              {copiedLink ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
        </div>

        {/* Passcode Row (if configured) */}
        {meeting.passcode && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px' }}>
            <Lock size={16} color="#FBBF24" style={{ flexShrink: 0 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
              <span style={{ fontSize: '13px', color: '#D1D5DB' }}>
                Passcode: <strong style={{ color: '#FDE047', letterSpacing: '0.5px' }}>{meeting.passcode}</strong>
              </span>
              <button
                type="button"
                aria-label="Copy passcode"
                title="Copy passcode"
                onClick={handleCopyPasscode}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: copiedPasscode ? '#34D399' : '#9CA3AF',
                  cursor: 'pointer',
                  padding: '2px',
                  display: 'flex',
                  alignItems: 'center',
                  flexShrink: 0,
                }}
              >
                {copiedPasscode ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          </div>
        )}

        {/* Attendees Section */}
        <div style={{ marginTop: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Users size={16} color="#9CA3AF" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: '14.5px', fontWeight: 700, color: '#FFFFFF' }}>Attendees</span>
            <span
              style={{
                backgroundColor: '#1E2433',
                color: '#93C5FD',
                fontSize: '11px',
                fontWeight: 700,
                padding: '1px 7px',
                borderRadius: '10px',
                marginLeft: '2px',
              }}
            >
              {totalAttendees}
            </span>
            <button
              type="button"
              aria-label="Copy attendees"
              title="Copy attendee list and invite"
              onClick={handleCopyAllAttendees}
              style={{
                background: 'transparent',
                border: 'none',
                color: copiedAttendees ? '#34D399' : '#9CA3AF',
                cursor: 'pointer',
                padding: '2px',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              {copiedAttendees ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>

          <div style={{ fontSize: '12px', color: '#9CA3AF', margin: '5px 0 14px 26px' }}>
            {confirmedCount} confirmed
            {awaitingCount > 0 ? `, ${awaitingCount} awaiting response` : ''}
            {declinedCount > 0 ? `, ${declinedCount} declined` : ''}
          </div>

          {/* Attendees List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginLeft: '2px' }}>
            {/* Organizer */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  backgroundColor: '#432349',
                  color: '#D8B4FE',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '11px',
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {organizerInitials}
              </div>

              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#FFFFFF' }}>
                    {organizerName}
                  </span>
                  {organizerEmail && (
                    <span
                      style={{
                        fontSize: '12px',
                        color: '#9CA3AF',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: '150px',
                      }}
                    >
                      {organizerEmail}
                    </span>
                  )}
                  {organizerEmail && (
                    <button
                      type="button"
                      aria-label="Copy email"
                      title="Copy email"
                      onClick={() => handleCopyEmail(organizerEmail)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: copiedEmail === organizerEmail ? '#34D399' : '#9CA3AF',
                        cursor: 'pointer',
                        padding: '1px',
                        display: 'inline-flex',
                        alignItems: 'center',
                      }}
                    >
                      {copiedEmail === organizerEmail ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                  )}
                  {organizerEmail && (
                    <a
                      href={`mailto:${organizerEmail}`}
                      aria-label="Send email"
                      title="Send email"
                      style={{ color: '#9CA3AF', display: 'inline-flex', alignItems: 'center' }}
                    >
                      <Mail size={12} />
                    </a>
                  )}
                  <span style={{ fontSize: '11.5px', color: '#9CA3AF' }}>(organizer)</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '2px' }}>
                  <CheckCircle2 size={13} color="#34D399" />
                  <span style={{ fontSize: '11.5px', color: '#34D399' }}>Invitation accepted</span>
                </div>
              </div>
            </div>

            {/* Invitees */}
            {invitees.map((inv, idx) => {
              const invInitials = inv.initials || getInitials(inv.name || inv.email);
              const displayName = inv.name || formatDisplayName(inv.email);
              const isAccepted = inv.status === 'accepted';
              const isDeclined = inv.status === 'declined';

              return (
                <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                  <div
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      backgroundColor: isAccepted ? '#133529' : isDeclined ? '#3B1818' : '#38321D',
                      color: isAccepted ? '#34D399' : isDeclined ? '#F87171' : '#FDE047',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '11px',
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {invInitials}
                  </div>

                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: '#FFFFFF' }}>
                        {displayName}
                      </span>
                      <span
                        style={{
                          fontSize: '12px',
                          color: '#9CA3AF',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          maxWidth: '180px',
                        }}
                      >
                        {inv.email}
                      </span>
                      <button
                        type="button"
                        aria-label="Copy email"
                        title="Copy email"
                        onClick={() => handleCopyEmail(inv.email)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: copiedEmail === inv.email ? '#34D399' : '#9CA3AF',
                          cursor: 'pointer',
                          padding: '1px',
                          display: 'inline-flex',
                          alignItems: 'center',
                        }}
                      >
                        {copiedEmail === inv.email ? <Check size={12} /> : <Copy size={12} />}
                      </button>
                      <a
                        href={`mailto:${inv.email}`}
                        aria-label="Send email"
                        title="Send email"
                        style={{ color: '#9CA3AF', display: 'inline-flex', alignItems: 'center' }}
                      >
                        <Mail size={12} />
                      </a>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '2px' }}>
                      {isAccepted ? (
                        <>
                          <CheckCircle2 size={13} color="#34D399" />
                          <span style={{ fontSize: '11.5px', color: '#34D399' }}>Invitation accepted</span>
                        </>
                      ) : isDeclined ? (
                        <>
                          <XCircle size={13} color="#F87171" />
                          <span style={{ fontSize: '11.5px', color: '#F87171' }}>Invitation declined</span>
                        </>
                      ) : (
                        <>
                          <MinusCircle size={13} color="#9CA3AF" />
                          <span style={{ fontSize: '11.5px', color: '#9CA3AF' }}>Awaiting response</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Bottom Actions */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            marginTop: '24px',
            paddingTop: '16px',
            borderTop: '1px solid #272A32',
            flexWrap: 'wrap',
          }}
        >
          {/* Share Joining Info Button */}
          <button
            type="button"
            onClick={() => setShowShareModal(true)}
            title="Share joining info via WhatsApp, Email, Telegram, or copy message"
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              backgroundColor: '#1E1B4B',
              border: '1px solid #4F46E5',
              color: '#A5B4FC',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#4F46E5';
              e.currentTarget.style.color = '#FFFFFF';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#1E1B4B';
              e.currentTarget.style.color = '#A5B4FC';
            }}
          >
            <Share2 size={14} />
            Share
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              onClick={() => {
                if (onMoreDetails) onMoreDetails(meeting);
                else window.open(meeting.meetingUrl, '_blank');
              }}
              style={{
                padding: '8px 14px',
                borderRadius: '8px',
                backgroundColor: '#23262D',
                border: '1px solid #363A44',
                color: '#E5E7EB',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'background-color 0.15s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#2D313A')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#23262D')}
            >
              More details
            </button>

            <button
              type="button"
              onClick={() => {
                if (onEdit) onEdit(meeting);
                onClose();
              }}
              style={{
                padding: '8px 14px',
                borderRadius: '8px',
                backgroundColor: '#23262D',
                border: '1px solid #363A44',
                color: '#E5E7EB',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'background-color 0.15s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#2D313A')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#23262D')}
            >
              <Pencil size={13} />
              Edit
            </button>
          </div>
        </div>
      </div>

      {/* Google Meet style Share Joining Info Modal */}
      <ShareMeetingModal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        meeting={{
          name: meeting.name,
          meetingUrl: meeting.meetingUrl,
          roomSlug: meeting.roomSlug,
          scheduledAt: meeting.scheduledAt,
          passcode: meeting.passcode,
          hostName: organizerName,
          description: meeting.description,
        }}
      />
    </div>
  );
}

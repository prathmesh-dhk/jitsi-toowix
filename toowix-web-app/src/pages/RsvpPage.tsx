import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircle2, XCircle, Calendar, Clock, Video, Lock, Copy, Check, Share2, ArrowRight } from 'lucide-react';
import { ShareMeetingModal } from '../components/ShareMeetingModal';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000';

interface IMeetingRsvpData {
  id: string;
  name: string;
  roomSlug: string;
  scheduledAt: string | null;
  passcode?: string | null;
  hostName: string;
  meetingUrl: string;
}

export function RsvpPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const meetingId = searchParams.get('meetingId') || '';
  const email = searchParams.get('email') || '';
  const initialAction = searchParams.get('response') || searchParams.get('action') || 'accepted';

  const [currentStatus, setCurrentStatus] = useState<'accepted' | 'declined'>(
    initialAction === 'declined' || initialAction === 'reject' ? 'declined' : 'accepted'
  );
  const [stage, setStage] = useState<'choose' | 'thanks'>('choose');
  const [meeting, setMeeting] = useState<IMeetingRsvpData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedPasscode, setCopiedPasscode] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);

  const submitRsvp = async (responseType: 'accepted' | 'declined' | 'view') => {
    if (!meetingId || !email) {
      setError('Invalid or incomplete invitation link.');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const res = await fetch(`${BACKEND_URL}/api/meetings/rsvp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingId, email, response: responseType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update RSVP');
      setMeeting(data.meeting);
      if (responseType !== 'view') {
        setCurrentStatus(responseType);
        setStage('thanks');
      }
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Could not record RSVP response.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Opening the emailed link only loads the invitation; the guest picks Accept or Decline here.
    submitRsvp('view');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId, email]);

  const handleCopyLink = () => {
    if (!meeting?.meetingUrl) return;
    navigator.clipboard.writeText(meeting.meetingUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleCopyPasscode = () => {
    if (!meeting?.passcode) return;
    navigator.clipboard.writeText(meeting.passcode);
    setCopiedPasscode(true);
    setTimeout(() => setCopiedPasscode(false), 2000);
  };

  const handleShareWhatsApp = () => {
    if (!meeting) return;
    const dateStr = meeting.scheduledAt
      ? new Date(meeting.scheduledAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
      : 'Starting soon';

    let text = `*Meeting Invitation: ${meeting.name}*\n` +
      `📅 Date & Time: ${dateStr}\n` +
      `🔗 Meeting Link: ${meeting.meetingUrl}\n`;

    if (meeting.passcode) {
      text += `🔑 Passcode: ${meeting.passcode}\n`;
    }

    text += `\nHosted by ${meeting.hostName} on Toowix Meet.`;
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
  };

  const formattedDateTime = meeting?.scheduledAt
    ? new Date(meeting.scheduledAt).toLocaleString(undefined, {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'Starting soon';

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--color-bg)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '96px 24px 32px',
        fontFamily: 'var(--font-family)',
      }}
    >
      <button
        type="button"
        onClick={() => navigate('/')}
        aria-label="Go to Toowix Meet home"
        style={{
          position: 'fixed', top: '24px', left: '28px', display: 'flex', alignItems: 'center', gap: '10px',
          padding: 0, background: 'transparent', color: 'var(--color-text-primary)', border: 'none', cursor: 'pointer',
        }}
      >
        <img src="/assets/toowix-logo.svg" alt="" width="34" height="34" style={{ display: 'block' }} />
        <span style={{ fontSize: '20px', fontWeight: 700, letterSpacing: '-0.35px' }}>
          Toowix <span style={{ color: '#6366F1' }}>Meet</span>
        </span>
      </button>

      {/* Main Card */}
      <div
        style={{
          width: '100%',
          maxWidth: '540px',
          background: 'var(--color-card)',
          borderRadius: 'var(--radius-xl)',
          border: '1px solid var(--color-card-border)',
          boxShadow: 'var(--shadow-lg)',
          padding: '36px',
          boxSizing: 'border-box',
          color: 'var(--color-text-primary)',
        }}
      >
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                border: '3px solid var(--color-border)',
                borderTopColor: 'var(--color-primary)',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
                margin: '0 auto 16px',
              }}
            />
            <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px', margin: 0 }}>Loading invitation...</p>
          </div>
        ) : error ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <XCircle size={38} color="var(--color-error)" style={{ margin: '0 auto 14px' }} />
            <h2 style={{ fontSize: '22px', fontWeight: 700, margin: '0 0 8px', color: 'var(--color-text-primary)' }}>
              Invitation Not Found
            </h2>
            <p style={{ fontSize: '14px', color: 'var(--color-text-secondary)', margin: '0 0 24px' }}>{error}</p>
            <button
              onClick={() => navigate('/')}
              style={{
                padding: '10px 20px',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-primary)',
                color: '#FFFFFF',
                fontWeight: 600,
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              Go to Home
            </button>
          </div>
        ) : stage === 'choose' ? (
          <div style={{ textAlign: 'center' }}>
            <h1 style={{ fontSize: '26px', lineHeight: 1.25, fontWeight: 700, letterSpacing: '-0.03em', margin: '0 0 8px', color: 'var(--color-text-primary)' }}>
              You&apos;re invited{meeting ? `: ${meeting.name}` : ''}
            </h1>
            <p style={{ fontSize: '14px', color: 'var(--color-text-secondary)', margin: '0 0 26px' }}>
              {meeting ? `${meeting.hostName} invited ${email}. Will you attend?` : 'Will you attend?'}
            </p>
            {meeting && (
              <div style={{ background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', padding: '18px', marginBottom: '24px', textAlign: 'left' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', color: 'var(--color-text-secondary)', marginBottom: '10px' }}>
                  <Calendar size={16} color="var(--color-primary)" style={{ flexShrink: 0 }} />
                  <span>{formattedDateTime}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                  <Video size={16} color="var(--color-primary)" style={{ flexShrink: 0 }} />
                  <span>Hosted by <strong>{meeting.hostName}</strong></span>
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                type="button"
                onClick={() => submitRsvp('accepted')}
                style={{ flex: 1, height: '46px', borderRadius: 'var(--radius-md)', background: 'var(--color-primary)', color: '#FFFFFF', fontSize: '14px', fontWeight: 650, border: 'none', cursor: 'pointer', boxShadow: '0 4px 12px rgba(79, 70, 229, 0.2)' }}
              >
                Accept
              </button>
              <button
                type="button"
                onClick={() => submitRsvp('declined')}
                style={{ flex: 1, height: '46px', borderRadius: 'var(--radius-md)', background: 'transparent', color: 'var(--color-text-secondary)', fontSize: '14px', fontWeight: 650, border: '1px solid var(--color-border)', cursor: 'pointer' }}
              >
                Decline
              </button>
            </div>
          </div>
        ) : (
          <div>
            {/* Status Header */}
            {currentStatus === 'accepted' ? (
              <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                <h1 style={{ fontSize: '26px', lineHeight: 1.25, fontWeight: 700, letterSpacing: '-0.03em', margin: '0 0 8px', color: 'var(--color-text-primary)' }}>
                  Thank you! You&apos;re attending.
                </h1>
                <p style={{ fontSize: '14px', color: 'var(--color-text-secondary)', margin: 0 }}>
                  Your RSVP has been confirmed for <strong>{email}</strong>.
                </p>
              </div>
            ) : (
              <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                <h1 style={{ fontSize: '26px', lineHeight: 1.25, fontWeight: 700, letterSpacing: '-0.03em', margin: '0 0 8px', color: 'var(--color-text-primary)' }}>
                  Thank you for letting us know
                </h1>
                <p style={{ fontSize: '14px', color: 'var(--color-text-secondary)', margin: 0 }}>
                  You have declined this meeting invitation.
                </p>
              </div>
            )}

            {/* Meeting Details Box */}
            {meeting && (
              <div
                style={{
                  background: 'var(--color-bg-subtle)',
                  borderRadius: 'var(--radius-lg)',
                  border: '1px solid var(--color-border)',
                  padding: '18px',
                  marginBottom: '24px',
                }}
              >
                <div style={{ fontSize: '17px', fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: '16px', letterSpacing: '-0.01em' }}>
                  {meeting.name}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                    <Calendar size={16} color="var(--color-primary)" style={{ flexShrink: 0 }} />
                    <span>{formattedDateTime}</span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                    <Video size={16} color="var(--color-primary)" style={{ flexShrink: 0 }} />
                    <span>Hosted by <strong>{meeting.hostName}</strong></span>
                  </div>

                  {meeting.passcode && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                      <Lock size={16} color="var(--color-warning)" style={{ flexShrink: 0 }} />
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>Passcode: <strong style={{ color: 'var(--color-text-primary)' }}>{meeting.passcode}</strong></span>
                        <button
                          type="button"
                          onClick={handleCopyPasscode}
                          title="Copy passcode"
                          style={{ background: 'transparent', border: 'none', color: copiedPasscode ? 'var(--color-success)' : 'var(--color-text-muted)', cursor: 'pointer', padding: '1px' }}
                        >
                          {copiedPasscode ? <Check size={13} /> : <Copy size={13} />}
                        </button>
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                    <Clock size={16} color="var(--color-primary)" style={{ flexShrink: 0 }} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flex: 1 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, color: 'var(--color-text-secondary)' }}>
                        {meeting.meetingUrl}
                      </span>
                      <button
                        type="button"
                        onClick={handleCopyLink}
                        title="Copy meeting link"
                        style={{ background: 'transparent', border: 'none', color: copiedLink ? 'var(--color-success)' : 'var(--color-text-muted)', cursor: 'pointer', padding: '1px', flexShrink: 0 }}
                      >
                        {copiedLink ? <Check size={13} /> : <Copy size={13} />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            {meeting && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {currentStatus === 'accepted' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => navigate(`/meet/${encodeURIComponent(meeting.roomSlug)}`)}
                      style={{
                        height: '46px',
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--color-primary)',
                        color: '#FFFFFF',
                        fontSize: '14px',
                        fontWeight: 650,
                        border: 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        boxShadow: '0 4px 12px rgba(79, 70, 229, 0.22)',
                      }}
                    >
                      <Video size={16} /> Join Video Meeting <ArrowRight size={15} />
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowShareModal(true)}
                      style={{
                        height: '44px',
                        borderRadius: 'var(--radius-md)',
                        background: 'transparent',
                        border: '1px solid var(--color-border)',
                        color: 'var(--color-text-primary)',
                        fontSize: '13.5px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        transition: 'all 0.15s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'var(--color-primary)';
                        e.currentTarget.style.color = '#FFFFFF';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.color = 'var(--color-text-primary)';
                      }}
                    >
                      <Share2 size={15} /> Share Joining Info
                    </button>

                    <div style={{ textAlign: 'center', marginTop: '8px' }}>
                      <button
                        type="button"
                        onClick={() => submitRsvp('declined')}
                        style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted)', fontSize: '12px', textDecoration: 'underline', cursor: 'pointer' }}
                      >
                        Changed your mind? Click here to decline
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => submitRsvp('accepted')}
                      style={{
                        height: '46px',
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--color-primary)',
                        color: '#FFFFFF',
                        fontSize: '14px',
                        fontWeight: 650,
                        border: 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                      }}
                    >
                      <CheckCircle2 size={16} /> Accept Invitation Instead
                    </button>

                    <button
                      type="button"
                      onClick={() => navigate('/')}
                      style={{
                        height: '44px',
                        borderRadius: 'var(--radius-md)',
                        background: 'transparent',
                        border: '1px solid var(--color-border)',
                        color: 'var(--color-text-primary)',
                        fontSize: '13.5px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Go to Home
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Google Meet style Share Joining Info Modal */}
      <ShareMeetingModal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        meeting={
          meeting
            ? {
                name: meeting.name,
                meetingUrl: meeting.meetingUrl,
                roomSlug: meeting.roomSlug,
                scheduledAt: meeting.scheduledAt,
                passcode: meeting.passcode,
                hostName: meeting.hostName,
              }
            : null
        }
      />
    </div>
  );
}

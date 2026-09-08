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
  const [meeting, setMeeting] = useState<IMeetingRsvpData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedPasscode, setCopiedPasscode] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);

  const submitRsvp = async (responseType: 'accepted' | 'declined') => {
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
      setCurrentStatus(responseType);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Could not record RSVP response.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    submitRsvp(currentStatus);
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
        backgroundColor: '#0F172A',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      {/* Brand Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '28px' }}>
        <div
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '10px',
            background: 'linear-gradient(135deg, #2E72B2 0%, #4799E3 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#FFFFFF',
            fontWeight: 800,
            fontSize: '20px',
          }}
        >
          T
        </div>
        <span style={{ fontSize: '24px', fontWeight: 800, color: '#FFFFFF', letterSpacing: '-0.5px' }}>
          Toowix <span style={{ color: '#6366F1' }}>Meet</span>
        </span>
      </div>

      {/* Main Card */}
      <div
        style={{
          width: '100%',
          maxWidth: '520px',
          backgroundColor: '#1E293B',
          borderRadius: '18px',
          border: '1px solid #334155',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          padding: '32px',
          boxSizing: 'border-box',
          color: '#F1F5F9',
        }}
      >
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                border: '3px solid #334155',
                borderTopColor: '#6366F1',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
                margin: '0 auto 16px',
              }}
            />
            <p style={{ color: '#94A3B8', fontSize: '14px', margin: 0 }}>Processing your invitation response...</p>
          </div>
        ) : error ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <XCircle size={44} color="#EF4444" style={{ margin: '0 auto 12px' }} />
            <h2 style={{ fontSize: '20px', fontWeight: 700, margin: '0 0 8px', color: '#F87171' }}>
              Invitation Not Found
            </h2>
            <p style={{ fontSize: '14px', color: '#94A3B8', margin: '0 0 20px' }}>{error}</p>
            <button
              onClick={() => navigate('/')}
              style={{
                padding: '10px 20px',
                borderRadius: '8px',
                backgroundColor: '#334155',
                color: '#FFFFFF',
                fontWeight: 600,
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              Go to Home
            </button>
          </div>
        ) : (
          <div>
            {/* Status Header */}
            {currentStatus === 'accepted' ? (
              <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                <div
                  style={{
                    width: '54px',
                    height: '54px',
                    borderRadius: '50%',
                    backgroundColor: 'rgba(16, 185, 129, 0.15)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 14px',
                  }}
                >
                  <CheckCircle2 size={32} color="#10B981" />
                </div>
                <h1 style={{ fontSize: '22px', fontWeight: 800, margin: '0 0 6px', color: '#FFFFFF' }}>
                  You&apos;re attending!
                </h1>
                <p style={{ fontSize: '13.5px', color: '#94A3B8', margin: 0 }}>
                  Your RSVP has been confirmed for <strong>{email}</strong>.
                </p>
              </div>
            ) : (
              <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                <div
                  style={{
                    width: '54px',
                    height: '54px',
                    borderRadius: '50%',
                    backgroundColor: 'rgba(239, 68, 68, 0.15)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 14px',
                  }}
                >
                  <XCircle size={32} color="#EF4444" />
                </div>
                <h1 style={{ fontSize: '22px', fontWeight: 800, margin: '0 0 6px', color: '#FFFFFF' }}>
                  Invitation Declined
                </h1>
                <p style={{ fontSize: '13.5px', color: '#94A3B8', margin: 0 }}>
                  You have declined this meeting invitation.
                </p>
              </div>
            )}

            {/* Meeting Details Box */}
            {meeting && (
              <div
                style={{
                  backgroundColor: '#0F172A',
                  borderRadius: '12px',
                  border: '1px solid #334155',
                  padding: '20px',
                  marginBottom: '24px',
                }}
              >
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#FFFFFF', marginBottom: '14px' }}>
                  {meeting.name}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', color: '#CBD5E1' }}>
                    <Calendar size={15} color="#818CF8" style={{ flexShrink: 0 }} />
                    <span>{formattedDateTime}</span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', color: '#CBD5E1' }}>
                    <Video size={15} color="#818CF8" style={{ flexShrink: 0 }} />
                    <span>Hosted by <strong>{meeting.hostName}</strong></span>
                  </div>

                  {meeting.passcode && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', color: '#CBD5E1' }}>
                      <Lock size={15} color="#FBBF24" style={{ flexShrink: 0 }} />
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>Passcode: <strong style={{ color: '#FDE047' }}>{meeting.passcode}</strong></span>
                        <button
                          type="button"
                          onClick={handleCopyPasscode}
                          title="Copy passcode"
                          style={{ background: 'transparent', border: 'none', color: copiedPasscode ? '#34D399' : '#94A3B8', cursor: 'pointer', padding: '1px' }}
                        >
                          {copiedPasscode ? <Check size={13} /> : <Copy size={13} />}
                        </button>
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', color: '#CBD5E1' }}>
                    <Clock size={15} color="#818CF8" style={{ flexShrink: 0 }} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flex: 1 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, color: '#93C5FD' }}>
                        {meeting.meetingUrl}
                      </span>
                      <button
                        type="button"
                        onClick={handleCopyLink}
                        title="Copy meeting link"
                        style={{ background: 'transparent', border: 'none', color: copiedLink ? '#34D399' : '#94A3B8', cursor: 'pointer', padding: '1px', flexShrink: 0 }}
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
                      onClick={() => window.open(meeting.meetingUrl, '_blank')}
                      style={{
                        height: '46px',
                        borderRadius: '10px',
                        backgroundColor: '#4F46E5',
                        color: '#FFFFFF',
                        fontSize: '14px',
                        fontWeight: 700,
                        border: 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        boxShadow: '0 4px 14px rgba(79, 70, 229, 0.4)',
                      }}
                    >
                      <Video size={16} /> Join Video Meeting <ArrowRight size={15} />
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowShareModal(true)}
                      style={{
                        height: '44px',
                        borderRadius: '10px',
                        backgroundColor: '#1E293B',
                        border: '1px solid #4F46E5',
                        color: '#A5B4FC',
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
                        e.currentTarget.style.backgroundColor = '#4F46E5';
                        e.currentTarget.style.color = '#FFFFFF';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = '#1E293B';
                        e.currentTarget.style.color = '#A5B4FC';
                      }}
                    >
                      <Share2 size={15} /> Share Joining Info
                    </button>

                    <div style={{ textAlign: 'center', marginTop: '8px' }}>
                      <button
                        type="button"
                        onClick={() => submitRsvp('declined')}
                        style={{ background: 'transparent', border: 'none', color: '#94A3B8', fontSize: '12px', textDecoration: 'underline', cursor: 'pointer' }}
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
                        borderRadius: '10px',
                        backgroundColor: '#10B981',
                        color: '#FFFFFF',
                        fontSize: '14px',
                        fontWeight: 700,
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
                        borderRadius: '10px',
                        backgroundColor: '#334155',
                        border: 'none',
                        color: '#F1F5F9',
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

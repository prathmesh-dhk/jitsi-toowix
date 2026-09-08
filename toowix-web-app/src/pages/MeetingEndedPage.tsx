import { useState, useEffect } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, RotateCcw, CheckCircle2, ShieldAlert, LogOut, Video, Timer, X } from 'lucide-react';
import { useTheme } from '../lib/theme';

export function MeetingEndedPage() {
  const { isDark } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  const state = (location.state || {}) as {
    roomId?: string;
    reason?: string;
    wasModerator?: boolean;
    durationMinutes?: number;
    displayName?: string;
  };

  const roomId = state.roomId || 'meeting';
  const reason = state.reason || 'You have left the meeting.';
  const savedDisplayName = state.displayName || '';
  const isEndedForEveryone = reason.toLowerCase().includes('ended') || reason.toLowerCase().includes('host');
  const isDenied = reason.toLowerCase().includes('denied');

  // 20-second automatic rejoin timer for accidental disconnects/exits
  const [secondsLeft, setSecondsLeft] = useState(20);
  const [isAutoRejoinActive, setIsAutoRejoinActive] = useState(true);

  useEffect(() => {
    if (isEndedForEveryone || isDenied || !isAutoRejoinActive || !roomId || roomId === 'meeting') {
      return;
    }

    if (secondsLeft <= 0) {
      navigate(`/meet/${encodeURIComponent(roomId)}`, { state: { displayName: savedDisplayName } });
      return;
    }

    const interval = setInterval(() => {
      setSecondsLeft((prev) => prev - 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [secondsLeft, isAutoRejoinActive, isEndedForEveryone, isDenied, roomId, navigate]);

  const progressPercent = Math.max(0, Math.min(100, (secondsLeft / 20) * 100));

  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100vw',
        backgroundColor: isDark ? '#202124' : '#F8F9FA',
        color: isDark ? '#E8EAED' : '#202124',
        fontFamily: "'Google Sans', Roboto, -apple-system, sans-serif",
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        boxSizing: 'border-box',
      }}
    >
      {/* Top Left Logo */}
      <header
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          padding: '20px 32px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
        }}
      >
        <div
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '10px',
            backgroundColor: '#4F46E5',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#FFFFFF',
          }}
        >
          <Video size={20} />
        </div>
        <span style={{ fontSize: '20px', fontWeight: 600, letterSpacing: '-0.3px' }}>
          Toowix <span style={{ color: '#4F46E5' }}>Meet</span>
        </span>
      </header>

      {/* Center Card */}
      <div
        style={{
          maxWidth: '520px',
          width: '100%',
          textAlign: 'center',
          padding: '40px 32px',
          borderRadius: '24px',
          backgroundColor: isDark ? '#2D2E30' : '#FFFFFF',
          boxShadow: isDark
            ? '0 10px 30px rgba(0, 0, 0, 0.4)'
            : '0 10px 30px rgba(0, 0, 0, 0.08)',
          border: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.08)' : '#E5E7EB'}`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            backgroundColor: isDenied
              ? 'rgba(234, 67, 53, 0.15)'
              : isEndedForEveryone
              ? 'rgba(251, 188, 4, 0.15)'
              : 'rgba(52, 168, 83, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '20px',
          }}
        >
          {isDenied ? (
            <ShieldAlert size={32} color="#EA4335" />
          ) : isEndedForEveryone ? (
            <LogOut size={30} color="#F59E0B" />
          ) : (
            <CheckCircle2 size={32} color="#34A853" />
          )}
        </div>

        <h1
          style={{
            fontSize: '28px',
            fontWeight: 500,
            margin: '0 0 8px',
            color: isDark ? '#FFFFFF' : '#202124',
          }}
        >
          {isDenied
            ? 'Entry Denied'
            : isEndedForEveryone
            ? 'Meeting Ended'
            : 'You Left the Meeting'}
        </h1>

        <p
          style={{
            fontSize: '14px',
            lineHeight: 1.5,
            color: isDark ? '#9AA0A6' : '#5F6368',
            margin: '0 0 20px',
            maxWidth: '380px',
          }}
        >
          {reason}
        </p>

        {/* 20-Second Accidental Exit Countdown Banner */}
        {!isEndedForEveryone && !isDenied && roomId && roomId !== 'meeting' && isAutoRejoinActive && (
          <div
            style={{
              width: '100%',
              backgroundColor: isDark ? 'rgba(79, 70, 229, 0.12)' : 'rgba(79, 70, 229, 0.08)',
              border: '1px solid rgba(79, 70, 229, 0.3)',
              borderRadius: '16px',
              padding: '14px 16px',
              marginBottom: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              boxSizing: 'border-box',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', textAlign: 'left' }}>
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    backgroundColor: '#4F46E5',
                    color: '#FFFFFF',
                    fontWeight: 700,
                    fontSize: '13px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 2px 8px rgba(79, 70, 229, 0.4)',
                    flexShrink: 0,
                  }}
                >
                  <Timer size={16} />
                </div>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: isDark ? '#FFFFFF' : '#1F2937' }}>
                    Left by mistake? Rejoining in <span style={{ color: '#818CF8' }}>{secondsLeft}s</span>
                  </div>
                  <div style={{ fontSize: '12px', color: isDark ? '#9CA3AF' : '#6B7280' }}>
                    Click below to rejoin immediately or wait for the timer.
                  </div>
                </div>
              </div>
              <button
                onClick={() => setIsAutoRejoinActive(false)}
                title="Cancel auto-rejoin"
                style={{
                  background: 'none',
                  border: 'none',
                  color: isDark ? '#9CA3AF' : '#6B7280',
                  cursor: 'pointer',
                  padding: '4px',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Visual Animated Progress Bar */}
            <div
              style={{
                width: '100%',
                height: '4px',
                borderRadius: '2px',
                backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${progressPercent}%`,
                  backgroundColor: '#4F46E5',
                  borderRadius: '2px',
                  transition: 'width 1s linear',
                }}
              />
            </div>
          </div>
        )}

        {/* Room badge */}
        {roomId && roomId !== 'meeting' && (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 16px',
              borderRadius: '20px',
              backgroundColor: isDark ? 'rgba(255, 255, 255, 0.06)' : '#F1F3F4',
              color: isDark ? '#BDC1C6' : '#3C4043',
              fontSize: '13px',
              fontWeight: 500,
              marginBottom: '24px',
            }}
          >
            Room code: <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{roomId}</span>
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center', width: '100%' }}>
          {!isEndedForEveryone && !isDenied && (
            <button
              onClick={() => navigate(`/meet/${encodeURIComponent(roomId)}`, { state: { displayName: savedDisplayName } })}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '12px 28px',
                borderRadius: '24px',
                backgroundColor: '#4F46E5',
                color: '#FFFFFF',
                border: 'none',
                fontWeight: 600,
                fontSize: '15px',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                boxShadow: '0 2px 8px rgba(79, 70, 229, 0.3)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#4338CA')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#4F46E5')}
            >
              <RotateCcw size={16} />
              <span>{isAutoRejoinActive ? `Rejoin now (${secondsLeft}s)` : 'Rejoin meeting'}</span>
            </button>
          )}

          <Link
            to="/"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px 28px',
              borderRadius: '24px',
              backgroundColor: 'transparent',
              color: isDark ? '#8AB4F8' : '#1A73E8',
              border: `1px solid ${isDark ? '#3C4043' : '#DADCE0'}`,
              fontWeight: 600,
              fontSize: '15px',
              textDecoration: 'none',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = isDark ? 'rgba(255,255,255,0.06)' : '#F8F9FA')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            <ArrowLeft size={16} /> Return to Home
          </Link>
        </div>
      </div>
    </div>
  );
}

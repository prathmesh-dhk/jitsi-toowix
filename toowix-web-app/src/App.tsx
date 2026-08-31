import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Link, useNavigate } from 'react-router-dom';
import { Video, Plus, Keyboard, ShieldCheck, Users, Sparkles } from 'lucide-react';
import { generateUniqueMeetingId, sanitizeCustomMeetingId } from './lib/meeting-id';

function HomePage() {
  const [customRoom, setCustomRoom] = useState('');
  const navigate = useNavigate();

  const handleStartInstant = () => {
    const newRoomId = generateUniqueMeetingId();
    navigate(`/meet/${newRoomId}`);
  };

  const handleJoinCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customRoom.trim()) return;
    const cleanRoom = sanitizeCustomMeetingId(customRoom);
    navigate(`/meet/${cleanRoom}`);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header / Navbar */}
      <header
        style={{
          height: '68px',
          borderBottom: '1px solid var(--color-border)',
          backgroundColor: 'var(--color-surface)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 32px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '9px',
              background: 'linear-gradient(135deg, #2E72B2 0%, #4799E3 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#FFFFFF',
              fontWeight: 700,
              fontSize: '20px',
            }}
          >
            T
          </div>
          <span style={{ fontSize: '22px', fontWeight: 700, letterSpacing: '-0.5px' }}>
            Toowix <span style={{ color: 'var(--color-primary)' }}>Meet</span>
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <Link
            to="/login"
            style={{
              padding: '8px 18px',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-text-primary)',
              fontWeight: 500,
              fontSize: '14px',
            }}
          >
            Sign In
          </Link>
          <Link
            to="/signup"
            style={{
              padding: '8px 18px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--color-primary)',
              color: '#FFFFFF',
              fontWeight: 600,
              fontSize: '14px',
              boxShadow: '0 2px 6px rgba(58, 134, 202, 0.3)',
            }}
          >
            Register Company
          </Link>
        </div>
      </header>

      {/* Hero Content */}
      <main
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px 24px',
          maxWidth: '1200px',
          margin: '0 auto',
          width: '100%',
        }}
      >
        <div style={{ maxWidth: '640px', textAlign: 'center' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 14px',
              backgroundColor: '#ECEEF4',
              borderRadius: '20px',
              color: 'var(--color-primary-dark)',
              fontSize: '13px',
              fontWeight: 600,
              marginBottom: '24px',
            }}
          >
            <Sparkles size={16} /> Enterprise Video Collaboration
          </div>

          <h1
            style={{
              fontSize: '44px',
              fontWeight: 700,
              lineHeight: 1.2,
              letterSpacing: '-0.02em',
              marginBottom: '16px',
            }}
          >
            Premium Video Meetings for Enterprise Teams
          </h1>

          <p
            style={{
              fontSize: '18px',
              color: 'var(--color-text-secondary)',
              lineHeight: 1.6,
              marginBottom: '36px',
            }}
          >
            Connect, collaborate, and celebrate securely from anywhere with crystal-clear audio and video powered by Toowix.
          </p>

          {/* Action Bar */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '16px',
              justifyContent: 'center',
              alignItems: 'center',
              marginBottom: '48px',
            }}
          >
            <button
              onClick={handleStartInstant}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '10px',
                padding: '14px 28px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--color-primary)',
                color: '#FFFFFF',
                fontSize: '16px',
                fontWeight: 600,
                boxShadow: '0 4px 14px rgba(58, 134, 202, 0.35)',
                transition: 'background-color 0.2s',
              }}
            >
              <Plus size={20} /> New Meeting
            </button>

            <form
              onSubmit={handleJoinCustom}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                padding: '4px 6px 4px 14px',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <Keyboard size={18} color="#717881" style={{ marginRight: '8px' }} />
              <input
                type="text"
                placeholder="Enter room code or link"
                value={customRoom}
                onChange={(e) => setCustomRoom(e.target.value)}
                style={{
                  border: 'none',
                  fontSize: '15px',
                  color: 'var(--color-text-primary)',
                  backgroundColor: 'transparent',
                  width: '200px',
                }}
              />
              <button
                type="submit"
                disabled={!customRoom.trim()}
                style={{
                  padding: '10px 18px',
                  borderRadius: '6px',
                  backgroundColor: customRoom.trim() ? 'var(--color-primary)' : '#E0E2E8',
                  color: customRoom.trim() ? '#FFFFFF' : '#717881',
                  fontWeight: 600,
                  fontSize: '14px',
                }}
              >
                Join
              </button>
            </form>
          </div>

          {/* Value Props */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '20px',
              borderTop: '1px solid var(--color-border-light)',
              paddingTop: '32px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'center' }}>
              <ShieldCheck size={20} color="var(--color-primary)" />
              <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--color-text-secondary)' }}>
                End-to-End Secure
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'center' }}>
              <Users size={20} color="var(--color-primary)" />
              <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--color-text-secondary)' }}>
                Company Workspaces
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'center' }}>
              <Video size={20} color="var(--color-primary)" />
              <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--color-text-secondary)' }}>
                HD Screen & Audio
              </span>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer
        style={{
          borderTop: '1px solid var(--color-border-light)',
          padding: '20px',
          textAlign: 'center',
          fontSize: '13px',
          color: 'var(--color-text-muted)',
          backgroundColor: 'var(--color-surface)',
        }}
      >
        &copy; {new Date().getFullYear()} Toowix Meet &bull; Enterprise Collaboration Platform
      </footer>
    </div>
  );
}

function MeetingRoomPage() {
  const roomId = window.location.pathname.split('/').pop() || 'lobby';
  const jitsiDomain = import.meta.env.VITE_JITSI_DOMAIN || 'meet.toowix.com';

  const queryParams = new URLSearchParams(window.location.search);
  const jwtToken = queryParams.get('jwt');

  // Decode JWT payload safely if provided
  let tokenUser: { name?: string; email?: string; avatar?: string } | null = null;
  let isModerator = false;

  if (jwtToken) {
    try {
      const payloadPart = jwtToken.split('.')[1];
      if (payloadPart) {
        const decodedStr = atob(payloadPart.replace(/-/g, '+').replace(/_/g, '/'));
        const decoded = JSON.parse(decodedStr);
        tokenUser = decoded.context?.user || null;
        isModerator = Boolean(decoded.context?.features?.moderator);
      }
    } catch (err) {
      console.warn('[MeetingRoomPage] Failed to parse JWT payload client-side:', err);
    }
  }

  const iframeSrc = jwtToken
    ? `https://${jitsiDomain}/${roomId}?jwt=${encodeURIComponent(jwtToken)}`
    : `https://${jitsiDomain}/${roomId}`;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#141B2B' }}>
      <div
        style={{
          height: '56px',
          backgroundColor: '#0E131F',
          color: '#FFFFFF',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 24px',
          borderBottom: '1px solid #232B3E',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontWeight: 600, fontSize: '15px' }}>
            Toowix Meet: <span style={{ color: '#3A86CA' }}>{roomId}</span>
          </span>

          {isModerator && (
            <span
              style={{
                backgroundColor: '#2778BC',
                color: '#FFFFFF',
                fontSize: '11px',
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: '12px',
                letterSpacing: '0.5px',
                textTransform: 'uppercase',
              }}
            >
              Host / Moderator
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {tokenUser && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {tokenUser.avatar ? (
                <img
                  src={tokenUser.avatar}
                  alt={tokenUser.name || 'User'}
                  style={{ width: '30px', height: '30px', borderRadius: '50%', border: '1px solid #3A86CA' }}
                />
              ) : (
                <div
                  style={{
                    width: '30px',
                    height: '30px',
                    borderRadius: '50%',
                    backgroundColor: '#3A86CA',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '13px',
                    fontWeight: 600,
                  }}
                >
                  {(tokenUser.name || 'U').charAt(0).toUpperCase()}
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, lineHeight: 1.2 }}>
                  {tokenUser.name || 'Participant'}
                </span>
                {tokenUser.email && (
                  <span style={{ fontSize: '11px', color: '#9CCAFF', lineHeight: 1.2 }}>
                    {tokenUser.email}
                  </span>
                )}
              </div>
            </div>
          )}

          <Link
            to="/"
            style={{
              color: '#9CCAFF',
              fontSize: '13px',
              fontWeight: 500,
              padding: '6px 12px',
              borderRadius: '6px',
              backgroundColor: 'rgba(255,255,255,0.05)',
            }}
          >
            &larr; Exit Meeting
          </Link>
        </div>
      </div>

      <iframe
        src={iframeSrc}
        allow="camera; microphone; display-capture; autoplay; clipboard-write; fullscreen"
        style={{
          width: '100%',
          flex: 1,
          border: 'none',
        }}
        title="Toowix Meeting Room"
      />
    </div>
  );
}

function PlaceholderPage({ title }: { title: string }) {
  return (
    <div style={{ padding: '60px 20px', textAlign: 'center' }}>
      <h2 style={{ fontSize: '28px', marginBottom: '12px' }}>{title}</h2>
      <p style={{ color: 'var(--color-text-secondary)', marginBottom: '24px' }}>
        This screen will be connected during Tuesday/Thursday sprint milestones.
      </p>
      <Link to="/" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>
        &larr; Return Home
      </Link>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/meet/:roomId" element={<MeetingRoomPage />} />
        <Route path="/login" element={<PlaceholderPage title="Toowix Login" />} />
        <Route path="/signup" element={<PlaceholderPage title="Company Registration & Signup" />} />
      </Routes>
    </BrowserRouter>
  );
}

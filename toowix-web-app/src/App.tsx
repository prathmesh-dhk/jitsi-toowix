import { AccountGuard } from './components/AccountGuard';
import { MeetingEndedPage } from './pages/MeetingEndedPage';
import React, { lazy, Suspense, useState } from 'react';
import { BrowserRouter, Routes, Route, Link, useNavigate, Navigate } from 'react-router-dom';
import { Video, Plus, Keyboard, ShieldCheck, Users, Sparkles } from 'lucide-react';
import { generateUniqueMeetingId, sanitizeCustomMeetingId } from './lib/meeting-id';
import { MeetingLinkExpiredPage } from './pages/MeetingLinkExpiredPage';

function HomePage() {
  const [customRoom, setCustomRoom] = useState('');
  const navigate = useNavigate();

  const handleStartInstant = () => {
    const newRoomId = `instant-${generateUniqueMeetingId()}`;
    // Free/unauthenticated instant meetings created from the public landing page are capped at
    // 30 minutes (like a free-tier call limit) -- flagged via navigation state rather than a
    // query param so it can't be stripped/edited by just visiting a bare /meet/:roomId URL.
    navigate(`/meet/${newRoomId}`, { state: { freeInstantMeeting: true } });
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
          minHeight: '68px',
          borderBottom: '1px solid var(--color-border)',
          backgroundColor: 'var(--color-surface)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'clamp(10px, 2.5vw, 0px) clamp(16px, 4vw, 32px)',
          flexWrap: 'wrap',
          gap: '8px',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
          <img
            src="/assets/toowix-logo.svg"
            alt="Toowix Logo"
            style={{ width: 'clamp(30px, 6vw, 38px)', height: 'clamp(30px, 6vw, 38px)', objectFit: 'contain', flexShrink: 0 }}
          />
          <span style={{ fontSize: 'clamp(17px, 4.5vw, 22px)', fontWeight: 700, letterSpacing: '-0.5px', whiteSpace: 'nowrap' }}>
            Toowix <span style={{ color: 'var(--color-primary)' }}>Meet</span>
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(6px, 2vw, 16px)' }}>
          <Link
            to="/login"
            style={{
              padding: 'clamp(6px, 1.5vw, 8px) clamp(10px, 3vw, 18px)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-text-primary)',
              fontWeight: 500,
              fontSize: 'clamp(13px, 3vw, 14px)',
              whiteSpace: 'nowrap',
            }}
          >
            Sign In
          </Link>
          <Link
            to="/signup"
            style={{
              padding: 'clamp(6px, 1.5vw, 8px) clamp(10px, 3vw, 18px)',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--color-primary)',
              color: '#FFFFFF',
              fontWeight: 600,
              fontSize: 'clamp(13px, 3vw, 14px)',
              boxShadow: '0 2px 6px rgba(58, 134, 202, 0.3)',
              whiteSpace: 'nowrap',
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
          padding: 'clamp(28px, 6vw, 40px) clamp(18px, 5vw, 24px)',
          maxWidth: '1200px',
          margin: '0 auto',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ maxWidth: '640px', width: '100%', textAlign: 'center' }}>
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
              marginBottom: 'clamp(16px, 4vw, 24px)',
            }}
          >
            <Sparkles size={16} /> Enterprise Video Collaboration
          </div>

          <h1
            style={{
              fontSize: 'clamp(28px, 7vw, 44px)',
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
              fontSize: 'clamp(15px, 3.5vw, 18px)',
              color: 'var(--color-text-secondary)',
              lineHeight: 1.6,
              marginBottom: 'clamp(24px, 6vw, 36px)',
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
              marginBottom: 'clamp(32px, 7vw, 48px)',
            }}
          >
            <button
              onClick={handleStartInstant}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px',
                padding: '14px 28px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--color-primary)',
                color: '#FFFFFF',
                fontSize: '16px',
                fontWeight: 600,
                boxShadow: '0 4px 14px rgba(58, 134, 202, 0.35)',
                transition: 'background-color 0.2s',
                flex: '1 1 220px',
                boxSizing: 'border-box',
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
                flex: '1 1 220px',
                boxSizing: 'border-box',
              }}
            >
              <Keyboard size={18} color="#717881" style={{ marginRight: '8px', flexShrink: 0 }} />
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
                  width: '100%',
                  minWidth: 0,
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
                  flexShrink: 0,
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
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
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

import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { EmailVerificationPage } from './pages/EmailVerificationPage';
import { ThemeProvider } from './lib/theme';
import { SettingsPage } from './pages/SettingsPage';
import { ProfileSection } from './components/settings/ProfileSection';
import { GeneralSection } from './components/settings/GeneralSection';
import { MeetingsSection } from './components/settings/MeetingsSection';
import { RecordingSection } from './components/settings/RecordingSection';
import { NotificationsSection } from './components/settings/NotificationsSection';
import { SecuritySection } from './components/settings/SecuritySection';
import { StorageSection } from './components/settings/StorageSection';
import { RsvpPage } from './pages/RsvpPage';
import { RecordingWatchPage } from './pages/RecordingWatchPage';

// The meeting implementation includes media previews, call controls, and optional meeting
// features. Loading it only on a /meet route keeps the marketing, auth, dashboard and RSVP
// routes light without delaying the actual meeting code once a participant opens a call.
const MeetingRoomPage = lazy(() => import('./pages/MeetingRoomPage').then(module => ({ default: module.MeetingRoomPage })));
const DirectMeetingRoomPage = lazy(() => import('./pages/DirectMeetingRoomPage').then(module => ({ default: module.DirectMeetingRoomPage })));

function MeetingRouteLoader() {
  return <main aria-live="polite" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: 'var(--color-text-secondary)' }}>Preparing meeting…</main>;
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/rsvp" element={<RsvpPage />} />
          <Route path="/recordings/:id" element={<RecordingWatchPage />} />
          <Route path="/recording/:id" element={<RecordingWatchPage />} />
          <Route element={<AccountGuard />}><Route path="/dashboard" element={<DashboardPage />} /></Route>
          <Route path="/meeting-ended" element={<MeetingEndedPage />} />
          <Route path="/meeting-link-expired" element={<MeetingLinkExpiredPage />} />
          <Route path="/home" element={<HomePage />} />
          <Route path="/meet/:roomId" element={<Suspense fallback={<MeetingRouteLoader />}><MeetingRoomPage /></Suspense>} />
          {/* New direct lib-jitsi-meet path -- no iframe, real tracks in real <video>
              elements. Separate route, zero risk to the working /meet/:roomId iframe flow. */}
          <Route path="/meet-direct/:roomId" element={<Suspense fallback={<MeetingRouteLoader />}><DirectMeetingRoomPage /></Suspense>} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signin" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/register" element={<SignupPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/verify-email" element={<EmailVerificationPage />} />
          <Route element={<AccountGuard />}>
          <Route path="/settings" element={<SettingsPage />}>
            <Route index element={<Navigate to="/settings/profile" replace />} />
            <Route path="profile" element={<ProfileSection />} />
            <Route path="general" element={<GeneralSection />} />
            <Route path="meetings" element={<MeetingsSection />} />
            <Route path="recording" element={<RecordingSection />} />
            <Route path="notifications" element={<NotificationsSection />} />
            <Route path="security" element={<SecuritySection />} />
            <Route path="storage" element={<StorageSection />} />
          </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}

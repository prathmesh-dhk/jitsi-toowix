import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Link, useNavigate, Navigate } from 'react-router-dom';
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

import { MeetingRoomPage } from './pages/MeetingRoomPage';
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

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/home" element={<HomePage />} />
          <Route path="/meet/:roomId" element={<MeetingRoomPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signin" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/register" element={<SignupPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/verify-email" element={<EmailVerificationPage />} />
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
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}

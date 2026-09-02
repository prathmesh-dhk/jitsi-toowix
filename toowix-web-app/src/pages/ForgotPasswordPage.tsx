import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, ArrowLeft, AlertCircle, Loader2, Sun, Moon } from 'lucide-react';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { useTheme } from '../lib/theme';

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000';
const TOOWIX_LOGO_URL = '/assets/toowix-logo.png';
const ARTWORK_URL = '/assets/signup-hero.png';

export function ForgotPasswordPage() {
  const { isDark, toggleTheme } = useTheme();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const navigate = useNavigate();

  const handleSendResetEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!email.trim()) {
      setErrorMessage('Please enter your email address.');
      return;
    }

    setIsLoading(true);
    try {
      // 1. Trigger Firebase Client Password Reset Email
      await sendPasswordResetEmail(auth, email.trim());

      // 2. Trigger Backend Anti-Enumeration Reset Endpoint Tue-BE-3
      try {
        await fetch(`${BACKEND_URL}/api/auth/forgot-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim() }),
        });
      } catch (backendErr) {
        console.warn('[Forgot Password Backend Sync] Optional sync notice:', backendErr);
      }

      setIsSent(true);
    } catch (err: any) {
      console.error('[Firebase Reset Password] Error:', err);
      if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-email') {
        setIsSent(true);
      } else {
        setErrorMessage(err.message || 'Failed to send password reset email.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: isDark ? '#0B0F19' : '#F1F3FF', // surface-container-low
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        padding: '24px 16px',
        boxSizing: 'border-box',
      }}
    >
      {/* Floating Card Container */}
      <main
        className="auth-card-container"
        style={{
          backgroundColor: isDark ? '#131B2E' : '#FFFFFF',
          border: `1px solid ${isDark ? '#1E293B' : '#E5E7EB'}`,
        }}
      >
        {/* Left Column: Form Section */}
        <section
          className="auth-form-column"
          style={{
            backgroundColor: isDark ? '#131B2E' : '#FFFFFF',
          }}
        >
          <div
            className="auth-form-wrapper"
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              padding: '48px 48px 24px 48px',
              width: '100%',
              maxWidth: '500px',
              margin: '0 auto',
            }}
          >
            {/* Brand Header & Theme Toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '32px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <img
                  alt="Toowix Logo"
                  src={TOOWIX_LOGO_URL}
                  style={{ width: '36px', height: '36px', objectFit: 'contain' }}
                />
                <span
                  style={{
                    fontFamily: "'Inter', sans-serif",
                    fontSize: '20px',
                    fontWeight: 600,
                    color: isDark ? '#F9FAFB' : '#141B2B',
                    letterSpacing: '-0.01em',
                  }}
                >
                  Toowix Meet
                </span>
              </div>

              {/* Theme Toggle Button */}
              <button
                onClick={toggleTheme}
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  backgroundColor: isDark ? '#1E293B' : '#F3F4F6',
                  border: `1px solid ${isDark ? '#334155' : '#E5E7EB'}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: isDark ? '#FBBF24' : '#4B5563',
                  cursor: 'pointer',
                }}
                title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              >
                {isDark ? <Sun size={17} /> : <Moon size={17} />}
              </button>
            </div>

            {!isSent ? (
              /* State 1: Input Form */
              <div>
                <div style={{ marginBottom: '28px' }}>
                  <h1
                    style={{
                      fontSize: '28px',
                      fontWeight: 700,
                      lineHeight: '34px',
                      letterSpacing: '-0.02em',
                      color: isDark ? '#F9FAFB' : '#141B2B',
                      marginBottom: '8px',
                    }}
                  >
                    Forgot Password?
                  </h1>
                  <p
                    style={{
                      fontSize: '14px',
                      fontWeight: 400,
                      lineHeight: '20px',
                      color: isDark ? '#9CA3AF' : '#777587',
                    }}
                  >
                    No worries. Enter your email and we'll send you a reset link.
                  </p>
                </div>

                {errorMessage && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '12px 14px',
                      borderRadius: '8px',
                      marginBottom: '20px',
                      backgroundColor: isDark ? 'rgba(239, 68, 68, 0.15)' : '#FEF2F2',
                      border: `1px solid ${isDark ? 'rgba(239, 68, 68, 0.3)' : '#FECACA'}`,
                      color: isDark ? '#F87171' : '#991B1B',
                      fontSize: '13px',
                      lineHeight: '18px',
                    }}
                  >
                    <AlertCircle size={16} style={{ flexShrink: 0 }} />
                    <span>{errorMessage}</span>
                  </div>
                )}

                <form onSubmit={handleSendResetEmail} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <div>
                    <label
                      htmlFor="reset_email"
                      style={{
                        display: 'block',
                        fontSize: '13px',
                        fontWeight: 500,
                        lineHeight: '18px',
                        color: isDark ? '#F9FAFB' : '#141B2B',
                        marginBottom: '6px',
                      }}
                    >
                      Email
                    </label>
                    <input
                      id="reset_email"
                      type="email"
                      placeholder="your@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={isLoading}
                      required
                      style={{
                        width: '100%',
                        height: '44px',
                        padding: '0 16px',
                        borderRadius: '8px',
                        border: `1px solid ${isDark ? '#334155' : '#D1D5DB'}`,
                        backgroundColor: isDark ? '#0F172A' : '#FFFFFF',
                        color: isDark ? '#F9FAFB' : '#141B2B',
                        fontSize: '14px',
                        transition: 'all 0.15s ease',
                      }}
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = '#4F46E5';
                        e.currentTarget.style.boxShadow = '0 0 0 4px rgba(79, 70, 229, 0.1)';
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = isDark ? '#334155' : '#D1D5DB';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading}
                    style={{
                      width: '100%',
                      height: '44px',
                      backgroundColor: '#4F46E5',
                      color: '#FFFFFF',
                      fontSize: '14px',
                      fontWeight: 500,
                      lineHeight: '20px',
                      borderRadius: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      cursor: isLoading ? 'not-allowed' : 'pointer',
                      transition: 'background-color 0.15s ease',
                      marginTop: '4px',
                    }}
                    onMouseEnter={(e) => {
                      if (!isLoading) e.currentTarget.style.backgroundColor = '#4338CA';
                    }}
                    onMouseLeave={(e) => {
                      if (!isLoading) e.currentTarget.style.backgroundColor = '#4F46E5';
                    }}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
                        Sending reset link...
                      </>
                    ) : (
                      'Send Reset Link'
                    )}
                  </button>
                </form>

                <div style={{ marginTop: '28px' }}>
                  <Link
                    to="/login"
                    onClick={(e) => {
                      e.preventDefault();
                      navigate('/login');
                    }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      color: isDark ? '#818CF8' : '#4F46E5',
                      fontSize: '14px',
                      fontWeight: 500,
                      textDecoration: 'none',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = '#4338CA')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = isDark ? '#818CF8' : '#4F46E5')}
                  >
                    <ArrowLeft size={16} />
                    Back to Sign In
                  </Link>
                </div>
              </div>
            ) : (
              /* State 2: Sent Confirmation */
              <div style={{ textAlign: 'center' }}>
                <div
                  style={{
                    width: '64px',
                    height: '64px',
                    borderRadius: '50%',
                    backgroundColor: isDark ? 'rgba(99, 102, 241, 0.2)' : 'rgba(79, 70, 229, 0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 20px auto',
                    color: isDark ? '#818CF8' : '#4F46E5',
                  }}
                >
                  <Mail size={30} />
                </div>

                <h2
                  style={{
                    fontSize: '24px',
                    fontWeight: 600,
                    color: isDark ? '#F9FAFB' : '#141B2B',
                    marginBottom: '10px',
                  }}
                >
                  Check your email
                </h2>
                <p
                  style={{
                    fontSize: '14px',
                    fontWeight: 400,
                    lineHeight: '22px',
                    color: isDark ? '#9CA3AF' : '#777587',
                    marginBottom: '28px',
                  }}
                >
                  We sent a password reset link to<br />
                  <strong style={{ color: isDark ? '#F9FAFB' : '#141B2B', fontWeight: 600 }}>{email}</strong>
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <button
                    type="button"
                    onClick={() => setIsSent(false)}
                    style={{
                      width: '100%',
                      height: '44px',
                      backgroundColor: 'transparent',
                      border: `1px solid ${isDark ? '#818CF8' : '#4F46E5'}`,
                      color: isDark ? '#818CF8' : '#4F46E5',
                      fontSize: '14px',
                      fontWeight: 500,
                      borderRadius: '8px',
                      cursor: 'pointer',
                      transition: 'background-color 0.15s ease',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = isDark ? 'rgba(99, 102, 241, 0.15)' : 'rgba(79, 70, 229, 0.05)')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    Resend email
                  </button>

                  <div>
                    <Link
                      to="/login"
                      onClick={(e) => {
                        e.preventDefault();
                        navigate('/login');
                      }}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        color: isDark ? '#818CF8' : '#4F46E5',
                        fontSize: '14px',
                        fontWeight: 500,
                        textDecoration: 'none',
                        cursor: 'pointer',
                        marginTop: '8px',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = '#4338CA')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = isDark ? '#818CF8' : '#4F46E5')}
                    >
                      <ArrowLeft size={16} />
                      Back to Sign In
                    </Link>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer Copyright */}
          <div style={{ paddingBottom: '20px', textAlign: 'center' }}>
            <p style={{ fontSize: '12px', color: isDark ? '#6B7280' : '#777587' }}>
              &copy; 2026 Toowix. ALL RIGHTS RESERVED.
            </p>
          </div>
        </section>

        {/* Right Column: 3D Frosted Glass Logo Hero Image */}
        <section className="auth-hero-column">
          <img
            src={ARTWORK_URL}
            alt="Toowix Meet Forgot Password Artwork"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        </section>
      </main>
    </div>
  );
}

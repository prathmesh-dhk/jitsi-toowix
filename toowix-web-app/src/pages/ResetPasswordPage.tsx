import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, AlertCircle, CheckCircle2, Loader2, Sun, Moon } from 'lucide-react';
import { verifyPasswordResetCode, confirmPasswordReset } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { useTheme } from '../lib/theme';

const TOOWIX_LOGO_URL = '/assets/toowix-logo.svg';
const ARTWORK_URL = '/assets/signup-hero.png';

type PageState = 'verifying' | 'ready' | 'invalid' | 'submitting' | 'success';

export function ResetPasswordPage() {
  const { isDark, toggleTheme } = useTheme();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const oobCode = searchParams.get('oobCode');

  const [pageState, setPageState] = useState<PageState>('verifying');
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const passwordStrength = useMemo(() => {
    if (!password) return 0;
    let score = 0;
    if (password.length >= 8) score += 1;
    if (/[A-Z]/.test(password)) score += 1;
    if (/[0-9]/.test(password)) score += 1;
    if (/[^A-Za-z0-9]/.test(password)) score += 1;
    return score;
  }, [password]);

  const strengthLabel = useMemo(() => {
    if (!password) return '';
    if (passwordStrength <= 1) return 'Weak password';
    if (passwordStrength === 2) return 'Fair password';
    if (passwordStrength === 3) return 'Good password';
    return 'Strong password';
  }, [password, passwordStrength]);

  const strengthColor = useMemo(() => {
    if (passwordStrength <= 1) return '#EF4444';
    if (passwordStrength === 2) return '#F59E0B';
    if (passwordStrength === 3) return '#3B82F6';
    return '#22C55E';
  }, [passwordStrength]);

  useEffect(() => {
    if (!oobCode) {
      setPageState('invalid');
      setErrorMessage('This reset link is missing or malformed. Please request a new one.');
      return;
    }

    verifyPasswordResetCode(auth, oobCode)
      .then((verifiedEmail) => {
        setEmail(verifiedEmail);
        setPageState('ready');
      })
      .catch((err: any) => {
        console.error('[Reset Password] Invalid or expired code:', err);
        setPageState('invalid');
        setErrorMessage('This reset link is invalid or has expired. Please request a new one.');
      });
  }, [oobCode]);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (password.length < 8) {
      setErrorMessage('Password must be at least 8 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match. Please re-enter your password.');
      return;
    }

    setPageState('submitting');
    try {
      await confirmPasswordReset(auth, oobCode as string, password);
      setPageState('success');
    } catch (err: any) {
      console.error('[Reset Password] Error:', err);
      if (err.code === 'auth/expired-action-code' || err.code === 'auth/invalid-action-code') {
        setPageState('invalid');
        setErrorMessage('This reset link is invalid or has expired. Please request a new one.');
      } else if (err.code === 'auth/weak-password') {
        setErrorMessage('The password is too weak. Please use at least 8 characters.');
        setPageState('ready');
      } else {
        setErrorMessage(err.message || 'Failed to reset password.');
        setPageState('ready');
      }
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
        backgroundColor: isDark ? '#0B0F19' : '#F1F3FF',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        padding: '24px 16px',
        boxSizing: 'border-box',
      }}
    >
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

            {pageState === 'verifying' && (
              <div style={{ textAlign: 'center', padding: '40px 0' }}>
                <Loader2
                  size={28}
                  style={{ animation: 'spin 1s linear infinite', color: isDark ? '#818CF8' : '#4F46E5' }}
                />
                <p style={{ marginTop: '16px', fontSize: '14px', color: isDark ? '#9CA3AF' : '#777587' }}>
                  Verifying your reset link...
                </p>
              </div>
            )}

            {pageState === 'invalid' && (
              <div style={{ textAlign: 'center' }}>
                <div
                  style={{
                    width: '64px',
                    height: '64px',
                    borderRadius: '50%',
                    backgroundColor: isDark ? 'rgba(239, 68, 68, 0.15)' : '#FEF2F2',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 20px auto',
                    color: isDark ? '#F87171' : '#DC2626',
                  }}
                >
                  <AlertCircle size={30} />
                </div>
                <h2 style={{ fontSize: '24px', fontWeight: 600, color: isDark ? '#F9FAFB' : '#141B2B', marginBottom: '10px' }}>
                  Link expired
                </h2>
                <p style={{ fontSize: '14px', lineHeight: '22px', color: isDark ? '#9CA3AF' : '#777587', marginBottom: '28px' }}>
                  {errorMessage}
                </p>
                <Link
                  to="/forgot-password"
                  onClick={(e) => {
                    e.preventDefault();
                    navigate('/forgot-password');
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    width: '100%',
                    height: '44px',
                    backgroundColor: '#4F46E5',
                    color: '#FFFFFF',
                    fontSize: '14px',
                    fontWeight: 500,
                    borderRadius: '8px',
                    textDecoration: 'none',
                    cursor: 'pointer',
                  }}
                >
                  Request a new link
                </Link>
              </div>
            )}

            {(pageState === 'ready' || pageState === 'submitting') && (
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
                    Set a new password
                  </h1>
                  <p
                    style={{
                      fontSize: '14px',
                      fontWeight: 400,
                      lineHeight: '20px',
                      color: isDark ? '#9CA3AF' : '#777587',
                    }}
                  >
                    {email ? (
                      <>
                        Choose a new password for <strong style={{ color: isDark ? '#F9FAFB' : '#141B2B' }}>{email}</strong>.
                      </>
                    ) : (
                      'Choose a new password for your account.'
                    )}
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

                <form onSubmit={handleResetPassword} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <div>
                    <label
                      htmlFor="new_password"
                      style={{
                        display: 'block',
                        fontSize: '13px',
                        fontWeight: 500,
                        lineHeight: '18px',
                        color: isDark ? '#F9FAFB' : '#141B2B',
                        marginBottom: '6px',
                      }}
                    >
                      New password
                    </label>
                    <input
                      id="new_password"
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={pageState === 'submitting'}
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
                    {password && (
                      <div style={{ display: 'flex', gap: '4px', marginTop: '8px' }}>
                        {[1, 2, 3, 4].map((level) => (
                          <div
                            key={level}
                            style={{
                              height: '4px',
                              flex: 1,
                              borderRadius: '2px',
                              backgroundColor: level <= passwordStrength ? strengthColor : isDark ? '#334155' : '#E5E7EB',
                              transition: 'background-color 0.15s ease',
                            }}
                          />
                        ))}
                      </div>
                    )}
                    {password && (
                      <p style={{ fontSize: '12px', marginTop: '6px', color: strengthColor }}>{strengthLabel}</p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="confirm_new_password"
                      style={{
                        display: 'block',
                        fontSize: '13px',
                        fontWeight: 500,
                        lineHeight: '18px',
                        color: isDark ? '#F9FAFB' : '#141B2B',
                        marginBottom: '6px',
                      }}
                    >
                      Confirm new password
                    </label>
                    <input
                      id="confirm_new_password"
                      type="password"
                      placeholder="••••••••"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      disabled={pageState === 'submitting'}
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
                    disabled={pageState === 'submitting'}
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
                      cursor: pageState === 'submitting' ? 'not-allowed' : 'pointer',
                      transition: 'background-color 0.15s ease',
                      marginTop: '4px',
                    }}
                    onMouseEnter={(e) => {
                      if (pageState !== 'submitting') e.currentTarget.style.backgroundColor = '#4338CA';
                    }}
                    onMouseLeave={(e) => {
                      if (pageState !== 'submitting') e.currentTarget.style.backgroundColor = '#4F46E5';
                    }}
                  >
                    {pageState === 'submitting' ? (
                      <>
                        <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
                        Resetting password...
                      </>
                    ) : (
                      'Reset password'
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
            )}

            {pageState === 'success' && (
              <div style={{ textAlign: 'center' }}>
                <div
                  style={{
                    width: '64px',
                    height: '64px',
                    borderRadius: '50%',
                    backgroundColor: isDark ? 'rgba(34, 197, 94, 0.2)' : 'rgba(34, 197, 94, 0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 20px auto',
                    color: isDark ? '#4ADE80' : '#16A34A',
                  }}
                >
                  <CheckCircle2 size={30} />
                </div>

                <h2
                  style={{
                    fontSize: '24px',
                    fontWeight: 600,
                    color: isDark ? '#F9FAFB' : '#141B2B',
                    marginBottom: '10px',
                  }}
                >
                  Password reset
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
                  Your password has been reset successfully.<br />
                  You can now sign in with your new password.
                </p>

                <Link
                  to="/login"
                  onClick={(e) => {
                    e.preventDefault();
                    navigate('/login');
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    width: '100%',
                    height: '44px',
                    backgroundColor: '#4F46E5',
                    color: '#FFFFFF',
                    fontSize: '14px',
                    fontWeight: 500,
                    borderRadius: '8px',
                    textDecoration: 'none',
                    cursor: 'pointer',
                  }}
                >
                  Continue to Sign In
                </Link>
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
            alt="Toowix Meet Reset Password Artwork"
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

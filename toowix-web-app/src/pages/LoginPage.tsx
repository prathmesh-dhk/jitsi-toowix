import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, AlertCircle, Loader2 } from 'lucide-react';
import { signInWithEmailAndPassword, signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebase';

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000';

const TOOWIX_LOGO_URL = '/assets/toowix-logo.png';
const ARTWORK_URL = '/assets/login-hero.png';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusReason, setStatusReason] = useState<string | null>(null);

  const navigate = useNavigate();

  // Process Login Gate Verification with Toowix Backend
  const handleBackendLoginGate = async (idToken: string) => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/auth/login-gate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
      });

      const data = await response.json();

      if (response.ok && data.status === 'ACTIVE') {
        localStorage.setItem('toowix_user', JSON.stringify(data.user));
        if (data.jitsiToken) {
          localStorage.setItem('toowix_jitsi_jwt', data.jitsiToken);
        }
        if (data.company) {
          localStorage.setItem('toowix_company', JSON.stringify(data.company));
        }

        navigate('/dashboard');
        return;
      }

      setStatusReason(data.status || 'ERROR');
      if (data.status === 'PENDING') {
        setErrorMessage('Your company registration has been submitted and is currently pending review by the Toowix Super Admin.');
      } else if (data.status === 'REJECTED') {
        setErrorMessage(`Your company registration was declined. Reason: ${data.rejectionReason || 'Contact support for details.'}`);
      } else if (data.status === 'UNVERIFIED') {
        setErrorMessage('Please verify your email address via the link sent to your inbox before signing in.');
      } else if (data.status === 'SUSPENDED_USER') {
        setErrorMessage('Your personal user account has been suspended by an administrator.');
      } else if (data.status === 'SUSPENDED_COMPANY') {
        setErrorMessage('Your company workspace has been suspended. Please contact your administrator.');
      } else {
        setErrorMessage(data.error || 'Authentication gate rejected the request.');
      }
    } catch (err: any) {
      console.error('[Login Gate] Connection error:', err);
      setErrorMessage('Could not connect to Toowix Authentication server. Ensure backend is running.');
    }
  };

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setStatusReason(null);

    if (!email.trim() || !password.trim()) {
      setErrorMessage('Please enter both your email address and password.');
      return;
    }

    setIsLoading(true);
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email.trim(), password);
      const idToken = await userCredential.user.getIdToken();
      await handleBackendLoginGate(idToken);
    } catch (err: any) {
      console.error('[Firebase Auth] Sign in failed:', err);
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
        setErrorMessage('Invalid email or password. Please check your credentials and try again.');
      } else if (err.code === 'auth/too-many-requests') {
        setErrorMessage('Access to this account has been temporarily disabled due to many failed login attempts.');
      } else {
        setErrorMessage(err.message || 'Failed to authenticate with Firebase.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setErrorMessage(null);
    setStatusReason(null);
    setIsLoading(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const idToken = await result.user.getIdToken();
      await handleBackendLoginGate(idToken);
    } catch (err: any) {
      console.error('[Google SSO] Sign in error:', err);
      setErrorMessage(err.message || 'Google SSO sign in failed.');
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
        backgroundColor: '#F1F3FF', // surface-container-low
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        padding: '24px 16px',
        boxSizing: 'border-box',
      }}
    >
      {/* Floating Card Container */}
      <main className="auth-card-container">
        {/* Left Column: Form Area */}
        <section className="auth-form-column">
          <div
            className="auth-form-wrapper"
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              padding: '40px 48px 24px 48px',
              width: '100%',
              maxWidth: '500px',
              margin: '0 auto',
            }}
          >
            {/* Brand Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '28px' }}>
              <img
                alt="Toowix Meet Logo"
                src={TOOWIX_LOGO_URL}
                style={{ width: '36px', height: '36px', objectFit: 'contain' }}
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                  const nextSibling = e.currentTarget.nextElementSibling;
                  if (nextSibling) {
                    (nextSibling as HTMLElement).style.display = 'flex';
                  }
                }}
              />
              <div
                style={{
                  display: 'none',
                  width: '36px',
                  height: '36px',
                  borderRadius: '8px',
                  background: 'linear-gradient(135deg, #2E72B2 0%, #4799E3 100%)',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#FFFFFF',
                  fontWeight: 700,
                  fontSize: '20px',
                }}
              >
                T
              </div>
              <span
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: '20px',
                  fontWeight: 600,
                  color: '#141B2B',
                  letterSpacing: '-0.01em',
                }}
              >
                Toowix Meet
              </span>
            </div>

            {/* Form Header */}
            <div style={{ marginBottom: '24px' }}>
              <h1
                style={{
                  fontSize: '28px',
                  fontWeight: 700,
                  lineHeight: '34px',
                  letterSpacing: '-0.02em',
                  color: '#141B2B',
                  marginBottom: '8px',
                }}
              >
                Welcome Back
              </h1>
              <p
                style={{
                  fontSize: '14px',
                  fontWeight: 400,
                  lineHeight: '20px',
                  color: '#777587',
                }}
              >
                Today is a new day. It's your day. You shape it. Sign in to start managing your meetings.
              </p>
            </div>

            {/* Alert Banner for Gate Rejections */}
            {errorMessage && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  padding: '12px 14px',
                  borderRadius: '8px',
                  marginBottom: '18px',
                  backgroundColor: statusReason === 'PENDING' ? '#FFFBEB' : '#FEF2F2',
                  border: `1px solid ${statusReason === 'PENDING' ? '#FDE68A' : '#FECACA'}`,
                  color: statusReason === 'PENDING' ? '#92400E' : '#991B1B',
                  fontSize: '13px',
                  lineHeight: '18px',
                }}
              >
                <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleEmailSignIn} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Email Field */}
              <div>
                <label
                  htmlFor="email"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 500,
                    lineHeight: '18px',
                    color: '#141B2B',
                    marginBottom: '6px',
                  }}
                >
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  placeholder="Example@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading}
                  required
                  style={{
                    width: '100%',
                    height: '44px',
                    padding: '0 16px',
                    borderRadius: '8px',
                    border: '1px solid #D1D5DB',
                    backgroundColor: '#FFFFFF',
                    color: '#141B2B',
                    fontSize: '14px',
                    transition: 'all 0.15s ease',
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = '#4F46E5';
                    e.currentTarget.style.boxShadow = '0 0 0 4px rgba(79, 70, 229, 0.1)';
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = '#D1D5DB';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                />
              </div>

              {/* Password Field */}
              <div>
                <label
                  htmlFor="password"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 500,
                    lineHeight: '18px',
                    color: '#141B2B',
                    marginBottom: '6px',
                  }}
                >
                  Password
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="At least 8 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isLoading}
                    required
                    style={{
                      width: '100%',
                      height: '44px',
                      padding: '0 44px 0 16px',
                      borderRadius: '8px',
                      border: '1px solid #D1D5DB',
                      backgroundColor: '#FFFFFF',
                      color: '#141B2B',
                      fontSize: '14px',
                      transition: 'all 0.15s ease',
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = '#4F46E5';
                      e.currentTarget.style.boxShadow = '0 0 0 4px rgba(79, 70, 229, 0.1)';
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = '#D1D5DB';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                    style={{
                      position: 'absolute',
                      right: '12px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'transparent',
                      border: 'none',
                      color: '#777587',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      padding: '4px',
                    }}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}>
                  <Link
                    to="/forgot-password"
                    style={{
                      fontSize: '13px',
                      fontWeight: 500,
                      color: '#4F46E5',
                      textDecoration: 'none',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = '#4338CA')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = '#4F46E5')}
                  >
                    Forgot Password?
                  </Link>
                </div>
              </div>

              {/* Submit Button */}
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
                    Signing in...
                  </>
                ) : (
                  'Sign in'
                )}
              </button>
            </form>

            {/* Divider */}
            <div
              style={{
                position: 'relative',
                margin: '22px 0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <div style={{ position: 'absolute', width: '100%', height: '1px', backgroundColor: '#E5E7EB' }} />
              <span
                style={{
                  position: 'relative',
                  backgroundColor: '#FFFFFF',
                  padding: '0 16px',
                  fontSize: '14px',
                  color: '#777587',
                }}
              >
                Or
              </span>
            </div>

            {/* Social Auth */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={isLoading}
                style={{
                  width: '100%',
                  height: '44px',
                  backgroundColor: '#FFFFFF',
                  border: '1px solid #E5E7EB',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '12px',
                  fontSize: '14px',
                  fontWeight: 500,
                  color: '#141B2B',
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                  transition: 'background-color 0.15s ease',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#F1F3FF')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#FFFFFF')}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                </svg>
                Sign in with Google
              </button>
            </div>

            {/* Footer Link */}
            <p
              style={{
                marginTop: '20px',
                textAlign: 'center',
                fontSize: '14px',
                color: '#777587',
              }}
            >
              Don't you have an account?{' '}
              <Link
                to="/signup"
                onClick={(e) => {
                  e.preventDefault();
                  navigate('/signup');
                }}
                style={{
                  color: '#4F46E5',
                  fontWeight: 500,
                  textDecoration: 'none',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#4338CA')}
                onMouseLeave={(e) => (e.currentTarget.style.color = '#4F46E5')}
              >
                Sign up
              </Link>
            </p>
          </div>

          {/* Copyright */}
          <div style={{ paddingBottom: '20px', textAlign: 'center' }}>
            <p style={{ fontSize: '12px', color: '#777587' }}>
              &copy; 2026 Toowix. ALL RIGHTS RESERVED.
            </p>
          </div>
        </section>

        {/* Right Column: 3D Translucent Glass Logo Hero Image */}
        <section className="auth-hero-column">
          <img
            src={ARTWORK_URL}
            alt="Toowix Meet 3D Brand Artwork"
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

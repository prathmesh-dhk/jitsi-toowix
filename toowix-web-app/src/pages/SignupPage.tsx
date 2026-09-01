import React, { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import {
  createUserWithEmailAndPassword,
  updateProfile,
  sendEmailVerification,
  signInWithPopup,
} from 'firebase/auth';
import { auth, googleProvider, microsoftProvider } from '../lib/firebase';

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000';

const TOOWIX_LOGO_URL = '/assets/toowix-logo.png';
const ARTWORK_URL = '/assets/signup-hero.png';

export function SignupPage() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const navigate = useNavigate();

  // Calculate Password Strength (0 to 4)
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
    return '#10B981';
  }, [passwordStrength]);

  // Sync New User Registration with Backend API
  const handleBackendSignup = async (idToken: string, name: string) => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/auth/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ name }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to initialize account in Toowix database.');
      }
      return data;
    } catch (err: any) {
      console.warn('[Signup Backend Sync] Warning:', err);
    }
  };

  const handleEmailSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!firstName.trim() || !lastName.trim()) {
      setErrorMessage('Please enter both your first and last name.');
      return;
    }

    if (!email.trim()) {
      setErrorMessage('Please enter a valid work email address.');
      return;
    }

    if (password.length < 8) {
      setErrorMessage('Password must be at least 8 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match. Please re-enter your password.');
      return;
    }

    if (!agreedToTerms) {
      setErrorMessage('You must agree to the Terms of Service and Privacy Policy to create an account.');
      return;
    }

    setIsLoading(true);
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      const fullName = `${firstName.trim()} ${lastName.trim()}`;

      // Update Firebase Profile
      await updateProfile(userCredential.user, { displayName: fullName });

      // Send Verification Email
      await sendEmailVerification(userCredential.user);

      // Sync with MongoDB
      const idToken = await userCredential.user.getIdToken();
      await handleBackendSignup(idToken, fullName);

      setSuccessMessage('Account created successfully! Please verify your email before signing in.');
      setTimeout(() => {
        navigate('/login');
      }, 2000);
    } catch (err: any) {
      console.error('[Firebase Signup] Error:', err);
      if (err.code === 'auth/email-already-in-use') {
        setErrorMessage('An account with this email address already exists. Please sign in instead.');
      } else if (err.code === 'auth/invalid-email') {
        setErrorMessage('The email address provided is not valid.');
      } else if (err.code === 'auth/weak-password') {
        setErrorMessage('The password is too weak. Please use at least 8 characters.');
      } else {
        setErrorMessage(err.message || 'Failed to create account.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignUp = async () => {
    setErrorMessage(null);
    setIsLoading(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const idToken = await result.user.getIdToken();
      await handleBackendSignup(idToken, result.user.displayName || 'User');
      navigate('/login');
    } catch (err: any) {
      console.error('[Google SSO Signup] Error:', err);
      setErrorMessage(err.message || 'Google sign up failed.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleMicrosoftSignUp = async () => {
    setErrorMessage(null);
    setIsLoading(true);
    try {
      const result = await signInWithPopup(auth, microsoftProvider);
      const idToken = await result.user.getIdToken();
      await handleBackendSignup(idToken, result.user.displayName || 'User');
      navigate('/login');
    } catch (err: any) {
      console.error('[Microsoft SSO Signup] Error:', err);
      setErrorMessage(err.message || 'Microsoft sign up failed.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      style={{
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#F1F3FF', // surface-container-low
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        padding: '24px',
      }}
    >
      {/* Floating Card Container */}
      <main
        style={{
          display: 'flex',
          width: '100%',
          maxWidth: '1100px',
          height: '100%',
          maxHeight: '800px',
          backgroundColor: '#FFFFFF',
          borderRadius: '32px',
          boxShadow: '0 25px 50px -12px rgba(37, 38, 94, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.03)',
          overflow: 'hidden',
        }}
      >
        {/* Left Column: Form Area */}
        <section
          style={{
            width: '50%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
            backgroundColor: '#FFFFFF',
            overflowY: 'auto',
            flex: '1 1 50%',
          }}
        >
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              padding: '36px 48px 20px 48px',
              width: '100%',
              maxWidth: '500px',
              margin: '0 auto',
            }}
          >
            {/* Brand Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
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
                  color: '#141B2B',
                  letterSpacing: '-0.01em',
                }}
              >
                Toowix Meet
              </span>
            </div>

            {/* Form Header */}
            <div style={{ marginBottom: '20px' }}>
              <h1
                style={{
                  fontSize: '28px',
                  fontWeight: 700,
                  lineHeight: '34px',
                  letterSpacing: '-0.02em',
                  color: '#141B2B',
                  marginBottom: '6px',
                }}
              >
                Create Account
              </h1>
              <p
                style={{
                  fontSize: '14px',
                  fontWeight: 400,
                  lineHeight: '20px',
                  color: '#777587',
                }}
              >
                Start your journey with Toowix Meet. Set up your account to begin.
              </p>
            </div>

            {/* Error / Success Notifications */}
            {errorMessage && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  marginBottom: '14px',
                  backgroundColor: '#FEF2F2',
                  border: '1px solid #FECACA',
                  color: '#991B1B',
                  fontSize: '13px',
                  lineHeight: '18px',
                }}
              >
                <AlertCircle size={16} style={{ flexShrink: 0 }} />
                <span>{errorMessage}</span>
              </div>
            )}

            {successMessage && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  marginBottom: '14px',
                  backgroundColor: '#ECFDF5',
                  border: '1px solid #A7F3D0',
                  color: '#065F46',
                  fontSize: '13px',
                  lineHeight: '18px',
                }}
              >
                <CheckCircle2 size={16} style={{ flexShrink: 0 }} />
                <span>{successMessage}</span>
              </div>
            )}

            {/* Sign Up Form */}
            <form onSubmit={handleEmailSignUp} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* Name Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label
                    htmlFor="first_name"
                    style={{
                      display: 'block',
                      fontSize: '13px',
                      fontWeight: 500,
                      lineHeight: '18px',
                      color: '#141B2B',
                      marginBottom: '4px',
                    }}
                  >
                    First name
                  </label>
                  <input
                    id="first_name"
                    type="text"
                    placeholder="Jane"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    disabled={isLoading}
                    required
                    style={{
                      width: '100%',
                      height: '40px',
                      padding: '0 14px',
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
                <div>
                  <label
                    htmlFor="last_name"
                    style={{
                      display: 'block',
                      fontSize: '13px',
                      fontWeight: 500,
                      lineHeight: '18px',
                      color: '#141B2B',
                      marginBottom: '4px',
                    }}
                  >
                    Last name
                  </label>
                  <input
                    id="last_name"
                    type="text"
                    placeholder="Doe"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    disabled={isLoading}
                    required
                    style={{
                      width: '100%',
                      height: '40px',
                      padding: '0 14px',
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
              </div>

              {/* Work Email */}
              <div>
                <label
                  htmlFor="email"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 500,
                    lineHeight: '18px',
                    color: '#141B2B',
                    marginBottom: '4px',
                  }}
                >
                  Work email
                </label>
                <input
                  id="email"
                  type="email"
                  placeholder="jane@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading}
                  required
                  style={{
                    width: '100%',
                    height: '40px',
                    padding: '0 14px',
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

              {/* Password */}
              <div>
                <label
                  htmlFor="password"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 500,
                    lineHeight: '18px',
                    color: '#141B2B',
                    marginBottom: '4px',
                  }}
                >
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                  required
                  style={{
                    width: '100%',
                    height: '40px',
                    padding: '0 14px',
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

                {/* Password Strength Meter */}
                {password && (
                  <div style={{ marginTop: '6px' }}>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {[1, 2, 3, 4].map((level) => (
                        <div
                          key={level}
                          style={{
                            height: '4px',
                            flex: 1,
                            borderRadius: '9999px',
                            backgroundColor: level <= passwordStrength ? strengthColor : '#E5E7EB',
                            transition: 'background-color 0.2s',
                          }}
                        />
                      ))}
                    </div>
                    <p style={{ fontSize: '11px', color: strengthColor, marginTop: '4px', fontWeight: 500 }}>
                      {strengthLabel}
                    </p>
                  </div>
                )}
              </div>

              {/* Confirm Password */}
              <div>
                <label
                  htmlFor="confirm_password"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 500,
                    lineHeight: '18px',
                    color: '#141B2B',
                    marginBottom: '4px',
                  }}
                >
                  Confirm password
                </label>
                <input
                  id="confirm_password"
                  type="password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={isLoading}
                  required
                  style={{
                    width: '100%',
                    height: '40px',
                    padding: '0 14px',
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

              {/* Terms Checkbox */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '4px 0' }}>
                <input
                  id="terms"
                  type="checkbox"
                  checked={agreedToTerms}
                  onChange={(e) => setAgreedToTerms(e.target.checked)}
                  style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    accentColor: '#4F46E5',
                  }}
                />
                <label htmlFor="terms" style={{ fontSize: '13px', color: '#141B2B', cursor: 'pointer' }}>
                  I agree to the{' '}
                  <a href="#" style={{ color: '#4F46E5', fontWeight: 500, textDecoration: 'none' }}>
                    Terms of Service
                  </a>{' '}
                  and{' '}
                  <a href="#" style={{ color: '#4F46E5', fontWeight: 500, textDecoration: 'none' }}>
                    Privacy Policy
                  </a>
                </label>
              </div>

              {/* Primary Submit Button */}
              <button
                type="submit"
                disabled={isLoading}
                style={{
                  width: '100%',
                  height: '42px',
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
                  marginTop: '2px',
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
                    <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                    Creating account...
                  </>
                ) : (
                  'Create Account'
                )}
              </button>
            </form>

            {/* Divider */}
            <div
              style={{
                position: 'relative',
                margin: '18px 0',
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
                  fontSize: '13px',
                  color: '#777587',
                }}
              >
                Or
              </span>
            </div>

            {/* Social Auth Grid (2 Columns) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
              <button
                type="button"
                onClick={handleGoogleSignUp}
                disabled={isLoading}
                style={{
                  height: '42px',
                  backgroundColor: '#FFFFFF',
                  border: '1px solid #E5E7EB',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  fontSize: '14px',
                  fontWeight: 500,
                  color: '#141B2B',
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                  transition: 'background-color 0.15s ease',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#F1F3FF')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#FFFFFF')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
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
                Google
              </button>

              <button
                type="button"
                onClick={handleMicrosoftSignUp}
                disabled={isLoading}
                style={{
                  height: '42px',
                  backgroundColor: '#FFFFFF',
                  border: '1px solid #E5E7EB',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  fontSize: '14px',
                  fontWeight: 500,
                  color: '#141B2B',
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                  transition: 'background-color 0.15s ease',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#F1F3FF')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#FFFFFF')}
              >
                <svg width="18" height="18" viewBox="0 0 21 21" fill="none">
                  <path d="M10 0H0V10H10V0Z" fill="#F25022" />
                  <path d="M21 0H11V10H21V0Z" fill="#7FBA00" />
                  <path d="M10 11H0V21H10V11Z" fill="#00A4EF" />
                  <path d="M21 11H11V21H21V11Z" fill="#FFB900" />
                </svg>
                Microsoft
              </button>
            </div>

            {/* Footer Link */}
            <p
              style={{
                textAlign: 'center',
                fontSize: '14px',
                color: '#777587',
              }}
            >
              Already have an account?{' '}
              <Link
                to="/login"
                onClick={(e) => {
                  e.preventDefault();
                  navigate('/login');
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
                Sign in
              </Link>
            </p>
          </div>

          {/* Copyright */}
          <div style={{ paddingBottom: '16px', textAlign: 'center' }}>
            <p style={{ fontSize: '12px', color: '#777587' }}>
              &copy; 2026 Toowix. ALL RIGHTS RESERVED.
            </p>
          </div>
        </section>

        {/* Right Column: 3D Frosted Glass Logo Hero Image */}
        <section
          style={{
            display: 'flex',
            width: '50%',
            height: '100%',
            position: 'relative',
            backgroundColor: '#F9F9FF',
            flex: '1 1 50%',
            overflow: 'hidden',
          }}
        >
          <img
            src={ARTWORK_URL}
            alt="Toowix Meet Sign Up Artwork"
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

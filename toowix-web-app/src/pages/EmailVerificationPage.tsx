import { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Mail, CheckCircle2, AlertCircle, Loader2, ArrowLeft } from 'lucide-react';
import { sendEmailVerification } from 'firebase/auth';
import { auth } from '../lib/firebase';

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000';
const TOOWIX_LOGO_URL = '/assets/toowix-logo.png';

export function EmailVerificationPage() {
  const [email, setEmail] = useState('your email address');
  const [isResending, setIsResending] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const queryParams = new URLSearchParams(location.search);
    const emailParam = queryParams.get('email');
    if (emailParam) {
      setEmail(emailParam);
    } else if (auth.currentUser?.email) {
      setEmail(auth.currentUser.email);
    }
  }, [location]);

  // Resend Firebase verification email
  const handleResendEmail = async () => {
    setFeedback(null);
    setIsResending(true);
    try {
      if (auth.currentUser) {
        await sendEmailVerification(auth.currentUser);
        setFeedback({
          type: 'success',
          message: 'Verification email resent! Please check your inbox and spam folder.',
        });
      } else {
        setFeedback({
          type: 'error',
          message: 'No active session found. Please sign in to request a new verification email.',
        });
      }
    } catch (err: any) {
      console.error('[Resend Verification] Error:', err);
      setFeedback({
        type: 'error',
        message: err.message || 'Failed to resend verification email.',
      });
    } finally {
      setIsResending(false);
    }
  };

  // Check if verified and sync with backend
  const handleCheckStatus = async () => {
    setFeedback(null);
    setIsChecking(true);
    try {
      if (auth.currentUser) {
        await auth.currentUser.reload();
        if (auth.currentUser.emailVerified) {
          const idToken = await auth.currentUser.getIdToken(true);
          // Sync with backend Tue-BE-1
          await fetch(`${BACKEND_URL}/api/auth/verify-email`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${idToken}`,
            },
          });
          setFeedback({
            type: 'success',
            message: 'Email successfully verified! Redirecting to login...',
          });
          setTimeout(() => navigate('/login'), 1500);
          return;
        }
      }
      setFeedback({
        type: 'error',
        message: "Email is not verified yet. Please click the link in your email and click 'I've Verified My Email' again.",
      });
    } catch (err: any) {
      console.error('[Check Verification] Error:', err);
      setFeedback({
        type: 'error',
        message: err.message || 'Error checking verification status.',
      });
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100vw',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#F1F3FF', // surface-container-low
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        padding: '24px',
      }}
    >
      <main
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          maxWidth: '500px',
          backgroundColor: '#FFFFFF',
          borderRadius: '32px',
          boxShadow: '0 25px 50px -12px rgba(37, 38, 94, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.03)',
          overflow: 'hidden',
          padding: '48px 40px 32px 40px',
          textAlign: 'center',
        }}
      >
        {/* Brand Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '32px' }}>
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

        {/* Circular Email Icon */}
        <div
          style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            backgroundColor: '#EEF2FF',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 24px auto',
            color: '#4F46E5',
          }}
        >
          <Mail size={30} />
        </div>

        {/* Heading & Subtitle */}
        <h1
          style={{
            fontSize: '26px',
            fontWeight: 700,
            lineHeight: '32px',
            letterSpacing: '-0.02em',
            color: '#141B2B',
            marginBottom: '10px',
          }}
        >
          Check your email ✉️
        </h1>
        <p
          style={{
            fontSize: '14px',
            fontWeight: 400,
            lineHeight: '22px',
            color: '#777587',
            marginBottom: '24px',
          }}
        >
          We've sent a verification link to <br />
          <strong style={{ color: '#141B2B', fontWeight: 600 }}>{email}</strong>
        </p>

        {/* Feedback Alert */}
        {feedback && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '10px 14px',
              borderRadius: '8px',
              marginBottom: '20px',
              backgroundColor: feedback.type === 'success' ? '#ECFDF5' : '#FEF2F2',
              border: `1px solid ${feedback.type === 'success' ? '#A7F3D0' : '#FECACA'}`,
              color: feedback.type === 'success' ? '#065F46' : '#991B1B',
              fontSize: '13px',
              lineHeight: '18px',
            }}
          >
            {feedback.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            <span>{feedback.message}</span>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <button
            type="button"
            onClick={handleCheckStatus}
            disabled={isChecking}
            style={{
              width: '100%',
              height: '44px',
              backgroundColor: '#4F46E5',
              color: '#FFFFFF',
              fontSize: '14px',
              fontWeight: 500,
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              cursor: isChecking ? 'not-allowed' : 'pointer',
              transition: 'background-color 0.15s ease',
            }}
            onMouseEnter={(e) => {
              if (!isChecking) e.currentTarget.style.backgroundColor = '#4338CA';
            }}
            onMouseLeave={(e) => {
              if (!isChecking) e.currentTarget.style.backgroundColor = '#4F46E5';
            }}
          >
            {isChecking ? (
              <>
                <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                Verifying...
              </>
            ) : (
              "I've Verified My Email"
            )}
          </button>

          <button
            type="button"
            onClick={handleResendEmail}
            disabled={isResending}
            style={{
              background: 'none',
              border: 'none',
              color: '#4F46E5',
              fontSize: '14px',
              fontWeight: 500,
              cursor: isResending ? 'not-allowed' : 'pointer',
              padding: '6px',
              textDecoration: 'none',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#4338CA')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#4F46E5')}
          >
            {isResending ? 'Resending email...' : 'Resend verification email'}
          </button>
        </div>

        {/* Spam Hint */}
        <p style={{ fontSize: '12px', color: '#777587', marginTop: '16px', marginBottom: '24px' }}>
          Didn't receive it? Check your spam folder.
        </p>

        {/* Back to Sign In Link */}
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
              color: '#141B2B',
              fontSize: '14px',
              fontWeight: 500,
              textDecoration: 'none',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#4F46E5')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#141B2B')}
          >
            <ArrowLeft size={16} />
            Back to Sign In
          </Link>
        </div>

        {/* Footer Copyright */}
        <div style={{ marginTop: '32px' }}>
          <p style={{ fontSize: '12px', color: '#777587' }}>
            &copy; 2026 Toowix. ALL RIGHTS RESERVED.
          </p>
        </div>
      </main>
    </div>
  );
}

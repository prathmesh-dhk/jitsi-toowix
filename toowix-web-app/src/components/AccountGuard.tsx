import { useEffect, useState, useRef } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { auth } from '../lib/firebase';

export function AccountGuard() {
  // Initialize state based on cached credentials for instant, zero-delay rendering on refresh
  const [state, setState] = useState<'loading' | 'allowed' | 'denied'>(() => {
    const hasUser = !!localStorage.getItem('toowix_user');
    const hasToken = !!localStorage.getItem('toowix_session_token');
    if (hasUser || hasToken) {
      return 'allowed';
    }
    return 'loading';
  });

  const isVerifyingRef = useRef(false);

  useEffect(() => {
    let active = true;

    const verifySession = async (user: any) => {
      if (!user) {
        // If not logged in and no cached user, deny
        if (!localStorage.getItem('toowix_user') && !localStorage.getItem('toowix_session_token')) {
          if (active) setState('denied');
        }
        return;
      }

      if (isVerifyingRef.current) return;
      isVerifyingRef.current = true;

      try {
        const token = await user.getIdToken();
        const response = await fetch(
          `${import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000'}/api/auth/session`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'X-Toowix-Session': localStorage.getItem('toowix_session_token') || '',
            },
          }
        );

        if (response.ok) {
          const data = await response.json();
          if (active) {
            localStorage.setItem('toowix_user', JSON.stringify(data.user));
            setState('allowed');
          }
        } else if (response.status === 401 || response.status === 403) {
          // Explicit unauthorized response from server
          if (active) {
            localStorage.removeItem('toowix_user');
            localStorage.removeItem('toowix_session_token');
            setState('denied');
          }
        }
      } catch (err) {
        // Network error or offline - if already allowed by cache, do NOT block user
        console.warn('Background session verification note:', err);
      } finally {
        isVerifyingRef.current = false;
      }
    };

    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (user) {
        verifySession(user);
      } else {
        // Firebase explicitly finished initializing and says no user is logged in
        const hasCached = !!localStorage.getItem('toowix_user') || !!localStorage.getItem('toowix_session_token');
        if (!hasCached && active) {
          setState('denied');
        }
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  if (state === 'loading') {
    return (
      <div
        role="status"
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--color-bg, #F8F9FD)',
          color: 'var(--color-text-secondary, #6B7280)',
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
          fontSize: '14px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '18px',
              height: '18px',
              border: '2px solid #E5E7EB',
              borderTopColor: '#3A86CA',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }}
          />
          <span>Loading...</span>
        </div>
      </div>
    );
  }

  return state === 'allowed' ? <Outlet /> : <Navigate to="/login" replace />;
}


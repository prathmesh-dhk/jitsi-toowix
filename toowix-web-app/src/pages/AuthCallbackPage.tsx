import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  completeKeycloakAccountLinkCallback,
  completeSignInCallback,
  exchangeForToowixSession,
  getKeycloakCallbackPurpose,
  linkKeycloakAccount,
} from '../lib/keycloakAuth';

/**
 * Completes the Keycloak redirect, then exchanges that session for the real Toowix application
 * session (see exchangeForToowixSession) before showing success or navigating anywhere -- a
 * Keycloak redirect completing is not the same as being signed in to Toowix Meet, so neither is
 * shown/performed until the backend exchange itself succeeds.
 */
export function AuthCallbackPage() {
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const navigate = useNavigate();
  // React Strict Mode invokes effects twice in development. An authorization code and
  // its PKCE verifier are one-time values, so processing the callback twice makes the
  // second invocation falsely report that the sign-in response has expired.
  const hasProcessedCallback = useRef(false);
  useEffect(() => {
    if (hasProcessedCallback.current) return;
    hasProcessedCallback.current = true;
    void (async () => {
      try {
        const purpose = getKeycloakCallbackPurpose();
        if (purpose === 'link') {
          const session = await completeKeycloakAccountLinkCallback();
          const result = await linkKeycloakAccount(session);
          if (!result.ok) {
            setError(result.message);
            return;
          }
          setComplete(true);
          navigate('/settings/security', { replace: true, state: { keycloakLinked: true } });
          return;
        }

        const session = await completeSignInCallback();
        const result = await exchangeForToowixSession(session);
        if (!result.ok) {
          setError(result.message);
          return;
        }
        setComplete(true);
        navigate('/dashboard', { replace: true });
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Sign-in could not be completed.');
      }
    })();
  }, [navigate]);
  return <main role="status" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
    {error ? <div><h1>Toowix authentication failed</h1><p>{error}</p><a href="/login">Return to sign in</a></div>
      : complete ? <div><h1>Toowix request successful</h1><p>Redirecting…</p></div>
        : 'Completing Toowix authentication…'}
  </main>;
}

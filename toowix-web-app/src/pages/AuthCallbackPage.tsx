import { useEffect, useRef, useState } from 'react';
import { completeSignInCallback } from '../lib/keycloakAuth';

/** Completes the test OIDC redirect without changing the existing Firebase app session. */
export function AuthCallbackPage() {
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  // React Strict Mode invokes effects twice in development. An authorization code and
  // its PKCE verifier are one-time values, so processing the callback twice makes the
  // second invocation falsely report that the sign-in response has expired.
  const hasProcessedCallback = useRef(false);
  useEffect(() => {
    if (hasProcessedCallback.current) return;
    hasProcessedCallback.current = true;
    void (async () => {
      try {
        await completeSignInCallback();
        setComplete(true);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Sign-in could not be completed.');
      }
    })();
  }, []);
  return <main role="status" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
    {error ? <div><h1>Toowix sign-in failed</h1><p>{error}</p><a href="/login">Return to sign in</a></div>
      : complete ? <div><h1>Toowix sign-in successful</h1><p>Keycloak returned to the callback correctly. Your existing Firebase login flow has not been changed.</p><a href="/login">Return to existing sign in</a></div>
        : 'Completing Toowix sign-in…'}
  </main>;
}

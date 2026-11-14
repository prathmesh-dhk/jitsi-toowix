import { onAuthStateChanged, signInWithCustomToken, User as FirebaseUser } from 'firebase/auth';
import { auth } from './firebase';

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000';

const keycloakEnabled = import.meta.env.VITE_KEYCLOAK_ENABLED === 'true';
const keycloakUrl = import.meta.env.VITE_KEYCLOAK_URL || 'http://localhost:8080';
const realm = import.meta.env.VITE_KEYCLOAK_REALM || 'toowix';
const clientId = import.meta.env.VITE_KEYCLOAK_CLIENT_ID || 'toowix-meet';
const redirectUri = import.meta.env.VITE_KEYCLOAK_REDIRECT_URI || `${window.location.origin}/auth/callback`;
const authority = `${keycloakUrl.replace(/\/$/, '')}/realms/${encodeURIComponent(realm)}`;
const signInTransactionKey = 'toowix_keycloak_pkce_sign_in';
// A link transaction is intentionally separate from normal sign-in. It contains only the
// short-lived PKCE verifier/state, never tokens or user identity data.
const linkTransactionKey = 'toowix_keycloak_pkce_link';

export interface KeycloakSession {
  accessToken: string;
}

type KeycloakCallbackPurpose = 'sign-in' | 'link';
interface PkceTransaction {
  verifier: string;
  state: string;
  purpose: KeycloakCallbackPurpose;
}

const base64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const randomString = () => base64Url(crypto.getRandomValues(new Uint8Array(32)));

/**
 * Firebase restores persisted browser sessions asynchronously after a full-page Keycloak
 * redirect. Reading auth.currentUser synchronously can therefore briefly return null even
 * though the user has a valid Toowix session. Wait for that restore before rejecting a link.
 */
async function restoredFirebaseUser(): Promise<FirebaseUser | null> {
  if (auth.currentUser) return auth.currentUser;

  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | undefined;
    const timeout = window.setTimeout(() => finish(null), 4_000);

    const finish = (user: FirebaseUser | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      unsubscribe?.();
      resolve(user);
    };

    unsubscribe = onAuthStateChanged(auth, finish, () => finish(null));
    if (settled) unsubscribe();
  });
}

async function challengeFor(verifier: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(hash));
}

function sessionFromTokens(tokens: Record<string, unknown>): KeycloakSession {
  const accessToken = String(tokens.access_token || '');
  if (!accessToken) throw new Error('Keycloak did not return an access token.');
  // Claims are intentionally not decoded or trusted in the browser. The backend
  // verifies the signature, issuer, audience, expiry, and subject through Keycloak JWKS.
  return { accessToken };
}

async function tokenRequest(parameters: URLSearchParams): Promise<KeycloakSession> {
  const response = await fetch(`${authority}/protocol/openid-connect/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: parameters,
  });
  if (!response.ok) throw new Error('Unable to complete Keycloak authentication.');
  // Do not persist access, refresh, or ID tokens. The access token remains in memory
  // only long enough to exchange it for the normal Firebase/Toowix application session.
  return sessionFromTokens(await response.json());
}

export function isKeycloakSignInEnabled(): boolean {
  return keycloakEnabled;
}

function readTransaction(key: string): PkceTransaction | null {
  const raw = sessionStorage.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PkceTransaction>;
    if (typeof parsed.verifier !== 'string' || typeof parsed.state !== 'string' || (parsed.purpose !== 'sign-in' && parsed.purpose !== 'link')) {
      return null;
    }
    return parsed as PkceTransaction;
  } catch {
    return null;
  }
}

async function startAuthorization(purpose: KeycloakCallbackPurpose): Promise<void> {
  if (!keycloakEnabled) {
    throw new Error('Keycloak sign-in is not enabled.');
  }

  const verifier = randomString();
  const state = randomString();
  const key = purpose === 'link' ? linkTransactionKey : signInTransactionKey;
  const otherKey = purpose === 'link' ? signInTransactionKey : linkTransactionKey;
  // There can only be one outstanding authorization flow in a tab. Clearing the other flow
  // prevents a callback from ever being handled as the wrong purpose.
  sessionStorage.removeItem(otherKey);
  sessionStorage.setItem(key, JSON.stringify({ verifier, state, purpose } satisfies PkceTransaction));
  const url = new URL(`${authority}/protocol/openid-connect/auth`);
  url.search = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid profile email',
    state, code_challenge: await challengeFor(verifier), code_challenge_method: 'S256',
  }).toString();
  window.location.assign(url.toString());
}

export async function signInWithToowix(): Promise<void> {
  return startAuthorization('sign-in');
}

/** Starts an explicit account-link flow only for an already authenticated Toowix user. */
export async function startKeycloakAccountLink(): Promise<void> {
  if (!await restoredFirebaseUser() || !localStorage.getItem('toowix_session_token')) {
    throw new Error('Sign in to your existing Toowix account before connecting Keycloak.');
  }
  return startAuthorization('link');
}

/** Uses transaction purpose/state, not browser-provided identities, to select the callback flow. */
export function getKeycloakCallbackPurpose(): KeycloakCallbackPurpose {
  const params = new URLSearchParams(window.location.search);
  const returnedState = params.get('state');
  const link = readTransaction(linkTransactionKey);
  if (link) {
    if (!returnedState || returnedState !== link.state) {
      throw new Error('The account-link response could not be verified.');
    }
    return 'link';
  }
  return 'sign-in';
}

async function completeCallback(purpose: KeycloakCallbackPurpose): Promise<KeycloakSession> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const returnedState = params.get('state');
  const key = purpose === 'link' ? linkTransactionKey : signInTransactionKey;
  const stored = readTransaction(key);
  if (params.get('error')) {
    sessionStorage.removeItem(key);
    throw new Error(purpose === 'link' ? 'Keycloak account linking was cancelled or denied.' : 'Keycloak sign-in was cancelled or denied.');
  }
  if (!code || !stored) throw new Error('The sign-in response is missing or has expired.');
  if (stored.purpose !== purpose || !returnedState || returnedState !== stored.state) {
    throw new Error(purpose === 'link' ? 'The account-link response could not be verified.' : 'The sign-in response could not be verified.');
  }
  // Consume only after state validation. Strict Mode is also guarded in the callback page; this
  // makes a repeated code exchange fail closed instead of submitting a second backend request.
  sessionStorage.removeItem(key);
  return tokenRequest(new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, redirect_uri: redirectUri, code_verifier: stored.verifier }));
}

export async function completeSignInCallback(): Promise<KeycloakSession> {
  return completeCallback('sign-in');
}

export async function completeKeycloakAccountLinkCallback(): Promise<KeycloakSession> {
  return completeCallback('link');
}

export type ToowixSessionExchangeResult =
  | { ok: true }
  | { ok: false; message: string };

export type ToowixAccountLinkResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Sends three independently authenticated proofs to the backend. No UID, subject, email, or
 * account identifier comes from page input; the backend verifies and binds both token identities.
 */
export async function linkKeycloakAccount(session: KeycloakSession): Promise<ToowixAccountLinkResult> {
  const firebaseUser = await restoredFirebaseUser();
  const toowixSession = localStorage.getItem('toowix_session_token');
  if (!firebaseUser || !toowixSession) {
    return { ok: false, message: 'Your existing Toowix session is required before connecting Keycloak.' };
  }

  try {
    const firebaseIdToken = await firebaseUser.getIdToken();
    const response = await fetch(`${BACKEND_URL}/api/auth/keycloak-link`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${firebaseIdToken}`,
        'X-Toowix-Session': toowixSession,
        'X-Keycloak-Authorization': `Bearer ${session.accessToken}`,
      },
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) return { ok: true };
    if (response.status === 409) return { ok: false, message: 'This Keycloak account is already linked to a different Toowix account.' };
    if (response.status === 401) return { ok: false, message: 'Your Toowix or Keycloak session has expired. Please sign in again and retry.' };
    if (response.status === 403) return { ok: false, message: 'You are not allowed to link this Keycloak account.' };
    return { ok: false, message: data.error || data.message || 'Could not connect your Keycloak account. Please try again.' };
  } catch {
    return { ok: false, message: 'Could not reach the Toowix server. Please try again.' };
  }
}

/**
 * Exchanges a verified Keycloak session for the same application session LoginPage's Firebase
 * path establishes: POSTs to /api/auth/keycloak-session (the backend re-verifies the
 * access token server-side -- this call never trusts anything client-supplied), then, on success,
 * does two things with the response:
 *   1. Writes toowix_user / toowix_company / toowix_session_token to localStorage, exactly like
 *      LoginPage's handleBackendLoginGate -- this is what AccountGuard/App.tsx actually check.
 *   2. Calls signInWithCustomToken with the firebaseCustomToken the backend minted for this
 *      user's existing Firebase UID. This is the part a session-token-only exchange would be
 *      missing: verifyFirebaseToken (guarding nearly every other authenticated route) requires a
 *      live Firebase ID token on every request, not just the session token, and this browser
 *      never did a real Firebase sign-in. The custom token is Firebase's own supported mechanism
 *      for exactly this "external IdP already verified this person" case, so it establishes a
 *      real auth.currentUser / working getIdToken() without touching verifyFirebaseToken itself.
 * Keycloak tokens are never written to browser storage. Firebase is the session of record once
 * the backend exchange succeeds.
 */
export async function exchangeForToowixSession(session: KeycloakSession): Promise<ToowixSessionExchangeResult> {
  try {
    const response = await fetch(`${BACKEND_URL}/api/auth/keycloak-session`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    const data = await response.json().catch(() => ({}));

    if (response.ok && data.status === 'ACTIVE') {
      if (!data.firebaseCustomToken || !data.sessionToken || !data.user) {
        return { ok: false, message: 'Could not establish a secure session. Please try again.' };
      }
      // Establish Firebase first. Nothing is persisted until Firebase accepts the
      // server-minted custom token, so a partial Keycloak login cannot look authenticated.
      await signInWithCustomToken(auth, data.firebaseCustomToken);

      localStorage.setItem('toowix_user', JSON.stringify(data.user));
      localStorage.removeItem('toowix_jitsi_jwt');
      if (data.company) {
        localStorage.setItem('toowix_company', JSON.stringify(data.company));
      } else {
        localStorage.removeItem('toowix_company');
      }
      localStorage.setItem('toowix_session_token', data.sessionToken);

      return { ok: true };
    }

    if (response.status === 401) {
      return { ok: false, message: 'Your Keycloak sign-in session is invalid or has expired. Please sign in again.' };
    }
    if (response.status === 503) {
      return { ok: false, message: 'Keycloak sign-in is temporarily unavailable. Please use your existing sign-in method or try again later.' };
    }

    switch (data.status) {
      case 'KEYCLOAK_NOT_LINKED':
        return { ok: false, message: 'This Keycloak account is not linked to a Toowix Meet user yet. Ask an administrator to link it.' };
      case 'PLAN_DOES_NOT_INCLUDE_MEET':
        return { ok: false, message: 'Your Toowix plan does not include Meet access. Upgrade your plan to use Meet.' };
      case 'SUSPENDED_USER':
        return { ok: false, message: 'Your user account has been suspended by an administrator.' };
      case 'FORCE_PASSWORD_RESET':
        return { ok: false, message: 'You must reset your password before continuing. Please sign in with your email and password.' };
      case 'PENDING':
        return { ok: false, message: 'Your company registration is currently pending review by the Toowix Super Admin.' };
      case 'REJECTED':
        return { ok: false, message: `Your company registration was declined. Reason: ${data.rejectionReason || 'Contact support for details.'}` };
      case 'SUSPENDED_COMPANY':
        return { ok: false, message: 'Your company workspace has been suspended. Please contact your administrator.' };
      default:
        return { ok: false, message: data.error || 'Access restricted. Please contact your company administrator.' };
    }
  } catch {
    return { ok: false, message: 'Could not reach the Toowix server. Please try again.' };
  }
}

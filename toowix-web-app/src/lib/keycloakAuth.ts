const keycloakUrl = import.meta.env.VITE_KEYCLOAK_URL || 'http://localhost:8080';
const realm = import.meta.env.VITE_KEYCLOAK_REALM || 'toowix-dev';
const clientId = import.meta.env.VITE_KEYCLOAK_CLIENT_ID || 'toowix-meet';
const redirectUri = import.meta.env.VITE_KEYCLOAK_REDIRECT_URI || `${window.location.origin}/auth/callback`;
const logoutRedirectUri = import.meta.env.VITE_KEYCLOAK_LOGOUT_REDIRECT_URI || window.location.origin;
const authority = `${keycloakUrl.replace(/\/$/, '')}/realms/${encodeURIComponent(realm)}`;
const storageKey = 'toowix_keycloak_session';
const transactionKey = 'toowix_keycloak_pkce';

export interface KeycloakSession {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt: number;
  profile: { sub: string; email?: string; name?: string; preferred_username?: string };
}

const base64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const decodeJwt = <T,>(token: string): T => JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));

const randomString = () => base64Url(crypto.getRandomValues(new Uint8Array(32)));

async function challengeFor(verifier: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(hash));
}

function loadSession(): KeycloakSession | null {
  try {
    const raw = sessionStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) as KeycloakSession : null;
  } catch {
    sessionStorage.removeItem(storageKey);
    return null;
  }
}

function saveSession(session: KeycloakSession): void {
  sessionStorage.setItem(storageKey, JSON.stringify(session));
}

function sessionFromTokens(tokens: Record<string, string | number | undefined>): KeycloakSession {
  const accessToken = String(tokens.access_token || '');
  if (!accessToken) throw new Error('Keycloak did not return an access token.');
  const claims = decodeJwt<KeycloakSession['profile'] & { exp?: number }>(accessToken);
  return {
    accessToken,
    refreshToken: tokens.refresh_token ? String(tokens.refresh_token) : undefined,
    idToken: tokens.id_token ? String(tokens.id_token) : undefined,
    expiresAt: Date.now() + (Number(tokens.expires_in || 0) * 1000),
    profile: { sub: claims.sub, email: claims.email, name: claims.name, preferred_username: claims.preferred_username },
  };
}

async function tokenRequest(parameters: URLSearchParams): Promise<KeycloakSession> {
  const response = await fetch(`${authority}/protocol/openid-connect/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: parameters,
  });
  if (!response.ok) throw new Error('Unable to complete Keycloak authentication.');
  const session = sessionFromTokens(await response.json());
  saveSession(session);
  return session;
}

export async function signInWithToowix(): Promise<void> {
  const verifier = randomString();
  const state = randomString();
  sessionStorage.setItem(transactionKey, JSON.stringify({ verifier, state }));
  const url = new URL(`${authority}/protocol/openid-connect/auth`);
  url.search = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid profile email',
    state, code_challenge: await challengeFor(verifier), code_challenge_method: 'S256',
  }).toString();
  window.location.assign(url.toString());
}

export async function completeSignInCallback(): Promise<KeycloakSession> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const returnedState = params.get('state');
  const stored = sessionStorage.getItem(transactionKey);
  sessionStorage.removeItem(transactionKey);
  if (!code || !stored) throw new Error('The sign-in response is missing or has expired.');
  const { verifier, state } = JSON.parse(stored) as { verifier: string; state: string };
  if (!returnedState || returnedState !== state) throw new Error('The sign-in response could not be verified.');
  return tokenRequest(new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, redirect_uri: redirectUri, code_verifier: verifier }));
}

export async function getAccessToken(): Promise<string | null> {
  const session = loadSession();
  if (!session) return null;
  if (session.expiresAt > Date.now() + 60_000) return session.accessToken;
  if (!session.refreshToken) { sessionStorage.removeItem(storageKey); return null; }
  try {
    return (await tokenRequest(new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, refresh_token: session.refreshToken }))).accessToken;
  } catch {
    sessionStorage.removeItem(storageKey);
    return null;
  }
}

export async function getSession(): Promise<KeycloakSession | null> {
  return (await getAccessToken()) ? loadSession() : null;
}

export async function signOutFromToowix(): Promise<void> {
  const session = loadSession();
  sessionStorage.removeItem(storageKey);
  sessionStorage.removeItem(transactionKey);
  const url = new URL(`${authority}/protocol/openid-connect/logout`);
  url.search = new URLSearchParams({ client_id: clientId, post_logout_redirect_uri: logoutRedirectUri, ...(session?.idToken ? { id_token_hint: session.idToken } : {}) }).toString();
  window.location.assign(url.toString());
}

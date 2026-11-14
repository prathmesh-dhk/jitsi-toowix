// Source-level regression checks for the deliberately explicit Keycloak account-link flow.
// The browser/OIDC provider is not started in this Node suite; these assertions protect the
// security boundaries and routing wiring that must remain present in the built client.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const auth = read('src', 'lib', 'keycloakAuth.ts');
const callback = read('src', 'pages', 'AuthCallbackPage.tsx');
const security = read('src', 'components', 'settings', 'SecuritySection.tsx');
const login = read('src', 'pages', 'LoginPage.tsx');

test('linking is explicitly feature-gated and requires both established local authentications', () => {
  assert.match(security, /const keycloakEnabled = isKeycloakSignInEnabled\(\)/);
  assert.match(security, /keycloakEnabled && \(/);
  assert.match(auth, /!auth\.currentUser \|\| !localStorage\.getItem\('toowix_session_token'\)/);
  assert.match(auth, /getIdToken\(\)/);
});

test('linking uses its own PKCE transaction and is never handled as normal sign-in', () => {
  assert.match(auth, /const linkTransactionKey = 'toowix_keycloak_pkce_link'/);
  assert.match(auth, /purpose === 'link'/);
  assert.match(callback, /purpose === 'link'[\s\S]*completeKeycloakAccountLinkCallback\(\)[\s\S]*linkKeycloakAccount\(session\)/);
  assert.match(callback, /const session = await completeSignInCallback\(\)[\s\S]*exchangeForToowixSession\(session\)/);
  assert.match(auth, /\/api\/auth\/keycloak-session/);
});

test('the linking request carries only verified-token headers and no browser identity fields', () => {
  const linkBody = auth.slice(auth.indexOf('export async function linkKeycloakAccount'), auth.indexOf('export async function exchangeForToowixSession'));
  assert.match(linkBody, /fetch\(`\$\{BACKEND_URL\}\/api\/auth\/keycloak-link`/);
  assert.match(linkBody, /Authorization: `Bearer \$\{firebaseIdToken\}`/);
  assert.match(linkBody, /'X-Toowix-Session': toowixSession/);
  assert.match(linkBody, /'X-Keycloak-Authorization': `Bearer \$\{session\.accessToken\}`/);
  assert.doesNotMatch(linkBody, /body:/);
  assert.doesNotMatch(linkBody, /localStorage\.setItem|sessionStorage\.setItem/);
});

test('state is checked before a verifier is consumed and duplicate callbacks are blocked', () => {
  assert.match(auth, /stored\.purpose !== purpose \|\| !returnedState \|\| returnedState !== stored\.state/);
  assert.match(auth, /sessionStorage\.removeItem\(key\);[\s\S]*tokenRequest/);
  assert.match(callback, /const hasProcessedCallback = useRef\(false\)/);
  assert.match(callback, /if \(hasProcessedCallback\.current\) return;/);
});

test('conflict and rejected authentication responses receive useful messages', () => {
  assert.match(auth, /response\.status === 409/);
  assert.match(auth, /response\.status === 401/);
  assert.match(auth, /response\.status === 403/);
});

test('existing email and Google Firebase sign-in wiring remains present', () => {
  assert.match(login, /signInWithEmailAndPassword\(auth, email, password\)/);
  assert.match(login, /signInWithPopup\(auth, googleProvider\)/);
  assert.match(login, /signInWithToowix\(\)/);
});

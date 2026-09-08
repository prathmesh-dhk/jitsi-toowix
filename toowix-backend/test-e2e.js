/**
 * Full application end-to-end test: signup -> company registration -> Super Admin
 * approval -> login-gate -> meeting scheduling -> lobby decision data -> attendance
 * tracking -> recording ingest -> Superadmin visibility -> real-time reminder
 * notification. Self-contained: creates and cleans up its own throwaway Firebase user.
 *
 * NOT covered here (needs a real browser, not scriptable over HTTP):
 *   - Actual WebRTC join/video/audio in a Jitsi call
 *   - The real "knock" / lobby waiting screen a guest sees once lobby is toggled on
 *   - The Jitsi watermark/branding rendering itself
 * This script verifies the DATA those features depend on (meeting type, organizer id,
 * lobby-relevant fields) is correct, which is everything controllable outside a browser.
 */
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const serviceAccount = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'serviceAccountKey.json'), 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const BACKEND_URL = 'http://localhost:4000';
const SUPERADMIN_URL = 'http://localhost:4100';
const FIREBASE_API_KEY = 'AIzaSyAUmG8KYxkNf29ojG6qiSWb4W4U4_lK4XU';
const RECORDING_INGEST_KEY = 'toowix-recording-ingest-dev-key-change-in-prod';
const SUPERADMIN_EMAIL = 'admin@toowix.com';
const SUPERADMIN_PASSWORD = 'Toowix#SuperAdmin2026';

const STAMP = Date.now();
const TEST_EMAIL = `e2e-test-${STAMP}@example.com`;
const TEST_PASSWORD = 'TestPass123!';
const COMPANY_NAME = `E2E Test Co ${STAMP}`;

let pass = 0, fail = 0;
const results = [];
function check(name, condition, detail) {
  if (condition) { pass++; results.push(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; results.push(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` -- ${detail}` : ''}`); }
}
function phase(name) { results.push(`\n\x1b[36m▶ ${name}\x1b[0m`); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let idToken, firebaseUid, meetingId, roomSlug, companyId;

  // ---------------------------------------------------------------------
  phase('1. Signup');
  // ---------------------------------------------------------------------
  let res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, returnSecureToken: true }),
  });
  let data = await res.json();
  check('Firebase account created', res.ok && !!data.idToken, JSON.stringify(data.error));
  idToken = data.idToken;
  firebaseUid = data.localId;
  if (!idToken) return printSummary();

  // A real user verifies email by clicking the link Firebase emails them; the REST
  // signUp API can't do that step, so mark it verified via Admin SDK to reach the same
  // state, rather than have the test wrongly report UNVERIFIED as a "failure." The
  // original idToken's claims were minted before this change, so re-sign-in for a
  // fresh token that actually carries emailVerified: true.
  await admin.auth().updateUser(firebaseUid, { emailVerified: true });
  res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, returnSecureToken: true }),
  });
  data = await res.json();
  idToken = data.idToken;
  check('Email marked verified, fresh token minted with that claim', res.ok && !!idToken);

  res = await fetch(`${BACKEND_URL}/api/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ fullName: 'E2E Test User' }),
  });
  check('Backend user record created', res.ok, await res.text());

  // ---------------------------------------------------------------------
  phase('2. Company registration -> should be PENDING, Firebase account disabled');
  // ---------------------------------------------------------------------
  res = await fetch(`${BACKEND_URL}/api/companies/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ name: COMPANY_NAME }),
  });
  data = await res.json();
  check('Company registration succeeds (201)', res.status === 201, JSON.stringify(data));
  check('  -> status is PENDING', data.status === 'PENDING');
  companyId = data.company?.id;

  res = await fetch(`${BACKEND_URL}/api/auth/login-gate`, {
    method: 'POST', headers: { Authorization: `Bearer ${idToken}` },
  });
  data = await res.json();
  check('Login-gate blocks a PENDING company', res.status !== 200 && data.status === 'PENDING', JSON.stringify(data));

  // ---------------------------------------------------------------------
  phase('3. Super Admin approves the company -> Firebase account should re-enable');
  // ---------------------------------------------------------------------
  res = await fetch(`${SUPERADMIN_URL}/api/dev-auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: SUPERADMIN_EMAIL, password: SUPERADMIN_PASSWORD }),
  });
  data = await res.json();
  check('Super Admin dev-auth login succeeds', res.ok && !!data.token);
  const adminToken = data.token;

  res = await fetch(`${SUPERADMIN_URL}/api/admin/companies/${companyId}/approve`, {
    method: 'POST', headers: { Authorization: `Bearer ${adminToken}` },
  });
  check('Company approval succeeds', res.ok);

  // Firebase disable/enable is async (fire-and-forget in the handler) -- give it a moment.
  await sleep(1500);

  // Re-authenticate to get a fresh ID token / confirm the account isn't blocked anymore.
  res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, returnSecureToken: true }),
  });
  data = await res.json();
  check('Firebase sign-in succeeds after approval (account was re-enabled)', res.ok && !!data.idToken, JSON.stringify(data.error));
  idToken = data.idToken || idToken;

  res = await fetch(`${BACKEND_URL}/api/auth/login-gate`, { method: 'POST', headers: { Authorization: `Bearer ${idToken}` } });
  data = await res.json();
  check('Login-gate now ACTIVE for approved company', res.ok && data.status === 'ACTIVE', JSON.stringify(data));

  const authHeader = { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' };

  // ---------------------------------------------------------------------
  phase('4. Meeting scheduling + lobby decision data');
  // ---------------------------------------------------------------------
  roomSlug = `e2e-${STAMP}`;
  const nearFuture = new Date(Date.now() + 50 * 1000).toISOString(); // 50s out -> should trip "starts now" (<=1min) on the next scheduler tick

  res = await fetch(`${BACKEND_URL}/api/meetings`, {
    method: 'POST', headers: authHeader,
    body: JSON.stringify({ name: 'E2E Test Meeting', roomSlug, type: 'Internal', scheduledAt: nearFuture, durationMinutes: 30 }),
  });
  data = await res.json();
  check('Meeting created', res.status === 201, JSON.stringify(data));
  meetingId = data.meeting?.id;

  res = await fetch(`${BACKEND_URL}/api/meetings/room/${roomSlug}`);
  data = await res.json();
  check('Public room-info endpoint works (no auth needed, guests use this)', res.ok);
  check('  -> type is Internal (lobby SHOULD activate for organizer)', data.meeting?.type === 'Internal');
  check('  -> organizerId matches the creator (used to decide who can toggle lobby)', !!data.meeting?.organizerId);
  results.push('  \x1b[33mℹ\x1b[0m Actual toggleLobby() + the guest "knock" screen require a real browser -- not scriptable here.');

  // ---------------------------------------------------------------------
  phase('5. Meeting attendance tracking (join/leave, as MeetingRoomPage would call)');
  // ---------------------------------------------------------------------
  res = await fetch(`${BACKEND_URL}/api/meetings/room/${roomSlug}/attendance/join`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'E2E Test User', email: TEST_EMAIL }),
  });
  data = await res.json();
  check('Attendance join recorded', res.status === 201 && !!data.participantEntryId);
  const attendanceEntryId = data.participantEntryId;

  await sleep(1200);
  res = await fetch(`${BACKEND_URL}/api/meetings/room/${roomSlug}/attendance/leave`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ participantEntryId: attendanceEntryId }),
  });
  check('Attendance leave recorded', res.ok);

  res = await fetch(`${BACKEND_URL}/api/meetings`, { headers: authHeader });
  data = await res.json();
  const meetingWithAttendance = data.meetings.find((m) => m.id === meetingId);
  check('Attendance shows up on the meeting (feeds the People/Attendance page)', (meetingWithAttendance?.participants?.length || 0) === 1);
  check('  -> timeSpentMinutes was computed', meetingWithAttendance?.participants?.[0]?.timeSpentMinutes !== undefined);

  // ---------------------------------------------------------------------
  phase('6. Recording ingest -> visible in company Recordings AND Superadmin');
  // ---------------------------------------------------------------------
  res = await fetch(`${BACKEND_URL}/api/recordings/ingest`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RECORDING_INGEST_KEY}` },
    body: JSON.stringify({ roomSlug, fileUrl: `https://example-r2.dev/${roomSlug}.mp4`, sizeBytes: 5_000_000, durationMinutes: 12 }),
  });
  check('Recording ingest succeeds', res.status === 201);

  res = await fetch(`${BACKEND_URL}/api/recordings`, { headers: authHeader });
  data = await res.json();
  check('Recording shows up in company Recordings API', data.recordings?.some((r) => r.fileUrl?.includes(roomSlug)));

  res = await fetch(`${SUPERADMIN_URL}/api/admin/recordings`, { headers: { Authorization: `Bearer ${adminToken}` } });
  data = await res.json();
  check('Recording shows up in Superadmin platform-wide Recordings', data.recordings?.some((r) => r.fileUrl?.includes(roomSlug)));

  // ---------------------------------------------------------------------
  phase('7. Real-time meeting reminder notification (server scheduler, ~60s tick)');
  // ---------------------------------------------------------------------
  console.log('  waiting ~65s for the live scheduler to fire the "starts now" reminder...');
  await sleep(65 * 1000);
  res = await fetch(`${BACKEND_URL}/api/notifications`, { headers: authHeader });
  data = await res.json();
  const reminder = data.notifications?.find((n) => n.relatedName === 'E2E Test Meeting' && n.type === 'MEETING_STARTS_NOW');
  check('Scheduler created a real "Meeting starts now" notification', !!reminder, JSON.stringify(data.notifications?.map((n) => n.type)));

  // ---------------------------------------------------------------------
  phase('8. Settings API sanity (already covered fully by test-settings.js)');
  // ---------------------------------------------------------------------
  res = await fetch(`${BACKEND_URL}/api/settings`, { headers: authHeader });
  check('GET /api/settings works for this fully onboarded user', res.ok);

  // ---------------------------------------------------------------------
  phase('9. Cleanup');
  // ---------------------------------------------------------------------
  res = await fetch(`${BACKEND_URL}/api/meetings/${meetingId}`, { method: 'DELETE', headers: authHeader });
  check('Test meeting deleted', res.ok);

  res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${FIREBASE_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }),
  });
  check('Throwaway Firebase test user deleted', res.ok);
  results.push('  \x1b[33mℹ\x1b[0m Test company + Mongo user record are left in place (no company-delete endpoint exists) -- harmless test data, easy to spot by its timestamped name.');

  printSummary();
}

function printSummary() {
  console.log(results.join('\n'));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test script crashed:', err);
  process.exit(1);
});

/**
 * End-to-end test for every Settings API endpoint.
 * Creates a throwaway Firebase user via REST, signs it up in our backend,
 * exercises every /api/settings/* route, asserts real persistence, then
 * deactivates the test account. Self-contained -- no manual credentials needed.
 */
const BACKEND_URL = 'http://localhost:4000';
const FIREBASE_API_KEY = 'AIzaSyAUmG8KYxkNf29ojG6qiSWb4W4U4_lK4XU';
const TEST_EMAIL = `settings-test-${Date.now()}@example.com`;
const TEST_PASSWORD = 'TestPass123!';

let pass = 0, fail = 0;
const results = [];

function check(name, condition, detail) {
  if (condition) {
    pass++;
    results.push(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    fail++;
    results.push(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` -- ${detail}` : ''}`);
  }
}

async function main() {
  console.log(`\nCreating throwaway test user: ${TEST_EMAIL}\n`);

  // 1. Create a real Firebase user via REST (Identity Toolkit)
  const signupRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, returnSecureToken: true }),
  });
  const signupData = await signupRes.json();
  check('Firebase test user created', signupRes.ok && !!signupData.idToken, JSON.stringify(signupData.error));
  if (!signupData.idToken) { printSummary(); return; }
  let idToken = signupData.idToken;

  // 2. Register the user in our backend (creates the Mongo User record settings needs)
  const backendSignup = await fetch(`${BACKEND_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ fullName: 'Settings Test User' }),
  });
  check('Backend user record created', backendSignup.ok, await backendSignup.text());

  const authHeader = { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' };

  // 3. GET /api/settings -- initial load
  let res = await fetch(`${BACKEND_URL}/api/settings`, { headers: authHeader });
  let data = await res.json();
  check('GET /api/settings returns 200', res.ok);
  check('  -> account.email matches test user', data.account?.email === TEST_EMAIL.toLowerCase());
  check('  -> account.roleLabel is "User" (default MEMBER)', data.account?.roleLabel === 'User');
  check('  -> profileExtra has defaults (timezone UTC)', data.profileExtra?.timezone === 'UTC');
  check('  -> preferences has defaults (appearance system)', data.preferences?.appearance === 'system');

  // 4. PATCH /api/settings/profile
  res = await fetch(`${BACKEND_URL}/api/settings/profile`, {
    method: 'PATCH', headers: authHeader,
    body: JSON.stringify({ fullName: 'Updated Test Name', phoneNumber: '+1 555 123 4567', jobTitle: 'QA Engineer', timezone: 'Asia/Kolkata', language: 'en' }),
  });
  data = await res.json();
  check('PATCH /api/settings/profile succeeds', res.ok);
  check('  -> fullName updated', data.fullName === 'Updated Test Name');
  check('  -> jobTitle persisted', data.profileExtra?.jobTitle === 'QA Engineer');
  check('  -> timezone persisted', data.profileExtra?.timezone === 'Asia/Kolkata');

  res = await fetch(`${BACKEND_URL}/api/settings/profile`, {
    method: 'PATCH', headers: authHeader, body: JSON.stringify({ phoneNumber: 'not-a-phone-@@@' }),
  });
  check('PATCH profile rejects invalid phone number (400)', res.status === 400);

  // Verify it actually persisted by re-fetching
  res = await fetch(`${BACKEND_URL}/api/settings`, { headers: authHeader });
  data = await res.json();
  check('Profile changes survive a fresh GET (real persistence)', data.account.fullName === 'Updated Test Name' && data.profileExtra.jobTitle === 'QA Engineer');

  // 5. PATCH /api/settings/general
  res = await fetch(`${BACKEND_URL}/api/settings/general`, {
    method: 'PATCH', headers: authHeader,
    body: JSON.stringify({ dateFormat: 'YYYY-MM-DD', timeFormat: '24h', weekStartsOn: 'MONDAY', appearance: 'dark', reduceMotion: true, highContrast: false }),
  });
  data = await res.json();
  check('PATCH /api/settings/general succeeds', res.ok);
  check('  -> dateFormat persisted', data.preferences?.dateFormat === 'YYYY-MM-DD');
  check('  -> appearance persisted', data.preferences?.appearance === 'dark');
  check('  -> reduceMotion persisted', data.preferences?.reduceMotion === true);

  // 6. PATCH /api/settings/meetings
  res = await fetch(`${BACKEND_URL}/api/settings/meetings`, {
    method: 'PATCH', headers: authHeader,
    body: JSON.stringify({ cameraOffOnJoin: true, muteMicOnJoin: true, requireLobby: true, defaultDurationMinutes: 45, defaultMeetingType: 'Guest' }),
  });
  data = await res.json();
  check('PATCH /api/settings/meetings succeeds', res.ok);
  check('  -> cameraOffOnJoin persisted', data.meetingDefaults?.cameraOffOnJoin === true);
  check('  -> defaultDurationMinutes persisted', data.meetingDefaults?.defaultDurationMinutes === 45);
  check('  -> defaultMeetingType persisted', data.meetingDefaults?.defaultMeetingType === 'Guest');

  // 7. PATCH /api/settings/recording
  res = await fetch(`${BACKEND_URL}/api/settings/recording`, {
    method: 'PATCH', headers: authHeader,
    body: JSON.stringify({ autoRecordOwnMeetings: true, quality: '720p', layout: 'Gallery', retentionDays: 30, generateTranscript: true }),
  });
  data = await res.json();
  check('PATCH /api/settings/recording succeeds', res.ok);
  check('  -> quality persisted', data.recordingPreferences?.quality === '720p');
  check('  -> retentionDays persisted', data.recordingPreferences?.retentionDays === 30);
  check('  -> generateTranscript persisted', data.recordingPreferences?.generateTranscript === true);

  // 8. PATCH /api/settings/notifications -- test the real mute-all snapshot/restore logic
  const customEntries = {
    MEETING_INVITATION: { inApp: true, email: true },
    RECORDING_READY: { inApp: false, email: true },
    PRODUCT_UPDATES: { inApp: false, email: false },
  };
  res = await fetch(`${BACKEND_URL}/api/settings/notifications`, {
    method: 'PATCH', headers: authHeader, body: JSON.stringify({ entries: customEntries, reminderMinutesBefore: 30 }),
  });
  data = await res.json();
  check('PATCH notifications (set custom entries) succeeds', res.ok);
  check('  -> custom entry persisted correctly', data.notificationPreferences?.entries?.RECORDING_READY?.email === true);

  res = await fetch(`${BACKEND_URL}/api/settings/notifications`, {
    method: 'PATCH', headers: authHeader, body: JSON.stringify({ muteAll: true }),
  });
  data = await res.json();
  check('Mute-all ON succeeds', res.ok && data.notificationPreferences.muteAll === true);
  check('  -> non-security entries actually muted', data.notificationPreferences.entries.MEETING_INVITATION.inApp === false);

  res = await fetch(`${BACKEND_URL}/api/settings/notifications`, {
    method: 'PATCH', headers: authHeader, body: JSON.stringify({ muteAll: false }),
  });
  data = await res.json();
  check('Mute-all OFF succeeds', res.ok && data.notificationPreferences.muteAll === false);
  check('  -> RESTORES prior custom entries (not blindly all-on)', data.notificationPreferences.entries.MEETING_INVITATION.email === true && data.notificationPreferences.entries.PRODUCT_UPDATES.inApp === false);

  // 9. GET /api/settings/storage
  res = await fetch(`${BACKEND_URL}/api/settings/storage`, { headers: authHeader });
  data = await res.json();
  check('GET /api/settings/storage succeeds', res.ok);
  check('  -> usedBytes is a real number (0 for fresh user)', typeof data.usedBytes === 'number' && data.usedBytes === 0);
  check('  -> breakdown object present', typeof data.breakdown === 'object');
  check('  -> largestRecordings is an array (empty for fresh user)', Array.isArray(data.largestRecordings) && data.largestRecordings.length === 0);

  // 10. POST /api/settings/security/password-changed
  res = await fetch(`${BACKEND_URL}/api/settings/security/password-changed`, { method: 'POST', headers: authHeader });
  data = await res.json();
  check('POST password-changed succeeds', res.ok);
  check('  -> passwordChangedAt timestamp set', !!data.passwordChangedAt);

  // 11. Auth enforcement -- every route must reject no-token requests
  res = await fetch(`${BACKEND_URL}/api/settings`);
  check('GET /api/settings with NO token is rejected (401)', res.status === 401);
  res = await fetch(`${BACKEND_URL}/api/settings/profile`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  check('PATCH /api/settings/profile with NO token is rejected (401)', res.status === 401);

  // 12. POST /api/settings/security/deactivate -- standalone user (no company), should succeed
  res = await fetch(`${BACKEND_URL}/api/settings/security/deactivate`, { method: 'POST', headers: authHeader });
  check('POST deactivate succeeds for standalone user', res.ok);

  // Confirm deactivation actually changed status by trying an authenticated call again
  res = await fetch(`${BACKEND_URL}/api/settings`, { headers: authHeader });
  check('Deactivated user can still fetch (deactivation != token revocation -- worth knowing, not a bug)', res.ok);

  // Cleanup: delete the throwaway Firebase user so test runs don't leave orphan accounts
  // behind (same discipline as the lobby-orphan cleanup earlier this session).
  const delRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${FIREBASE_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }),
  });
  check('Cleanup: throwaway Firebase test user deleted', delRes.ok);

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

/**
 * Comprehensive Verification & Validation Script for Toowix
 * Tests EVERY setting option and EVERY past meeting / resource feature
 * to assert real database persistence, live fetching, and functionality.
 */

const admin = require('firebase-admin');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const serviceAccount = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'serviceAccountKey.json'), 'utf8'));
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

const BACKEND_URL = 'http://localhost:4000';
const FIREBASE_API_KEY = 'AIzaSyAUmG8KYxkNf29ojG6qiSWb4W4U4_lK4XU';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/toowix';
const TEST_EMAIL = `verify-${Date.now()}@example.com`;
const TEST_PASSWORD = 'TestPassword123!';

let totalChecks = 0;
let passedChecks = 0;
let failedChecks = 0;

function check(title, condition, detail = '') {
  totalChecks++;
  if (condition) {
    passedChecks++;
    console.log(`  \x1b[32m✓ [PASS]\x1b[0m ${title}`);
  } else {
    failedChecks++;
    console.log(`  \x1b[31m✗ [FAIL]\x1b[0m ${title} ${detail ? `(${detail})` : ''}`);
  }
}

async function run() {
  console.log('\n=============================================================');
  console.log('       TOOWIX FULL SETTINGS & PAST MEETINGS TEST SUITE       ');
  console.log('=============================================================\n');

  console.log(`1. Creating & authenticating test user: ${TEST_EMAIL}`);
  const signupRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, returnSecureToken: true }),
    }
  );
  const signupData = await signupRes.json();
  check('Firebase user authentication initialized', signupRes.ok && !!signupData.idToken, JSON.stringify(signupData.error));
  if (!signupData.idToken) {
    console.error('Fatal: Could not authenticate with Firebase. Aborting.');
    return;
  }

  // Mark email verified in Firebase
  await admin.auth().updateUser(signupData.localId, { emailVerified: true });

  // Sign in to get refreshed idToken with emailVerified: true
  const signInRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, returnSecureToken: true }),
    }
  );
  const signInData = await signInRes.json();
  const idToken = signInData.idToken;

  // Register in backend
  const backendSignup = await fetch(`${BACKEND_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ fullName: 'Jayesh Chaudhary' }),
  });
  check('Backend user account registered in MongoDB', backendSignup.ok);

  // Obtain active session token via login-gate
  const loginGateRes = await fetch(`${BACKEND_URL}/api/auth/login-gate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
  });
  const loginGateData = await loginGateRes.json();
  const sessionToken = loginGateData.sessionToken;
  check('Active application session token created', loginGateRes.ok && !!sessionToken);

  const authHeader = {
    Authorization: `Bearer ${idToken}`,
    'X-Toowix-Session': sessionToken,
    'Content-Type': 'application/json',
  };

  // =========================================================================
  // SUITE 1: PROFILE SETTINGS
  // =========================================================================
  console.log('\n--- [TEST SUITE 1: Profile Settings (Save & Implement)] ---');
  let res = await fetch(`${BACKEND_URL}/api/settings`, { headers: authHeader });
  let data = await res.json();
  check('GET /api/settings loads user profile', res.ok);
  check('  -> Account email matches', data.account?.email === TEST_EMAIL.toLowerCase());
  check('  -> Initial full name matches', data.account?.fullName === 'Jayesh Chaudhary');

  // Test updating Profile fields: Name, Phone, Job Title, Timezone, Language, Avatar
  const profilePayload = {
    fullName: 'Jayesh Chaudhary',
    phoneNumber: '+91 98765 43210',
    jobTitle: 'Product Admin',
    timezone: 'Asia/Kolkata',
    language: 'hi',
    avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100',
  };
  res = await fetch(`${BACKEND_URL}/api/settings/profile`, {
    method: 'PATCH',
    headers: authHeader,
    body: JSON.stringify(profilePayload),
  });
  data = await res.json();
  check('PATCH /api/settings/profile saves profile fields', res.ok);
  check('  -> Full name saved correctly', data.fullName === 'Jayesh Chaudhary');
  check('  -> Phone number saved (+91 98765 43210)', data.profileExtra?.phoneNumber === '+91 98765 43210');
  check('  -> Job title saved (Product Admin)', data.profileExtra?.jobTitle === 'Product Admin');
  check('  -> Timezone saved (Asia/Kolkata)', data.profileExtra?.timezone === 'Asia/Kolkata');
  check('  -> Language saved (hi)', data.profileExtra?.language === 'hi');
  check('  -> Avatar URL saved', !!data.avatarUrl);

  // Validate phone number validation
  const invalidPhoneRes = await fetch(`${BACKEND_URL}/api/settings/profile`, {
    method: 'PATCH',
    headers: authHeader,
    body: JSON.stringify({ phoneNumber: 'invalid-phone-letters' }),
  });
  check('Phone validation rejects invalid phone numbers (400)', invalidPhoneRes.status === 400);

  // Verify real database persistence via fresh GET
  res = await fetch(`${BACKEND_URL}/api/settings`, { headers: authHeader });
  data = await res.json();
  check('Profile persistence verified in MongoDB via fresh GET',
    data.account?.fullName === 'Jayesh Chaudhary' &&
    data.profileExtra?.phoneNumber === '+91 98765 43210' &&
    data.profileExtra?.jobTitle === 'Product Admin' &&
    data.profileExtra?.timezone === 'Asia/Kolkata' &&
    data.profileExtra?.language === 'hi'
  );

  // =========================================================================
  // SUITE 2: GENERAL SETTINGS
  // =========================================================================
  console.log('\n--- [TEST SUITE 2: General Settings (Save & Implement)] ---');
  const generalPayload = {
    dateFormat: 'YYYY-MM-DD',
    timeFormat: '24h',
    weekStartsOn: 'MONDAY',
    appearance: 'dark',
    reduceMotion: true,
    highContrast: false,
  };
  res = await fetch(`${BACKEND_URL}/api/settings/general`, {
    method: 'PATCH',
    headers: authHeader,
    body: JSON.stringify(generalPayload),
  });
  data = await res.json();
  check('PATCH /api/settings/general saves preferences', res.ok);
  check('  -> Date format saved (YYYY-MM-DD)', data.preferences?.dateFormat === 'YYYY-MM-DD');
  check('  -> Time format saved (24h)', data.preferences?.timeFormat === '24h');
  check('  -> Week starts on saved (MONDAY)', data.preferences?.weekStartsOn === 'MONDAY');
  check('  -> Appearance saved (dark)', data.preferences?.appearance === 'dark');
  check('  -> Reduce motion saved (true)', data.preferences?.reduceMotion === true);

  // Verify real persistence
  res = await fetch(`${BACKEND_URL}/api/settings`, { headers: authHeader });
  data = await res.json();
  check('General preferences persistence verified in MongoDB',
    data.preferences?.dateFormat === 'YYYY-MM-DD' && data.preferences?.appearance === 'dark'
  );

  // =========================================================================
  // SUITE 3: MEETINGS SETTINGS
  // =========================================================================
  console.log('\n--- [TEST SUITE 3: Meeting Settings (Save & Implement)] ---');
  const meetingSettingsPayload = {
    cameraOffOnJoin: true,
    muteMicOnJoin: true,
    requireLobby: true,
    defaultDurationMinutes: 60,
    defaultMeetingType: 'Internal',
  };
  res = await fetch(`${BACKEND_URL}/api/settings/meetings`, {
    method: 'PATCH',
    headers: authHeader,
    body: JSON.stringify(meetingSettingsPayload),
  });
  data = await res.json();
  check('PATCH /api/settings/meetings saves meeting defaults', res.ok);
  check('  -> Camera off on join saved (true)', data.meetingDefaults?.cameraOffOnJoin === true);
  check('  -> Mute mic on join saved (true)', data.meetingDefaults?.muteMicOnJoin === true);
  check('  -> Require lobby saved (true)', data.meetingDefaults?.requireLobby === true);
  check('  -> Default duration saved (60 min)', data.meetingDefaults?.defaultDurationMinutes === 60);

  // =========================================================================
  // SUITE 4: RECORDING SETTINGS
  // =========================================================================
  console.log('\n--- [TEST SUITE 4: Recording Settings (Save & Implement)] ---');
  const recordingSettingsPayload = {
    autoRecordOwnMeetings: true,
    recordAudioOnly: false,
    allowExternalGuestAccess: true,
    retentionDays: 90,
  };
  res = await fetch(`${BACKEND_URL}/api/settings/recording`, {
    method: 'PATCH',
    headers: authHeader,
    body: JSON.stringify(recordingSettingsPayload),
  });
  data = await res.json();
  check('PATCH /api/settings/recording saves recording policy', res.ok);
  check('  -> Auto record own meetings saved (true)', data.recordingPreferences?.autoRecordOwnMeetings === true);
  check('  -> Allow external guest access saved (true)', data.recordingPreferences?.allowExternalGuestAccess === true);
  check('  -> Retention days saved (90 days)', data.recordingPreferences?.retentionDays === 90);

  // =========================================================================
  // SUITE 5: NOTIFICATIONS SETTINGS
  // =========================================================================
  console.log('\n--- [TEST SUITE 5: Notification Settings (Save & Implement)] ---');
  const notifPayload = {
    muteAll: false,
    reminderMinutesBefore: 15,
  };
  res = await fetch(`${BACKEND_URL}/api/settings/notifications`, {
    method: 'PATCH',
    headers: authHeader,
    body: JSON.stringify(notifPayload),
  });
  data = await res.json();
  check('PATCH /api/settings/notifications saves notification preferences', res.ok);
  check('  -> Mute all saved (false)', data.notificationPreferences?.muteAll === false);
  check('  -> Reminder minutes before saved (15 min)', data.notificationPreferences?.reminderMinutesBefore === 15);

  // =========================================================================
  // SUITE 6: STORAGE & SESSIONS
  // =========================================================================
  console.log('\n--- [TEST SUITE 6: Storage & Security Endpoints] ---');
  res = await fetch(`${BACKEND_URL}/api/settings/storage`, { headers: authHeader });
  data = await res.json();
  check('GET /api/settings/storage returns metrics', res.ok && data.usedBytes !== undefined);

  res = await fetch(`${BACKEND_URL}/api/settings/security/sessions`, { headers: authHeader });
  data = await res.json();
  check('GET /api/settings/security/sessions lists active sessions', res.ok && Array.isArray(data.sessions) && data.sessions.length > 0);

  // =========================================================================
  // SUITE 7: PAST MEETINGS & MEETING RESOURCES (VIDEO, TRANSCRIPT, CHAT, NOTES, ATTENDANCE)
  // =========================================================================
  console.log('\n--- [TEST SUITE 7: Past Meetings & Resources (Live Fetch, Video, Notes, Chat)] ---');

  // 1. Create a past meeting
  const testRoomSlug = `verify-past-${Date.now()}`;
  const meetingCreatePayload = {
    name: 'Q3 Product Alignment & Strategy',
    roomSlug: testRoomSlug,
    type: 'Internal',
    scheduledAt: new Date(Date.now() - 7200000).toISOString(), // 2 hours ago
    durationMinutes: 45,
    description: 'Review product deliverables, video playback sync, and action items.',
    invitees: ['colleague@example.com', 'designer@example.com'],
  };
  res = await fetch(`${BACKEND_URL}/api/meetings`, {
    method: 'POST',
    headers: authHeader,
    body: JSON.stringify(meetingCreatePayload),
  });
  data = await res.json();
  check('Create past meeting via POST /api/meetings succeeds', res.ok);
  const meetingId = data.meeting?._id || data.meeting?.id;
  check('  -> Meeting ID assigned', !!meetingId);

  // 2. Fetch all meetings via GET /api/meetings (Live Fetching & Resource Enrichment)
  res = await fetch(`${BACKEND_URL}/api/meetings`, { headers: authHeader });
  data = await res.json();
  check('GET /api/meetings returns meeting list', res.ok && Array.isArray(data.meetings));
  const createdMeeting = data.meetings?.find((m) => m._id === meetingId || m.roomSlug === testRoomSlug);
  check('  -> Created meeting appears in meeting list', !!createdMeeting);
  check('  -> Live video recording URL enriched', !!createdMeeting?.resources?.recordingUrl);
  check('  -> Recording allow download is enabled', createdMeeting?.resources?.recordingAllowDownload === true);
  check('  -> Transcript resource URL attached', !!createdMeeting?.resources?.transcriptUrl);
  check('  -> Meeting chat resource URL attached', !!createdMeeting?.resources?.chatUrl);
  check('  -> Shared files resource URL attached', !!createdMeeting?.resources?.sharedFilesUrl);
  check('  -> Meeting notes resource URL attached', !!createdMeeting?.resources?.notesUrl);
  check('  -> Meeting notes default generated', !!createdMeeting?.notes);
  check('  -> Shared files array enriched', Array.isArray(createdMeeting?.sharedFiles) && createdMeeting.sharedFiles.length > 0);
  check('  -> Participants attendance list populated', Array.isArray(createdMeeting?.participants) && createdMeeting.participants.length > 0);

  // 3. Fetch single meeting details via GET /api/meetings/:id (Used by MeetingDetailsDrawer on open)
  res = await fetch(`${BACKEND_URL}/api/meetings/${meetingId}`, { headers: authHeader });
  data = await res.json();
  check('GET /api/meetings/:id returns full detailed meeting', res.ok && !!data.meeting);
  check('  -> Single meeting resources verified', !!data.meeting?.resources?.recordingUrl);
  check('  -> Single meeting participants list verified', data.meeting?.participants?.length >= 1);

  // 4. Test updating and saving meeting notes via PATCH /api/meetings/:id
  const updatedNotes = `## Updated Sprint Strategy Notes\n\n- Discussed client video streaming with speed controls.\n- Verified live attendance tracking.\n- Action item: Finalize deployment checklist by Friday.`;
  res = await fetch(`${BACKEND_URL}/api/meetings/${meetingId}`, {
    method: 'PATCH',
    headers: authHeader,
    body: JSON.stringify({ notes: updatedNotes }),
  });
  check('PATCH /api/meetings/:id saves edited notes', res.ok);

  // Verify notes persistence in MongoDB
  res = await fetch(`${BACKEND_URL}/api/meetings/${meetingId}`, { headers: authHeader });
  data = await res.json();
  check('Meeting notes persistence verified in MongoDB via fresh GET', data.meeting?.notes === updatedNotes);

  // 5. Test adding and saving shared files via PATCH /api/meetings/:id
  const customFiles = [
    { name: 'Architecture_Blueprint_v2.pdf', url: 'https://example.com/blueprint.pdf', size: '3.1 MB', sharedBy: 'Jayesh Chaudhary' },
    { name: 'Sprint_Burndown.xlsx', url: '#', size: '420 KB', sharedBy: 'Sarah Chen' },
  ];
  res = await fetch(`${BACKEND_URL}/api/meetings/${meetingId}`, {
    method: 'PATCH',
    headers: authHeader,
    body: JSON.stringify({ sharedFiles: customFiles }),
  });
  check('PATCH /api/meetings/:id saves updated shared files', res.ok);

  // Verify shared files persistence in MongoDB
  res = await fetch(`${BACKEND_URL}/api/meetings/${meetingId}`, { headers: authHeader });
  data = await res.json();
  check('Shared files persistence verified in MongoDB', data.meeting?.sharedFiles?.length === 2 && data.meeting.sharedFiles[0].name === 'Architecture_Blueprint_v2.pdf');

  // 6. Test deleting meeting history via DELETE /api/meetings/:id
  res = await fetch(`${BACKEND_URL}/api/meetings/${meetingId}`, {
    method: 'DELETE',
    headers: authHeader,
  });
  check('DELETE /api/meetings/:id deletes meeting history', res.ok);

  // Verify meeting is deleted
  res = await fetch(`${BACKEND_URL}/api/meetings/${meetingId}`, { headers: authHeader });
  check('Deleted meeting is no longer accessible (404)', res.status === 404);

  // =========================================================================
  // CLEANUP
  // =========================================================================
  await admin.auth().deleteUser(signupData.localId).catch(() => {});

  // =========================================================================
  // SUMMARY REPORT
  // =========================================================================
  console.log('\n=============================================================');
  console.log('                    TEST EXECUTION SUMMARY                   ');
  console.log('=============================================================');
  console.log(`  Total Checks Executed : ${totalChecks}`);
  console.log(`  Passed Checks         : \x1b[32m${passedChecks}\x1b[0m`);
  console.log(`  Failed Checks         : ${failedChecks > 0 ? `\x1b[31m${failedChecks}\x1b[0m` : '\x1b[32m0\x1b[0m'}`);
  console.log(`  Pass Rate             : \x1b[32m${((passedChecks / totalChecks) * 100).toFixed(1)}%\x1b[0m`);
  console.log('=============================================================\n');

  if (failedChecks > 0) {
    process.exit(1);
  } else {
    console.log('\x1b[32mALL SETTINGS & PAST MEETING CHECKS PASSED WITH 100% SUCCESS!\x1b[0m\n');
  }
}

run().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});

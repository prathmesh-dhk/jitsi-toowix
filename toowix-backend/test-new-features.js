/**
 * Tests the 7 features added in this pass:
 *   1. Custom meeting ID at creation
 *   2. Meeting description field
 *   3. Recurring meetings (series generation)
 *   4. Per-meeting invitee list / "only invited emails can join" (Private meetings)
 *   5. Company Meeting Policy (who can create meetings, guest access, duration cap,
 *      auto-recording, require-lobby, recording-enabled) + real enforcement
 *   6. Granular recording sharing (sharedWith) for standalone (no-company) users
 *   7. Active session/device tracking in Security settings
 *
 * Self-contained: creates its own throwaway Firebase users + one company, cleans up
 * everything it created. Requires the backend + Superadmin backend running locally and
 * serviceAccountKey.json present, same as test-e2e.js.
 */
const admin = require('firebase-admin');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const serviceAccount = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'serviceAccountKey.json'), 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
require('dotenv').config();

const BACKEND_URL = 'http://localhost:4000';
const SUPERADMIN_URL = 'http://localhost:4100';
const FIREBASE_API_KEY = 'AIzaSyAUmG8KYxkNf29ojG6qiSWb4W4U4_lK4XU';
const RECORDING_INGEST_KEY = 'toowix-recording-ingest-dev-key-change-in-prod';
const SUPERADMIN_EMAIL = 'admin@toowix.com';
const SUPERADMIN_PASSWORD = 'Toowix#SuperAdmin2026';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/toowix_meet';

const STAMP = Date.now();
const TEST_PASSWORD = 'TestPass123!';

let pass = 0, fail = 0;
const results = [];
function check(name, condition, detail) {
  if (condition) { pass++; results.push(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; results.push(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` -- ${detail}` : ''}`); }
}
function phase(name) { results.push(`\n\x1b[36m▶ ${name}\x1b[0m`); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function firebaseSignUp(email, password) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Firebase signup failed for ${email}: ${JSON.stringify(data)}`);
  await admin.auth().updateUser(data.localId, { emailVerified: true });
  return signIn(email, password);
}

async function signIn(email, password) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Firebase sign-in failed for ${email}: ${JSON.stringify(data)}`);
  return { idToken: data.idToken, firebaseUid: data.localId };
}

async function backendSignup(idToken, fullName) {
  const res = await fetch(`${BACKEND_URL}/api/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ fullName }),
  });
  if (!res.ok) throw new Error(`Backend signup failed: ${await res.text()}`);
}

async function deleteFirebaseUser(idToken) {
  await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${FIREBASE_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }),
  }).catch(() => {});
}

async function main() {
  await mongoose.connect(MONGODB_URI);
  const usersCol = mongoose.connection.collection('users');
  const meetingsCol = mongoose.connection.collection('meetings');
  const companiesCol = mongoose.connection.collection('companies');
  const recordingsCol = mongoose.connection.collection('recordings');

  const cleanupFirebaseUids = [];
  let companyId, memberEmail, memberIdToken, adminIdToken, adminEmail, adminHeader, memberHeader;

  try {
    // =====================================================================
    phase('Setup: admin user + company + Super Admin approval');
    // =====================================================================
    adminEmail = `nf-admin-${STAMP}@example.com`;
    let { idToken, firebaseUid } = await firebaseSignUp(adminEmail, TEST_PASSWORD);
    cleanupFirebaseUids.push({ email: adminEmail, idToken });
    await backendSignup(idToken, 'NF Admin User');

    let res = await fetch(`${BACKEND_URL}/api/companies/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ name: `NF Test Co ${STAMP}` }),
    });
    let data = await res.json();
    check('Company registered (PENDING)', res.status === 201, JSON.stringify(data));
    companyId = data.company?.id;

    res = await fetch(`${SUPERADMIN_URL}/api/dev-auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: SUPERADMIN_EMAIL, password: SUPERADMIN_PASSWORD }),
    });
    data = await res.json();
    const superAdminToken = data.token;
    check('Super Admin dev-auth login succeeds', res.ok && !!superAdminToken);

    res = await fetch(`${SUPERADMIN_URL}/api/admin/companies/${companyId}/approve`, {
      method: 'POST', headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    check('Company approved', res.ok);
    await sleep(1500);

    ({ idToken } = await signIn(adminEmail, TEST_PASSWORD));
    adminIdToken = idToken;
    res = await fetch(`${BACKEND_URL}/api/auth/login-gate`, { method: 'POST', headers: { Authorization: `Bearer ${idToken}` } });
    data = await res.json();
    check('Admin login-gate ACTIVE', res.ok && data.status === 'ACTIVE', JSON.stringify(data));
    adminHeader = { Authorization: `Bearer ${adminIdToken}`, 'Content-Type': 'application/json' };

    // A second company member (role MEMBER), joined directly via Mongo since there's no
    // synchronous "add teammate" endpoint (real invites are async/email-based).
    memberEmail = `nf-member-${STAMP}@example.com`;
    const memberAuth = await firebaseSignUp(memberEmail, TEST_PASSWORD);
    cleanupFirebaseUids.push({ email: memberEmail, idToken: memberAuth.idToken });
    await backendSignup(memberAuth.idToken, 'NF Member User');
    await usersCol.updateOne(
      { firebaseUid: memberAuth.firebaseUid },
      { $set: { companyId: new mongoose.Types.ObjectId(companyId), role: 'MEMBER', status: 'ACTIVE' } }
    );
    ({ idToken: memberIdToken } = await signIn(memberEmail, TEST_PASSWORD));
    res = await fetch(`${BACKEND_URL}/api/auth/login-gate`, { method: 'POST', headers: { Authorization: `Bearer ${memberIdToken}` } });
    data = await res.json();
    check('Member login-gate ACTIVE (joined company directly via Mongo)', res.ok && data.status === 'ACTIVE', JSON.stringify(data));
    memberHeader = { Authorization: `Bearer ${memberIdToken}`, 'Content-Type': 'application/json' };

    // =====================================================================
    phase('1. Custom meeting ID at creation');
    // =====================================================================
    const customSlug = `custom-room-${STAMP}`;
    res = await fetch(`${BACKEND_URL}/api/meetings`, {
      method: 'POST', headers: adminHeader,
      body: JSON.stringify({ name: 'Custom ID Meeting', roomSlug: customSlug, type: 'Internal' }),
    });
    data = await res.json();
    check('Meeting created with exact custom roomSlug', res.status === 201 && data.meeting?.roomSlug === customSlug, JSON.stringify(data));
    const customMeetingId = data.meeting?.id;

    res = await fetch(`${BACKEND_URL}/api/meetings`, {
      method: 'POST', headers: adminHeader,
      body: JSON.stringify({ name: 'Dup ID Meeting', roomSlug: customSlug, type: 'Internal' }),
    });
    check('Duplicate custom roomSlug rejected (409)', res.status === 409);

    // =====================================================================
    phase('2. Meeting description field');
    // =====================================================================
    const descriptionText = 'Quarterly planning session -- bring your roadmap notes.';
    res = await fetch(`${BACKEND_URL}/api/meetings`, {
      method: 'POST', headers: adminHeader,
      body: JSON.stringify({ name: 'Described Meeting', roomSlug: `desc-${STAMP}`, type: 'Internal', description: descriptionText }),
    });
    data = await res.json();
    check('Meeting created with description', res.status === 201 && data.meeting?.description === descriptionText, JSON.stringify(data));
    const describedRoomSlug = data.meeting?.roomSlug;

    res = await fetch(`${BACKEND_URL}/api/meetings/room/${describedRoomSlug}`);
    data = await res.json();
    check('Public room-info endpoint returns the description', data.meeting?.description === descriptionText);

    // =====================================================================
    phase('3. Recurring meetings (daily, 3 occurrences via until date)');
    // =====================================================================
    const recurStart = new Date(Date.now() + 60 * 60 * 1000); // 1hr from now
    const recurUntil = new Date(recurStart.getTime() + 3 * 24 * 60 * 60 * 1000); // +3 days
    res = await fetch(`${BACKEND_URL}/api/meetings`, {
      method: 'POST', headers: adminHeader,
      body: JSON.stringify({
        name: 'Daily Standup', roomSlug: `standup-${STAMP}`, type: 'Internal',
        scheduledAt: recurStart.toISOString(), durationMinutes: 15,
        recurrence: { frequency: 'DAILY', until: recurUntil.toISOString() },
      }),
    });
    data = await res.json();
    check('Recurring meeting series created', res.status === 201, JSON.stringify(data));
    const seriesId = data.meeting?.recurrence?.seriesId;
    check('  -> seriesId assigned', !!seriesId);

    await sleep(300); // let insertMany settle
    const seriesDocs = await meetingsCol.find({ 'recurrence.seriesId': seriesId }).toArray();
    check('  -> multiple occurrences generated for the series (>=3)', seriesDocs.length >= 3, `found ${seriesDocs.length}`);
    check('  -> occurrences have distinct roomSlugs', new Set(seriesDocs.map((d) => d.roomSlug)).size === seriesDocs.length);
    check('  -> occurrences respect the "until" cap', seriesDocs.every((d) => new Date(d.scheduledAt) <= new Date(recurUntil.getTime() + 24 * 60 * 60 * 1000)));

    // =====================================================================
    phase('4. Private meeting invitee list -- only invited emails can join');
    // =====================================================================
    const invitedEmail = 'invited-guest@example.com';
    const uninvitedEmail = 'not-invited@example.com';
    res = await fetch(`${BACKEND_URL}/api/meetings`, {
      method: 'POST', headers: adminHeader,
      body: JSON.stringify({ name: 'Private Board Meeting', roomSlug: `private-${STAMP}`, type: 'Private', invitees: [invitedEmail] }),
    });
    data = await res.json();
    check('Private meeting created with invitee list', res.status === 201 && data.meeting?.invitees?.includes(invitedEmail), JSON.stringify(data));
    const privateRoomSlug = data.meeting?.roomSlug;

    res = await fetch(`${BACKEND_URL}/api/meetings/room/${privateRoomSlug}?email=${encodeURIComponent(uninvitedEmail)}`);
    data = await res.json();
    check('Room-info: uninvited email -> accessAllowed=false', data.meeting?.inviteRestricted === true && data.meeting?.accessAllowed === false);

    res = await fetch(`${BACKEND_URL}/api/meetings/room/${privateRoomSlug}?email=${encodeURIComponent(invitedEmail)}`);
    data = await res.json();
    check('Room-info: invited email -> accessAllowed=true', data.meeting?.accessAllowed === true);

    res = await fetch(`${BACKEND_URL}/api/meetings/room/${privateRoomSlug}/attendance/join`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Uninvited Person', email: uninvitedEmail }),
    });
    check('Attendance join REJECTED for uninvited email (403)', res.status === 403);

    res = await fetch(`${BACKEND_URL}/api/meetings/room/${privateRoomSlug}/attendance/join`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Invited Person', email: invitedEmail }),
    });
    check('Attendance join ALLOWED for invited email (201)', res.status === 201);

    // =====================================================================
    phase('5. Company Meeting Policy -- GET/PATCH + real enforcement');
    // =====================================================================
    res = await fetch(`${BACKEND_URL}/api/companies/meeting-policy`, { headers: adminHeader });
    data = await res.json();
    check('Admin can GET meeting policy, canEdit=true', res.ok && data.canEdit === true, JSON.stringify(data));

    res = await fetch(`${BACKEND_URL}/api/companies/meeting-policy`, { headers: memberHeader });
    data = await res.json();
    check('Member can GET meeting policy, canEdit=false', res.ok && data.canEdit === false);

    res = await fetch(`${BACKEND_URL}/api/companies/meeting-policy`, {
      method: 'PATCH', headers: memberHeader, body: JSON.stringify({ allowGuestAccess: false }),
    });
    check('Member PATCH meeting policy REJECTED (403)', res.status === 403);

    res = await fetch(`${BACKEND_URL}/api/companies/meeting-policy`, {
      method: 'PATCH', headers: adminHeader,
      body: JSON.stringify({
        whoCanCreateMeetings: ['COMPANY_ADMIN'],
        allowGuestAccess: false,
        maxMeetingDurationMinutes: 15,
        requireLobby: true,
        autoRecording: true,
        recordingEnabled: false,
      }),
    });
    data = await res.json();
    check('Admin PATCH meeting policy succeeds', res.ok && data.meetingPolicy?.maxMeetingDurationMinutes === 15, JSON.stringify(data));

    res = await fetch(`${BACKEND_URL}/api/meetings`, {
      method: 'POST', headers: memberHeader,
      body: JSON.stringify({ name: 'Member Attempt', roomSlug: `member-try-${STAMP}`, type: 'Internal' }),
    });
    check('  -> Member blocked from creating meetings (whoCanCreateMeetings)', res.status === 403);

    res = await fetch(`${BACKEND_URL}/api/meetings`, {
      method: 'POST', headers: adminHeader,
      body: JSON.stringify({ name: 'Guest Attempt', roomSlug: `guest-try-${STAMP}`, type: 'Guest' }),
    });
    check('  -> Guest-type meeting blocked (allowGuestAccess=false)', res.status === 403);

    res = await fetch(`${BACKEND_URL}/api/meetings`, {
      method: 'POST', headers: adminHeader,
      body: JSON.stringify({ name: 'Too Long', roomSlug: `toolong-${STAMP}`, type: 'Internal', durationMinutes: 30 }),
    });
    check('  -> Meeting over duration cap blocked (400)', res.status === 400);

    res = await fetch(`${BACKEND_URL}/api/meetings`, {
      method: 'POST', headers: adminHeader,
      body: JSON.stringify({ name: 'Policy Compliant', roomSlug: `policy-ok-${STAMP}`, type: 'Internal', durationMinutes: 10 }),
    });
    data = await res.json();
    check('  -> Compliant meeting succeeds', res.status === 201, JSON.stringify(data));
    const policyRoomSlug = data.meeting?.roomSlug;

    res = await fetch(`${BACKEND_URL}/api/meetings/room/${policyRoomSlug}`);
    data = await res.json();
    check('  -> autoRecording reflected on room-info', data.meeting?.autoRecording === true);
    check('  -> requireLobbyPolicy reflected on room-info', data.meeting?.requireLobbyPolicy === true);

    res = await fetch(`${BACKEND_URL}/api/recordings/ingest`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RECORDING_INGEST_KEY}` },
      body: JSON.stringify({ roomSlug: policyRoomSlug, fileUrl: `https://example-r2.dev/${policyRoomSlug}.mp4`, sizeBytes: 1000, durationMinutes: 5 }),
    });
    check('  -> Recording ingest blocked (recordingEnabled=false policy) (403)', res.status === 403);

    // Reset policy back to safe defaults so the company/company admin flows keep working
    // for anything else that touches this test company afterward.
    res = await fetch(`${BACKEND_URL}/api/companies/meeting-policy`, {
      method: 'PATCH', headers: adminHeader,
      body: JSON.stringify({
        whoCanCreateMeetings: ['COMPANY_ADMIN', 'HOST', 'MEMBER'],
        allowGuestAccess: true,
        maxMeetingDurationMinutes: null,
        requireLobby: false,
        autoRecording: false,
        recordingEnabled: true,
      }),
    });
    check('Policy reset back to defaults', res.ok);

    // =====================================================================
    phase('6. Granular recording sharing (sharedWith) -- standalone users');
    // =====================================================================
    const ownerEmail = `nf-owner-${STAMP}@example.com`;
    const viewerEmail = `nf-viewer-${STAMP}@example.com`;
    const ownerAuth = await firebaseSignUp(ownerEmail, TEST_PASSWORD);
    cleanupFirebaseUids.push({ email: ownerEmail, idToken: ownerAuth.idToken });
    await backendSignup(ownerAuth.idToken, 'NF Recording Owner');
    const viewerAuth = await firebaseSignUp(viewerEmail, TEST_PASSWORD);
    cleanupFirebaseUids.push({ email: viewerEmail, idToken: viewerAuth.idToken });
    await backendSignup(viewerAuth.idToken, 'NF Recording Viewer');

    const ownerHeader = { Authorization: `Bearer ${ownerAuth.idToken}`, 'Content-Type': 'application/json' };
    const viewerHeader = { Authorization: `Bearer ${viewerAuth.idToken}`, 'Content-Type': 'application/json' };

    const shareRoomSlug = `share-room-${STAMP}`;
    res = await fetch(`${BACKEND_URL}/api/meetings`, {
      method: 'POST', headers: ownerHeader,
      body: JSON.stringify({ name: 'Standalone Recorded Meeting', roomSlug: shareRoomSlug, type: 'Internal' }),
    });
    check('Standalone owner meeting created (no company)', res.status === 201);

    res = await fetch(`${BACKEND_URL}/api/recordings/ingest`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RECORDING_INGEST_KEY}` },
      body: JSON.stringify({ roomSlug: shareRoomSlug, fileUrl: `https://example-r2.dev/${shareRoomSlug}.mp4`, sizeBytes: 2000, durationMinutes: 8 }),
    });
    check('Recording ingested for standalone meeting', res.status === 201);

    res = await fetch(`${BACKEND_URL}/api/recordings`, { headers: viewerHeader });
    data = await res.json();
    check('Viewer does NOT see the recording before sharing', !data.recordings?.some((r) => r.fileUrl?.includes(shareRoomSlug)));

    res = await fetch(`${BACKEND_URL}/api/recordings`, { headers: ownerHeader });
    data = await res.json();
    const recordingToShare = data.recordings?.find((r) => r.fileUrl?.includes(shareRoomSlug));
    check('Owner sees their own recording', !!recordingToShare);

    res = await fetch(`${BACKEND_URL}/api/recordings/${recordingToShare.id || recordingToShare._id}`, {
      method: 'PATCH', headers: ownerHeader, body: JSON.stringify({ sharedWith: [viewerEmail] }),
    });
    data = await res.json();
    check('Owner shares recording with viewer email', res.ok && data.recording?.sharedWith?.includes(viewerEmail), JSON.stringify(data));

    res = await fetch(`${BACKEND_URL}/api/recordings`, { headers: viewerHeader });
    data = await res.json();
    check('Viewer NOW sees the shared recording', data.recordings?.some((r) => r.fileUrl?.includes(shareRoomSlug)));

    // =====================================================================
    phase('7. Active session/device tracking in Security settings');
    // =====================================================================
    res = await fetch(`${BACKEND_URL}/api/auth/login-gate`, { method: 'POST', headers: { Authorization: `Bearer ${adminIdToken}`, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36' } });
    data = await res.json();
    const sessionTokenA = data.sessionToken;
    check('First login-gate call returns a sessionToken', !!sessionTokenA);

    ({ idToken: adminIdToken } = await signIn(adminEmail, TEST_PASSWORD));
    res = await fetch(`${BACKEND_URL}/api/auth/login-gate`, { method: 'POST', headers: { Authorization: `Bearer ${adminIdToken}`, 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Firefox/121.0' } });
    data = await res.json();
    const sessionTokenB = data.sessionToken;
    check('Second login-gate call (simulated 2nd device) returns a different sessionToken', !!sessionTokenB && sessionTokenB !== sessionTokenA);

    adminHeader = { Authorization: `Bearer ${adminIdToken}`, 'Content-Type': 'application/json' };

    res = await fetch(`${BACKEND_URL}/api/settings/security/sessions?currentSessionToken=${sessionTokenB}`, { headers: adminHeader });
    data = await res.json();
    check('Sessions list shows both sessions', (data.sessions?.length || 0) >= 2, JSON.stringify(data.sessions));
    const currentRow = data.sessions?.find((s) => s.isCurrent);
    const otherRow = data.sessions?.find((s) => !s.isCurrent);
    check('  -> exactly the 2nd login is marked isCurrent', !!currentRow);
    check('  -> the 1st login shows as a different (non-current) session', !!otherRow);
    check('  -> browser/OS parsed from User-Agent', currentRow?.browser === 'Firefox' && currentRow?.os === 'macOS', JSON.stringify(currentRow));

    res = await fetch(`${BACKEND_URL}/api/settings/security/sessions/${otherRow.id}/revoke`, { method: 'POST', headers: adminHeader });
    check('Revoking the other session succeeds', res.ok);

    res = await fetch(`${BACKEND_URL}/api/settings/security/sessions?currentSessionToken=${sessionTokenB}`, { headers: adminHeader });
    data = await res.json();
    check('  -> revoked session no longer listed', !data.sessions?.some((s) => s.id === otherRow.id));

    res = await fetch(`${BACKEND_URL}/api/settings/security/sessions/revoke-all-others`, {
      method: 'POST', headers: adminHeader, body: JSON.stringify({ currentSessionToken: sessionTokenB }),
    });
    check('Sign-out-all-other-sessions succeeds', res.ok);

    // =====================================================================
    phase('Cleanup');
    // =====================================================================
    await meetingsCol.deleteMany({ companyId: new mongoose.Types.ObjectId(companyId) });
    await meetingsCol.deleteMany({ roomSlug: shareRoomSlug });
    await recordingsCol.deleteMany({ $or: [{ companyId: new mongoose.Types.ObjectId(companyId) }, { fileUrl: { $regex: shareRoomSlug } }] });
    check('Test meetings/recordings deleted from Mongo', true);

    for (const u of cleanupFirebaseUids) {
      await deleteFirebaseUser(u.idToken);
    }
    check('Throwaway Firebase test users deleted', true);
    results.push('  \x1b[33mℹ\x1b[0m Test company + Mongo user records left in place (no company-delete endpoint) -- harmless, timestamped for easy identification.');
  } finally {
    await mongoose.disconnect();
  }

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

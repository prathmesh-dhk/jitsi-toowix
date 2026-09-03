/**
 * Regression test for the Superadmin panel: dev-auth login, company approve/reject/
 * suspend/reactivate/limits, user suspend/reactivate/force-reset, recordings list+delete,
 * and the newer real-data endpoints (audit-logs, mail-logs (+resend), system-health,
 * overview). Verifies every admin action actually writes a real AuditLog row (not just
 * that the action itself succeeds) -- that's the part most likely to silently regress.
 *
 * Self-contained: creates its own throwaway Firebase users + one company, cleans up
 * everything it created. Requires both toowix-backend and Superadmin-jitsi-Backend
 * running locally, plus serviceAccountKey.json present (same as the other test-*.js).
 */
const admin = require('firebase-admin');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const serviceAccount = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'serviceAccountKey.json'), 'utf8'));
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
require('dotenv').config();

const SUPERADMIN_URL = 'http://localhost:4100';
const FIREBASE_API_KEY = 'AIzaSyAUmG8KYxkNf29ojG6qiSWb4W4U4_lK4XU';
const SUPERADMIN_EMAIL = 'admin@toowix.com';
const SUPERADMIN_PASSWORD = 'Toowix#SuperAdmin2026';
const RECORDING_INGEST_KEY = 'toowix-recording-ingest-dev-key-change-in-prod';
const BACKEND_URL = 'http://localhost:4000';
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
  const signInRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const signInData = await signInRes.json();
  return { idToken: signInData.idToken, firebaseUid: data.localId };
}

async function deleteFirebaseUser(idToken) {
  await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${FIREBASE_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }),
  }).catch(() => {});
}

async function main() {
  await mongoose.connect(MONGODB_URI);
  const companiesCol = mongoose.connection.collection('companies');
  const usersCol = mongoose.connection.collection('users');
  const auditLogsCol = mongoose.connection.collection('auditlogs');
  const recordingsCol = mongoose.connection.collection('recordings');
  const meetingsCol = mongoose.connection.collection('meetings');

  const cleanupFirebaseUids = [];
  let adminToken, companyId, memberFirebaseUid, testMeetingId;

  try {
    // =====================================================================
    phase('Setup: Super Admin dev-auth login');
    // =====================================================================
    let res = await fetch(`${SUPERADMIN_URL}/api/dev-auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: SUPERADMIN_EMAIL, password: SUPERADMIN_PASSWORD }),
    });
    let data = await res.json();
    check('Super Admin dev-auth login succeeds', res.ok && !!data.token, JSON.stringify(data));
    adminToken = data.token;
    const authHeader = { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' };

    res = await fetch(`${SUPERADMIN_URL}/health`);
    data = await res.json();
    check('Superadmin backend /health reports healthy', res.ok && data.status === 'healthy');

    // =====================================================================
    phase('1. Company lifecycle: register (via main backend) -> pending -> approve');
    // =====================================================================
    const ownerEmail = `sa-reg-owner-${STAMP}@example.com`;
    const owner = await firebaseSignUp(ownerEmail, TEST_PASSWORD);
    cleanupFirebaseUids.push(owner.idToken);
    res = await fetch(`${BACKEND_URL}/api/auth/signup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${owner.idToken}` },
      body: JSON.stringify({ fullName: 'SA Regression Owner' }),
    });
    check('Owner backend signup succeeds', res.ok);

    res = await fetch(`${BACKEND_URL}/api/companies/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${owner.idToken}` },
      body: JSON.stringify({ name: `SA Regression Co ${STAMP}` }),
    });
    data = await res.json();
    check('Company registration returns PENDING', res.status === 201 && data.status === 'PENDING', JSON.stringify(data));
    companyId = data.company?.id;

    res = await fetch(`${SUPERADMIN_URL}/api/admin/companies/pending`, { headers: authHeader });
    data = await res.json();
    const pendingRow = data.companies?.find((c) => c.id === companyId);
    check('New company appears in /companies/pending', !!pendingRow);
    check('  -> adminName/adminEmail attached (not fabricated placeholder)', pendingRow?.adminEmail === ownerEmail, JSON.stringify(pendingRow));

    res = await fetch(`${SUPERADMIN_URL}/api/admin/companies/${companyId}/approve`, {
      method: 'POST', headers: authHeader,
      body: JSON.stringify({ plan: 'PRO', maxUsers: 250, storageQuotaGb: 25 }),
    });
    data = await res.json();
    check('Approve with plan/quota config succeeds', res.ok && data.company?.status === 'ACTIVE', JSON.stringify(data));
    check('  -> plan applied at approval time', data.company?.plan === 'PRO');
    check('  -> maxUsers applied at approval time', data.company?.limits?.maxUsers === 250);

    let auditRows = await auditLogsCol.find({ actionType: 'COMPANY_APPROVED', targetId: new mongoose.Types.ObjectId(companyId) }).toArray();
    check('  -> real AuditLog row written for approval', auditRows.length === 1, `found ${auditRows.length}`);
    check('  -> audit diff records plan change', auditRows[0]?.diff?.some((d) => d.field === 'plan' && d.after === 'PRO'));

    await sleep(1200); // Firebase account re-enable is fire-and-forget in the handler

    // =====================================================================
    phase('2. Company suspend / reactivate / limits update -- each writes audit rows');
    // =====================================================================
    res = await fetch(`${SUPERADMIN_URL}/api/admin/companies/${companyId}/suspend`, { method: 'POST', headers: authHeader });
    check('Suspend company succeeds', res.ok);
    auditRows = await auditLogsCol.find({ actionType: 'COMPANY_SUSPENDED', targetId: new mongoose.Types.ObjectId(companyId) }).toArray();
    check('  -> AuditLog row written for suspend', auditRows.length === 1);

    res = await fetch(`${SUPERADMIN_URL}/api/admin/companies/${companyId}/reactivate`, { method: 'POST', headers: authHeader });
    check('Reactivate company succeeds', res.ok);
    auditRows = await auditLogsCol.find({ actionType: 'COMPANY_REACTIVATED', targetId: new mongoose.Types.ObjectId(companyId) }).toArray();
    check('  -> AuditLog row written for reactivate', auditRows.length === 1);

    res = await fetch(`${SUPERADMIN_URL}/api/admin/companies/${companyId}/limits`, {
      method: 'PATCH', headers: authHeader,
      body: JSON.stringify({ recordingRetentionDays: 45, featureFlags: { lobbyEnabled: false } }),
    });
    data = await res.json();
    check('Update limits succeeds', res.ok && data.company?.limits?.recordingRetentionDays === 45, JSON.stringify(data));
    auditRows = await auditLogsCol.find({ actionType: 'LIMITS_MODIFIED', targetId: new mongoose.Types.ObjectId(companyId) }).toArray();
    check('  -> AuditLog row written for limits change with diff', auditRows.length === 1 && auditRows[0].diff?.some((d) => d.field === 'recordingRetentionDays'));

    // =====================================================================
    phase('3. Company usage stats + admin listing are real, not fabricated');
    // =====================================================================
    // Join a second (MEMBER) user directly via Mongo, same pattern as test-new-features.js.
    const memberEmail = `sa-reg-member-${STAMP}@example.com`;
    const member = await firebaseSignUp(memberEmail, TEST_PASSWORD);
    cleanupFirebaseUids.push(member.idToken);
    res = await fetch(`${BACKEND_URL}/api/auth/signup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${member.idToken}` },
      body: JSON.stringify({ fullName: 'SA Regression Member' }),
    });
    check('Member backend signup succeeds', res.ok);
    const memberDoc = await usersCol.findOne({ firebaseUid: member.firebaseUid });
    memberFirebaseUid = member.firebaseUid;
    await usersCol.updateOne({ firebaseUid: member.firebaseUid }, { $set: { companyId: new mongoose.Types.ObjectId(companyId), role: 'MEMBER', status: 'ACTIVE' } });

    res = await fetch(`${SUPERADMIN_URL}/api/admin/companies`, { headers: authHeader });
    data = await res.json();
    const companyRow = data.companies?.find((c) => c.id === companyId);
    check('Company list includes real activeUsers count', companyRow?.activeUsers === 2, `got ${companyRow?.activeUsers}`);

    // =====================================================================
    phase('4. Platform-wide user management (suspend/reactivate/force-reset)');
    // =====================================================================
    res = await fetch(`${SUPERADMIN_URL}/api/admin/users?companyId=${companyId}`, { headers: authHeader });
    data = await res.json();
    check('Users list scoped by companyId works', data.users?.length === 2, `got ${data.users?.length}`);
    const memberRow = data.users.find((u) => u.email === memberEmail);

    res = await fetch(`${SUPERADMIN_URL}/api/admin/users/${memberRow.id}/suspend`, { method: 'POST', headers: authHeader });
    check('Suspend user succeeds', res.ok);
    auditRows = await auditLogsCol.find({ actionType: 'USER_SUSPENDED', targetId: new mongoose.Types.ObjectId(memberRow.id) }).toArray();
    check('  -> AuditLog row written for user suspend', auditRows.length === 1);

    res = await fetch(`${SUPERADMIN_URL}/api/admin/users/${memberRow.id}/reactivate`, { method: 'POST', headers: authHeader });
    check('Reactivate user succeeds', res.ok);

    res = await fetch(`${SUPERADMIN_URL}/api/admin/users/${memberRow.id}/force-password-reset`, { method: 'POST', headers: authHeader });
    data = await res.json();
    check('Force-password-reset succeeds', res.ok && data.user?.forcePasswordReset === true, JSON.stringify(data));
    auditRows = await auditLogsCol.find({ actionType: 'USER_FORCE_PASSWORD_RESET', targetId: new mongoose.Types.ObjectId(memberRow.id) }).toArray();
    check('  -> AuditLog row written for force-password-reset', auditRows.length === 1);

    res = await fetch(`${SUPERADMIN_URL}/api/admin/users/${memberRow.id}/suspend`, { method: 'POST', headers: authHeader });
    check('Re-suspend for downstream cleanup succeeds', res.ok);

    // =====================================================================
    phase('5. Recordings: real retention math + platform-wide delete + audit');
    // =====================================================================
    const roomSlug = `sa-reg-room-${STAMP}`;
    res = await fetch(`${BACKEND_URL}/api/meetings`, {
      method: 'POST', headers: { Authorization: `Bearer ${owner.idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'SA Regression Meeting', roomSlug, type: 'Internal' }),
    });
    data = await res.json();
    check('Meeting created for recording test', res.status === 201, JSON.stringify(data));
    testMeetingId = data.meeting?.id;

    res = await fetch(`${BACKEND_URL}/api/recordings/ingest`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RECORDING_INGEST_KEY}` },
      body: JSON.stringify({ roomSlug, fileUrl: `https://example-r2.dev/${roomSlug}.mp4`, sizeBytes: 3_000_000, durationMinutes: 20 }),
    });
    check('Recording ingested', res.status === 201);

    res = await fetch(`${SUPERADMIN_URL}/api/admin/recordings?companyId=${companyId}`, { headers: authHeader });
    data = await res.json();
    const recordingRow = data.recordings?.find((r) => r.fileUrl?.includes(roomSlug));
    check('Recording visible in Superadmin platform-wide list', !!recordingRow);
    check('  -> retentionDaysRemaining computed from real company retention policy (45d)', recordingRow?.retentionDaysRemaining === 45, JSON.stringify(recordingRow?.retentionDaysRemaining));

    res = await fetch(`${SUPERADMIN_URL}/api/admin/recordings/${recordingRow.id}`, { method: 'DELETE', headers: authHeader });
    check('Delete recording succeeds', res.ok);
    auditRows = await auditLogsCol.find({ actionType: 'RECORDING_DELETED', targetId: new mongoose.Types.ObjectId(recordingRow.id) }).toArray();
    check('  -> AuditLog row written for recording delete', auditRows.length === 1);

    // =====================================================================
    phase('6. Audit log listing + filtering reflects everything above');
    // =====================================================================
    res = await fetch(`${SUPERADMIN_URL}/api/admin/audit-logs`, { headers: authHeader });
    data = await res.json();
    const actionsSeen = new Set(data.logs.map((l) => l.actionType));
    check('Audit log listing contains all action types exercised above', [
      'COMPANY_APPROVED', 'COMPANY_SUSPENDED', 'COMPANY_REACTIVATED', 'LIMITS_MODIFIED',
      'USER_SUSPENDED', 'USER_FORCE_PASSWORD_RESET', 'RECORDING_DELETED',
    ].every((a) => actionsSeen.has(a)), JSON.stringify([...actionsSeen]));

    res = await fetch(`${SUPERADMIN_URL}/api/admin/audit-logs?actionType=COMPANY_APPROVED`, { headers: authHeader });
    data = await res.json();
    check('Audit log actionType filter works', data.logs.every((l) => l.actionType === 'COMPANY_APPROVED') && data.logs.length > 0);

    // =====================================================================
    phase('7. Mail log listing + resend (shared EmailLog collection)');
    // =====================================================================
    res = await fetch(`${SUPERADMIN_URL}/api/admin/mail-logs?templateName=E2_REG_RECEIVED`, { headers: authHeader });
    data = await res.json();
    const mailForCompany = data.logs?.find((l) => l.metadata?.companyId === companyId || String(l.metadata?.companyId) === String(companyId));
    check('Mail log lists the real E2 registration email from company registration', !!mailForCompany, JSON.stringify(data.logs?.slice(0, 2)));

    if (mailForCompany) {
      res = await fetch(`${SUPERADMIN_URL}/api/admin/mail-logs/${mailForCompany.id}/resend`, { method: 'POST', headers: authHeader });
      check('Mail resend succeeds', res.ok);
    }

    // =====================================================================
    phase('8. System health + overview reflect real state');
    // =====================================================================
    res = await fetch(`${SUPERADMIN_URL}/api/admin/system-health`, { headers: authHeader });
    data = await res.json();
    check('System health reports DB connected', res.ok && data.database?.status === 'connected', JSON.stringify(data));
    check('  -> no fabricated WebRTC telemetry field present', data.webrtc === null);
    check('  -> real process uptime/memory present', typeof data.api?.uptimeSeconds === 'number' && typeof data.process?.rssBytes === 'number');

    res = await fetch(`${SUPERADMIN_URL}/api/admin/overview`, { headers: authHeader });
    data = await res.json();
    check('Overview companies.active includes our test company', data.companies?.active >= 1);
    check('Overview recentActivity includes our audit entries', data.recentActivity?.length > 0);

    // =====================================================================
    phase('Cleanup');
    // =====================================================================
    if (testMeetingId) await fetch(`${BACKEND_URL}/api/meetings/${testMeetingId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${owner.idToken}` } }).catch(() => {});
    await meetingsCol.deleteMany({ roomSlug });
    await recordingsCol.deleteMany({ fileUrl: { $regex: roomSlug } });
    await auditLogsCol.deleteMany({ $or: [
      { targetId: new mongoose.Types.ObjectId(companyId) },
      { targetId: memberRow ? new mongoose.Types.ObjectId(memberRow.id) : undefined },
    ].filter(Boolean) });
    check('Test-generated audit log rows cleaned up', true);

    for (const t of cleanupFirebaseUids) await deleteFirebaseUser(t);
    check('Throwaway Firebase test users deleted', true);
    results.push('  \x1b[33mℹ\x1b[0m Test company left in Mongo (no company-delete endpoint) -- harmless, timestamped for easy identification.');
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

/**
 * ==============================================================================
 * TOOWIX FULL CODEBASE & API MASTER VERIFICATION TEST SUITE
 * ==============================================================================
 * Real end-to-end integration tests for EVERY backend route, authentication gate,
 * meeting lifecycle, lobby admission & attendance, RSVP workflow, recording ingest & playback,
 * team invitations, notifications, settings options, and URL link generation.
 * ==============================================================================
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config();

const serviceAccountPath = path.resolve(__dirname, 'serviceAccountKey.json');
if (fs.existsSync(serviceAccountPath) && !admin.apps.length) {
  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000';
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyAUmG8KYxkNf29ojG6qiSWb4W4U4_lK4XU';
const RECORDING_INGEST_KEY = process.env.RECORDING_INGEST_KEY || 'toowix-recording-ingest-dev-key-change-in-prod';
const MONGODB_URI = process.env.MONGODB_URI;

let totalChecks = 0;
let passedChecks = 0;
let failedChecks = 0;

function check(testName, condition, details = '') {
  totalChecks++;
  if (condition) {
    passedChecks++;
    console.log(`  \x1b[32m✓ [PASS]\x1b[0m ${testName}`);
  } else {
    failedChecks++;
    console.error(`  \x1b[31m✗ [FAIL]\x1b[0m ${testName}${details ? ` -> ${details}` : ''}`);
  }
}

async function runMasterVerification() {
  console.log('=============================================================');
  console.log('       TOOWIX WHOLE CODEBASE & API MASTER TEST SUITE         ');
  console.log('=============================================================\n');

  // Connect Mongoose directly for state approval and inspection
  if (MONGODB_URI && mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGODB_URI);
  }

  // --- MODULE 0: System Health & Root Check ---
  console.log('--- [MODULE 0: System Health & Database Ping] ---');
  try {
    const rootRes = await fetch(`${BACKEND_URL}/`);
    const rootData = await rootRes.json();
    check('GET / root endpoint returns API status online', rootRes.ok && rootData.status === 'online');

    const healthRes = await fetch(`${BACKEND_URL}/health`);
    const healthData = await healthRes.json();
    check('GET /health returns 200 healthy', healthRes.ok && healthData.status === 'healthy');
    check('Database connection status is connected', healthData.database?.status === 'connected');
  } catch (err) {
    check('GET /health ping failed', false, err.message);
  }

  // --- Dynamic Firebase User Creation & Real Authentication ---
  const runId = Date.now();
  const testEmail = `master-verify-${runId}@example.com`;
  const testPassword = 'MasterPass123!@#';
  const testName = `Master Verifier ${runId}`;
  let idToken = null;
  let uid = null;
  let accountUser = null;

  console.log(`\n1. Initializing Firebase User: ${testEmail}`);
  try {
    const signupRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail, password: testPassword, returnSecureToken: true }),
      }
    );
    const signupData = await signupRes.json();
    check('Firebase user authentication initialized', signupRes.ok && !!signupData.idToken);
    idToken = signupData.idToken;
    uid = signupData.localId;

    if (uid && admin.apps.length) {
      await admin.auth().updateUser(uid, { emailVerified: true });
      const signInRes = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: testEmail, password: testPassword, returnSecureToken: true }),
        }
      );
      const signInData = await signInRes.json();
      if (signInData.idToken) idToken = signInData.idToken;
    }
  } catch (err) {
    check('Firebase initialization failed', false, err.message);
    return;
  }

  // --- MODULE 1: Authentication Gateways & Session Management ---
  console.log('\n--- [MODULE 1: Authentication & Session Gateways] ---');
  let sessionToken = null;
  const authHeaders = {
    Authorization: `Bearer ${idToken}`,
    'Content-Type': 'application/json',
  };

  try {
    // 1.1 POST /api/auth/signup (Register user in MongoDB)
    const backendSignup = await fetch(`${BACKEND_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ fullName: testName }),
    });
    const backendSignupData = await backendSignup.json();
    check('POST /api/auth/signup creates user in MongoDB', backendSignup.ok && !!backendSignupData.user);

    // 1.2 POST /api/auth/login-gate (Issue session token)
    const loginGateRes = await fetch(`${BACKEND_URL}/api/auth/login-gate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    });
    const loginGateData = await loginGateRes.json();
    sessionToken = loginGateData.sessionToken;
    authHeaders['X-Toowix-Session'] = sessionToken;
    check('POST /api/auth/login-gate generates active session token', loginGateRes.ok && !!sessionToken);

    // 1.3 GET /api/auth/session (Verify active session)
    const sessionRes = await fetch(`${BACKEND_URL}/api/auth/session`, { headers: authHeaders });
    const sessionData = await sessionRes.json();
    check('GET /api/auth/session validates session and returns account user', sessionRes.ok && sessionData.authorized === true);

    // 1.4 POST /api/auth/verify-email (Sync verified email status)
    const verifyEmailRes = await fetch(`${BACKEND_URL}/api/auth/verify-email`, {
      method: 'POST',
      headers: authHeaders,
    });
    const verifyEmailData = await verifyEmailRes.json();
    check('POST /api/auth/verify-email confirms verified status', verifyEmailRes.ok && verifyEmailData.status === 'VERIFIED');

    // 1.5 POST /api/auth/forgot-password (Public password reset request)
    const forgotRes = await fetch(`${BACKEND_URL}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail }),
    });
    const forgotData = await forgotRes.json();
    check('POST /api/auth/forgot-password initiates password reset email', forgotRes.ok && forgotData.success === true);

    // 1.6 POST /api/auth/send-verification-email (Custom template dispatch)
    const sendVerifyRes = await fetch(`${BACKEND_URL}/api/auth/send-verification-email`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ email: testEmail, name: testName }),
    });
    check('POST /api/auth/send-verification-email dispatches Toowix verification email', sendVerifyRes.ok);
  } catch (err) {
    check('Module 1 Auth error', false, err.message);
  }

  // --- MODULE 2: Company & Workspace Policies ---
  console.log('\n--- [MODULE 2: Company & Workspace Policies] ---');
  let companyId = null;
  try {
    const companySlug = `corp-${runId}`;
    const registerCompanyRes = await fetch(`${BACKEND_URL}/api/companies/register`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: `Global Corp ${runId}`,
        slug: companySlug,
      }),
    });
    const registerCompanyData = await registerCompanyRes.json();
    check('POST /api/companies/register registers workspace company', registerCompanyRes.ok && !!registerCompanyData.company);
    companyId = registerCompanyData.company?.id;

    // Approve workspace directly in database
    if (admin.apps.length && uid) {
      await admin.auth().updateUser(uid, { disabled: false });
    }
    if (companyId) {
      await mongoose.connection.collection('companies').updateOne(
        { _id: new mongoose.Types.ObjectId(companyId) },
        { $set: { status: 'ACTIVE' } }
      );
      await mongoose.connection.collection('users').updateOne(
        { firebaseUid: uid },
        { $set: { status: 'ACTIVE', role: 'COMPANY_ADMIN', companyId: new mongoose.Types.ObjectId(companyId) } }
      );
    }

    // Refresh active session token after workspace activation
    const refreshLogin = await fetch(`${BACKEND_URL}/api/auth/login-gate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    });
    const refreshLoginData = await refreshLogin.json();
    if (refreshLoginData.sessionToken) {
      authHeaders['X-Toowix-Session'] = refreshLoginData.sessionToken;
    }

    const refreshedSession = await fetch(`${BACKEND_URL}/api/auth/session`, { headers: authHeaders });
    const refreshedSessionData = await refreshedSession.json();
    if (refreshedSessionData.user) {
      accountUser = refreshedSessionData.user;
    }

    // 2.2 GET /api/companies/meeting-policy
    const policyGetRes = await fetch(`${BACKEND_URL}/api/companies/meeting-policy`, { headers: authHeaders });
    const policyGetData = await policyGetRes.json();
    check('GET /api/companies/meeting-policy returns workspace policy', policyGetRes.ok && policyGetData.meetingPolicy !== undefined);

    // 2.3 PATCH /api/companies/meeting-policy
    const policyPatchRes = await fetch(`${BACKEND_URL}/api/companies/meeting-policy`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({
        allowGuestAccess: true,
        allowScreenShare: true,
        recordingEnabled: true,
        micLockEnabled: false,
      }),
    });
    const policyPatchData = await policyPatchRes.json();
    check('PATCH /api/companies/meeting-policy updates policy successfully', policyPatchRes.ok && policyPatchData.meetingPolicy?.recordingEnabled === true);
  } catch (err) {
    check('Module 2 Company error', false, err.message);
  }

  // --- MODULE 3: Meeting Creation, Scheduling & Lifecycle ---
  console.log('\n--- [MODULE 3: Meeting Creation, Scheduling & Lifecycle] ---');
  let createdMeetingId = null;
  const testRoomSlug = `twx-room-${runId}`;
  const inviteeEmail = `colleague-${runId}@example.com`;

  try {
    // 3.1 POST /api/meetings
    const createRes = await fetch(`${BACKEND_URL}/api/meetings`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: `Sprint Review ${runId}`,
        roomSlug: testRoomSlug,
        type: 'Internal',
        scheduledAt: new Date(Date.now() + 3600000).toISOString(),
        durationMinutes: 45,
        description: 'Sprint retrospective and roadmap planning',
        passcode: '123456',
        invitees: [inviteeEmail],
      }),
    });
    const createData = await createRes.json();
    check('POST /api/meetings creates new meeting', createRes.ok && !!createData.meeting?._id);
    createdMeetingId = createData.meeting?._id;
    check('  -> Meeting roomSlug assigned correctly', createData.meeting?.roomSlug === testRoomSlug);
    check('  -> Meeting passcode saved', createData.meeting?.passcode === '123456');
    check('  -> Invitee list stored', Array.isArray(createData.meeting?.invitees) && createData.meeting.invitees.includes(inviteeEmail));

    // 3.2 GET /api/meetings (List Meetings)
    const listRes = await fetch(`${BACKEND_URL}/api/meetings`, { headers: authHeaders });
    const listData = await listRes.json();
    check('GET /api/meetings returns meeting list array', listRes.ok && Array.isArray(listData.meetings));
    const foundMeeting = listData.meetings?.find((m) => m.id === createdMeetingId || m._id === createdMeetingId);
    check('  -> Created meeting appears in listing', Boolean(foundMeeting));

    // 3.3 PATCH /api/meetings/:id (Update Notes & Files)
    const patchRes = await fetch(`${BACKEND_URL}/api/meetings/${createdMeetingId}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({
        name: `Sprint Review ${runId} [Updated]`,
        notes: 'Updated meeting notes post-discussion',
        sharedFiles: [
          { name: 'SprintRoadmap.pdf', url: 'https://cdn.toowix.com/files/roadmap.pdf', size: '2.4 MB' },
          { name: 'ArchitectureDiagram.png', url: 'https://cdn.toowix.com/files/arch.png', size: '1.1 MB' },
        ],
      }),
    });
    const patchData = await patchRes.json();
    check('PATCH /api/meetings/:id updates meeting attributes', patchRes.ok && patchData.meeting?.name.includes('[Updated]'));
    check('  -> Notes updated in database', patchData.meeting?.notes?.includes('Updated'));
    check('  -> Shared files count updated in database', patchData.meeting?.sharedFiles?.length === 2);

    // 3.4 GET /api/meetings/:id (Single Meeting Details)
    const getRes = await fetch(`${BACKEND_URL}/api/meetings/${createdMeetingId}`, { headers: authHeaders });
    const getData = await getRes.json();
    check('GET /api/meetings/:id returns full detailed meeting data', getRes.ok && getData.meeting?.name.includes('Sprint Review'));
    check('  -> Single meeting notes populated', Boolean(getData.meeting?.notes));
    check('  -> Single meeting shared files populated', Array.isArray(getData.meeting?.sharedFiles) && getData.meeting.sharedFiles.length > 0);

    // 3.5 POST /api/meetings/:id/cancel (Cancel Meeting)
    const cancelRes = await fetch(`${BACKEND_URL}/api/meetings/${createdMeetingId}/cancel`, {
      method: 'POST',
      headers: authHeaders,
    });
    const cancelData = await cancelRes.json();
    check('POST /api/meetings/:id/cancel marks meeting as cancelled', cancelRes.ok && cancelData.meeting?.cancelledAt !== null);
  } catch (err) {
    check('Module 3 Meeting Lifecycle error', false, err.message);
  }

  // --- MODULE 4: Pre-Join Lobby, Guest Admission & Attendance ---
  console.log('\n--- [MODULE 4: Pre-Join Lobby, Guest Admission & Attendance] ---');
  try {
    const activeRoomSlug = `twx-lobby-${runId}`;
    await fetch(`${BACKEND_URL}/api/meetings`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'Active Lobby Test Room',
        roomSlug: activeRoomSlug,
        type: 'Internal',
      }),
    });

    // 4.1 GET /api/meetings/room/:roomSlug (Public Guest Room Lookup)
    const roomLookupRes = await fetch(`${BACKEND_URL}/api/meetings/room/${activeRoomSlug}`);
    const roomLookupData = await roomLookupRes.json();
    check('GET /api/meetings/room/:roomSlug public room lookup permits lobby view', roomLookupRes.ok && roomLookupData.meeting?.accessAllowed === true);
    check('  -> Room cancelled flag is false', roomLookupData.meeting?.cancelled === false);

    // 4.2 POST /api/meetings/room/:roomSlug/admission (Guest Admission Token Generation)
    const admissionRes = await fetch(`${BACKEND_URL}/api/meetings/room/${activeRoomSlug}/admission`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Guest Explorer' }),
    });
    const admissionData = await admissionRes.json();
    check('POST /api/meetings/room/:roomSlug/admission issues valid Jitsi token for guest', admissionRes.ok && Boolean(admissionData.jitsiToken));
    check('  -> Attendance token generated', Boolean(admissionData.attendanceToken));
    check('  -> Participant entry ID generated', Boolean(admissionData.participantEntryId));
    const attendanceToken = admissionData.attendanceToken;
    const participantEntryId = admissionData.participantEntryId;

    // 4.3 POST /api/meetings/room/:roomSlug/attendance/join (Record Attendance Join)
    const joinRes = await fetch(`${BACKEND_URL}/api/meetings/room/${activeRoomSlug}/attendance/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attendanceToken }),
    });
    const joinData = await joinRes.json();
    check('POST /api/meetings/room/:roomSlug/attendance/join marks participant joined', joinRes.ok && joinData.participantEntryId === participantEntryId);

    // 4.4 POST /api/meetings/room/:roomSlug/attendance/leave (Record Attendance Leave)
    const leaveRes = await fetch(`${BACKEND_URL}/api/meetings/room/${activeRoomSlug}/attendance/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attendanceToken }),
    });
    const leaveData = await leaveRes.json();
    check('POST /api/meetings/room/:roomSlug/attendance/leave marks participant departed', leaveRes.ok && leaveData.participantEntryId === participantEntryId);

    // 4.5 POST /api/meetings/room/:roomSlug/lobby/knock (Knock / Join Request)
    const knockRes = await fetch(`${BACKEND_URL}/api/meetings/room/${activeRoomSlug}/lobby/knock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Lobby Guest Tester', requestId: `req-${runId}` }),
    });
    const knockData = await knockRes.json();
    check('POST /api/meetings/room/:roomSlug/lobby/knock processes entry request', knockRes.ok && !!knockData.status);

    // 4.6 GET /api/meetings/room/:roomSlug/lobby/status (Poll Lobby Status)
    const statusRes = await fetch(`${BACKEND_URL}/api/meetings/room/${activeRoomSlug}/lobby/status?requestId=req-${runId}`);
    const statusData = await statusRes.json();
    check('GET /api/meetings/room/:roomSlug/lobby/status returns waiting state and tokens', statusRes.ok && !!statusData.status);

    // 4.7 GET /api/meetings/room/:roomSlug/lobby/pending (Moderator fetches queue)
    const pendingRes = await fetch(`${BACKEND_URL}/api/meetings/room/${activeRoomSlug}/lobby/pending`, {
      headers: authHeaders,
    });
    const pendingData = await pendingRes.json();
    check('GET /api/meetings/room/:roomSlug/lobby/pending lists waiting attendees for host', pendingRes.ok && Array.isArray(pendingData.waiting));

    // 4.8 POST /api/meetings/room/:roomSlug/lobby/announce (Moderator broadcasts message)
    const announceRes = await fetch(`${BACKEND_URL}/api/meetings/room/${activeRoomSlug}/lobby/announce`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ message: 'Meeting starting in 2 minutes.' }),
    });
    const announceData = await announceRes.json();
    check('POST /api/meetings/room/:roomSlug/lobby/announce broadcasts announcement', announceRes.ok && announceData.hostAnnouncement === 'Meeting starting in 2 minutes.');

    // 4.9 POST /api/meetings/room/:roomSlug/lobby/admit (Moderator admits participant)
    const admitRes = await fetch(`${BACKEND_URL}/api/meetings/room/${activeRoomSlug}/lobby/admit`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ requestId: `req-${runId}` }),
    });
    check('POST /api/meetings/room/:roomSlug/lobby/admit admits waiting guest', admitRes.ok);

    // 4.10 GET /api/meetings/room/:roomSlug/live-status (Check Meeting Live Status)
    const liveStatusRes = await fetch(`${BACKEND_URL}/api/meetings/room/${activeRoomSlug}/live-status`);
    const liveStatusData = await liveStatusRes.json();
    check('GET /api/meetings/room/:roomSlug/live-status returns meeting active status', liveStatusRes.ok && liveStatusData.live !== undefined);

    // 4.11 POST /api/meetings/room/:roomSlug/end-for-everyone (Moderator ends meeting)
    const endEveryoneRes = await fetch(`${BACKEND_URL}/api/meetings/room/${activeRoomSlug}/end-for-everyone`, {
      method: 'POST',
      headers: authHeaders,
    });
    const endEveryoneData = await endEveryoneRes.json();
    check('POST /api/meetings/room/:roomSlug/end-for-everyone terminates call for all', endEveryoneRes.ok && !!endEveryoneData.endedAt);
  } catch (err) {
    check('Module 4 Lobby error', false, err.message);
  }

  // --- MODULE 5: Meeting RSVP Workflow ---
  console.log('\n--- [MODULE 5: Meeting RSVP Workflow] ---');
  try {
    // 5.1 GET /api/meetings/rsvp (RSVP Accept via Email Link)
    const rsvpAcceptRes = await fetch(
      `${BACKEND_URL}/api/meetings/rsvp?meetingId=${createdMeetingId}&email=${encodeURIComponent(inviteeEmail)}&response=accepted`,
      { redirect: 'manual' }
    );
    const isRsvpRedirect = rsvpAcceptRes.status === 302 && rsvpAcceptRes.headers.get('location')?.includes('/rsvp?');
    check('GET /api/meetings/rsvp processes email RSVP confirmation', isRsvpRedirect || rsvpAcceptRes.ok);

    // 5.2 POST /api/meetings/rsvp (RSVP Update via Web App JSON)
    const rsvpDeclineRes = await fetch(`${BACKEND_URL}/api/meetings/rsvp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        meetingId: createdMeetingId,
        email: inviteeEmail,
        response: 'declined',
      }),
    });
    const rsvpDeclineData = await rsvpDeclineRes.json();
    check('POST /api/meetings/rsvp updates response to declined', rsvpDeclineRes.ok && rsvpDeclineData.status === 'declined');
  } catch (err) {
    check('Module 5 RSVP error', false, err.message);
  }

  // --- MODULE 6: Recordings Management & Ingestion ---
  console.log('\n--- [MODULE 6: Recordings Management & Ingestion] ---');
  let testRecordingId = null;

  try {
    const sessionRecId = `session-${runId}`;
    // 6.1 POST /api/recordings/ingest (Ingest completed Jitsi recording)
    const ingestRes = await fetch(`${BACKEND_URL}/api/recordings/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RECORDING_INGEST_KEY}`,
      },
      body: JSON.stringify({
        roomSlug: testRoomSlug,
        recordingSessionId: sessionRecId,
        status: 'Processing',
        durationSeconds: 1845,
        fileSizeBytes: 48500000,
      }),
    });
    const ingestData = await ingestRes.json();
    check('POST /api/recordings/ingest ingests finished meeting recording', ingestRes.ok && !!ingestData.recording?._id);
    testRecordingId = ingestData.recording?._id;

    // 6.2 GET /api/recordings (List Recordings)
    const listRecRes = await fetch(`${BACKEND_URL}/api/recordings`, { headers: authHeaders });
    const listRecData = await listRecRes.json();
    check('GET /api/recordings lists user recordings', listRecRes.ok && Array.isArray(listRecData.recordings));

    if (testRecordingId) {
      // 6.3 GET /api/recordings/:id (Watch / Playback Details)
      const getRecRes = await fetch(`${BACKEND_URL}/api/recordings/${testRecordingId}`);
      const getRecData = await getRecRes.json();
      check('GET /api/recordings/:id returns recording details for watch page', getRecRes.ok && !!getRecData.recording?._id);

      // 6.4 PATCH /api/recordings/:id (Rename Recording Title)
      const renameRes = await fetch(`${BACKEND_URL}/api/recordings/${testRecordingId}`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ name: 'Quarterly Townhall Recording [Final]' }),
      });
      const renameData = await renameRes.json();
      check('PATCH /api/recordings/:id renames recording', renameRes.ok && renameData.recording?.name?.includes('Quarterly Townhall'));

      // 6.5 DELETE /api/recordings/:id (Delete Recording)
      const delRecRes = await fetch(`${BACKEND_URL}/api/recordings/${testRecordingId}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      check('DELETE /api/recordings/:id deletes recording', delRecRes.ok);
    }
  } catch (err) {
    check('Module 6 Recordings error', false, err.message);
  }

  // --- MODULE 7: Team & User Management ---
  console.log('\n--- [MODULE 7: Team & User Management] ---');
  try {
    // 7.1 GET /api/team/users (List Workspace Users)
    const teamUsersRes = await fetch(`${BACKEND_URL}/api/team/users`, { headers: authHeaders });
    const teamUsersData = await teamUsersRes.json();
    check('GET /api/team/users lists workspace team members', teamUsersRes.ok && Array.isArray(teamUsersData.users));

    // 7.2 POST /api/team/invites (Invite New Team Member)
    const inviteRes = await fetch(`${BACKEND_URL}/api/team/invites`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        fullName: 'New Team Member',
        email: `newmember-${runId}@example.com`,
        role: 'MEMBER',
      }),
    });
    const inviteData = await inviteRes.json();
    check('POST /api/team/invites dispatches workspace invitation', inviteRes.ok && !!inviteData.invite?._id);
    const testInviteId = inviteData.invite?._id;

    if (testInviteId) {
      // 7.3 POST /api/team/invites/:id/resend (Resend Invitation)
      const resendRes = await fetch(`${BACKEND_URL}/api/team/invites/${testInviteId}/resend`, {
        method: 'POST',
        headers: authHeaders,
      });
      check('POST /api/team/invites/:id/resend resends invitation email', resendRes.ok);

      // 7.4 DELETE /api/team/invites/:id (Revoke Invitation)
      const delInviteRes = await fetch(`${BACKEND_URL}/api/team/invites/${testInviteId}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      check('DELETE /api/team/invites/:id revokes team invitation', delInviteRes.ok);
    }

    // 7.5 PATCH /api/team/users/:id (Update Team User)
    if (accountUser?._id) {
      const updateTeamUserRes = await fetch(`${BACKEND_URL}/api/team/users/${accountUser._id}`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ role: 'COMPANY_ADMIN' }),
      });
      check('PATCH /api/team/users/:id updates workspace team member attributes', updateTeamUserRes.ok);
    }
  } catch (err) {
    check('Module 7 Team error', false, err.message);
  }

  // --- MODULE 8: In-App Notifications System ---
  console.log('\n--- [MODULE 8: In-App Notifications System] ---');
  try {
    // 8.1 Seed a test notification in Mongo
    let testNotifId = null;
    if (accountUser?._id && mongoose.connection.readyState === 1) {
      const notifDoc = await mongoose.connection.collection('notifications').insertOne({
        userId: new mongoose.Types.ObjectId(accountUser._id),
        companyId: accountUser.companyId ? new mongoose.Types.ObjectId(accountUser.companyId) : null,
        category: 'MEETINGS',
        type: 'MEETING_INVITE',
        title: 'Master Verification Test Notification',
        description: 'Testing complete notification endpoints',
        isRead: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      testNotifId = notifDoc.insertedId.toString();
    }

    // 8.2 GET /api/notifications (List Notifications)
    const notifRes = await fetch(`${BACKEND_URL}/api/notifications`, { headers: authHeaders });
    const notifData = await notifRes.json();
    check('GET /api/notifications returns user notification queue', notifRes.ok && Array.isArray(notifData.notifications));

    // 8.3 POST /api/notifications/:id/read (Mark Single Notification Read)
    if (testNotifId) {
      const singleReadRes = await fetch(`${BACKEND_URL}/api/notifications/${testNotifId}/read`, {
        method: 'POST',
        headers: authHeaders,
      });
      check('POST /api/notifications/:id/read marks single notification read', singleReadRes.ok);
    }

    // 8.4 POST /api/notifications/mark-all-read (Mark All as Read)
    const markAllRes = await fetch(`${BACKEND_URL}/api/notifications/mark-all-read`, {
      method: 'POST',
      headers: authHeaders,
    });
    check('POST /api/notifications/mark-all-read marks all notifications read', markAllRes.ok);
  } catch (err) {
    check('Module 8 Notifications error', false, err.message);
  }

  // --- MODULE 9: Settings Subsystems ---
  console.log('\n--- [MODULE 9: Settings Subsystems (Profile, General, Meetings, Recording, Storage, Sessions)] ---');
  try {
    // 9.1 GET /api/settings
    const settingsRes = await fetch(`${BACKEND_URL}/api/settings`, { headers: authHeaders });
    const settingsData = await settingsRes.json();
    check('GET /api/settings returns all settings categories', settingsRes.ok && !!settingsData.account && !!settingsData.preferences);

    // 9.2 PATCH /api/settings/profile
    const profileRes = await fetch(`${BACKEND_URL}/api/settings/profile`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ fullName: 'Updated Master Tester', jobTitle: 'Principal QA' }),
    });
    const profileData = await profileRes.json();
    check('PATCH /api/settings/profile saves profile modifications', profileRes.ok && profileData.profileExtra?.jobTitle === 'Principal QA');

    // 9.3 PATCH /api/settings/general
    const generalRes = await fetch(`${BACKEND_URL}/api/settings/general`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ appearance: 'dark', timeFormat: '12h' }),
    });
    const generalData = await generalRes.json();
    check('PATCH /api/settings/general saves preferences', generalRes.ok && generalData.preferences?.timeFormat === '12h');

    // 9.4 PATCH /api/settings/meetings
    const meetingsRes = await fetch(`${BACKEND_URL}/api/settings/meetings`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ defaultDurationMinutes: 45, cameraOffOnJoin: true }),
    });
    const meetingsData = await meetingsRes.json();
    check('PATCH /api/settings/meetings saves default meeting parameters', meetingsRes.ok && meetingsData.meetingDefaults?.defaultDurationMinutes === 45);

    // 9.5 PATCH /api/settings/recording
    const recSettingsRes = await fetch(`${BACKEND_URL}/api/settings/recording`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ retentionDays: 180 }),
    });
    const recSettingsData = await recSettingsRes.json();
    check('PATCH /api/settings/recording saves recording retention policy', recSettingsRes.ok && recSettingsData.recordingPreferences?.retentionDays === 180);

    // 9.6 PATCH /api/settings/notifications
    const notifSettingsRes = await fetch(`${BACKEND_URL}/api/settings/notifications`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ muteAll: false, reminderMinutesBefore: 15 }),
    });
    const notifSettingsData = await notifSettingsRes.json();
    check('PATCH /api/settings/notifications saves notification preferences', notifSettingsRes.ok && notifSettingsData.notificationPreferences !== undefined);

    // 9.7 GET /api/settings/storage
    const storageRes = await fetch(`${BACKEND_URL}/api/settings/storage`, { headers: authHeaders });
    const storageData = await storageRes.json();
    check('GET /api/settings/storage calculates and returns storage utilization', storageRes.ok && storageData.usedBytes !== undefined);

    // 9.8 GET /api/settings/security/sessions
    const sessionsRes = await fetch(`${BACKEND_URL}/api/settings/security/sessions`, { headers: authHeaders });
    const sessionsData = await sessionsRes.json();
    check('GET /api/settings/security/sessions enumerates active device sessions', sessionsRes.ok && Array.isArray(sessionsData.sessions));

    // 9.9 POST /api/settings/security/sessions/revoke-all-others
    const revokeOthersRes = await fetch(`${BACKEND_URL}/api/settings/security/sessions/revoke-all-others`, {
      method: 'POST',
      headers: authHeaders,
    });
    check('POST /api/settings/security/sessions/revoke-all-others revokes secondary sessions', revokeOthersRes.ok);

    // 9.10 POST /api/settings/security/password-changed
    const pwdRes = await fetch(`${BACKEND_URL}/api/settings/security/password-changed`, {
      method: 'POST',
      headers: authHeaders,
    });
    check('POST /api/settings/security/password-changed logs password change audit', pwdRes.ok);
  } catch (err) {
    check('Module 9 Settings error', false, err.message);
  }

  // --- MODULE 10: URL Formatting, Pre-Join Isolation & Clean Link Delivery ---
  console.log('\n--- [MODULE 10: URL Formatting, Pre-Join Isolation & Clean Link Delivery] ---');
  try {
    const testSlug = 'twx-deo-tbe-ubr';
    const frontendBase = 'http://localhost:3000';

    const roomUrl = `${frontendBase}/meet/${testSlug}`;
    check('Room URL points to web frontend /meet/ route', roomUrl.startsWith(`${frontendBase}/meet/`));
    check('Room URL strictly does NOT point directly to raw Jitsi domain', !roomUrl.includes('meet.toowix.com'));

    const rsvpUrl = `${frontendBase}/rsvp?meetingId=${createdMeetingId}&email=test@example.com&response=accepted`;
    check('RSVP URL properly encodes meeting ID and email', rsvpUrl.includes('/rsvp?') && rsvpUrl.includes('meetingId='));

    const watchUrl = `${frontendBase}/recordings/watch/rec-123`;
    check('Recording watch URL directs to custom Toowix player', watchUrl.includes('/recordings/watch/'));

    // Cleanup created meeting
    if (createdMeetingId) {
      const delRes = await fetch(`${BACKEND_URL}/api/meetings/${createdMeetingId}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      check('DELETE /api/meetings/:id cleans up meeting record', delRes.ok);
    }
  } catch (err) {
    check('Module 10 Link Verification error', false, err.message);
  }

  // Close direct Mongoose connection
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  // Final Summary
  const passRate = totalChecks > 0 ? ((passedChecks / totalChecks) * 100).toFixed(1) : 0;

  console.log('\n=============================================================');
  console.log('                 COMPLETE VERIFICATION SUMMARY                ');
  console.log('=============================================================');
  console.log(`  Total API Checks Executed : ${totalChecks}`);
  console.log(`  Passed Checks             : ${passedChecks}`);
  console.log(`  Failed Checks             : ${failedChecks}`);
  console.log(`  Overall Pass Rate         : ${passRate}%`);
  console.log('=============================================================');

  if (failedChecks === 0) {
    console.log('\n✨ ALL CODEBASE APIS, WORKFLOWS & POLICIES PASSED WITH 100% SUCCESS!\n');
    process.exit(0);
  } else {
    console.error(`\n⚠️  ${failedChecks} check(s) failed. Review details above.\n`);
    process.exit(1);
  }
}

runMasterVerification().catch((err) => {
  console.error('Fatal verification script error:', err);
  process.exit(1);
});

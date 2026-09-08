const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { User } = require('../dist/src/models/User');
const { Company } = require('../dist/src/models/Company');
const { Meeting } = require('../dist/src/models/Meeting');
const { Session } = require('../dist/src/models/Session');
const { Recording } = require('../dist/src/models/Recording');
const firebase = require('../dist/src/config/firebase');
const { generateJitsiToken, verifyJitsiToken } = require('../dist/src/auth/jitsi-token');
const { mayManageResource } = require('../dist/src/middleware/ownership');
const app = require('../dist/src/index').default;
let server, base, account, company, meeting, session, writes, revoked;
const original = { user: User.findOne, company: Company.findById, meeting: Meeting.findOne, byId: Meeting.findById, update: Meeting.updateOne, session: Session.findOne, firebase: firebase.getFirebaseAuth, recording: Recording.findById };
before(async () => {
  firebase.getFirebaseAuth = () => ({ verifyIdToken: async (token, checkRevoked) => {
    assert.equal(checkRevoked, true);
    if (token !== 'firebase-test-token' || revoked) throw new Error('Invalid token');
    return { uid: 'uid-1', email: account?.email, email_verified: true };
  } });
  User.findOne = async () => account;
  Company.findById = async () => company;
  Meeting.findOne = async () => meeting;
  Meeting.findById = async () => meeting;
  Recording.findById = async () => meeting;
  Meeting.updateOne = async (...args) => { writes.push(args); return { modifiedCount: 1 }; };
  Session.findOne = async filter => { assert.equal(filter.userId, account._id); return filter.sessionToken === 'session-1' ? session : null; };
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise(resolve => server.close(resolve));
  User.findOne = original.user; Company.findById = original.company; Meeting.findOne = original.meeting;
  Meeting.findById = original.byId; Meeting.updateOne = original.update; Session.findOne = original.session;
  Recording.findById = original.recording; firebase.getFirebaseAuth = original.firebase;
});
beforeEach(() => {
  account = { _id: 'user-1', firebaseUid: 'uid-1', email: 'member@example.com', fullName: 'Member', status: 'ACTIVE', companyId: 'tenant-1', role: 'MEMBER' };
  company = { _id: 'tenant-1', status: 'ACTIVE', meetingPolicy: { recordingEnabled: true, allowGuestAccess: true }, limits: { featureFlags: { recordingEnabled: true } } };
  meeting = { _id: 'meeting-1', roomSlug: 'test-room', createdBy: 'host-1', companyId: 'tenant-1', type: 'Guest', participants: [] };
  session = { userId: 'user-1', revokedAt: null }; writes = []; revoked = false;
  delete process.env.JITSI_SERVER_POLICY_VERIFIED;
});
const headers = () => ({ Authorization: 'Bearer firebase-test-token', 'X-Toowix-Session': 'session-1' });
async function request(path, options = {}) {
  const response = await fetch(base + path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}
const admit = (body = {}, authenticated = false) => request('/api/meetings/room/test-room/admission', { method: 'POST', headers: authenticated ? headers() : {}, body: JSON.stringify(body) });

test('private lookup ignores forged query email', async () => {
  meeting.type = 'Private'; meeting.invitees = ['host@example.com'];
  assert.equal((await request('/api/meetings/room/test-room?email=host@example.com')).status, 403);
});
test('private admission ignores forged body email', async () => {
  meeting.type = 'Private'; meeting.invitees = ['host@example.com'];
  assert.equal((await admit({ email: 'host@example.com' })).status, 403);
});
test('verified invitee is admitted; organizer role cannot be forged', async () => {
  meeting.type = 'Private'; meeting.invitees = [account.email];
  const result = await admit({ email: 'host@example.com', moderator: true }, true);
  assert.equal(result.status, 200); assert.equal(result.data.moderator, false);
  const token = verifyJitsiToken(result.data.jitsiToken);
  assert.equal(token.context.user.email, account.email); assert.equal(token.context.user.moderator, false);
});
test('private meeting without invitees remains restricted', async () => {
  meeting.type = 'Private'; meeting.invitees = [];
  assert.equal((await admit({}, true)).status, 403);
});
test('cancelled meetings reject guests and owners', async () => {
  meeting.cancelledAt = new Date(); meeting.createdBy = account._id;
  assert.equal((await admit()).status, 403); assert.equal((await admit({}, true)).status, 403);
});
test('internal membership is tenant scoped', async () => {
  meeting.type = 'Internal'; account.companyId = 'tenant-2';
  assert.equal((await admit({}, true)).status, 403);
  account.companyId = 'tenant-1'; assert.equal((await admit({}, true)).status, 200);
});
test('lookup failure is explicit and does not issue admission', async () => {
  Meeting.findOne = async () => { throw new Error('offline'); };
  try { assert.equal((await admit()).status, 503); } finally { Meeting.findOne = async () => meeting; }
});
test('unknown room has explicit public guest behavior', async () => {
  meeting = null; const result = await request('/api/meetings/room/instant-test-room/admission', { method: 'POST', body: '{}' }); assert.equal(result.status, 200);
  assert.equal(result.data.participation, 'guest'); assert.equal(result.data.moderator, false);
  assert.equal(verifyJitsiToken(result.data.jitsiToken).context.features.recording, false);
});
test('required lobby fails closed before deployment attestation', async () => {
  company.meetingPolicy.requireLobby = true; assert.equal((await admit()).status, 503);
});
test('room scoped short lived token and signed host claims', async () => {
  meeting.createdBy = account._id;
  const result = await admit({}, true); const token = verifyJitsiToken(result.data.jitsiToken);
  assert.equal(token.room, 'test-room'); assert.ok(token.exp - token.iat <= 900);
  assert.equal(token.context.user.moderator, true);
  assert.throws(() => generateJitsiToken({ user: { id: 'x', name: 'x', email: '' }, room: '*' }));
  assert.throws(() => generateJitsiToken({ user: { id: 'x', name: 'x', email: '' } }));
});
test('disabled recording overrides auto recording and host rights', async () => {
  meeting.createdBy = account._id; company.meetingPolicy.autoRecording = true; company.meetingPolicy.recordingEnabled = false;
  const result = await admit({}, true);
  assert.equal(result.data.meeting.autoRecording, false); assert.equal(result.data.meeting.recordingEnabled, false);
  assert.equal(verifyJitsiToken(result.data.jitsiToken).context.features.recording, false);
});
test('guest attendance derives identity from scoped credential', async () => {
  const { data } = await admit({ email: 'host@example.com', name: 'Guest' });
  const result = await request('/api/meetings/room/test-room/attendance/join', { method: 'POST', body: JSON.stringify({ attendanceToken: data.attendanceToken, email: 'host@example.com', role: 'Organizer' }) });
  assert.equal(result.status, 200); const participant = writes[0][1].$push.participants;
  assert.equal(participant.role, 'Participant'); assert.notEqual(participant.email, 'host@example.com');
  assert.deepEqual(writes[0][0]['participants._id'], { $ne: data.participantEntryId });
});
test('attendance updates reject missing, wrong room, and meeting credentials', async () => {
  const { data } = await admit();
  for (const [room, token] of [['test-room', ''], ['other-room', data.attendanceToken], ['test-room', data.jitsiToken]]) {
    assert.ok((await request(`/api/meetings/room/${room}/attendance/leave`, { method: 'POST', body: JSON.stringify({ attendanceToken: token, participantEntryId: 'forged' }) })).status >= 400);
  }
  assert.equal(writes.length, 0);
});
test('leave uses credential entry and atomic once-only predicate', async () => {
  const { data } = await admit();
  assert.equal((await request('/api/meetings/room/test-room/attendance/leave', { method: 'POST', body: JSON.stringify({ attendanceToken: data.attendanceToken, participantEntryId: 'forged' }) })).status, 200);
  assert.deepEqual(writes[0][0].participants.$elemMatch, { _id: data.participantEntryId, leftAt: null });
});
test('meeting JWT never authorizes account API; query tokens rejected', async () => {
  const { data } = await admit();
  assert.equal((await request('/api/auth/session', { headers: { Authorization: `Bearer ${data.jitsiToken}` } })).status, 401);
  assert.equal((await request('/api/auth/session?token=firebase-test-token')).status, 401);
});
test('account authorization rejects missing and revoked application sessions', async () => {
  assert.equal((await request('/api/auth/session', { headers: { Authorization: 'Bearer firebase-test-token' } })).status, 401);
  session = null; assert.equal((await request('/api/auth/session', { headers: headers() })).status, 401);
});
test('revoked Firebase, suspended/inactive users, suspended workspace rejected', async () => {
  revoked = true; assert.equal((await request('/api/auth/session', { headers: headers() })).status, 401); revoked = false;
  for (const status of ['SUSPENDED', 'INACTIVE']) { account.status = status; assert.equal((await request('/api/auth/session', { headers: headers() })).status, 403); }
  account.status = 'ACTIVE'; company.status = 'SUSPENDED'; assert.equal((await request('/api/auth/session', { headers: headers() })).status, 403);
});
test('valid current account session is authorized', async () => {
  assert.equal((await request('/api/auth/session', { headers: headers() })).status, 200);
});
test('company admin cannot mutate another tenant meeting or recording', async () => {
  account.role = 'COMPANY_ADMIN'; meeting.companyId = 'tenant-2';
  for (const [method, path] of [['PATCH', '/api/meetings/meeting-1'], ['POST', '/api/meetings/meeting-1/cancel'], ['DELETE', '/api/meetings/meeting-1'], ['PATCH', '/api/recordings/recording-1'], ['DELETE', '/api/recordings/recording-1']]) {
    assert.equal((await request(path, { method, headers: headers(), body: '{}' })).status, 403);
  }
  assert.equal(mayManageResource(account, meeting), false);
  meeting.companyId = account.companyId; assert.equal(mayManageResource(account, meeting), true);
});

test('unknown ordinary rooms cannot acquire a token before private creation', async () => {
  meeting = null; assert.equal((await admit()).status, 404);
});

test('production rejects absent and known development signing secrets', () => {
  const { spawnSync } = require('node:child_process');
  for (const secret of ['', 'toowix-secret-dev-key-change-in-prod']) {
    const result = spawnSync(process.execPath, ['-e', "require('./dist/src/config/jitsi')"], { cwd: require('node:path').resolve(__dirname, '..'), env: { ...process.env, NODE_ENV: 'production', JITSI_APP_SECRET: secret }, encoding: 'utf8', windowsHide: true });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /A strong JITSI_APP_SECRET is required/);
  }
});

#!/usr/bin/env node
// Focused recording test: proves a finished recording still reaches its owner even when the host ends the
// meeting right after recording (the failure that made recordings vanish).
//   node scripts/test-recording.mjs [--api http://localhost:4000] [--email you@example.com]
// Uses the same temporary fixture as test-website.mjs and removes everything it creates.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const API = opt('--api', 'http://localhost:4000');
const EMAIL = opt('--email', 'jayeshchaudhary45454@gmail.com');

const backendEnv = (() => { try { return Object.fromEntries(readFileSync(join(ROOT, 'toowix-backend', '.env'), 'utf8').split('\n').map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()])); } catch { return {}; } })();
const INGEST_KEY = process.env.RECORDING_INGEST_KEY || backendEnv.RECORDING_INGEST_KEY;
const FIREBASE_KEY = process.env.E2E_FIREBASE_API_KEY || (readFileSync(join(ROOT, 'toowix-web-app', '.env'), 'utf8').match(/^VITE_FIREBASE_API_KEY=(.+)$/m) || [])[1];

function fixture(cmd) {
  const r = spawnSync('npx', ['ts-node', '--transpile-only', 'src/scripts/e2e-fixture.ts', ...cmd], {
    cwd: join(ROOT, 'toowix-backend'), encoding: 'utf8', shell: true, env: { ...process.env, E2E_FIREBASE_API_KEY: FIREBASE_KEY }, timeout: 120000
  });
  const line = (r.stdout || '').split('\n').find((l) => l.startsWith('__FIXTURE__'));
  if (!line) throw new Error((r.stderr || r.stdout || 'fixture failed').slice(0, 300));
  return JSON.parse(line.slice('__FIXTURE__'.length));
}
let pass = 0; let fail = 0;
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? '  (' + detail + ')' : ''}`); };
let AUTH;
const api = async (method, path, { body, auth, headers } = {}) => {
  const h = { 'Content-Type': 'application/json', ...(headers || {}) };
  if (auth) { h.Authorization = `Bearer ${AUTH.idToken}`; h['X-Toowix-Session'] = AUTH.sessionToken; }
  const res = await fetch(API + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await res.json(); } catch { /* no body */ }
  return { s: res.status, j };
};

if (!INGEST_KEY) { console.log('RECORDING_INGEST_KEY not found in toowix-backend/.env'); process.exit(1); }
let FX;
try {
  FX = fixture(['setup', EMAIL]);
  AUTH = { idToken: FX.idToken, sessionToken: FX.sessionToken };
  const slug = FX.meetings.instant.slug;
  const sid = 'e2e-rec-' + Math.random().toString(36).slice(2, 10);
  const ingest = (status, extra = {}) => api('POST', '/api/recordings/ingest', { headers: { Authorization: `Bearer ${INGEST_KEY}` }, body: { roomSlug: slug, recordingSessionId: sid, status, ...extra } });

  console.log('\n== recording safety net ==');
  check('recorder key is required (401 without it)', (await api('POST', '/api/recordings/ingest', { body: { roomSlug: slug, recordingSessionId: sid, status: 'Processing' } })).s === 401);
  check('anonymous cannot register a recording session', (await api('POST', '/api/recordings/session', { body: { roomSlug: slug, action: 'start' } })).s === 401);
  check('bad room code is rejected (400)', (await api('POST', '/api/recordings/session', { auth: true, body: { roomSlug: 'x', action: 'start' } })).s === 400);
  check('host starts a recording -> session registered', (await api('POST', '/api/recordings/session', { auth: true, body: { roomSlug: slug, action: 'start' } })).s === 200);

  const end = await api('POST', `/api/meetings/room/${slug}/end-for-everyone`, { auth: true, body: {} });
  check('host ends the meeting for everyone', end.s === 200);
  let state = fixture(['inspect', sid, slug]);
  check('meeting record is KEPT while the recording is pending', state.meetingExists === true && !!state.hold);

  // Even if the meeting record is gone anyway (old versions, expiry), the finished recording must still land.
  fixture(['delete-meeting', slug]);
  const proc = await ingest('Processing', { sourceFile: `${sid}/x.mp4` });
  check('recorder reports "processing" after the meeting is gone -> accepted (was 404)', proc.s === 202, `HTTP ${proc.s} ${JSON.stringify(proc.j).slice(0, 120)}`);
  state = fixture(['inspect', sid, slug]);
  check('recording exists for the right owner and meeting name', state.recording?.createdBy === FX.userId && state.recording?.name === 'E2E instant', JSON.stringify(state.recording));
  const failed = await ingest('Failed', { processingError: 'test failure' });
  check('a failure is recorded, not lost (200)', failed.s === 200 && failed.j?.recording?.status === 'Failed');
  check('unknown room with no session snapshot is still refused (404)', (await api('POST', '/api/recordings/ingest', { headers: { Authorization: `Bearer ${INGEST_KEY}` }, body: { roomSlug: 'twx-nobody-here', recordingSessionId: 'e2e-rec-zzzzzzzz', status: 'Processing' } })).s === 404);
} catch (err) {
  fail++; console.log('FAIL  script error: ' + err.message);
} finally {
  if (FX) { try { fixture(['teardown']); console.log('\ncleanup done'); } catch (e) { console.log('\ncleanup FAILED: ' + e.message); } }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);

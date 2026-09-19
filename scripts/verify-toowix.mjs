#!/usr/bin/env node
// Toowix verification: static checks, type-checks, production build, and live API smoke tests.
// Usage: node scripts/verify-toowix.mjs [--api http://localhost:4000] [--web http://localhost:3000] [--skip-build]
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'toowix-web-app');
const API_DIR = join(ROOT, 'toowix-backend');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);

  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const API = opt('--api', 'http://localhost:4000');
const WEB_URL = opt('--web', 'http://localhost:3000');
const SKIP_BUILD = args.includes('--skip-build');

const results = [];
let section = '';
const group = (name) => { section = name; console.log(`\n== ${name} ==`); };
const record = (ok, name, detail = '') => {
  results.push({ ok, section, name, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `\n      ${String(detail).split('\n').slice(0, 6).join('\n      ')}` : ''}`);
};
const check = async (name, fn) => {
  try {
    const out = await fn();

    record(out !== false, name, out === false ? 'returned false' : '');
  } catch (err) {
    record(false, name, err?.message || err);
  }
};
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const has = (rel, text) => read(rel).includes(text);
const sh = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (['node_modules', 'dist', '.git', 'uploads', '__pycache__'].includes(entry)) continue;
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) walk(full, out); else out.push(full);
  }

  return out;
}

async function http(method, url, { body, headers } = {}) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(headers || {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;

  try { json = await res.json(); } catch { /* not json */ }

  return { status: res.status, json, headers: res.headers };
}

// ---------------------------------------------------------------------------
group('1. Source hygiene');
await check('no merge-conflict markers in source', () => {
  const bad = [];

  for (const f of [ ...walk(join(WEB, 'src')), ...walk(join(API_DIR, 'src')) ]) {
    if (!/\.(ts|tsx|js|json|css)$/.test(f)) continue;
    if (/^(<<<<<<<|>>>>>>>) /m.test(readFileSync(f, 'utf8'))) bad.push(f);
  }
  if (bad.length) throw new Error(`markers in: ${bad.join(', ')}`);
});
await check('no leftover [TILE-DEBUG] logging', () => !has('toowix-web-app/src/pages/MeetingRoomPage.tsx', '[TILE-DEBUG]'));

// ---------------------------------------------------------------------------
group('2. Type checks');
await check('web app: tsc --noEmit', () => { sh('npx tsc --noEmit', WEB); });
await check('backend: tsc --noEmit', () => { sh('npx tsc --noEmit', API_DIR); });

// ---------------------------------------------------------------------------
group('3. Production build + bundle contents');
if (SKIP_BUILD) {
  console.log('(skipped --skip-build)');
} else {
  await check('web app: vite build', () => { sh('npm run build', WEB); });
  await check('bundle contains new features', () => {
    const assets = join(WEB, 'dist', 'assets');
    const all = readdirSync(assets).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(assets, f), 'utf8')).join('\n');
    const needles = [ 'Performance settings', 'Pin yourself', 'Push to talk', "Your meeting", 'Backgrounds and effects', 'want to join this call' ];
    const missing = needles.filter((n) => !all.includes(n));

    if (missing.length) throw new Error(`missing strings: ${missing.join(', ')}`);
  });
}

// ---------------------------------------------------------------------------
group('4. Feature wiring (static code assertions)');
const PAGE = 'toowix-web-app/src/pages/MeetingRoomPage.tsx';
const HOOK = 'toowix-web-app/src/lib/useJitsiMeeting.ts';
await check('six menu features: modals imported and rendered', () => [
  'KeyboardShortcutsModal', 'EmbedMeetingModal', 'SecurityOptionsModal', 'ParticipantStatsModal', 'PerformanceSettingsModal', 'PollsModal'
].every((n) => read(PAGE).includes(`<${n}`)));
await check('hook exposes lockRoom / toggleShareAudio / setVideoQuality / remoteScreenShares', () =>
  [ 'lockRoom', 'toggleShareAudio', 'setVideoQuality', 'remoteScreenShares' ].every((n) => new RegExp(`^    ${n},`, 'm').test(read(HOOK))));
await check('screen shares ordered newest-first', () => has(HOOK, '.sort((a, b) => b.startedAt - a.startedAt)') && has(PAGE, '.sort((a, b) => b.startedAt - a.startedAt)'));
await check('screen share tiles rendered in tile view', () => has(PAGE, 'allShares.map((share)') && has(PAGE, '<ScreenShareTile'));
await check('stage view only when tile view is off (or shared video)', () => has(PAGE, 'jitsiMeeting.sharedVideo) || (anyScreenShare && !tileViewEnabled)'));
await check('Unpin pill removed from stage', () => !has(PAGE, '<span>Unpin</span>'));
await check('adaptive tile grid for 7+ participants', () => has(PAGE, 'Math.ceil(Math.sqrt('));
await check('dynamic favicon: recording / camera / speaker', () => {
  const f = read('toowix-web-app/src/lib/dynamicFavicon.ts');

  return [ "'recording'", "'camera'", "'speaker'" ].every((n) => f.includes(n)) && has(PAGE, 'applyFavicon(faviconMode)');
});
await check('reaction tray stays open for spamming', () => !/handleSendReaction[\s\S]{0,400}setShowReactions\(false\)/.test(read(PAGE)));
await check('host admit/deny popup present', () => has(PAGE, 'want to join this call') && has(PAGE, 'Admit all'));
await check('"Your meeting\'s ready" card wired', () => has(PAGE, '<MeetingReadyDialog') && has('toowix-web-app/src/components/MeetingReadyDialog.tsx', 'Add others'));
await check('settings dialog: prejoin has only audio+video, no reactions/captions tabs', () => {
  const d = read('toowix-web-app/src/components/MeetingSettingsDialog.tsx');

  return has(PAGE, "tabs={['audio', 'video']}") && !/id: 'captions'|id: 'reactions'/.test(d);
});
await check('prejoin: Other ways to join button removed', () => !/>\s*Other ways to join\s*<\/button>\s*<\/div>\s*\{\/\* Safe Share/.test(read(PAGE)) && !/setShowOtherWaysModal\(true\)/.test(read(PAGE)));
await check('background persists (save + prejoin + in-call apply)', () =>
  has('toowix-web-app/src/components/VirtualBackgroundModal.tsx', 'saveBackground(config)') && has(PAGE, 'getSavedBackground()') && has(PAGE, 'backgroundAppliedRef'));
await check('local tile refreshes after background effect', () => (read(HOOK).match(/setLocalCameraStream\(trackToStream\(track\)\)/g) || []).length >= 3);
await check('signed-in users join direct links as their account', () => has(PAGE, "setParticipation('account')"));
await check('sound assets exist', () => [ 'participant-joined.wav', 'participant-left.wav', 'recording-started.wav' ].every((f) => existsSync(join(WEB, 'public', 'sounds', f))));

// ---------------------------------------------------------------------------
group('5. Private-meeting rules (static)');
const ADM = 'toowix-backend/src/meetings/admission.ts';
const WAIT = 'toowix-backend/src/meetings/waitingRoom.ts';
await check('Private join = password + waiting room (mayJoin)', () => has(ADM, 'export function mayJoin') && has(ADM, "meeting.type === 'Private'"));
await check('non-creator cannot bypass lobby on Private', () => has(ADM, "meeting?.type === 'Private' && !isCreator") && has(WAIT, "meeting?.type !== 'Private'"));
await check('client sends Private joins to lobby knock', () => has(PAGE, "meetingInfo?.type === 'Private'"));
await check('waiting-room saves tolerate legacy "Host" role', () => (read(WAIT).match(/validateBeforeSave: false/g) || []).length >= 4 && has(ADM, "'Organizer' : 'Participant'"));
await check('password is mandatory for Private meetings', () => has('toowix-backend/src/meetings/meetings.ts', 'A password is required for private meetings.'));

// ---------------------------------------------------------------------------
group('6. Backend live API (unauthenticated smoke tests)');
let apiUp = false;

await check(`backend reachable at ${API}/health`, async () => {
  const r = await http('GET', `${API}/health`);

  apiUp = r.status === 200;

  return r.status === 200 && r.json?.status === 'healthy';
});
if (apiUp) {
  await check('database connected', async () => (await http('GET', `${API}/health`)).json?.database?.status === 'connected');
  await check('invalid room code -> 400', async () => (await http('GET', `${API}/api/meetings/room/a`)).status === 400);
  await check('unknown persisted room -> 404', async () => (await http('GET', `${API}/api/meetings/room/zzzz-nonexistent-room`)).status === 404);
  await check('instant room info -> 200 and not password protected', async () => {
    const r = await http('GET', `${API}/api/meetings/room/instant-verify${Date.now() % 100000}`);

    return r.status === 200 && r.json?.meeting?.passwordRequired === false;
  });
  await check('guest admission to instant room returns a Jitsi token', async () => {
    const r = await http('POST', `${API}/api/meetings/room/instant-verify${Date.now() % 100000}/admission`, { body: { name: 'Verifier' } });

    return r.status === 200 && Boolean(r.json?.jitsiToken);
  });
  await check('protected routes reject anonymous requests', async () => {
    const paths = [ '/api/meetings', '/api/recordings', '/api/companies' ];
    const statuses = await Promise.all(paths.map(async (p) => (await http('GET', `${API}${p}`)).status));

    return statuses.every((s) => s === 401 || s === 403 || s === 404) && statuses.some((s) => s === 401 || s === 403);
  });
  await check('bad JSON / oversized input does not crash server', async () => {
    const r = await http('POST', `${API}/api/meetings/room/instant-abcdef/admission`, { body: { name: 'x'.repeat(5000) } });

    return r.status < 500;
  });
  await check('backend still healthy after tests', async () => (await http('GET', `${API}/health`)).status === 200);
} else {
  console.log('backend not running -- start it with: cd toowix-backend && npm run dev');
}

// ---------------------------------------------------------------------------
group('7. Frontend dev server');
await check(`web app reachable at ${WEB_URL}`, async () => (await fetch(WEB_URL)).status === 200);
await check('favicon asset served', async () => (await fetch(`${WEB_URL}/assets/toowix-logo.svg`)).status === 200);
await check('join/leave sound served', async () => (await fetch(`${WEB_URL}/sounds/participant-joined.wav`)).status === 200);

// ---------------------------------------------------------------------------
const failed = results.filter((r) => !r.ok);

console.log('\n==================== SUMMARY ====================');
for (const s of [ ...new Set(results.map((r) => r.section)) ]) {
  const rs = results.filter((r) => r.section === s);

  console.log(`${rs.every((r) => r.ok) ? 'OK  ' : 'FAIL'}  ${s}  (${rs.filter((r) => r.ok).length}/${rs.length})`);
}
console.log(`\nTotal: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log('\nFailures:');
  for (const f of failed) console.log(` - [${f.section}] ${f.name}`);
}
console.log('\nNot covered by this script (needs people/browsers): live audio/video, screen-share with 2+ presenters, recording end-to-end, PiP, and the waiting-room admit flow with a real second browser.');
process.exit(failed.length ? 1 : 0);

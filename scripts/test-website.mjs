#!/usr/bin/env node
// Toowix full-website test: static checks, backend API (public + authenticated host), and real-Chrome
// browser tests (desktop + phone size) for the home page, RSVP flow, private/locked meetings, and the
// whole in-call experience.
//
//   node scripts/test-website.mjs [--api http://localhost:4000] [--web http://localhost:3000]
//        [--skip-static] [--skip-build] [--skip-api] [--skip-browser] [--no-auth] [--keep] [--email you@example.com]
//
// Needs: backend + web app running locally (see README), Google Chrome, and for authenticated tests a
// real user in the database (default jayeshchaudhary45454@gmail.com). Everything it creates is prefixed
// "twx-e2e-" / "@e2e.invalid" and removed at the end. Screenshots go to scripts/test-results/.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const WebSocket = require(join(ROOT, 'node_modules', 'ws'));
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const flag = (name) => args.includes(name);
const API = opt('--api', 'http://localhost:4000');
const WEB = opt('--web', 'http://localhost:3000');
const EMAIL = opt('--email', 'jayeshchaudhary45454@gmail.com');
const OUT = join(ROOT, 'scripts', 'test-results');
mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME_PATH || [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].find((p) => existsSync(p));

// ---------------------------------------------------------------------------- reporting
const results = [];
let section = '';
const group = (name) => { section = name; console.log(`\n== ${name} ==`); };
const record = (ok, name, detail = '') => {
  results.push({ ok, section, name });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `\n      ${String(detail).split('\n').slice(0, 5).join('\n      ')}` : ''}`);
};
const check = async (name, fn) => {
  try { const r = await fn(); record(r !== false, name, r === false ? 'returned false' : ''); }
  catch (err) { record(false, name, err?.message || err); }
};
const skip = (name, why) => console.log(`SKIP  ${name} (${why})`);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = () => Math.random().toString(36).slice(2, 8);

// ---------------------------------------------------------------------------- http helpers
let AUTH = null; // { idToken, sessionToken }
async function api(method, path, { body, auth, headers, origin } = {}) {
  const h = { 'Content-Type': 'application/json', ...(headers || {}) };
  if (auth && AUTH) { h.Authorization = `Bearer ${AUTH.idToken}`; h['X-Toowix-Session'] = AUTH.sessionToken; }
  if (origin) h.Origin = origin;
  const res = await fetch(API + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = await res.json(); } catch { /* not json */ }
  return { s: res.status, j: json, h: res.headers };
}
const reachable = async (url) => { try { return (await fetch(url)).status < 500; } catch { return false; } };

// ---------------------------------------------------------------------------- fixture
let FX = null;
function runBackendScript(cmd, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  const r = spawnSync('npx', ['ts-node', '--transpile-only', 'src/scripts/e2e-fixture.ts', ...cmd], {
    cwd: join(ROOT, 'toowix-backend'), encoding: 'utf8', shell: true, env, timeout: 120000
  });
  const line = (r.stdout || '').split('\n').find((l) => l.startsWith('__FIXTURE__'));
  if (!line) throw new Error((r.stderr || r.stdout || 'fixture failed').split('\n').filter((l) => /FIXTURE_ERROR|Error/.test(l)).slice(0, 3).join(' | ') || 'fixture failed');
  return JSON.parse(line.slice('__FIXTURE__'.length));
}
function firebaseKey() {
  if (process.env.E2E_FIREBASE_API_KEY) return process.env.E2E_FIREBASE_API_KEY;
  try { return (readFileSync(join(ROOT, 'toowix-web-app', '.env'), 'utf8').match(/^VITE_FIREBASE_API_KEY=(.+)$/m) || [])[1]; } catch { return undefined; }
}

// ---------------------------------------------------------------------------- browser (CDP)
class Browser {
  constructor() { this.id = 0; this.pending = new Map(); }
  async start() {
    this.profile = mkdtempSync(join(tmpdir(), 'tw-e2e-'));
    this.port = 9400 + Math.floor(Math.random() * 300);
    this.proc = spawn(CHROME, [
      '--headless=new', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${this.port}`,
      '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required',
      '--user-data-dir=' + this.profile, 'about:blank'
    ], { windowsHide: true, stdio: 'ignore' });
    let targets;
    for (let i = 0; i < 60; i++) {
      try {
        targets = await new Promise((res, rej) => http.get(`http://127.0.0.1:${this.port}/json`, (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
        if (targets.some((t) => t.type === 'page')) break;
      } catch { /* not up yet */ }
      await delay(250);
    }
    const page = targets.find((t) => t.type === 'page');
    this.ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r) => this.ws.on('open', r));
    this.ws.on('message', (m) => {
      const d = JSON.parse(m);
      if (d.id && this.pending.has(d.id)) { const p = this.pending.get(d.id); this.pending.delete(d.id); d.error ? p.reject(new Error(d.error.message)) : p.resolve(d.result); }
    });
    await this.send('Page.enable'); await this.send('Runtime.enable');
  }
  send(method, params = {}) { return new Promise((resolve, reject) => { const i = ++this.id; this.pending.set(i, { resolve, reject }); this.ws.send(JSON.stringify({ id: i, method, params })); }); }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  async until(expression, tries = 100, gap = 200) { for (let i = 0; i < tries; i++) { try { if (await this.eval(expression)) return true; } catch { /* page navigating */ } await delay(gap); } return false; }
  async goto(url) { await this.send('Page.navigate', { url }); await delay(1200); }
  async viewport(w, h, mobile) { await this.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile }); }
  async shot(name) { try { const r = await this.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(OUT, name), Buffer.from(r.data, 'base64')); } catch { /* ignore */ } }
  btn(text) { return `[...document.querySelectorAll('button')].find(b => (b.textContent||'').trim().includes(${JSON.stringify(text)}))`; }
  sel(css) { return `document.querySelector(${JSON.stringify(css)})`; }
  async click(expr) { return this.eval(`(() => { const el = ${expr}; if (!el) return false; el.click(); return true; })()`); }
  async type(css, value) {
    return this.eval(`(() => { const i = document.querySelector(${JSON.stringify(css)}); if (!i) return false; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(i, ${JSON.stringify(value)}); i.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
  }
  text() { return this.eval('document.body.innerText'); }
  async stop() { try { this.ws?.close(); } catch { /* ignore */ } try { this.proc?.kill(); } catch { /* ignore */ } await delay(500); try { rmSync(this.profile, { recursive: true, force: true }); } catch { /* ignore */ } }
}

// ============================================================================ 0. prerequisites
group('0. Prerequisites');
const apiUp = await reachable(`${API}/health`);
const webUp = await reachable(WEB);
record(apiUp, `backend reachable at ${API}`);
record(webUp, `web app reachable at ${WEB}`);
if (!apiUp || !webUp) {
  console.log('\nStart both first:  (cd toowix-backend && npm run dev)   (cd toowix-web-app && npm run dev)');
  process.exit(1);
}

// ============================================================================ 1. static
group('1. Static checks, types and build');
if (flag('--skip-static')) skip('static checks', '--skip-static');
else {
  await check('project verification script (wiring + smoke)', () => {
    const r = spawnSync('node', ['scripts/verify-toowix.mjs', flag('--skip-build') ? '--skip-build' : ''].filter(Boolean), { cwd: ROOT, encoding: 'utf8' });
    const total = (r.stdout.match(/Total: (\d+)\/(\d+) passed/) || []);
    if (r.status !== 0) throw new Error(`verify script failed: ${total[0] || r.stdout.split('\n').slice(-6).join(' ')}`);
  });
}

// ============================================================================ 2. fixture
group('2. Test fixture (temporary session, meetings)');
if (flag('--skip-api') && flag('--skip-browser')) skip('fixture', 'nothing needs it');
else if (flag('--no-auth')) skip('authenticated fixture', '--no-auth');
else {
  await check('create temporary session, ID token and test meetings', () => {
    const key = firebaseKey();
    if (!key) throw new Error('Firebase web API key not found (set E2E_FIREBASE_API_KEY)');
    FX = runBackendScript(['setup', EMAIL], { E2E_FIREBASE_API_KEY: key });
    AUTH = { idToken: FX.idToken, sessionToken: FX.sessionToken };
  });
}
const M = FX?.meetings;

try {
  // ========================================================================== 3. API
  group('3a. API: public endpoints and room admission');
  if (flag('--skip-api')) skip('API tests', '--skip-api');
  else {
    await check('health reports database connected', async () => { const r = await api('GET', '/health'); return r.s === 200 && r.j?.database?.status === 'connected'; });
    await check('unknown route -> 404 JSON (no crash)', async () => (await api('GET', '/api/does-not-exist')).s === 404);
    await check('invalid room code -> 400', async () => (await api('GET', '/api/meetings/room/a')).s === 400);
    await check('unknown saved room -> 404', async () => (await api('GET', '/api/meetings/room/zzzz-nonexistent-room')).s === 404);
    const inst = `instant-e2e${rand()}`;
    await check('instant room info: open, no password', async () => { const r = await api('GET', `/api/meetings/room/${inst}`); return r.s === 200 && r.j.meeting.passwordRequired === false && r.j.meeting.locked === false; });
    await check('instant room: guest gets a Jitsi + attendance token', async () => { const r = await api('POST', `/api/meetings/room/${inst}/admission`, { body: { name: 'Guest' } }); return r.s === 200 && !!r.j.jitsiToken && !!r.j.attendanceToken; });
    await check('guest name is length-limited, server stays up', async () => { const r = await api('POST', `/api/meetings/room/${inst}/admission`, { body: { name: 'x'.repeat(5000) } }); return r.s < 500 && (await api('GET', '/health')).s === 200; });
    await check('protected routes reject anonymous requests', async () => {
      const codes = await Promise.all(['/api/meetings', '/api/recordings', '/api/notifications', '/api/contacts'].map(async (p) => (await api('GET', p)).s));
      return codes.every((c) => c === 401 || c === 403);
    });
    if (/localhost|127\.0\.0\.1/.test(API)) skip('CORS: a foreign origin is refused', 'local dev is permissive by design; run with --api https://talk.toowix.com to test production');
    else await check('CORS: a foreign origin is refused', async () => { const r = await api('GET', '/health', { origin: 'https://evil.example' }); return r.h.get('access-control-allow-origin') !== 'https://evil.example'; });

    group('3b. API: realtime signals');
    const sigRoom = `instant-sig${rand()}`;
    await check('signal keeps msgId + senderSessionId (own-echo can be ignored)', async () => {
      const p = await api('POST', `/api/meetings/room/${sigRoom}/signal`, { body: { msgId: 'm-1', sender: 'Tester', senderSessionId: 's-1', type: 'CHAT_MESSAGE', payload: { text: 'hi' } } });
      const g = await api('GET', `/api/meetings/room/${sigRoom}/signal?since=0`);
      const sig = (g.j?.signals || [])[0];
      return p.s === 200 && sig?.msgId === 'm-1' && sig?.senderSessionId === 's-1' && sig?.payload?.text === 'hi';
    });
    await check('signals are per room', async () => (await api('GET', `/api/meetings/room/instant-other${rand()}/signal?since=0`)).j?.signals?.length === 0);

    if (M) {
      group('3c. API: public meeting');
      await check('public meeting: guests join directly', async () => { const i = await api('GET', `/api/meetings/room/${M.public.slug}`); const a = await api('POST', `/api/meetings/room/${M.public.slug}/admission`, { body: { name: 'Guest P' } }); return i.j.meeting.type === 'Guest' && a.s === 200 && !!a.j.jitsiToken; });
      await check('host joining as account is moderator', async () => { const a = await api('POST', `/api/meetings/room/${M.public.slug}/admission`, { auth: true, body: {} }); return a.s === 200 && a.j.moderator === true; });

      group('3d. API: private meeting (password + waiting room)');
      const P = M.private.slug;
      await check('info: password required + invite restricted', async () => { const r = await api('GET', `/api/meetings/room/${P}`); return r.j.meeting.passwordRequired === true && r.j.meeting.inviteRestricted === true; });
      await check('direct admission blocked -> use waiting room', async () => { const r = await api('POST', `/api/meetings/room/${P}/admission`, { body: { name: 'G' } }); return r.s === 403 && r.j.useLobby === true; });
      await check('knock without / with wrong password -> 401', async () => {
        const a = await api('POST', `/api/meetings/room/${P}/lobby/knock`, { body: { name: 'G' } });
        const b = await api('POST', `/api/meetings/room/${P}/lobby/knock`, { body: { name: 'G', passcode: 'nope' } });
        return a.s === 401 && b.s === 401;
      });
      let reqId; let denyId;
      await check('right password -> waits in the lobby', async () => { const r = await api('POST', `/api/meetings/room/${P}/lobby/knock`, { body: { name: 'Guest One', passcode: M.private.password } }); reqId = r.j.requestId; return r.s === 200 && r.j.status === 'WAITING' && !!reqId; });
      await check('anonymous cannot see or admit the waiting list', async () => {
        const l = await api('GET', `/api/meetings/room/${P}/lobby/pending`);
        const a = await api('POST', `/api/meetings/room/${P}/lobby/admit`, { body: { requestId: reqId } });
        return l.s === 403 && a.s === 403;
      });
      await check('host sees the waiting guest', async () => { const r = await api('GET', `/api/meetings/room/${P}/lobby/pending`, { auth: true }); return r.s === 200 && (r.j.waiting || []).some((w) => w.id === reqId); });
      await check('host admits -> guest receives a token', async () => {
        const a = await api('POST', `/api/meetings/room/${P}/lobby/admit`, { auth: true, body: { requestId: reqId } });
        const s = await api('GET', `/api/meetings/room/${P}/lobby/status?requestId=${reqId}`);
        return a.s === 200 && s.j.status === 'ADMITTED' && !!s.j.jitsiToken;
      });
      await check('host denies another guest -> DENIED', async () => {
        const k = await api('POST', `/api/meetings/room/${P}/lobby/knock`, { body: { name: 'Guest Two', passcode: M.private.password } });
        denyId = k.j.requestId;
        const d = await api('POST', `/api/meetings/room/${P}/lobby/deny`, { auth: true, body: { requestId: denyId } });
        const s = await api('GET', `/api/meetings/room/${P}/lobby/status?requestId=${denyId}`);
        return d.s === 200 && s.j.status === 'DENIED';
      });
      await check('host enters the private meeting directly (no password)', async () => { const r = await api('POST', `/api/meetings/room/${P}/lobby/knock`, { auth: true, body: {} }); return r.s === 200 && r.j.status === 'ADMITTED' && r.j.isHost === true; });

      group('3e. API: locking a meeting mid-call');
      const L = M.lock.slug;
      await check('empty password is rejected (400)', async () => (await api('POST', `/api/meetings/room/${L}/lock`, { auth: true, body: { password: '  ' } })).s === 400);
      await check('anonymous cannot lock or unlock (403)', async () => {
        const a = await api('POST', `/api/meetings/room/${L}/lock`, { body: { password: 'x' } });
        const b = await api('POST', `/api/meetings/room/${L}/unlock`, { body: {} });
        return a.s === 403 && b.s === 403;
      });
      await check('host locks the meeting', async () => { const r = await api('POST', `/api/meetings/room/${L}/lock`, { auth: true, body: { password: 'lock-e2e' } }); const i = await api('GET', `/api/meetings/room/${L}`); return r.s === 200 && i.j.meeting.locked === true && i.j.meeting.passwordRequired === true; });
      await check('locked: no direct join, password + lobby required', async () => {
        const a = await api('POST', `/api/meetings/room/${L}/admission`, { body: { name: 'G' } });
        const b = await api('POST', `/api/meetings/room/${L}/lobby/knock`, { body: { name: 'G', passcode: 'wrong' } });
        const c = await api('POST', `/api/meetings/room/${L}/lobby/knock`, { body: { name: 'G', passcode: 'lock-e2e' } });
        return a.s === 403 && b.s === 401 && c.s === 200 && c.j.status === 'WAITING';
      });
      await check('host unlocks -> public again', async () => { const r = await api('POST', `/api/meetings/room/${L}/unlock`, { auth: true, body: {} }); const a = await api('POST', `/api/meetings/room/${L}/admission`, { body: { name: 'G' } }); return r.s === 200 && a.s === 200 && !!a.j.jitsiToken; });

      group('3f. API: RSVP (accept / decline)');
      const R = M.rsvp;
      const rsvp = (response, email = R.invitee) => api('POST', '/api/meetings/rsvp', { body: { meetingId: R.id, email, response } });
      await check('view only: shows the meeting, records nothing', async () => { const r = await rsvp('view'); return r.s === 200 && r.j.status === 'view' && r.j.meeting.name === 'E2E rsvp'; });
      await check('accept, then change mind and decline', async () => { const a = await rsvp('accepted'); const d = await rsvp('declined'); return a.j.status === 'accepted' && d.j.status === 'declined'; });
      await check('email not on the invite list -> 403', async () => (await rsvp('accepted', 'stranger@e2e.invalid')).s === 403);
      await check('missing fields -> 400, unknown meeting -> 404', async () => {
        const a = await api('POST', '/api/meetings/rsvp', { body: { meetingId: R.id } });
        const b = await api('POST', '/api/meetings/rsvp', { body: { meetingId: '000000000000000000000000', email: R.invitee, response: 'accepted' } });
        return a.s === 400 && b.s === 404;
      });

      group('3g. API: meetings list, creation rules, invites');
      await check('host meeting list contains the test meetings', async () => { const r = await api('GET', '/api/meetings', { auth: true }); const names = JSON.stringify(r.j); return r.s === 200 && names.includes('E2E public') && names.includes('E2E private'); });
      await check('creating a Private meeting without a password -> 400', async () => (await api('POST', '/api/meetings', { auth: true, body: { name: 'x', roomSlug: `twx-e2e-bad-${rand()}`, type: 'Private' } })).s === 400);
      await check('creating a meeting without a name -> 400', async () => (await api('POST', '/api/meetings', { auth: true, body: { roomSlug: `twx-e2e-bad-${rand()}`, type: 'Guest' } })).s === 400);
      await check('invite: anonymous -> 401', async () => (await api('POST', `/api/meetings/room/${M.public.slug}/invite`, { body: { emails: ['a@e2e.invalid'] } })).s === 401);
      await check('invite: no valid emails -> 400; more than 20 -> 400', async () => {
        const a = await api('POST', `/api/meetings/room/${M.public.slug}/invite`, { auth: true, body: { emails: ['not-an-email'] } });
        const b = await api('POST', `/api/meetings/room/${M.public.slug}/invite`, { auth: true, body: { emails: Array.from({ length: 21 }, (_, i) => `p${i}@e2e.invalid`) } });
        return a.s === 400 && b.s === 400;
      });
      await check('invite: host invites two people (added to the invite list)', async () => {
        const r = await api('POST', `/api/meetings/room/${M.public.slug}/invite`, { auth: true, body: { emails: ['one@e2e.invalid', 'two@e2e.invalid', 'one@e2e.invalid'] } });
        const l = await api('GET', '/api/meetings', { auth: true });
        return r.s === 200 && r.j.sent === 2 && JSON.stringify(l.j).includes('two@e2e.invalid');
      });

      group('3h. API: contact book');
      let c1; let c2;
      await check('empty/unknown state: list works', async () => { const r = await api('GET', '/api/contacts', { auth: true }); return r.s === 200 && Array.isArray(r.j.contacts); });
      await check('add a contact', async () => { const r = await api('POST', '/api/contacts', { auth: true, body: { name: 'Ann E2E', email: 'Ann@E2E.invalid' } }); c1 = r.j.contact; return r.s === 201 && c1.email === 'ann@e2e.invalid'; });
      await check('duplicate email -> 409', async () => (await api('POST', '/api/contacts', { auth: true, body: { name: 'Again', email: 'ann@e2e.invalid' } })).s === 409);
      await check('invalid email / missing name -> 400', async () => {
        const a = await api('POST', '/api/contacts', { auth: true, body: { name: 'Bad', email: 'nope' } });
        const b = await api('POST', '/api/contacts', { auth: true, body: { name: '', email: 'ok@e2e.invalid' } });
        return a.s === 400 && b.s === 400;
      });
      await check('edit a contact; editing into a duplicate -> 409', async () => {
        const two = await api('POST', '/api/contacts', { auth: true, body: { name: 'Bob E2E', email: 'bob@e2e.invalid' } }); c2 = two.j.contact;
        const ok = await api('PUT', `/api/contacts/${c1.id}`, { auth: true, body: { name: 'Ann Renamed', email: 'ann@e2e.invalid' } });
        const dup = await api('PUT', `/api/contacts/${c1.id}`, { auth: true, body: { name: 'Ann', email: 'bob@e2e.invalid' } });
        return ok.s === 200 && ok.j.contact.name === 'Ann Renamed' && dup.s === 409;
      });
      await check('list is sorted by name and holds both', async () => { const r = await api('GET', '/api/contacts', { auth: true }); const mine = r.j.contacts.filter((c) => c.email.endsWith('@e2e.invalid')).map((c) => c.name); return mine.join('|') === 'Ann Renamed|Bob E2E'; });
      await check('bad ids -> 404; delete works once', async () => {
        const a = await api('PUT', '/api/contacts/not-an-id', { auth: true, body: { name: 'x', email: 'x@e2e.invalid' } });
        const d1 = await api('DELETE', `/api/contacts/${c1.id}`, { auth: true });
        const d2 = await api('DELETE', `/api/contacts/${c1.id}`, { auth: true });
        await api('DELETE', `/api/contacts/${c2.id}`, { auth: true });
        return a.s === 404 && d1.s === 200 && d2.s === 404;
      });

      group('3i. API: other authenticated areas');
      await check('notifications list', async () => (await api('GET', '/api/notifications', { auth: true })).s === 200);
      await check('recordings list', async () => (await api('GET', '/api/recordings', { auth: true })).s === 200);
    } else {
      skip('meeting/contact API tests', 'no authenticated fixture (use without --no-auth)');
    }
  }

  // ========================================================================== 4. browser
  group('4. Browser (real Chrome)');
  if (flag('--skip-browser')) skip('browser tests', '--skip-browser');
  else if (!CHROME) skip('browser tests', 'Chrome not found (set CHROME_PATH)');
  else {
    const b = new Browser();
    await b.start();
    try {
      await b.viewport(1366, 820, false);
      await b.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__errors=[];window.addEventListener("error",e=>window.__errors.push(e.message));window.addEventListener("unhandledrejection",e=>window.__errors.push(String(e.reason)));' });

      // ---- public pages
      await b.goto(`${WEB}/`);
      await check('home page renders with New Meeting and join-by-code', async () => b.until(`!!(${b.btn('New Meeting')}) && !!${b.sel('input[placeholder="Enter room code or link"]')}`, 40));
      await b.shot('home.png');
      await check('join-by-code goes to that room', async () => {
        await b.type('input[placeholder="Enter room code or link"]', 'my-e2e-room');
        await b.eval(`document.querySelector('input[placeholder="Enter room code or link"]').form.requestSubmit()`);
        return b.until(`location.pathname.startsWith('/meet/') && location.pathname.includes('my-e2e-room')`, 30);
      });
      await b.goto(`${WEB}/login`);
      await check('login page renders a form', async () => b.until(`document.querySelectorAll('input').length >= 2`, 30));
      await b.goto(`${WEB}/signup`);
      await check('signup page renders a form', async () => b.until(`document.querySelectorAll('input').length >= 3`, 30));
      await b.goto(`${WEB}/forgot-password`);
      await check('forgot-password page renders', async () => b.until(`document.querySelectorAll('input').length >= 1`, 30));
      await b.goto(`${WEB}/dashboard`);
      await check('dashboard without login redirects to sign in', async () => b.until(`location.pathname.startsWith('/login') || location.pathname.startsWith('/signin') || document.body.innerText.toLowerCase().includes('sign in')`, 40));
      await b.goto(`${WEB}/meeting-link-expired`);
      await check('meeting-link-expired page renders', async () => (await b.text()).length > 20);
      await b.goto(`${WEB}/no-such-page-${rand()}`);
      await check('unknown page does not crash', async () => (await b.eval('window.__errors.length')) === 0);

      // ---- RSVP flow
      if (M) {
        await b.goto(`${WEB}/rsvp?meetingId=${M.rsvp.id}&email=${encodeURIComponent(M.rsvp.invitee)}&response=accepted`);
        await check('RSVP link opens a choice page (Accept / Decline)', async () => b.until(`!!(${b.btn('Accept')}) && !!(${b.btn('Decline')}) && document.body.innerText.includes('E2E rsvp')`, 40));
        await b.shot('rsvp-choose.png');
        await check('Accept -> thank-you page', async () => { await b.click(b.btn('Accept')); const ok = await b.until(`/thank you/i.test(document.body.innerText)`, 75); if (!ok) { await b.shot('rsvp-accept-fail.png'); throw new Error('page text: ' + (await b.text()).slice(0, 200) + ' errors: ' + JSON.stringify(await b.eval('window.__errors'))); } return true; });
        await check('thank-you page -> Join opens the meeting page', async () => { await b.click(b.btn('Join Video Meeting')); return b.until(`location.pathname === '/meet/${M.rsvp.slug}'`, 40); });
        await b.goto(`${WEB}/rsvp?meetingId=${M.rsvp.id}&email=${encodeURIComponent(M.rsvp.invitee)}&response=declined`);
        await check('Decline -> thank-you page', async () => { await b.until(`!!(${b.btn('Decline')})`, 30); await b.click(b.btn('Decline')); return b.until(`document.body.innerText.includes('Thank you for letting us know')`, 40); });

        // ---- private meeting prejoin
        await b.goto(`${WEB}/meet/${M.private.slug}`);
        await check('private meeting page asks for a password', async () => b.until(`!!${b.sel('input[type="password"]')}`, 40));
        await b.shot('private-prejoin.png');
        await check('wrong password shows an error', async () => {
          await b.type('input[placeholder="Enter your name to join"]', 'Browser Guest').catch(() => {});
          await b.type('input[type="password"]', 'wrong-pass');
          await b.click(b.btn('Join Meeting'));
          return b.until(`document.body.innerText.toLowerCase().includes('incorrect')`, 40);
        });
        await check('right password -> waiting for the host', async () => {
          await b.type('input[type="password"]', M.private.password);
          await b.click(b.btn('Join Meeting'));
          return b.until(`/waiting for the host/i.test(document.body.innerText)`, 50);
        });
        await b.shot('private-waiting.png');
        // ---- locked meeting prejoin
        await api('POST', `/api/meetings/room/${M.lock.slug}/lock`, { auth: true, body: { password: 'lock-e2e' } });
        await b.goto(`${WEB}/meet/${M.lock.slug}`);
        await check('locked meeting page asks for the lock password', async () => b.until(`!!${b.sel('input[type="password"]')}`, 40));
        await api('POST', `/api/meetings/room/${M.lock.slug}/unlock`, { auth: true, body: {} });
      } else {
        skip('RSVP / private / locked browser flows', 'no authenticated fixture');
      }

      // ---- in-call suite: desktop then phone size
      for (const mode of [ { name: 'desktop', w: 1366, h: 820, mobile: false }, { name: 'mobile', w: 390, h: 844, mobile: true } ]) {
        await b.viewport(mode.w, mode.h, mode.mobile);
        const room = `instant-e2e${rand()}`;
        await b.goto(`${WEB}/meet/${room}`);
        const has = (t) => `!!(${b.btn(t)})`;
        await check(`${mode.name}: pre-join page shows Join Meeting`, async () => { await b.type('input[placeholder="Enter your name to join"]', 'E2E Tester'); return b.until(has('Join Meeting'), 50); });
        await b.click(b.btn('Join Meeting'));
        const joined = await b.until(`!!${b.sel('button[title="Leave call"]')}`, 100);
        record(joined, `${mode.name}: joined the call`);
        if (!joined) { await b.shot(`${mode.name}-notjoined.png`); continue; }
        await delay(2500);
        await b.shot(`${mode.name}-incall.png`);
        await check(`${mode.name}: no script errors after joining`, async () => (await b.eval('window.__errors.length')) === 0);
        await check(`${mode.name}: tab icon changes for the call state`, async () => b.eval(`(document.querySelector('link[rel="icon"]')||{}).href.startsWith('data:')`));
        await check(`${mode.name}: 'Your meeting's ready' card with the link`, async () => b.eval(`document.body.innerText.includes("Your meeting's ready") && document.body.innerText.includes('${room}')`));
        await b.click(b.sel('button[aria-label="Close"]')).catch(() => {});

        await check(`${mode.name}: microphone toggles`, async () => {
          const before = await b.eval(`(document.querySelector('button[title*="microphone (M)"]')||{}).title`);
          await b.click(b.sel('button[title*="microphone (M)"]')); await delay(600);
          const after = await b.eval(`(document.querySelector('button[title*="microphone (M)"]')||{}).title`);
          return before && after && before !== after;
        });
        await check(`${mode.name}: camera toggles`, async () => {
          const before = await b.eval(`(document.querySelector('button[title*="camera (V)"]')||{}).title`);
          await b.click(b.sel('button[title*="camera (V)"]')); await delay(800);
          const after = await b.eval(`(document.querySelector('button[title*="camera (V)"]')||{}).title`);
          return before && after && before !== after;
        });
        await check(`${mode.name}: reactions can be spammed (tray stays open)`, async () => {
          await b.click(b.sel('button[title="Send a reaction"]')); await delay(400);
          const emoji = `[...document.querySelectorAll('button')].filter(x => ['💖','👍','🎉','👏','😂','😮'].includes((x.textContent||'').trim()))`;
          await b.click(`${emoji}[0]`); await delay(150); await b.click(`${emoji}[1]`); await delay(150); await b.click(`${emoji}[0]`); await delay(300);
          const stillOpen = await b.eval(`${emoji}.length >= 6`);
          const floating = await b.eval(`[...document.querySelectorAll('div')].filter(d => (d.style.animation||'').includes('floatUp')).length`);
          return stillOpen && floating >= 3;
        });
        await check(`${mode.name}: raise hand`, async () => {
          const before = await b.eval(`(document.querySelector('button[title="Raise hand"]')||{}).title`);
          await b.click(b.sel('button[title="Raise hand"]')); await delay(500);
          return before === 'Raise hand' && (await b.eval(`!!document.querySelector('button[title="Lower hand"]')`));
        });
        if (!mode.mobile) {
          await check('desktop: tile view toggle', async () => {
            const t1 = await b.eval(`(document.querySelector('button[title*="tile view"]')||{}).title`);
            await b.click(b.sel('button[title*="tile view"]')); await delay(500);
            const t2 = await b.eval(`(document.querySelector('button[title*="tile view"]')||{}).title`);
            await b.click(b.sel('button[title*="tile view"]'));
            return t1 && t2 && t1 !== t2;
          });
          await check('desktop: captions button present', async () => b.eval(`!!document.querySelector('button[title*="captions"]')`));
          await check('desktop: present-screen button present', async () => b.eval(`!!document.querySelector('button[data-testid="screen-share-toggle"]')`));
          await check('desktop: people panel opens', async () => { await b.click(b.sel('button[title^="People ("]')); return b.until(`/in call/i.test(document.body.innerText)`, 25); });
          await b.click(b.sel('button[title^="People ("]'));
        } else {
          await check('mobile: bottom bar is compact (<= 6 buttons, no overflow)', async () => b.eval(`(() => { const bar = document.querySelector('.tw-toolbar'); const kids = [...bar.querySelectorAll(':scope > button, :scope > div > button')].filter(x => x.offsetParent !== null && !x.closest('.tw-more-menu') && !x.title.startsWith('Select')); const r = bar.getBoundingClientRect(); return kids.length <= 6 && r.left >= 0 && r.right <= window.innerWidth; })()`));
          await check('mobile: page does not scroll sideways', async () => b.eval(`document.documentElement.scrollWidth <= window.innerWidth + 1`));
        }

        // chat: send once, incoming toast + unread badge
        const chatRoom = room;
        await api('POST', `/api/meetings/room/${chatRoom}/signal`, { body: { msgId: 'ext-' + rand(), sender: 'Other Person', senderSessionId: 'ext-session', type: 'CHAT_MESSAGE', payload: { text: 'toast-check' } } });
        await check(`${mode.name}: incoming message shows a slide-in toast`, async () => b.until(`!!${b.sel('.tw-chat-toasts [role="status"]')} && ${b.sel('.tw-chat-toasts')}.innerText.includes('toast-check')`, 30));
        await check(`${mode.name}: unread count badge shows 1`, async () => (await b.eval(mode.mobile ? `(document.querySelector('button[title="More options"] span')||{}).textContent||''` : `(document.querySelector('button[title="Chat with everyone"] span[aria-label]')||{}).textContent||''`)).trim() === '1');
        if (mode.mobile) { await b.click(b.sel('button[title="More options"]')); await delay(300); await b.click(`[...document.querySelectorAll('.tw-more-menu button')].find(x => x.textContent.trim().startsWith('Chat'))`); }
        else await b.click(b.sel('button[title="Chat with everyone"]'));
        await check(`${mode.name}: chat panel opens and the badge clears`, async () => { await delay(500); return b.eval(`!!document.querySelector('input[placeholder="Send a message..."]') && !document.querySelector('button[title="Chat with everyone"] span[aria-label]')`); });
        await check(`${mode.name}: a sent message appears exactly once`, async () => {
          const word = 'once-' + rand();
          await b.type('input[placeholder="Send a message..."]', word);
          await b.eval(`document.querySelector('input[placeholder="Send a message..."]').form.requestSubmit()`);
          await delay(3500);
          return (await b.eval(`(document.body.innerText.match(/${word}/g) || []).length`)) === 1;
        });
        if (mode.mobile) await check('mobile: chat panel is full screen', async () => b.eval(`(() => { const p = document.querySelector('.tw-panel'); const r = p.getBoundingClientRect(); return r.width >= window.innerWidth - 2 && r.height >= window.innerHeight - 2; })()`));
        await b.shot(`${mode.name}-chat.png`);
        await b.click(b.sel('.tw-panel button, button[aria-label="Close"]')).catch(() => {});
        await b.eval(`(() => { const x = [...document.querySelectorAll('.tw-panel button')].find(bn => bn.querySelector('svg')); if (x) x.click(); })()`).catch(() => {});

        // More menu -> Settings
        await b.click(b.sel('button[title="More options"]')); await delay(400);
        await check(`${mode.name}: More menu lists its options`, async () => b.eval(`(() => { const t = [...document.querySelectorAll('button')].map(x => x.textContent.trim()).join('|'); return ['Settings','Security options','Polls','Performance settings','Participants stats','View shortcuts','Embed meeting','Share video'].every(w => t.includes(w)); })()`));
        await b.shot(`${mode.name}-more.png`);
        await check(`${mode.name}: Settings opens (Audio / Video / General)`, async () => {
          await b.click(`[...document.querySelectorAll('button')].filter(x => x.textContent.trim() === 'Settings').pop()`);
          if (!(await b.until(`!!${b.sel('[role="dialog"][aria-label="Settings"]')}`, 25))) return false;
          const tabs = await b.eval(`[...document.querySelectorAll('.tw-settings-nav button')].map(x => x.textContent.trim()).join(',')`);
          return tabs === 'Audio,Video,General';
        });
        await check(`${mode.name}: settings content per tab`, async () => {
          const dlg = `document.querySelector('[role="dialog"][aria-label="Settings"]').innerText`;
          const audio = await b.eval(`(() => { const t = ${dlg}; return ['Microphone','Push to talk','Speaker','Test'].every(x => t.includes(x)); })()`);
          await b.click(`[...document.querySelectorAll('.tw-settings-nav button')].find(x => x.textContent.includes('Video'))`); await delay(250);
          const video = await b.eval(`(() => { const t = ${dlg}; return ['Camera','Send resolution','Receive resolution','Backgrounds and effects'].every(x => t.includes(x)); })()`);
          await b.click(`[...document.querySelectorAll('.tw-settings-nav button')].find(x => x.textContent.includes('General'))`); await delay(250);
          const general = await b.eval(`(() => { const t = ${dlg}; return ['Automatic picture-in-picture','Desktop notifications','Leave empty calls'].every(x => t.includes(x)); })()`);
          return audio && video && general;
        });
        await check(`${mode.name}: a setting toggle is remembered`, async () => {
          await b.click(b.sel('[role="switch"][aria-label="Leave empty calls"]')); await delay(200);
          const on = await b.eval(`localStorage.getItem('toowix_pref_leaveEmptyCalls') === 'true'`);
          await b.click(b.sel('[role="switch"][aria-label="Leave empty calls"]'));
          return on && (await b.eval(`localStorage.getItem('toowix_pref_leaveEmptyCalls') === 'false'`));
        });
        await b.shot(`${mode.name}-settings.png`);
        await b.click(b.sel('[role="dialog"][aria-label="Settings"] button[aria-label="Close"]'));

        // security modal + lock (instant room -> jitsi fallback path shows the modal)
        await b.click(b.sel('button[title="More options"]')); await delay(300);
        await check(`${mode.name}: Security options dialog opens`, async () => { await b.click(b.btn('Security options')); return b.until(`document.body.innerText.includes('Lock meeting')`, 25); });
        await b.eval(`(() => { const x = [...document.querySelectorAll('button')].find(bn => bn.querySelector('svg') && bn.closest('div[style*="fixed"]') && !bn.textContent.trim()); if (x) x.click(); })()`).catch(() => {});
        await b.goto(`${WEB}/meet/${room}`); // leave via navigation to reset state between modes

        await b.shot(`${mode.name}-done.png`);
      }
    } finally {
      await b.stop();
    }
  }
} finally {
  // ========================================================================== teardown
  if (FX && !flag('--keep')) {
    try { const t = runBackendScript(['teardown']); console.log(`\ncleanup: removed ${t.meetings} meetings, ${t.sessions} session, ${t.contacts} contacts`); }
    catch (e) { console.log(`\ncleanup FAILED: ${e.message} -- remove docs with slug prefix twx-e2e- manually`); }
  }
}

// ============================================================================ summary
const failed = results.filter((r) => !r.ok);
console.log('\n==================== SUMMARY ====================');
for (const s of [ ...new Set(results.map((r) => r.section)) ]) {
  const rs = results.filter((r) => r.section === s);
  console.log(`${rs.every((r) => r.ok) ? 'OK  ' : 'FAIL'}  ${s}  (${rs.filter((r) => r.ok).length}/${rs.length})`);
}
console.log(`\nTotal: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log('\nFailures:'); for (const f of failed) console.log(` - [${f.section}] ${f.name}`); }
console.log(`Screenshots: ${OUT}`);
console.log('\nNot covered (needs real people/devices): live audio/video quality, screen-share with 2+ presenters, recording end-to-end, PiP, real invitation email delivery, admit flow across two real browsers.');
process.exit(failed.length ? 1 : 0);

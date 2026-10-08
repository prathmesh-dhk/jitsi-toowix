/* Join-latency audit against the REAL running app: real Vite dev server, real local backend
 * (local Mongo, but the real .env's JITSI_APP_SECRET/JITSI_DOMAIN), real talk.toowix.com Jitsi
 * server. No fakes -- this measures actual script-download and actual WebRTC/XMPP connection
 * time, which a mocked harness (like device-switch-latency.cjs) cannot give for this specific
 * question. Joins a disposable, obviously-named instant-* room and leaves immediately after each
 * measurement. getUserMedia is Chrome's own --use-fake-device-for-media-stream synthetic capture
 * (headless has no real camera), which exercises the identical API path as real hardware.
 *
 * Usage: node tests/join-latency-audit.cjs
 * Env: BASE (default http://localhost:3005)
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const WebSocket = require('../../node_modules/ws');

const BASE = process.env.BASE || 'http://localhost:3005';
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const delay = ms => new Promise(r => setTimeout(r, ms));

async function runScenario(label, { throttle, dwellMs }) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'join-latency-chrome-'));
  let chrome, ws;
  let id = 0;
  const pending = new Map();

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const requestId = ++id;
      pending.set(requestId, { resolve, reject });
      ws.send(JSON.stringify({ id: requestId, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  async function until(expression, tries = 400) {
    for (let i = 0; i < tries; i++) { if (await evaluate(expression)) return performance_now_ms(); await delay(100); }
    const state = await evaluate('document.body.innerText.slice(0, 300)').catch(e => String(e));
    throw new Error(`Timed out waiting for: ${expression} :: ${state}`);
  }
  function performance_now_ms() { return Date.now(); }

  const networkEvents = [];

  chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' });

  let port;
  for (let i = 0; i < 150; i++) { try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; break; } catch { /* not yet */ } await delay(100); }
  if (!port) throw new Error('Chrome did not start');
  const tabs = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
  ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.once('open', r));
  ws.on('message', raw => {
    const data = JSON.parse(raw);

    if (data.method === 'Network.requestWillBeSent') {
      const url = data.params.request.url;

      if (url.includes('config.js') || url.includes('lib-jitsi-meet')) {
        networkEvents.push({ url: url.split('/').pop(), wallClockMs: Date.now() });
      }
    }
    if (data.id && pending.has(data.id)) {
      const p = pending.get(data.id);

      pending.delete(data.id);
      data.error ? p.reject(new Error(data.error.message)) : p.resolve(data.result);
    }
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  if (throttle) {
    // "Slow 3G"-ish: enough to make a ~2.5MB-ish lib-jitsi-meet bundle take real, visible time,
    // without being so extreme the test itself times out.
    await send('Network.emulateNetworkConditions', {
      offline: false, latency: 400, downloadThroughput: (400 * 1024) / 8, uploadThroughput: (200 * 1024) / 8,
    });
  }

  const roomName = `instant-claude-latency-audit-${label.replace(/[^a-z0-9]/gi, '')}-${Date.now()}`;
  const navStart = Date.now();

  await send('Page.navigate', { url: `${BASE}/meet/${roomName}` });
  const lobbyReadyAt = await until('document.body.innerText.includes("Ready to join?")');

  // Even the "zero dwell" scenario waits a tiny, fixed amount -- this is test-harness robustness
  // (giving React one paint to actually attach the button's click handler after the text node
  // appears), not a change to what's being measured: it's two orders of magnitude below any
  // dwell time a real person takes to read the screen and click.
  await delay(Math.max(dwellMs, 150));

  const preClickScriptEvents = networkEvents.filter(e => e.wallClockMs <= Date.now());
  const clickAt = Date.now();
  // Wrapped in an IIFE: CDP's Runtime.evaluate runs each call's top-level declarations in the
  // SAME global scope, so a bare `const input = ...` called twice (the retry loop below) throws
  // "Identifier has already been declared" on the second call.
  const clickJoin = () => evaluate(`(() => {
    const input = document.querySelector('input[placeholder*="name" i], input[placeholder*="Your name" i]');
    if (input) { input.value = 'Latency Tester'; input.dispatchEvent(new Event('input', { bubbles: true })); }
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('Join Meeting') || b.textContent.trim().startsWith('Requesting access'));
    if (btn) btn.click();
  })()`);

  await clickJoin();
  // "Ready to join?" is static lobby chrome that renders before the meeting-info fetch itself
  // has resolved -- on a throttled connection that fetch can still be in flight when a click
  // lands, and handleJoinMeeting's own !meetingInfo guard silently no-ops it (a real, separate
  // gap from what this task fixes: no visible feedback during that specific pre-click window).
  // Retrying the click is what an impatient real person does (click again when nothing seems to
  // happen); it does not change what's being measured -- clickAt is still the FIRST click.
  for (let i = 0; i < 50 && await evaluate('document.body.innerText.includes("Ready to join?")'); i++) {
    await delay(200);
    await clickJoin();
  }
  // hasJoined flips -> lobby UI replaced by the full call screen.
  const hasJoinedAt = await until('!document.body.innerText.includes("Ready to join?")');
  // The progress banner (added this session) hides itself exactly when jitsiMeeting.joined AND
  // (video off, or hasVideoTrack) are both true -- i.e. fully, honestly joined.
  const fullyJoinedAt = await until(
    `!document.body.innerText.includes("Connecting to meeting") && !document.body.innerText.includes("Joining…") && !document.body.innerText.includes("Starting camera")`,
    throttle ? 300 : 100
  );

  const result = {
    label,
    throttle: Boolean(throttle),
    dwellMs,
    lobbyRenderMs: lobbyReadyAt - navStart,
    scriptRequestsBeforeClick: preClickScriptEvents.map(e => e.url),
    scriptRequestsTotal: networkEvents.map(e => e.url),
    clickToHasJoinedMs: hasJoinedAt - clickAt,
    clickToFullyJoinedMs: fullyJoinedAt - clickAt,
    navToFullyJoinedMs: fullyJoinedAt - navStart,
  };

  try { await send('Browser.close'); } catch { /* best effort */ }
  try { ws.close(); } catch { /* best effort */ }
  try { chrome.kill(); } catch { /* best effort */ }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }

  return result;
}

(async () => {
  const scenarios = [
    // A: fast network, realistic ~2s dwell (reading the lobby, typing a name) before clicking Join.
    ['fast-2s-dwell', { throttle: false, dwellMs: 2000 }],
    // B: fast network, zero dwell -- approximates pre-fix behavior (preload gets essentially no
    // head start, same as the old code where it only started on click).
    ['fast-0s-dwell', { throttle: false, dwellMs: 0 }],
    // C: throttled network, realistic ~4s dwell -- shows whether the preload actually hides the
    // slow download during natural lobby dwell time.
    ['slow-4s-dwell', { throttle: true, dwellMs: 4000 }],
    // D: throttled network, zero dwell -- the honest floor: clicking Join the instant the lobby
    // appears, on a bad connection, with no time for the preload to get ahead at all.
    ['slow-0s-dwell', { throttle: true, dwellMs: 0 }],
  ];
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  const results = [];

  for (const [label, opts] of scenarios) {
    if (only && !only.includes(label)) continue;
    try {
      results.push(await runScenario(label, opts));
    } catch (err) {
      results.push({ label, ...opts, error: String(err && err.message || err) });
    }
    await delay(500);
  }

  console.log(JSON.stringify(results, null, 2));
})().catch(err => { console.error(err); process.exitCode = 1; });

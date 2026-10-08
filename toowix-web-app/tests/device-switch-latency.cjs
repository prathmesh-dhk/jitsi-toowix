/* Bluetooth device-switch latency audit -- real headless Chrome, same CDP-over-websocket pattern
 * as tests/meeting-gallery-browser.cjs, with a controllable fake navigator.mediaDevices (real
 * devicechange dispatch, scriptable getUserMedia failures) standing in for an actual Bluetooth
 * radio/OS handoff, which this sandbox has no access to. This proves the APP-CONTROLLED stages
 * (devicechange debounce, getUserMedia retry/backoff, room-operation queue wait vs. renegotiation
 * exec) with real numbers; it cannot measure the OS's own Bluetooth profile-switch time, which is
 * stage 4 in the audit and is explicitly out of this app's control.
 * Usage: node tests/device-switch-latency.cjs */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const WebSocket = require('../../node_modules/ws');

const BASE = process.env.GALLERY_BASE || 'http://localhost:3000';
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'device-switch-chrome-'));
const delay = ms => new Promise(r => setTimeout(r, ms));

let chrome; let ws; let id = 0; const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const requestId = ++id; pending.set(requestId, { resolve, reject });
    ws.send(JSON.stringify({ id: requestId, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function until(expression, tries = 150) {
  for (let i = 0; i < tries; i++) { if (await evaluate(expression)) return; await delay(100); }
  const state = await evaluate('JSON.stringify({ url: location.href, text: document.body.innerText.slice(0, 400), errors: (window.__errors || []).slice(0, 5) })').catch(e => String(e));
  throw new Error(`Timed out waiting for: ${expression} :: ${state}`);
}

// Same external-boundary fakes as meeting-gallery-browser.cjs, but:
//  - navigator.mediaDevices is a REAL EventTarget so devicechange actually dispatches to the
//    app's own addEventListener('devicechange', ...) listener (the harness this was copied from
//    stubs it to a no-op, which is fine for layout tests but useless for this one).
//  - enumerateDevices() reads a mutable list (window.__setDevices) so a test can simulate a
//    Bluetooth pairing handshake's appear/disappear/reappear burst.
//  - getUserMedia can be told to fail N times with a transient "device busy" error before
//    succeeding, to exercise createLocalTrackWithRetry for real.
//  - every '[Toowix device-switch] ...' console.info this session's instrumentation prints is
//    also captured into window.__deviceSwitchLogs, so the test can read exact measured numbers.
const injected = `
window.__errors = [];
window.addEventListener('error', e => window.__errors.push(String(e.message)));
window.addEventListener('unhandledrejection', e => window.__errors.push('rejection:' + String(e.reason && e.reason.message || e.reason)));
window.__callErrors = [];
window.__deviceSwitchLogs = [];
const __origInfo = console.info.bind(console);
console.info = (...args) => {
  if (typeof args[0] === 'string' && args[0].startsWith('[Toowix device-switch]')) {
    window.__deviceSwitchLogs.push({ label: args[0], data: args[1], t: performance.now() });
  }
  __origInfo(...args);
};

function canvasStream() {
  const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32;
  canvas.getContext('2d');
  return canvas.captureStream(1);
}

let __devices = [
  { kind: 'audioinput', deviceId: 'default-mic', label: 'Default Microphone' },
  { kind: 'videoinput', deviceId: 'cam-one', label: 'Test camera' },
  { kind: 'audiooutput', deviceId: 'speaker-one', label: 'Test speakers' },
];
let __micFailuresRemaining = 0;
let __micFailureKind = 'NotReadableError';
const __deviceChangeTarget = new EventTarget();

window.__setDevices = (devices) => { __devices = devices; };
window.__fireDeviceChange = () => __deviceChangeTarget.dispatchEvent(new Event('devicechange'));
window.__setMicFailures = (count, kind) => { __micFailuresRemaining = count; __micFailureKind = kind || 'NotReadableError'; };

Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
  getUserMedia: async (constraints) => {
    if (constraints.audio && __micFailuresRemaining > 0) {
      __micFailuresRemaining -= 1;
      const err = new Error('Device busy');
      err.name = __micFailureKind;
      throw err;
    }
    const stream = new MediaStream();
    if (constraints.video) stream.addTrack(canvasStream().getVideoTracks()[0]);
    if (constraints.audio) { const ctx = new AudioContext(); stream.addTrack(ctx.createMediaStreamDestination().stream.getAudioTracks()[0]); }
    return stream;
  },
  enumerateDevices: async () => __devices,
  setAudioOutputDevice: async () => {},
  addEventListener: (name, fn) => __deviceChangeTarget.addEventListener(name, fn),
  removeEventListener: (name, fn) => __deviceChangeTarget.removeEventListener(name, fn),
}});

class Emitter {
  constructor() { this.__listeners = {}; }
  on(name, fn) { (this.__listeners[name] ||= []).push(fn); return this; }
  addEventListener(name, fn) { return this.on(name, fn); }
  removeEventListener() {}
  emit(name, ...args) { for (const fn of [...(this.__listeners[name] || [])]) fn(...args); }
}
function loose(target) {
  return new Proxy(target, { get: (t, p) => (p in t) ? t[p] : (typeof p === 'string' && p !== 'then' ? () => undefined : undefined) });
}
const EV = {
  connection: { CONNECTION_ESTABLISHED: 'c.established', CONNECTION_FAILED: 'c.failed', CONNECTION_DISCONNECTED: 'c.disconnected' },
  conference: { CONFERENCE_JOINED: 'f.joined', CONFERENCE_FAILED: 'f.failed', USER_JOINED: 'f.user_joined', USER_LEFT: 'f.user_left', USER_ROLE_CHANGED: 'f.role', TRACK_ADDED: 'f.track_added', TRACK_REMOVED: 'f.track_removed', TRACK_MUTE_CHANGED: 'f.track_mute', DOMINANT_SPEAKER_CHANGED: 'f.dominant', RECORDER_STATE_CHANGED: 'f.recorder', LOCK_STATE_CHANGED: 'f.lock', CONNECTION_INTERRUPTED: 'f.interrupted', CONNECTION_RESTORED: 'f.restored', KICKED: 'f.kicked' },
  track: { TRACK_MUTE_CHANGED: 't.mute', TRACK_AUDIO_LEVEL_CHANGED: 't.level', LOCAL_TRACK_STOPPED: 't.stopped' },
};
class FakeTrack extends Emitter {
  constructor(type, stream, participantId, local) { super(); this.type = type; this.stream = stream; this.pid = participantId; this.local = local; this.muted = false; }
  getType() { return this.type; } isLocal() { return this.local; } getParticipantId() { return this.pid; }
  getTrack() { return this.type === 'video' ? this.stream.getVideoTracks()[0] : this.stream.getAudioTracks()[0]; }
  isMuted() { return this.muted; } mute() { this.muted = true; return Promise.resolve(); } unmute() { this.muted = false; return Promise.resolve(); }
  dispose() { return Promise.resolve(); } getDeviceId() { return 'dev'; } setEffect() { return Promise.resolve(); }
}
class FakeRoom extends Emitter {
  constructor() { super(); this.participants = new Map(); }
  join() { setTimeout(() => this.emit(EV.conference.CONFERENCE_JOINED), 30); }
  myUserId() { return 'local-user'; } getParticipantById(id) { return this.participants.get(id); }
  getParticipants() { return [...this.participants.values()]; }
  addTrack() { return Promise.resolve(); } removeTrack() { return Promise.resolve(); }
  replaceTrack() { return new Promise(r => setTimeout(r, 40)); } // a small, fixed, realistic SDP-renegotiation stand-in
}
class FakeConnection extends Emitter {
  connect() { setTimeout(() => this.emit(EV.connection.CONNECTION_ESTABLISHED), 30); }
  initJitsiConference() { window.__room = new FakeRoom(); return loose(window.__room); }
  disconnect() {}
}
const JitsiMeetJS = {
  setLogLevel() {}, init() {}, logLevels: { ERROR: 'error' }, events: EV, JitsiConnection: FakeConnection,
  createLocalTracks: async (options = {}) => {
    const wanted = options.devices || ['audio', 'video'];
    const stream = await navigator.mediaDevices.getUserMedia({ audio: wanted.includes('audio'), video: wanted.includes('video') });
    return wanted.filter(d => d === 'audio' || d === 'video').map(d => new FakeTrack(d, stream, 'local-user', true));
  },
  createLocalTracksFromMediaStreams: async (options = []) => options.map(o => new FakeTrack(o.mediaType || 'video', o.stream || new MediaStream(), 'local-user', true)),
};
window.JitsiMeetJS = JitsiMeetJS;
window.config = { hosts: { domain: 'meet.test', muc: 'conference.meet.test' }, p2p: { enabled: false } };
const meeting = { type:'Guest', organizerId:'host', accessAllowed:true, recordingEnabled:false, autoRecording:false, allowScreenShare:true, micLockEnabled:false };
const originalFetch = window.fetch;
window.fetch = async (url, options = {}) => {
  if (String(url).includes('/api/meetings/room/')) {
    return new Response(JSON.stringify(String(url).endsWith('/admission') ? { meeting, jitsiToken:'test-room-credential', attendanceToken:'attendance-credential', participantEntryId:'entry', moderator:false, participation:'guest' } : { meeting }), { status: 200 });
  }
  if (String(url).includes('/api/meetings/')) return new Response('{}', { status: 200 });
  return originalFetch(url, options);
};
`;

async function setViewport(width, height) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
}

async function joinMeeting() {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: injected });
  await send('Page.navigate', { url: BASE + '/home' });
  await until('document.readyState === "complete" && document.body && document.body.innerText.length > 0');
  await evaluate(`history.pushState({}, '', '/meet/test-room'); window.dispatchEvent(new PopStateEvent('popstate'));`);
  await until('document.body.innerText.includes("Join Meeting") || document.body.innerText.includes("Ready to join")');
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Join Meeting')?.click()`);
  await until('!!window.__room');
  await until(`document.querySelector('[title="Select microphone"]') !== null`);
}

async function openMicMenuAndSelect(label) {
  await evaluate(`document.querySelector('[title="Select microphone"]').click()`);
  await until(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === ${JSON.stringify(label)})`);
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})?.click()`);
}

let passCount = 0, failCount = 0;
function check(name, pass, detail) {
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ' -- ' + detail : ''}`);
  if (pass) passCount++; else failCount++;
}

async function main() {
  chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--use-fake-ui-for-media-stream', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let port;
  for (let i = 0; i < 150; i++) { try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; break; } catch { /* not yet */ } await delay(100); }
  if (!port) throw new Error('Chrome did not start');
  const tabs = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
  ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.once('open', r));
  ws.on('message', raw => { const data = JSON.parse(raw); if (data.id && pending.has(data.id)) { const p = pending.get(data.id); pending.delete(data.id); data.error ? p.reject(new Error(data.error.message)) : p.resolve(data.result); } });
  await setViewport(1280, 800);
  await joinMeeting();

  // --- TEST A: Bluetooth pairing-handshake burst must not flap the mic ---
  // Simulates the real bug this debounce was built to prevent: the device list appearing,
  // disappearing and reappearing several times within ~150ms (tighter than the 200ms debounce,
  // the exact condition that must NOT cause multiple disconnect/reconnect reactions).
  await evaluate(`window.__callErrorCountBefore = (window.__errors || []).length`);
  const burstStart = Date.now();
  await evaluate(`
    window.__setDevices([{ kind:'audioinput', deviceId:'default-mic', label:'Default Microphone' }, { kind:'videoinput', deviceId:'cam-one', label:'Test camera' }, { kind:'audiooutput', deviceId:'speaker-one', label:'Test speakers' }]);
    window.__fireDeviceChange();
  `);
  await delay(30);
  await evaluate(`
    window.__setDevices([{ kind:'videoinput', deviceId:'cam-one', label:'Test camera' }, { kind:'audiooutput', deviceId:'speaker-one', label:'Test speakers' }]);
    window.__fireDeviceChange();
  `); // mic vanishes mid-handshake
  await delay(40);
  await evaluate(`
    window.__setDevices([{ kind:'audioinput', deviceId:'bt-mic', label:'Bluetooth Headset' }, { kind:'videoinput', deviceId:'cam-one', label:'Test camera' }, { kind:'audiooutput', deviceId:'speaker-one', label:'Test speakers' }]);
    window.__fireDeviceChange();
  `); // reappears as the new BT device, same burst
  await delay(500); // let the trailing debounce + refresh() settle well past 200ms
  const settleLog = await evaluate(`(window.__deviceSwitchLogs || []).find(l => l.label.includes('burst settled'))`);
  const callErrorsAfterBurst = await evaluate(`document.body.innerText.includes('microphone was disconnected')`);

  check('devicechange burst settles exactly once (debounce log present)', Boolean(settleLog), settleLog ? `burstToSettleMs=${settleLog.data.burstToSettleMs}` : 'no settle log found');
  check('burst does not surface a spurious "microphone was disconnected" message', !callErrorsAfterBurst, callErrorsAfterBurst ? 'disconnected banner shown' : 'no banner shown');
  console.log(`  (wall-clock burst dispatch window: ${Date.now() - burstStart}ms, well inside the 200ms debounce)`);

  // --- TEST B: transient device-busy retry still recovers, with real timing ---
  await evaluate(`window.__deviceSwitchLogs = []; window.__setMicFailures(2, 'NotReadableError');`);
  await evaluate(`window.__setDevices([{ kind:'audioinput', deviceId:'default-mic', label:'Default Microphone' }, { kind:'audioinput', deviceId:'bt-mic-2', label:'Bluetooth Headset 2' }, { kind:'videoinput', deviceId:'cam-one', label:'Test camera' }, { kind:'audiooutput', deviceId:'speaker-one', label:'Test speakers' }]); window.__fireDeviceChange();`);
  // useMediaPreview's own devicechange listener (separate from the auto-switch effect being
  // audited) is what populates the menu's rendered device list -- give it a moment to re-render
  // before opening the menu (openMicMenuAndSelect itself waits for the specific button to exist).
  await delay(150);
  const retryStart = Date.now();
  await openMicMenuAndSelect('Bluetooth Headset 2');
  await until(`(window.__deviceSwitchLogs || []).some(l => l.label.includes('switchDevice total'))`, 100);
  const retryWallMs = Date.now() - retryStart;
  const gumLog = await evaluate(`(window.__deviceSwitchLogs || []).find(l => l.label.includes('getUserMedia acquired'))`);
  const totalLog = await evaluate(`(window.__deviceSwitchLogs || []).find(l => l.label.includes('switchDevice total'))`);
  const replaceLog = await evaluate(`(window.__deviceSwitchLogs || []).find(l => l.label.includes('replaceTrack'))`);

  check('mic recovers after 2 transient device-busy errors (no error left on screen)', Boolean(gumLog && gumLog.data.attemptsUsed === 3), gumLog ? JSON.stringify(gumLog.data) : 'no getUserMedia log');
  check('switch completes end-to-end after retries', Boolean(totalLog), totalLog ? JSON.stringify(totalLog.data) : 'no total log');
  console.log(`  measured breakdown: getUserMedia(with retries)=${gumLog?.data.totalMs}ms backoffSpent=${gumLog?.data.backoffMsSpent}ms replaceTrack(queueWait=${replaceLog?.data.queueWaitMs}ms exec=${replaceLog?.data.execMs}ms) switchDeviceTotal=${totalLog?.data.totalMs}ms wallClock=${retryWallMs}ms`);

  // --- TEST C: a normal switch (first getUserMedia attempt succeeds) is NOT held up by retries ---
  await evaluate(`window.__deviceSwitchLogs = []; window.__setMicFailures(0);`);
  await evaluate(`window.__setDevices([{ kind:'audioinput', deviceId:'default-mic', label:'Default Microphone' }, { kind:'audioinput', deviceId:'bt-mic-3', label:'Bluetooth Headset 3' }, { kind:'videoinput', deviceId:'cam-one', label:'Test camera' }, { kind:'audiooutput', deviceId:'speaker-one', label:'Test speakers' }]); window.__fireDeviceChange();`);
  await delay(150);
  await openMicMenuAndSelect('Bluetooth Headset 3');
  await until(`(window.__deviceSwitchLogs || []).some(l => l.label.includes('switchDevice total'))`, 100);
  const cleanGumLog = await evaluate(`(window.__deviceSwitchLogs || []).find(l => l.label.includes('getUserMedia acquired'))`);
  const cleanTotalLog = await evaluate(`(window.__deviceSwitchLogs || []).find(l => l.label.includes('switchDevice total'))`);

  check('a clean switch (no transient error) uses exactly 1 attempt, 0 backoff', Boolean(cleanGumLog && cleanGumLog.data.attemptsUsed === 1 && cleanGumLog.data.backoffMsSpent === 0), cleanGumLog ? JSON.stringify(cleanGumLog.data) : 'no log');
  console.log(`  clean-switch total (no OS delay simulated): ${cleanTotalLog?.data.totalMs}ms`);

  const errors = await evaluate('window.__errors');
  check('no uncaught errors during the whole audit', Array.isArray(errors) && errors.length === 0, JSON.stringify(errors));

  console.log(`\n${passCount} passed, ${failCount} failed`);
  process.exitCode = failCount > 0 ? 1 : 0;
}

main().catch(err => { console.error(err); process.exitCode = 1; }).finally(() => {
  try { ws && ws.close(); } catch {}
  try { chrome && chrome.kill(); } catch {}
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
});

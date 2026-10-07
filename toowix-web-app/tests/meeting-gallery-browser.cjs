/* Local Chromium gallery regression. Drives the real MeetingRoomPage against the Vite dev server with a
 * fake lib-jitsi-meet (window.JitsiMeetJS) and a fake backend admission. Participants arrive through the
 * same USER_JOINED / TRACK_ADDED path the app uses in a real meeting, so this is a fixture harness, not a
 * live Jitsi meeting. Usage: node tests/meeting-gallery-browser.cjs [sweep|flip|remount|counts|panel] */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const WebSocket = require('../../node_modules/ws');

const BASE = process.env.GALLERY_BASE || 'http://localhost:3000';
const MODE = process.argv[2] || 'sweep';
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-chrome-'));
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
async function setViewport(width, height) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 30))))');
}

// Injected before any app script. Fakes only the external boundaries: media devices, lib-jitsi-meet, backend.
const injected = `
window.__errors = [];
window.addEventListener('error', e => window.__errors.push(String(e.message)));
window.addEventListener('unhandledrejection', e => window.__errors.push('rejection:' + String(e.reason && e.reason.message || e.reason)));
window.__videoCreated = 0;
const __createElement = Document.prototype.createElement;
Document.prototype.createElement = function (tag, options) {
  if (String(tag).toLowerCase() === 'video') window.__videoCreated++;
  return __createElement.call(this, tag, options);
};
function canvasStream(color) {
  const canvas = __createElement.call(document, 'canvas'); canvas.width = 320; canvas.height = 180;
  const ctx = canvas.getContext('2d'); let n = 0;
  setInterval(() => { ctx.fillStyle = color; ctx.fillRect(0, 0, 320, 180); ctx.fillStyle = '#fff'; ctx.font = '40px sans-serif'; ctx.fillText(String(n++), 20, 70); }, 200);
  return canvas.captureStream(5);
}
Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
  getUserMedia: async constraints => {
    const stream = new MediaStream();
    if (constraints.video) stream.addTrack(canvasStream('#2d4a6b').getVideoTracks()[0]);
    if (constraints.audio) { const ctx = new AudioContext(); stream.addTrack(ctx.createMediaStreamDestination().stream.getAudioTracks()[0]); }
    return stream;
  },
  enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'mic-one', label: 'Test microphone' }, { kind: 'videoinput', deviceId: 'cam-one', label: 'Test camera' }, { kind: 'audiooutput', deviceId: 'speaker-one', label: 'Test speakers' }],
  addEventListener() {}, removeEventListener() {}
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
class FakeParticipant {
  constructor(id, name) { this.id = id; this.name = name; }
  getId() { return this.id; } getDisplayName() { return this.name; } isHidden() { return false; }
  getBotType() { return undefined; } getRole() { return 'participant'; } getProperty() { return undefined; }
  getTracks() { return []; } getIdentity() { return undefined; }
}
class FakeTrack extends Emitter {
  constructor(type, stream, participantId, local) { super(); this.type = type; this.stream = stream; this.pid = participantId; this.local = local; }
  getType() { return this.type; } isLocal() { return this.local; } getParticipantId() { return this.pid; }
  getTrack() { return this.type === 'video' ? this.stream.getVideoTracks()[0] : this.stream.getAudioTracks()[0]; }
  isMuted() { return false; } mute() { return Promise.resolve(); } unmute() { return Promise.resolve(); }
  dispose() { return Promise.resolve(); } getDeviceId() { return 'dev'; } setEffect() { return Promise.resolve(); }
}
class FakeRoom extends Emitter {
  constructor() { super(); this.participants = new Map(); }
  join() { setTimeout(() => this.emit(EV.conference.CONFERENCE_JOINED), 30); }
  myUserId() { return 'local-user'; } getParticipantById(id) { return this.participants.get(id); }
  getParticipants() { return [...this.participants.values()]; } addTrack() { return Promise.resolve(); } removeTrack() { return Promise.resolve(); }
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
window.__fake = {
  joinRemote(id, name, withVideo) {
    const room = window.__room; const participant = new FakeParticipant(id, name);
    room.participants.set(id, participant);
    room.emit(EV.conference.USER_JOINED, id, participant);
    if (withVideo) room.emit(EV.conference.TRACK_ADDED, new FakeTrack('video', new MediaStream([canvasStream(id === 'r1' ? '#6b3d2d' : '#3d6b4a').getVideoTracks()[0]]), id, false));
  },
  leaveRemote(id) { const room = window.__room; room.participants.delete(id); room.emit(EV.conference.USER_LEFT, id); },
};
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

async function joinMeeting() {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: injected });
  await send('Page.navigate', { url: BASE + '/home' });
  await until('document.readyState === "complete" && document.body && document.body.innerText.length > 0');
  await evaluate(`history.pushState({}, '', '/meet/test-room'); window.dispatchEvent(new PopStateEvent('popstate'));`);
  await until('document.body.innerText.includes("Join Meeting") || document.body.innerText.includes("Ready to join")');
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Join Meeting')?.click()`);
  await until('!!window.__room && !!window.__fake');
}

// Measure what a participant can actually see: card rectangles, row structure and clipping.
const MEASURE = `(() => {
  const grid = document.querySelector('.tw-grid');
  if (!grid) return null;
  const stage = document.querySelector('[data-gallery-stage]');
  if (stage) {
    // Layout geometry only: offsetLeft/offsetTop ignore the transform an in-flight slide applies.
    const sr = stage.getBoundingClientRect();
    const cells = [...stage.querySelectorAll('[data-gallery-cell]')];
    const px = v => parseFloat(v) || 0;
    const boxes = cells.map(c => { const l = sr.left + px(c.style.left), t = sr.top + px(c.style.top), w = px(c.style.width), h = px(c.style.height); return { l, t, r: l + w, b: t + h, w: Math.round(w * 10) / 10, h: Math.round(h * 10) / 10 }; });
    const tops = [...new Set(boxes.map(b => Math.round(b.t)))].sort((a, b) => a - b);
    const rowCounts = tops.map(t => boxes.filter(b => Math.round(b.t) === t).length);
    const clipped = boxes.filter(b => b.l < sr.left - 0.5 || b.r > sr.right + 0.5 || b.t < sr.top - 0.5 || b.b > sr.bottom + 0.5).length;
    const toolbar = document.querySelector('.tw-toolbar');
    const tb = toolbar ? toolbar.getBoundingClientRect() : null;
    const underToolbar = tb ? boxes.filter(b => b.b > tb.top + 0.5 && b.t < tb.bottom).length : 0;
    let maxCentreErr = 0;
    tops.forEach(t => { const row = boxes.filter(b => Math.round(b.t) === t); const lm = Math.min(...row.map(b => b.l)) - sr.left; const rm = sr.right - Math.max(...row.map(b => b.r)); maxCentreErr = Math.max(maxCentreErr, Math.abs(lm - rm)); });
    if (!window.__probeVideo) window.__probeVideo = stage.querySelector('[data-gallery-cell="local"] video');
    const localVideoSame = window.__probeVideo ? (window.__probeVideo === stage.querySelector('[data-gallery-cell="local"] video') && window.__probeVideo.isConnected) : null;
    return { maxCentreErr, localVideoSame, domMaxCols: Math.max(0, ...rowCounts), structure: rowCounts.join('-') || 'none', calc: grid.dataset.galleryLayout || 'n/a', cards: cells.length, clipped, underToolbar,
      sizes: [...new Set(boxes.map(b => b.w + 'x' + b.h))].join('|'), videos: stage.querySelectorAll('video').length, animations: document.getAnimations().length, animating: cells.filter(c => c.getAnimations().length).length };
  }
  if (!grid) return null;
  const g = grid.getBoundingClientRect();
  const cards = [...document.querySelectorAll('.tw-grid [data-participant-id]')];
  const rects = cards.map(c => c.getBoundingClientRect());
  const tops = [...new Set(rects.map(r => Math.round(r.top)))].sort((a, b) => a - b);
  const rowCounts = tops.map(t => rects.filter(r => Math.round(r.top) === t).length);
  const clipped = rects.filter(r => r.left < g.left - 0.5 || r.right > g.right + 0.5 || r.top < g.top - 0.5 || r.bottom > g.bottom + 0.5).length;
  const toolbar = document.querySelector('.tw-toolbar');
  const tb = toolbar ? toolbar.getBoundingClientRect() : null;
  const underToolbar = tb ? rects.filter(r => r.bottom > tb.top + 0.5 && r.top < tb.bottom).length : 0;
  return { domMaxCols: Math.max(0, ...rowCounts), structure: rowCounts.join('-') || 'none', calc: grid.dataset.galleryLayout || 'n/a', cards: cards.length, clipped, underToolbar,
    sizes: [...new Set(rects.map(r => Math.round(r.width) + 'x' + Math.round(r.height)))].join('|'),
    videos: document.querySelectorAll('.tw-grid video').length, animations: document.getAnimations().length };
})()`;

function transitions(seq) {
  const changes = []; const blips = [];
  for (let i = 1; i < seq.length; i++) if (seq[i].structure !== seq[i - 1].structure) changes.push(i);
  for (let i = 1; i < seq.length - 1; i++) if (seq[i].structure !== seq[i - 1].structure && seq[i + 1].structure === seq[i - 1].structure) blips.push(i);
  return { changes: changes.length, blips: blips.length, sample: seq.filter((_, i) => changes.includes(i)).slice(0, 6).map(s => s.structure) };
}

async function sweep(label, points) {
  const seq = [];
  for (const [w, h] of points) { await setViewport(w, h); seq.push({ w, h, ...(await evaluate(MEASURE)) }); }
  const t = transitions(seq);
  const clipFrames = seq.filter(s => s.clipped || s.underToolbar).length;
  console.log(JSON.stringify({ label, steps: seq.length, structureChanges: t.changes, reversalBlips: t.blips, firstChanges: t.sample, framesWithClipOrToolbarOverlap: clipFrames, maxVideos: Math.max(...seq.map(s => s.videos || 0)), errors: await evaluate('window.__errors.slice(0,5)') }));
  return seq;
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
  await evaluate(`window.__fake.joinRemote('r1', 'Alice', true); window.__fake.joinRemote('r2', 'Bob', false);`);
  await until('document.querySelectorAll(".tw-grid [data-participant-id]").length >= 3');
  const results = {};
  if (MODE === 'frames') {
    // Sample every animation frame while the viewport changes quickly, like a drag producing resize events mid-frame.
    await evaluate(`window.__frames = []; window.__measure = () => ${MEASURE};
      const tick = () => { const m = window.__measure(); if (m) window.__frames.push({ t: performance.now(), w: innerWidth, h: innerHeight, ...m }); requestAnimationFrame(tick); };
      requestAnimationFrame(tick);`);
    const runs = [];
    for (const h of (process.env.GALLERY_HEIGHTS || '500,620,800').split(',').map(Number)) {
      await evaluate('window.__frames.length = 0');
      if (process.env.GALLERY_TRACE_H && Number(process.env.GALLERY_TRACE_H) !== h) continue;
      for (let w = 1400; w >= 420; w -= 3) await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      for (let w = 420; w <= 1400; w += 3) await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      await delay(400);
      const frames = await evaluate('window.__frames.slice()');
      const changes = []; const calcChanges = []; let blips = 0; let clipFrames = 0;
      for (let i = 1; i < frames.length; i++) {
        if (frames[i].structure !== frames[i - 1].structure) changes.push(`${frames[i].w}:${frames[i - 1].structure}->${frames[i].structure}`);
        if (i < frames.length - 1 && frames[i].structure !== frames[i - 1].structure && frames[i + 1].structure === frames[i - 1].structure) blips++;
        if (frames[i].clipped || frames[i].underToolbar) clipFrames++;
        if (frames[i].calc !== frames[i - 1].calc) calcChanges.push(`${frames[i].w}:${frames[i - 1].calc}->${frames[i].calc}`);
      }
      const mismatch = frames.filter(f => f.calc !== 'n/a' && Number(f.calc.split('x')[0]) !== f.domMaxCols).length;
      if (process.env.GALLERY_TRACE) console.log(frames.map(f => [f.w, f.calc, f.structure, f.sizes, f.clipped, f.underToolbar].join(' ')).join('\n'));
      const r = { h, frames: frames.length, domStructureChanges: changes.length, domChanges: changes.slice(0, 10), calcChanges: calcChanges.length, calcSample: calcChanges.slice(0, 8), reversalBlips: blips, framesClippedOrUnderToolbar: clipFrames, clippedOnly: frames.filter(f => f.clipped).length, underToolbarOnly: frames.filter(f => f.underToolbar).length, framesWhereDomDiffersFromCalc: mismatch, errors: await evaluate('window.__errors.slice(0,3)') };
      console.log(JSON.stringify(r));
      runs.push(r);
    }
    results.frames = runs;
  }
  if (MODE === 'sweep') {
    const outDir = process.env.GALLERY_OUT || path.join(os.tmpdir(), 'gallery-results');
    fs.mkdirSync(outDir, { recursive: true });
    // Horizontal shrink then expand across the 1-row / 2-row boundary, slow (2px) steps.
    const h = 800;
    const shrink = []; for (let w = 1280; w >= 480; w -= 2) shrink.push([w, h]);
    const expand = []; for (let w = 480; w <= 1280; w += 2) expand.push([w, h]);
    results.horizontal = await sweep('horizontal shrink+expand, 3 cards, slow 2px', [...shrink, ...expand]);
    // Diagonal: width and height change together.
    const diag = []; for (let i = 0; i <= 200; i++) diag.push([1280 - i * 3, 800 - i * 2]);
    for (let i = 200; i >= 0; i--) diag.push([1280 - i * 3, 800 - i * 2]);
    results.diagonal = await sweep('diagonal shrink+expand, 3 cards', diag);
    // Fast back-and-forth jitter around one width.
    const jitter = []; for (let i = 0; i < 80; i++) jitter.push([i % 2 ? 760 : 740, h]);
    results.jitter = await sweep('fast 20px back-and-forth at 740/760', jitter);
    // Vertical: height changes at fixed width, slow steps.
    const vertical = []; for (let hh = 900; hh >= 380; hh -= 2) vertical.push([1100, hh]);
    for (let hh = 380; hh <= 900; hh += 2) vertical.push([1100, hh]);
    results.vertical = await sweep('vertical shrink+expand at 1100 wide, 2px', vertical);
    // Boundary: repeated 1px movements straddling the horizontal switch point.
    const boundary = []; for (let i = 0; i < 120; i++) boundary.push([i % 3 === 0 ? 700 : i % 3 === 1 ? 701 : 699, 800]);
    results.boundary = await sweep('repeated 1px movements around the 2-row boundary', boundary);
    fs.writeFileSync(path.join(outDir, 'sweep-' + Date.now() + '.json'), JSON.stringify(results, null, 1));
  }
  const settle = () => evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 60))))');
  // Keep r1 (video) and r2 (avatar); add or remove the others so the gallery holds n cards including local.
  const setRemotes = async (n) => {
    const current = await evaluate('[...window.__room.participants.keys()]');
    const extras = current.filter(id => id !== 'r1' && id !== 'r2');
    const surplus = (await evaluate('window.__room.participants.size')) - (n - 1);
    for (const id of extras.slice(0, Math.max(0, surplus))) await evaluate(`window.__fake.leaveRemote('${id}')`);
    for (let i = 3; (await evaluate('window.__room.participants.size')) < n - 1; i++) {
      await evaluate(`window.__fake.joinRemote('r${i}', 'Guest ${i}', ${i % 4 === 0})`);
    }
    await until(`document.querySelectorAll('[data-gallery-cell]').length === ${n}`, 80).catch(() => {});
    await settle();
  };
  const viewports = [[1280, 800], [960, 700], [1600, 900], [700, 900], [520, 760]];
  const chatButton = "[...document.querySelectorAll('button')].find(b => b.title === 'Chat with everyone')";

  if (MODE === 'counts') {
    const rows = [];
    for (const n of [4, 6, 9, 10, 12, 15, 16, 20, 24, 30, 35, 42]) {
      await setRemotes(n);
      for (const [w, h] of viewports) {
        await setViewport(w, h); await settle();
        const m = await evaluate(MEASURE);
        const ok = m.clipped === 0 && m.underToolbar === 0 && m.cards === n
          && m.domMaxCols === Number(String(m.calc).split('x')[0]) && m.maxCentreErr < 1.5 && m.localVideoSame !== false;
        rows.push({ n, w, h, ok, cards: m.cards, structure: m.structure, calc: m.calc, clipped: m.clipped, underToolbar: m.underToolbar, centreErr: Math.round(m.maxCentreErr * 10) / 10, localVideoSame: m.localVideoSame, sizes: m.sizes });
      }
    }
    const failing = rows.filter(r => !r.ok);
    console.log(JSON.stringify({ label: 'participant counts x viewports', checks: rows.length, failing: failing.length, failingSample: failing.slice(0, 8), errors: await evaluate('window.__errors.slice(0,5)') }));
    results.counts = rows;
  }

  // A side panel or a pinned stage replaces the gallery with the speaker layout (no .tw-grid). The gallery must
  // come back correctly sized when the panel closes or the pin is removed.
  const pack = m => (m ? [m.structure, m.clipped, m.underToolbar, m.calc, m.cards] : 'no-gallery');
  if (MODE === 'panel') {
    await setRemotes(3);
    const out = [];
    for (const [w, h] of [[1280, 800], [1024, 700], [1400, 760]]) {
      await setViewport(w, h); await settle();
      const before = await evaluate(MEASURE);
      await evaluate(`${chatButton}?.click()`); await settle(); await settle();
      const whileOpen = await evaluate(MEASURE);
      await evaluate(`${chatButton}?.click()`); await settle(); await settle();
      const closed = await evaluate(MEASURE);
      out.push({ w, h, before: pack(before), whileOpen: pack(whileOpen), closed: pack(closed), centreErr: closed ? Math.round(closed.maxCentreErr * 10) / 10 : null });
    }
    const ok = out.every(o => o.closed !== 'no-gallery' && o.closed[1] === 0 && o.closed[2] === 0 && o.closed[4] === 3 && o.closed[0] === o.before[0]);
    console.log(JSON.stringify({ label: 'chat panel open/close', ok, out, errors: await evaluate('window.__errors.slice(0,5)') }));
    results.panel = out;
  }

  if (MODE === 'pin') {
    // Pin and unpin a participant from the filmstrip control; the gallery must return after the unpin.
    await setRemotes(4);
    await setViewport(1280, 800); await settle();
    const before = await evaluate(MEASURE);
    await evaluate(`[...document.querySelectorAll('button')].find(b => b.title === 'Pin Alice')?.click()`);
    await settle(); await settle();
    const whilePinned = await evaluate(MEASURE);
    if (process.env.GALLERY_DEBUG) console.log('DEBUG pinned titles', await evaluate('[...document.querySelectorAll("button[title]")].map(b => b.title).join(" | ")'), await evaluate('document.body.innerText.slice(0,200)'));
    const unpinTitle = await evaluate(`[...document.querySelectorAll('button')].some(b => b.title === 'Unpin Alice')`);
    await evaluate(`[...document.querySelectorAll('button')].find(b => b.title === 'Unpin Alice')?.click()`);
    await settle(); await settle();
    const after = await evaluate(MEASURE);
    const r = { before: pack(before), whilePinned: pack(whilePinned), unpinControlShownWhilePinned: unpinTitle, afterUnpin: pack(after), errors: await evaluate('window.__errors.slice(0,5)') };
    console.log(JSON.stringify({ label: 'pin/unpin', ...r }));
    results.pin = r;
  }

  if (MODE === 'mobile') {
    await setRemotes(3);
    const out = [];
    for (const [w, h] of [[390, 844], [844, 390], [767, 1024], [768, 1024], [769, 1024]]) {
      await setViewport(w, h); await settle();
      const m = await evaluate(MEASURE);
      out.push({ w, h, structure: m.structure, calc: m.calc, clipped: m.clipped, underToolbar: m.underToolbar, cards: m.cards, centreErr: Math.round(m.maxCentreErr * 10) / 10, sizes: m.sizes });
    }
    console.log(JSON.stringify({ label: 'mobile and breakpoint crossings', out, errors: await evaluate('window.__errors.slice(0,5)') }));
    results.mobile = out;
  }

  if (MODE === 'remount') {
    await setRemotes(3);
    await setViewport(1280, 800); await settle();
    await evaluate(MEASURE);
    await evaluate('window.__created0 = window.__videoCreated');
    for (let round = 0; round < 3; round++) {
      for (let w = 1280; w >= 480; w -= 20) await send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 1, mobile: false });
      for (let w = 480; w <= 1280; w += 20) await send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 1, mobile: false });
    }
    await settle();
    const r = {
      videoElementsCreatedDuringResizes: await evaluate('window.__videoCreated - window.__created0'),
      localVideoSameNode: await evaluate('window.__probeVideo === document.querySelector(\'[data-gallery-cell="local"] video\') && window.__probeVideo.isConnected'),
      errors: await evaluate('window.__errors.slice(0,5)'),
    };
    console.log(JSON.stringify({ label: 'no video remounts during resize', ...r }));
    results.remount = r;
  }

  if (MODE === 'animation') {
    // Count explicit cancellations of Web Animations on the cells. Ordinary size updates must cancel nothing;
    // a structure change animates; an interrupted slide finishes or is superseded with no stray animations left.
    await evaluate(`window.__cancels = 0; const __cancel = Animation.prototype.cancel;
      Animation.prototype.cancel = function () { window.__cancels++; return __cancel.call(this); };`);
    await setRemotes(3);
    await setViewport(1280, 800); await settle();
    const steady0 = await evaluate('window.__cancels');
    for (let w = 1280; w >= 1240; w -= 2) await send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 1, mobile: false });
    await settle();
    const ordinaryCancels = (await evaluate('window.__cancels')) - steady0;
    // Structure change (3 in a row -> 2 above, 1 below), then keep resizing while it is still running.
    await setViewport(640, 800); await settle();
    const startedAnimations = await evaluate('document.getAnimations().length');
    for (let w = 640; w >= 600; w -= 2) await send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 1, mobile: false });
    await evaluate('new Promise(r => setTimeout(r, 400))');
    const leftAfterDone = await evaluate('document.getAnimations().length');
    const r = { ordinaryResizeCancels: ordinaryCancels, animationsStartedByStructureChange: startedAnimations, animationsLeftAfter400ms: leftAfterDone, errors: await evaluate('window.__errors.slice(0,5)') };
    console.log(JSON.stringify({ label: 'animation contract', ...r }));
    results.animation = r;
  }

  if (MODE === 'chat') {
    await setRemotes(1);
    await setViewport(1280, 800); await settle();
    const chatButton = "[...document.querySelectorAll('button')].find(b => b.title === 'Chat with everyone')";

    await evaluate(`${chatButton}?.click()`);
    await until('!!document.querySelector(\'input[placeholder="Send a message..."]\')');
    const inputSelector = "document.querySelector('input[placeholder=\"Send a message...\"]')";

    await evaluate(`
      (() => {
        const el = ${inputSelector};
        el.focus();
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(el, 'hello from the test');
        el.dispatchEvent(new Event('input', { bubbles: true }));
      })()
    `);
    const inputValueBeforeSend = await evaluate(`${inputSelector}.value`);

    await evaluate(`${inputSelector}.closest('form').requestSubmit()`);
    await until('document.body.innerText.includes("hello from the test")');
    const inputValueAfterSend = await evaluate(`${inputSelector}.value`);
    const messageVisible = await evaluate('document.body.innerText.includes("hello from the test")');

    // Close and reopen the panel -- chatMessages must survive (it lives on the page, not inside
    // the conditionally-mounted ChatPanel), confirming the close-mid-state design decision holds.
    await evaluate(`${chatButton}?.click()`);
    await settle();
    const hiddenWhileClosed = !(await evaluate('document.body.innerText.includes("hello from the test")'));

    await evaluate(`${chatButton}?.click()`);
    await until('document.body.innerText.includes("hello from the test")');
    const messageSurvivedReopen = await evaluate('document.body.innerText.includes("hello from the test")');

    const r = {
      inputValueBeforeSend, inputValueAfterSend, messageVisible, hiddenWhileClosed, messageSurvivedReopen,
      errors: await evaluate('window.__errors.slice(0,5)'),
    };

    console.log(JSON.stringify({ label: 'chat panel send + history-across-close', ...r }));
    results.chat = r;
  }

  if (MODE === 'devicemenu') {
    await setRemotes(1);
    await setViewport(1280, 800); await settle();

    const micChevron = "document.querySelector('button[title=\"Select microphone\"]')";
    const camChevron = "document.querySelector('button[title=\"Select camera\"]')";

    await evaluate(`${micChevron}.click()`);
    await settle();
    const micMenuOpenAfterClick = await evaluate('document.body.innerText.includes("Test microphone")');
    const micMenuHeaderVisible = await evaluate('document.body.innerText.includes("MICROPHONE")');

    // Opening the camera menu should close the mic menu (mutual exclusivity) -- this is the
    // setShowVideoMenu(false)/setShowAudioMenu(false) cross-close behavior preserved verbatim
    // from the original inline JSX into onOpenAudioMenu/onOpenVideoMenu.
    await evaluate(`${camChevron}.click()`);
    await settle();
    const camMenuOpenAfterClick = await evaluate('document.body.innerText.includes("Test camera")');
    const micMenuClosedWhenCamOpens = !(await evaluate('document.body.innerText.includes("Test microphone")'));

    await evaluate(`${camChevron}.click()`);
    await settle();
    const camMenuClosedOnSecondClick = !(await evaluate('document.body.innerText.includes("Test camera")'));

    const micButton = "document.querySelector('button[title*=\"microphone (M)\"]')";
    const titleBefore = await evaluate(`${micButton}?.title`);
    await evaluate(`${micButton}.click()`);
    await settle();
    const titleAfter = await evaluate(`${micButton}?.title`);
    const muteToggleStillWorks = titleAfter !== titleBefore;

    const r = {
      micMenuOpenAfterClick, micMenuHeaderVisible, camMenuOpenAfterClick, micMenuClosedWhenCamOpens,
      camMenuClosedOnSecondClick, muteToggleStillWorks, titleBefore, titleAfter,
      errors: await evaluate('window.__errors.slice(0,5)'),
    };

    console.log(JSON.stringify({ label: 'device menu open/close/mutual-exclusion + mute toggle', ...r }));
    results.devicemenu = r;
  }

  if (MODE === 'captions') {
    await setRemotes(1);
    await setViewport(1280, 800); await settle();
    const captionsButton = "document.querySelector('button[title*=\"captions\"]')";

    const titleBefore = await evaluate(`${captionsButton}?.title`);
    await evaluate(`${captionsButton}.click()`);
    await settle();
    const titleAfterOn = await evaluate(`${captionsButton}?.title`);
    // Headless Chrome via CDP typically has no working SpeechRecognition backend (no mic, no
    // speech service), so this checks the overlay mounts and shows ONE of its two defined states
    // (the "Listening..." placeholder, or the "not supported in this browser" warning) rather than
    // asserting real transcribed text -- actual speech-to-text isn't something this harness can
    // drive without a real microphone and network speech service.
    const overlayMounted = await evaluate('document.body.innerText.includes("Listening") || document.body.innerText.includes("Live captions are not supported")');

    await evaluate(`${captionsButton}.click()`);
    await settle();
    const titleAfterOff = await evaluate(`${captionsButton}?.title`);
    const overlayGoneAfterOff = !(await evaluate('document.body.innerText.includes("Listening") || document.body.innerText.includes("Live captions are not supported")'));

    const r = {
      titleBefore, titleAfterOn, titleAfterOff, overlayMounted, overlayGoneAfterOff,
      errors: await evaluate('window.__errors.slice(0,5)'),
    };

    console.log(JSON.stringify({ label: 'captions toggle + overlay mount/unmount', ...r }));
    results.captions = r;
  }

  if (MODE === 'toolbar') {
    await setRemotes(3);
    for (const [w, h] of [[700, 800], [1280, 800], [1280, 600]]) {
      await setViewport(w, h); await settle();
      console.log('stageNodeCount:', await evaluate("document.querySelectorAll('[data-gallery-stage]').length"));
    console.log('refCalls:', await evaluate('window.__stageRefCalls'), await evaluate('JSON.stringify(window.__stageRefCallsLog)'));
    await evaluate(`
      window.__externalRoFired = 0;
      window.__externalRo = new ResizeObserver(() => { window.__externalRoFired++; });
      window.__externalRo.observe(document.querySelector('[data-gallery-stage]'));
    `);
    console.log('roFired:', await evaluate('window.__roFired'));
    console.log('externalRoFired:', await evaluate('window.__externalRoFired'));
    console.log('commits after 960x700:', await evaluate('window.__stageCommits'), await evaluate('JSON.stringify(window.__lastStageCommit)'));
    const info = await evaluate(`(() => { const st = document.querySelector('[data-gallery-stage]').getBoundingClientRect(); const tb = document.querySelector('.tw-toolbar').getBoundingClientRect(); const cells = [...document.querySelectorAll('[data-gallery-cell]')].map(c => c.getBoundingClientRect().bottom); return { stageBottom: Math.round(st.bottom), toolbarTop: Math.round(tb.top), toolbarBottom: Math.round(tb.bottom), toolbarHeight: Math.round(tb.height), lowestCardBottom: Math.round(Math.max(...cells)), viewportH: innerHeight }; })()`);
      console.log(JSON.stringify({ label: 'toolbar geometry', w, h, ...info }));
    }
  }

  if (MODE === 'edges') {
    await setRemotes(3);
    await setViewport(701, 800); await settle();
    console.log('stageNodeCount:', await evaluate("document.querySelectorAll('[data-gallery-stage]').length"));
    console.log('refCalls:', await evaluate('window.__stageRefCalls'), await evaluate('JSON.stringify(window.__stageRefCallsLog)'));
    await evaluate(`
      window.__externalRoFired = 0;
      window.__externalRo = new ResizeObserver(() => { window.__externalRoFired++; });
      window.__externalRo.observe(document.querySelector('[data-gallery-stage]'));
    `);
    console.log('roFired:', await evaluate('window.__roFired'));
    console.log('externalRoFired:', await evaluate('window.__externalRoFired'));
    console.log('commits after 960x700:', await evaluate('window.__stageCommits'), await evaluate('JSON.stringify(window.__lastStageCommit)'));
    const info = await evaluate(`(() => { const st = document.querySelector('[data-gallery-stage]'); const sr = st.getBoundingClientRect(); return { stage: [sr.left, sr.right, sr.top, sr.bottom, st.clientWidth, st.clientHeight], cells: [...st.querySelectorAll('[data-gallery-cell]')].map(c => [c.offsetLeft, c.offsetTop, c.offsetWidth, c.offsetHeight, c.style.left, c.style.top, c.style.width, c.getBoundingClientRect().right.toFixed(3)]) }; })()`);
    console.log(JSON.stringify({ label: 'edges at 701x800', ...info }));
  }

  console.log('DONE', MODE);
  ws.close(); chrome.kill();
  await delay(500);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still hold the profile */ }
}

main().catch(err => { console.error('FAIL', err.message); try { chrome?.kill(); } catch { /* ignore */ } process.exitCode = 1; });

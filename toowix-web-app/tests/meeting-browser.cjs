/* Local Chromium regression: real React/router, simulated media and Jitsi/API services. */
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const WebSocket = require('../../node_modules/ws');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(root, '.browser-test-'));
let chrome, server, ws;
const pending = new Map(); let id = 0;
const delay = ms => new Promise(r => setTimeout(r, ms));
async function send(method, params = {}) {
  return new Promise((resolve, reject) => { const requestId = ++id; pending.set(requestId, { resolve, reject }); ws.send(JSON.stringify({ id: requestId, method, params })); });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
async function until(expression) {
  for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await delay(100); }
  throw new Error(`Timed out: ${expression}; page=${await evaluate('JSON.stringify({url:location.href,text:document.body?.innerText,errors:window.__errors})')}`);
}
const injected = `
window.__errors = []; window.addEventListener('error', e => window.__errors.push(e.message));
window.__requests = []; window.__disposed = 0;
localStorage.setItem('toowix_user', JSON.stringify({ name:'StaleAdmin', role:'SUPER_ADMIN', id:'forged' }));
localStorage.setItem('toowix_jitsi_jwt', 'stale-meeting-token');
const meeting = { type:'Guest', organizerId:'host', accessAllowed:true, recordingEnabled:false, autoRecording:false, allowScreenShare:true, micLockEnabled:false };
const originalFetch = window.fetch;
window.fetch = async (url, options = {}) => {
  if (String(url).includes('/api/meetings/room/')) {
    window.__requests.push({url:String(url),body:options.body,headers:options.headers});
    if (window.__failAdmission && String(url).endsWith('/admission')) return new Response(JSON.stringify({ error:'Meeting cancelled' }), {status:403});
    return new Response(JSON.stringify(String(url).endsWith('/admission') ? { meeting, jitsiToken:'test-room-credential', attendanceToken:'attendance-credential', participantEntryId:'entry', moderator:false, participation:'guest' } : {meeting}), {status:200});
  }
  return originalFetch(url, options);
};
Object.defineProperty(navigator, 'mediaDevices', { value: {
  getUserMedia: async constraints => {
    if (constraints.video) throw new DOMException('Camera unavailable', 'NotAllowedError');
    const context = new AudioContext(); const destination = context.createMediaStreamDestination();
    window.__previewTrack = destination.stream.getAudioTracks()[0];
    return destination.stream;
  },
  enumerateDevices: async () => [{kind:'audioinput',deviceId:'mic-one',label:'Test microphone'}, {kind:'audiooutput',deviceId:'speaker-one',label:'Test speakers'}],
  addEventListener() {}, removeEventListener() {}
}});
window.JitsiMeetExternalAPI = class {
  constructor(domain, options) { window.__api = this; this.options = options; this.listeners = {}; options.parentNode.textContent = 'Simulated conference'; }
  addListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  removeListener(name, fn) { this.listeners[name] = (this.listeners[name] || []).filter(x => x !== fn); }
  emit(name, data = {}) { for (const fn of [...(this.listeners[name] || [])]) fn(data); }
  isAudioMuted() { return Promise.resolve(false); }
  setAudioInputDevice() { return Promise.resolve(); } setVideoInputDevice() { return Promise.resolve(); } setAudioOutputDevice() { return Promise.resolve(); }
  executeCommand(name) { if (name === 'hangup') this.emit('readyToClose'); }
  dispose() { window.__disposed++; }
};
`;
(async () => {
  server = http.createServer((req, res) => {
    const requested = path.resolve(root, 'dist', '.' + new URL(req.url, 'http://localhost').pathname);
    const dist = path.join(root, 'dist');
    const file = requested.startsWith(dist + path.sep) && fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : path.join(dist, 'index.html');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  chrome = spawn(process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide:true, stdio:'ignore' });
  let port;
  for(let i=0;i<100;i++) { try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; break; } catch {} await delay(100); }
  if (!port) throw new Error('Chrome did not start');
  const tabs = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
  ws = new WebSocket(tabs.find(tab => tab.type === 'page' && tab.url === 'about:blank').webSocketDebuggerUrl);
  await new Promise(resolve => ws.once('open',resolve));
  ws.on('message', raw => { const data = JSON.parse(raw); if (data.id && pending.has(data.id)) { const p = pending.get(data.id); pending.delete(data.id); data.error ? p.reject(new Error(data.error.message)) : p.resolve(data.result); } });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: injected });
  const navigate = async route => { await send('Page.navigate',{url:base+route}); await until('document.readyState === "complete"'); };
  for (const route of ['/dashboard', '/settings/profile', '/settings/security']) {
    await navigate(route); await until('location.pathname === "/login"');
    assert.equal(await evaluate('document.body.innerText.includes("StaleAdmin")'),false);
  }
  console.log('PASS guest direct dashboard/settings URLs reject stale cache');
  await navigate('/home'); await until('document.body.innerText.includes("New Meeting")');
  await evaluate(`history.pushState({}, '', '/meet/test-room?jwt=do-not-share'); window.dispatchEvent(new PopStateEvent('popstate'));`);
  await until('document.body.innerText.includes("Ready to join?") && !document.body.innerText.includes("Checking meeting access")');
  assert.equal(await evaluate('location.search'), '');
  assert.equal(await evaluate('document.body.innerText.includes("StaleAdmin")'),false);
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Other ways to join')).click()`);
  await until('document.body.innerText.includes("Shareable Room URL")');
  assert.equal(await evaluate('document.body.innerText.includes("do-not-share")'), false);
  assert.equal(await evaluate('document.body.innerText.includes("/meet/test-room")'), true);
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Close').click()`);
  console.log('PASS clean share URL and explicit guest identity');
  await until('document.body.innerText.includes("You can join with audio only")');
  await evaluate(`window.__failAdmission = true; [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Join Meeting').click()`);
  await until('document.body.innerText.includes("Meeting cancelled")');
  assert.equal(await evaluate('!!window.__api'), false);
  await evaluate(`window.__failAdmission = false; [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Join Meeting').click()`);
  await until('!!window.__api');
  assert.equal(await evaluate('window.__api.options.configOverwrite.startWithVideoMuted'),true);
  assert.equal(await evaluate('window.__api.options.configOverwrite.startWithAudioMuted'),false);
  assert.equal(await evaluate('window.__previewTrack.readyState'),'ended');
  await evaluate(`window.__api.emit('videoConferenceJoined',{id:'local'}); window.__api.emit('participantKickedOut',{kicked:{id:'remote'}});`);
  assert.equal(await evaluate('location.pathname'),'/meet/test-room');
  await evaluate(`window.__api.emit('audioMuteStatusChanged',{muted:true}); window.__api.emit('recordingStatusChanged',{on:true});`);
  await until('document.body.innerText.includes("Recording: on")');
  console.log('PASS failed admission blocks iframe; camera denial allows audio; remote removal does not exit');
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Exit Meeting')).click(); window.__api.emit('readyToClose'); window.__api.emit('videoConferenceLeft');`);
  await until('location.pathname === "/meeting-ended"');
  assert.equal(await evaluate('document.body.innerText.includes("Thank you for joining")'), true);
  await until('window.__requests.filter(r => r.url.endsWith("/attendance/leave")).length === 1');
  assert.equal(await evaluate('window.__disposed'),1);
  const history = await send('Page.getNavigationHistory');
  assert.equal(history.entries[history.currentIndex].url, base+'/meeting-ended');
  assert.equal(history.entries.some(x => x.url.includes('/meet/test-room')), false);
  await send('Page.reload'); await until('document.body.innerText.includes("Thank you for joining")');
  console.log('PASS idempotent exit, history replacement and ended-page refresh');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (ws?.readyState === 1) { try { await send('Browser.close'); } catch {} ws.close(); }
  if (chrome && chrome.exitCode === null) { chrome.kill(); await new Promise(resolve => { chrome.once('exit', resolve); setTimeout(resolve, 2000); }); }
  if (server) await new Promise(resolve => server.close(resolve));
  // Only this disposable profile under the project is removed.
  if (path.resolve(profile).startsWith(root + path.sep + '.browser-test-')) { try { fs.rmSync(profile, {recursive:true,force:true,maxRetries:5,retryDelay:200}); } catch {} }
});

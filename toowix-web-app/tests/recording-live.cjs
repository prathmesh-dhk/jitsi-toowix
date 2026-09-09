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
  return new Promise((resolve, reject) => { const requestId = ++id; const timer=setTimeout(()=>{pending.delete(requestId);reject(new Error('CDP timeout: '+method));},15000); pending.set(requestId, { resolve:value=>{clearTimeout(timer);resolve(value)}, reject:error=>{clearTimeout(timer);reject(error)} }); ws.send(JSON.stringify({ id: requestId, method, params })); });
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
(async () => {
  const remoteContext = await new Promise((resolve, reject) => {
    const ssh = spawn('C:\\Windows\\System32\\OpenSSH\\ssh.exe', ['-o','BatchMode=yes','root@192.168.22.59','docker exec -i toowix-backend node'], { windowsHide:true, stdio:['pipe','pipe','pipe'] });
    let output=''; ssh.stdout.on('data',chunk=>output+=chunk); ssh.stderr.on('data',()=>{});
    ssh.on('exit',code=> { if(code) return reject(new Error('Could not prepare live test')); const line=output.split('\n').find(x=>x.startsWith('TEST_CONTEXT ')); if(!line)return reject(new Error('No test context')); resolve(JSON.parse(line.slice(13))); });
    ssh.stdin.end(fs.readFileSync(path.join(__dirname,'recording-live-context.js'),'utf8'));
  });
  server = http.createServer((req,res)=>{
    res.setHeader('Content-Type','text/html');
    res.end('<!doctype html><title>Toowix Recording Verification</title><div id="clock"></div><div id="meet" style="height:90vh"></div><script src="https://talk.toowix.com/external_api.js"></script><script>setInterval(()=>document.getElementById("clock").textContent="Screen content verification "+new Date().toISOString(),1000)</script>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  chrome = spawn(process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--disable-gpu', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture='+path.join(__dirname,'recording-test-tone.wav'), '--auto-select-tab-capture-source-by-title=Toowix Recording Verification', '--allow-http-screen-capture', '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide:true, stdio:'ignore' });
  let port;
  for(let i=0;i<100;i++) { try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; break; } catch {} await delay(100); }
  if (!port) throw new Error('Chrome did not start');
  const tabs = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
  ws = new WebSocket(tabs.find(tab => tab.type === 'page' && tab.url === 'about:blank').webSocketDebuggerUrl);
  await new Promise(resolve => ws.once('open',resolve));
  ws.on('message', raw => { const data = JSON.parse(raw); if (data.id && pending.has(data.id)) { const p = pending.get(data.id); pending.delete(data.id); data.error ? p.reject(new Error(data.error.message)) : p.resolve(data.result); } });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate',{url:base}); await until('!!window.JitsiMeetExternalAPI');
  const create = (token, guest) => `window.events=[]; window.api=new JitsiMeetExternalAPI('talk.toowix.com',{roomName:${JSON.stringify(remoteContext.room)},jwt:${JSON.stringify(token)},parentNode:document.getElementById('meet'),configOverwrite:{prejoinConfig:{enabled:false},startWithAudioMuted:${guest},startWithVideoMuted:false,p2p:{enabled:false}},userInfo:{displayName:${JSON.stringify(guest?'Verification B':'Verification A')}}}); ['videoConferenceJoined','recordingStatusChanged','screenSharingStatusChanged','errorOccurred'].forEach(name=>api.addListener(name,data=>events.push({name,on:data.on,error:data.error?.name||data.name,time:Date.now()})));`;
  await evaluate(create(remoteContext.hostToken,false));
  await until('events.some(e=>e.name==="videoConferenceJoined")');
  console.log('Host joined',remoteContext.room);
  const hostSocket=ws;
  const target=await send('Target.createTarget',{url:base});
  const allTabs=await(await fetch('http://127.0.0.1:'+port+'/json')).json();
  const guestTab=allTabs.find(t=>t.id===target.targetId);
  ws=new WebSocket(guestTab.webSocketDebuggerUrl); await new Promise(resolve=>ws.once('open',resolve));
  ws.on('message',raw=>{const data=JSON.parse(raw);if(data.id&&pending.has(data.id)){const p=pending.get(data.id);pending.delete(data.id);data.error?p.reject(new Error(data.error.message)):p.resolve(data.result);}});
  await send('Runtime.enable');await until('!!window.JitsiMeetExternalAPI');await evaluate(create(remoteContext.guestToken,true));await until('events.some(e=>e.name==="videoConferenceJoined")');
  const guestSocket=ws;ws=hostSocket;
  console.log('Second participant joined; starting real Jibri recording');
  await evaluate(`api.executeCommand('startRecording',{mode:'file'})`);
  await until('events.some(e=>e.name==="recordingStatusChanged"&&e.on)');
  console.log('Recording confirmed active');
  const activeSince=Date.now();
  await evaluate(`api.executeCommand('toggleShareScreen')`);
  let screenShared=false;
  try {await until('events.some(e=>e.name==="screenSharingStatusChanged"&&e.on)');screenShared=true;console.log('Screen sharing confirmed');}catch{console.log('Screen sharing did not confirm; continuing media recording verification');}
  for(let i=0;i<13;i++) await delay(5000);
  if(screenShared){await evaluate(`api.executeCommand('toggleShareScreen')`);await until('events.some(e=>e.name==="screenSharingStatusChanged"&&!e.on)');console.log('Screen stopped; microphone recording continues');}
  await delay(Math.max(0,130000-(Date.now()-activeSince)));
  await evaluate(`api.executeCommand('stopRecording','file')`);
  await until('events.some(e=>e.name==="recordingStatusChanged"&&!e.on)');
  console.log('Recording stopped after',Math.round((Date.now()-activeSince)/1000),'seconds');
  const events=await evaluate('events');
  fs.writeFileSync(path.join(__dirname,'recording-live-result.json'),JSON.stringify({room:remoteContext.room,screenShared,events},null,2));
  await evaluate(`api.executeCommand('hangup');api.dispose()`);
  ws=guestSocket;await evaluate(`api.executeCommand('hangup');api.dispose()`);guestSocket.close();ws=hostSocket;
  console.log('Live recording complete; final media still requires probe/playback verification');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (ws?.readyState === 1) { try { await send('Browser.close'); } catch {} ws.close(); }
  if (chrome && chrome.exitCode === null) { chrome.kill(); await new Promise(resolve => { chrome.once('exit', resolve); setTimeout(resolve, 2000); }); }
  if (server) await new Promise(resolve => server.close(resolve));
  // Only this disposable profile under the project is removed.
  if (path.resolve(profile).startsWith(root + path.sep + '.browser-test-')) { try { fs.rmSync(profile, {recursive:true,force:true,maxRetries:5,retryDelay:200}); } catch {} }
});

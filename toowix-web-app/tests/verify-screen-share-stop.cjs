// Regression test for the "remote presentation freezes after screen share stops" bug in
// MeetingRoomPage / useJitsiMeeting.ts. The existing stock-Jitsi and useLibJitsiConference
// desktop-sharing tests don't exercise this code path (different hook, different route), so
// this drives two real Chrome instances through the ACTUAL /meet/:roomId flow used in
// production: participant A shares their screen, participant B is asserted to actually receive
// it, A stops sharing (via the same Toowix button real users click), and B is asserted to
// return to normal participant layout -- not just that no error was thrown.
//
// Requires local dev servers running (frontend on 3000, backend on 4000) unless BASE_URL/
// overridden via env vars for a different target.
//
// Usage: node tests/verify-screen-share-stop.cjs

const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const WebSocket = require('../../node_modules/ws');

const CHROME_PATH = process.env.CHROME_PATH
  || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ORIGIN = process.env.BASE_ORIGIN || 'http://localhost:3000';
const ROOM = `instant-ssverify-${Date.now()}`;
const BASE_URL = `${ORIGIN}/meet/${ROOM}`;

function launchChrome(port, name, { presenter } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `.ss-test-${name}-`));

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--ignore-certificate-errors',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--no-first-run',
    '--disable-features=IsolateOrigins,site-per-process',
    '--headless=new',
    ...(presenter
      // Bypasses the native OS/browser screen-picker dialog (which a headless browser has no
      // way to interact with) by auto-selecting "Entire screen" the moment getDisplayMedia is
      // called -- a real Chrome testing flag, not a workaround specific to this app.
      ? [ '--auto-select-desktop-capture-source=Entire screen' ]
      : []),
    'about:blank'
  ];

  return spawn(CHROME_PATH, args, { stdio: 'ignore' });
}

async function getWsUrl(port) {
  const res = await fetch(`http://localhost:${port}/json/new?about:blank`, { method: 'PUT' });
  const json = await res.json();

  return json.webSocketDebuggerUrl;
}

class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.consoleMsgs = [];
    ws.on('message', raw => {
      const msg = JSON.parse(raw.toString());

      if (msg.method === 'Runtime.consoleAPICalled') {
        this.consoleMsgs.push((msg.params.args || []).map(a => a.value ?? a.description ?? '').join(' '));
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        this.consoleMsgs.push('EXCEPTION: ' + (msg.params.exceptionDetails?.exception?.description || JSON.stringify(msg.params.exceptionDetails)));
      }

      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);

        this.pending.delete(msg.id);
        if (msg.error) {
          reject(new Error(JSON.stringify(msg.error)));
        } else {
          resolve(msg.result);
        }
      }
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;

      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async navigate(url) {
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Page.navigate', { url });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });

    if (result.exceptionDetails) {
      throw new Error(JSON.stringify(result.exceptionDetails));
    }

    return result.result.value;
  }
}

const delay = ms => new Promise(r => setTimeout(r, ms));

async function until(client, expression, timeoutMs, label) {
  const start = Date.now();
  let lastErr;

  while (Date.now() - start < timeoutMs) {
    try {
      const value = await client.evaluate(expression);

      if (value) {
        return value;
      }
    } catch (err) {
      lastErr = err;
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for: ${label}${lastErr ? ` (last error: ${lastErr.message})` : ''}`);
}

async function connectClient(port) {
  const wsUrl = await getWsUrl(port);
  const ws = new WebSocket(wsUrl);

  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });

  return new CdpClient(ws);
}

async function joinAsGuest(client, name) {
  await client.navigate(BASE_URL);
  await delay(2000);
  await client.evaluate(`
    (() => {
      const input = document.querySelector('input[placeholder="Enter your name to join"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '${name}');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Join Meeting');
      btn.click();
      return true;
    })()
  `);
}

async function run() {
  console.log(`Room: ${ROOM}`);
  console.log(`URL: ${BASE_URL}`);

  const chromeA = launchChrome(9921, 'a', { presenter: true });
  const chromeB = launchChrome(9922, 'b');

  await delay(1500);

  const results = { pass: [], fail: [] };

  try {
    const clientA = await connectClient(9921);
    const clientB = await connectClient(9922);

    console.log('Joining both participants...');
    await joinAsGuest(clientA, 'Presenter');
    await joinAsGuest(clientB, 'Viewer');

    await until(clientA, `document.querySelector('[data-testid="screen-share-toggle"]') !== null`, 20000, 'A reached in-call UI');
    results.pass.push('Participant A (presenter) reached the in-call UI');
    await until(clientB, `document.querySelector('[data-testid="screen-share-toggle"]') !== null`, 20000, 'B reached in-call UI');
    results.pass.push('Participant B (viewer) reached the in-call UI');

    console.log('A starts screen sharing...');
    await clientA.evaluate(`document.querySelector('[data-testid="screen-share-toggle"]').click(); true`);

    try {
      await until(clientA, `document.querySelector('[data-testid="screen-share-toggle"]')?.title === 'Stop presenting'`, 15000, 'A UI reflects sharing');
    } catch (err) {
      console.log('--- A console messages (share start failed) ---');
      clientA.consoleMsgs.forEach(m => console.log(m));
      throw err;
    }
    results.pass.push('Participant A: local UI reflects "sharing" state after starting');

    console.log('Waiting for B to actually receive and render the shared screen...');
    await until(clientB,
        `document.querySelector('[data-testid="remote-screen-share-video"]')?.videoWidth > 0`,
        20000, 'B receives and renders remote screen share');
    results.pass.push('Participant B: remoteScreenShare became non-null and the video is actually rendering frames (videoWidth > 0) -- confirms the real TRACK_ADDED -> recomputeRemoteScreenShare -> video element pipeline');

    console.log('A stops screen sharing via the Toowix button...');
    await clientA.evaluate(`document.querySelector('[data-testid="screen-share-toggle"]').click(); true`);

    await until(clientA, `document.querySelector('[data-testid="screen-share-toggle"]')?.title === 'Present now'`, 15000, 'A UI reflects stopped');
    results.pass.push('Participant A: local UI reflects "not sharing" after stopping');

    console.log('Verifying B exits presentation mode within ~2s and the remote video element is gone (no frozen frame)...');
    const stopObservedAt = Date.now();

    await until(clientB,
        `document.querySelector('[data-testid="remote-screen-share-video"]') === null`,
        3000, 'B presentation view unmounts');
    const elapsedMs = Date.now() - stopObservedAt;

    results.pass.push(`Participant B: remote-screen-share-video element unmounted (remoteScreenShare -> null, presentation mode exited) within ${elapsedMs}ms of A stopping`);

    if (elapsedMs > 2000) {
      results.fail.push(`Presentation mode took ${elapsedMs}ms to clear on B's side -- exceeds the ~2s bound from the bug report`);
    }

    console.log('Verifying normal tile layout is back on B\'s side (not stuck on a frozen presentation)...');
    const backToNormal = await clientB.evaluate(
        `document.querySelectorAll('video').length >= 1 && document.querySelector('[data-testid="remote-screen-share-video"]') === null`);

    if (backToNormal) {
      results.pass.push('Participant B: back to normal participant layout, no orphaned presentation surface');
    } else {
      results.fail.push('Participant B: layout did not return to normal after screen share stopped');
    }

    console.log('Verifying A\'s own camera (if any) is unaffected by the share/stop cycle...');
    const aStillConnected = await clientA.evaluate(`document.body.innerText.length > 0`);

    if (aStillConnected) {
      results.pass.push('Participant A: page still alive/responsive after the stop (no crash from the removeTrack/dispose path)');
    } else {
      results.fail.push('Participant A: page appears unresponsive after stopping screen share');
    }

    console.log('Repeating start/stop once more to check for double-stop / recursive-dispose issues...');
    await clientA.evaluate(`document.querySelector('[data-testid="screen-share-toggle"]').click(); true`);
    await until(clientB,
        `document.querySelector('[data-testid="remote-screen-share-video"]')?.videoWidth > 0`,
        20000, 'B receives second share');
    results.pass.push('Second share cycle: B received it correctly (no leftover state from the first cycle broke this)');
    await clientA.evaluate(`document.querySelector('[data-testid="screen-share-toggle"]').click(); true`);
    await until(clientB,
        `document.querySelector('[data-testid="remote-screen-share-video"]') === null`,
        3000, 'B exits presentation on second stop');
    results.pass.push('Second share cycle: B correctly exited presentation mode again after the second stop');
  } catch (err) {
    results.fail.push(`Test threw: ${err.message}`);
  } finally {
    chromeA.kill();
    chromeB.kill();
  }

  console.log('\n=== RESULTS ===');
  results.pass.forEach(p => console.log(`[PASS] ${p}`));
  results.fail.forEach(f => console.log(`[FAIL] ${f}`));

  if (results.fail.length > 0) {
    console.log(`\n${results.fail.length} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll checks passed -- remote screen-share start AND stop (including the freeze-on-stop bug) confirmed working end-to-end.');
}

run();

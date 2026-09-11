// Automated two-participant verification for the direct lib-jitsi-meet integration
// (DirectMeetingRoomPage / useLibJitsiConference), no iframe. Drives two real Chrome
// instances with synthetic fake media devices through the actual join flow and checks that
// REAL video/audio tracks end up attached and playing on both sides -- not just that the page
// compiled or the participant count updated.
//
// Requires an SSH tunnel already forwarding the staging environment locally:
//   ssh -L 8543:localhost:8543 -L 3544:localhost:3544 -L 4544:localhost:4000 root@<server>
//
// Usage: node tests/verify-lib-jitsi-audio-video.cjs

const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const WebSocket = require('../../node_modules/ws');

const CHROME_PATH = process.env.CHROME_PATH
  || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ROOM = `instant-libverify-${Date.now()}`;
const BASE_URL = `http://localhost:3544/meet-direct/${ROOM}`;

function launchChrome(port, name) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `.lj-test-${name}-`));

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    // Test-only: the staging Jitsi domain uses a self-signed cert (real production uses a
    // valid one). A real user's browser would need to click through the warning once; a
    // headless test browser has no such prompt to click, so it needs this flag instead.
    '--ignore-certificate-errors',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--no-first-run',
    '--disable-features=IsolateOrigins,site-per-process',
    '--headless=new',
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
    ws.on('message', raw => {
      const msg = JSON.parse(raw.toString());

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

  while (Date.now() - start < timeoutMs) {
    const value = await client.evaluate(expression).catch(() => undefined);

    if (value) {
      return value;
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for: ${label}`);
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

async function run() {
  console.log(`Room: ${ROOM}`);
  console.log(`URL: ${BASE_URL}`);

  const chromeA = launchChrome(9911, 'a');
  const chromeB = launchChrome(9912, 'b');

  await delay(1500);

  let results = { pass: [], fail: [] };

  try {
    const clientA = await connectClient(9911);
    const clientB = await connectClient(9912);

    console.log('Navigating both participants to the direct meeting page...');
    await clientA.navigate(BASE_URL);
    await clientB.navigate(BASE_URL);
    await delay(2000);

    console.log('Setting display names and clicking Join...');
    for (const [ client, name ] of [ [ clientA, 'Alice' ], [ clientB, 'Bob' ] ]) {
      await client.evaluate(`
        (() => {
          const input = document.querySelector('input[placeholder="Your name"]');
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(input, '${name}');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Join');
          btn.click();
          return true;
        })()
      `);
    }

    console.log('Waiting for both to report joined...');
    await until(clientA, `document.body.innerText.includes('Joined')`, 20000, 'A joined');
    results.pass.push('Participant A reached the joined conference state');
    await until(clientB, `document.body.innerText.includes('Joined')`, 20000, 'B joined');
    results.pass.push('Participant B reached the joined conference state');

    console.log('Checking local video is actually playing on each side...');
    await until(clientA,
        `document.querySelectorAll('video')[0]?.videoWidth > 0`, 10000, 'A local video playing');
    results.pass.push('Participant A: local camera video is actually rendering (videoWidth > 0)');
    await until(clientB,
        `document.querySelectorAll('video')[0]?.videoWidth > 0`, 10000, 'B local video playing');
    results.pass.push('Participant B: local camera video is actually rendering (videoWidth > 0)');

    console.log('Checking each side actually receives the OTHER participant\'s remote video...');
    await until(clientA,
        `document.querySelectorAll('video').length >= 2 && document.querySelectorAll('video')[1]?.videoWidth > 0`,
        20000, 'A sees remote video');
    results.pass.push('Participant A: REMOTE video from B is arriving and rendering (real WebRTC video)');
    await until(clientB,
        `document.querySelectorAll('video').length >= 2 && document.querySelectorAll('video')[1]?.videoWidth > 0`,
        20000, 'B sees remote video');
    results.pass.push('Participant B: REMOTE video from A is arriving and rendering (real WebRTC video)');

    console.log('Checking remote audio element has a live srcObject...');
    const aAudio = await clientA.evaluate(
        `Boolean(document.querySelector('audio')?.srcObject)`);
    const bAudio = await clientB.evaluate(
        `Boolean(document.querySelector('audio')?.srcObject)`);

    if (aAudio) {
      results.pass.push('Participant A: remote audio track attached (srcObject present)');
    } else {
      results.fail.push('Participant A: remote audio element has no srcObject');
    }
    if (bAudio) {
      results.pass.push('Participant B: remote audio track attached (srcObject present)');
    } else {
      results.fail.push('Participant B: remote audio element has no srcObject');
    }
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
  console.log('\nAll checks passed -- real bidirectional video (and audio track presence) confirmed.');
}

run();

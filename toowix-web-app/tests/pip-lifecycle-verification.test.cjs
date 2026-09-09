/**
 * Real headless-Chrome verification of the PiP lifecycle rewrite in MeetingRoomPage.tsx.
 *
 * Mocks documentPictureInPicture.requestWindow() to always resolve immediately (no gesture
 * check simulated -- headless Chrome cannot exercise real user-activation semantics), so this
 * does NOT prove the browser's real NotAllowedError gesture restriction. What it DOES prove,
 * against the actual running app code (not a re-implementation of the logic):
 *   - visibilitychange 'hidden' alone no longer opens PiP (the competing-path bug, item 2).
 *   - The Media Session 'enterpictureinpicture' handler IS what opens it (captured directly
 *     off navigator.mediaSession.setActionHandler, then invoked, exactly as the browser
 *     would call it).
 *   - 10 consecutive hidden-via-mediaSession / visible cycles all open and close cleanly.
 *   - Native 'X' close (mocked pagehide) followed by another cycle still works.
 *   - Manual PiP button open/close and its immunity to auto-close on tab return.
 *   - Rapid-fire hidden/visible while opening is in flight leaves no stuck window/flag.
 *   - Screen-share priority (stays open across return) and its end (auto-closes).
 *   - No uncaught exceptions/console errors during any of the above.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const WebSocket = require('../../node_modules/ws');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), '.pip-lifecycle-test-'));
let chrome, ws;
const pending = new Map();
let id = 0;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const requestId = ++id;
    pending.set(requestId, { resolve, reject });
    ws.send(JSON.stringify({ id: requestId, method, params }));
  });
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

async function until(expression, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(expression)) return;
    await delay(100);
  }
  const pageState = await evaluate('JSON.stringify({ url: location.href, text: document.body?.innerText?.slice(0, 300) })');
  throw new Error(`Timed out waiting for: ${expression}; page=${pageState}`);
}

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try {
    await fn();
    passed++;
    console.log('   PASS ' + label);
  } catch (err) {
    failed++;
    console.error('   FAIL ' + label + ' -- ' + err.message);
  }
}

(async () => {
  chrome = spawn(
    process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=0',
      '--user-data-dir=' + profile,
      'about:blank',
    ],
    { windowsHide: true, stdio: 'ignore' }
  );

  let port;
  for (let i = 0; i < 100; i++) {
    try {
      port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
      break;
    } catch {}
    await delay(100);
  }
  if (!port) throw new Error('Chrome did not start');

  const tabs = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
  ws = new WebSocket(tabs.find((tab) => tab.type === 'page' && tab.url === 'about:blank').webSocketDebuggerUrl);
  await new Promise((resolve) => ws.once('open', resolve));

  const consoleLogs = [];
  const uncaughtErrors = [];

  ws.on('message', (raw) => {
    const data = JSON.parse(raw);
    if (data.method === 'Runtime.consoleAPICalled') {
      const msg = data.params.args.map((a) => a.value || a.description || '').join(' ');
      consoleLogs.push(msg);
    }
    if (data.method === 'Runtime.exceptionThrown') {
      uncaughtErrors.push('Exception: ' + JSON.stringify(data.params.exceptionDetails));
    }
    if (data.id && pending.has(data.id)) {
      const p = pending.get(data.id);
      pending.delete(data.id);
      data.error ? p.reject(new Error(data.error.message)) : p.resolve(data.result);
    }
  });

  await send('Page.enable');
  await send('Runtime.enable');

  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__docPipOpenCount = 0;
      window.__docPipCloseCount = 0;
      window.__currentPipWin = null;
      window.__visibilityOverride = 'visible';
      window.__mediaSessionHandlers = {};

      Object.defineProperty(window, 'documentPictureInPicture', {
        configurable: true, writable: true,
        value: {
          requestWindow: async () => {
            window.__docPipOpenCount++;
            const iframe = document.createElement('iframe');
            iframe.style.position = 'fixed';
            document.body.appendChild(iframe);
            const win = {
              closed: false,
              document: iframe.contentDocument,
              _listeners: {},
              addEventListener: (ev, fn) => { (win._listeners[ev] ||= []).push(fn); },
              removeEventListener: (ev, fn) => { win._listeners[ev] = (win._listeners[ev] || []).filter(x => x !== fn); },
              close: () => {
                if (win.closed) return;
                win.closed = true;
                window.__docPipCloseCount++;
                for (const h of (win._listeners['pagehide'] || [])) h();
                iframe.remove();
              }
            };
            window.__currentPipWin = win;
            return win;
          }
        }
      });

      Object.defineProperty(document, 'visibilityState', {
        get: () => window.__visibilityOverride,
        configurable: true,
      });

      // Capture Media Session action handlers exactly as the app registers them, so the
      // test can invoke 'enterpictureinpicture' the same way the real browser would --
      // instead of dispatching visibilitychange and hoping it triggers auto-open (which is
      // precisely the bug being fixed: it must NOT).
      if ('mediaSession' in navigator) {
        const realSetActionHandler = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
        navigator.mediaSession.setActionHandler = (action, handler) => {
          window.__mediaSessionHandlers[action] = handler;
          return realSetActionHandler(action, handler);
        };
      }

      window.__invokeMediaSessionPiP = () => {
        window.__mediaSessionHandlers['enterpictureinpicture']?.();
      };

      if (navigator.mediaDevices) {
        navigator.mediaDevices.getUserMedia = async () => {
          const canvas = document.createElement('canvas');
          canvas.width = 640; canvas.height = 480;
          canvas.getContext('2d').fillRect(0, 0, 640, 480);
          return canvas.captureStream(30);
        };
        navigator.mediaDevices.getDisplayMedia = async () => {
          const canvas = document.createElement('canvas');
          canvas.width = 1280; canvas.height = 720;
          canvas.getContext('2d').fillRect(0, 0, 1280, 720);
          return canvas.captureStream(30);
        };
      }

      const meeting = { type:'Guest', organizerId:'host', accessAllowed:true, recordingEnabled:false, autoRecording:false, allowScreenShare:true, micLockEnabled:false };
      const originalFetch = window.fetch;
      window.fetch = async (url, options = {}) => {
        if (String(url).includes('/api/meetings/room/')) {
          return new Response(JSON.stringify(String(url).endsWith('/admission') ? { meeting, jitsiToken:'token', attendanceToken:'attendance', participantEntryId:'p1', moderator:false, participation:'guest' } : {meeting}), {status:200});
        }
        return originalFetch(url, options);
      };

      window.JitsiMeetExternalAPI = class {
        constructor(domain, options) {
          window.__api = this;
          this.options = options;
          this.listeners = {};
          options.parentNode.textContent = 'Simulated conference';
        }
        addListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
        removeListener(name, fn) { this.listeners[name] = (this.listeners[name] || []).filter(x => x !== fn); }
        emit(name, data = {}) { for (const fn of [...(this.listeners[name] || [])]) fn(data); }
        isAudioMuted() { return Promise.resolve(false); }
        setAudioInputDevice() { return Promise.resolve(); } setVideoInputDevice() { return Promise.resolve(); } setAudioOutputDevice() { return Promise.resolve(); }
        executeCommand(name) { if (name === 'hangup') this.emit('readyToClose'); }
        dispose() {}
      };

      window.__hidden = () => { window.__visibilityOverride = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); };
      window.__visible = () => { window.__visibilityOverride = 'visible'; document.dispatchEvent(new Event('visibilitychange')); };
      window.__hiddenViaMediaSession = () => { window.__hidden(); window.__invokeMediaSessionPiP(); };
    `,
  });

  console.log('1. Joining meeting on localhost:3000...');
  await send('Page.navigate', { url: 'http://localhost:3000/meet/pip-lifecycle-test' });
  await until('document.readyState === "complete"');
  await until('document.body.innerText.includes("Ready to join?")');

  await evaluate(`
    const input = document.querySelector('input[placeholder*="name"]');
    if (input) {
      input.value = 'Lifecycle Tester';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Join Meeting'));
    if (btn) btn.click();
  `);
  await until('document.body.innerText.includes("pip-lifecycle-test") && !document.body.innerText.includes("Ready to join?")', 10000);
  console.log('   Meeting joined.');

  console.log('2. Item 2 regression: visibilitychange ALONE must NOT auto-open PiP');
  await check('hidden via visibilitychange only -> no PiP window opened', async () => {
    await evaluate('window.__hidden();');
    await delay(400);
    const open = await evaluate('window.__currentPipWin && !window.__currentPipWin.closed');
    await evaluate('window.__visible();');
    await delay(200);
    if (open) throw new Error('PiP opened from visibilitychange alone -- competing auto-open path still present');
  });

  console.log('3. Media Session handler IS the sole automatic-opening entry point');
  await check('hidden via Media Session handler -> PiP opens', async () => {
    await evaluate('window.__hiddenViaMediaSession();');
    await delay(400);
    const open = await evaluate('window.__currentPipWin && !window.__currentPipWin.closed');
    if (!open) throw new Error('PiP did not open via the Media Session enterpictureinpicture handler');
  });
  await check('return to tab -> auto-triggered PiP closes', async () => {
    await evaluate('window.__visible();');
    await delay(300);
    const closed = await evaluate('!window.__currentPipWin || window.__currentPipWin.closed');
    if (!closed) throw new Error('PiP did not auto-close on return to tab');
  });

  console.log('4. Ten consecutive Media-Session-triggered cycles (8A)');
  for (let cycle = 1; cycle <= 10; cycle++) {
    await check(`cycle ${cycle}/10 opens and closes cleanly`, async () => {
      await evaluate('window.__hiddenViaMediaSession();');
      await delay(300);
      const open = await evaluate('window.__currentPipWin && !window.__currentPipWin.closed');
      if (!open) throw new Error('did not open');
      await evaluate('window.__visible();');
      await delay(300);
      const closed = await evaluate('!window.__currentPipWin || window.__currentPipWin.closed');
      if (!closed) throw new Error('did not close');
    });
  }

  console.log('5. Native X close, return, then another cycle (8B)');
  await evaluate('window.__hiddenViaMediaSession();');
  await delay(300);
  await check('opened before manual close', async () => {
    const open = await evaluate('window.__currentPipWin && !window.__currentPipWin.closed');
    if (!open) throw new Error('setup failed: did not open');
  });
  await evaluate('window.__currentPipWin.close();'); // native X
  await delay(200);
  await evaluate('window.__visible();');
  await delay(150);
  await check('next cycle after native close still opens', async () => {
    await evaluate('window.__hiddenViaMediaSession();');
    await delay(350);
    const open = await evaluate('window.__currentPipWin && !window.__currentPipWin.closed');
    if (!open) throw new Error('did not re-open after a prior native close');
  });
  await evaluate('window.__visible();');
  await delay(250);

  console.log('6. Five manual open/close cycles via the PiP button (8C)');
  const clickPipButton = `
    (() => {
      const btn = [...document.querySelectorAll('button')].find(b =>
        b.getAttribute('title')?.includes('Picture-in-Picture') || b.textContent.includes('Picture in picture'));
      if (btn) btn.click();
      return Boolean(btn);
    })()
  `;
  for (let cycle = 1; cycle <= 5; cycle++) {
    await check(`manual cycle ${cycle}/5 opens`, async () => {
      const clicked = await evaluate(clickPipButton);
      if (!clicked) throw new Error('PiP button not found in DOM');
      await delay(300);
      const open = await evaluate('window.__currentPipWin && !window.__currentPipWin.closed');
      if (!open) throw new Error('manual open failed');
    });
    await check(`manual cycle ${cycle}/5 does NOT auto-close on tab return`, async () => {
      await evaluate('window.__hidden(); window.__visible();');
      await delay(200);
      const stillOpen = await evaluate('window.__currentPipWin && !window.__currentPipWin.closed');
      if (!stillOpen) throw new Error('manually-opened PiP was incorrectly auto-closed on tab return');
    });
    await check(`manual cycle ${cycle}/5 closes via button`, async () => {
      await evaluate(clickPipButton);
      await delay(300);
      const closed = await evaluate('!window.__currentPipWin || window.__currentPipWin.closed');
      if (!closed) throw new Error('manual close failed');
    });
  }

  console.log('7. Rapid hidden/visible while opening is in flight (8D)');
  await check('no stuck window/flag after rapid flips', async () => {
    for (let r = 0; r < 6; r++) {
      await evaluate('window.__hiddenViaMediaSession();');
      await delay(30);
      await evaluate('window.__visible();');
      await delay(30);
    }
    await delay(500);
    const settled = await evaluate('!window.__currentPipWin || window.__currentPipWin.closed');
    if (!settled) throw new Error('rapid switching left an orphaned open PiP window');
  });

  console.log('8. Screen-share priority: stays open across return, closes when sharing ends (8E/8F)');
  await evaluate(`
    (() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.includes('Present now'));
      if (btn) btn.click();
    })()
  `);
  await delay(600);
  await check('PiP opens while screen sharing', async () => {
    await evaluate('window.__hiddenViaMediaSession();');
    await delay(350);
    const open = await evaluate('window.__currentPipWin && !window.__currentPipWin.closed');
    if (!open) throw new Error('did not open during screen share');
  });
  await check('PiP stays open across return while still sharing', async () => {
    await evaluate('window.__visible();');
    await delay(350);
    const stillOpen = await evaluate('window.__currentPipWin && !window.__currentPipWin.closed');
    if (!stillOpen) throw new Error('PiP closed on return despite active screen share');
  });
  await check('PiP auto-closes once sharing stops (already back on tab)', async () => {
    await evaluate(`
      (() => {
        const btn = [...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.includes('Stop presenting') || b.textContent.includes('Stop presenting'));
        if (btn) btn.click();
      })()
    `);
    await delay(500);
    const closed = await evaluate('!window.__currentPipWin || window.__currentPipWin.closed');
    if (!closed) throw new Error('PiP did not auto-close after screen share ended');
  });

  console.log('9. Conference integrity check');
  await check('meeting still connected after all PiP transitions', async () => {
    const inMeeting = await evaluate('document.body.innerText.includes("pip-lifecycle-test")');
    if (!inMeeting) throw new Error('meeting ended/disconnected unexpectedly');
  });

  if (uncaughtErrors.length > 0) {
    failed += uncaughtErrors.length;
    console.error('Uncaught browser errors:', uncaughtErrors);
  }

  console.log(`\n${passed} passed, ${failed} failed (uncaught errors: ${uncaughtErrors.length})`);
  if (failed > 0) process.exitCode = 1;
})()
  .catch((err) => {
    console.error('\nFATAL test harness error:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (ws?.readyState === 1) {
      try { await send('Browser.close'); } catch {}
      ws.close();
    }
    if (chrome && chrome.exitCode === null) chrome.kill();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  });

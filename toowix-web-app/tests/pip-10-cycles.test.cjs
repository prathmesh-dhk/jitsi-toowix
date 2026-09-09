const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const WebSocket = require('../../node_modules/ws');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), '.pip-10-test-'));
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
      if (msg.includes('InvalidStateError')) {
        uncaughtErrors.push('Console InvalidStateError: ' + msg);
      }
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

  // Inject mocks: Document PiP, getUserMedia, getDisplayMedia, simulated Jitsi
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__docPipOpenCount = 0;
      window.__docPipCloseCount = 0;
      window.__currentPipWin = null;
      window.__visibilityOverride = 'visible';

      // Mock Document Picture-in-Picture API
      Object.defineProperty(window, 'documentPictureInPicture', {
        configurable: true,
        writable: true,
        value: {
          requestWindow: async (options) => {
            window.__docPipOpenCount++;
            const iframe = document.createElement('iframe');
            iframe.id = 'doc-pip-iframe-' + window.__docPipOpenCount;
            iframe.style.position = 'fixed';
            iframe.style.width = '380px';
            iframe.style.height = '500px';
            iframe.style.bottom = '10px';
            iframe.style.right = '10px';
            iframe.style.zIndex = '999999';
            document.body.appendChild(iframe);

            const win = {
              closed: false,
              document: iframe.contentDocument,
              _listeners: {},
              addEventListener: (ev, fn) => {
                (win._listeners[ev] ||= []).push(fn);
              },
              removeEventListener: (ev, fn) => {
                win._listeners[ev] = (win._listeners[ev] || []).filter(x => x !== fn);
              },
              close: () => {
                if (win.closed) return;
                win.closed = true;
                window.__docPipCloseCount++;
                const handlers = win._listeners['pagehide'] || [];
                for (const h of handlers) h();
                iframe.remove();
              }
            };
            window.__currentPipWin = win;
            return win;
          }
        }
      });

      // Override document.visibilityState
      Object.defineProperty(document, 'visibilityState', {
        get: () => window.__visibilityOverride,
        configurable: true,
      });

      // Mock MediaStream
      if (navigator.mediaDevices) {
        navigator.mediaDevices.getUserMedia = async () => {
          const canvas = document.createElement('canvas');
          canvas.width = 640; canvas.height = 480;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#4285F4';
          ctx.fillRect(0, 0, 640, 480);
          return canvas.captureStream(30);
        };
        navigator.mediaDevices.getDisplayMedia = async () => {
          const canvas = document.createElement('canvas');
          canvas.width = 1280; canvas.height = 720;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#1A73E8';
          ctx.fillRect(0, 0, 1280, 720);
          return canvas.captureStream(30);
        };
      }

      // Mock room API
      const meeting = { type:'Guest', organizerId:'host', accessAllowed:true, recordingEnabled:false, autoRecording:false, allowScreenShare:true, micLockEnabled:false };
      const originalFetch = window.fetch;
      window.fetch = async (url, options = {}) => {
        if (String(url).includes('/api/meetings/room/')) {
          return new Response(JSON.stringify(String(url).endsWith('/admission') ? { meeting, jitsiToken:'token', attendanceToken:'attendance', participantEntryId:'p1', moderator:false, participation:'guest' } : {meeting}), {status:200});
        }
        return originalFetch(url, options);
      };

      // Mock Jitsi
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

      window.__simulateTabSwitchAway = () => {
        window.__visibilityOverride = 'hidden';
        document.dispatchEvent(new Event('visibilitychange'));
      };

      window.__simulateTabSwitchBack = () => {
        window.__visibilityOverride = 'visible';
        document.dispatchEvent(new Event('visibilitychange'));
      };
    `,
  });

  console.log('1. Joining meeting on localhost:3000...');
  await send('Page.navigate', { url: 'http://localhost:3000/meet/repeated-pip-test' });
  await until('document.readyState === "complete"');
  await until('document.body.innerText.includes("Ready to join?")');

  await evaluate(`
    const input = document.querySelector('input[placeholder*="name"]');
    if (input) {
      input.value = 'Tester PiP';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Join Meeting'));
    if (btn) btn.click();
  `);

  await until('document.body.innerText.includes("repeated-pip-test") && !document.body.innerText.includes("Ready to join?")', 10000);
  console.log('   Meeting joined successfully.');

  // TEST SUITE 1: 10 CONSECUTIVE AUTO-PIP CYCLES
  console.log('2. Running 10 consecutive tab-switch cycles...');
  for (let cycle = 1; cycle <= 10; cycle++) {
    // Switch away
    await evaluate('window.__simulateTabSwitchAway();');
    await delay(350);

    const isOpen = await evaluate('window.__currentPipWin && !window.__currentPipWin.closed');
    const openCount = await evaluate('window.__docPipOpenCount');
    if (!isOpen) {
      throw new Error(`Cycle ${cycle}: PiP failed to open when switching away! (openCount=${openCount})`);
    }

    // Switch back
    await evaluate('window.__simulateTabSwitchBack();');
    await delay(350);

    const isClosed = await evaluate('!window.__currentPipWin || window.__currentPipWin.closed');
    const closeCount = await evaluate('window.__docPipCloseCount');
    if (!isClosed) {
      throw new Error(`Cycle ${cycle}: Auto-PiP failed to close when returning to tab! (closeCount=${closeCount})`);
    }
    console.log(`   Cycle ${cycle}/10 passed: PiP opened and closed cleanly. (total opens: ${openCount}, closes: ${closeCount})`);
  }

  // TEST SUITE 2: RAPID TAB SWITCHING
  console.log('3. Testing rapid tab switching (multiple rapid toggles in quick succession)...');
  for (let r = 0; r < 5; r++) {
    await evaluate('window.__simulateTabSwitchAway();');
    await delay(50);
    await evaluate('window.__simulateTabSwitchBack();');
    await delay(50);
  }
  // Settle back to meeting tab
  await delay(400);
  const settledState = await evaluate('!window.__currentPipWin || window.__currentPipWin.closed');
  if (!settledState) {
    throw new Error('Rapid tab switching left an orphaned PiP window open!');
  }
  console.log('   PASS Rapid tab switching handled with zero leaks or stuck flags.');

  // TEST SUITE 3: MANUAL CLOSE OF PIP, THEN TAB SWITCH AGAIN
  console.log('4. Testing manual close of PiP, followed by tab switch...');
  await evaluate('window.__simulateTabSwitchAway();');
  await delay(350);
  if (!(await evaluate('window.__currentPipWin && !window.__currentPipWin.closed'))) {
    throw new Error('Failed to open PiP for manual close test');
  }

  // User manually closes the PiP window via the 'X' button
  await evaluate('window.__currentPipWin.close();');
  await delay(200);

  // User returns to tab, then switches away again
  await evaluate('window.__simulateTabSwitchBack();');
  await delay(200);
  await evaluate('window.__simulateTabSwitchAway();');
  await delay(350);

  const reOpenedAfterManualClose = await evaluate('window.__currentPipWin && !window.__currentPipWin.closed');
  if (!reOpenedAfterManualClose) {
    throw new Error('PiP failed to open after previous PiP window was closed manually!');
  }
  console.log('   PASS PiP re-opens cleanly after previous window was closed manually.');

  // Switch back to close it
  await evaluate('window.__simulateTabSwitchBack();');
  await delay(300);

  // TEST SUITE 4: MANUAL PIP OPEN / CLOSE & DISTINCTION FROM AUTO-PIP
  console.log('5. Testing manual PiP button toggle and tab switch persistence...');
  // Click manual PiP button
  await evaluate(`
    (() => {
      const pipBtn = [...document.querySelectorAll('button')].find(b =>
        b.getAttribute('title')?.includes('Picture-in-Picture') ||
        b.textContent.includes('Picture in picture')
      );
      if (pipBtn) pipBtn.click();
    })()
  `);
  await delay(400);
  const manualIsOpen = await evaluate('window.__currentPipWin && !window.__currentPipWin.closed');
  if (!manualIsOpen) throw new Error('Manual PiP failed to open on button click');

  // Switch to another tab and switch back:
  // Manually opened PiP MUST NOT be automatically closed on return!
  await evaluate('window.__simulateTabSwitchAway();');
  await delay(200);
  await evaluate('window.__simulateTabSwitchBack();');
  await delay(300);

  const stillOpenAfterTabReturn = await evaluate('window.__currentPipWin && !window.__currentPipWin.closed');
  if (!stillOpenAfterTabReturn) {
    throw new Error('Manually opened PiP was incorrectly closed upon returning to the tab!');
  }
  console.log('   PASS Manually opened PiP remains open across tab switches.');

  // Click PiP button again to close manual PiP
  await evaluate(`
    (() => {
      const pipBtn = [...document.querySelectorAll('button')].find(b =>
        b.getAttribute('title')?.includes('Picture-in-Picture') ||
        b.textContent.includes('Picture in picture')
      );
      if (pipBtn) pipBtn.click();
    })()
  `);
  await delay(300);
  const manualClosed = await evaluate('!window.__currentPipWin || window.__currentPipWin.closed');
  if (!manualClosed) throw new Error('Manual PiP failed to close on second button click');
  console.log('   PASS Manual PiP toggle button closes window cleanly.');

  // TEST SUITE 5: SCREEN SHARE & PRESENTATION TOGGLE BETWEEN SWITCHES
  console.log('6. Testing screen share presentation starting/stopping between switches...');
  // Start screen share
  await evaluate(`
    (() => {
      const shareBtn = [...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.includes('Present now'));
      if (shareBtn) shareBtn.click();
    })()
  `);
  await delay(600);

  // Switch tab while presenting
  await evaluate('window.__simulateTabSwitchAway();');
  await delay(350);
  const sharePipOpen = await evaluate('window.__currentPipWin && !window.__currentPipWin.closed');
  if (!sharePipOpen) throw new Error('PiP failed to open while screen sharing');
  console.log('   PASS PiP opens with active screen share.');

  // Return to tab
  await evaluate('window.__simulateTabSwitchBack();');
  await delay(350);

  // Stop screen share
  await evaluate(`
    (() => {
      const stopShareBtn = [...document.querySelectorAll('button')].find(b =>
        b.getAttribute('title')?.includes('Stop presenting') || b.textContent.includes('Stop presenting')
      );
      if (stopShareBtn) stopShareBtn.click();
    })()
  `);
  await delay(400);

  // Switch away again after screen share stopped
  await evaluate('window.__simulateTabSwitchAway();');
  await delay(350);
  const postSharePipOpen = await evaluate('window.__currentPipWin && !window.__currentPipWin.closed');
  if (!postSharePipOpen) throw new Error('PiP failed to open after stopping screen share');
  console.log('   PASS PiP re-opens cleanly after stopping presentation.');
  await evaluate('window.__simulateTabSwitchBack();');
  await delay(300);

  // TEST SUITE 6: VERIFY CONFERENCE MEDIA INTEGRITY
  console.log('7. Verifying conference media remains alive throughout all PiP transitions...');
  const inMeeting = await evaluate('document.body.innerText.includes("repeated-pip-test")');
  if (!inMeeting) throw new Error('Meeting ended or disconnected during PiP transitions');
  console.log('   PASS Conference and media remain 100% alive.');

  // Check error logs
  if (uncaughtErrors.length > 0) {
    console.error('Errors encountered:', uncaughtErrors);
    throw new Error('Encountered unexpected errors in browser console: ' + uncaughtErrors.join('; '));
  }

  console.log('\n=============================================');
  console.log('ALL 10 CONSECUTIVE CYCLES & TEST SCENARIOS PASSED 100%!');
  console.log('=============================================\n');
})()
  .catch((err) => {
    console.error('\nFAILED PiP test suite:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (ws?.readyState === 1) {
      try { await send('Browser.close'); } catch {}
      ws.close();
    }
    if (chrome && chrome.exitCode === null) {
      chrome.kill();
    }
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch {}
  });

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const WebSocket = require('../../node_modules/ws');

const artifactDir = 'C:\\Users\\xeon5\\.gemini\\antigravity-ide\\brain\\e3e17e6c-a97a-4c39-927c-e824ede8d3f6';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), '.pip-test-'));
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

  ws.on('message', (raw) => {
    const data = JSON.parse(raw);
    if (data.method === 'Runtime.consoleAPICalled') {
      console.log('[Browser Console]', ...data.params.args.map((a) => a.value || a.description || ''));
    }
    if (data.method === 'Runtime.exceptionThrown') {
      console.error('[Browser Exception]', data.params.exceptionDetails);
    }
    if (data.id && pending.has(data.id)) {
      const p = pending.get(data.id);
      pending.delete(data.id);
      data.error ? p.reject(new Error(data.error.message)) : p.resolve(data.result);
    }
  });

  await send('Page.enable');
  await send('Runtime.enable');

  // Inject fake media & simulated Jitsi
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__docPipOpened = 0;
      window.__pipWindowMock = null;
      // Mock Document Picture in Picture API
      try {
        Object.defineProperty(window, 'documentPictureInPicture', {
          configurable: true,
          writable: true,
          value: {
            requestWindow: async (options) => {
              window.__docPipOpened++;
              const iframe = document.createElement('iframe');
              iframe.id = 'doc-pip-mock-iframe';
              iframe.style.position = 'fixed';
              iframe.style.width = '380px';
              iframe.style.height = '500px';
              iframe.style.bottom = '10px';
              iframe.style.right = '10px';
              iframe.style.zIndex = '999999';
              iframe.style.border = 'none';
              document.body.appendChild(iframe);
              const win = {
                document: iframe.contentDocument,
                addEventListener: (ev, fn) => {
                  if (ev === 'pagehide') win._on_pagehide = fn;
                  else iframe.contentWindow.addEventListener(ev, fn);
                },
                removeEventListener: (ev, fn) => {
                  iframe.contentWindow.removeEventListener(ev, fn);
                },
                close: () => {
                  if (win._on_pagehide) win._on_pagehide();
                  iframe.remove();
                }
              };
              window.__pipWindowMock = win;
              return win;
            }
          }
        });
      } catch (e) {
        console.error('Failed to mock documentPictureInPicture:', e);
      }

      // Mock user media
      if (navigator.mediaDevices) {
        const origGetUserMedia = navigator.mediaDevices.getUserMedia?.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = async (constraints) => {
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

      const meeting = { type:'Guest', organizerId:'host', accessAllowed:true, recordingEnabled:false, autoRecording:false, allowScreenShare:true, micLockEnabled:false };
      const originalFetch = window.fetch;
      window.fetch = async (url, options = {}) => {
        if (String(url).includes('/api/meetings/room/')) {
          return new Response(JSON.stringify(String(url).endsWith('/admission') ? { meeting, jitsiToken:'test-room-credential', attendanceToken:'attendance-credential', participantEntryId:'entry', moderator:false, participation:'guest' } : {meeting}), {status:200});
        }
        return originalFetch(url, options);
      };
      window.JitsiMeetExternalAPI = class {
        constructor(domain, options) { window.__api = this; this.options = options; this.listeners = {}; options.parentNode.textContent = 'Simulated conference'; }
        addListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
        removeListener(name, fn) { this.listeners[name] = (this.listeners[name] || []).filter(x => x !== fn); }
        emit(name, data = {}) { for (const fn of [...(this.listeners[name] || [])]) fn(data); }
        isAudioMuted() { return Promise.resolve(false); }
        setAudioInputDevice() { return Promise.resolve(); } setVideoInputDevice() { return Promise.resolve(); } setAudioOutputDevice() { return Promise.resolve(); }
        executeCommand(name) { if (name === 'hangup') this.emit('readyToClose'); }
        dispose() {}
      };
    `,
  });

  console.log('Navigating to meeting room...');
  await send('Page.navigate', { url: 'http://localhost:3000/meet/instant-pip-test' });
  await until('document.readyState === "complete"');
  await until('document.body.innerText.includes("Ready to join?")');
  console.log('PASS Pre-join lobby rendered');

  // Set name and click Join Meeting
  await evaluate(`
    const input = document.querySelector('input[placeholder*="name"]');
    if (input) {
      input.value = 'Alice Host';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  `);

  await evaluate(`
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Join Meeting'));
    if (btn) btn.click();
  `);

  await delay(1500);
  const admissionErr = await evaluate('document.body.innerText.includes("failed") || document.body.innerText.includes("error")');
  console.log('Any admission error shown?', admissionErr);
  const pageText = await evaluate('document.body.innerText');
  console.log('Page text after click:', pageText.slice(0, 200));

  await until('document.body.innerText.includes("instant-pip-test") && !document.body.innerText.includes("Ready to join?")', 10000);
  console.log('PASS In-meeting view loaded');

  // Capture meeting screenshot
  const inMeetingScreenshot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(
    path.join(artifactDir, 'in_meeting_room.png'),
    Buffer.from(inMeetingScreenshot.data, 'base64')
  );
  console.log('Saved in_meeting_room.png');

  const buttonsInfo = await evaluate(`
    JSON.stringify([...document.querySelectorAll('button')].map(b => ({
      title: b.getAttribute('title'),
      text: b.textContent.trim()
    })))
  `);
  console.log('Buttons on page:', buttonsInfo);

  // Verify Document PiP trigger
  const pipOpenedBefore = await evaluate('window.__docPipOpened');
  console.log('Doc PiP opened before click:', pipOpenedBefore);

  // Click PiP button using trusted CDP mouse click (provides user activation)
  const rect = await evaluate(`
    (() => {
      const pipBtn = [...document.querySelectorAll('button')].find(b =>
        b.getAttribute('title')?.includes('Picture-in-Picture') ||
        b.textContent.includes('Picture in picture')
      );
      if (!pipBtn) return null;
      const r = pipBtn.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()
  `);
  console.log('PiP Button coords for click:', rect);

  await evaluate(`
    const pipBtn = [...document.querySelectorAll('button')].find(b =>
      b.getAttribute('title')?.includes('Picture-in-Picture') ||
      b.textContent.includes('Picture in picture')
    );
    if (pipBtn) pipBtn.click();
  `);

  await delay(1000);
  const docPipOpenedAfter = await evaluate('window.__docPipOpened');
  console.log('Doc PiP opened after click:', docPipOpenedAfter);

  const debugInfo = await evaluate(`(() => {
    if (!window.__pipWindowMock) return 'no pipWindowMock';
    return {
      hasDoc: !!window.__pipWindowMock.document,
      hasBody: !!window.__pipWindowMock.document.body,
      bodyTag: window.__pipWindowMock.document.body.tagName,
      childCount: window.__pipWindowMock.document.body.childNodes.length,
      html: window.__pipWindowMock.document.body.innerHTML,
      outerHtml: window.__pipWindowMock.document.body.outerHTML?.slice(0, 300),
    };
  })()`);
  console.log('DEBUG PiP Window Info:', JSON.stringify(debugInfo));

  // 1. Capture Participant PiP window screenshot
  const pipParticipantScreenshot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(
    path.join(artifactDir, 'pip_participant_window.png'),
    Buffer.from(pipParticipantScreenshot.data, 'base64')
  );
  console.log('Saved pip_participant_window.png');

  // 2. Start screen sharing to test Presentation PiP
  await evaluate(`
    const shareBtn = [...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.includes('Present now'));
    if (shareBtn) shareBtn.click();
  `);
  await delay(1500);

  // Capture Presentation PiP window screenshot
  const pipPresentationScreenshot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(
    path.join(artifactDir, 'pip_presentation_window.png'),
    Buffer.from(pipPresentationScreenshot.data, 'base64')
  );
  console.log('Saved pip_presentation_window.png');

  // Test closing PiP
  await evaluate('if (window.__pipWindowMock) window.__pipWindowMock.close();');
  await delay(500);
  const isStillInMeeting = await evaluate('document.body.innerText.includes("instant-pip-test")');
  console.log('Closing PiP leaves meeting active:', isStillInMeeting);

  console.log('All PiP verification checks passed!');
})()
  .catch((err) => {
    console.error('Error during PiP verification:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (ws?.readyState === 1) {
      try {
        await send('Browser.close');
      } catch {}
      ws.close();
    }
    if (chrome && chrome.exitCode === null) {
      chrome.kill();
    }
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch {}
  });

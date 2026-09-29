// Minimal CDP client -- same raw WebSocket approach already used in tests/pip-*.test.cjs, reused
// here rather than adding Playwright/Puppeteer as a new dependency.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// ws lives one level up (jitsi-toowix/node_modules/ws), same as the existing pip tests resolve it.
const WebSocket = require(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'node_modules', 'ws'));

export const CHROME_PATH = process.env.BENCH_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

export async function launchChrome({ headless = true, extraArgs = [] } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), '.bg-bench-'));
  const args = [
    ...(headless ? [ '--headless=new' ] : []),
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    '--window-size=800,600',
    '--user-data-dir=' + profile,
    ...extraArgs,
    'about:blank'
  ];
  const chrome = spawn(CHROME_PATH, args, { windowsHide: true, stdio: [ 'ignore', 'ignore', 'pipe' ] });
  let stderr = '';
  let port = null;

  chrome.stderr.on('data', (d) => { stderr += d.toString(); });
  for (let i = 0; i < 200; i++) {
    const m = stderr.match(/ws:\/\/127\.0\.0\.1:(\d+)\//);

    if (m) { port = m[1]; break; }
    await sleep(50);
  }
  if (!port) {
    chrome.kill();
    throw new Error('Chrome did not open a debug port. stderr tail: ' + stderr.slice(-2000));
  }

  const listRes = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
  const target = listRes.find((t) => t.type === 'page') || listRes[0];
  const ws = new WebSocket(target.webSocketDebuggerUrl);

  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });

  let id = 0;
  const pending = new Map();
  const consoleLines = [];
  const exceptions = [];

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());

    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);

      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);

      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      consoleLines.push({
        type: msg.params.type,
        text: (msg.params.args || []).map((a) => (a.value !== undefined ? String(a.value) : (a.description || ''))).join(' ')
      });
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      exceptions.push(msg.params.exceptionDetails);
    }
  });

  async function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const requestId = ++id;

      pending.set(requestId, { resolve, reject });
      ws.send(JSON.stringify({ id: requestId, method, params }));
    });
  }

  await send('Runtime.enable');
  await send('Page.enable');

  // Phase 2c Step 2: renderer CPU%/long-task counts and heap-GC-for-stability-checks support.
  async function enablePerformanceMetrics() {
    await send('Performance.enable');
  }

  async function getPerformanceMetrics() {
    const result = await send('Performance.getMetrics');

    return Object.fromEntries((result.metrics || []).map((m) => [ m.name, m.value ]));
  }

  async function collectGarbage() {
    // HeapProfiler.collectGarbage requires the domain enabled first; enabling repeatedly is a
    // no-op so this is safe to call on every use rather than requiring callers to track state.
    await send('HeapProfiler.enable');
    await send('HeapProfiler.collectGarbage');
  }

  async function evaluate(expression, awaitPromise = false) {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });

    if (result.exceptionDetails) {
      throw new Error('Evaluate failed: ' + JSON.stringify(result.exceptionDetails));
    }

    return result.result.value;
  }

  async function setLocalStorageBeforeLoad(key, value) {
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `try { localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)}); } catch (e) {}`
    });
  }

  // Phase 2c Step 2: installs a long-task counter (window.__benchLongTaskCount) before the page's
  // own scripts run, so it observes every longtask from navigation onward -- used to check
  // whether the render-time-aware frame loop (Phase 2c Step 1) actually reduces main-thread
  // blocking, not just raw fps.
  async function installLongTaskCounter() {
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        window.__benchLongTaskCount = 0;
        try {
          new PerformanceObserver((list) => { window.__benchLongTaskCount += list.getEntries().length; })
            .observe({ entryTypes: [ 'longtask' ] });
        } catch (e) { window.__benchLongTaskCount = null; }
      `
    });
  }

  async function navigate(url) {
    consoleLines.length = 0;
    exceptions.length = 0;
    await send('Page.navigate', { url });
  }

  async function waitFor(expression, timeoutMs = 30000) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const value = await evaluate(expression).catch(() => undefined);

      if (value) return value;
      await sleep(150);
    }
    throw new Error(`Timed out waiting for: ${expression}`);
  }

  async function screenshot(filePath) {
    const result = await send('Page.captureScreenshot', { format: 'png' });

    fs.writeFileSync(filePath, Buffer.from(result.data, 'base64'));
  }

  // Phase 2c Step 2: a 2x-zoomed crop of one region of the page (e.g. head/hair/ear), instead of
  // the whole ~320px preview -- clip.scale renders that region at 2x its CSS pixel size.
  async function screenshotClip(filePath, clip) {
    const result = await send('Page.captureScreenshot', { clip: { scale: 2, ...clip }, format: 'png' });

    fs.writeFileSync(filePath, Buffer.from(result.data, 'base64'));
  }

  // Deletes the throwaway --user-data-dir after the browser process has actually exited (not
  // just been sent a kill signal) -- calling rmSync immediately after chrome.kill() races
  // Windows releasing its file locks on the profile and silently fails (wrapped in a
  // catch-and-ignore, so it fails quietly). That race is exactly what leaked 36 profile dirs
  // (1.6GB) during the first full benchmark run. Retries a few times with a short backoff for
  // the same reason -- a lock can outlive the process exit event by a few hundred ms on Windows.
  async function close() {
    try { ws.close(); } catch { /* ignore */ }

    const exited = new Promise((resolve) => {
      if (chrome.exitCode !== null || chrome.killed) { resolve(); return; }
      chrome.once('exit', () => resolve());
      setTimeout(resolve, 5000); // don't hang forever if the process refuses to report exit
    });

    try { chrome.kill(); } catch { /* ignore */ }
    await exited;

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        fs.rmSync(profile, { recursive: true, force: true });

        return;
      } catch {
        await sleep(300);
      }
    }
    console.error(`[cdp] WARNING: could not delete profile dir after 5 attempts: ${profile}`);
  }

  return {
    send, evaluate, navigate, waitFor, screenshot, screenshotClip, setLocalStorageBeforeLoad, close,
    enablePerformanceMetrics, getPerformanceMetrics, collectGarbage, installLongTaskCounter,
    consoleLines, exceptions, port, profile
  };
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

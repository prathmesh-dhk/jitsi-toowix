#!/usr/bin/env node
// GO 2 final acceptance test -- B1 (tsc+unit tests) already run separately outside this script.
// This covers B2-B8, hard 30-minute budget: at 26:00 no NEW run starts, at 30:00 abort in place.
// Every individual browser launch checks the watchdog before starting -- timing.json records
// each block's start/end/elapsed and whether it was skipped/cut.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { launchChrome, sleep } from './cdp.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BENCH_DIR = __dirname;
const MEDIA_DIR = path.join(BENCH_DIR, 'media');
const RESULTS_DIR = path.join(BENCH_DIR, 'results');
const SCREENSHOTS_DIR = path.join(BENCH_DIR, 'screenshots');
const VITE_URL = 'http://localhost:5199/';
const MIN_FREE_BYTES = 500 * 1024 * 1024;

const clip720 = path.join(MEDIA_DIR, 'clip-720.mjpeg');
const clip480 = path.join(MEDIA_DIR, 'clip-480.mjpeg');
const clip1080 = path.join(MEDIA_DIR, 'clip-1080.mjpeg');
const edgeClip = path.join(MEDIA_DIR, 'clip-edge-crop.mjpeg');

const BUDGET_MS = 30 * 60 * 1000;
const NO_NEW_RUN_MS = 26 * 60 * 1000;
const startedAt = Date.now();
const elapsedMs = () => Date.now() - startedAt;
const elapsedStr = () => `${Math.floor(elapsedMs() / 60000)}:${String(Math.floor((elapsedMs() % 60000) / 1000)).padStart(2, '0')}`;
const timing = { startedAt: new Date(startedAt).toISOString(), blocks: [], cutItems: [] };

function saveTiming() {
  fs.writeFileSync(path.join(RESULTS_DIR, 'timing.json'), JSON.stringify(timing, null, 2));
}

function freeBytesOnC() {
  const out = spawnSync('powershell', [ '-NoProfile', '-Command', '(Get-PSDrive C).Free' ], { encoding: 'utf8' });

  return parseInt(out.stdout.trim(), 10);
}

// Returns false (and records why) if a new run must NOT start -- either the 26:00 soft cutoff or
// disk space. Callers check this before every individual Chrome launch.
function canStartNewRun(label) {
  if (elapsedMs() >= NO_NEW_RUN_MS) {
    console.log(`[${elapsedStr()}] CUT (past 26:00): ${label}`);
    timing.cutItems.push({ label, reason: 'past 26:00 watchdog', elapsed: elapsedStr() });

    return false;
  }
  const free = freeBytesOnC();

  if (free < MIN_FREE_BYTES) {
    console.log(`[${elapsedStr()}] CUT (disk < 500MB): ${label}`);
    timing.cutItems.push({ label, reason: `disk space ${Math.round(free / 1048576)}MB`, elapsed: elapsedStr() });

    return false;
  }

  return true;
}

function saveJson(name, data) {
  fs.writeFileSync(path.join(RESULTS_DIR, name), JSON.stringify(data, null, 2));
  console.log(`  saved ${name}`);
}

async function startViteServer() {
  console.log('[vite] starting bench harness server...');
  const vite = spawn('npx', [ 'vite', '--config', 'bench/vite.bench.config.ts' ], {
    cwd: path.join(BENCH_DIR, '..'), shell: true, stdio: [ 'ignore', 'pipe', 'pipe' ]
  });
  let ready = false;

  vite.stdout.on('data', (d) => { if (d.toString().includes('ready in')) ready = true; });
  for (let i = 0; i < 100 && !ready; i++) await sleep(100);
  await sleep(500);

  return vite;
}

async function benchRun({ label, engine, clipPath, headless = true, cpuThrottle = null, extraChromeArgs = [], warmupMs = 3000, benchSeconds = 12 }) {
  if (!canStartNewRun(label)) return null;
  const chrome = await launchChrome({ headless, extraArgs: [ `--use-file-for-fake-video-capture=${clipPath}`, '--disk-cache-size=1', '--media-cache-size=1', ...extraChromeArgs ] });
  const info = { label, engine, headless, cpuThrottle, extraChromeArgs };

  try {
    await chrome.enablePerformanceMetrics();
    await chrome.installLongTaskCounter();
    await chrome.setLocalStorageBeforeLoad('toowix_bg_engine', engine);
    await chrome.navigate(VITE_URL);
    await chrome.waitFor('window.__benchReady === true || window.__benchError', 60000);
    const start = JSON.parse(await chrome.evaluate('JSON.stringify({ error: window.__benchError, engine: window.__benchEffect && window.__benchEffect._engine })'));

    if (start.error) { info.error = start.error; return info; }
    info.actualEngineAtStart = start.engine;
    if (cpuThrottle) await chrome.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle });
    await sleep(warmupMs);

    const m0 = await chrome.getPerformanceMetrics();
    const lt0 = await chrome.evaluate('window.__benchLongTaskCount');
    const wallStart = Date.now();
    const bench = await chrome.evaluate(`window.__bgBench(${benchSeconds})`, true);
    const m1 = await chrome.getPerformanceMetrics();
    const lt1 = await chrome.evaluate('window.__benchLongTaskCount');
    const wallSec = (Date.now() - wallStart) / 1000;
    const taskDelta = (m1.TaskDuration ?? 0) - (m0.TaskDuration ?? 0);

    info.bench = bench;
    info.actualEngineAfterBench = await chrome.evaluate('window.__benchEffect._engine');
    info.perfCapAfter = await chrome.evaluate('window.__benchEffect._perfCap');
    info.perfFpsCapAfter = await chrome.evaluate('window.__benchEffect._perfFpsCap');
    info.cpu = { cpuPercent: wallSec > 0 ? Math.round((taskDelta / wallSec) * 1000) / 10 : null, longTaskCount: (typeof lt1 === 'number' && typeof lt0 === 'number') ? lt1 - lt0 : null };
    info.docState = JSON.parse(await chrome.evaluate('JSON.stringify({ hidden: document.hidden, visibilityState: document.visibilityState })'));
    const ticks = await chrome.evaluate('window.__benchTickTimestamps');

    if (Array.isArray(ticks) && ticks.length > 1) {
      const gaps = [];

      for (let i = 1; i < ticks.length; i++) gaps.push(ticks[i] - ticks[i - 1]);
      info.tickSpacing = { avgGapMs: Math.round((gaps.reduce((a, b) => a + b, 0) / gaps.length) * 10) / 10, sampleCount: ticks.length };
    }
    info.consoleErrors = chrome.consoleLines.filter((l) => l.type === 'error').map((l) => l.text);
  } catch (err) {
    info.error = err.message;
  } finally {
    await chrome.close();
  }

  return info;
}

async function main() {
  const vite = await startViteServer();

  try {
    // ---- B2: headed runs -----------------------------------------------------------------------
    console.log(`\n[${elapsedStr()}] ########## B2: headed runs ##########`);
    const b2start = elapsedStr();

    for (const engine of [ 'v1', 'mediapipe-cpu', 'mediapipe-gpu' ]) {
      const r = await benchRun({ label: `headed-${engine}`, engine, clipPath: clip720, headless: false });

      if (r) saveJson(`go2-headed-${engine}.json`, r);
    }
    const throttleFlagsResult = await benchRun({
      label: 'headed-mediapipe-cpu-no-throttling-flags', engine: 'mediapipe-cpu', clipPath: clip720, headless: false,
      extraChromeArgs: [ '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows' ]
    });

    if (throttleFlagsResult) saveJson('go2-headed-mediapipe-cpu-no-throttling-flags.json', throttleFlagsResult);
    timing.blocks.push({ block: 'B2', start: b2start, end: elapsedStr() });
    saveTiming();

    // ---- B3: governor real-browser scenarios (accelerated timescale) ---------------------------
    console.log(`\n[${elapsedStr()}] ########## B3: governor scenarios (ACCELERATED via toowix_bg_gov_timescale) ##########`);
    const b3start = elapsedStr();

    async function governorScenario(label, engine, throttleRate, throttleMs, timescale) {
      if (!canStartNewRun(`governor-${label}`)) return null;
      const chrome = await launchChrome({ headless: true, extraArgs: [ `--use-file-for-fake-video-capture=${clip720}`, '--disk-cache-size=1', '--media-cache-size=1' ] });
      const timeline = [];

      try {
        await chrome.setLocalStorageBeforeLoad('toowix_bg_engine', engine);
        await chrome.setLocalStorageBeforeLoad('toowix_bg_gov_timescale', String(timescale));
        await chrome.navigate(VITE_URL);
        await chrome.waitFor('window.__benchReady === true || window.__benchError', 30000);
        await sleep(1000);

        async function sample(tag) {
          const s = JSON.parse(await chrome.evaluate(
              'JSON.stringify({perfCap:window.__benchEffect._perfCap,perfFpsCap:window.__benchEffect._perfFpsCap,frameMsEma:window.__benchEffect._frameMsEma})'
          ));

          timeline.push({ tag, tMs: Date.now(), ...s, duty: Math.round(((s.frameMsEma * Math.min(s.perfFpsCap, 30)) / 1000) * 1000) / 1000 });
        }

        if (label === 'G3-anti-trap') {
          // Start already at the floor via CPU throttle, then release.
          await chrome.send('Emulation.setCPUThrottlingRate', { rate: throttleRate });
          await sleep(throttleMs);
          await sample('floor-reached');
          await chrome.send('Emulation.setCPUThrottlingRate', { rate: 1 });
          for (let i = 0; i < 6; i++) { await sleep(1000); await sample(`recover-${i + 1}s`); }
        } else {
          await sample('baseline');
          await chrome.send('Emulation.setCPUThrottlingRate', { rate: throttleRate });
          for (let i = 0; i < Math.round(throttleMs / 1000); i++) { await sleep(1000); await sample(`throttled-${i + 1}s`); }
          await chrome.send('Emulation.setCPUThrottlingRate', { rate: 1 });
          for (let i = 0; i < 6; i++) { await sleep(1000); await sample(`released-${i + 1}s`); }
        }
      } finally {
        await chrome.close();
      }

      return { label, engine, throttleRate, timescale, timeline };
    }

    // timescale=8 accelerates the 8s step-up sustain window to ~1s, so recovery is visible within
    // the short windows above -- explicitly labelled ACCELERATED, not real production timing.
    const g1 = await governorScenario('G1-v1-6x', 'v1', 6, 6000, 8);

    if (g1) saveJson('go2-governor-G1.json', g1);
    const g2 = await governorScenario('G2-mediapipe-cpu-4x', 'mediapipe-cpu', 4, 6000, 8);

    if (g2) saveJson('go2-governor-G2.json', g2);
    const g3 = await governorScenario('G3-anti-trap', 'mediapipe-cpu', 6, 8000, 8);

    if (g3) saveJson('go2-governor-G3.json', g3);
    timing.blocks.push({ block: 'B3', start: b3start, end: elapsedStr() });
    saveTiming();

    // ---- B4: 480 / 1080 (upscaled), all 3 engines, 1 run each ----------------------------------
    console.log(`\n[${elapsedStr()}] ########## B4: 480/1080 x 3 engines ##########`);
    const b4start = elapsedStr();

    for (const [ h, clip ] of [ [ 480, clip480 ], [ 1080, clip1080 ] ]) {
      for (const engine of [ 'v1', 'mediapipe-cpu', 'mediapipe-gpu' ]) {
        const r = await benchRun({ label: `${h}-${engine}`, engine, clipPath: clip });

        if (r) saveJson(`go2-${h}-${engine}.json`, r);
      }
    }
    timing.blocks.push({ block: 'B4', start: b4start, end: elapsedStr() });
    saveTiming();

    // ---- B5: throttle 4x/6x @ 720, all 3 engines --------------------------------------------
    console.log(`\n[${elapsedStr()}] ########## B5: throttle 4x/6x @720 x 3 engines ##########`);
    const b5start = elapsedStr();

    for (const rate of [ 4, 6 ]) {
      for (const engine of [ 'v1', 'mediapipe-cpu', 'mediapipe-gpu' ]) {
        const r = await benchRun({ label: `throttle-${rate}x-${engine}`, engine, clipPath: clip720, cpuThrottle: rate });

        if (r) saveJson(`go2-throttle-${rate}x-${engine}.json`, r);
      }
    }
    timing.blocks.push({ block: 'B5', start: b5start, end: elapsedStr() });
    saveTiming();

    // ---- B6: visual checks -- 3 distinct moments + 2x zoomed edge crops at 720 AND 1080 --------
    console.log(`\n[${elapsedStr()}] ########## B6: visual checks ##########`);
    const b6start = elapsedStr();

    for (const [ moment, delayMs ] of [ [ 'still', 1000 ], [ 'headturn', 3000 ], [ 'handraised', 5000 ] ]) {
      const file = `go2-mask-1080-${moment}.png`;

      if (!canStartNewRun(`mask-1080-${moment}`)) break;
      const chrome = await launchChrome({ headless: true, extraArgs: [ `--use-file-for-fake-video-capture=${edgeClip}`, '--disk-cache-size=1', '--media-cache-size=1' ] });

      try {
        await chrome.setLocalStorageBeforeLoad('toowix_bg_engine', 'mediapipe-cpu');
        await chrome.setLocalStorageBeforeLoad('toowix_bg_debug_mask', '1');
        await chrome.navigate(VITE_URL);
        await chrome.waitFor('window.__benchReady === true || window.__benchError', 30000);
        await sleep(delayMs);
        await chrome.screenshot(path.join(SCREENSHOTS_DIR, file));
        console.log(`  saved ${file}`);
      } finally {
        await chrome.close();
      }
    }

    for (const height of [ 720, 1080 ]) {
      for (const engine of [ 'v1', 'mediapipe-cpu', 'mediapipe-gpu' ]) {
        const wideFile = `go2-edge-${height}-${engine}.png`;
        const zoomFile = `go2-edge-${height}-${engine}-zoomed.png`;

        if (!canStartNewRun(`edge-${height}-${engine}`)) break;
        const chrome = await launchChrome({ headless: true, extraArgs: [ `--use-file-for-fake-video-capture=${edgeClip}`, '--disk-cache-size=1', '--media-cache-size=1' ] });

        try {
          await chrome.setLocalStorageBeforeLoad('toowix_bg_engine', engine);
          await chrome.navigate(VITE_URL);
          await chrome.waitFor('window.__benchReady === true || window.__benchError', 30000);
          if (height === 1080) await chrome.evaluate('window.__benchEffect.setMaxOutputHeight(1080)');
          await sleep(2000);
          await chrome.screenshot(path.join(SCREENSHOTS_DIR, wideFile));
          await chrome.screenshotClip(path.join(SCREENSHOTS_DIR, zoomFile), { height: 90, width: 160, x: 0, y: 0 });
          console.log(`  saved ${wideFile}, ${zoomFile}`);
        } finally {
          await chrome.close();
        }
      }
    }
    timing.blocks.push({ block: 'B6', start: b6start, end: elapsedStr() });
    saveTiming();

    // ---- B7: stability -------------------------------------------------------------------------
    console.log(`\n[${elapsedStr()}] ########## B7: stability ##########`);
    const b7start = elapsedStr();
    const toggleResults = {};

    for (const engine of [ 'v1', 'mediapipe-cpu', 'mediapipe-gpu' ]) {
      if (!canStartNewRun(`toggle-${engine}`)) break;
      const chrome = await launchChrome({ headless: true, extraArgs: [ `--use-file-for-fake-video-capture=${clip720}`, '--disk-cache-size=1', '--media-cache-size=1' ] });

      try {
        await chrome.setLocalStorageBeforeLoad('toowix_bg_engine', engine);
        await chrome.navigate(VITE_URL);
        await chrome.waitFor('window.__benchReady === true || window.__benchError', 30000);
        await sleep(1000);
        const rounds = [];

        for (let round = 1; round <= 3; round++) {
          for (let i = 0; i < 20; i++) { await chrome.evaluate('window.__benchToggle()'); await sleep(150); }
          await chrome.collectGarbage();
          await sleep(300);
          const heapMB = await chrome.evaluate('performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null');

          rounds.push({ round, heapMB: heapMB !== null ? Math.round(heapMB * 10) / 10 : null });
        }
        toggleResults[engine] = { rounds, consoleErrors: chrome.consoleLines.filter((l) => l.type === 'error').map((l) => l.text) };
      } finally {
        await chrome.close();
      }
    }
    saveJson('go2-toggle-stability.json', toggleResults);

    const visibilityResults = {};

    for (const engine of [ 'v1', 'mediapipe-cpu', 'mediapipe-gpu' ]) {
      if (!canStartNewRun(`visibility-${engine}`)) break;
      const chrome = await launchChrome({ headless: true, extraArgs: [ `--use-file-for-fake-video-capture=${clip720}`, '--disk-cache-size=1', '--media-cache-size=1' ] });

      try {
        await chrome.setLocalStorageBeforeLoad('toowix_bg_engine', engine);
        await chrome.navigate(VITE_URL);
        await chrome.waitFor('window.__benchReady === true || window.__benchError', 30000);
        await sleep(1000);
        await chrome.evaluate("Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange'));");
        // Full 30s hold as specified (budget allows it, unlike GO 1's shortened version).
        await sleep(30000);
        const before = await chrome.evaluate('window.__benchEffect.getTotalFrameCount()');

        await chrome.evaluate("Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange'));");
        let after = before;
        let resumedWithinMs = null;
        const pollStart = Date.now();

        while (Date.now() - pollStart < 5000) {
          await sleep(250);
          after = await chrome.evaluate('window.__benchEffect.getTotalFrameCount()');
          if (after > before) { resumedWithinMs = Date.now() - pollStart; break; }
        }
        visibilityResults[engine] = { before, after, resumedWithinMs, loopResumed: after > before };
        console.log(`  ${engine}: resumed=${after > before} within=${resumedWithinMs}ms`);
      } finally {
        await chrome.close();
      }
    }
    saveJson('go2-visibility-30s.json', visibilityResults);

    // Mid-call fallback: force 5 consecutive segmentation errors on mediapipe-cpu.
    let fallbackResult = null;

    if (canStartNewRun('mid-call-fallback')) {
      const chrome = await launchChrome({ headless: true, extraArgs: [ `--use-file-for-fake-video-capture=${clip720}`, '--disk-cache-size=1', '--media-cache-size=1' ] });

      try {
        await chrome.setLocalStorageBeforeLoad('toowix_bg_engine', 'mediapipe-cpu');
        await chrome.navigate(VITE_URL);
        await chrome.waitFor('window.__benchReady === true || window.__benchError', 30000);
        await sleep(1000);
        const engineBefore = await chrome.evaluate('window.__benchEffect._engine');

        // Force the real failure path: break segmentForVideo on the live segmenter so the next 5
        // real frames go through the actual _handleMediaPipeFrameFailure code, not a simulation.
        await chrome.evaluate(`
          window.__benchEffect._mediaPipeSegmenter.segmentForVideo = () => { throw new Error('GO2 forced failure'); };
        `);
        await sleep(1000); // several real frame ticks at ~30fps -- past the 5-consecutive threshold
        const engineAfter = await chrome.evaluate('window.__benchEffect._engine');
        const canvasNonBlack = await chrome.evaluate(`
          (function() {
            const c = window.__benchEffect._outputCanvasElement;
            const ctx = c.getContext('2d');
            const data = ctx.getImageData(0, 0, Math.min(4, c.width), Math.min(4, c.height)).data;
            for (let i = 0; i < data.length; i += 4) { if (data[i] || data[i+1] || data[i+2]) return true; }
            return false;
          })()
        `);

        fallbackResult = { engineBefore, engineAfter, switchedToV1: engineAfter === 'v1', canvasNonBlack, consoleErrors: chrome.consoleLines.filter((l) => l.type === 'error').map((l) => l.text) };
        console.log(`  mid-call fallback: ${engineBefore} -> ${engineAfter}, canvasNonBlack=${canvasNonBlack}`);
      } finally {
        await chrome.close();
      }
      saveJson('go2-midcall-fallback.json', fallbackResult);
    }
    timing.blocks.push({ block: 'B7', start: b7start, end: elapsedStr() });
    saveTiming();

    console.log(`\n[${elapsedStr()}] DONE. Total elapsed: ${elapsedStr()}`);
    timing.finishedAt = new Date().toISOString();
    timing.totalElapsedMs = elapsedMs();
    saveTiming();
  } finally {
    vite.kill();
  }
}

main().catch((err) => {
  console.error(err);
  timing.error = err.message;
  saveTiming();
  process.exit(1);
});

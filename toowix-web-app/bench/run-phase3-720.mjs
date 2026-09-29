#!/usr/bin/env node
// Phase 3, stage 5(b)/(c)/(d): a narrowly-scoped re-measure -- 720p only, 3 engines, median of 3
// -- for the governor redesign + Phase 2c loop/small-mask fixes, under a hard 15-minute test
// budget (see the chat transcript's GO 1 message, item 5). Reuses the same launchChrome/runOne
// pattern as bench/run-bench.mjs rather than duplicating it wholesale; scoped down so it fits the
// budget instead of running the full matrix again.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, sleep } from './cdp.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BENCH_DIR = __dirname;
const MEDIA_DIR = path.join(BENCH_DIR, 'media');
const RESULTS_DIR = path.join(BENCH_DIR, 'results');
const SCREENSHOTS_DIR = path.join(BENCH_DIR, 'screenshots');
const VITE_PORT = 5199;
const VITE_URL = `http://localhost:${VITE_PORT}/`;

const clipPath = path.join(MEDIA_DIR, 'clip-720.mjpeg');
const edgeClipPath = path.join(MEDIA_DIR, 'clip-edge-crop.mjpeg');

function saveJson(name, data) {
  fs.writeFileSync(path.join(RESULTS_DIR, name), JSON.stringify(data, null, 2));
  console.log(`  saved ${name}`);
}

async function runOne({ engine, headless = true, warmupMs = 5000, benchSeconds = 20 }) {
  const chrome = await launchChrome({
    headless,
    extraArgs: [ `--use-file-for-fake-video-capture=${clipPath}`, '--disk-cache-size=1', '--media-cache-size=1' ]
  });
  const runInfo = { requestedEngine: engine, headless };

  try {
    await chrome.enablePerformanceMetrics();
    await chrome.installLongTaskCounter();
    await chrome.setLocalStorageBeforeLoad('toowix_bg_engine', engine);
    await chrome.navigate(VITE_URL);
    await chrome.waitFor('window.__benchReady === true || window.__benchError', 60000);

    const startState = JSON.parse(await chrome.evaluate(
        'JSON.stringify({ error: window.__benchError, engine: window.__benchEffect && window.__benchEffect._engine })'
    ));

    if (startState.error) {
      runInfo.error = startState.error;

      return runInfo;
    }
    runInfo.actualEngineAtStart = startState.engine;
    await sleep(warmupMs);

    const metricsBefore = await chrome.getPerformanceMetrics();
    const longBefore = await chrome.evaluate('window.__benchLongTaskCount');
    const wallStart = Date.now();
    const benchResultRaw = await chrome.evaluate(`window.__bgBench(${benchSeconds})`, true);
    const metricsAfter = await chrome.getPerformanceMetrics();
    const longAfter = await chrome.evaluate('window.__benchLongTaskCount');
    const wallSeconds = (Date.now() - wallStart) / 1000;
    const taskDurationDelta = (metricsAfter.TaskDuration ?? 0) - (metricsBefore.TaskDuration ?? 0);

    runInfo.bench = benchResultRaw;
    runInfo.actualEngineAfterBench = await chrome.evaluate('window.__benchEffect._engine');
    runInfo.cpu = {
      cpuPercent: wallSeconds > 0 ? Math.round((taskDurationDelta / wallSeconds) * 1000) / 10 : null,
      longTaskCount: (typeof longAfter === 'number' && typeof longBefore === 'number') ? longAfter - longBefore : null
    };
    runInfo.consoleErrors = chrome.consoleLines.filter((l) => l.type === 'error').map((l) => l.text);
  } finally {
    await chrome.close();
  }

  return runInfo;
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

async function main() {
  const startedAt = Date.now();
  const elapsed = () => `${Math.round((Date.now() - startedAt) / 1000)}s`;

  const vite = await startViteServer();

  try {
    console.log(`\n[${elapsed()}] ########## main 720p matrix: 3 engines x 3 reps ##########`);
    for (const engine of [ 'v1', 'mediapipe-cpu', 'mediapipe-gpu' ]) {
      for (let rep = 1; rep <= 3; rep++) {
        const name = `phase3-720-${engine}-rep${rep}.json`;

        console.log(`[${elapsed()}] === ${name} ===`);
        try {
          const result = await runOne({ engine });

          saveJson(name, result);
        } catch (err) {
          console.error(`FAILED: ${name}:`, err.message);
          saveJson(`phase3-720-${engine}-rep${rep}-FAILED.json`, { error: err.message });
        }
      }
    }

    console.log(`\n[${elapsed()}] ########## distinct-moment mask screenshots (mediapipe-cpu) ##########`);
    for (const [ moment, delayMs ] of [ [ 'still', 1000 ], [ 'headturn', 3000 ], [ 'handraised', 5000 ] ]) {
      const file = `phase3-mask-${moment}.png`;
      const chrome = await launchChrome({ headless: true, extraArgs: [ `--use-file-for-fake-video-capture=${edgeClipPath}`, '--disk-cache-size=1', '--media-cache-size=1' ] });

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

    console.log(`\n[${elapsed()}] ########## visibility-resume (3 engines, monotonic counter) ##########`);
    const visibilityResults = {};

    for (const engine of [ 'v1', 'mediapipe-cpu', 'mediapipe-gpu' ]) {
      const chrome = await launchChrome({ headless: true, extraArgs: [ `--use-file-for-fake-video-capture=${clipPath}`, '--disk-cache-size=1', '--media-cache-size=1' ] });

      try {
        await chrome.setLocalStorageBeforeLoad('toowix_bg_engine', engine);
        await chrome.navigate(VITE_URL);
        await chrome.waitFor('window.__benchReady === true || window.__benchError', 30000);
        await sleep(1500);
        await chrome.evaluate("Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange'));");
        await sleep(6000); // shortened from 30s to fit the budget -- noted in the report
        const countBefore = await chrome.evaluate('window.__benchEffect.getTotalFrameCount()');

        await chrome.evaluate("Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange'));");
        let countAfter = countBefore;
        let resumedWithinMs = null;
        const pollStart = Date.now();

        while (Date.now() - pollStart < 5000) {
          await sleep(250);
          countAfter = await chrome.evaluate('window.__benchEffect.getTotalFrameCount()');
          if (countAfter > countBefore) { resumedWithinMs = Date.now() - pollStart; break; }
        }
        visibilityResults[engine] = { countBefore, countAfter, resumedWithinMs, loopResumed: countAfter > countBefore };
        console.log(`  ${engine}: resumed=${countAfter > countBefore} within=${resumedWithinMs}ms`);
      } finally {
        await chrome.close();
      }
    }
    saveJson('phase3-visibility-resume.json', visibilityResults);

    console.log(`\n[${elapsed()}] DONE.`);
  } finally {
    vite.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

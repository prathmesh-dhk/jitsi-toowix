#!/usr/bin/env node
// Phase 2 engine benchmark -- v1 vs mediapipe-cpu vs mediapipe-gpu, real camera input, real
// unmodified effect code (imported from ../src via bench/vite.bench.config.ts). See
// bench/REPORT.md for the write-up this script produces.
//
// Usage: node bench/run-bench.mjs "C:\path\to\your\video.mp4"
//
// Disk-space notes (see bench/REPORT.md "Environment" section for why these rules exist):
// - Fake camera clips are MJPEG, not Y4M (verified within noise of each other; MJPEG is >100x
//   smaller). Portrait source content is pillarboxed into 16:9 canvases because Chrome's
//   --use-file-for-fake-video-capture rejects portrait-dimensioned (width < height) files
//   outright (verified with both synthetic and real content).
// - Every run gets a fresh, disposable --user-data-dir, deleted right after that run closes.
// - Free space on C: is checked before every single Chrome launch; if under 500MB the script
//   stops, writes whatever results exist so far, and exits -- it does not guess or continue.
// - Resumable: a matrix cell already has a JSON result file it is skipped, so a re-run after a
//   stop (or a crash) only does the missing work.
import { spawn, spawnSync } from 'node:child_process';
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
const CLIP_SECONDS = 6; // Chrome loops a short fake-capture file automatically (verified).
const MIN_FREE_BYTES = 500 * 1024 * 1024;

for (const dir of [ MEDIA_DIR, RESULTS_DIR, SCREENSHOTS_DIR ]) fs.mkdirSync(dir, { recursive: true });

// ---- Disk space guard -----------------------------------------------------------------------
function freeBytesOnC() {
  const out = spawnSync('powershell', [ '-NoProfile', '-Command', "(Get-PSDrive C).Free" ], { encoding: 'utf8' });

  return parseInt(out.stdout.trim(), 10);
}

let stoppedForDiskSpace = false;

function checkDiskOrStop(context) {
  const free = freeBytesOnC();

  if (free < MIN_FREE_BYTES) {
    console.error(`\n!!! STOPPING: only ${Math.round(free / 1048576)}MB free on C: (need ${Math.round(MIN_FREE_BYTES / 1048576)}MB) before ${context}. Writing partial results and exiting.`);
    stoppedForDiskSpace = true;

    return false;
  }

  return true;
}

// ---- ffmpeg discovery: PATH first, then BENCH_FFMPEG_PATH env var, then the winget default. ----
function findFfmpeg() {
  const fromPath = spawnSync(process.platform === 'win32' ? 'where' : 'which', [ 'ffmpeg' ], { encoding: 'utf8' });

  if (fromPath.status === 0 && fromPath.stdout.trim()) {
    const exe = fromPath.stdout.trim().split(/\r?\n/)[0];

    return { ffmpeg: exe, ffprobe: exe.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1') };
  }
  if (process.env.BENCH_FFMPEG_PATH) {
    return { ffmpeg: process.env.BENCH_FFMPEG_PATH, ffprobe: process.env.BENCH_FFMPEG_PATH.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1') };
  }
  const wingetBase = path.join(
      process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages', 'Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe'
  );

  if (fs.existsSync(wingetBase)) {
    const buildDir = fs.readdirSync(wingetBase).find((d) => d.startsWith('ffmpeg-'));

    if (buildDir) {
      return {
        ffmpeg: path.join(wingetBase, buildDir, 'bin', 'ffmpeg.exe'),
        ffprobe: path.join(wingetBase, buildDir, 'bin', 'ffprobe.exe')
      };
    }
  }
  throw new Error('ffmpeg not found on PATH, BENCH_FFMPEG_PATH not set, and no winget install found. Install ffmpeg or set BENCH_FFMPEG_PATH.');
}

function run(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 50 });

  if (result.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(' ')}\n${result.stderr}`);
  }

  return result.stdout;
}

function ffprobeJson(ffprobe, file) {
  return JSON.parse(run(ffprobe, [ '-v', 'error', '-show_format', '-show_streams', '-print_format', 'json', file ]));
}

function evenRound(n) {
  const r = Math.round(n);

  return r % 2 === 0 ? r : r + 1;
}

// ---- Clip preparation: pillarboxed 16:9 MJPEG clips + one 16:9 center-crop MJPEG clip --------
function ensureClips(videoPath, ffmpeg, ffprobe) {
  const probe = ffprobeJson(ffprobe, videoPath);
  const videoStream = probe.streams.find((s) => s.codec_type === 'video');
  const srcWidth = videoStream.width;
  const srcHeight = videoStream.height;
  const isPortrait = srcHeight > srcWidth;
  const longEdge = Math.max(srcWidth, srcHeight);

  const canvases = { 480: [ 854, 480 ], 720: [ 1280, 720 ], 1080: [ 1920, 1080 ] };
  const clips = {};

  for (const [ hStr, [ canvasW, canvasH ] ] of Object.entries(canvases)) {
    const h = Number(hStr);
    const upscaled = h > longEdge;
    const contentW = isPortrait ? evenRound(srcWidth * (h / srcHeight)) : canvasW;
    const label = `${h}${upscaled ? '-UPSCALED' : ''}-pillarboxed16x9`;
    const file = path.join(MEDIA_DIR, `clip-${h}.mjpeg`);

    clips[h] = {
      file, canvasW, canvasH, contentW, contentH: h, upscaled, label,
      note: isPortrait
        ? `Portrait source (${srcWidth}x${srcHeight}) pillarboxed: real content scaled to ${contentW}x${h}, centered in a ${canvasW}x${canvasH} black canvas (Chrome's fake-video-capture rejects portrait-dimensioned files).`
        : `Source already landscape; scaled directly to ${canvasW}x${canvasH}.`
    };
    if (!fs.existsSync(file)) {
      console.log(`[ffmpeg] creating ${file} (${clips[h].note})`);
      const vf = isPortrait
        ? `scale=${contentW}:${h},pad=${canvasW}:${canvasH}:(ow-iw)/2:0:black`
        : `scale=${canvasW}:${canvasH}`;

      run(ffmpeg, [ '-y', '-i', videoPath, '-t', String(CLIP_SECONDS), '-vf', `${vf},fps=30`, path.resolve(file) ]);
    } else {
      console.log(`[ffmpeg] ${file} already exists, skipping`);
    }
  }

  // 16:9 center-crop (no pillarboxing, no black bars) for the edge-quality/polarity/alignment
  // visual checks -- person fills the frame, closer to a real webcam framing than the
  // pillarboxed timing clips are. Crop is the FULL source width, a 16:9-tall band taken from
  // the vertical middle of the frame.
  let edgeClip = null;

  if (isPortrait) {
    const cropW = evenRound(srcWidth);
    const cropH = evenRound(srcWidth * 9 / 16);
    const cropY = evenRound((srcHeight - cropH) / 2);
    const outW = 1280;
    const outH = 720;
    const upscaleFactor = outW / cropW;
    const file = path.join(MEDIA_DIR, 'clip-edge-crop.mjpeg');

    edgeClip = {
      file, cropW, cropH, cropY, srcWidth, srcHeight, outW, outH, upscaleFactor,
      note: `Cropped ${cropW}x${cropH} from (0,${cropY}) -- the full source width, vertical-middle ${cropH}px band of the ${srcWidth}x${srcHeight} source (discarding ~${cropY}px off the top and ~${srcHeight - cropY - cropH}px off the bottom) -- then upscaled ${upscaleFactor.toFixed(2)}x to ${outW}x${outH}.`
    };
    if (!fs.existsSync(file)) {
      console.log(`[ffmpeg] creating ${file} (${edgeClip.note})`);
      run(ffmpeg, [
        '-y', '-i', videoPath, '-t', String(CLIP_SECONDS),
        '-vf', `crop=${cropW}:${cropH}:0:${cropY},scale=${outW}:${outH},fps=30`,
        path.resolve(file)
      ]);
    }
  }

  return { probe, videoStream, isPortrait, srcWidth, srcHeight, clips, edgeClip, longEdge };
}

// ---- One bench run ------------------------------------------------------------------------
async function runOne({ engine, clipPath, headless = true, cpuThrottle = null, warmupMs = 5000, benchSeconds = 30, extraChromeArgs = [] }) {
  const extraArgs = [
    `--use-file-for-fake-video-capture=${clipPath}`,
    '--disk-cache-size=1',
    '--media-cache-size=1',
    ...extraChromeArgs
  ];
  const chrome = await launchChrome({ headless, extraArgs });
  const runInfo = { requestedEngine: engine, headless, cpuThrottle, clipPath, extraChromeArgs };

  try {
    await chrome.installLongTaskCounter();
    await chrome.enablePerformanceMetrics();
    await chrome.setLocalStorageBeforeLoad('toowix_bg_engine', engine);
    await chrome.navigate(VITE_URL);
    // 60s, not 30s: a freshly-spawned (cold) Vite dev server transforming the whole module graph
    // for the first time in this process, on top of MediaPipe's own WASM/model load, occasionally
    // pushed past 30s for a headed run in testing -- confirmed NOT a real functional failure (the
    // same run succeeds well under 30s once Vite is already warm), just budget for a cold start.
    await chrome.waitFor('window.__benchReady === true || window.__benchError', 60000);

    const startState = JSON.parse(await chrome.evaluate(
        'JSON.stringify({ error: window.__benchError, engine: window.__benchEffect && window.__benchEffect._engine })'
    ));

    if (startState.error) {
      runInfo.error = startState.error;
      runInfo.actualEngineAtStart = null;

      return runInfo;
    }
    runInfo.actualEngineAtStart = startState.engine;

    if (cpuThrottle) {
      await chrome.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle });
    }

    await sleep(warmupMs);

    // CPU%/long-task counts before the timed bench window, so the numbers reported are for the
    // bench window itself, not warmup -- Performance.getMetrics' TaskDuration is a cumulative
    // seconds-of-CPU-time-on-the-renderer-main-thread counter since the page loaded.
    const metricsBefore = await chrome.getPerformanceMetrics();
    const longTasksBefore = await chrome.evaluate('window.__benchLongTaskCount');
    const wallStart = Date.now();

    const perfCapBeforeBench = await chrome.evaluate('window.__benchEffect._perfCap');
    const benchResultRaw = await chrome.evaluate(`window.__bgBench(${benchSeconds})`, true);
    const perfCapAfterBench = await chrome.evaluate('window.__benchEffect._perfCap');
    const engineAfterBench = await chrome.evaluate('window.__benchEffect._engine');
    const overlayMetricsRaw = await chrome.evaluate('JSON.stringify(window.__benchEffect._lastOverlayMetrics)');

    const metricsAfter = await chrome.getPerformanceMetrics();
    const longTasksAfter = await chrome.evaluate('window.__benchLongTaskCount');
    const wallSeconds = (Date.now() - wallStart) / 1000;
    const taskDurationDelta = (metricsAfter.TaskDuration ?? 0) - (metricsBefore.TaskDuration ?? 0);

    runInfo.bench = benchResultRaw;
    runInfo.perfCapBeforeBench = perfCapBeforeBench;
    runInfo.perfCapAfterBench = perfCapAfterBench;
    runInfo.perfCapStepped = perfCapBeforeBench !== perfCapAfterBench;
    runInfo.actualEngineAfterBench = engineAfterBench;
    runInfo.silentlyFellBackToV1 = engine !== 'v1' && engineAfterBench === 'v1';
    runInfo.lastOverlayMetrics = JSON.parse(overlayMetricsRaw || 'null');
    // Renderer main-thread CPU% over the bench window (TaskDuration is main-thread-only, so this
    // is NOT total-system CPU%; it's how much of the bench window the renderer's main thread was
    // busy, which is exactly what a frame-time-driven regression should show up in). longTaskCount
    // is null if PerformanceObserver('longtask') isn't supported in this Chrome build.
    runInfo.cpu = {
      taskDurationSeconds: Math.round(taskDurationDelta * 1000) / 1000,
      wallSeconds: Math.round(wallSeconds * 1000) / 1000,
      cpuPercent: wallSeconds > 0 ? Math.round((taskDurationDelta / wallSeconds) * 1000) / 10 : null,
      longTaskCount: (typeof longTasksAfter === 'number' && typeof longTasksBefore === 'number')
        ? longTasksAfter - longTasksBefore
        : null
    };
    runInfo.consoleErrors = chrome.consoleLines.filter((l) => l.type === 'error').map((l) => l.text);
    runInfo.exceptions = chrome.exceptions;

    // Phase 2c Step 4 (headed mediapipe-cpu anomaly): tick spacing and document.hidden/
    // visibilityState around the run, straight from the bench harness's own instrumentation
    // (bench/harness/main.ts) -- never added to product code.
    const tickTimestamps = await chrome.evaluate('window.__benchTickTimestamps');
    const visibilityLog = await chrome.evaluate('window.__benchVisibilityLog');
    const docState = JSON.parse(await chrome.evaluate(
        'JSON.stringify({ hidden: document.hidden, visibilityState: document.visibilityState })'
    ));

    if (Array.isArray(tickTimestamps) && tickTimestamps.length > 1) {
      const gaps = [];

      for (let i = 1; i < tickTimestamps.length; i++) gaps.push(tickTimestamps[i] - tickTimestamps[i - 1]);
      const sortedGaps = [ ...gaps ].sort((a, b) => a - b);

      runInfo.tickSpacing = {
        sampleCount: tickTimestamps.length,
        avgGapMs: Math.round((gaps.reduce((a, b) => a + b, 0) / gaps.length) * 10) / 10,
        maxGapMs: Math.round(sortedGaps[sortedGaps.length - 1] * 10) / 10,
        p95GapMs: Math.round(sortedGaps[Math.min(sortedGaps.length - 1, Math.ceil(sortedGaps.length * 0.95) - 1)] * 10) / 10
      };
    }
    runInfo.documentStateAtEnd = docState;
    runInfo.visibilityLog = visibilityLog;
  } finally {
    await chrome.close();
  }

  return runInfo;
}

function saveJson(name, data) {
  fs.writeFileSync(path.join(RESULTS_DIR, name), JSON.stringify(data, null, 2));
  console.log(`  saved ${name}`);
}

function resultExists(name) {
  return fs.existsSync(path.join(RESULTS_DIR, name));
}

function loadJsonIfExists(name) {
  const p = path.join(RESULTS_DIR, name);

  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

async function startViteServer() {
  console.log('[vite] starting bench harness server...');
  const vite = spawn('npx', [ 'vite', '--config', 'bench/vite.bench.config.ts' ], {
    cwd: path.join(BENCH_DIR, '..'),
    shell: true,
    stdio: [ 'ignore', 'pipe', 'pipe' ]
  });
  let ready = false;

  vite.stdout.on('data', (d) => { if (d.toString().includes('ready in')) ready = true; });
  for (let i = 0; i < 100 && !ready; i++) await sleep(100);
  await sleep(500);

  return vite;
}

// ---- Main -----------------------------------------------------------------------------------
async function main() {
  const videoPath = process.argv[2];

  if (!videoPath) {
    console.error('Usage: node bench/run-bench.mjs "C:\\path\\to\\video.mp4"');
    process.exit(1);
  }

  const { ffmpeg, ffprobe } = findFfmpeg();

  console.log('ffmpeg:', ffmpeg);
  console.log('ffprobe:', ffprobe);

  const clipInfo = ensureClips(videoPath, ffmpeg, ffprobe);

  saveJson('source-video-facts.json', clipInfo);

  const vite = await startViteServer();
  const failures = loadJsonIfExists('failures.json') || [];
  const engines = [ 'v1', 'mediapipe-cpu', 'mediapipe-gpu' ];
  const heights = [ 480, 720, 1080 ];

  try {
    // ---- Block 2: main matrix, 3 engines x 3 heights x 3 repeats = 27 runs --------------------
    console.log('\n########## BLOCK: main matrix (27 runs) ##########');
    for (const engine of engines) {
      for (const height of heights) {
        const clip = clipInfo.clips[height];

        for (let rep = 1; rep <= 3; rep++) {
          const name = `${engine}-${height}-rep${rep}.json`;

          if (resultExists(name)) { console.log(`  skip (exists): ${name}`); continue; }
          if (!checkDiskOrStop(name)) break;
          console.log(`\n=== ${name} (${clip.label}) ===`);
          try {
            const result = await runOne({ engine, clipPath: clip.file });

            result.clipInfo = clip;
            saveJson(name, result);
          } catch (err) {
            console.error(`FAILED: ${name}:`, err.message);
            failures.push({ label: name, error: err.message });
            saveJson('failures.json', failures);
          }
        }
        if (stoppedForDiskSpace) break;
      }
      if (stoppedForDiskSpace) break;
    }
    if (stoppedForDiskSpace) { saveJson('failures.json', failures); return; }

    // ---- Block 3: CPU-throttled runs, 3 engines x [4x,6x] x 3 repeats @ 720p = 18 runs --------
    console.log('\n########## BLOCK: CPU-throttled runs (18 runs) ##########');
    for (const engine of engines) {
      for (const rate of [ 4, 6 ]) {
        for (let rep = 1; rep <= 3; rep++) {
          const name = `throttle-${engine}-${rate}x-720-rep${rep}.json`;

          if (resultExists(name)) { console.log(`  skip (exists): ${name}`); continue; }
          if (!checkDiskOrStop(name)) break;
          console.log(`\n=== ${name} ===`);
          try {
            const result = await runOne({ engine, clipPath: clipInfo.clips[720].file, cpuThrottle: rate });

            saveJson(name, result);
          } catch (err) {
            console.error(`FAILED: ${name}:`, err.message);
            failures.push({ label: name, error: err.message });
            saveJson('failures.json', failures);
          }
        }
        if (stoppedForDiskSpace) break;
      }
      if (stoppedForDiskSpace) break;
    }
    if (stoppedForDiskSpace) { saveJson('failures.json', failures); return; }

    // ---- Block 4: visual checks ----------------------------------------------------------------
    console.log('\n########## BLOCK: visual checks ##########');
    const visualChecks = loadJsonIfExists('visual-checks.json') || { edgeCrop: [], edgeComparison: {} };

    if (clipInfo.edgeClip) {
      // Phase 2c fix: the old delays (15000, 21000) both reduced mod the 6s loop to the SAME
      // 3000ms offset, so "headturn" and "handraised" were pixel-identical screenshots of the
      // same moment. These three are distinct offsets within one CLIP_SECONDS (6s) loop.
      for (const [ moment, delayMs ] of [ [ 'still', 1000 ], [ 'headturn', 3000 ], [ 'handraised', 5000 ] ]) {
        const file = `mask-debug-edgecrop-${moment}.png`;

        if (fs.existsSync(path.join(SCREENSHOTS_DIR, file))) { console.log(`  skip (exists): ${file}`); continue; }
        if (!checkDiskOrStop(file)) break;
        const chrome = await launchChrome({ headless: true, extraArgs: [ `--use-file-for-fake-video-capture=${clipInfo.edgeClip.file}`, '--disk-cache-size=1', '--media-cache-size=1' ] });

        try {
          await chrome.setLocalStorageBeforeLoad('toowix_bg_engine', 'mediapipe-cpu');
          await chrome.setLocalStorageBeforeLoad('toowix_bg_debug_mask', '1');
          await chrome.navigate(VITE_URL);
          await chrome.waitFor('window.__benchReady === true || window.__benchError', 30000);
          await sleep(delayMs);
          await chrome.screenshot(path.join(SCREENSHOTS_DIR, file));
          visualChecks.edgeCrop.push({ moment, delayMs, file });
          console.log(`  saved ${file}`);
        } catch (err) {
          failures.push({ label: `visual-edgecrop-${moment}`, error: err.message });
        } finally {
          await chrome.close();
        }
      }

      for (const engine of [ 'v1', 'mediapipe-cpu' ]) {
        const file = `edge-compare-${engine}.png`;
        // Phase 2c: a 2x-zoomed crop of the head/hair/ear region (top-left quadrant of the
        // 1280x720 edge-crop clip, where hair/ear edge detail actually is), not the whole
        // ~320px preview -- lets the edge-quality comparison actually resolve fine detail.
        const zoomFile = `edge-compare-${engine}-zoomed-head.png`;

        const needsWide = !fs.existsSync(path.join(SCREENSHOTS_DIR, file));
        const needsZoom = !fs.existsSync(path.join(SCREENSHOTS_DIR, zoomFile));

        if (!needsWide && !needsZoom) { console.log(`  skip (exists): ${file}, ${zoomFile}`); continue; }
        if (!checkDiskOrStop(file)) break;
        const chrome = await launchChrome({ headless: true, extraArgs: [ `--use-file-for-fake-video-capture=${clipInfo.edgeClip.file}`, '--disk-cache-size=1', '--media-cache-size=1' ] });

        try {
          await chrome.setLocalStorageBeforeLoad('toowix_bg_engine', engine);
          await chrome.navigate(VITE_URL);
          await chrome.waitFor('window.__benchReady === true || window.__benchError', 30000);
          await sleep(3000);
          if (needsWide) {
            await chrome.screenshot(path.join(SCREENSHOTS_DIR, file));
            visualChecks.edgeComparison[engine] = file;
            console.log(`  saved ${file}`);
          }
          if (needsZoom) {
            // The <video id="self"> element fills the page's top-left in bench/harness/index.html
            // at 320x180 CSS px (see that file) -- crop roughly its top-left quadrant (head/hair)
            // and render it at 2x.
            await chrome.screenshotClip(path.join(SCREENSHOTS_DIR, zoomFile), { height: 90, width: 160, x: 0, y: 0 });
            visualChecks.edgeComparisonZoomed = visualChecks.edgeComparisonZoomed || {};
            visualChecks.edgeComparisonZoomed[engine] = zoomFile;
            console.log(`  saved ${zoomFile}`);
          }
        } catch (err) {
          failures.push({ label: `edge-compare-${engine}`, error: err.message });
        } finally {
          await chrome.close();
        }
      }
    }
    saveJson('visual-checks.json', visualChecks);
    if (stoppedForDiskSpace) { saveJson('failures.json', failures); return; }

    // ---- Block 5: stability checks --------------------------------------------------------------
    console.log('\n########## BLOCK: stability checks ##########');
    if (!resultExists('toggle-stability.json') && checkDiskOrStop('toggle-stability')) {
      let toggleStability = null;

      try {
        const chrome = await launchChrome({ headless: true, extraArgs: [ `--use-file-for-fake-video-capture=${clipInfo.clips[720].file}`, '--disk-cache-size=1', '--media-cache-size=1' ] });

        try {
          await chrome.setLocalStorageBeforeLoad('toowix_bg_engine', 'v1');
          await chrome.navigate(VITE_URL);
          await chrome.waitFor('window.__benchReady === true || window.__benchError', 30000);
          await sleep(2000);

          // Phase 2c: 3 rounds of 20 toggles (60 total), forcing a real GC pass after each round
          // (CDP HeapProfiler.collectGarbage) before measuring heap -- a single before/after
          // reading (the Phase 2 version of this check) can't tell "heap grows every round" from
          // "GC just hadn't run yet".
          const rounds = [];

          for (let round = 1; round <= 3; round++) {
            for (let i = 0; i < 20; i++) {
              await chrome.evaluate('window.__benchToggle()');
              await sleep(300);
            }
            await chrome.collectGarbage();
            await sleep(500);
            const heapMB = await chrome.evaluate('performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null');

            rounds.push({ round, heapMB: heapMB !== null ? Math.round(heapMB * 10) / 10 : null });
          }

          const heapValues = rounds.map((r) => r.heapMB).filter((v) => v !== null);

          toggleStability = {
            heapAvailable: heapValues.length > 0,
            rounds,
            // A simple monotonic-growth check across the 3 post-GC readings -- true only if every
            // round's post-GC heap is higher than the previous one (a real leak signature, not
            // just GC-timing noise, since GC already ran before each reading).
            growsEveryRound: heapValues.length === 3 && heapValues[1] > heapValues[0] && heapValues[2] > heapValues[1],
            consoleErrors: chrome.consoleLines.filter((l) => l.type === 'error').map((l) => l.text),
            exceptions: chrome.exceptions
          };
        } finally {
          await chrome.close();
        }
      } catch (err) {
        failures.push({ label: 'toggle-stability', error: err.message });
      }
      saveJson('toggle-stability.json', toggleStability);
    } else console.log('  skip (exists): toggle-stability.json');

    // Phase 2c: run the visibility-resume check for all 3 engines (Phase 2 only tested
    // mediapipe-gpu), and use the monotonic getTotalFrameCount() instead of _debugAccum.count --
    // that resets every ~1s log interval, so a lower second reading did NOT actually prove the
    // loop had stopped (a real flaw in the Phase 2 version of this check, documented in
    // bench/REPORT.md rather than reported as a false "GPU doesn't resume" finding).
    if (!resultExists('visibility-stability.json') && checkDiskOrStop('visibility-stability')) {
      const perEngine = {};

      for (const engine of [ 'v1', 'mediapipe-cpu', 'mediapipe-gpu' ]) {
        try {
          const chrome = await launchChrome({ headless: true, extraArgs: [ `--use-file-for-fake-video-capture=${clipInfo.clips[720].file}`, '--disk-cache-size=1', '--media-cache-size=1' ] });

          try {
            await chrome.setLocalStorageBeforeLoad('toowix_bg_engine', engine);
            await chrome.navigate(VITE_URL);
            await chrome.waitFor('window.__benchReady === true || window.__benchError', 30000);
            await sleep(2000);
            await chrome.evaluate("Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange'));");
            await sleep(30000);
            const countBeforeResume = await chrome.evaluate('window.__benchEffect.getTotalFrameCount()');

            await chrome.evaluate("Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange'));");

            // Poll for up to 5s for the counter to advance, rather than one fixed sleep+read --
            // matches the plan's "advances again within 5 s" requirement directly.
            let countAfterResume = countBeforeResume;
            let resumedWithinMs = null;
            const pollStart = Date.now();

            while (Date.now() - pollStart < 5000) {
              await sleep(250);
              countAfterResume = await chrome.evaluate('window.__benchEffect.getTotalFrameCount()');
              if (countAfterResume > countBeforeResume) {
                resumedWithinMs = Date.now() - pollStart;
                break;
              }
            }

            perEngine[engine] = {
              engineAfter: await chrome.evaluate('window.__benchEffect._engine'),
              totalFrameCountBeforeResume: countBeforeResume,
              totalFrameCountAfterPoll: countAfterResume,
              resumedWithinMs,
              loopResumed: countAfterResume > countBeforeResume,
              consoleErrors: chrome.consoleLines.filter((l) => l.type === 'error').map((l) => l.text)
            };
          } finally {
            await chrome.close();
          }
        } catch (err) {
          perEngine[engine] = { error: err.message };
          failures.push({ label: `visibility-stability-${engine}`, error: err.message });
        }
      }
      saveJson('visibility-stability.json', perEngine);
    } else console.log('  skip (exists): visibility-stability.json');
    if (stoppedForDiskSpace) { saveJson('failures.json', failures); return; }

    // ---- Block 5b: headed mediapipe-cpu anomaly investigation --------------------------------
    // Phase 2c Step 4: test hypothesis (c) first (renderer/timer throttling specific to a real
    // window), then hypothesis (d) (cold start/warmup) -- both compared against a plain headed
    // baseline, all three using the same tick-spacing/visibility instrumentation.
    console.log('\n########## BLOCK: headed mediapipe-cpu anomaly investigation ##########');
    const anomalyRuns = [
      { name: 'anomaly-mediapipe-cpu-baseline.json', extraChromeArgs: [], warmupMs: 3000 },
      {
        name: 'anomaly-mediapipe-cpu-no-throttling-flags.json',
        extraChromeArgs: [ '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows' ],
        warmupMs: 3000
      },
      { name: 'anomaly-mediapipe-cpu-long-warmup.json', extraChromeArgs: [], warmupMs: 15000 }
    ];

    for (const { name, extraChromeArgs, warmupMs } of anomalyRuns) {
      if (resultExists(name)) { console.log(`  skip (exists): ${name}`); continue; }
      if (!checkDiskOrStop(name)) break;
      console.log(`  ${name}...`);
      try {
        const result = await runOne({
          engine: 'mediapipe-cpu', clipPath: clipInfo.clips[720].file, headless: false,
          benchSeconds: 10, warmupMs, extraChromeArgs
        });

        saveJson(name, result);
      } catch (err) {
        console.error(`FAILED: ${name}:`, err.message);
        failures.push({ label: name, error: err.message });
        saveJson('failures.json', failures);
      }
    }
    if (stoppedForDiskSpace) { saveJson('failures.json', failures); return; }

    // ---- Block 6: headed sanity run --------------------------------------------------------------
    console.log('\n########## BLOCK: headed sanity run ##########');
    for (const engine of [ 'v1', 'mediapipe-cpu' ]) {
      const name = `headed-${engine}-720.json`;

      if (resultExists(name)) { console.log(`  skip (exists): ${name}`); continue; }
      if (!checkDiskOrStop(name)) break;
      console.log(`  ${name}...`);
      try {
        const result = await runOne({ engine, clipPath: clipInfo.clips[720].file, headless: false, benchSeconds: 10, warmupMs: 3000 });

        saveJson(name, result);
      } catch (err) {
        console.error(`FAILED: ${name}:`, err.message);
        failures.push({ label: name, error: err.message });
      }
    }

    saveJson('failures.json', failures);
    console.log(`\nDone. ${failures.length} failure(s).`);
    if (failures.length) console.log(failures);
  } finally {
    vite.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env node
/*
 * Controlled two-participant browser benchmark for Toowix Meet and official Jitsi Meet.
 *
 * It intentionally records statistics, not audio/video content. Run it once per product under
 * the same devices, networks, browser version and duration, then pass both JSON reports to
 * --compare. Authentication, lobby admission and permission prompts remain user actions.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const WebSocket = require('../node_modules/ws');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const usage = `
Usage:
  node scripts/benchmark-meeting-quality.cjs run --product toowix --host URL --guest URL [--duration 180] [--scenario "Desktop Wi-Fi, camera"]
  node scripts/benchmark-meeting-quality.cjs run --product jitsi  --host URL --guest URL [--duration 180] [--scenario "Desktop Wi-Fi, camera"]
  node scripts/benchmark-meeting-quality.cjs compare --toowix REPORT.json --jitsi REPORT.json

The run command opens two separate Chrome profiles. Join the same room in both windows, then
press Enter here. It collects WebRTC getStats(), connection changes, request counts and browser
long-task counts. It never records camera, microphone or chat content.
`;
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log(usage.trim());
  process.exit(0);
}

const option = name => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const isUrl = value => {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol); } catch { return false; }
};
const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
].filter(Boolean);
const chromePath = chromeCandidates.find(candidate => fs.existsSync(candidate));

function prompt(message) {
  const input = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => input.question(message, answer => { input.close(); resolve(answer); }));
}

function sanitizeStatsExpression() {
  return `
    (async () => {
      const state = window.__toowixMeetingBenchmark;
      if (!state) return { unavailable: true };
      const reports = [];
      for (const [index, pc] of state.pcs.entries()) {
        const stats = await pc.getStats();
        const byId = new Map();
        stats.forEach(item => byId.set(item.id, item));
        const selectedPairs = [];
        stats.forEach(item => {
          if (item.type !== 'candidate-pair' || item.state !== 'succeeded') return;
          const selected = item.selected === true || item.nominated === true
            || [...stats.values()].some(other => other.type === 'transport' && other.selectedCandidatePairId === item.id);
          if (!selected) return;
          const local = byId.get(item.localCandidateId);
          const remote = byId.get(item.remoteCandidateId);
          selectedPairs.push({
            availableOutgoingBitrate: item.availableOutgoingBitrate ?? null,
            currentRoundTripTime: item.currentRoundTripTime ?? null,
            localCandidateType: local?.candidateType ?? null,
            remoteCandidateType: remote?.candidateType ?? null,
          });
        });
        const media = [];
        stats.forEach(item => {
          if (!['inbound-rtp', 'outbound-rtp'].includes(item.type) || item.isRemote) return;
          const kind = item.kind || item.mediaType;
          if (!['audio', 'video'].includes(kind)) return;
          media.push({
            bytesReceived: item.bytesReceived ?? null,
            bytesSent: item.bytesSent ?? null,
            framesDecoded: item.framesDecoded ?? null,
            framesPerSecond: item.framesPerSecond ?? null,
            framesSent: item.framesSent ?? null,
            frameHeight: item.frameHeight ?? null,
            frameWidth: item.frameWidth ?? null,
            jitter: item.jitter ?? null,
            kind,
            packetsLost: item.packetsLost ?? null,
            packetsReceived: item.packetsReceived ?? null,
            packetsSent: item.packetsSent ?? null,
            type: item.type,
          });
        });
        reports.push({ connectionState: pc.connectionState, iceConnectionState: pc.iceConnectionState, media, selectedPairs, index });
      }
      return {
        connectionEvents: state.connectionEvents,
        longTasks: state.longTasks.length,
        navigationStartedAt: state.navigationStartedAt,
        pcs: reports,
        requestCount: state.requests.length,
        timestamp: Date.now(),
      };
    })()`;
}

const instrumentation = `
(() => {
  const state = window.__toowixMeetingBenchmark = { connectionEvents: [], longTasks: [], navigationStartedAt: Date.now(), pcs: [], requests: [] };
  const NativePeerConnection = window.RTCPeerConnection;
  if (NativePeerConnection) {
    function BenchmarkedPeerConnection(...params) {
      const pc = new NativePeerConnection(...params);
      state.pcs.push(pc);
      const record = () => state.connectionEvents.push({ state: pc.connectionState, time: Date.now() });
      pc.addEventListener('connectionstatechange', record);
      pc.addEventListener('iceconnectionstatechange', record);
      return pc;
    }
    BenchmarkedPeerConnection.prototype = NativePeerConnection.prototype;
    Object.setPrototypeOf(BenchmarkedPeerConnection, NativePeerConnection);
    window.RTCPeerConnection = BenchmarkedPeerConnection;
  }
  const nativeFetch = window.fetch;
  if (nativeFetch) window.fetch = (...params) => {
    state.requests.push({ method: params[1]?.method || 'GET', time: Date.now(), url: String(params[0]).split('?')[0] });
    return nativeFetch(...params);
  };
  const nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    state.requests.push({ method, time: Date.now(), url: String(url).split('?')[0] });
    return nativeOpen.call(this, method, url, ...rest);
  };
  try {
    new PerformanceObserver(list => list.getEntries().forEach(entry => state.longTasks.push({ duration: entry.duration, time: Date.now() }))).observe({ type: 'longtask', buffered: true });
  } catch { /* Long Task API is not supported by every browser. */ }
})()`;

async function launchParticipant(label, url) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `toowix-${label}-benchmark-`));
  const chrome = spawn(chromePath, [
    '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, '--autoplay-policy=no-user-gesture-required', 'about:blank',
  ], { windowsHide: false, stdio: 'ignore' });
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; break; } catch { await delay(100); }
  }
  if (!port) throw new Error(`Chrome did not start for ${label}`);
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const target = targets.find(item => item.type === 'page');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  let requestId = 0;
  const pending = new Map();
  socket.on('message', raw => {
    const message = JSON.parse(raw);
    if (!message.id || !pending.has(message.id)) return;
    const item = pending.get(message.id); pending.delete(message.id);
    message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++requestId;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: instrumentation });
  await send('Page.navigate', { url });
  return {
    async sample() {
      const result = await send('Runtime.evaluate', { expression: sanitizeStatsExpression(), awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      return result.result.value;
    },
    async close() {
      try { await send('Browser.close'); } catch { chrome.kill(); }
      socket.close();
    }
  };
}

function numeric(values) { return values.filter(value => Number.isFinite(value)); }
function average(values) { const list = numeric(values); return list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : null; }
function median(values) { const list = numeric(values).sort((a, b) => a - b); return list.length ? list[Math.floor(list.length / 2)] : null; }
function mediaTotals(sample) {
  const totals = { audio: { lost: 0, received: 0 }, video: { lost: 0, received: 0, frames: 0, bytes: 0 } };
  for (const pc of sample.pcs || []) for (const item of pc.media || []) {
    const group = totals[item.kind]; if (!group) continue;
    group.lost += item.packetsLost || 0;
    group.received += item.packetsReceived || item.packetsSent || 0;
    if (item.kind === 'video') { group.frames += item.framesDecoded || item.framesSent || 0; group.bytes += item.bytesReceived || item.bytesSent || 0; }
  }
  return totals;
}
function summarize(samples) {
  const first = samples[0]; const last = samples.at(-1);
  const elapsedSeconds = Math.max(1, (last.timestamp - first.timestamp) / 1000);
  const before = mediaTotals(first); const after = mediaTotals(last);
  const delta = kind => ({ lost: Math.max(0, after[kind].lost - before[kind].lost), received: Math.max(0, after[kind].received - before[kind].received) });
  const audio = delta('audio'); const video = delta('video');
  const pairValues = field => samples.flatMap(sample => sample.pcs.flatMap(pc => pc.selectedPairs.map(pair => pair[field])));
  const fps = samples.flatMap(sample => sample.pcs.flatMap(pc => pc.media.filter(item => item.kind === 'video').map(item => item.framesPerSecond)));
  const candidates = [...new Set(samples.flatMap(sample => sample.pcs.flatMap(pc => pc.selectedPairs.map(pair => `${pair.localCandidateType || 'unknown'}→${pair.remoteCandidateType || 'unknown'}`))))];
  const events = samples.flatMap(sample => sample.connectionEvents || []);
  const connectedAt = events.find(event => event.state === 'connected')?.time || null;
  const disconnected = events.filter(event => ['disconnected', 'failed'].includes(event.state)).length;
  return {
    audioPacketLossPercent: audio.received + audio.lost ? (audio.lost * 100) / (audio.received + audio.lost) : null,
    browserLongTasks: samples.at(-1).longTasks ?? null,
    browserRequestCount: samples.at(-1).requestCount ?? null,
    candidateTypes: candidates,
    connectionInterruptions: disconnected,
    durationSeconds: elapsedSeconds,
    medianAvailableOutgoingBitrateKbps: (median(pairValues('availableOutgoingBitrate')) || 0) / 1000 || null,
    medianRttMs: (median(pairValues('currentRoundTripTime')) || 0) * 1000 || null,
    medianVideoFps: median(fps),
    timeToFirstConnectedMs: connectedAt ? connectedAt - first.navigationStartedAt : null,
    videoPacketLossPercent: video.received + video.lost ? (video.lost * 100) / (video.received + video.lost) : null,
  };
}

async function run() {
  const product = option('--product'); const hostUrl = option('--host'); const guestUrl = option('--guest');
  const durationSeconds = Math.max(30, Number(option('--duration') || 180));
  const scenario = option('--scenario') || 'Unspecified controlled scenario';
  if (!['toowix', 'jitsi'].includes(product) || !isUrl(hostUrl) || !isUrl(guestUrl)) throw new Error(usage);
  if (!chromePath) throw new Error('Chrome was not found. Set CHROME_PATH to chrome.exe.');
  console.log(`Opening two ${product} participants. Complete sign-in, admission and media permissions in both windows.`);
  const host = await launchParticipant(`${product}-host`, hostUrl);
  const guest = await launchParticipant(`${product}-guest`, guestUrl);
  await prompt('When both participants are joined with camera and microphone active, press Enter to begin sampling. ');
  const startedAt = Date.now(); const samples = [];
  try {
    while (Date.now() - startedAt < durationSeconds * 1000) {
      const [hostSample, guestSample] = await Promise.all([host.sample(), guest.sample()]);
      samples.push({ timestamp: Date.now(), host: hostSample, guest: guestSample });
      process.stdout.write(`Collected ${samples.length} sample(s)\r`);
      await delay(1000);
    }
  } finally { await Promise.all([host.close(), guest.close()]); }
  console.log('');
  const report = {
    createdAt: new Date().toISOString(), durationSeconds, product, scenario,
    participants: { host: summarize(samples.map(sample => sample.host)), guest: summarize(samples.map(sample => sample.guest)) },
    samples,
    privacy: 'Statistics only: no media, chat contents, IP addresses, ICE credentials or authentication tokens are written.',
  };
  const directory = path.join(root, 'reports', 'benchmarks'); fs.mkdirSync(directory, { recursive: true });
  const filename = `${product}-meeting-benchmark-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const output = path.join(directory, filename); fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(`Report: ${output}`);
}

function readReport(file) { return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')); }
function meanParticipants(report, field) { return average(Object.values(report.participants).map(participant => participant[field])); }
function compareMetric(name, toowix, jitsi, lowerIsBetter) {
  if (!Number.isFinite(toowix) || !Number.isFinite(jitsi)) return `| ${name} | unavailable | unavailable | Not enough live media data |`;
  const difference = toowix - jitsi; const tolerance = Math.max(Math.abs(jitsi) * 0.05, lowerIsBetter ? 1 : 0.5);
  const better = lowerIsBetter ? difference < -tolerance : difference > tolerance;
  const worse = lowerIsBetter ? difference > tolerance : difference < -tolerance;
  return `| ${name} | ${toowix.toFixed(2)} | ${jitsi.toFixed(2)} | ${better ? 'Toowix better' : worse ? 'Toowix worse' : 'Equivalent within 5% tolerance'} |`;
}
function compare() {
  const toowix = readReport(option('--toowix')); const jitsi = readReport(option('--jitsi'));
  const compatible = toowix.scenario === jitsi.scenario && Math.abs(toowix.durationSeconds - jitsi.durationSeconds) <= 15;
  const rows = [
    compareMetric('Time to first connected (ms)', meanParticipants(toowix, 'timeToFirstConnectedMs'), meanParticipants(jitsi, 'timeToFirstConnectedMs'), true),
    compareMetric('Median RTT (ms)', meanParticipants(toowix, 'medianRttMs'), meanParticipants(jitsi, 'medianRttMs'), true),
    compareMetric('Audio packet loss (%)', meanParticipants(toowix, 'audioPacketLossPercent'), meanParticipants(jitsi, 'audioPacketLossPercent'), true),
    compareMetric('Video packet loss (%)', meanParticipants(toowix, 'videoPacketLossPercent'), meanParticipants(jitsi, 'videoPacketLossPercent'), true),
    compareMetric('Median video FPS', meanParticipants(toowix, 'medianVideoFps'), meanParticipants(jitsi, 'medianVideoFps'), false),
    compareMetric('Connection interruptions', meanParticipants(toowix, 'connectionInterruptions'), meanParticipants(jitsi, 'connectionInterruptions'), true),
  ];
  const markdown = `# Toowix Meet vs Jitsi Meet — Live Benchmark Comparison\n\nScenario match: **${compatible ? 'Yes' : 'No — do not treat this as a fair quality comparison'}**\n\n| Metric | Toowix | Official Jitsi | Result |\n|---|---:|---:|---|\n${rows.join('\n')}\n\n## Evidence\n\n- Toowix report: \`${path.resolve(option('--toowix'))}\`\n- Jitsi report: \`${path.resolve(option('--jitsi'))}\`\n- Scenario: ${toowix.scenario}\n- Content was not captured; this comparison uses browser WebRTC statistics only.\n\n## Interpretation\n\nA result is valid only when devices, browser versions, networks, participant count, media settings and duration match. Better packet loss/RTT/interruptions and equal-or-better FPS indicate an improvement. Do not judge quality from bitrate alone.\n`;
  const directory = path.join(root, 'reports', 'benchmarks'); fs.mkdirSync(directory, { recursive: true });
  const output = path.join(directory, `toowix-vs-jitsi-live-comparison-${new Date().toISOString().slice(0, 10)}.md`);
  fs.writeFileSync(output, markdown); console.log(`Comparison: ${output}`);
}

(async () => {
  if (args[0] === 'run') await run();
  else if (args[0] === 'compare') compare();
  else throw new Error(usage);
})().catch(error => { console.error(error.message || error); process.exitCode = 1; });

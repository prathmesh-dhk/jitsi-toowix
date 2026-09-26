#!/usr/bin/env node
/*
 * Static performance-regression guard for the Toowix meeting path.
 *
 * It deliberately does not claim real-call media quality: packet loss, FPS, join time and
 * browser CPU require controlled two-device call tests. This guard verifies the architecture
 * choices that keep browser and API work low between those tests.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const hook = read('toowix-web-app/src/lib/useJitsiMeeting.ts');
const quality = read('toowix-web-app/src/lib/networkQuality.ts');
const page = read('toowix-web-app/src/pages/MeetingRoomPage.tsx');
const app = read('toowix-web-app/src/App.tsx');
const signalBackend = read('toowix-backend/src/meetings/waitingRoom.ts');
const signalRoutes = read('toowix-backend/src/routes/meeting.routes.ts');
const checks = [];

function check(name, condition, detail) {
  try {
    assert(condition, detail);
    checks.push({ name, status: 'PASS', detail });
    console.log(`PASS ${name}`);
  } catch (error) {
    checks.push({ name, status: 'FAIL', detail: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

check('Low-frequency WebRTC telemetry', /NETWORK_STATS_INTERVAL_MS\s*=\s*5000/.test(quality),
  'Network telemetry must be sampled every 5 seconds, not as a second high-frequency media controller.');
check('Jitsi owns automatic quality', /if \(requestedMode === 'auto'\)[\s\S]{0,500}?if \(!lowDataPolicyActiveRef\.current\)\s*\{\s*return;/.test(hook),
  'Auto mode must not repeatedly apply Toowix sender/receiver constraints.');
check('Explicit low-data policy retained', /getMediaQualityPolicy\(requestedMode, 'GOOD'/.test(hook)
  && /setLastN\?\.\(policy\.lastN\)/.test(hook),
  'Low Data and Audio-only modes must retain their deliberate Jitsi constraints.');
check('Current-window packet-loss telemetry', /const lostDelta = previousPackets/.test(hook)
  && /packetLossPercent: previousPackets && packetTotal > 0/.test(hook),
  'Packet-loss status must use sample deltas, not lifetime loss.');
check('Virtual background is demand-loaded', /await import\('\.\/virtualBackground\/createVirtualBackgroundEffect'\)/.test(hook),
  'Virtual-background runtime must remain dynamically imported.');
check('Noise suppression is demand-loaded', /await import\('\.\/noiseSuppression\/NoiseSuppressionEffect'\)/.test(hook),
  'Noise-suppression runtime must remain dynamically imported.');
check('Prejoin background has bounded retries', /attempts\+\+ < 10/.test(page)
  && !/setInterval\(\(\) => void tick\(\), 600\)/.test(page),
  'Prejoin background setup must not leave a permanent 600ms polling loop.');
check('PiP render budget', /setInterval\(drawPipFrame, 100\)/.test(page),
  'PiP canvas must render at 10fps.');
check('Persistent room-signal stream', /new EventSource\(/.test(page)
  && /signal\/stream\?since=/.test(page),
  'Room signals must use one persistent SSE connection instead of interval polling.');
check('Server-side room-signal publisher', /export function streamSignalsHandler/.test(signalBackend)
  && /publishRoomSignal\(room, signal\)/.test(signalBackend)
  && /signal\/stream/.test(signalRoutes),
  'The backend must publish new room signals through the SSE endpoint.');
check('Waiting-room status and queue use SSE', /lobby\/stream\?requestId=/.test(page)
  && /lobby\/stream\?ticket=/.test(page)
  && !/setInterval\(pollQueue, 3000\)/.test(page)
  && !/\}, 2000\);\s*\n\s*\n\s*return \(\) => \{\s*\n\s*active = false;\s*\n\s*clearInterval\(interval\);/.test(page)
  && /export async function streamLobbyHandler/.test(signalBackend)
  && /createLobbyStreamTicketHandler/.test(signalBackend),
  'Waiting participants and moderators must receive lobby updates through scoped SSE streams, not repeating polls.');
check('Live-status polling budget', /\}, 10000\);/.test(page),
  'Meeting-end HTTP check must use the 10-second cadence.');
check('Meeting route lazy-loading', /const MeetingRoomPage = lazy\(/.test(app)
  && /<Suspense fallback=\{<MeetingRouteLoader \/>\}>/.test(app),
  'Meeting code must be lazy-loaded outside /meet routes.');

const dist = path.join(root, 'toowix-web-app', 'dist', 'assets');
const assets = fs.existsSync(dist)
  ? fs.readdirSync(dist).filter(name => name.endsWith('.js')).map(name => ({ name, bytes: fs.statSync(path.join(dist, name)).size }))
  : [];
const report = {
  generatedAt: new Date().toISOString(),
  summary: {
    passed: checks.filter(checkResult => checkResult.status === 'PASS').length,
    failed: checks.filter(checkResult => checkResult.status === 'FAIL').length,
    realCallMetrics: 'Not measured by this static guard; run the controlled desktop/Android/iPhone call matrix in the performance guide.'
  },
  checks,
  builtJavaScriptAssets: assets
};
const reportPath = path.join(os.tmpdir(), `toowix-meeting-performance-${Date.now()}.json`);
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`Report: ${reportPath}`);
process.exitCode = report.summary.failed ? 1 : 0;

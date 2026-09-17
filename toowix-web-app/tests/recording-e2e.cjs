/*
 * Full live Jibri verification. This intentionally requires an explicit opt-in:
 *   $env:RECORDING_E2E_ALLOW_LIVE='true'
 *   $env:RECORDING_E2E_SSH_TARGET='root@recording-host'
 *   node tests/recording-e2e.cjs
 *
 * It first proves that the deployed Jibri hook contains the atomic final.mp4
 * pipeline, then uses the browser recording harness, waits for Ready metadata,
 * re-validates final.mp4 inside the backend container, and checks HTTP Range
 * playback. It never starts/restarts containers and it refuses to run while a
 * Jicofo conference is active.
 */
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const testsDir = __dirname;
const sshPath = process.env.RECORDING_E2E_SSH_PATH || 'C:\\Windows\\System32\\OpenSSH\\ssh.exe';
const sshTarget = process.env.RECORDING_E2E_SSH_TARGET;
const backendContainer = process.env.RECORDING_E2E_BACKEND_CONTAINER || 'toowix-backend';
const jibriContainer = process.env.RECORDING_E2E_JIBRI_CONTAINER || 'jitsi-stack-jibri-1';
const jicofoContainer = process.env.RECORDING_E2E_JICOFO_CONTAINER || 'jitsi-stack-jicofo-1';
const baseUrl = (process.env.RECORDING_E2E_BASE_URL || 'https://talk.toowix.com').replace(/\/$/, '');
const finalizationTimeoutMs = Math.max(60_000, Number.parseInt(process.env.RECORDING_E2E_FINALIZATION_TIMEOUT_MS || '900000', 10));
const pollIntervalMs = Math.max(1_000, Number.parseInt(process.env.RECORDING_E2E_POLL_INTERVAL_MS || '5000', 10));

for (const value of [backendContainer, jibriContainer, jicofoContainer]) {
  assert.match(value, /^[A-Za-z0-9_.-]+$/, 'Container names may contain only letters, numbers, dot, underscore, and hyphen');
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function run(command, args, input, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} exited ${code}: ${stderr || stdout}`)));
    child.stdin.end(input);
  });
}

function ssh(command, input) {
  return run(sshPath, ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', sshTarget, command], input);
}

async function remoteNode(source) {
  const { stdout } = await ssh(`docker exec -i ${backendContainer} node`, source);
  const line = stdout.split(/\r?\n/).find(value => value.startsWith('E2E_RESULT '));
  if (!line) throw new Error(`Remote node did not return E2E_RESULT: ${stdout}`);
  return JSON.parse(line.slice('E2E_RESULT '.length));
}

async function preflight() {
  const { stdout } = await ssh(`docker exec ${jicofoContainer} curl -fsS http://localhost:8888/stats`);
  const stats = JSON.parse(stdout);
  assert.equal(stats.conferences, 0, `Refusing live test while ${stats.conferences} conference(s) are active`);
  assert.equal(stats.jibri?.recording_active || 0, 0, 'Refusing live test while Jibri is recording');

  const installed = await ssh(`docker exec ${jibriContainer} grep -F final.mp4.tmp /config/finalize-recording.py`)
    .then(() => true, () => false);
  assert.ok(installed, 'The deployed Jibri finalizer does not contain the atomic final.mp4 pipeline; deploy it before running this test');

  const backendReady = await remoteNode(`
    const fs = require('fs');
    const route = '/app/dist/src/recordings/recordings.js';
    process.stdout.write('E2E_RESULT ' + JSON.stringify({ hasFinalContract: fs.readFileSync(route, 'utf8').includes('final.mp4') }) + '\\n');
  `);
  assert.ok(backendReady.hasFinalContract, 'The deployed backend does not enforce final.mp4 metadata; deploy it before running this test');
}

async function runBrowserRecording() {
  const outputDir = fs.mkdtempSync(path.join(testsDir, '.recording-e2e-'));
  const resultPath = path.join(outputDir, 'result.json');
  try {
    await run(process.execPath, [path.join(testsDir, 'recording-live.cjs')], undefined, {
      ...process.env,
      RECORDING_E2E_RESULT_PATH: resultPath,
    });
    const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    assert.ok(result.room, 'Browser harness did not provide a room slug');
    assert.ok(result.events?.some(event => event.name === 'recordingStatusChanged' && event.on), 'Jibri recording never reached confirmed on state');
    assert.ok(result.events?.some(event => event.name === 'recordingStatusChanged' && !event.on), 'Jibri recording never reached confirmed off state');
    return result;
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

async function recordingForRoom(room) {
  return remoteNode(`
    const { connectDatabase, disconnectDatabase } = require('/app/dist/src/db/connection');
    const { Meeting } = require('/app/dist/src/models/Meeting');
    const { Recording } = require('/app/dist/src/models/Recording');
    (async () => {
      await connectDatabase();
      const meeting = await Meeting.findOne({ roomSlug: ${JSON.stringify(room)} }).lean();
      const recording = meeting ? await Recording.findOne({ meetingId: meeting._id }).sort({ createdAt: -1 }).lean() : null;
      await disconnectDatabase();
      process.stdout.write('E2E_RESULT ' + JSON.stringify({ meetingId: meeting?._id, recording }) + '\\n');
    })().catch(error => { console.error(error); process.exit(1); });
  `);
}

async function waitForFinalRecording(room) {
  const deadline = Date.now() + finalizationTimeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await recordingForRoom(room);
    const recording = last.recording;
    if (recording?.status === 'Ready') return recording;
    if (recording?.status === 'Failed') throw new Error(`Finalizer marked recording Failed: ${recording.processingError || recording.failureReason || 'no error detail'}`);
    await delay(pollIntervalMs);
  }
  throw new Error(`Timed out waiting for Ready metadata after ${finalizationTimeoutMs / 1000}s; last status: ${last?.recording?.status || 'no recording document'}`);
}

async function validateFinalInsideBackend(recording) {
  assert.match(recording.recordingSessionId || '', /^[A-Za-z0-9_-]{8,128}$/, 'Recording has no valid recordingSessionId');
  assert.equal(recording.fileUrl, `${recording.recordingSessionId}/final.mp4`, 'Ready recording must point to final.mp4');
  assert.equal(recording.processedFile, recording.fileUrl, 'processedFile must match final.mp4');
  const validation = await remoteNode(`
    const { inspectRecording } = require('/app/dist/src/recordings/media');
    (async () => {
      const metadata = await inspectRecording(${JSON.stringify(recording.fileUrl)});
      process.stdout.write('E2E_RESULT ' + JSON.stringify(metadata) + '\\n');
    })().catch(error => { console.error(error); process.exit(1); });
  `);
  assert.ok(validation.sizeBytes > 0 && validation.durationSeconds > 0, 'final.mp4 failed media validation');
  return validation;
}

async function verifyRangePlayback(recording) {
  const response = await fetch(`${baseUrl}/api/recordings/${encodeURIComponent(recording._id)}/stream`, {
    headers: { Range: 'bytes=0-1023' },
  });
  const body = new Uint8Array(await response.arrayBuffer());
  assert.equal(response.status, 206, `Expected HTTP 206, received ${response.status}`);
  assert.match(response.headers.get('content-range') || '', /^bytes 0-\d+\/\d+$/);
  assert.ok(body.byteLength > 0, 'Range response was empty');
  return { status: response.status, contentRange: response.headers.get('content-range'), bytes: body.byteLength };
}

(async () => {
  assert.equal(process.env.RECORDING_E2E_ALLOW_LIVE, 'true', 'Set RECORDING_E2E_ALLOW_LIVE=true to permit a live recording test');
  assert.ok(sshTarget, 'Set RECORDING_E2E_SSH_TARGET, for example root@recording-host');
  await preflight();
  console.log('Preflight passed; starting browser/Jibri recording.');
  const browser = await runBrowserRecording();
  console.log(`Jibri stopped for ${browser.room}; waiting for final.mp4.`);
  const recording = await waitForFinalRecording(browser.room);
  const media = await validateFinalInsideBackend(recording);
  const range = await verifyRangePlayback(recording);
  console.log(JSON.stringify({ room: browser.room, recordingId: recording._id, recordingSessionId: recording.recordingSessionId, media, range }, null, 2));
})().catch(error => {
  console.error(`Recording E2E verification failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});

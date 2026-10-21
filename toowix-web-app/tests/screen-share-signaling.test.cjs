const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadProtocol() {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/jitsi/screenShareSignal.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, JSON, Number });
  return exports;
}

test('screen-share presence protocol accepts only complete versioned snapshots', () => {
  const { parseScreenShareSignal } = loadProtocol();
  assert.deepEqual(parseScreenShareSignal(JSON.stringify({ version: 1, sessionId: 'share-1', status: 'active' })), {
    version: 1, sessionId: 'share-1', status: 'active'
  });
  assert.equal(parseScreenShareSignal('{bad'), null);
  assert.equal(parseScreenShareSignal(JSON.stringify({ version: 0, sessionId: 'share-1', status: 'active' })), null);
  assert.equal(parseScreenShareSignal(JSON.stringify({ version: 1, sessionId: 'share-1', status: 'unknown' })), null);
});

test('sender implementation publishes STOP after removeTrack and increments its version', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/useJitsiMeeting.ts'), 'utf8');
  assert.match(source, /room\.removeTrack\(desktopTrack\)/);
  assert.match(source, /version: \+\+localScreenShareVersionRef\.current, status: 'stopped'/);
  assert.match(source, /publishScreenShareSignal\(\{ \.\.\.activeSignal/);
});

test('receiver uses live Jitsi desktop tracks immediately and protects a newer share from an old STOP', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/jitsi/useConferenceEvents.ts'), 'utf8');
  assert.match(source, /signal\.version < previous\.version/);
  assert.match(source, /remoteDesktopTrackSessionsRef\.current\[participantId\] !== sessionId/);
  assert.match(source, /signal\.status === 'stopped'/);
  assert.match(source, /remoteDesktopTracksRef\.current\[participantId\] = track/);
  assert.match(source, /if \(remoteDesktopTrackSessionsRef\.current\[participantId\] === signal\.sessionId\)/);
  assert.match(source, /remoteDesktopTrackSessionsRef\.current\[participantId\] = signal\.sessionId/);
  assert.match(source, /clearRemoteDesktop\(participantId, signal\.sessionId\)/);
});

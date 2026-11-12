const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/lib/networkQuality.ts'), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;
const exportsObject = {};
vm.runInNewContext(code, { exports: exportsObject });

const healthy = (overrides = {}) => ({
  availableOutgoingBitrateKbps: null,
  candidateType: 'host',
  connectionState: 'connected',
  jitterMs: 5,
  packetLossPercent: 0,
  rttMs: 25,
  videoBitrateKbps: 800,
  ...overrides
});

test('does not mark a connected Edge call poor when bitrate is unavailable or zero', () => {
  assert.equal(exportsObject.classifyNetwork(healthy()), 'GOOD');
  assert.equal(exportsObject.classifyNetwork(healthy({ availableOutgoingBitrateKbps: 0 })), 'GOOD');
});

test('still detects a verified low positive bandwidth estimate', () => {
  assert.equal(exportsObject.classifyNetwork(healthy({ availableOutgoingBitrateKbps: 149 })), 'POOR');
});

test('a tiny bandwidth estimate is ignored while no video is being sent (camera off)', () => {
  assert.equal(exportsObject.classifyNetwork(healthy({ availableOutgoingBitrateKbps: 60, videoBitrateKbps: 0 })), 'GOOD');
  assert.equal(exportsObject.classifyNetwork(healthy({ availableOutgoingBitrateKbps: 60, videoBitrateKbps: null })), 'GOOD');
});

test('still detects real loss, latency, and connection failures', () => {
  assert.equal(exportsObject.classifyNetwork(healthy({ packetLossPercent: 6 })), 'POOR');
  assert.equal(exportsObject.classifyNetwork(healthy({ rttMs: 301 })), 'POOR');
  assert.equal(exportsObject.classifyNetwork(healthy({ connectionState: 'failed' })), 'POOR');
});

test('getTargetVideoHeight always stays within [480, 1080]', () => {
  const { getTargetVideoHeight, BG_MIN_HEIGHT, BG_MAX_HEIGHT } = exportsObject;

  assert.equal(BG_MIN_HEIGHT, 480);
  assert.equal(BG_MAX_HEIGHT, 1080);

  const states = [ 'GOOD', 'DEGRADED', 'POOR', 'RECOVERING' ];
  const callSizes = [ 180, 360, 480, 720, 900, 1080, 2160 ];
  const bitrates = [ undefined, null, 0, 50, 149, 150, 5000 ];

  for (const state of states) {
    for (const callSize of callSizes) {
      for (const bitrate of bitrates) {
        const result = getTargetVideoHeight(state, callSize, bitrate);

        assert.ok(result >= 480 && result <= 1080, `${state}/${callSize}/${bitrate} -> ${result} out of range`);
      }
    }
  }
});

test('getTargetVideoHeight follows network state -- good/degraded/poor', () => {
  const { getTargetVideoHeight } = exportsObject;

  // A big-enough call (callSizeMaxHeight >= 1080) isolates the network-state behaviour from the
  // call-size ceiling.
  assert.equal(getTargetVideoHeight('GOOD', 2160), 1080);
  assert.equal(getTargetVideoHeight('DEGRADED', 2160), 720);
  assert.equal(getTargetVideoHeight('RECOVERING', 2160), 720);
  assert.equal(getTargetVideoHeight('POOR', 2160), 480);
});

test('getTargetVideoHeight recovers automatically as network state improves', () => {
  const { getTargetVideoHeight } = exportsObject;

  // Same callSizeMaxHeight throughout -- only networkState changes, simulating a call that
  // degrades and then recovers. Quality must follow it back up automatically, with no separate
  // "reset" needed -- getTargetVideoHeight is a pure function of current state.
  const timeline = [ 'GOOD', 'DEGRADED', 'POOR', 'DEGRADED', 'RECOVERING', 'GOOD' ]
      .map((state) => getTargetVideoHeight(state, 2160));

  assert.deepEqual(timeline, [ 1080, 720, 480, 720, 720, 1080 ]);
});

test('getTargetVideoHeight is held at 720 on GOOD with a thin outgoing pipe', () => {
  const { getTargetVideoHeight } = exportsObject;

  assert.equal(getTargetVideoHeight('GOOD', 2160, 149), 720);
  assert.equal(getTargetVideoHeight('GOOD', 2160, 150), 1080);
  assert.equal(getTargetVideoHeight('GOOD', 2160, 0), 1080);
  assert.equal(getTargetVideoHeight('GOOD', 2160, null), 1080);
  assert.equal(getTargetVideoHeight('GOOD', 2160, undefined), 1080);
});

test('getTargetVideoHeight on GOOD never goes below 720, even with a small call-size ceiling -- must match the non-effect sender formula (max(base, 720))', () => {
  const { getTargetVideoHeight } = exportsObject;

  // >8-participant call (callSizeMaxHeight 360, per getReceiveMaxHeightForCallSize). Phase 1b's
  // whole point: an effect user on GOOD must never be sent lower than a non-effect user on the
  // same call/network -- the non-effect formula is max(base, 720), so this must be 720 too, not
  // the general 480 floor DEGRADED/POOR use.
  assert.equal(getTargetVideoHeight('GOOD', 360), 720);
  assert.equal(getTargetVideoHeight('DEGRADED', 360), 480);
  assert.equal(getTargetVideoHeight('POOR', 360), 480);
});

test('getTargetVideoHeight on GOOD with a thin pipe still never goes below 720', () => {
  const { getTargetVideoHeight } = exportsObject;

  assert.equal(getTargetVideoHeight('GOOD', 360, 149), 720);
});

// P1-1 fix: cellular's structurally higher baseline RTT must not read as the same severity WiFi
// would at the same number (Toowix_Meet_Prioritized_Issue_Backlog.pdf -- "mobile POOR still
// aggressive"). Desktop behavior (isMobile omitted/false) must stay byte-for-byte identical.
test('mobile gets a wider RTT tolerance than desktop at the same measured RTT', () => {
  const { classifyNetwork } = exportsObject;
  const atRtt = (rttMs) => ({
    availableOutgoingBitrateKbps: null, candidateType: 'cellular', connectionState: 'connected',
    jitterMs: 5, packetLossPercent: 0, rttMs, videoBitrateKbps: 800,
  });

  // 350ms: real trouble on WiFi (> poorRttMs=300), still just DEGRADED-range on cellular.
  assert.equal(classifyNetwork(atRtt(350)), 'POOR');
  assert.equal(classifyNetwork(atRtt(350), true), 'DEGRADED');

  // 200ms: already DEGRADED on WiFi (>= 150), still GOOD on cellular (< 150*1.6=240) -- this is
  // the exact false-positive the backlog flags: healthy 4G reading as a degraded call.
  assert.equal(classifyNetwork(atRtt(200)), 'DEGRADED');
  assert.equal(classifyNetwork(atRtt(200), true), 'GOOD');

  // A genuinely bad connection is still POOR on mobile too -- this is tolerance, not blindness.
  assert.equal(classifyNetwork(atRtt(600), true), 'POOR');

  // isMobile defaulting to false/omitted must not change a single existing desktop classification.
  assert.equal(classifyNetwork(atRtt(100)), classifyNetwork(atRtt(100), false));
  assert.equal(classifyNetwork(atRtt(400)), classifyNetwork(atRtt(400), false));
});

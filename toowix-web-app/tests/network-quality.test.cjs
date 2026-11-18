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

// P0-2 fix (2G/3G performance plan): getStartupNetworkProfile and getMediaQualityPolicy's startup
// branch need a fresh `navigator` per scenario, so each case gets its own vm context instead of
// reusing the module-level exportsObject (which has no navigator at all, i.e. desktop/no-API).
function loadWithNavigator(navigatorMock) {
  const ctxExports = {};
  vm.runInNewContext(code, { exports: ctxExports, navigator: navigatorMock });
  return ctxExports;
}

test('getStartupNetworkProfile classifies effectiveType correctly', () => {
  const desktopNav = (effectiveType) => ({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', connection: { effectiveType } });
  const phoneNav = (effectiveType) => ({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)', connection: effectiveType ? { effectiveType } : undefined });

  assert.equal(loadWithNavigator(desktopNav('slow-2g')).getStartupNetworkProfile(), 'very-slow');
  assert.equal(loadWithNavigator(desktopNav('2g')).getStartupNetworkProfile(), 'very-slow');
  assert.equal(loadWithNavigator(desktopNav('3g')).getStartupNetworkProfile(), 'slow');
  assert.equal(loadWithNavigator(desktopNav('4g')).getStartupNetworkProfile(), 'normal');

  // No Network Information API at all: desktop stays 'normal' (don't guess from user-agent
  // alone), a phone/tablet gets the conservative 'unknown-mobile' starting point.
  assert.equal(loadWithNavigator(desktopNav(undefined)).getStartupNetworkProfile(), 'normal');
  assert.equal(loadWithNavigator(phoneNav(undefined)).getStartupNetworkProfile(), 'unknown-mobile');
  assert.equal(loadWithNavigator(phoneNav('3g')).getStartupNetworkProfile(), 'slow');
});

test('getMediaQualityPolicy starts conservative on 3g/unknown-mobile without cutting the camera', () => {
  const phoneNav = (effectiveType) => ({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)', connection: effectiveType ? { effectiveType } : undefined });

  const threeG = loadWithNavigator(phoneNav('3g'));
  const threeGPolicy = threeG.getMediaQualityPolicy('auto', 'GOOD', 2);
  assert.equal(threeGPolicy.audioOnly, false);
  assert.ok(threeGPolicy.sendMaxHeight <= 360, '3G startup must not exceed a 360p send ceiling');
  assert.ok(threeGPolicy.receiveMaxHeight <= 360, '3G startup must not exceed a 360p receive ceiling');

  const unknownMobile = loadWithNavigator(phoneNav(undefined));
  const unknownMobilePolicy = unknownMobile.getMediaQualityPolicy('auto', 'GOOD', 2);
  assert.equal(unknownMobilePolicy.audioOnly, false);
  assert.ok(unknownMobilePolicy.sendMaxHeight <= 360, 'unknown-mobile startup must not exceed a 360p send ceiling');

  // A real POOR classification (from actual WebRTC stats) still wins over the startup guess --
  // the startup profile is only a ceiling for before those stats exist, never a floor that blocks
  // the existing POOR-state policy from kicking in.
  const poorOverride = threeG.getMediaQualityPolicy('auto', 'POOR', 2);
  assert.equal(poorOverride.sendMaxHeight, 180);
});

// P0-3 fix: camera CAPTURE (getUserMedia ideal) must also shrink on a weak startup profile, for
// both phone and desktop -- not just the SEND/RECEIVE ceiling applied after capture. Otherwise the
// browser still captures/scales/encodes a needlessly large source even though it will be
// downscaled before it's ever sent.
test('getCameraCaptureIdeal shrinks capture resolution on weak startup profiles, for desktop and phone alike', () => {
  const desktopNav = (effectiveType) => ({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', connection: { effectiveType } });
  const phoneNav = (effectiveType) => ({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)', connection: effectiveType ? { effectiveType } : undefined });

  const desktopNormal = loadWithNavigator(desktopNav('4g')).getCameraCaptureIdeal();
  assert.equal(desktopNormal.width, 3840);
  assert.equal(desktopNormal.height, 2160);

  const desktopVerySlow = loadWithNavigator(desktopNav('slow-2g')).getCameraCaptureIdeal();
  assert.ok(desktopVerySlow.width <= 320 && desktopVerySlow.height <= 320, `very-slow desktop capture too large: ${desktopVerySlow.width}x${desktopVerySlow.height}`);

  const desktopSlow = loadWithNavigator(desktopNav('3g')).getCameraCaptureIdeal();
  assert.ok(desktopSlow.width <= 640 && desktopSlow.height <= 640, `3g desktop capture too large: ${desktopSlow.width}x${desktopSlow.height}`);
  assert.ok(desktopSlow.width > desktopVerySlow.width, '3g capture should ask for more than very-slow/2g');

  // Phone on 2G: still shrinks to the same very-slow ceiling, not its normal 1080p ideal.
  const phoneVerySlow = loadWithNavigator(phoneNav('2g')).getCameraCaptureIdeal();
  assert.ok(phoneVerySlow.width <= 320 && phoneVerySlow.height <= 320, `very-slow phone capture too large: ${phoneVerySlow.width}x${phoneVerySlow.height}`);

  // Phone with no Network Information API at all (unknown-mobile) -- no confirmed network
  // signal, so CAPTURE resolution stays at the device's normal ideal (the send/receive ceiling,
  // not capture, is where unknown-mobile's conservatism applies -- see the dedicated test below).
  // Separate vm contexts are separate realms (different Object.prototype), so compare fields
  // individually rather than with a reference-sensitive deep-equality assertion across them.
  const phoneUnknown = loadWithNavigator(phoneNav(undefined)).getCameraCaptureIdeal();
  const phoneNormal = loadWithNavigator(phoneNav('4g')).getCameraCaptureIdeal();
  assert.equal(phoneUnknown.width, phoneNormal.width);
  assert.equal(phoneUnknown.height, phoneNormal.height);
  assert.equal(phoneUnknown.frameRate, phoneNormal.frameRate);
});

// P0-4 fix: a GOOD classifyNetwork read (plausible on a healthy-for-cellular 3G RTT) must not let
// the send/receive height bypass the startup profile's own ceiling -- this is the extra ceiling
// useJitsiMeeting.ts intersects with clampVideoHeightForNetwork at/right after join.
test('getStartupSendReceiveCeiling caps camera tiles immediately on a weak startup profile, but never touches screen share', () => {
  const desktopNav = (effectiveType) => ({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', connection: { effectiveType } });

  assert.equal(loadWithNavigator(desktopNav('4g')).getStartupSendReceiveCeiling(false), null);
  assert.equal(loadWithNavigator(desktopNav('slow-2g')).getStartupSendReceiveCeiling(false), 180);
  assert.equal(loadWithNavigator(desktopNav('3g')).getStartupSendReceiveCeiling(false), 360);

  // Screen share must never be re-clamped down to the camera-tile startup ceiling -- P0-1's
  // dedicated (more generous) screen-share floor stays the only thing governing it.
  assert.equal(loadWithNavigator(desktopNav('slow-2g')).getStartupSendReceiveCeiling(true), null);
  assert.equal(loadWithNavigator(desktopNav('3g')).getStartupSendReceiveCeiling(true), null);
});

test('getAudioMaxBitrateBps also floors immediately on a weak startup profile, not just a classified state', () => {
  const desktopNav = (effectiveType) => ({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', connection: { effectiveType } });

  const normal = loadWithNavigator(desktopNav('4g'));
  assert.equal(normal.getAudioMaxBitrateBps('GOOD'), 40000);

  const verySlow = loadWithNavigator(desktopNav('slow-2g'));
  assert.equal(verySlow.getAudioMaxBitrateBps('GOOD'), 16000);

  const slow = loadWithNavigator(desktopNav('3g'));
  assert.equal(slow.getAudioMaxBitrateBps('GOOD'), 24000);

  // A real POOR classification still wins (lowest tier) even if the startup profile would have
  // asked for a merely-DEGRADED-equivalent bitrate.
  assert.equal(slow.getAudioMaxBitrateBps('POOR'), 16000);
});

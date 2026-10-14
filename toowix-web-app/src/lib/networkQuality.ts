export type LowDataMode = 'auto' | 'low-data' | 'audio-only';
export type NetworkState = 'GOOD' | 'DEGRADED' | 'POOR' | 'RECOVERING';

export interface INetworkMetrics {
  availableOutgoingBitrateKbps: number | null;
  candidateType: string | null;
  connectionState: string | null;
  jitterMs: number | null;
  packetLossPercent: number | null;
  rttMs: number | null;
  videoBitrateKbps: number | null;
}

export interface IMediaQualityPolicy {
  audioOnly: boolean;
  desktopFps: number;
  desktopMaxHeight: number;
  desktopMaxWidth: number;
  lastN: number;
  receiveMaxHeight: number;
  sendMaxHeight: number;
}

// Jitsi/WebRTC already runs transport congestion control continuously. These samples are only
// lightweight UI telemetry, so collecting them every five seconds avoids a second high-frequency
// controller competing for browser time during a call.
export const NETWORK_STATS_INTERVAL_MS = 3000;
export const NETWORK_RECOVERY_STABLE_MS = 6000;
export const NETWORK_THRESHOLDS = {
  degradedLossPercent: 2,
  degradedRttMs: 150,
  poorBitrateKbps: 150,
  poorLossPercent: 5,
  poorRttMs: 300
} as const;

const isNumber = (value: number | null): value is number => value !== null && Number.isFinite(value);

export function classifyNetwork(metrics: INetworkMetrics): Exclude<NetworkState, 'RECOVERING'> {
  if (metrics.connectionState && ![ 'connected', 'completed' ].includes(metrics.connectionState)) {
    return 'POOR';
  }
  if (
    (isNumber(metrics.rttMs) && metrics.rttMs > NETWORK_THRESHOLDS.poorRttMs)
    || (isNumber(metrics.packetLossPercent) && metrics.packetLossPercent > NETWORK_THRESHOLDS.poorLossPercent)
    // Edge may report 0 (or omit this field) for a healthy selected ICE pair.
    // A non-positive estimate is "unknown", not proof that the call is limited.
    // The estimate is also only meaningful while we are actually SENDING video: with the camera
    // off (or no camera) the sender has nothing to probe with, so Chrome leaves the estimate
    // tiny even on a perfect ethernet link -- that read as a false "Limited connection".
    || (isNumber(metrics.availableOutgoingBitrateKbps)
      && isNumber(metrics.videoBitrateKbps)
      && metrics.videoBitrateKbps > 20
      && metrics.availableOutgoingBitrateKbps > 0
      && metrics.availableOutgoingBitrateKbps < NETWORK_THRESHOLDS.poorBitrateKbps)
  ) {
    return 'POOR';
  }
  if (
    (isNumber(metrics.rttMs) && metrics.rttMs >= NETWORK_THRESHOLDS.degradedRttMs)
    || (isNumber(metrics.packetLossPercent) && metrics.packetLossPercent >= NETWORK_THRESHOLDS.degradedLossPercent)
  ) {
    return 'DEGRADED';
  }

  return 'GOOD';
}

export function getMediaQualityPolicy(
  mode: LowDataMode,
  state: NetworkState,
  participantCount: number,
  screenShareActive = false,
  highBandwidth = false
): IMediaQualityPolicy {
  const normalLastN = participantCount >= 8 ? 4 : 6;

  if (mode === 'audio-only') {
    return {
      audioOnly: true,
      desktopFps: 5,
      desktopMaxHeight: 720,
      desktopMaxWidth: 1280,
      lastN: 0,
      receiveMaxHeight: 180,
      sendMaxHeight: 180
    };
  }
  if (mode === 'low-data' || state === 'POOR') {
    return {
      audioOnly: false,
      desktopFps: 5,
      desktopMaxHeight: 720,
      desktopMaxWidth: 1280,
      lastN: state === 'POOR' ? 1 : 2,
      receiveMaxHeight: state === 'POOR' ? 180 : 360,
      sendMaxHeight: state === 'POOR' ? 180 : 360
    };
  }
  // Text on a shared screen is unreadable at camera-sized limits, so while a screen is being
  // shared the receive/send caps stay at 720p (degraded) or 1080p (good) instead of 360/720.
  if (state === 'DEGRADED' || state === 'RECOVERING') {
    return {
      audioOnly: false,
      desktopFps: 8,
      desktopMaxHeight: 720,
      desktopMaxWidth: 1280,
      lastN: 2,
      receiveMaxHeight: screenShareActive ? 720 : 360,
      sendMaxHeight: screenShareActive ? 720 : 360
    };
  }

  // 1080p costs substantially more encoder bandwidth than 720p. Request it only when the
  // browser's live WebRTC estimator has at least 2.5 Mbps available and the call is small;
  // JVB still chooses a lower simulcast layer immediately if that estimate falls again.
  const use1080pCamera = highBandwidth && participantCount <= 4;

  return {
    audioOnly: false,
    desktopFps: 10,
    desktopMaxHeight: 1080,
    desktopMaxWidth: 1920,
    lastN: normalLastN,
    receiveMaxHeight: screenShareActive || use1080pCamera ? 1080 : 720,
    sendMaxHeight: screenShareActive || use1080pCamera ? 1080 : 720
  };
}

const isMobileBrowser = () => typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// Real reported bug: on macOS Chrome, the camera came in portrait/narrow on the FIRST join of a
// meeting, but correctly landscape after leaving and rejoining. Root cause -- the prejoin lobby
// preview (useMediaPreview.ts) and the in-call track acquisition (useJitsiMeeting.ts) each built
// their OWN getUserMedia constraints independently. The in-call path had already been given an
// aspectRatio `advanced` constraint (see getPreferredCameraCaptureConstraints below) to fight a
// camera driver that otherwise settles on a portrait-shaped mode -- but on the very first join,
// useJitsiMeeting ADOPTS the lobby's already-open stream directly instead of requesting a fresh
// one (specifically to avoid a stop-then-reacquire race on real hardware), so first join actually
// runs on whatever the LOBBY preview's constraints produced, which never had that fix. Only a
// rejoin or an explicit device switch ever requests a genuinely fresh track through
// useJitsiMeeting's own constraint-building path, which is why only those came out correct. The
// fix is a SINGLE shared constraint builder, used by both the lobby preview and every in-call
// track-acquisition call site, so there is no longer a second, divergent path to drift out of
// sync with the first.
//
// Device category also decides ORIENTATION now, not just resolution: desktop and tablet prefer
// landscape (width > height); a phone prefers portrait (height > width), matching how someone
// actually holds a phone for a video call. A tablet is easy to misclassify as "mobile" by a bare
// UA regex (iPadOS Safari can even report as "Macintosh"), which would wrongly give it the
// phone's portrait preference -- so this uses the same signal device libraries use: Android's UA
// omits the literal "Mobile" token on tablets (present only on phones), and an iPad is detected
// either by the literal "iPad" token or, for modern iPadOS spoofing as Macintosh, by real
// multi-touch support a Mac never has.
export type CameraDeviceCategory = 'desktop' | 'tablet' | 'phone';
export type CameraCaptureOrientation = 'portrait' | 'landscape';

function isPhoneUA(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;

  return /iPhone|iPod/i.test(ua) || (/Android/i.test(ua) && /Mobile/i.test(ua));
}

function isTabletUA(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIPadOSReportingAsMac = /Macintosh/i.test(ua) && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1;

  return /iPad/i.test(ua) || isIPadOSReportingAsMac || (/Android/i.test(ua) && !/Mobile/i.test(ua));
}

export function getCameraDeviceCategory(): CameraDeviceCategory {
  if (isPhoneUA()) return 'phone';
  if (isTabletUA()) return 'tablet';

  return 'desktop';
}

// This is a capture *preference*, not a claim about the pixels a camera will deliver.  A phone
// can be held sideways, so use the Screen Orientation API when it is present; matchMedia is a
// secondary browser signal.  We intentionally do not use innerWidth/innerHeight: browser chrome,
// split screen and an already-rotated page do not describe the camera sensor.  The phone-portrait
// default retains the normal video-call behaviour on older Safari where neither API is exposed.
export function getCameraCaptureOrientationPreference(): CameraCaptureOrientation {
  if (getCameraDeviceCategory() !== 'phone') return 'landscape';

  try {
    const type = String((screen as any)?.orientation?.type || '');
    if (type.startsWith('landscape')) return 'landscape';
    if (type.startsWith('portrait')) return 'portrait';
  } catch { /* unavailable (notably older iOS Safari) */ }

  try {
    if (typeof matchMedia === 'function') {
      if (matchMedia('(orientation: landscape)').matches) return 'landscape';
      if (matchMedia('(orientation: portrait)').matches) return 'portrait';
    }
  } catch { /* retain safe fallback */ }

  return 'portrait';
}

// Camera capture request. "ideal" makes the browser pick the closest mode the camera really has,
// so a 720p webcam stays at 720p, a 1080p one gets 1080p and a 4K one gets 4K. What is actually
// SENT is still capped by what the other participants ask the bridge for (see
// getReceiveMaxHeightForCallSize) and by the bandwidth estimate. Phones and tablets stay at 1080p
// (same total pixel count as before, just reoriented for a phone) to keep the encoder, battery
// and heat in check.
export function getCameraCaptureIdeal(): { frameRate: number; height: number; width: number } {
  const category = getCameraDeviceCategory();

  if (category === 'phone') {
    return getCameraCaptureOrientationPreference() === 'portrait'
      ? { frameRate: 30, height: 1920, width: 1080 }
      : { frameRate: 30, height: 1080, width: 1920 };
  }

  return category === 'tablet'
    ? { frameRate: 30, height: 1080, width: 1920 }
    : { frameRate: 30, height: 2160, width: 3840 };
}

// A bare `aspectRatio: { ideal }` is only ONE input into the browser's overall constraint scoring
// (width, height, frameRate and aspectRatio all get weighed together), so a driver that heavily
// favors matching the requested width/height can still settle on the wrong-shaped mode despite
// the aspectRatio preference losing that tug-of-war. `advanced` constraint sets are the part of
// the getUserMedia spec built exactly for "try hard to satisfy this, but never fail the whole
// request over it": the UA attempts each advanced set in order and silently skips any entry it
// cannot satisfy, instead of throwing OverconstrainedError the way a bare non-ideal aspectRatio
// would for a camera that genuinely cannot do the requested shape.
//
// The single shared constraint object every camera-capture call site (lobby preview, initial
// join, rejoin/device-switch, ended-camera recovery, and the separate /meet-direct route) should
// spread into its own getUserMedia/createLocalTracks call, alongside whatever deviceId constraint
// that call site already has. Centralizing this is what the first-join/rejoin divergence above
// was missing.
export function getPreferredCameraCaptureConstraints(): MediaTrackConstraints {
  const ideal = getCameraCaptureIdeal();
  const aspectRatio = getCameraCaptureOrientationPreference() === 'portrait' ? 9 / 16 : 16 / 9;

  return {
    width: { ideal: ideal.width },
    height: { ideal: ideal.height },
    frameRate: { ideal: ideal.frameRate },
    aspectRatio: { ideal: aspectRatio },
    advanced: [ { aspectRatio } ]
  };
}

// A lower-cost retry for preview acquisition.  It deliberately uses the same authoritative
// orientation decision as the first attempt; previously this retry was always 1280x720 and could
// become the adopted first-call track after a portrait request failed.
export function getFallbackCameraCaptureConstraints(): MediaTrackConstraints {
  const portrait = getCameraCaptureOrientationPreference() === 'portrait';
  const width = portrait ? 720 : 1280;
  const height = portrait ? 1280 : 720;
  const aspectRatio = width / height;

  return {
    width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: 30 },
    aspectRatio: { ideal: aspectRatio }, advanced: [ { aspectRatio } ]
  };
}

// getUserMedia's `advanced` aspectRatio constraint above is a strong hint, not a guarantee --
// some camera/driver/browser/OS combinations silently ignore it and deliver the opposite
// orientation anyway. This reads back what the browser ACTUALLY delivered
// (MediaStreamTrack.getSettings(), the real post-negotiation capture mode) and reports a
// mismatch as a one-time console warning -- a real, visible signal for diagnosing a specific
// device/browser's limitation. Deliberately NEVER retries or re-acquires the camera: a camera
// that genuinely cannot do portrait would just fail the exact same way again, and the existing
// stream (whatever shape it came in) is always preserved and used as-is -- this is reporting
// only, never a race or a stop/reacquire loop.
// TEMPORARY diagnostic (see galleryOrientationDebug.ts): pure data only, no logging/import here --
// this file's own test harnesses load it with `vm.runInNewContext` and no `require` shim at all
// (every existing networkQuality.ts test does this; it has never had an external import before),
// so any `import` added to this file breaks all of them. The caller (useJitsiMeeting.ts, which
// already imports project modules normally) does the actual logGalleryDebug() call with this data.
export function getCameraCaptureDebugInfo(track: MediaStreamTrack | null | undefined): {
  deviceCategory: CameraDeviceCategory;
  requested: MediaTrackConstraints;
  actualWidth: number | null;
  actualHeight: number | null;
  actualAspectRatio: number | null;
  requestedOrientation: CameraCaptureOrientation;
} {
  let settings: MediaTrackSettings | null = null;

  if (track && typeof track.getSettings === 'function') {
    try {
      settings = track.getSettings();
    } catch {
      settings = null;
    }
  }

  return {
    deviceCategory: getCameraDeviceCategory(),
    requested: getPreferredCameraCaptureConstraints(),
    actualWidth: settings ? Number(settings.width) || 0 : null,
    actualHeight: settings ? Number(settings.height) || 0 : null,
    actualAspectRatio: settings ? Number(settings.aspectRatio) || null : null,
    requestedOrientation: getCameraCaptureOrientationPreference(),
  };
}

export function verifyCameraCaptureOrientation(track: MediaStreamTrack | null | undefined): void {
  if (!track || typeof track.getSettings !== 'function') return;
  // Only phones have a strict orientation EXPECTATION worth verifying -- desktop/tablet already
  // correctly prefer landscape, and a landscape result there is success, not a mismatch.
  if (getCameraDeviceCategory() !== 'phone' || getCameraCaptureOrientationPreference() !== 'portrait') return;

  let settings: MediaTrackSettings;

  try {
    settings = track.getSettings();
  } catch {
    return;
  }
  const width = Number(settings.width) || 0;
  const height = Number(settings.height) || 0;

  if (width > 0 && height > 0 && width > height) {
    console.warn(
        '[Camera] This phone/browser delivered a LANDSCAPE camera stream ' +
      `(${width}x${height}) despite requesting portrait capture -- the camera driver or browser ` +
      'does not honor the portrait aspect-ratio preference on this device. Using the stream as-is.'
    );
  }
}

// REAL, confirmed root cause (not a code bug): a phone can correctly REQUEST portrait
// (requestedOrientation: 'portrait', ideal 1080x1920, aspectRatio ideal 0.5625) and still have its
// camera driver deliver a landscape frame anyway (observed live: a real device requested portrait
// and received 1728x972). Many Android camera HALs only enumerate a small set of FIXED,
// landscape-shaped sensor presets and pick their nearest match by raw pixel AREA alone, never
// considering a portrait-shaped candidate when the ideal numbers don't exactly match a known
// preset -- so the ideal/advanced aspectRatio hint is silently ignored.
//
// This is the ONE safe, bounded corrective action the plan allows for that case: ask the SAME
// already-open track (via applyConstraints -- no new getUserMedia call, no permission re-prompt,
// no stream teardown/replacement) for the TRANSPOSE of what it just actually delivered, instead of
// repeating the original ideal numbers that already failed. If the device's own camera stack picks
// presets by area, the transposed numbers describe the exact same area/resolution class it already
// proved it can deliver -- just asking it to consider the portrait-shaped orientation of that same
// class, which a pure aspectRatio hint evidently failed to communicate.
export function getCorrectiveOrientationConstraints(
    actualWidth: number, actualHeight: number, wantPortrait: boolean,
): MediaTrackConstraints | null {
  if (!(actualWidth > 0) || !(actualHeight > 0)) return null;

  const deliveredIsPortrait = actualHeight > actualWidth;

  if (deliveredIsPortrait === wantPortrait) return null; // already matches -- nothing to correct

  const width = actualHeight; // transpose: ask for the mirror of what was actually delivered
  const height = actualWidth;
  const aspectRatio = width / height;

  return {
    width: { ideal: width }, height: { ideal: height }, aspectRatio: { ideal: aspectRatio },
    advanced: [ { aspectRatio } ],
  };
}

export interface OrientationCorrectionResult {
  attempted: boolean;
  corrected: boolean;
  before: { width: number; height: number } | null;
  after: { width: number; height: number } | null;
}

// Attempts the correction above EXACTLY ONCE per call -- never loops, never re-prompts for camera
// permission, never tears down or replaces the track. If applyConstraints throws, is unsupported,
// or the result still doesn't match, the ORIGINAL working stream is left exactly as it was: a
// camera that genuinely cannot deliver portrait keeps working, it just stays landscape, and that
// outcome is reported (not hidden) via the returned result for the caller to log.
export async function attemptOrientationCorrection(
    track: MediaStreamTrack | null | undefined,
): Promise<OrientationCorrectionResult> {
  const notAttempted: OrientationCorrectionResult = { attempted: false, corrected: false, before: null, after: null };

  if (!track || typeof track.getSettings !== 'function' || typeof track.applyConstraints !== 'function') {
    return notAttempted;
  }
  if (getCameraDeviceCategory() !== 'phone') return notAttempted;

  let settings: MediaTrackSettings;

  try {
    settings = track.getSettings();
  } catch {
    return notAttempted;
  }
  const width = Number(settings.width) || 0;
  const height = Number(settings.height) || 0;

  if (width <= 0 || height <= 0) return notAttempted;

  const wantPortrait = getCameraCaptureOrientationPreference() === 'portrait';
  const corrective = getCorrectiveOrientationConstraints(width, height, wantPortrait);

  if (!corrective) return notAttempted; // already matches the preference -- nothing to correct

  const before = { width, height };

  try {
    await track.applyConstraints(corrective);
  } catch {
    return { attempted: true, corrected: false, before, after: before };
  }

  let afterSettings: MediaTrackSettings;

  try {
    afterSettings = track.getSettings();
  } catch {
    return { attempted: true, corrected: false, before, after: null };
  }
  const afterWidth = Number(afterSettings.width) || 0;
  const afterHeight = Number(afterSettings.height) || 0;
  const after = { width: afterWidth, height: afterHeight };
  const nowMatches = afterWidth > 0 && afterHeight > 0 && ((afterHeight > afterWidth) === wantPortrait);

  return { attempted: true, corrected: nowMatches, before, after };
}

// Highest video height this client asks the bridge for, by call size. A one-to-one call can use
// the whole (large) tile so it may go up to 4K when the sender's camera and the network allow it;
// as the grid fills the tiles shrink so the request drops. Phones never ask for more than 720p
// (small screen). The bridge still decides per stream from the real bandwidth estimate.
export function getReceiveMaxHeightForCallSize(totalParticipants: number, screenShareActive = false): number {
  const mobileCap = isMobileBrowser() ? 720 : Infinity;
  let height: number;

  if (screenShareActive) height = 1080;
  else if (totalParticipants <= 2) height = 2160;
  else if (totalParticipants <= 4) height = 1080;
  else if (totalParticipants <= 8) height = 720;
  else height = 360;

  return Math.min(height, mobileCap);
}

// Opus voice bitrate per network state. Voice stays intelligible far below the default, so on a
// weak link it is lowered to protect the connection and raised again when the network recovers.
export function getAudioMaxBitrateBps(state: NetworkState): number {
  if (state === 'POOR') return 16000;
  if (state === 'DEGRADED' || state === 'RECOVERING') return 24000;

  return 40000;
}

// The ONE shared decision for how sharp video is allowed to be while a background effect is
// active -- used for BOTH the effect's own render/output height (JitsiStreamBackgroundEffect's
// setMaxOutputHeight) and the sender's video-quality ceiling (useJitsiMeeting's periodic
// network-quality effect), so the two can never disagree: the effect never renders more than the
// sender is allowed to send, and the sender is never asked to send more than the effect actually
// produces (see useJitsiMeeting.ts, which combines this with effect.getCurrentOutputHeight()).
// The compositor's own real-time performance (JitsiStreamBackgroundEffect's _perfCap governor) is
// a SEPARATE concern -- it protects against the CPU-bound lag a fixed 1080p target used to cause
// on ordinary hardware. This function only decides what the network/call size justify asking for;
// the effect combines it with what the machine can actually keep up with.
export const BG_MIN_HEIGHT = 480;
export const BG_MAX_HEIGHT = 1080;
// Named separately from BG_MIN_HEIGHT (even though it's the same value today) so POOR can be
// rolled back on its own -- e.g. back to the old, pre-effect 180 -- without touching the general
// floor DEGRADED and the GOOD thin-pipe hold below also use.
export const POOR_TARGET_HEIGHT = 480;

// A GOOD networkState is debounced (see updateNetworkStateFromMetrics) and can lag a few seconds
// behind reality. Reusing NETWORK_THRESHOLDS.poorBitrateKbps -- the one bitrate number the rest of
// this file already calibrates against -- as the trigger to hold at 720 instead of the full 1080
// ceiling catches a thin pipe sooner than waiting for the debounce to also call it DEGRADED/POOR,
// rather than inventing a second, uncalibrated threshold. Per-resolution bandwidth tiers (e.g. "is
// 1080p actually affordable at this bitrate") were considered and deliberately deferred -- this
// codebase has no configured per-resolution bitrate numbers to base them on (simulcast is off
// entirely) -- until real numbers are captured from a browser test; this remains the only
// bandwidth signal this function uses.
const GOOD_LOW_BANDWIDTH_KBPS = NETWORK_THRESHOLDS.poorBitrateKbps;

export function getTargetVideoHeight(
    state: NetworkState,
    callSizeMaxHeight: number,
    availableOutgoingBitrateKbps?: number | null
): number {
  if (state === 'POOR') return POOR_TARGET_HEIGHT;

  const ceiling = Math.min(callSizeMaxHeight, BG_MAX_HEIGHT);

  if (state === 'DEGRADED' || state === 'RECOVERING') return Math.max(BG_MIN_HEIGHT, Math.min(720, ceiling));

  // GOOD -- must never be lower than what a non-effect participant on the same network/call size
  // would send (the existing non-effect formula is max(callSizeMaxHeight, 720)), so this floors
  // at 720 regardless of call size or a thin live bandwidth sample; only the ceiling (up to 1080)
  // moves with call size above that.
  if (
    typeof availableOutgoingBitrateKbps === 'number' && availableOutgoingBitrateKbps > 0
    && availableOutgoingBitrateKbps < GOOD_LOW_BANDWIDTH_KBPS
  ) {
    return 720;
  }

  return Math.max(720, ceiling);
}

export function getNetworkStatusLabel(mode: LowDataMode, state: NetworkState): string {
  if (mode === 'audio-only') return 'Audio priority mode';
  if (state === 'POOR') return 'Limited connection';
  if (state === 'DEGRADED' || state === 'RECOVERING') return 'Adjusting video quality';

  return 'Good connection';
}

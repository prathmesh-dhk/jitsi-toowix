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

// Camera capture request. "ideal" makes the browser pick the closest mode the camera really has,
// so a 720p webcam stays at 720p, a 1080p one gets 1080p and a 4K one gets 4K. What is actually
// SENT is still capped by what the other participants ask the bridge for (see
// getReceiveMaxHeightForCallSize) and by the bandwidth estimate. Phones stay at 1080p to keep the
// encoder, battery and heat in check.
export function getCameraCaptureIdeal(): { frameRate: number; height: number; width: number } {
  return isMobileBrowser()
    ? { frameRate: 30, height: 1080, width: 1920 }
    : { frameRate: 30, height: 2160, width: 3840 };
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

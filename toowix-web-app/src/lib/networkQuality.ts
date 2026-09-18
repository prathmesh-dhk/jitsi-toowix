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

export const NETWORK_STATS_INTERVAL_MS = 2500;
export const NETWORK_RECOVERY_STABLE_MS = 10000;
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
    || (isNumber(metrics.availableOutgoingBitrateKbps) && metrics.availableOutgoingBitrateKbps < NETWORK_THRESHOLDS.poorBitrateKbps)
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
  participantCount: number
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
  if (state === 'DEGRADED' || state === 'RECOVERING') {
    return {
      audioOnly: false,
      desktopFps: 8,
      desktopMaxHeight: 720,
      desktopMaxWidth: 1280,
      lastN: 2,
      receiveMaxHeight: 360,
      sendMaxHeight: 360
    };
  }

  return {
    audioOnly: false,
    desktopFps: 10,
    desktopMaxHeight: 1080,
    desktopMaxWidth: 1920,
    lastN: normalLastN,
    receiveMaxHeight: 720,
    sendMaxHeight: 720
  };
}

export function getNetworkStatusLabel(mode: LowDataMode, state: NetworkState): string {
  if (mode === 'audio-only') return 'Audio priority mode';
  if (state === 'POOR') return 'Limited connection';
  if (state === 'DEGRADED' || state === 'RECOVERING') return 'Adjusting video quality';

  return 'Good connection';
}

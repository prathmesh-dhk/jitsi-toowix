import { useCallback, useEffect } from 'react';
import {
  classifyNetwork,
  NETWORK_RECOVERY_STABLE_MS,
  NETWORK_STATS_INTERVAL_MS,
  type INetworkMetrics,
  type LowDataMode,
  type NetworkState,
} from '../networkQuality';

// Extracted from useJitsiMeeting.ts (Track 3, Phase 2, item 4): network-quality metrics collection
// and state classification. Phase 1's original assessment called this "likely lower risk... more
// self-contained" than the conference-event wiring (item #3); re-reading the actual code before
// extracting (as instructed) found that's only partly true. `applyMediaQualityPolicy` -- which this
// code calls to react to a network-state change -- is NOT part of this concern: it's also called
// from screen-share-count changes and device-switch code elsewhere in the hook, so it stays in
// useJitsiMeeting.ts and is passed in here as a dependency, not moved. Likewise `networkState`/
// `networkMetricsRef` are read by several other unrelated parts of the hook (video-quality-for-
// effects sizing, the hook's own public return value), so their useState/useRef declarations also
// stay in useJitsiMeeting.ts -- only the logic that COMPUTES and UPDATES them moved here. This is
// the same "pass every real dependency in explicitly" shape as item #3's extraction, just with a
// smaller dependency list (12 vs ~25), not the near-zero-coupling move #1/#2 were.

const EMPTY_NETWORK_METRICS: INetworkMetrics = {
  availableOutgoingBitrateKbps: null,
  candidateType: null,
  connectionState: null,
  jitterMs: null,
  packetLossPercent: null,
  rttMs: null,
  videoBitrateKbps: null
};

interface IPreviousVideoStats {
  bytesSent: number;
  timestamp: number;
}

interface IPreviousPacketStats {
  packetsLost: number;
  packetsReceived: number;
}

export interface INetworkQualityDeps {
  joined: boolean;
  roomRef: { current: any };
  applyMediaQualityPolicy: (mode?: LowDataMode) => Promise<void>;
  lowDataModeRef: { current: LowDataMode };
  networkMetricsRef: { current: INetworkMetrics };
  networkStateRef: { current: NetworkState };
  previousVideoStatsRef: { current: IPreviousVideoStats | null };
  previousPacketStatsRef: { current: IPreviousPacketStats | null };
  poorSampleCountRef: { current: number };
  degradedSampleCountRef: { current: number };
  goodSinceRef: { current: number | null };
  setNetworkState: (state: NetworkState) => void;
}

/**
 * Polls the active Jitsi peer connection at a deliberately low rate and classifies the result into
 * the small GOOD/DEGRADED/POOR/RECOVERING state. Moved verbatim from useJitsiMeeting.ts; no
 * behavior change. Call once per render with the latest deps -- this is a real hook (useEffect
 * inside), not a plain function, since it owns the polling interval's lifecycle.
 */
export function useNetworkQualityMonitor(deps: INetworkQualityDeps): void {
  const {
    joined, roomRef, applyMediaQualityPolicy, lowDataModeRef, networkMetricsRef, networkStateRef,
    previousVideoStatsRef, previousPacketStatsRef, poorSampleCountRef, degradedSampleCountRef,
    goodSinceRef, setNetworkState,
  } = deps;

  const updateNetworkStateFromMetrics = useCallback(async (metrics: INetworkMetrics) => {
    networkMetricsRef.current = metrics;
    const observed = classifyNetwork(metrics);
    const now = Date.now();
    const current = networkStateRef.current;
    let next = current;

    if (observed === 'POOR') {
      poorSampleCountRef.current += 1;
      degradedSampleCountRef.current = 0;
      goodSinceRef.current = null;
      // This used to act on a single disconnected/failed/closed reading immediately, on the
      // theory that a real connection loss shouldn't wait. A browser can briefly report an old
      // ICE transport as disconnected while the bridge route is settling, especially when a
      // second participant joins. Treating one sample as a failure made the UI show "Limited"
      // and used to force lower video quality during an otherwise normal call. Two consecutive
      // samples keep the warning meaningful without making a one-off transport blip disruptive.
      if (poorSampleCountRef.current >= 2) {
        next = 'POOR';
      }
    } else if (observed === 'DEGRADED') {
      poorSampleCountRef.current = 0;
      degradedSampleCountRef.current += 1;
      goodSinceRef.current = null;
      if (degradedSampleCountRef.current >= 2 && current !== 'POOR') {
        next = 'DEGRADED';
      }
    } else {
      poorSampleCountRef.current = 0;
      degradedSampleCountRef.current = 0;
      if (current === 'GOOD') {
        next = 'GOOD';
      } else {
        goodSinceRef.current ||= now;
        const stableFor = now - goodSinceRef.current;

        if (stableFor >= NETWORK_RECOVERY_STABLE_MS && current !== 'RECOVERING') {
          next = 'RECOVERING';
        } else if (stableFor >= NETWORK_RECOVERY_STABLE_MS * 2 && current === 'RECOVERING') {
          next = 'GOOD';
          goodSinceRef.current = null;
        }
      }
    }

    if (next !== current) {
      networkStateRef.current = next;
      setNetworkState(next);
      // In automatic mode this only updates UI/telemetry. Jitsi/WebRTC retains sole ownership
      // of real-time congestion and simulcast adaptation. An explicit Low Data choice is still
      // honoured, but it is stable rather than oscillating with every sample.
      if (lowDataModeRef.current !== 'auto') {
        await applyMediaQualityPolicy(lowDataModeRef.current);
      }
      if (import.meta.env.DEV || import.meta.env.VITE_JITSI_DIAGNOSTICS === 'true') {
        console.info('[Toowix network] state changed', { state: next, metrics });
      }
    } else {
      // Keep collecting lightweight telemetry, but do not turn it into a second media-quality
      // controller. Jitsi's TCC/simulcast logic reacts directly to RTP feedback.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ applyMediaQualityPolicy ]);

  // Poll the active Jitsi peer connection at a deliberately low rate. Raw samples stay in refs;
  // the page only re-renders when the small GOOD/DEGRADED/POOR/RECOVERING state changes.
  useEffect(() => {
    if (!joined) {
      return;
    }
    let disposed = false;

    const collectNetworkMetrics = async () => {
      const room = roomRef.current;
      const connectionState = room?.getConnectionState?.() || null;
      const jitsiPeerConnection = room?.getActivePeerConnection?.();
      const peerConnection = jitsiPeerConnection?.peerconnection;

      if (!room || !peerConnection?.getStats) {
        await updateNetworkStateFromMetrics({ ...EMPTY_NETWORK_METRICS, connectionState });

        return;
      }
      try {
        const stats: RTCStatsReport = await peerConnection.getStats();

        if (disposed) {
          return;
        }
        const localCandidates = new Map<string, any>();
        let selectedPair: any = null;
        let packetsLost = 0;
        let packetsReceived = 0;
        let jitterSeconds: number | null = null;
        let videoBytesSent = 0;

        stats.forEach((report: any) => {
          if (report.type === 'local-candidate') {
            localCandidates.set(report.id, report);
          }
          if (report.type === 'candidate-pair' && (report.selected || (report.nominated && report.state === 'succeeded'))) {
            selectedPair = report;
          }
          const mediaKind = report.kind || report.mediaType;

          if ((report.type === 'inbound-rtp' || report.type === 'remote-inbound-rtp') && (mediaKind === 'audio' || mediaKind === 'video')) {
            packetsLost += Number(report.packetsLost) || 0;
            packetsReceived += Number(report.packetsReceived) || 0;
            if (mediaKind === 'audio' && Number.isFinite(report.jitter)) {
              jitterSeconds = Math.max(jitterSeconds || 0, Number(report.jitter));
            }
          }
          if (report.type === 'outbound-rtp' && mediaKind === 'video') {
            videoBytesSent += Number(report.bytesSent) || 0;
          }
        });

        const now = performance.now();
        const previous = previousVideoStatsRef.current;
        let videoBitrateKbps: number | null = null;

        if (previous && now > previous.timestamp && videoBytesSent >= previous.bytesSent) {
          videoBitrateKbps = ((videoBytesSent - previous.bytesSent) * 8) / (now - previous.timestamp);
        }
        previousVideoStatsRef.current = { bytesSent: videoBytesSent, timestamp: now };
        const localCandidate = selectedPair?.localCandidateId ? localCandidates.get(selectedPair.localCandidateId) : null;
        const availableOutgoingBitrate = selectedPair?.availableOutgoingBitrate;
        const currentRoundTripTime = selectedPair?.currentRoundTripTime;
        const previousPackets = previousPacketStatsRef.current;
        const lostDelta = previousPackets ? Math.max(0, packetsLost - previousPackets.packetsLost) : 0;
        const receivedDelta = previousPackets ? Math.max(0, packetsReceived - previousPackets.packetsReceived) : 0;
        const packetTotal = lostDelta + receivedDelta;

        previousPacketStatsRef.current = { packetsLost, packetsReceived };

        await updateNetworkStateFromMetrics({
          // Number(null) is 0. Edge often uses null/0 when it has no bandwidth
          // estimate, which must remain unknown rather than becoming a false alarm.
          availableOutgoingBitrateKbps: typeof availableOutgoingBitrate === 'number'
            && Number.isFinite(availableOutgoingBitrate)
            && availableOutgoingBitrate > 0
            ? availableOutgoingBitrate / 1000
            : null,
          candidateType: localCandidate?.candidateType || null,
          connectionState,
          jitterMs: jitterSeconds === null ? null : jitterSeconds * 1000,
          // Lifetime loss makes a recovered call look degraded forever. Use the delta between
          // samples so the status represents the current network window.
          packetLossPercent: previousPackets && packetTotal > 0 ? (lostDelta / packetTotal) * 100 : null,
          rttMs: typeof currentRoundTripTime === 'number' && Number.isFinite(currentRoundTripTime)
            ? currentRoundTripTime * 1000
            : null,
          videoBitrateKbps
        });
      } catch (err) {
        if (import.meta.env.DEV || import.meta.env.VITE_JITSI_DIAGNOSTICS === 'true') {
          console.warn('[Toowix network] WebRTC stats collection failed', err);
        }
      }
    };

    void applyMediaQualityPolicy(lowDataModeRef.current);
    void collectNetworkMetrics();
    const timer = window.setInterval(() => void collectNetworkMetrics(), NETWORK_STATS_INTERVAL_MS);

    return () => {
      disposed = true;
      window.clearInterval(timer);
      previousVideoStatsRef.current = null;
      previousPacketStatsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ applyMediaQualityPolicy, joined, updateNetworkStateFromMetrics ]);
}

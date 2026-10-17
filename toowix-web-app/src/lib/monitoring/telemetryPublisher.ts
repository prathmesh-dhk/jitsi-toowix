/**
 * Observes the conference's existing RTCPeerConnections. It never requests media,
 * changes tracks, or creates a peer connection of its own.
 */
export type PublisherOptions = {
  endpoint: string;
  token: string;
  meetingId: string;
  participantId: string;
  displayName?: string;
  intervalMs?: number;
  getPeerConnections: () => RTCPeerConnection[];
};

type Previous = Map<string, { bytes: number; at: number }>;

function videoStat(stats: RTCStatsReport, type: 'outbound-rtp' | 'inbound-rtp'): any {
  let selected: any;
  stats.forEach((stat: any) => {
    if (stat.type === type && (stat.kind === 'video' || stat.mediaType === 'video')) selected = stat;
  });
  return selected;
}

function rate(stat: any, key: string, previous: Previous): number {
  const now = performance.now();
  const id = `${key}:${stat.id}`;
  const last = previous.get(id);
  const bytes = Number(stat.bytesSent ?? stat.bytesReceived ?? 0);
  previous.set(id, { bytes, at: now });
  return !last || bytes < last.bytes || now <= last.at ? 0 : Math.round((bytes - last.bytes) * 8 / (now - last.at));
}

export function startTelemetryPublisher(options: PublisherOptions): () => void {
  const previous: Previous = new Map();
  const intervalMs = options.intervalMs ?? 3000;
  let stopped = false;
  let collecting = false;

  const collect = async () => {
    if (stopped || collecting) return;
    collecting = true;
    try {
      let rttMs: number | undefined;
      let packetLoss = 0;
      let uploadBitrateKbps = 0;
      let downloadBitrateKbps = 0;
      let send: any;
      let receive: any;

      for (const peerConnection of options.getPeerConnections()) {
        const stats = await peerConnection.getStats();
        send = videoStat(stats, 'outbound-rtp') ?? send;
        receive = videoStat(stats, 'inbound-rtp') ?? receive;
        stats.forEach((stat: any) => {
          if (stat.type === 'candidate-pair' && stat.state === 'succeeded' && stat.currentRoundTripTime != null) {
            rttMs = Math.round(stat.currentRoundTripTime * 1000);
          }
          if (stat.type === 'outbound-rtp' && (stat.kind === 'video' || stat.mediaType === 'video')) {
            uploadBitrateKbps += rate(stat, 'out', previous);
          }
          if (stat.type === 'inbound-rtp' && (stat.kind === 'video' || stat.mediaType === 'video')) {
            downloadBitrateKbps += rate(stat, 'in', previous);
            packetLoss += Number(stat.packetsLost ?? 0);
          }
        });
      }

      await fetch(options.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.token}` },
        body: JSON.stringify({
          meetingId: options.meetingId,
          participantId: options.participantId,
          displayName: options.displayName,
          connectionState: 'connected',
          network: { rttMs, packetLossPct: packetLoss, uploadBitrateKbps, downloadBitrateKbps },
          video: {
            sendWidth: send?.frameWidth, sendHeight: send?.frameHeight, sendFps: send?.framesPerSecond,
            receiveWidth: receive?.frameWidth, receiveHeight: receive?.frameHeight, receiveFps: receive?.framesPerSecond,
            codec: send?.codecId,
          },
        }),
        keepalive: true,
      });
    } finally {
      collecting = false;
    }
  };

  const id = window.setInterval(() => { void collect().catch(() => undefined); }, intervalMs);
  void collect().catch(() => undefined);
  return () => { stopped = true; window.clearInterval(id); };
}

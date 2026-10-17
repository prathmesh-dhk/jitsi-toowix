/**
 * Meeting-side observer. Import after the existing Jitsi/WebRTC join succeeds.
 * It reads existing RTCPeerConnection statistics only; it never creates media,
 * records calls, or sends media data.
 */
export type PublisherOptions = {
  endpoint: string;
  token: string;
  meetingId: string;
  participantId: string;
  displayName?: string;
  intervalMs?: number;
  getPeerConnections: () => RTCPeerConnection[];
  /** Optional Toowix mapping required for the sender → viewer quality matrix. */
  resolveSenderParticipantId?: (peer: RTCPeerConnection, report: any) => string | undefined;
  onError?: (error: unknown) => void;
};

type Previous = Map<string, { bytes: number; at: number }>;

const latest = (stats: RTCStatsReport, type: string, kind: string) => {
  let result: any;
  stats.forEach((stat: any) => {
    if (stat.type === type && (stat.kind === kind || stat.mediaType === kind)) result = stat;
  });
  return result;
};

const codec = (stats: RTCStatsReport, report: any) => {
  if (!report?.codecId) return undefined;
  let value: any;
  stats.forEach((stat: any) => {
    if (stat.id === report.codecId) value = stat;
  });
  return value?.mimeType ?? report.codecId;
};

const rounded = (value: number | undefined, digits = 0) => value === undefined ? undefined : Number(value.toFixed(digits));

const rate = (report: any, key: string, previous: Previous) => {
  if (!report) return 0;
  const now = performance.now();
  const id = `${key}:${report.id}`;
  const last = previous.get(id);
  const bytes = Number(report.bytesSent ?? report.bytesReceived ?? 0);
  previous.set(id, { bytes, at: now });
  return !last || bytes < last.bytes ? 0 : Math.round((bytes - last.bytes) * 8 / (now - last.at));
};

const lossPct = (report: any) => {
  if (!report) return undefined;
  const lost = Number(report.packetsLost ?? 0);
  const received = Number(report.packetsReceived ?? report.packetsSent ?? 0);
  return received + lost ? rounded(lost * 100 / (received + lost), 2) : 0;
};

function client() {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /Chrome\//.test(ua) ? 'Chrome'
      : /Firefox\//.test(ua) ? 'Firefox'
        : /Safari\//.test(ua) ? 'Safari'
          : 'Unknown';
  const os = /Windows/.test(ua) ? 'Windows'
    : /Android/.test(ua) ? 'Android'
      : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
        : /Mac OS X/.test(ua) ? 'macOS'
          : /Linux/.test(ua) ? 'Linux'
            : 'Unknown';
  return { browser, os };
}

function trackState(peerConnections: RTCPeerConnection[]) {
  let camera = false;
  let screen = false;
  for (const peerConnection of peerConnections) {
    for (const sender of peerConnection.getSenders()) {
      const track = sender.track;
      if (!track || track.kind !== 'video' || track.readyState !== 'live' || !track.enabled) continue;
      const settings = track.getSettings?.() as MediaTrackSettings | undefined;
      const display = settings?.displaySurface !== undefined || track.contentHint === 'detail' || track.contentHint === 'text';
      if (display) screen = true;
      else camera = true;
    }
  }
  return { camera, screen };
}

export function startTelemetryPublisher(options: PublisherOptions) {
  const previous: Previous = new Map();
  const interval = options.intervalMs ?? 3000;

  async function collect() {
    const peerConnections = options.getPeerConnections();
    let rttMs: number | undefined;
    let jitterMs: number | undefined;
    let uploadBitrateKbps = 0;
    let downloadBitrateKbps = 0;
    let packetLossPct: number | undefined;
    let sendVideo: any;
    let receiveVideo: any;
    let sendAudio: any;
    let receiveAudio: any;
    let iceState: string | undefined;
    const receivers: any[] = [];

    for (const peerConnection of peerConnections) {
      iceState ??= peerConnection.iceConnectionState;
      const stats = await peerConnection.getStats();
      const outboundVideo = latest(stats, 'outbound-rtp', 'video');
      const inboundVideo = latest(stats, 'inbound-rtp', 'video');
      const outboundAudio = latest(stats, 'outbound-rtp', 'audio');
      const inboundAudio = latest(stats, 'inbound-rtp', 'audio');
      sendVideo = outboundVideo ?? sendVideo;
      receiveVideo = inboundVideo ?? receiveVideo;
      sendAudio = outboundAudio ?? sendAudio;
      receiveAudio = inboundAudio ?? receiveAudio;
      uploadBitrateKbps += rate(outboundVideo, 'video-out', previous) + rate(outboundAudio, 'audio-out', previous);
      downloadBitrateKbps += rate(inboundVideo, 'video-in', previous) + rate(inboundAudio, 'audio-in', previous);
      jitterMs ??= inboundAudio?.jitter !== undefined
        ? Math.round(inboundAudio.jitter * 1000)
        : inboundVideo?.jitter !== undefined ? Math.round(inboundVideo.jitter * 1000) : undefined;
      packetLossPct ??= lossPct(inboundVideo) ?? lossPct(inboundAudio);
      stats.forEach((stat: any) => {
        if (stat.type === 'candidate-pair' && stat.state === 'succeeded' && stat.currentRoundTripTime !== undefined) {
          rttMs = Math.round(stat.currentRoundTripTime * 1000);
        }
      });
      if (inboundVideo) {
        const senderParticipantId = options.resolveSenderParticipantId?.(peerConnection, inboundVideo);
        if (senderParticipantId) {
          receivers.push({
            senderParticipantId,
            streamType: 'camera',
            width: inboundVideo.frameWidth ?? 0,
            height: inboundVideo.frameHeight ?? 0,
            fps: inboundVideo.framesPerSecond ?? 0,
            bitrateKbps: Math.round(rate(inboundVideo, 'matrix-video-in', previous)),
            packetLossPct: lossPct(inboundVideo),
            codec: codec(stats, inboundVideo),
          });
        }
      }
    }

    const tracks = trackState(peerConnections);
    const firstStats = peerConnections.length ? await peerConnections[0].getStats() : new Map() as any;
    const payload = {
      meetingId: options.meetingId,
      participantId: options.participantId,
      displayName: options.displayName,
      connectionState: peerConnections.some((peerConnection) => peerConnection.connectionState === 'connected')
        ? 'connected'
        : peerConnections.some((peerConnection) => peerConnection.connectionState === 'connecting') ? 'reconnecting' : 'disconnected',
      audioEnabled: !!sendAudio,
      cameraEnabled: tracks.camera,
      screenSharing: tracks.screen,
      client: client(),
      network: { rttMs, jitterMs, packetLossPct, uploadBitrateKbps, downloadBitrateKbps, iceState },
      video: {
        captureWidth: sendVideo?.frameWidth,
        captureHeight: sendVideo?.frameHeight,
        captureFps: sendVideo?.framesPerSecond,
        sendWidth: sendVideo?.frameWidth,
        sendHeight: sendVideo?.frameHeight,
        sendFps: sendVideo?.framesPerSecond,
        receiveWidth: receiveVideo?.frameWidth,
        receiveHeight: receiveVideo?.frameHeight,
        receiveFps: receiveVideo?.framesPerSecond,
        codec: codec(firstStats, sendVideo),
        frozenFrames: receiveVideo?.freezeCount,
        framesDropped: receiveVideo?.framesDropped,
        qualityLimitationReason: sendVideo?.qualityLimitationReason,
      },
      audio: {
        outboundBitrateKbps: Math.round(rate(sendAudio, 'audio-display-out', previous)),
        inboundBitrateKbps: Math.round(rate(receiveAudio, 'audio-display-in', previous)),
        codec: codec(firstStats, sendAudio),
        concealedSamples: receiveAudio?.concealedSamples,
      },
      receivers: receivers.length ? receivers : undefined,
    };

    const response = await fetch(options.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${options.token}` },
      body: JSON.stringify(payload),
      keepalive: true,
    });
    if (!response.ok) throw new Error(`Telemetry endpoint rejected the payload (${response.status})`);
  }

  const report = (error: unknown) => {
    if (options.onError) options.onError(error);
    else console.warn('[Toowix monitoring] telemetry publish failed', error);
  };
  const id = window.setInterval(() => void collect().catch(report), interval);
  void collect().catch(report);
  return () => window.clearInterval(id);
}

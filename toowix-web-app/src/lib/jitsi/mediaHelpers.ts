// Pure, dependency-free-of-the-hook helper functions used by useJitsiMeeting.ts. None of these
// close over any of that hook's own state/refs -- every input is an explicit parameter -- so they
// were the lowest-risk piece to extract first (Track 3, Phase 2, item 1). Moved verbatim; no
// behavior change.
import { setSpeakingLevel } from '../speakingStore';

export function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);

    if (existing) {
      resolve();

      return;
    }
    const el = document.createElement('script');

    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.body.appendChild(el);
  });
}

// lib-jitsi-meet wraps the native getUserMedia error into its OWN JitsiTrackError taxonomy and
// does not preserve the original DOMException name for anything it doesn't specifically
// recognize -- a real-hardware NotReadableError ("Could not start video/audio source", Chrome's
// own message text for it) comes out the other side as the generic JitsiTrackError name
// "gum.general", not "NotReadableError". Match on the message text too, since that's the only
// place the real cause survives.
export function isTransientDeviceBusyError(err: any): boolean {
  const name = err?.name || '';
  const message = err?.message || '';

  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return true;
  }

  return name === 'gum.general' && /could not start (video|audio) source/i.test(message);
}

export function trackToStream(track: any): MediaStream | null {
  if (!track) {
    return null;
  }
  if (track.stream) {
    return track.stream;
  }
  const nativeTrack = typeof track.getTrack === 'function' ? track.getTrack() : null;

  return nativeTrack ? new MediaStream([ nativeTrack ]) : null;
}

let localLevelMonitor: { stop: () => void } | null = null;

export function stopLocalLevelMonitor() {
  localLevelMonitor?.stop();
  localLevelMonitor = null;
  setSpeakingLevel('local', 0);
}

// Reads the live microphone level ten times a second for the green fill in the mic button and the
// speaking animation. Independent of the meeting library's own level reports, which are not always
// delivered for a locally adopted microphone.
export function startLocalLevelMonitor(track: any) {
  stopLocalLevelMonitor();
  const stream = trackToStream(track);

  if (!stream) {
    return;
  }
  try {
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    const buffer = new Float32Array(1024);

    analyser.fftSize = 1024;
    source.connect(analyser);
    const timer = window.setInterval(() => {
      if (track.isMuted?.()) {
        setSpeakingLevel('local', 0);

        return;
      }
      analyser.getFloatTimeDomainData(buffer);
      let sum = 0;

      for (let i = 0; i < buffer.length; i++) {
        sum += buffer[i] * buffer[i];
      }
      setSpeakingLevel('local', Math.min(1, Math.max(0, Math.sqrt(sum / buffer.length) * 4 - 0.06)));
    }, 100);

    localLevelMonitor = {
      stop: () => {
        window.clearInterval(timer);
        try { source.disconnect(); } catch { /* ignore */ }
        void ctx.close().catch(() => { });
      }
    };
  } catch { /* no Web Audio */ }
}

// Feeds the local mic level into the speaking store (id 'local') for the tile animation.
export function attachLocalSpeaking(track: any) {
  startLocalLevelMonitor(track);
  try {
    track?.addEventListener?.('track.audioLevelsChanged', (level: number) => {
      setSpeakingLevel('local', track.isMuted?.() ? 0 : level);
    });
  } catch { /* audio levels unavailable */ }
}

// Classifies a getUserMedia-style failure (native DOMException name, or lib-jitsi-meet's own
// JitsiTrackError name/message) into an exact, user-facing message -- never collapsed down to a
// generic "gum.general" catch-all so the real cause stays visible.
export function describeMediaError(kind: 'microphone' | 'camera', err: any): string {
  if (!window.isSecureContext) {
    return `Camera/microphone access requires HTTPS (or localhost). This page was loaded over an insecure connection.`;
  }

  const name = err?.name || '';
  const message = err?.message || '';

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'gum.permission_denied') {
    return `${kind === 'microphone' ? 'Microphone' : 'Camera'} permission denied. Please allow access in your browser settings.`;
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'gum.not_found') {
    return `No ${kind} found. Please connect a ${kind}.`;
  }
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
    return `The selected ${kind} does not support the requested settings. Falling back to the system default.`;
  }
  if (isTransientDeviceBusyError(err)) {
    return `${kind === 'microphone' ? 'Microphone' : 'Camera'} is currently in use by another application or tab.`;
  }

  return `Could not access ${kind} (${name || message || 'unknown error'}).`;
}

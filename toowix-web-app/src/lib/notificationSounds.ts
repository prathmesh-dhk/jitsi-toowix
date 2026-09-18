// Fully original, synthesized notification tones (Web Audio oscillators) -- deliberately NOT
// sampled/copied from Jitsi's or any other product's stock sound files, so each cue here is a
// distinct, small waveform generated at runtime rather than a shipped audio asset.

type ToneStep = { freq: number; startMs: number; durationMs: number; gain?: number; type?: OscillatorType };

let sharedContext: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const Ctor = window.AudioContext || (window as any).webkitAudioContext;

  if (!Ctor) {
    return null;
  }
  if (!sharedContext) {
    sharedContext = new Ctor();
  }
  if (sharedContext.state === 'suspended') {
    sharedContext.resume().catch(() => { });
  }

  return sharedContext;
}

function playTone(steps: ToneStep[]) {
  const ctx = getContext();

  if (!ctx) {
    return;
  }
  const now = ctx.currentTime;

  for (const step of steps) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = now + step.startMs / 1000;
    const duration = step.durationMs / 1000;
    const peak = step.gain ?? 0.12;

    osc.type = step.type || 'sine';
    osc.frequency.setValueAtTime(step.freq, start);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak, start + Math.min(0.02, duration / 4));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }
}

// Two quick ascending notes -- someone arriving.
export function playParticipantJoinedTone() {
  playTone([
    { freq: 587, startMs: 0, durationMs: 130 },
    { freq: 784, startMs: 100, durationMs: 160 }
  ]);
}

// Mirror of the join tone, descending -- someone leaving.
export function playParticipantLeftTone() {
  playTone([
    { freq: 659, startMs: 0, durationMs: 130 },
    { freq: 494, startMs: 100, durationMs: 180 }
  ]);
}

// A distinct three-note rising arpeggio -- recording is a higher-stakes event, gets a more
// deliberate/attention-grabbing cue than a plain join/leave blip.
export function playRecordingStartedTone() {
  playTone([
    { freq: 523, startMs: 0, durationMs: 140, gain: 0.14, type: 'triangle' },
    { freq: 659, startMs: 120, durationMs: 140, gain: 0.14, type: 'triangle' },
    { freq: 784, startMs: 240, durationMs: 220, gain: 0.15, type: 'triangle' }
  ]);
}

// A soft, low double-beep -- a gentle heads-up (time remaining), not an alert.
export function playTimeWarningTone() {
  playTone([
    { freq: 392, startMs: 0, durationMs: 160, gain: 0.1 },
    { freq: 392, startMs: 220, durationMs: 200, gain: 0.1 }
  ]);
}

// A longer three-note descending tone -- the meeting is ending now.
export function playMeetingEndedTone() {
  playTone([
    { freq: 587, startMs: 0, durationMs: 180, gain: 0.13, type: 'triangle' },
    { freq: 494, startMs: 160, durationMs: 180, gain: 0.13, type: 'triangle' },
    { freq: 392, startMs: 320, durationMs: 280, gain: 0.14, type: 'triangle' }
  ]);
}

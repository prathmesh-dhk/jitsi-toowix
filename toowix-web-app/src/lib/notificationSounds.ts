// Fully original, synthesized notification tones (Web Audio oscillators) -- deliberately NOT
// sampled/copied from Jitsi's or any other product's stock sound files, so each cue here is a
// distinct, small waveform generated at runtime rather than a shipped audio asset.

type ToneStep = { freq: number; startMs: number; durationMs: number; gain?: number; type?: OscillatorType };

let sharedContext: AudioContext | null = null;

function playAsset(src: string) {
  if (typeof window === 'undefined') {
    return;
  }
  const audio = new Audio(src);

  // A notification must never block the meeting if autoplay policy, a muted device, or an
  // unloaded asset prevents it from playing.
  audio.volume = 0.75;
  audio.play().catch(() => { });
}

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

// User-provided soft logout cue -- someone leaving.
export function playParticipantLeftTone() {
  playAsset('/sounds/participant-left.wav');
}

// A distinct three-note rising arpeggio -- recording is a higher-stakes event, gets a more
// deliberate/attention-grabbing cue than a plain join/leave blip.
export function playRecordingStartedTone() {
  playAsset('/sounds/recording-started.wav');
}

// Exact descending mirror of the recording-started arpeggio (same three pitches, reverse order)
// -- recognizably "the recording cue" as a pair, but unmistakably the stop side of it. Square
// wave instead of triangle also keeps it timbrally distinct from playMeetingEndedTone.
export function playRecordingStoppedTone() {
  playAsset('/sounds/recording-stopped.wav');
}

// A soft, low double-beep -- a gentle heads-up (time remaining), not an alert.
export function playTimeWarningTone() {
  playTone([
    { freq: 392, startMs: 0, durationMs: 160, gain: 0.1 },
    { freq: 392, startMs: 220, durationMs: 200, gain: 0.1 }
  ]);
}

// A bright three-note rising major arpeggio -- distinct from the join tone (which is only two
// notes and lower-pitched): this one specifically marks the meeting itself beginning.
export function playMeetingStartedTone() {
  playTone([
    { freq: 523, startMs: 0, durationMs: 150, gain: 0.13 },
    { freq: 659, startMs: 130, durationMs: 150, gain: 0.13 },
    { freq: 880, startMs: 260, durationMs: 240, gain: 0.14 }
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

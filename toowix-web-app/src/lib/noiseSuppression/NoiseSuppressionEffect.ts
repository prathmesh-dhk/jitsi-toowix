// "Extra noise suppression" for the microphone.
//
// Graph:  mic -> high-pass (removes rumble) -> RNNoise worklet (removes steady background noise)
//             -> voice gate worklet (quietens anything much softer than your own voice, e.g. people
//                talking behind you, and adds a little make-up gain) -> output track
//
// Two rules keep it safe:
//  * Until the worklets have loaded (or if they can't load at all) the mic is passed straight through,
//    so turning the effect on can never leave you silent.
//  * The audio context is created at 48 kHz (what the RNNoise model expects) and is recreated on demand,
//    never left suspended, so switching the effect off and on again keeps working.
const WORKLET_URL = '/libs/noise-suppressor-worklet.min.js';
const RNNOISE_SAMPLE_RATE = 48000;

const GATE_WORKLET_SOURCE = `
class ToowixNoiseGate extends AudioWorkletProcessor {
  constructor() { super(); this.gain = 0; this.hold = 0; this.peak = 0; }
  process(inputs, outputs) {
    const input = inputs[0] && inputs[0][0];
    const output = outputs[0];
    if (!input || !output || !output[0]) return true;
    const n = input.length;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += input[i] * input[i];
    const rms = Math.sqrt(sum / n);
    const dt = n / sampleRate;
    // Slow peak follower of how loud YOUR voice is (about an 8 second half-life).
    this.peak = Math.max(rms, this.peak * Math.pow(0.5, dt / 8));
    const relative = this.peak > 0.02 ? this.peak * 0.22 : 0;
    const threshold = Math.max(0.0035, relative);
    if (rms >= threshold) this.hold = 0.3; else this.hold = Math.max(0, this.hold - dt);
    const target = this.hold > 0 ? 1 : 0.05;
    this.gain += (target - this.gain) * Math.min(1, target > this.gain ? dt / 0.006 : dt / 0.12);
    const g = this.gain * 1.8;
    for (let c = 0; c < output.length; c++) {
      const out = output[c];
      for (let i = 0; i < n; i++) {
        const x = input[i] * g;
        const a = Math.abs(x);
        out[i] = a > 0.6 ? Math.sign(x) * (0.6 + 0.4 * Math.tanh((a - 0.6) / 0.4)) : x;
      }
    }
    return true;
  }
}
registerProcessor('ToowixNoiseGate', ToowixNoiseGate);
`;

let audioContext: AudioContext | null = null;
let activeEffects = 0;
const workletLoads = new WeakMap<AudioContext, Promise<void>>();
let gateUrl: string | null = null;

function getContext(): AudioContext {
  if (!audioContext || audioContext.state === 'closed') {
    audioContext = new AudioContext({ sampleRate: RNNOISE_SAMPLE_RATE });
  }
  if (audioContext.state === 'suspended') {
    void audioContext.resume().catch(() => { });
  }

  return audioContext;
}

function loadWorklets(ctx: AudioContext): Promise<void> {
  let loading = workletLoads.get(ctx);

  if (!loading) {
    if (!gateUrl) {
      gateUrl = URL.createObjectURL(new Blob([ GATE_WORKLET_SOURCE ], { type: 'application/javascript' }));
    }
    loading = Promise.all([ ctx.audioWorklet.addModule(WORKLET_URL), ctx.audioWorklet.addModule(gateUrl) ]).then(() => undefined);
    workletLoads.set(ctx, loading);
  }

  return loading;
}

export class NoiseSuppressionEffect {
  private _ctx!: AudioContext;
  private _audioSource!: MediaStreamAudioSourceNode;
  private _highPass!: BiquadFilterNode;
  private _audioDestination!: MediaStreamAudioDestinationNode;
  private _denoiseNode?: AudioWorkletNode;
  private _gateNode?: AudioWorkletNode;
  private _originalMediaTrack!: MediaStreamTrack;
  private _outputMediaTrack!: MediaStreamTrack;
  private _stopped = false;

  startEffect(audioStream: MediaStream): MediaStream {
    this._originalMediaTrack = audioStream.getAudioTracks()[0];
    this._ctx = getContext();
    activeEffects++;

    this._audioSource = this._ctx.createMediaStreamSource(audioStream);
    this._highPass = this._ctx.createBiquadFilter();
    this._highPass.type = 'highpass';
    this._highPass.frequency.value = 90;
    this._audioDestination = this._ctx.createMediaStreamDestination();
    this._outputMediaTrack = this._audioDestination.stream.getAudioTracks()[0];

    // Straight pass-through until the denoiser is ready.
    this._audioSource.connect(this._highPass);
    this._highPass.connect(this._audioDestination);

    loadWorklets(this._ctx).then(() => {
      if (this._stopped) {
        return;
      }
      this._denoiseNode = new AudioWorkletNode(this._ctx, 'NoiseSuppressorWorklet');
      this._gateNode = new AudioWorkletNode(this._ctx, 'ToowixNoiseGate');
      this._highPass.disconnect(this._audioDestination);
      this._highPass.connect(this._denoiseNode);
      this._denoiseNode.connect(this._gateNode);
      this._gateNode.connect(this._audioDestination);
    }).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[NoiseSuppression] could not load the denoiser; passing the microphone through unchanged:', err);
    });

    // Sync the effect track's muted state with the original track, then keep the original track
    // itself always enabled -- from this point on, mute/unmute only toggles the OUTPUT track.
    this._outputMediaTrack.enabled = this._originalMediaTrack.enabled;
    this._originalMediaTrack.enabled = true;

    return this._audioDestination.stream;
  }

  isEnabled(sourceLocalTrack: any): boolean {
    return sourceLocalTrack.isAudioTrack();
  }

  stopEffect(): void {
    this._stopped = true;
    this._originalMediaTrack.enabled = this._outputMediaTrack.enabled;

    try {
      this._denoiseNode?.port?.close();
      this._audioDestination?.disconnect();
      this._gateNode?.disconnect();
      this._denoiseNode?.disconnect();
      this._highPass?.disconnect();
      this._audioSource?.disconnect();
    } catch {
      // nodes may already be disconnected
    }

    activeEffects = Math.max(0, activeEffects - 1);
    // Free the audio thread once nothing uses it; the next start builds a fresh, running context.
    if (activeEffects === 0 && audioContext) {
      const old = audioContext;

      audioContext = null;
      void old.close().catch(() => { });
    }
  }
}

export default NoiseSuppressionEffect;

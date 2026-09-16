// Trimmed port of jitsi-meet's stream-effects/noise-suppression/NoiseSuppressionEffect.ts --
// RNNoise path only (the upstream file also supports "Krisp", a commercial SDK requiring a paid
// license and model files we don't have, so that branch is left out entirely).
//
// Runs the actual denoising in an AudioWorklet (a background audio thread, not the main thread)
// using a prebuilt bundle (/libs/noise-suppressor-worklet.min.js) that already has the RNNoise
// WASM model embedded inside it -- no separate model fetch needed.
let audioContext: AudioContext | null = null;

const WORKLET_URL = '/libs/noise-suppressor-worklet.min.js';

let workletModulePromise: Promise<void> | null = null;

function loadWorkletOnce(ctx: AudioContext): Promise<void> {
  if (!workletModulePromise) {
    workletModulePromise = ctx.audioWorklet.addModule(WORKLET_URL).catch(err => {
      workletModulePromise = null;
      throw err;
    });
  }

  return workletModulePromise;
}

export class NoiseSuppressionEffect {
  private _audioSource!: MediaStreamAudioSourceNode;
  private _audioDestination!: MediaStreamAudioDestinationNode;
  private _noiseSuppressorNode?: AudioWorkletNode;
  private _originalMediaTrack!: MediaStreamTrack;
  private _outputMediaTrack!: MediaStreamTrack;

  startEffect(audioStream: MediaStream): MediaStream {
    this._originalMediaTrack = audioStream.getAudioTracks()[0];

    if (!audioContext) {
      audioContext = new AudioContext();
    }

    this._audioSource = audioContext.createMediaStreamSource(audioStream);
    this._audioDestination = audioContext.createMediaStreamDestination();
    this._outputMediaTrack = this._audioDestination.stream.getAudioTracks()[0];

    loadWorkletOnce(audioContext).then(() => {
      if (!audioContext) {
        return;
      }
      this._noiseSuppressorNode = new AudioWorkletNode(audioContext, 'NoiseSuppressorWorklet');
      this._audioSource.connect(this._noiseSuppressorNode);
      this._noiseSuppressorNode.connect(this._audioDestination);
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
    this._originalMediaTrack.enabled = this._outputMediaTrack.enabled;

    // Closing the worklet's port is the documented cleanup step; the node/context itself has a
    // known Chrome GC quirk (crbug 1298955) where the worklet isn't collected promptly, but
    // audioContext.suspend() below keeps it from consuming CPU regardless.
    this._noiseSuppressorNode?.port?.close();
    this._audioDestination?.disconnect();
    this._noiseSuppressorNode?.disconnect();
    this._audioSource?.disconnect();

    audioContext?.suspend();
  }
}

export default NoiseSuppressionEffect;

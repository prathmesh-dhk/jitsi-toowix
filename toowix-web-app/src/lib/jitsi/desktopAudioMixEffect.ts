// CONFIRMED BUG (traced into lib-jitsi-meet.min.js's actual JitsiLocalTrack class, not assumed):
// useJitsiMeeting.ts's screen-share-audio code used to call `microphoneJitsiTrack.replaceTrack(...)`
// to swap the published microphone sender's source for a mix of the mic + the shared tab/window's
// audio. JitsiLocalTrack HAS NO replaceTrack METHOD AT ALL (confirmed by listing every method on
// the real class: mute, unmute, setEffect, stopStream, isMuted, setSourceName, setSsrc, and a
// handful of camera/device-switch internals -- replaceTrack is not among them; it only exists on
// JitsiConference, a different object, with a different signature). The call site's own defensive
// `typeof microphoneJitsiTrack.replaceTrack !== 'function'` guard was therefore always true,
// throwing on every single attempt -- "Share audio" never actually transmitted anything, silently
// falling back to a video-only share with nothing but a console.warn, exactly the reported bug.
//
// The real, public, already-proven-in-this-codebase mechanism for swapping what a JitsiLocalTrack
// actually transmits is setEffect() -- the SAME mechanism NoiseSuppressionEffect.ts and virtual
// background already use. This class is a `setEffect`-compatible effect (startEffect/isEnabled/
// stopEffect, matching NoiseSuppressionEffect's own exact shape) that mixes the local microphone
// with the shared source's own audio track via a small Web Audio graph, so viewers hear both over
// the ONE audio source JVB actually forwards per endpoint (mixing into the existing mic sender,
// rather than adding a second room audio track, is deliberate -- see useJitsiMeeting.ts's own
// comment on that point, confirmed separately: the bridge does not forward a second one).
export class DesktopAudioMixEffect {
  private _ctx: AudioContext | null = null;
  private _micSource: MediaStreamAudioSourceNode | null = null;
  private _micGain: GainNode | null = null;
  private _displaySource: MediaStreamAudioSourceNode | null = null;
  private _destination: MediaStreamAudioDestinationNode | null = null;

  constructor(
    private readonly displayAudioTrack: MediaStreamTrack,
    // The participant may have joined muted. Jitsi's mute is a whole-sender mute, not a
    // mic-samples-only mute -- unmuting the sender is what's required to transmit the shared
    // audio at all, but the ORIGINAL mic must still sound silent to listeners while the
    // participant's own mute toggle stays visually "muted". Mixing the mic in at gain 0 (instead
    // of skipping it entirely) keeps a single, simple audio graph regardless of mute state.
    private readonly micWasMuted: boolean,
  ) {}

  startEffect(micStream: MediaStream): MediaStream {
    const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioContextCtor();

    this._ctx = ctx;
    this._destination = ctx.createMediaStreamDestination();

    const micTrack = micStream.getAudioTracks()[0];

    if (micTrack) {
      this._micSource = ctx.createMediaStreamSource(new MediaStream([ micTrack ]));
      this._micGain = ctx.createGain();
      this._micGain.gain.value = this.micWasMuted ? 0 : 1;
      this._micSource.connect(this._micGain).connect(this._destination);
    }

    this._displaySource = ctx.createMediaStreamSource(new MediaStream([ this.displayAudioTrack ]));
    this._displaySource.connect(this._destination);

    return this._destination.stream;
  }

  // Matches NoiseSuppressionEffect.isEnabled's own contract exactly -- setEffect() calls this to
  // confirm the effect is being applied to a compatible track before switching.
  isEnabled(sourceLocalTrack: { isAudioTrack: () => boolean }): boolean {
    return sourceLocalTrack.isAudioTrack();
  }

  stopEffect(): void {
    try {
      this._micSource?.disconnect();
      this._micGain?.disconnect();
      this._displaySource?.disconnect();
      this._destination?.disconnect();
    } catch {
      // nodes may already be disconnected
    }
    void this._ctx?.close().catch(() => { /* best-effort */ });
    this._ctx = null;
  }
}

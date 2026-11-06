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
// stopEffect, matching NoiseSuppressionEffect's own exact shape).
//
// SECOND reported bug, previously "fixed" by dropping the mic from this graph entirely: an
// earlier version mixed the local microphone into the shared audio by varying the SHARED audio's
// own gain based on mic mute state (0 while muted, full while unmuted) -- that coupling meant
// muted sometimes produced no shared audio at all, unmuted leaked the presenter's own voice into
// the shared audio's gain node instead of mixing cleanly. The fix at the time removed the mic from
// the graph completely, which went too far the other way: while sharing audio, listeners heard
// ONLY the shared source, never the presenter's own voice (reported again: "my mic is getting off
// ... both should be transmitted simultaneously"). The real fix is to give each source its OWN
// independent gain node: the shared audio's gain is always 1 (sharing audio must never depend on
// mic state), and the mic's gain is a separate node gated ONLY by the mic's own actual mute state
// (via setMuted below, Jitsi's real extension point for this -- see this file's next paragraph).
// Both play simultaneously; muting the mic silences just the mic's contribution.
export class DesktopAudioMixEffect {
  private _ctx: AudioContext | null = null;
  private _micSource: MediaStreamAudioSourceNode | null = null;
  private _micGain: GainNode | null = null;
  private _displaySource: MediaStreamAudioSourceNode | null = null;
  private _destination: MediaStreamAudioDestinationNode | null = null;

  // initiallyMuted reflects the mic's real mute state at the moment sharing starts (the presenter
  // may already have muted themselves before turning on audio sharing) -- startEffect() has no
  // other way to learn this, since JitsiLocalTrack only calls setMuted() for mute state CHANGES
  // that happen after the effect is already attached, not the state it was attached under.
  constructor(private readonly displayAudioTrack: MediaStreamTrack, private readonly initiallyMuted: boolean = false) {}

  // Confirmed in the real JitsiLocalTrack._setMuted source: for an audio track with an active
  // _streamEffect, Jitsi's own mute()/unmute() routes through `effect.setMuted(muted)` instead of
  // touching the transmitted track's `.enabled` directly. That is the library's real, intended
  // extension point for an effect that needs custom mute behavior -- used below to gate only the
  // mic's own gain node, never the shared audio's.
  startEffect(micStream: MediaStream): MediaStream {
    const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioContextCtor();

    this._ctx = ctx;
    this._destination = ctx.createMediaStreamDestination();

    this._displaySource = ctx.createMediaStreamSource(new MediaStream([ this.displayAudioTrack ]));
    this._displaySource.connect(this._destination);

    if (micStream.getAudioTracks().length > 0) {
      this._micSource = ctx.createMediaStreamSource(micStream);
      this._micGain = ctx.createGain();
      this._micGain.gain.value = this.initiallyMuted ? 0 : 1;
      this._micSource.connect(this._micGain).connect(this._destination);
    }

    return this._destination.stream;
  }

  // Matches NoiseSuppressionEffect.isEnabled's own contract exactly -- setEffect() calls this to
  // confirm the effect is being applied to a compatible track before switching.
  isEnabled(sourceLocalTrack: { isAudioTrack: () => boolean }): boolean {
    return sourceLocalTrack.isAudioTrack();
  }

  // Silences only the mic's own contribution to the mix -- the shared audio's gain node is
  // untouched here and keeps playing at full volume regardless of the presenter's mic state.
  setMuted(muted: boolean): void {
    if (this._micGain) {
      this._micGain.gain.value = muted ? 0 : 1;
    }
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

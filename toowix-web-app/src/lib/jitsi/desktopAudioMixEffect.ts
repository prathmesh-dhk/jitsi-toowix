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
// SECOND reported bug, fixed in this same class: an earlier version of this effect mixed the local
// microphone into the shared audio (at gain 0 while muted, full volume while unmuted) so there was
// always a single combined stream to hand to the one audio sender JVB forwards. That coupled the
// presenter's own mic state to whether shared audio worked at all -- muted sometimes produced no
// audio whatsoever, unmuted leaked the presenter's own voice into the shared audio, neither of
// which is desired. This version carries ONLY the shared source's own audio -- the presenter's mic
// is never connected to this graph at all, so what listeners hear while audio sharing is active is
// always exactly the shared tab/window/screen's own sound, completely independent of whether the
// presenter's mic is on or off.
//
// Confirmed in the real JitsiLocalTrack._setMuted source: for an audio track with an active
// _streamEffect, Jitsi's own mute()/unmute() routes through `effect.setMuted(muted)` instead of
// touching the transmitted track's `.enabled` directly -- this is the library's own intended
// extension point for an effect that needs custom mute behavior, confirmed by that exact
// conditional existing in the real minified source. Implementing it below as a no-op is what
// keeps the shared audio playing through any later mic mute/unmute the presenter does while
// sharing, and removes the need to force-unmute the sender (and the race that could introduce)
// before applying this effect in the first place.
export class DesktopAudioMixEffect {
  private _ctx: AudioContext | null = null;
  private _displaySource: MediaStreamAudioSourceNode | null = null;
  private _destination: MediaStreamAudioDestinationNode | null = null;

  constructor(private readonly displayAudioTrack: MediaStreamTrack) {}

  // The mic's own current stream is still the parameter setEffect()'s internals pass in (see
  // JitsiLocalTrack._startStreamEffect), but it is deliberately never connected into this graph --
  // see this file's own top comment for why.
  startEffect(_micStream: MediaStream): MediaStream {
    const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioContextCtor();

    this._ctx = ctx;
    this._destination = ctx.createMediaStreamDestination();
    this._displaySource = ctx.createMediaStreamSource(new MediaStream([ this.displayAudioTrack ]));
    this._displaySource.connect(this._destination);

    return this._destination.stream;
  }

  // Matches NoiseSuppressionEffect.isEnabled's own contract exactly -- setEffect() calls this to
  // confirm the effect is being applied to a compatible track before switching.
  isEnabled(sourceLocalTrack: { isAudioTrack: () => boolean }): boolean {
    return sourceLocalTrack.isAudioTrack();
  }

  // See this file's own top comment -- deliberately a no-op. The shared audio must keep playing
  // for everyone regardless of the presenter's own mic mute state; the mic was never part of this
  // graph, so there is nothing here that muting should silence.
  setMuted(_muted: boolean): void {}

  stopEffect(): void {
    try {
      this._displaySource?.disconnect();
      this._destination?.disconnect();
    } catch {
      // nodes may already be disconnected
    }
    void this._ctx?.close().catch(() => { /* best-effort */ });
    this._ctx = null;
  }
}

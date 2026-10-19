import { useSyncExternalStore } from 'react';

// Tiny external store so a participant starting/stopping talking re-renders only that tile's
// indicator, never the whole meeting page.
const speaking = new Map<string, boolean>();
const holdTimers = new Map<string, ReturnType<typeof setTimeout>>();
const onsetTimers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Map<string, Set<() => void>>();
const levels = new Map<string, number>();
const levelListeners = new Map<string, Set<() => void>>();

const emit = (id: string) => listeners.get(id)?.forEach((l) => l());

function set(id: string, value: boolean) {
  if ((speaking.get(id) || false) === value) {
    return;
  }
  speaking.set(id, value);
  emit(id);
}

// level is 0..1 from lib-jitsi-meet; a short hold stops the indicator flickering between words.
function publishLevel(id: string, level: number) {
  // Quantised so the mic icon only redraws when the fill would visibly change.
  const q = Math.round(Math.min(1, Math.max(0, level)) * 20) / 20;

  if ((levels.get(id) || 0) !== q) {
    levels.set(id, q);
    levelListeners.get(id)?.forEach((l) => l());
  }
}

// Real reported bug: the speaking ring flickered off and back on during completely normal
// speech -- it dropped during any gap between words/sentences longer than the previous 500ms
// default, which ordinary speech cadence (a breath, a pause before the next sentence) regularly
// exceeds. Neither call site that feeds this (the local mic's own 10x/second RMS level monitor in
// mediaHelpers.ts, nor the remote per-track TRACK_AUDIO_LEVEL_CHANGED listener in
// useConferenceEvents.ts) passes an explicit holdMs, so both were silently relying on this
// default -- raising it here fixes the ring for local AND remote participants without touching
// either call site. 1200ms is the same "active speaking turn" hangover window other meeting UIs
// use (long enough to smooth over a natural pause mid-sentence, still short enough to clear
// promptly once someone genuinely stops talking) -- distinct from DOMINANT_SPEAKER_CHANGED's own
// explicit 2500ms fallback hold (useConferenceEvents.ts), which exists for a different reason
// (covering a gap with no audio-level data at all, not smoothing normal speech).
// Real reported bug: the speaking ring flickered on and off while the person wasn't actually
// talking. Root cause -- only the "stop speaking" side had any debounce (the 1200ms hold below);
// a level blip from ordinary background/room noise crossing the threshold turned the ring on
// INSTANTLY, with nothing to tell a brief noise spike apart from someone genuinely starting to
// talk. SPEAKING_ONSET_DELAY_MS adds the same kind of hysteresis to the "start speaking" side:
// the level has to stay above threshold for a short sustained window before the ring actually
// shows, so a quick blip that drops back down before that elapses never flips it on at all.
const SPEAKING_ONSET_DELAY_MS = 300;

export function setSpeakingLevel(id: string, level: number, holdMs = 1200) {
  publishLevel(id, level);
  if (level > 0.04) {
    const holdTimer = holdTimers.get(id);

    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimers.delete(id);
    }
    if (!speaking.get(id) && !onsetTimers.has(id)) {
      onsetTimers.set(id, setTimeout(() => {
        onsetTimers.delete(id);
        set(id, true);
      }, SPEAKING_ONSET_DELAY_MS));
    }
  } else {
    const onsetTimer = onsetTimers.get(id);

    if (onsetTimer) {
      // Dropped back down before the onset delay elapsed -- was just a blip, never actually
      // turn the ring on for it.
      clearTimeout(onsetTimer);
      onsetTimers.delete(id);
    }
    if (speaking.get(id) && !holdTimers.has(id)) {
      holdTimers.set(id, setTimeout(() => {
        holdTimers.delete(id);
        set(id, false);
      }, holdMs));
    }
  }
}

export function clearSpeaking(id: string) {
  publishLevel(id, 0);
  const onsetTimer = onsetTimers.get(id);

  if (onsetTimer) {
    clearTimeout(onsetTimer);
    onsetTimers.delete(id);
  }
  const holdTimer = holdTimers.get(id);

  if (holdTimer) {
    clearTimeout(holdTimer);
    holdTimers.delete(id);
  }
  set(id, false);
}

// Non-hook snapshot read, for callers outside React's render cycle (e.g. a setInterval-driven
// canvas draw loop like the PiP composite frame) that can't use useSyncExternalStore.
export function isSpeakingNow(id: string | undefined): boolean {
  return id ? speaking.get(id) || false : false;
}

export function useSpeaking(id: string | undefined): boolean {
  return useSyncExternalStore(
    (cb) => {
      if (!id) {
        return () => { };
      }
      let set_ = listeners.get(id);

      if (!set_) {
        set_ = new Set();
        listeners.set(id, set_);
      }
      set_.add(cb);

      return () => { set_!.delete(cb); };
    },
    () => (id ? speaking.get(id) || false : false)
  );
}

// Live input level (0..1, in 0.05 steps) for one participant, e.g. 'local' for your own microphone.
export function useAudioLevel(id: string): number {
  return useSyncExternalStore(
    (cb) => {
      let set_ = levelListeners.get(id);

      if (!set_) {
        set_ = new Set();
        levelListeners.set(id, set_);
      }
      set_.add(cb);

      return () => { set_!.delete(cb); };
    },
    () => levels.get(id) || 0
  );
}

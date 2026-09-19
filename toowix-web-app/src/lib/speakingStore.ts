import { useSyncExternalStore } from 'react';

// Tiny external store so a participant starting/stopping talking re-renders only that tile's
// indicator, never the whole meeting page.
const speaking = new Map<string, boolean>();
const holdTimers = new Map<string, ReturnType<typeof setTimeout>>();
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

export function setSpeakingLevel(id: string, level: number, holdMs = 500) {
  publishLevel(id, level);
  if (level > 0.04) {
    const timer = holdTimers.get(id);

    if (timer) {
      clearTimeout(timer);
      holdTimers.delete(id);
    }
    set(id, true);
  } else if (speaking.get(id) && !holdTimers.has(id)) {
    holdTimers.set(id, setTimeout(() => {
      holdTimers.delete(id);
      set(id, false);
    }, holdMs));
  }
}

export function clearSpeaking(id: string) {
  publishLevel(id, 0);
  const timer = holdTimers.get(id);

  if (timer) {
    clearTimeout(timer);
    holdTimers.delete(id);
  }
  set(id, false);
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

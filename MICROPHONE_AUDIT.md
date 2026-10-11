# Microphone Audit — Toowix Meet

**Date:** 2026-10-13
**Scope:** `toowix-web-app` (frontend) and `toowix-backend` (settings schema/API)
**Method:** full trace of the `devicechange` → enumeration → switch code path, plus a repo-wide search for every mic-related setting and where (if anywhere) it's actually read.

---

## Summary

There are **two separate, unrelated systems** in this app that both look like "mic settings," and they behave very differently:

1. **In-call mic controls** (device picker, join-muted, push-to-talk, noise suppression toggle) — these are **real and wired up**. They live in `localStorage`, not the backend, and take effect immediately.
2. **Settings → Meetings "mic preferences"** (`muteMicOnJoin`, `autoAdjustMicVolume`, `noiseSuppression` defaults) — these are **saved to the backend and never read by the meeting room at all**. Toggling them does nothing. This isn't mic-specific — **the entire `meetingDefaults` object that page saves is unused by `MeetingRoomPage.tsx`**, confirmed by a direct search (zero references to `meetingDefaults`, `cameraOffOnJoin`, `useHdVideo`, or `displayParticipantNames` anywhere in the meeting room code). The same pattern was found and fixed for the "Mirror my video" toggle on 2026-10-12 (see `CAMERA_MIRRORING_AUDIT.md`) — these three mic fields are the same class of dead setting, just not yet cleaned up.

Separately, **automatic Bluetooth mic switching** (AirPods and similar headsets) is a real, actively-developed feature with its own non-trivial logic, covered in detail in §2.

---

## 1. Mic settings inventory — what's real vs. dead

| Setting | Where it lives | Where it's read | Status |
|---|---|---|---|
| **Microphone device selection** | `audioId` state, `src/pages/MeetingRoomPage.tsx` — persisted to `localStorage['toowix_audio_device']` | `applyJitsiDevice('audioInput', ...)` → `jitsiMeeting.switchDevice` → real `replaceTrack` | **Real.** The toolbar's mic dropdown (`MicDeviceButton` in `DeviceMenus.tsx`) and the in-call Settings dialog's Audio tab (`MeetingSettingsDialog.tsx`) both drive this. |
| **Mute microphone when joining** | `micEnabled` state, `MeetingRoomPage.tsx` — persisted to `localStorage['toowix_mic_enabled']` (per-browser, not per-account) | Passed as `startWithAudioMuted: !micEnabled` into `useJitsiMeeting` | **Real**, but note: this is a **different mechanism** from the Settings page's "Mute microphone when joining" toggle below — they are not the same setting and don't affect each other. |
| **Push-to-talk** | `pushToTalk` pref, `src/lib/meetingPrefs.ts` (`localStorage`-backed, see `getPref`/`useMeetingPref`) | `MeetingRoomPage.tsx`'s Space-bar keydown handler checks `getPref('pushToTalk')` | **Real.** |
| **Extra noise suppression (RNNoise)** | In-call toggle only — `jitsiMeeting.toggleNoiseSuppression()` / `jitsiMeeting.noiseSuppressionEnabled`, `src/lib/useJitsiMeeting.ts` (dynamically imports `NoiseSuppressionEffect`) | Applied directly to the live local audio track via `applyNoiseSuppressionToTrack` | **Real**, but it's a manual per-call toggle (toolbar "More options" menu) — there is no persisted default that turns it on automatically for every call. |
| **"Mute microphone when joining"** *(Settings → Meetings)* | `muteMicOnJoin`, `MeetingsSection.tsx` `DEFAULTS` → saved via `settingsApi.patch('/meetings', form)` → `toowix-backend` `User.meetingDefaults.muteMicOnJoin` | **Nowhere.** No reference anywhere in `MeetingRoomPage.tsx`, `DirectMeetingRoomPage.tsx`, or `useJitsiMeeting.ts`. | **Dead.** Toggling it has no effect on anything. |
| **"Automatically adjust microphone volume"** *(Settings → Meetings)* | `autoAdjustMicVolume`, same file/flow as above | **Nowhere.** No `autoGainControl` constraint, no volume-normalization logic anywhere in the audio capture path. | **Dead.** |
| **"Noise suppression"** *(Settings → Meetings, the default-on-join version)* | `noiseSuppression`, same file/flow as above | **Nowhere.** Only the separate in-call manual toggle (row above) actually does anything. | **Dead.** This is a second, independent "noise suppression" concept from the real one — confusing, since they share a name but one works and one doesn't. |

**Note on native browser audio processing:** this app's own code never explicitly sets `autoGainControl`, `echoCancellation`, or `noiseSuppression` as `getUserMedia` constraints anywhere (`useJitsiMeeting.ts`, `useMediaPreview.ts`) — audio capture relies entirely on the browser/Jitsi's own defaults for these. The "Automatically adjust microphone volume" and native-level "Noise suppression" toggles, even if wired up, would need to actually set these constraints to do anything; right now there's no code path for that at all, wired or not.

---

## 2. Automatic microphone switching (Bluetooth / AirPods)

This is a real, actively-maintained feature, separate from the settings above. Full trace:

```
devicechange event (OS/browser)
  → debouncedRefresh() [200ms trailing debounce, collapses a Bluetooth pairing burst]
    → refresh() [async]
      → navigator.mediaDevices.enumerateDevices()
      → diagnostic log (privacy-safe: counts + booleans only)
      → disconnect fallback (if the CURRENTLY selected device vanished, revert to system default)
      → if previousIds exists (not the very first run):
          → diff against knownDeviceIdsRef to find newly-appeared devices
          → match new input + new output by groupId → "paired" (one physical headset)
          → attemptAudioInputSwitch() / attemptAudioOutputSwitch()
              → applyJitsiDevice(kind, deviceId)
                → jitsiMeeting.switchDevice(kind, deviceId)
                  → createLocalTrackWithRetry() [getUserMedia, 3 attempts, 150/300ms backoff
                                                   on NotReadableError/TrackStartError only]
                  → room.replaceTrack(oldTrack, newTrack)
                  → returns { success, actualDeviceId } -- read back off the REAL native track
              → only commits setAudioId/setOutputId on CONFIRMED success
          → if output switched but no mic found yet: bounded re-check at +600ms/+1500ms
            (not open-ended), reusing the same confirm-before-commit path
```

### Where this lives
- `src/pages/MeetingRoomPage.tsx` — the `devicechange` effect (enumeration, pairing, the two `attempt*Switch` helpers, the bounded delayed re-check).
- `src/lib/useJitsiMeeting.ts` — `switchDevice` (the actual `getUserMedia` + `replaceTrack` work) and `createLocalTrackWithRetry` (transient-failure retry).
- `src/lib/jitsi/mediaHelpers.ts` — `isTransientDeviceBusyError` (defines which errors are worth retrying: `NotReadableError`, `TrackStartError`, and a generic "could not start audio/video source" message).

### Key guarantees, confirmed in code
- **Never overrides an explicit user choice.** Every auto-switch path is gated on `!audioId`/`!outputId` — the moment someone manually picks a device (or it was ever saved from a past session — see the caveat below), auto-switch stops entirely for that kind.
- **State only commits on confirmed success**, not optimistically. This was a real, found-and-fixed defect (2026-10-13): state used to commit before the switch was known to have worked, which could permanently block future auto-switch attempts after a single failure while falsely showing the new device as selected.
- **The real active device ID is verified**, not just trusted from the request — `MediaStreamTrack.getSettings().deviceId` is read back after a switch, since the browser isn't required to honor an exact `deviceId` constraint.
- **A failed switch never loses the working mic.** `switchDevice` only disposes the old track and reassigns `localAudioTrackRef` *after* the new track is fully acquired and `replaceTrack` succeeds — a failure anywhere in that chain leaves the previous, working track completely untouched.
- **Mute state and RNNoise survive a switch** — `switchDevice` re-mutes the new track if the old one was muted, and re-applies noise suppression to it.
- **Bounded, not open-ended, retries** at two layers: `getUserMedia` itself (3 attempts inside `createLocalTrackWithRetry`), and the delayed-discovery re-check (exactly 2 extra passes at fixed delays, stopping the instant a mic is selected by any means).

### Caveat confirmed in code, not a bug exactly
`audioId`/`outputId` persist in `localStorage` (`toowix_audio_device`, `toowix_output_device`) **across sessions**, not just within one call. If a specific microphone was ever manually selected in *any* previous session, auto-switch for input is disabled from the moment the page loads, regardless of any Bluetooth logic below it. A diagnostic (`audioIdAlreadyPinned`/`outputIdAlreadyPinned`, see §3) reports this directly so it's observable rather than guessed at. **If auto-switch "isn't working," checking whether this is set is the first thing to rule out** — the fix, if so, is picking "Default System Microphone" in Settings, not a code change.

### Known limitation, confirmed (not a bug)
`HTMLMediaElement.setSinkId` — what automatic *speaker* switching relies on — has never shipped in Safari. This is feature-detected at runtime (not a browser-name check), and the app shows a one-time, self-clearing message when an automatic speaker switch is attempted but unsupported, rather than failing silently.

### Hypothesis, not independently confirmed on real hardware
Whether a Bluetooth microphone is sometimes enumerated by the OS *later* than its paired speaker in the same event burst (a documented class of macOS Core Audio / HFP-vs-A2DP timing behavior) has not been verified against real AirPods hardware from this environment. The bounded delayed re-check (§2, last step) exists specifically to mitigate this if it's real, but its actual necessity/effectiveness is unconfirmed pending live testing.

---

## 3. Diagnostics available for live debugging

Gated behind `deviceSwitchDiagnosticsEnabled` (`import.meta.env.DEV || import.meta.env.VITE_JITSI_DIAGNOSTICS === 'true'`), all `console.info`/`console.warn` prefixed `[Toowix device-switch]`:

| Log | What it tells you |
|---|---|
| `devicechange burst settled` | How long a devicechange event burst took to settle before `refresh()` ran. |
| `devicechange settled` | Device kind counts, and whether `audioId`/`outputId` were **already pinned** before this burst even started (the localStorage caveat above). |
| `auto-switched microphone` / `auto-switch microphone FAILED` | Whether the switch succeeded, and whether the actual resulting device matched what was requested. |
| `auto-switch speaker FAILED or unsupported` | Distinguishes a real failure from `setSinkId` just not being supported. |
| `delayed mic re-check: still no new input device` | The bounded re-check ran and found nothing yet (at +600ms or +1500ms). |
| `getUserMedia acquired` / `getUserMedia FAILED after all retries` | From `createLocalTrackWithRetry` — total time, attempts used, backoff spent. |
| `replaceTrack` / `addTrack` | Queue-wait time vs. actual renegotiation time for the Jitsi track swap. |

All of these are deliberately **privacy-safe**: counts and booleans only, never raw device labels (which can contain a person's name, e.g. "Jayesh's AirPods Pro") or raw device IDs.

### `window.__toowixMicStatus()` (added 2026-10-13)

A dev-only, read-only console helper (same `deviceSwitchDiagnosticsEnabled` gate as the logs above) for live-diagnosing exactly the question this audit update was commissioned to answer: is `toowix_audio_device` a previously-saved explicit microphone ID currently blocking auto-switch? Run it in the console during a real call:

```js
window.__toowixMicStatus()
// {
//   uiSelectedMicId: ...,            // what the device menu/Settings dialog currently shows as selected
//   savedMicIdInLocalStorage: ...,   // the raw localStorage value -- the PRIME suspect from this audit
//   realActiveMicDeviceId: ...,      // MediaStreamTrack.getSettings().deviceId off the REAL, currently-publishing track
//   uiMatchesRealTrack: ...,         // true/false/'unknown' -- catches the case where the UI lies about what's active
//   autoSwitchCurrentlyBlockedByExplicitMicSelection: ...  // true means: yes, this is why AirPods won't auto-switch
// }
```

This doesn't change any switching behavior -- it's purely a way to get the exact evidence this audit couldn't gather without physical access to real AirPods hardware.

---

## 4. File reference

| File | Role |
|---|---|
| `toowix-web-app/src/pages/MeetingRoomPage.tsx` | Owns `audioId`/`outputId`/`videoId` state and persistence, the `devicechange` effect (enumeration, pairing, auto-switch, delayed re-check), `applyJitsiDevice`, and all mic-related UI state (`micEnabled`, join-muted). |
| `toowix-web-app/src/lib/useJitsiMeeting.ts` | `switchDevice` (the real `getUserMedia`/`replaceTrack` work, mute/RNNoise preservation), `createLocalTrackWithRetry` (transient-failure retry). |
| `toowix-web-app/src/lib/jitsi/mediaHelpers.ts` | `isTransientDeviceBusyError` — defines which `getUserMedia` errors are worth retrying. |
| `toowix-web-app/src/lib/meetingPrefs.ts` | `localStorage`-backed, per-browser preferences — `pushToTalk` lives here, actually wired. |
| `toowix-web-app/src/components/meeting/DeviceMenus.tsx` | Toolbar mic device dropdown (`MicDeviceButton`) — real, working device selection UI. |
| `toowix-web-app/src/components/MeetingSettingsDialog.tsx` | In-call Settings dialog's Audio tab — also real, working device selection (including a speaker test). |
| `toowix-web-app/src/components/settings/MeetingsSection.tsx` | Dashboard Settings → Meetings page — where `muteMicOnJoin`, `autoAdjustMicVolume`, and `noiseSuppression` are declared and rendered, but **never consumed anywhere**. |
| `toowix-backend/src/models/User.ts` | Backend schema storing `meetingDefaults` (including the three dead mic fields) — pure, inert data storage; nothing in the backend branches on these either. |
| `toowix-web-app/tests/auto-switch-new-device.test.cjs`, `bluetooth-paired-device-switch.test.cjs`, `bluetooth-delayed-mic-discovery.test.cjs`, `device-change-debounce.test.cjs`, `device-retry-backoff.test.cjs`, `microphone-track-recovery.test.cjs` | Regression test suite covering the auto-switch logic above — all passing as of this audit. |

---

## 5. Proposal: connecting Settings → Meetings to actual meeting behavior (not implemented here)

Per field, the dead mic preferences need different treatment — they are not all the same kind of problem:

### `muteMicOnJoin` — **remove, don't wire up**
This field is redundant, not just disconnected. A real, working mechanism already exists and does exactly this job: `micEnabled` / `localStorage['toowix_mic_enabled']`, toggled directly in the prejoin lobby. Wiring up a SECOND "mute on join" setting from a totally different source (an account-wide backend default vs. a per-browser local toggle) would create two settings that both claim to control the same thing, can disagree with each other, and would confuse anyone who finds both. The fix here is deletion, exactly like `mirrorMyVideo` — see `CAMERA_MIRRORING_AUDIT.md` §6 for the precedent (what to check before removing: confirm no other frontend file reads it, keep the backend schema field for backward compatibility with already-stored documents).

### `noiseSuppression` (Settings → Meetings default) — **wire up, it's additive and low-risk**
The real mechanism (`jitsiMeeting.toggleNoiseSuppression()`) already exists and already works; it's just never invoked automatically. Concretely: when `MeetingRoomPage.tsx` loads the saved `meetingDefaults` (which it would need to start fetching at all — see below) and `noiseSuppression` is `true`, call `jitsiMeeting.toggleNoiseSuppression()` once right after the local audio track is acquired, the same way `startWithAudioMuted` already consults `micEnabled` at join time. Low risk because it reuses an already-tested code path instead of adding a new one. **Rename the Settings label** to something like "Noise suppression by default" to avoid the current name collision with the manual in-call toggle, which otherwise reads as the same feature when it isn't.

### `autoAdjustMicVolume` — **don't wire up without more scoping; consider removing**
Unlike the two above, there's no existing "automatic gain control" mechanism anywhere in this codebase to connect it to — `getUserMedia` is never called anywhere with an `autoGainControl` constraint. Wiring this up for real means deciding what "automatically adjust" should actually mean (the native `autoGainControl` constraint? Custom AGC via Web Audio?) and building it from scratch, which is a real feature, not a connection fix. Until that's scoped and prioritized as its own piece of work, removing the toggle (rather than leaving a convincingly-real-looking checkbox that does nothing) is the more honest interim state.

### The bigger picture
All three of these sit inside one problem: **`MeetingRoomPage.tsx` never fetches `meetingDefaults` from the backend at all**, for ANY field — `cameraOffOnJoin`, `useHdVideo`, and `displayParticipantNames` are equally dead, not just the mic ones. A real fix needs one new piece of plumbing regardless of which individual fields get wired up: the meeting room fetching the signed-in user's `meetingDefaults` once before/at join (mirroring how `audioId`/`micEnabled`/etc. already read their own `localStorage` values at mount) and threading the result into the existing join-time logic (`startWithAudioMuted`, the HD-video constraint builder, etc.). That plumbing is the actual prerequisite for wiring up *any* of these fields — it doesn't exist today for mic settings or for anything else on that page.

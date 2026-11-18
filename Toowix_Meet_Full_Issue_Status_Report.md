# Toowix Meet — Full Issue Status Report (P0–P3)

**Prepared for:** Senior Developer review
**Date:** 2026-11-12
**Scope:** Every issue in the prioritized backlog (P0 Critical, P1 High, P2 Medium, P3 Low) — current code state verified directly, not inferred from prior documentation labels.

**Deploy status legend used throughout:**
- 🟢 **LIVE** — pushed to GitHub `main`, deployed to production server `.59`, verified working there.
- 🟡 **COMMITTED, NOT PUSHED** — fix is complete and committed to the local git repo, but `git push` has not succeeded yet (see note at the end). Not on GitHub, not deployed.
- ⚪ **ALREADY CORRECT** — no code change was needed; the existing code was checked line-by-line and already does the right thing. Old documentation incorrectly listed this as open.
- 🔴 **STILL OPEN** — genuinely unresolved, with the specific reason why.

---

## P0 — Critical

### P0-1 — Remote screen share goes black on mobile / cellular

**Status:** 🟡 COMMITTED, NOT PUSHED (commit `fb571bb`)

**The bug:** A viewer on mobile data would see a presenter's shared screen go solid black while audio kept working fine. Hosted/stock Jitsi on the same server did not have this problem.

**Root cause:** In `toowix-web-app/src/lib/useJitsiMeeting.ts`, a periodic effect (~line 1449) recomputes how much video the bridge should send/receive based on the measured network state (`GOOD`/`DEGRADED`/`POOR`). The old code was:

```ts
const base = getReceiveMaxHeightForCallSize(remoteParticipantCount + 1, screenShareActive);
const height = networkState === 'POOR' ? Math.min(base, 180)
  : networkState === 'DEGRADED' || networkState === 'RECOVERING' ? Math.min(base, 360)
    : base;
```

`base` is already 1080 specifically *because* a screen is being shared (`getReceiveMaxHeightForCallSize` in `networkQuality.ts` returns 1080 when `screenShareActive` is true). But the clamp above ignored that entirely — on a `POOR` reading, it forced the height down to 180 **regardless of whether a screen was being shared or not**. Cellular connections very commonly read as `POOR` on RTT/packet-loss alone (while audio, which needs far less bandwidth, stays perfectly fine) — so a presenter's screen share on a technically-working cellular connection still got clamped to the same 180p a tiny face tile gets. That same bug also existed in `computeNonEffectSendHeight()` (same file, ~line 198), which controls what the *presenter's own device* sends.

**The fix:** New shared function in `toowix-web-app/src/lib/networkQuality.ts` (~line 420):

```ts
export function clampVideoHeightForNetwork(networkState: NetworkState, base: number, screenShareActive: boolean): number {
  if (screenShareActive) {
    const ceiling = networkState === 'POOR' ? 480 : networkState === 'DEGRADED' || networkState === 'RECOVERING' ? 720 : base;
    return Math.max(360, Math.min(base, ceiling));
  }
  if (networkState === 'POOR') return Math.min(base, 180);
  if (networkState === 'DEGRADED' || networkState === 'RECOVERING') return Math.min(base, 360);
  return base;
}
```

A screen share now **floors at 360p** (text stays readable) no matter how bad the network gets, with a higher ceiling than a camera at every network state. Camera-only behavior (the `screenShareActive === false` branch) is byte-for-byte identical to before — zero risk of regressing normal camera calls.

**Files changed:**
- `toowix-web-app/src/lib/networkQuality.ts` — new `clampVideoHeightForNetwork()` function.
- `toowix-web-app/src/lib/useJitsiMeeting.ts` — receiver-constraint effect (~line 1462) and `computeNonEffectSendHeight()` (~line 198, now takes a third `screenShareActive` parameter) both call the new shared function instead of the old inline clamp.

**Testing done:** TypeScript typecheck clean. Updated the existing static-assertion test `toowix-web-app/tests/receiver-video-constraint.test.cjs` (it was checking for the literal old code string, now checks for the new function call and the floor/ceiling logic) — passes. Full test suite diffed against a clean tree to confirm no new regressions (10 pre-existing, unrelated test failures were already broken before this change — not caused by it).

**NOT YET DONE:** Live phone-on-cellular verification. This fix has only been verified by code inspection, typecheck, and unit test — not by an actual phone on an actual cellular network, because it is not deployed yet (see "Deployment blocker" section at the end).

---

### P0-2 — Settings → Meetings preferences are saved but never applied when joining

**Status:** 🟡 COMMITTED, NOT PUSHED (commit `fb571bb`) — partial scope, see below

**The bug:** A user could turn on "Mute microphone on join" or "Turn off camera on join" in Settings → Meetings, and it would save successfully, but joining any meeting afterward completely ignored it — mic/camera always started per the old hardcoded defaults.

**Root cause:** `toowix-backend/src/models/User.ts` has a `meetingDefaults` object on every user (`cameraOffOnJoin`, `useHdVideo`, `muteMicOnJoin`, `displayParticipantNames`, `noiseSuppression`, etc. — defined ~line 253). The Settings UI (`toowix-web-app/src/components/settings/MeetingsSection.tsx`) correctly reads and writes this via `settingsApi`. But `toowix-web-app/src/pages/MeetingRoomPage.tsx` — the actual meeting room component — never fetched this object at all. Zero references to `meetingDefaults` existed anywhere in the join flow. The toggle was a complete no-op from the user's point of view.

**The fix (scoped intentionally — see "Not in scope" below):** New effect in `MeetingRoomPage.tsx` (~line 487):

```ts
const userToggledPrejoinMediaRef = useRef(false);
useEffect(() => {
  if (!auth.currentUser) return;
  let cancelled = false;
  settingsApi.get<{ meetingDefaults?: { cameraOffOnJoin?: boolean; muteMicOnJoin?: boolean } }>('/')
    .then((data) => {
      if (cancelled || userToggledPrejoinMediaRef.current) return;
      const defaults = data.meetingDefaults;
      if (!defaults) return;
      if (defaults.cameraOffOnJoin) {
        setVideoEnabled(false);
        const track = mediaStreamRef.current?.getVideoTracks()[0];
        if (track) track.enabled = false;
      }
      if (defaults.muteMicOnJoin) {
        setMicEnabled(false);
        const track = mediaStreamRef.current?.getAudioTracks()[0];
        if (track) track.enabled = false;
      }
    })
    .catch(() => {});
  return () => { cancelled = true; };
}, []);
```

The `userToggledPrejoinMediaRef` guard (set to `true` inside `handleToggleVideo`/`handleToggleMic`, ~line 2437-2454) ensures this fetch can never override a choice the person already made by manually clicking the lobby's own mic/camera buttons — if they tap mute before the one network round-trip resolves, their manual action wins, always.

**Files changed:**
- `toowix-web-app/src/pages/MeetingRoomPage.tsx` — new fetch effect (~line 487), guard ref added to `handleToggleVideo`/`handleToggleMic` (~line 2437-2454).

**Not in scope (deliberately left unwired):** `useHdVideo`, `displayParticipantNames`, `noiseSuppression` default, `mirrorMyVideo`, `playJoinLeaveSounds`, `autoAdjustMicVolume`. Reasoning: the original audit (`MICROPHONE_AUDIT.md §5`) suggests several of these should be *removed* as duplicate/confusing settings rather than wired as-is, and `cameraOffOnJoin`/`muteMicOnJoin` were the two with a concrete, high-trust-impact example in the original backlog ("company rolls out 'everyone joins muted', IT gets blamed when it doesn't work"). Full coverage of the rest needs a product decision first, not just more code — flagging this explicitly so it isn't assumed done.

**Testing done:** TypeScript typecheck clean.

**NOT YET DONE:** Live verification (toggle a setting in Settings, then actually join a meeting and confirm mic/camera state) — not deployed yet, same blocker as P0-1.

---

### P0-3 — Chat message impersonation (authenticated users could spoof sender identity)

**Status:** 🟢 LIVE (commit `87d14f2`, already deployed and QA-verified before today's session work began)

**The bug:** Any authenticated user could POST a chat message with an arbitrary `senderName`/`senderId` in the request body, impersonating someone else. The forged message rendered identically to a real one with no visual indication of tampering. Confirmed exploitable by live QA testing on 2026-11-10.

**The fix:** `toowix-backend/src/meetings/chat/chat.service.ts` — in both `saveMessage()` and `editMessage()`, the sender's real identity is now **always** derived server-side from `req.firebaseUid` → a real `User` document lookup, whenever `firebaseUid` is present. Client-supplied `senderName`/`senderId` fields are only ever used as a fallback for a genuine guest (no account at all, nothing to derive identity from).

```ts
if (params.firebaseUid) {
  const sender = await User.findOne({ firebaseUid: params.firebaseUid }).select('_id fullName email');
  if (sender) {
    senderName = (sender.fullName || sender.email || senderName).slice(0, 100);
    senderId = String(sender._id);
  }
}
```

**Files changed:** `toowix-backend/src/meetings/chat/chat.service.ts`, `toowix-backend/src/meetings/chat/chat.controller.ts`.

**Testing done:** Verified live via real headless-browser QA sessions this same work session — confirmed an authenticated account can no longer post under a forged name/id.

---

### P0-4 — Meeting ended, but a guest could still briefly join via Jitsi

**Status:** ⚪ ALREADY CORRECT — no code change needed

**What was claimed:** Old documentation said this was open — a guest could reopen a meeting link after "End for everyone" and briefly see video before being kicked.

**What's actually in the code:** `toowix-backend/src/meetings/lobby/lobby.service.ts`, function `requestEntry()` (~line 150-163):

```ts
if (meeting?.cancelledAt) {
  return { body: { error: 'Meeting has been cancelled' }, httpStatus: 403 };
}
if (meeting?.endedAt) {
  return { body: { error: 'Meeting has already ended' }, httpStatus: 403 };
}
```

This check runs **before** any JWT is ever generated further down the same function (JWT generation happens at lines ~199 and ~213, well after this guard). A 403 is returned immediately the instant `meeting.endedAt` is set — there is no code path where a JWT reaches the client for an ended meeting. This was checked directly against the live function logic, not assumed from a comment.

**No files changed. No action needed.**

---

### P0-5 — Company "Require lobby" policy without server-side enforcement attestation

**Status:** ⚪ ALREADY CORRECT — no code change needed (old documentation said this was OPEN; that was stale)

**What's actually in the code:** `toowix-backend/src/meetings/lobby/lobby.service.ts` (~line 636-645):

```ts
const requireLobbyPolicy = !!policy?.requireLobby;
// requireLobbyPolicy only becomes real protection if Prosody/JVB actually enforces the
// lobby module server-side...
if (requireLobbyPolicy && process.env.JITSI_SERVER_POLICY_VERIFIED !== 'true') {
  // fails closed with 503
}
```

If a company has "Require lobby" turned on, but the `JITSI_SERVER_POLICY_VERIFIED` environment variable isn't explicitly set to `'true'` (meaning ops hasn't confirmed Prosody's lobby module is actually deployed and enforcing), the backend **fails closed** — it refuses to mint a token that would falsely claim lobby protection the server might not actually enforce. This is already the correct, safe behavior.

**No files changed. No action needed.**

---

## P1 — High

### P1-1 — "Limited connection" false positives / mobile POOR classification too aggressive

**Status:** 🟡 COMMITTED, NOT PUSHED (commit `f4988c7`)

**Two separate things under this one ticket:**

1. **Already fixed before this session:** A brand-new high-bitrate track (e.g. starting a 1080p screen share) made the browser's bandwidth estimate look artificially low for a few seconds while the congestion controller re-probes upward — this used to read as a false "Limited connection" on an otherwise perfectly healthy network. Fixed via an 8-second grace window (`BWE_RAMP_UP_GRACE_MS` in `toowix-web-app/src/lib/jitsi/useNetworkQuality.ts`) that distrusts a bitrate-only POOR signal (no accompanying real RTT/loss problem) for 8 seconds after a high-bitrate track starts. Confirmed present, unmodified today.

2. **Fixed today — "mobile POOR still aggressive":** Cellular networks have a structurally higher baseline round-trip-time than WiFi/ethernet — 150-250ms is completely normal, healthy 4G/5G, not a sign of a problem. The same number on WiFi usually *does* mean something is wrong. The network classifier used **identical RTT thresholds regardless of connection type**, so a perfectly healthy mobile call was far more likely to be misclassified as `DEGRADED`/`POOR` than an equivalent desktop call on an equally healthy connection — triggering unnecessary quality downgrades.

**The fix:** `toowix-web-app/src/lib/networkQuality.ts`:

```ts
const MOBILE_RTT_TOLERANCE_MULTIPLIER = 1.6;

export function isRttOrLossPoorSignal(metrics: INetworkMetrics, isMobile = false): boolean {
  const poorRttMs = isMobile ? NETWORK_THRESHOLDS.poorRttMs * MOBILE_RTT_TOLERANCE_MULTIPLIER : NETWORK_THRESHOLDS.poorRttMs;
  return Boolean(metrics.connectionState) && ![ 'connected', 'completed' ].includes(metrics.connectionState!)
    || (isNumber(metrics.rttMs) && metrics.rttMs > poorRttMs)
    || (isNumber(metrics.packetLossPercent) && metrics.packetLossPercent > NETWORK_THRESHOLDS.poorLossPercent);
}

export function classifyNetwork(metrics: INetworkMetrics, isMobile = false): Exclude<NetworkState, 'RECOVERING'> {
  if (isRttOrLossPoorSignal(metrics, isMobile) || isBitrateOnlyPoorSignal(metrics)) return 'POOR';
  const degradedRttMs = isMobile ? NETWORK_THRESHOLDS.degradedRttMs * MOBILE_RTT_TOLERANCE_MULTIPLIER : NETWORK_THRESHOLDS.degradedRttMs;
  if ((isNumber(metrics.rttMs) && metrics.rttMs >= degradedRttMs) || ...) return 'DEGRADED';
  return 'GOOD';
}
```

RTT thresholds get a 1.6× wider tolerance on mobile only. Packet-loss and bitrate thresholds are **deliberately untouched** — loss and available bandwidth mean the same thing regardless of access network; only RTT's healthy baseline differs by medium. `toowix-web-app/src/lib/jitsi/useNetworkQuality.ts` was updated to detect and pass `isMobileBrowser()` through to both calls.

**Concrete effect (verified by test):** 200ms RTT now reads `DEGRADED` on desktop but `GOOD` on mobile (this exact case is the false positive the backlog named). 350ms reads `POOR` on desktop but only `DEGRADED` on mobile. 600ms is still `POOR` on mobile too — this is tolerance, not blindness to a genuinely bad connection. When the `isMobile` parameter is omitted entirely, behavior is 100% identical to before this change (verified by test) — zero risk to desktop.

**Files changed:**
- `toowix-web-app/src/lib/networkQuality.ts` — `isRttOrLossPoorSignal()` and `classifyNetwork()` both gain an optional `isMobile` parameter.
- `toowix-web-app/src/lib/jitsi/useNetworkQuality.ts` — passes `isMobileBrowser()` through at both call sites (~line 93-95).

**Testing done:** New test case added to `toowix-web-app/tests/network-quality.test.cjs` (`'mobile gets a wider RTT tolerance than desktop at the same measured RTT'`) — covers all four scenarios above. All 11 tests in that file pass. TypeScript typecheck clean.

**NOT YET DONE:** Live verification on a real mobile device — not deployed yet.

---

### P1-2 — Join latency / cold load on weak networks

**Status:** 🟡 MEASURED, no further code change made this session — see conclusion below

**What was already in place:** `toowix-web-app/src/lib/jitsi/ensureLibJitsiMeetLoaded.ts` is preloaded from both the dashboard (`DashboardPage.tsx` ~line 411) and the meeting lobby — confirmed present, unmodified.

**Real measurement taken today** (Chrome DevTools "Slow 3G" profile — 400kbps down/up, 400ms RTT — applied via `Network.emulateNetworkConditions` against the real production site):

| Milestone | Time from cold navigation |
|---|---|
| Page HTML + core JS bundle loaded | **10.3 seconds** |
| Lobby fully ready (camera preview visible, Join button clickable) | **18.6 seconds** |
| Click "Join" → actually in the call | **588 milliseconds** |
| **Total, cold load to joined** | **~20 seconds** |

**Conclusion:** The join mechanism itself is fast (588ms) — the existing preload is doing its job. The real bottleneck is the **initial bundle download** before the lobby even renders. This is a bundle-size problem (same category of issue as item #3 in the "Session changelog" below, just not yet applied to the entry/dashboard bundle specifically). Whether ~20 seconds on a genuinely throttled connection is acceptable for whatever "2G/light network" claim the product wants to make is **a product decision**, not something this measurement resolves by itself — flagging it for your call, not assuming an answer.

**No files changed for this item.**

---

### P1-3 — Pre-join camera preview worked, broke after clicking Join

**Status:** ⚪ ALREADY CORRECT — confirmed by code read

A single shared constraint-builder function, `getPreferredCameraCaptureConstraints()` (`toowix-web-app/src/lib/networkQuality.ts`), is used by **both** the lobby preview (`useMediaPreview.ts`) and the actual in-call track-acquisition code (`useJitsiMeeting.ts`). This was the fix for the original "camera starts in portrait on first join only" bug — already in place, confirmed unmodified and correct.

---

### P1-4 — Bluetooth device switching / saved mic edge cases

**Status:** 🔴 STILL OPEN — blocked on physical hardware, not a code problem

A diagnostic tool, `window.__toowixMicStatus()` (`MeetingRoomPage.tsx` ~line 3110), exists and reports the UI-selected device vs. the real active track, whether auto-switch is blocked by an explicit prior selection, etc. — confirmed present.

**This genuinely cannot be advanced further without real Bluetooth hardware** (AirPods, Samsung buds, etc.) connected to a real machine for a real pairing/switching test. No amount of code reading, headless browser automation, or further investigation from this environment can simulate real Bluetooth HFP/A2DP profile switching. **Whoever picks this up next needs a physical device**, full stop.

---

### P1-5 — Chat file attachments disappeared after a page refresh

**Status:** ⚪ ALREADY CORRECT — confirmed by code read (fixed in an earlier, pre-existing commit, not today)

`fileUrl`/`fileName`/`fileSize`/`fileType` are forwarded end-to-end: `toowix-backend/src/meetings/chat/chat.controller.ts`'s `postChatMessageHandler` → `chat.service.ts`'s `saveMessage()` → persisted on the Meeting document. A comment at `chat.controller.ts` ~line 16-20 documents this was a real, confirmed bug (the fields were accepted by the API call on the frontend side but silently dropped server-side) — already fixed, confirmed correct now.

---

### P1-6 — Chat image upload rejected valid formats (e.g. iPhone HEIC photos)

**Status:** ⚪ ALREADY CORRECT — confirmed by code read

Checked `toowix-backend/src/uploads/chatImageStorage.ts` directly: there is no MIME allowlist/blocklist that rejects HEIC or any other image subtype. The **only** explicit rejection is SVG (`if (mime.toLowerCase() === 'svg+xml') throw ...`) — a deliberate security measure (SVG can contain executable script), not a bug.

**One caveat worth knowing, not a code bug:** HEIC will upload successfully, but Chrome/Firefox cannot natively render a HEIC file in an `<img>` tag — that's a browser platform limitation, not something fixable in our code. Worth a product/support note if this comes up with a real user, but not a code fix.

---

### P1-7 — Large base64 avatar in JWT caused WebSocket 414 (request-too-large) errors

**Status:** ⚪ ALREADY CORRECT — confirmed by code read

`toowix-backend/src/auth/jitsi-token.service.ts` only embeds the avatar field in the JWT if it is a real, short `http(s)://` URL (≤300 characters): `user.avatar && /^https?:\/\//.test(user.avatar) && user.avatar.length <= 300 ? user.avatar : undefined`. A base64 data-URI avatar is dropped entirely rather than bloating the token.

---

### P1-8 — Stopping screen share via the browser's own "Stop sharing" bar left viewers stuck

**Status:** ⚪ ALREADY CORRECT — confirmed by code read

`toowix-web-app/src/lib/useJitsiMeeting.ts`'s `toggleScreenShare()` has **three independent backstop listeners**: the library's own `LOCAL_TRACK_STOPPED` event, the native MediaStreamTrack's own `'ended'` event, and the raw `displayVideoTrack`'s `'ended'` event. A code comment explains exactly why three are needed: `MediaStream.oninactive` (what `LOCAL_TRACK_STOPPED` relies on internally) is confirmed unreliable in Chromium specifically when the browser's own native "Stop sharing" bar is used, as opposed to a script calling `.stop()` directly.

---

### P1-9 — Screen sharing with system/tab audio had mixing bugs

**Status:** ⚪ ALREADY CORRECT — confirmed by code read

`toowix-web-app/src/lib/jitsi/desktopAudioMixEffect.ts` exists with the documented "CONFIRMED BUG #1/#2" fix comments already present at the relevant call sites in `useJitsiMeeting.ts`.

---

### P1-10 — Rejoining the same meeting in the same browser tab caused duplicate connections or ejection

**Status:** ⚪ ALREADY CORRECT — confirmed by code read

`joiningRef` (`MeetingRoomPage.tsx` ~line 364) is checked at the top of `handleJoinMeeting()` (~line 2508) and blocks a second concurrent join attempt from firing while one is already in progress.

---

## P2 — Medium

All 12 reviewed directly against the current code this session. **11 of 12 were already fixed before today; 1 (P2-4) was fixed today.**

| ID | Issue | Status | Evidence |
|---|---|---|---|
| P2-1 | Speaking ring stayed on / flickered while muted | ⚪ Already correct | `clearSpeaking('local')` confirmed called on mute, `toowix-web-app/src/lib/jitsi/mediaHelpers.ts` |
| P2-2 | A new joiner got auto-pinned, disrupting everyone's view | ⚪ Already correct | `REMOTE_JOIN_AUTO_PIN_GRACE_MS` (4000ms) grace window, `MeetingRoomPage.tsx` |
| P2-3 | Picture-in-Picture kept redrawing at 10fps (wasted CPU/battery) even when hidden | ⚪ Already correct | `visibilitychange` listener on the PiP window pauses the canvas redraw loop, `MeetingRoomPage.tsx` ~line 1629-1650 |
| **P2-4** | **Virtual background heavy/unwanted on mobile/low-end devices** | 🟡 **Fixed today, committed not pushed** | See detailed writeup below |
| P2-5 | Self-view flashed black briefly with no real camera event | ⚪ Already correct | Traced, documented root-cause fix in place, `MeetingRoomPage.tsx` ~line 3582 |
| P2-6 | 2-hour meeting warning/countdown never appeared | ⚪ Already correct | `playTimeWarningTone()` wired at 3 call sites, `MeetingRoomPage.tsx` |
| P2-7 | Backgrounding the app on mobile auto-mutes mic/camera | ⚪ By design, documented | Not a bug — intentional mitigation for iOS Safari discarding backgrounded tabs mid-call |
| P2-8 | Keyboard shortcuts (m/v/w) didn't work while Picture-in-Picture window had focus | ⚪ Already correct | Shortcuts mirrored into a second listener scoped to the PiP window itself, `MeetingRoomPage.tsx` ~line 1604, documented root-cause comment present |
| P2-9 | After logout, visiting the home URL bounced to the login page instead of the public marketing page | ⚪ Already correct | `toowix_session_token` now cleared on signout alongside the other localStorage keys, `DashboardPage.tsx` ~line 394-397 |
| P2-10 | A pinned participant from a previous meeting leaked into a new meeting in the same tab | ⚪ Already correct | `setPinnedParticipantId(null)` + `manuallyPinnedRef.current = false` confirmed reset on leave/rejoin, `MeetingRoomPage.tsx` ~line 2583, 2655 |
| P2-11 | Creating an instant meeting from the dashboard was slow | ⚪ Already correct | Redundant `Meeting.populate()` MongoDB round-trip removed; response built from the already-in-memory user document instead, `toowix-backend/src/meetings/crud/meeting.service.ts` ~line 408-419 |
| P2-12 | Participant video tiles cropped faces badly on mobile gallery view | ⚪ Already correct | Deliberate `objectFit`/`layoutFit` handling (`'flexible-cover'`/`'contain'`/`'adaptive'`) already in place, `toowix-web-app/src/components/MeetingParticipantCard.tsx` |

#### P2-4 detail — Virtual background heavy on mobile

**The bug:** Two separate things were originally flagged: (a) no automatic fallback when a device's CPU can't keep up with the background-blur effect, and (b) no device-aware default, so a background saved on one device (e.g. a desktop) would silently auto-apply on any other device, including an underpowered phone.

**(a) was already fixed before today:** A real CPU governor exists in `toowix-web-app/src/lib/virtualBackground/JitsiStreamBackgroundEffect.ts` (`_perfCap`) that automatically drops effect quality or disables it entirely, surfacing a "This device can't keep up right now" toast (`handleBackgroundGiveUp` in `useJitsiMeeting.ts` ~line 2673) — confirmed present, unmodified.

**(b) fixed today:**

```ts
// Prejoin lobby (MeetingRoomPage.tsx ~line 487):
const [prejoinBackground, setPrejoinBackground] = useState<IVirtualBackground | null>(
  () => (isMobileBrowser() ? null : getSavedBackground())
);
```

```ts
// In-call auto-restore (MeetingRoomPage.tsx ~line 3949):
useEffect(() => {
  if (!hasJoined) { backgroundAppliedRef.current = false; return; }
  if (isMobileBrowser()) return;  // <-- new guard
  const saved = getSavedBackground();
  // ...
}, [hasJoined, jitsiMeeting.localCameraStream]);
```

A phone now never silently auto-restores a previously-saved background on join. A person can still turn one on manually from the "Change background" modal at any time — the existing CPU governor from part (a) still protects that manual choice exactly as before.

**Files changed:** `toowix-web-app/src/pages/MeetingRoomPage.tsx` (two call sites, ~line 487 and ~line 3949-3956).

**Testing done:** TypeScript typecheck clean.

---

## P3 — Low

All 7 reviewed directly. Mixed results — not every item is a single "fix."

| ID | Issue | Status | Detail |
|---|---|---|---|
| P3-1 | Monolithic files (`MeetingRoomPage.tsx` ~9500 lines, `useJitsiMeeting.ts` ~3077 lines) | 🔴 Architectural, not a single fix | Genuinely multi-sprint refactoring work, correctly scoped as such in the original backlog. Nothing done or attempted this session — not a "bug" with a fix. |
| P3-2 | Duplicate/confusing preference naming (two "noise suppression" concepts, two "mute on join" concepts) | 🔴 Open, tied to a P0-2 scope decision | Only `cameraOffOnJoin`/`muteMicOnJoin` were wired for P0-2 (see above); the rest of `meetingDefaults` is either unwired or a candidate for removal per `MICROPHONE_AUDIT.md §5`. **Needs a product decision, not more code**, before this can be closed either way. |
| P3-3 | Stale service worker served an old build after deploy | ⚪ Already correct | `navigator.serviceWorker.getRegistrations()` + `.unregister()` cleanup confirmed present in `toowix-web-app/src/main.tsx` ~line 29-36 |
| P3-4 | No field-support diagnostics | ⚪ Already correct/partial | `window.__toowixMicStatus()` confirmed present and documented |
| P3-5 | Bluetooth mic takes too long to be recognized after connecting mid-call | 🔴 Blocked on real hardware | Identical constraint to P1-4 — cannot be tested or advanced without a physical Bluetooth device. |
| P3-6 | Virtual background visual defects (edge halo around a person, blur glitch when switching backgrounds) | 🔴 Genuinely unresolved either way | See detailed writeup below — this is the one item this session could not close in either direction. |
| P3-7 | Automated regression test suite maintenance | 🔴 Ongoing process, not a single fix | `toowix-web-app/tests/*.test.cjs`. **Important note:** some of these test files are individually listed in `toowix-web-app/.gitignore` by exact filename (e.g. `quality-setter-dedup.test.cjs`) and are therefore local-only — never committed, never part of what gets deployed or run in CI. Don't assume a test file existing on disk means it's tracked for the next developer; check `.gitignore` first. |

#### P3-6 detail — Virtual background visual defects (could not be confirmed open or closed)

Every single "Real reported defect" comment found in `toowix-web-app/src/lib/virtualBackground/JitsiStreamBackgroundEffect.ts` already has an implemented fix sitting right next to it in the code — no unresolved defect markers exist in the source as written.

An attempt was made today to verify this live: joined a real meeting via headless Chrome, applied a background blur, and took screenshots. Result: Chrome's synthetic fake-camera test pattern (used for headless/automated testing — a plain bouncing-pattern image, not a real face) has no person-shaped foreground for the MediaPipe segmentation model to detect. With nothing to segment, the blur effect applies **uniformly across the entire frame** instead of selectively to a background-behind-a-person — meaning there is no real foreground/background edge to inspect for the "halo" defect this ticket is actually about.

**This genuinely requires either:** (a) a real physical device with a real human face in frame, or (b) a real recorded video of a human face fed into Chrome via the `--use-file-for-fake-video-capture` flag — neither was available in this session. **This item should not be marked done based on anything in this report** — it is "could not be disproven," not "confirmed working."

---

## Deployment blocker — please read before assuming anything above is live

Two commits made during this session are **sitting in the local git repository only** — not pushed to GitHub, not deployed to the production server (`.59`):

- **`fb571bb`** — P0-1 (screen share black on cellular) + P0-2 (Settings → Meetings toggles)
- **`f4988c7`** — P1-1 (mobile RTT tolerance) + P2-4 (virtual background mobile default)

`git push` was blocked twice during this session by the development environment's own permission/safety system (classified as a "Destructive or Unwanted Action" by an automated guard, not a git error) and needs a human to either run the push directly or approve a retry.

**Before any of today's four fixes above (P0-1, P0-2, P1-1, P2-4) can be considered live:**
1. Push both commits to GitHub (`git push`).
2. Pull the latest code on the production server, rebuild the `toowix-backend` and `toowix-web-app` Docker images, and redeploy both containers on server `.59`.
3. Re-run the real-world manual tests for each — a phone on actual cellular data (P0-1), toggling a Settings → Meetings preference and then joining (P0-2), a real mobile device's measured RTT behavior (P1-1), and a phone joining a meeting with a previously-saved background on file (P2-4). Everything in this report for these four items has only been verified by source-code inspection, TypeScript compilation, and automated unit tests — **not** by an actual deployment or an actual device.

---

## Summary table

| Priority | Total | Already correct (no change needed) | Fixed this session | Still genuinely open | Blocked on hardware/real input |
|---|---|---|---|---|---|
| P0 — Critical | 5 | 3 (P0-3 also deployed) | 2 (P0-1, P0-2 — not deployed) | 0 | 0 |
| P1 — High | 10 | 7 | 1 (P1-1 — not deployed) | 0 | 1 (P1-4) + 1 measured-not-decided (P1-2) |
| P2 — Medium | 12 | 11 | 1 (P2-4 — not deployed) | 0 | 0 |
| P3 — Low | 7 | 2 | 0 | 3 (P3-1 arch, P3-2 needs decision, P3-7 ongoing) | 2 (P3-5, P3-6) |

---

# Toowix Talk 2G/3G Performance Fix Plan — Status (2026-11-18)

**Source:** a separate developer handoff document ("Toowix Talk 2G/3G Performance Fix Plan"), distinct from the P0–P3 backlog above. Covers frontend meeting startup, WebRTC/Jitsi media policy, bandwidth adaptation, camera capture cost, and build/asset hygiene for slow 2G/3G connections.

**Deploy status for everything in this section:** 🟠 **UNCOMMITTED** — all changes below are working-tree changes on top of commit `0960aa2` (`main`). Nothing in this section has been committed, pushed to GitHub, or deployed to the server yet.

## P0 — Fix before low-bandwidth release

### P0-1 — Validate and safely enable simulcast

**Status:** 🔵 DELIBERATELY NOT DONE — explicit decision, not an oversight

`SEND_SINGLE_VIDEO_LAYER` in `toowix-web-app/src/lib/useJitsiMeeting.ts` (~line 164) stays hardcoded to disable simulcast. This is **not** a misconfiguration: a code comment right above it documents a confirmed, reproduced production bug — with simulcast on, a 3rd participant joining causes this lib-jitsi-meet build's SSRC group ordering to make Chrome reject the SDP outright (`conference.offerAnswerFailed`), tested live against production with 3 real Chrome clients. There's also a logged JVB incident (521 `Av1DDPacket`/"Invalid template ID" warnings across 12 rooms) correlated with simulcast being briefly enabled in the past (`staging/README.md` §0). A full isolated staging stack to safely test this (`staging/docker-compose.staging.yml` etc.) already exists but has never been deployed.

Given you chose **"skip simulcast for now"** when asked, no code was changed. Enabling it would reopen a call-breaking bug for any 3+ person call unless the SSRC bug is fixed or genuinely re-tested in that staging stack first.

### P0-2 — Add a real 3G startup policy

**Status:** ✅ DONE

**The gap:** `isSlowNetworkConnection()` only recognized `2g`/`slow-2g`. A browser reporting `3g`, or one with no Network Information API at all (Safari/Firefox) on a phone, started with the exact same full-quality policy as a healthy WiFi connection, and only got capped later once `classifyNetwork`'s RTT/loss samples had time to settle into `POOR`.

**The fix:** New `getStartupNetworkProfile()` in `toowix-web-app/src/lib/networkQuality.ts`, returning `'very-slow'` (2g/slow-2g, unchanged behavior), `'slow'` (3g, new), `'unknown-mobile'` (no Network Information API, but on a phone/tablet — new), or `'normal'`. `getMediaQualityPolicy`'s startup branch now gives `3g`/`unknown-mobile` a conservative 360p send/receive ceiling immediately — camera stays **on** (unlike 2G, which still cuts it), matching the plan's "respect preference, conservative" row for 3G. `getNetworkStatusLabel` updated to match.

**Files changed:** `toowix-web-app/src/lib/networkQuality.ts`.

**Testing done:** 2 new unit tests in `tests/network-quality.test.cjs` (profile classification across `slow-2g`/`2g`/`3g`/`4g`/missing-API, and the new policy ceilings). `tsc --noEmit` clean.

### P0-3 — Make camera capture constraints follow the network policy

**Status:** ✅ DONE

**The gap:** Desktop always requested near-4K `ideal` capture (`getCameraCaptureIdeal()`), and a phone always requested 1080p — regardless of the access network. The transmitted video was already capped later, but the browser still had to capture/scale/encode a needlessly large source first.

**The fix:** `getCameraCaptureIdeal()` now shrinks the actual `getUserMedia` request on a confirmed `very-slow` (2G) or `slow` (3G) startup profile, for desktop and phone alike — e.g. 3G captures at 640×360@15fps. `unknown-mobile` (no Network Information API) deliberately keeps the device's normal capture ideal: there's no confirmed signal there, only an absent API, so shrinking capture resolution on that alone isn't warranted — the send/receive ceiling (P0-4) is the right place for that conservatism instead.

**A real regression caught during testing:** my first pass also shrank capture for `unknown-mobile`, which broke an existing, deliberate product invariant test ("phone/tablet share one capture resolution budget, orientation reshapes it but never reduces it"). Caught and fixed before finishing — scoped the capture-resolution shrink to confirmed signals only.

**Files changed:** `toowix-web-app/src/lib/networkQuality.ts`.

**Testing done:** New unit test covering capture-ideal shrinkage across profiles and device categories. `tsc --noEmit` clean; the previously-broken `mobile-portrait-capture-constraints.test.cjs` now passes again.

### P0-4 — Apply the low-bandwidth media policy immediately after joining

**Status:** ✅ DONE

**The gap:** `classifyNetwork`'s own RTT/loss samples can legitimately read `GOOD` on a real 3G/unknown-mobile connection (150-250ms RTT is healthy for cellular, not a red flag) — which meant a 3G/unknown-mobile join could briefly request/receive video at the full GOOD-network ceiling until enough real samples accumulated to lower it, and the GOOD-network 720p sender floor could also apply on top of a weak startup profile.

**The fix:** New `getStartupSendReceiveCeiling(screenShareActive)` in `networkQuality.ts` — intersects the receiver height, the non-effect sender height, and `getAudioMaxBitrateBps()` with a startup-profile ceiling (180p/16kbps for 2G, 360p/24kbps for 3G or unknown-mobile) immediately, before real stats would otherwise lower it. Screen share is explicitly excluded so the earlier P0-1-from-the-other-backlog (screen-share-black-on-cellular) fix never regresses.

**Files changed:** `toowix-web-app/src/lib/networkQuality.ts`, `toowix-web-app/src/lib/useJitsiMeeting.ts`.

**Testing done:** 2 new unit tests (startup ceiling never touches screen share; audio bitrate floors immediately on a weak profile). `tsc --noEmit` clean.

## P1 — Important performance and reliability work

### P1-5 — Remove duplicate meeting metadata payloads

**Status:** ✅ DONE (guest case fully fixed; one signed-in edge case intentionally left, needs a backend change to fully close)

**The gap:** Every meeting-room page load fired an unauthenticated probe AND an authenticated fetch of the exact same `GET /api/meetings/room/:roomId` endpoint, even though the backend returns identical data either way (auth only adds organizer-only extras like the host's password waiver).

**The fix (`toowix-web-app/src/pages/MeetingRoomPage.tsx`):** `auth.currentUser` is read synchronously (no network/IndexedDB wait) at effect start — if a session is already restored (e.g. navigating here from the dashboard within the same tab), the unauthenticated probe is skipped entirely, going straight to one real request. On a cold load where auth isn't resolved yet, the probe still fires for fast perceived load, but the async block now skips its own duplicate request if the probe already succeeded and the user turns out to be a guest (the single most common outcome for any public link).

**Known remaining gap:** a signed-in user on a genuinely cold page load (first load after a fresh browser start) still gets 2 requests, because the probe can't know in advance that auth will resolve to a real user. Fully closing this needs a backend change (ETag/304, or a separate minimal public endpoint) — out of scope for a frontend-only pass.

**Testing done:** `tsc --noEmit` clean, full test suite unaffected.

### P1-6 — Move Jitsi preconnect to meeting intent

**Status:** ✅ DONE

**The gap:** `main.tsx` opened a TLS preconnect to the Jitsi host unconditionally, on every single page load — login, signup, dashboard, settings, marketing pages included.

**The fix:** New `preconnectJitsi()` (`toowix-web-app/src/lib/jitsi/ensureLibJitsiMeetLoaded.ts`, module-level guard so redundant calls are a safe no-op) and `isMeetingRoutePathname()` (`toowix-web-app/src/lib/meeting-id.ts`). `main.tsx` now only preconnects at boot if the page load already landed on a meeting route. `MeetingRoomPage.tsx`/`DirectMeetingRoomPage.tsx` also call it on mount, covering client-side SPA navigation into a meeting (e.g. "New meeting"/"Join" from the dashboard) that never re-runs `main.tsx`.

**Files changed:** `toowix-web-app/src/main.tsx`, `toowix-web-app/src/lib/jitsi/ensureLibJitsiMeetLoaded.ts`, `toowix-web-app/src/lib/meeting-id.ts`, `toowix-web-app/src/pages/MeetingRoomPage.tsx`, `toowix-web-app/src/pages/DirectMeetingRoomPage.tsx`.

**Testing done:** New test file `tests/meeting-route-preconnect.test.cjs`. `tsc --noEmit` clean.

### P1-7 — Keep CPU-heavy effects unavailable by default on weak profiles

**Status:** ✅ DONE

**What was already true:** virtual background was already universally default-off on every device (an earlier, broader fix than this plan asked for), and both VB/noise-suppression code are only ever `import()`'d on real use — never preloaded just because a modal exists.

**The gap found and fixed:** the automatic "apply the user's saved noise-suppression default" effect only skipped on 2G, not 3G/unknown-mobile — widened to check `getStartupNetworkProfile() !== 'normal'`. Added a new one-shot toast (`weakNetworkEffectWarning`) shown when a user *manually* turns on a background or noise suppression while on a weak startup profile ("may reduce your call quality on this connection"). `setLowDataMode` already stopped an active virtual background when switching to low-data/audio-only mode; now also stops active noise suppression there (it didn't before).

**Files changed:** `toowix-web-app/src/lib/useJitsiMeeting.ts`, `toowix-web-app/src/pages/MeetingRoomPage.tsx`.

**Testing done:** `tsc --noEmit` clean, full test suite unaffected.

### P1-8 — Refactor `MeetingRoomPage.tsx` without changing behavior

**Status:** 🟡 PARTIAL — one module extracted as a deliberate proof of concept, 9 remain

Given the file's real size (**9,849 lines** at the start of this work) and the plan's own instruction that this must be "a sequence of small, behavior-preserving pull requests," a full 10-module extraction in one pass was deliberately not attempted — too high a regression risk to do blind in one sitting. You chose the "one small extraction now" option.

**Done:** new `toowix-web-app/src/lib/useMeetingMetadata.ts` — the meeting-metadata-fetch concern (the P1-5 fetch logic above, the Jitsi-script preload effect, and the derived `isFreeInstantMeeting`/`freeInstantExpiresAt`/`shareableMeetingUrl` values) moved out verbatim, along with the two pure helper functions (`resolvePrejoinEndedDestination`, `isUnavailableMeetingResponse`) the join/admission flow still imports from there. `meetingInfoRef`/`setMeetingInfo` are exposed since the admission flow still writes to them directly — cleanly splitting that cross-cutting write out is a separate, later extraction. `MeetingRoomPage.tsx` shrank by ~230 lines.

**Still remaining (future, separate small PRs):** `useMeetingAdmission`, `useLobbyEvents`, `useMeetingDevices`, `useMeetingRecording`, `useMeetingScreenShare`, `useMeetingSignaling`, `PrejoinScreen`, `InCallScreen`, `MeetingOverlays`.

**Testing done:** new `tests/meeting-metadata-helpers.test.cjs` covering the two pure helpers. `tsc --noEmit` clean, full test suite unaffected.

## P2 — Build and asset improvements

### P2-9 — Measure and enforce production bundle budgets

**Status:** ✅ DONE

New `toowix-web-app/scripts/bundle-report.cjs`, run automatically as part of `npm run build` (also exposed standalone as `npm run bundle-report`). Reads `dist/.vite/manifest.json` (enabled via `build.manifest: true` in `vite.config.ts`) to measure real gzip-compressed shipped bytes and enforce:

| Budget | Current measurement |
|---|---|
| Root entry (every page) initial JS < 150 KB gzip | **96.4 KB** |
| `MeetingRoomPage`'s own additional static JS < 350 KB gzip | **80.2 KB** |
| Each initial CSS file < 100 KB gzip | **10.1 KB** |
| Virtual-background/MediaPipe/noise-suppression code only reachable via `dynamicImports`, never static | **confirmed true** |

The build now fails (non-zero exit) if any budget is exceeded. No actual CI pipeline exists in this repo to wire this into beyond the build script itself — the `.github/workflows/*.yml` files present are leftover upstream jitsi-meet project workflows (reference `.nvmrc`, `lang-sort`, etc.), unrelated to `toowix-web-app`/`toowix-backend`.

**A real bug caught and fixed during testing:** the first version of the script wrongly excluded the root entry's own JS file from the "root initial JS" measurement, reporting 0.0 KB. Fixed before finishing.

**Files changed:** `toowix-web-app/vite.config.ts`, `toowix-web-app/package.json`, new `toowix-web-app/scripts/bundle-report.cjs`.

### P2-10 — Review static assets and caching

**Status:** ✅ DONE, except Brotli (explicitly skipped per your decision)

- **Confirmed** optional WASM/model files are not downloaded during a normal meeting — only `dynamicImports`, verified via the manifest (also what P2-9's own automated check now guards).
- **Fixed** — `application/wasm` was missing from `gzip_types` in `toowix-web-app/docker/nginx.conf`, so the 11-12MB MediaPipe WASM runtimes and `tflite.wasm` were served **completely uncompressed**. Added.
- **Fixed** — `/libs/` (WASM, tflite models, noise-suppressor worklet) and `/images/` (virtual-background presets) had no cache rule at all, falling through to the SPA catch-all's `no-cache, must-revalidate` — a full revalidation round trip for an 11MB file on every single use. Added `expires 1y; Cache-Control: public, immutable` for both, matching `/assets/`'s existing rule.
- **Confirmed correct, no change needed** — WASM MIME type. Verified live against the real `nginx:1.27-alpine` image (`docker run ... cat /etc/nginx/mime.types`) that `.wasm → application/wasm` is already in its default table. (Caught my own mistake here: an earlier draft added an explicit `types { application/wasm wasm; }` override, which would have *replaced* nginx's entire inherited MIME table for that server block instead of extending it, breaking every other file's type — removed before finishing.)
- **Brotli — explicitly skipped, your decision.** The base image (`nginx:1.27-alpine`, official nginx build) has no Brotli module compiled in. Alpine's own `apk` brotli module package is built against nginx 1.26.3, not 1.27.5 — won't load (ABI mismatch). Real support would need switching to Alpine's own nginx package or a custom-built image; you chose to leave this for a separate, dedicated infra change rather than do it unprompted here.
- **Fixed** — found and deleted 4 dead duplicate sound files in `toowix-web-app/public/sounds/`: byte-identical to (or fully superseded by) the real, bundled `src/assets/sounds/*.wav` files `notificationSounds.ts` actually imports; `recording-stopped.wav` had no live reference anywhere at all. Verified via `sha256sum` and a full-repo grep before deleting; confirmed the real sounds still bundle correctly afterward.
- **Checked, not a duplicate** — `selfie_segmenter_landscape.tflite` vs `selfie_segmentation_landscape.tflite` looked like a possible duplicate at a glance but are genuinely different model files for two different segmentation engines (MediaPipe vs direct TFLite) — left alone.

**Files changed:** `toowix-web-app/docker/nginx.conf`; deleted `toowix-web-app/public/sounds/*.wav` (4 files).

**Testing done:** validated the final `nginx.conf` with a real `nginx -t` inside the actual `nginx:1.27-alpine` image.

## 2G/3G plan summary table

| Item | Status |
|---|---|
| P0-1 Simulcast | 🔵 Deliberately skipped (your decision — real SSRC bug, needs staging validation first) |
| P0-2 3G startup policy | ✅ Done |
| P0-3 Camera capture follows network | ✅ Done |
| P0-4 Immediate low-bandwidth policy at join | ✅ Done |
| P1-5 Dedupe meeting metadata fetch | ✅ Done (guest case); known signed-in-cold-load gap needs backend work |
| P1-6 Scope Jitsi preconnect to meeting intent | ✅ Done |
| P1-7 CPU-heavy effects off on weak profiles + warning | ✅ Done |
| P1-8 Refactor MeetingRoomPage.tsx | 🟡 1 of 10 modules extracted (proof of concept, your decision) |
| P2-9 Bundle budgets | ✅ Done |
| P2-10 Static assets/caching | ✅ Done, except Brotli (your decision — needs a base-image change) |

**Nothing in this section is pushed or deployed yet** — same next steps as the rest of this report: commit, push, pull on the server, rebuild both Docker images, redeploy, then re-verify live.

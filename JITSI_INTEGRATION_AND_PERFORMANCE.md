# Jitsi Integration & Performance Notes

Scope of this doc: how this repo is actually laid out (two real apps + one leftover folder), how `lib-jitsi-meet` gets used in a Toowix meeting, and what in the current code is the most likely source of slow performance.

## 1. Folder layout — what's real, what's waste

This repo root **is itself a fork of the stock Jitsi Meet web client** (`package.json` name is `jitsi-meet`; `conference.js`, `config.js`, `react/`, `modules/`, `css/`, `webpack.config.js`, etc. all live at the top level). This part is **not waste** — it's the actual meeting server application that gets built and deployed (the thing a browser hits at `https://<jitsiDomain>/` to fetch `config.js` and `libs/lib-jitsi-meet.min.js`, which the Toowix web app loads directly — see §2).

Inside that root, two unrelated apps were added:

| Folder | What it is | Used? |
|---|---|---|
| `toowix-web-app/` | Standalone Vite/React app — Toowix's actual product UI (login, dashboard, meeting room, settings). Talks to `toowix-backend` and to the deployed Jitsi server directly via `lib-jitsi-meet`. | **Yes — primary frontend** |
| `toowix-backend/` | Node/TypeScript API — auth, companies, meetings, recordings, settings, Keycloak integration, meet-entitlement checks. | **Yes — primary backend** |
| `jitsi-meet/` (nested, at repo root) | A **second, full clone of `github.com/jitsi/jitsi-meet`**, complete with its own `.git`, its own `node_modules` (1000+ top-level packages, 85k+ files), and its own `package-lock.json`. Pinned to a stock upstream commit (`852b61c`, a Firefox/AV1 test fix) with no Toowix changes. | **No — confirmed dead weight** |

### Why `jitsi-meet/` is waste
- It's listed as untracked (`??`) in `git status` — the outer repo never adopted it, it's just sitting on disk.
- `grep` across `toowix-web-app/src` and `toowix-backend/src` for any reference to it (`jitsi-meet/`, relative imports, build config) returns nothing — neither app builds against it, imports from it, or proxies to it.
- `diff` against the repo root's own `conference.js`/`package.json` shows it has diverged — it's not even a kept-in-sync mirror, just a stale second checkout.
- It's a near-exact duplicate of the repo root itself (same file tree, same `package.json` name `jitsi-meet`), so even if it *were* needed for reference, the outer repo root already serves that purpose.

**Recommendation:** delete `jitsi-meet/` (and the top-level `WhatsApp Video 2026-09-29 at 15.30.45.mp4`, `readme-img1.png`, `reports/benchmarks/`, `reports/*.html` while you're at it — none of these are source and they're bloating the working tree/clone size). If you ever cloned it to diff against upstream, a `git remote add upstream https://github.com/jitsi/jitsi-meet.git && git fetch upstream` in the main repo gets you the same diffing ability without a second checkout.

## 2. How `lib-jitsi-meet` is actually used in a Toowix meeting

Toowix does **not** use the Jitsi IFrame API (no `external_api.js`, no embedded iframe). It talks to `lib-jitsi-meet` directly, so it owns real `MediaStreamTrack`s and can render them in its own `<video>`/`<audio>` elements inside its own UI (`MeetingRoomPage.tsx`) instead of an iframe's UI.

The core hook is [`toowix-web-app/src/lib/useJitsiMeeting.ts`](toowix-web-app/src/lib/useJitsiMeeting.ts) (~2,400 lines). Flow for every meeting:

1. **Script load** (`ensureLibJitsiMeetLoaded`): fetches `https://<jitsiDomain>/config.js` then `https://<jitsiDomain>/libs/lib-jitsi-meet.min.js` **serially**, from the live Jitsi deployment (the repo root app), not from an npm package or local bundle. This is deliberate — a locally bundled copy of `lib-jitsi-meet` previously drifted from the server's Jicofo/JVB version and broke SDP negotiation — but it means every join depends on two sequential cross-origin script fetches before anything else can happen. It's preloaded as early as the prejoin lobby screen to hide most of this latency.
2. **Connect**: `new JitsiMeetJS.JitsiConnection(null, jwt, {...config, serviceUrl: config.websocket || config.bosh})`, then `connection.connect()`. Auth is a JWT issued by `toowix-backend` (see `meetAccess.routes.ts` / `meetEntitlement.ts`).
3. **Join**: on `CONNECTION_ESTABLISHED`, calls `connection.initJitsiConference(roomName, {...config, p2p: {enabled: false}, openBridgeChannel: true})` and `room.join()`. P2P is explicitly disabled — every call, even 1:1, always routes through the JVB (media bridge), because P2P↔JVB renegotiation broke when a 3rd participant joined in production.
4. **Local media**: `JitsiMeetJS.createLocalTracks(...)` for mic/camera (with retry/backoff for transient "device busy" errors, e.g. Bluetooth handoff), or adopts already-live tracks from the prejoin preview via `createLocalTracksFromMediaStreams` to avoid a second `getUserMedia` prompt. Tracks are added to the room via `room.addTrack`, serialized through a single queue (`trackOperationQueueRef`) so overlapping SDP renegotiations (screen share, device switch, mute) can't race each other.
5. **Remote media**: `TRACK_ADDED`/`TRACK_REMOVED`/`USER_JOINED`/`USER_LEFT`/dominant-speaker/recording/shared-video events are wired up in [`useConferenceEvents.ts`](toowix-web-app/src/lib/jitsi/useConferenceEvents.ts) and turned into React state (`remoteParticipants`, `remoteScreenShare`, etc.).
6. **Adaptive quality**: a periodic effect reads live WebRTC stats (RTT, packet loss, available bitrate) via [`useNetworkQuality.ts`](toowix-web-app/src/lib/jitsi/useNetworkQuality.ts) → [`networkQuality.ts`](toowix-web-app/src/lib/networkQuality.ts) classifies the link as `GOOD`/`DEGRADED`/`POOR`, which drives `room.setReceiverVideoConstraint`, `room.setSenderVideoConstraint`, `room.setLastN`, and Opus bitrate.
7. **Extras**: screen share (`createLocalTracks({devices:['desktop']})`), virtual background (MediaPipe segmentation + canvas compositing, applied as a `track.setEffect(...)`), noise suppression (RNNoise WASM effect), recording (Jibri via `room.startRecording`), shared YouTube video (ported from upstream Jitsi's XMPP command protocol).
8. **Teardown**: dispose local tracks, `room.leave()`, `connection.disconnect()` — guarded by a generation counter so React 18 StrictMode's double-invoke (or a fast prop change) can't produce two live connections for the same component.

`toowix-backend` is on the *signaling/auth* side of this, not the media side: it issues the meeting JWT, enforces entitlement (`meetEntitlement.ts`, `requireMeetEntitlement.ts`), and tracks meeting/waiting-room/recording state — it never touches audio/video itself.

## 3. Most likely sources of slow performance (from the code, not guesses)

Ranked by how directly the code ties them to CPU/bandwidth/latency:

### 3.1 Simulcast is globally disabled (`SEND_SINGLE_VIDEO_LAYER = true`)
`disableSimulcast: true` is passed to both `JitsiConnection` and `initJitsiConference` in [`useJitsiMeeting.ts:974,1001`](toowix-web-app/src/lib/useJitsiMeeting.ts#L974). The comment explains why: with simulcast on, a 3rd participant joining triggered a duplicate-SSRC bug in this `lib-jitsi-meet` build that Chrome rejected as invalid SDP ("offerAnswerFailed"). The fix was to turn simulcast off **for every call, permanently** — not just work around the 3-participant case.
- **Cost:** without simulcast, the JVB cannot hand each receiver a lower-resolution layer of the same stream — every sender's single encoded layer is forwarded as-is. Combined with §3.2 below (cameras captured up to 4K), this means in anything beyond a 1:1 call, participants on small tiles or weak connections still receive the full-resolution stream the sender captured, costing CPU (decode) and bandwidth they don't need.
- This is the single highest-leverage fix available: resolving the real SSRC/simulcast negotiation bug (likely a `lib-jitsi-meet`/JVB version mismatch — see the "same release" comment in `ensureLibJitsiMeetLoaded`) would let simulcast come back and let the bridge do per-receiver downscaling again.

### 3.2 Camera capture requested at up to 4K with no simulcast to tame it
[`networkQuality.ts:getCameraCaptureIdeal`](toowix-web-app/src/lib/networkQuality.ts#L137) requests `3840x2160@30` on desktop (1080p on mobile). [`getReceiveMaxHeightForCallSize`](toowix-web-app/src/lib/networkQuality.ts#L147) allows up to **2160p for 1:1 calls** and 1080p for up to 4 participants. On real hardware, encoding 4K/1080p video on a single non-simulcast layer is a heavy, sustained CPU/encoder load — and with simulcast off, every participant in the room receives whatever height the sender is currently asked to send, not a size matched to their own tile/bandwidth.

### 3.3 JVB-only routing — P2P disabled for every call
`p2p: { enabled: false }` ([`useJitsiMeeting.ts:1005`](toowix-web-app/src/lib/useJitsiMeeting.ts#L1005)) forces even a plain 2-person call through the media bridge instead of a direct peer connection, trading the lower latency/CPU of P2P for avoiding a renegotiation bug that only matters once a 3rd participant joins. Every 1:1 call pays the JVB relay cost (extra hop, extra server CPU/bandwidth, slightly higher latency) that upstream Jitsi would normally avoid.

### 3.3b Serial, cross-origin script load before a call can start
`ensureLibJitsiMeetLoaded` fetches `config.js` then `lib-jitsi-meet.min.js` **sequentially** from the live Jitsi deployment (not bundled, not parallel). It's preloaded from the lobby screen to hide this, but a person who joins a direct link without passing through the lobby (or a cold cache) pays two sequential round trips before `JitsiMeetJS.init` can even run.

### 3.4 Heavy, per-frame virtual-background compositing
[`JitsiStreamBackgroundEffect.ts`](toowix-web-app/src/lib/virtualBackground/JitsiStreamBackgroundEffect.ts) is ~1,850 lines implementing a real-time MediaPipe segmentation + canvas compositing pipeline, with its own adaptive `_perfCap` governor specifically because a fixed 1080p render target used to visibly lag on ordinary hardware. This is necessary work for the feature, but it's a significant, continuous CPU/GPU cost whenever blur/background is on, stacked on top of whatever the encoder is already doing for §3.1/3.2.

### 3.5 Unthrottled, serialized SDP renegotiation on every media change
Every screen-share start/stop, device switch, and camera-retry-after-busy goes through `room.addTrack`/`removeTrack`/`replaceTrack`, each a real WebRTC offer/answer round trip, funneled through one serialized queue (`trackOperationQueueRef`, 8s timeout per op — [`useJitsiMeeting.ts:685`](toowix-web-app/src/lib/useJitsiMeeting.ts#L685)). This exists to prevent renegotiations from racing each other (a real bug it fixed), but it also means a user flipping camera/screen-share quickly perceives each action as fully blocking until the previous SDP exchange settles — there's no way around that cost in a non-simulcast, JVB-always topology.

### 3.6 Secondary / lower-impact
- `toowix-web-app/src/lib/useLibJitsiConference.ts` is a **second, separate** direct `lib-jitsi-meet` integration path (used by `DirectMeetingRoomPage.tsx`), duplicating connection/track logic already in `useJitsiMeeting.ts` with none of its retry/adaptive-quality/queueing hardening — worth checking whether it's still needed or is leftover from an earlier "first pass."
- Network stats are polled every `NETWORK_STATS_INTERVAL_MS` (3s) purely for UI/quality-policy purposes — lightweight on its own, but one more thing running continuously alongside WebRTC's own internal congestion control.

## 4. Summary

- **Keep & build on:** `toowix-web-app/` + `toowix-backend/` (the real product), and the repo-root Jitsi Meet fork (the actual deployed meeting server these talk to).
- **Delete:** the nested `jitsi-meet/` folder — an unreferenced, diverged, duplicate clone of upstream Jitsi Meet with its own multi-GB `node_modules`.
- **Biggest performance lever:** simulcast is off everywhere (§3.1) to dodge one SSRC bug, and camera capture is requested at up to 4K with no per-receiver downscaling to compensate (§3.2) — together these are the most direct, code-confirmed cause of excess CPU/bandwidth use in any call beyond two people on a good network. Fixing the underlying simulcast/SSRC bug (rather than permanently disabling simulcast) is the highest-leverage next step.

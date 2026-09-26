# Toowix Meet — Complete Performance Optimization Report

**Assessment date:** 26 September 2026  
**Scope:** Toowix web meeting application, Toowix backend, production Jitsi stack, local official Jitsi Meet source comparison, and production builds.  
**Purpose:** Record the performance issues found, the changes completed, verified measurements, and the remaining steps required to prove real call-quality improvement.

---

## 1. Executive Summary

Toowix Meet is built on Jitsi's real-time media foundation. Audio and video do not travel through a separate Toowix media engine.

```text
Participant browser
  → lib-jitsi-meet / WebRTC
  → Jitsi Videobridge (JVB)
  → other participant browsers
```

The Toowix backend owns product functionality: authentication, meeting links, lobby/waiting room, RSVP, chat/conversations, attendance, moderation, recordings coordination, notifications, and product signals.

The original assessment found two categories of performance risk:

1. A verified **server UDP receive-buffer limit** that could drop media packets during bursts.
2. Extra **browser/product-layer work** around the Jitsi engine: frequent polling, custom quality controls, optional feature costs, and a large initial web bundle.

The UDP issue was corrected in production. The browser changes reduce recurring work, remove normal-mode quality conflicts, and replace repeated signal polling with one persistent event stream.

No arbitrary percentage is claimed for audio/video quality. Actual call quality must be benchmarked with real participants and networks.

---

## 2. How a Toowix Call Works

| Layer | Responsibility |
|---|---|
| Browser | Captures camera/microphone, encodes and decodes media, renders video, runs WebRTC encryption and congestion control, applies optional background/noise effects. |
| JVB | Selectively forwards encrypted RTP media streams between participants. It is not normally rendering every participant video. |
| Jicofo / Prosody | Conference orchestration, XMPP signalling, focus and bridge selection. |
| Coturn | Fallback relay for restrictive networks that cannot reach JVB directly. |
| Toowix backend | Product APIs, admission, meeting records, attendance, chats, notifications, recording workflow, and SSE room signals. |

The biggest real-call costs therefore occur in the browser: capture, encode/decode, screen sharing, many visible videos, virtual background, noise suppression, and weak network conditions.

---

## 3. Original Findings

### 3.1 Production server resources were not the primary bottleneck

During the production diagnostic, the host had approximately:

- 98% CPU idle.
- 6.3 GB RAM available out of 7.8 GB.
- JVB about 250 MB RAM / 0.17% CPU.
- Jicofo about 178 MB RAM / 0.10% CPU.
- Jibri about 516 MB RAM / 0.10% CPU while idle.
- Toowix backend about 47 MB RAM / 0.13% CPU.
- No observed host NIC RX/TX drops in the diagnostic window.

Conclusion: adding CPU/RAM was not the first justified fix.

### 3.2 Verified JVB/Linux UDP buffer issue

| Setting | Before | After |
|---|---:|---:|
| JVB granted receive buffer | ~212 KB | 10 MB |
| Linux receive/send maximum | ~212 KB | 16 MB |
| Linux receive/send default | ~212 KB | 10 MB |
| Network-device backlog | 1,000 | 5,000 |

The JVB log verified: `Receive buffer size 10485760 (asked for 10485760)`.

This increases resilience to short UDP/RTP bursts and reduces the chance of burst-driven packet loss/audio gaps. It does not create bandwidth that the participant does not have.

### 3.3 Browser/product-layer issues

- Toowix performed a custom WebRTC stats/quality loop in addition to Jitsi/WebRTC adaptation.
- The application could repeatedly apply Last-N, sender, receiver, and screen-share constraints during normal calls.
- Room signals were received by HTTP polling.
- PiP and prejoin background had more recurring work than necessary.
- The meeting page was bundled into every initial application load.
- Virtual background and noise suppression are naturally heavy when activated, although their runtimes are now demand-loaded.

---

## 4. Completed Changes

### 4.1 Media quality ownership

**Before:** Toowix could repeatedly alter Jitsi media constraints as its own network samples changed.

**After:**

- In normal Auto mode, Jitsi/WebRTC owns transport congestion control, simulcast layer selection, bitrate adaptation, and receiver feedback response.
- Toowix applies restrictions only when a person deliberately chooses **Low Data** or **Audio-only** mode.
- Leaving a data-saving mode restores a conservative baseline once; it does not restart a periodic quality controller.
- Packet-loss status now uses the current sample window instead of lifetime loss totals, reducing false “Limited connection” labels after recovery.

Why this matters: two independent quality controllers can oscillate. Jitsi reacts directly to RTP feedback; a React timer should not keep fighting it.

### 4.2 Browser work and API reduction

| Area | Before | After | Measured change |
|---|---:|---:|---:|
| Local WebRTC telemetry | Every 2.5 seconds | Every 5 seconds | 50% fewer local samples. |
| Room-signal receive path | Polling every 600 ms, later 1.5 seconds | One SSE connection in modern browsers | Removes 40 fallback GET requests/minute per participant. |
| Waiting guest admission status | HTTP poll every 2 seconds | One scoped lobby SSE stream | Removes approximately 30 status GET requests/minute for each waiting guest. |
| Moderator waiting queue | HTTP poll every 3 seconds | One authenticated-ticket lobby SSE stream | Removes approximately 20 queue GET requests/minute for each moderator. |
| Meeting-ended fallback | Every 3 seconds | Every 10 seconds | 20 to 6 checks/minute (70% fewer). |
| PiP drawing | 15 fps | 10 fps while PiP is active | ~33% fewer PiP redraws. |
| Prejoin virtual background | Permanent 600 ms check | At most 10 startup retries at 250 ms | No permanent loop after attach. |

Notes:

- SSE pushes a message only when an action occurs: chat, poll, reaction, hand raise, or meeting end.
- Jitsi data-channel delivery remains another fast path; duplicate messages are ignored safely.
- A browser without EventSource uses the legacy polling fallback for compatibility.
- Sending a chat/poll/action still requires one HTTP POST. The optimization removes repeated *receive* polling, not legitimate user actions.

### 4.3 Waiting-room SSE security and behaviour

The waiting room now uses its own scoped SSE streams rather than sending admission data over the general room-signal stream.

- A waiting guest connects with its cryptographically random lobby `requestId`. The server sends that connection only that guest's admission, denial, host announcement, or meeting-ended status.
- A moderator first makes one normal authenticated request for a short-lived opaque stream ticket. EventSource then uses that ticket to receive only the host's sanitised pending queue.
- Admission credentials are never broadcast to other guests or ordinary meeting signal subscribers.
- Each stream sends an initial state snapshot, so an admission/queue change that occurred just before the browser connected is not missed.
- SSE automatically reconnects after a temporary network interruption. A 25-second heartbeat prevents idle proxies from closing the connection.

This replaces recurring requests with one persistent connection plus a single ticket request for a moderator. It is a product-state optimisation and does not change the RTP/WebRTC media path.

### 4.4 Route and optional-feature loading

| Asset | Before | After | Difference |
|---|---:|---:|---:|
| Initial JavaScript bundle | 1,068.19 KB | 814.48 KB | -253.71 KB (-23.8%) |
| Initial JavaScript gzip | 246.57 KB | 187.76 KB | -58.81 KB (-23.8%) |
| Meeting route | Included initially | 245.63 KB / 57.58 KB gzip on demand | Loaded only for `/meet` and `/meet-direct`. |
| Virtual background runtime | On demand | On demand | Preserved. |
| Noise suppression runtime | On demand | On demand | Preserved. |

This materially improves homepage, login, dashboard, RSVP, expired-link, and other non-meeting page loads. It does not by itself prove a 23.8% lower first-meeting download, because a meeting participant still downloads the meeting chunk before joining.

### 4.5 Jitsi production media profile

| Feature | Verified production status |
|---|---|
| Simulcast | Explicitly enabled: `ENABLE_SIMULCAST=true`. |
| Simulcast layer preservation | Explicitly enabled: `JICOFO_CONF_STRIP_SIMULCAST=false`. |
| Transport congestion control | `ENABLE_TCC=true`. |
| Opus RED audio resilience | `ENABLE_OPUS_RED=true`. |
| P2P | Enabled on the production Jitsi web/config service: `ENABLE_P2P=true`. The Toowix frontend is built with the matching native P2P setting and awaits frontend deployment. |
| TURN | Coturn retained as a fallback. JVB UDP is preferred. |
| ICE restart | Enabled, including restart on mobile network change. |
| UDP buffers | 10 MB JVB receive/default and 16 MB maximum; persistent Linux configuration. |
| Jicofo health after simulcast configuration | One operational bridge; no active conference at the validation time. |

The production Jitsi web/config container was safely recreated after the Simulcast and P2P configuration changes. JVB, Jicofo, Prosody, Coturn, and active media routing were not recreated for the P2P change. The SSE/browser/backend code and the frontend P2P override are verified locally but must be deployed together before they affect public Toowix browser clients.

### 4.6 Native two-person P2P and automatic JVB handover

**Previous design:** Toowix explicitly forced `p2p.enabled: false` in the browser, even if the Jitsi server could support P2P. Every two-person call therefore used JVB.

**Current design:**

- Production Jitsi configuration has `ENABLE_P2P=true` and its generated `config.js` was verified to contain `config.p2p = { enabled: true }`.
- The Toowix meeting hook now permits Jitsi's native P2P mode rather than overriding it to off.
- With exactly two joined participants, Jitsi can negotiate direct WebRTC P2P media when both networks allow it.
- When a third participant joins, Jitsi automatically switches conference media to JVB. Toowix does not run a competing participant-count timer.
- TURN remains available when a direct connection cannot be established.

The switch begins as soon as Jitsi receives the participant change, but it still requires normal WebRTC renegotiation. It should not be described as a guaranteed literal millisecond transition; it must be tested with real participant joins, camera, audio, and screen share.

---

## 5. Comparison With Official Jitsi Meet

| Area | Official Jitsi Meet | Current Toowix Meet |
|---|---|---|
| Media transport | lib-jitsi-meet + WebRTC + JVB | Same. |
| Simulcast / TCC / Opus RED | Available/configurable | Enabled in production. |
| P2P | Usually enabled by default | Enabled in production Jitsi configuration and in the built Toowix browser code. Two-person calls may use direct media; three or more use JVB. Frontend deployment is pending. |
| Network adaptation | Jitsi/WebRTC media system | Same in Auto mode after controller cleanup. |
| Last-N | Mature feature/UI integration | Explicit Low Data/Audio-only limits; normal large-room policy still needs measured tuning. |
| Codec policy | Browser-safe configurable policy | No advanced codec forced before device testing. |
| Product layer | Mature upstream feature modules | Custom Toowix UI plus lobby, attendance, RSVP, conversations, recordings, notifications, and moderation. |
| Product signalling | Jitsi mechanisms | Jitsi data channel plus Toowix SSE and action POSTs. |

The core media path is now effectively the same. Toowix still has more custom product-state logic to maintain and test, which is expected for a branded product built around Jitsi.

---

## 6. What Still Uses Browser Resources

| Feature | Cost | Recommendation |
|---|---|---|
| Camera encode/decode | High; depends on resolution and hardware | Let Jitsi adapt; avoid forcing HD. |
| Multiple visible videos | High network/GPU/decoder cost | Tune Last-N only from large-room test evidence. |
| Screen sharing | Can be high encode cost | Keep separate screen limits; test text readability vs bandwidth. |
| Virtual background | High CPU/GPU while enabled | Keep optional and disabled by default where possible. |
| Noise suppression | CPU/audio-worklet cost while enabled | Keep demand-loaded; enable when needed. |
| PiP | Canvas CPU/GPU only while active | Limited to 10 fps. |
| Mic recovery | Small periodic cost | Keep because it protects mobile/Bluetooth recovery. |
| WebRTC stats | Small local cost | Limited to 12 samples/minute. |

---

## 7. Validation Performed

- Frontend TypeScript and production Vite build: passed.
- Backend TypeScript build: passed.
- Performance regression guard: 13/13 checks passed, including the scoped waiting-room SSE check.
- Production JVB buffer configuration verified.
- Production simulcast and Jicofo layer settings verified.
- Production P2P setting verified: `ENABLE_P2P=true` and generated Jitsi `config.p2p.enabled=true`.
- Toowix native P2P/JVB-handover static validation: passed.
- Jicofo health after the controlled web/Jicofo restart verified.

The test script is:

```text
node scripts/test-meeting-performance.cjs
```

It verifies static architecture decisions, not live audio/video quality.

---

## 8. What Must Still Be Tested Before Claiming “Jitsi-Level” Quality

Run the same controlled test for Toowix and official Jitsi Meet:

```text
Participants: 2 and 4
Devices: desktop Ethernet, desktop Wi-Fi, Android, iPhone
Networks: good Wi-Fi, weak Wi-Fi, mobile data, temporary degradation, network handover
Features: camera call, long call, screen share, virtual background, noise suppression,
          waiting room, recording, participant join/leave, mic/camera recovery

Measure:
join time
time to first audio
time to first video
packet loss
jitter
RTT
available outbound bitrate
sent/received resolution
video FPS
browser CPU
ICE candidate type
reconnect count
audio interruptions
video interruptions
```

Do not claim a numerical media-quality increase until this test has a before/after baseline.

---

## 9. Remaining Engineering Priorities

1. Deploy the verified SSE/backend/frontend changes together, including the built browser P2P override, and test end-to-end.
2. Test waiting-room admission, denial, cancellation, announcement, moderator queue, reconnect, and meeting-end events through the new SSE streams.
3. Test simulcast layer selection and Last-N behaviour with 2, 4, and larger rooms.
4. Tune a large-room Last-N/visible-video policy from measurements, not a guessed number.
5. Test codec preferences on Chrome, Edge, Android, and iPhone before forcing VP9, AV1, or H.264.
6. If Toowix backend scales beyond one instance, replace the in-memory SSE signal and lobby-stream state with Redis/pub-sub or add sticky routing.
7. Continue incremental cleanup of custom recovery/timer paths without removing required mobile reliability behaviour.

---

## 10. Final Conclusion

The known server media reliability issue was fixed, and the browser meeting path now performs less unnecessary work. Toowix is materially closer to official Jitsi Meet in how it lets Jitsi/WebRTC control normal media quality. Native two-person P2P is now enabled on the production Jitsi configuration; the matching browser-code deployment and real-call handover test remain required.

The biggest proven gains are reduced recurring browser/API work, better non-meeting page loading, explicit simulcast protection, and corrected JVB UDP buffering. The biggest unproven area is real call quality across devices and networks; that requires the controlled test matrix above.

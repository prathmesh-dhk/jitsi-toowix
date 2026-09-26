# Toowix Meet Performance Optimization Report

Date: 26 September 2026

## Outcome

The meeting client now does less recurring browser and HTTP work while retaining its existing calling, recovery, recording, waiting-room, moderator, and optional-effect features.

The key design change is that **Jitsi/WebRTC is again the automatic media-quality controller in normal mode**. Toowix applies media limits only when the participant explicitly chooses **Low Data** or **Audio-only** mode. This prevents an application timer from repeatedly competing with Jitsi transport congestion control and simulcast layer selection.

## Verified changes

| Area | Before | After | Verified effect |
|---|---:|---:|---|
| WebRTC telemetry `getStats()` | Every 2.5 seconds | Every 5 seconds | 50% fewer telemetry samples; it remains available for connection status. |
| Automatic Toowix quality controls | Could set Last-N, sender, receiver and screen-share constraints as network samples changed | No recurring constraints in normal/Auto mode | Jitsi/WebRTC now owns automatic adaptation; explicit data-saving modes remain available. |
| Packet-loss status | Based on lifetime packet totals | Based on the current sample window | A recovered call is less likely to remain falsely labelled degraded because of old packet loss. |
| Room-signal delivery | HTTP poll every 600 ms, later every 1.5 seconds | One persistent Server-Sent Events connection | Eliminates the 40 fallback GET requests/minute per participant. New signals are pushed immediately; Jitsi data-channel delivery remains an additional fast path. |
| Host-ended status check | Every 3 seconds | Every 10 seconds | About 70% fewer non-media API requests during a call. |
| Custom PiP canvas | 15 fps | 10 fps | About 33% fewer PiP redraws while PiP is active; call media remains unaffected. |
| Prejoin virtual background | Permanent 600 ms polling while selected | At most 10 startup retries at 250 ms | No permanent prejoin-background polling after a preview attaches. |
| Route loading | Meeting page included in initial application bundle | `/meet` and `/meet-direct` pages are lazy-loaded | Non-meeting pages avoid loading meeting UI code. |

## Production bundle measurement

These are real production-build outputs, not estimates.

| Asset | Before | After | Difference |
|---|---:|---:|---:|
| Initial JS bundle | 1,068.19 KB | 814.48 KB | -253.71 KB (-23.8%) |
| Initial JS gzip | 246.57 KB | 187.76 KB | -58.81 KB (-23.8%) |
| On-demand meeting route | Included in initial bundle | 245.22 KB / 57.45 KB gzip | Downloaded only when opening a meeting |
| Virtual background runtime | On-demand | On-demand | Preserved |
| Noise suppression runtime | On-demand | On-demand | Preserved |

Important: route splitting makes homepage, login, dashboard, RSVP, and link-state pages faster to load. A participant who opens a meeting still downloads the meeting route before joining, so this report does **not** claim that route splitting alone reduces the total bytes of a first meeting join.

## Jitsi media profile status

| Item | Status |
|---|---|
| JVB/Linux UDP receive buffer | Verified earlier: 10 MB granted to JVB; persistent sysctl configuration remains in place. |
| Transport congestion control (TCC) | Existing server configuration retained. |
| Opus RED | Existing server configuration retained. |
| P2P disabled | Existing server configuration retained for predictable JVB routing. |
| TURN fallback | Existing fallback retained. |
| Simulcast | Explicitly enabled in production (`ENABLE_SIMULCAST=true`) and Jicofo is explicitly configured not to strip layers (`JICOFO_CONF_STRIP_SIMULCAST=false`). The next required step is a real multi-participant layer-selection test. |
| Last-N | Retained for explicit Low Data/Audio-only policies; large-room values require controlled 4+ participant testing before tuning. |
| Adaptive quality | Normal mode now delegates adaptation to Jitsi/WebRTC rather than a competing Toowix polling controller. |
| Codec policy | No speculative codec preference was forced. It must be tested on Chrome, Edge, Android, and iPhone before changing defaults. |
| Camera/screen resolution | Existing conservative explicit limits are retained; no automatic oscillation is forced in normal mode. |

## Validation performed

- Frontend TypeScript and production Vite build: passed.
- Backend TypeScript build: passed.
- `node scripts/test-meeting-performance.cjs`: static performance-regression guard, including the browser SSE client and backend publisher.

The guard verifies cadence, lazy imports, auto-quality ownership, packet-loss-window logic, and route loading. It intentionally does not pretend to measure a real video call.

## Real-call performance parameters still required

The following must be collected using two and four actual participants before and after deployment:

```text
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
reconnects
audio/video interruptions
ICE candidate type
```

Test on Ethernet, Wi-Fi, Android, iPhone, weak Wi-Fi, mobile data handover, screen sharing, virtual background, noise suppression, recording, waiting room, and a long call. This is required to prove an improvement in actual call quality; the static/build checks only prove the code path is lighter and that the intended architecture is enforced.

## Remaining work before claiming full Jitsi-level performance

1. Run the controlled device/network matrix above and collect the real-call parameters.
2. Verify simulcast layers and Last-N behaviour with 2, 4, and larger rooms.
3. Review JVB health/statistics dashboards during those calls.
4. Tune codec and screen-share limits only from measured mobile/browser evidence.
5. Continue the timer/reconnect/device-recovery audit incrementally; do not remove recovery logic without a demonstrated replacement event path.

## Files added/changed

- `toowix-web-app/src/lib/useJitsiMeeting.ts`
- `toowix-web-app/src/lib/networkQuality.ts`
- `toowix-web-app/src/pages/MeetingRoomPage.tsx`
- `toowix-web-app/src/App.tsx`
- `scripts/test-meeting-performance.cjs`

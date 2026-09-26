# Toowix Meet vs Official Jitsi Meet — Post-Optimization Assessment

Date: 26 September 2026  
Scope: current Toowix meeting implementation, the local official `jitsi-meet` source tree, production Jitsi configuration, and the production builds created during this assessment.

## Executive conclusion

Toowix and official Jitsi Meet now use the same core media architecture:

```text
Browser → lib-jitsi-meet / WebRTC → JVB → other participants
```

Toowix is not using a separate video engine. Its custom React interface sits around Jitsi's media engine and adds product features such as authentication, waiting rooms, chat/conversations, recording controls, moderation, RSVP, custom layouts, and product notifications.

After the recent changes, the largest previous differences were reduced:

- Normal calls no longer have a second Toowix quality controller repeatedly overriding Jitsi/WebRTC decisions.
- Room messages/polls/reactions/hand signals use one Server-Sent Events connection instead of repeated polling in modern browsers.
- Optional virtual-background and noise-suppression modules remain demand-loaded.
- Meeting routes are demand-loaded rather than included in every page visit.
- Production Jitsi now explicitly keeps simulcast enabled and Jicofo explicitly keeps simulcast layers.

This makes Toowix closer to Jitsi in media behaviour. It does **not** prove equal real-call performance until the same controlled calls are measured on both products.

## Architecture comparison

| Area | Official Jitsi Meet | Current Toowix Meet | Performance interpretation |
|---|---|---|---|
| Audio/video transport | lib-jitsi-meet + WebRTC + JVB | lib-jitsi-meet + WebRTC + JVB | Same core media path. |
| Conference signalling | Jitsi XMPP/WebSocket/BOSH | Jitsi signalling plus Toowix product APIs | Toowix has extra product traffic, but it is not the RTP media path. |
| Network adaptation | Jitsi/WebRTC congestion control and simulcast | Same Jitsi/WebRTC control in Auto mode | Alignment improved; Toowix does not repeatedly force quality in normal mode. |
| Data-saving mode | Jitsi UI/media-quality controls | Explicit Low Data and Audio-only policies | Intentional Toowix product policy; limits only apply when selected. |
| UI/state management | Mature Jitsi React/Redux feature modules | One large custom meeting page plus hooks/components | Toowix has more custom page-level complexity to manage. |
| Product signalling | Jitsi mechanisms | Jitsi data channel + Toowix SSE stream + HTTP posts | SSE removes recurring receive polling; sending an actual chat/poll/action still needs one POST. |
| Server | JVB, Jicofo, Prosody, TURN, optional Jibri | Same Jitsi services plus Toowix backend | Same media services; Toowix backend owns product workflow. |

## Verified media-profile comparison

| Media item | Official Jitsi reference/default | Toowix production status | Assessment |
|---|---|---|---|
| Simulcast | Enabled unless `disableSimulcast` is set | `ENABLE_SIMULCAST=true`; `JICOFO_CONF_STRIP_SIMULCAST=false` | Explicitly aligned. Layer-selection must still be tested with real participants. |
| Last-N | `channelLastN: -1` by default; UI/policy can alter it | Unlimited in normal mode; limited only for explicit Low Data/Audio-only policies | Safe for small calls. A measured large-room policy is still needed. |
| TCC | Enabled by default | `ENABLE_TCC=true` | Aligned. |
| Opus RED | Optional feature | `ENABLE_OPUS_RED=true` | Enabled for resilience to isolated audio packet loss. |
| P2P | Usually enabled by default | `ENABLE_P2P=false` | Intentional difference: all calls use JVB for predictable routing and no two-person P2P transition. |
| TURN | Used when required by network traversal | Coturn retained as fallback | Correct design; JVB UDP remains preferred. |
| ICE restart | Optional runtime capability | Enabled, including mobile network-change support | Better resilience during Wi-Fi/mobile handover. |
| UDP receive buffers | Host-specific | JVB receives 10 MB; host max is 16 MB | Verified production improvement over the previous 212 KB limit. |
| Codecs | Browser-safe defaults, configurable policy | No speculative forced codec order | Correct until Chrome/Edge/Android/iPhone tests identify a justified policy. |
| Screen sharing | Separate video-quality handling | Capture limited by existing screen policy; effect does not force camera-quality oscillation | Requires real screen-share benchmark. |

## Browser work after optimization

| Work item | Current Toowix behavior | Why it exists | Remaining cost/risk |
|---|---|---|---|
| WebRTC telemetry | `getStats()` every 5 seconds | Connection status and diagnostics | Low, local-only; 12 samples/minute. |
| Microphone recovery | Checks for an ended mic track every 5 seconds; also checks after page visibility returns | iPhone/mobile audio-focus and Bluetooth recovery | Necessary reliability safeguard; should remain event-led where possible. |
| PiP canvas | 10 fps only while PiP is active | Custom PiP meeting layout | CPU/GPU work is isolated to active PiP. |
| Prejoin background | At most 10 startup retries | Wait for preview track setup | No permanent 600 ms loop. |
| Room signals | One SSE connection | Immediate chat/poll/reaction/hand updates | Must use sticky routing or shared pub/sub if backend later scales to multiple instances. |
| Waiting-room queue | 3-second moderator polling | Product workflow | Can later move to SSE using the same pattern. |
| Meeting-ended status | 10-second check | Product-state fallback | Small non-media HTTP cost; native Jitsi end action remains primary. |
| Virtual background | Dynamically imported only after user selects it | Optional visual feature | Still CPU/GPU heavy while enabled, by nature. |
| Noise suppression | Dynamically imported only after user enables it | Optional audio feature | Still CPU cost while enabled, by nature. |

## Production bundle comparison

The official Jitsi source was inspected but not built under identical deployment flags in this assessment, so there is no defensible official-Jitsi byte-for-byte bundle comparison.

Measured Toowix production build values:

| Toowix asset | Size | Gzip |
|---|---:|---:|
| Initial application bundle | 814.48 KB | 187.76 KB |
| On-demand meeting route | 245.63 KB | 57.58 KB |
| Virtual-background module | 20.14 KB | 7.04 KB |
| Noise-suppression module | 3.83 KB | 1.54 KB |

The initial bundle was previously 1,068.19 KB / 246.57 KB gzip. Route splitting reduced non-meeting initial JavaScript by 23.8%. A participant entering a meeting still downloads the meeting route, so this is principally an improvement for non-meeting pages and a cleaner loading boundary—not proof that meeting join bytes fell by 23.8%.

## What remains different from official Jitsi Meet

1. **Custom feature breadth.** Toowix's meeting page coordinates custom lobby, admission, attendance, chat persistence, signals, meetings/conversations, PiP, notifications, recordings, product settings, and moderators. Official Jitsi also has extensive features, but they are organised in long-lived upstream modules with broad production testing.
2. **Custom recovery/state paths.** Toowix has custom camera/microphone recovery, rejoin, background, and UI-sync paths because it owns its own meeting UI. They improve product behaviour but need careful lifecycle testing.
3. **Large-room Last-N policy.** Official Jitsi has mature UI/state integration for video-quality decisions. Toowix currently avoids automatic Last-N changes in normal calls; this is safe but not yet a measured large-room optimization policy.
4. **Codec/device policy.** Neither product should force advanced codecs blindly. Toowix has not yet collected the required iPhone/Android/desktop evidence to safely choose a product-specific preference order.
5. **Signal scaling.** SSE removes polling load on one backend instance. If the backend later runs multiple instances, its in-memory signal buffer/subscriber map must move to Redis/pub-sub or sticky session routing.

## Real performance answer

The code and server configuration now remove known unnecessary work and restore Jitsi as the normal quality controller. This should increase browser headroom and reduce API noise. It cannot guarantee that every network/device becomes "as fast as Jitsi" because actual quality depends on:

- participant upload/download capacity;
- packet loss, jitter, and RTT;
- whether direct JVB UDP or TURN is selected;
- phone/laptop encoder and decoder capacity;
- virtual background/noise suppression/screen-share usage;
- participant count and visible video count.

## Required proof test

Run the same test for Toowix and official Jitsi Meet:

```text
2 participants and 4 participants
desktop Ethernet, desktop Wi-Fi, Android, iPhone
normal Wi-Fi, weak Wi-Fi, mobile data, network handover
camera call, long call, screen share, virtual background, noise suppression

Record: join time, first audio/video time, RTT, jitter, packet loss,
available bitrate, sent/received resolution, FPS, CPU, ICE type,
reconnects, audio interruptions, and video interruptions.
```

Only this test can produce a valid numerical performance comparison.

## Bottom line

**Media foundation:** effectively the same Jitsi/WebRTC/JVB foundation.  
**Server media configuration:** closely aligned, with intentional JVB-only routing.  
**Browser overhead:** materially reduced, but Toowix still has more custom product-state code to maintain.  
**Largest next gain:** measure and tune large-room Last-N/visible-video behaviour and codec policy from real device data; do not guess values.


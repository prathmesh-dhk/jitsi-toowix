# Mobile meeting changes and verification

Local audit: 2026-09-22. Code changes are not equivalent to device acceptance.
No physical iPhone/Android or two-person conference was available for this run.

| Request | Code status | Remaining verification / limitation |
| --- | --- | --- |
| Mobile prejoin layout | Added stacked responsive layout, safe-area padding, readable inputs | Check portrait/landscape on devices |
| Remember name, mic, camera, devices | Existing local storage restoration retained | Browser/OS owns permission persistence; a website cannot promise no future prompts |
| iPhone backgrounds | Added muted inline processing video, safe dimensions and readiness guards | Actual Safari segmentation, blur support, image capture and performance unverified |
| Phone speaker option | Added mobile audio output action and playback resume | Uses output selection when available; OS volume and speaker/Bluetooth routing remain phone controls |
| Automatic device routing | Existing device-change detection; fixed applying fallback to active tracks | Verify headset pairing/unpairing; browsers may not expose device changes |
| Resume after phone call | Added foreground recovery attempt with fresh admission when disconnected and saved mute/video settings | OS may suspend/kill the page; ended mic tracks, fresh permissions, JWT refresh and actual call interruption require device tests |
| Phone screen capture | Existing menu gated on getDisplayMedia availability | Native phone screen capture cannot be added to an unsupported browser by JavaScript; native app work is separate |
| Phone stage and participant strip | Fixed speaker filmstrip mobile layout | Verify multiple video participants and shared screens |
| Every mobile page/action | Not fully audited | Requires navigation and interaction matrix across all pages and roles |
| Expired/rejoin lookup delay | Added parallel anonymous existence check before Firebase restoration | Network/server round-trip still required; not a zero-latency promise |
| Stop share without rejoin | Existing removal of forced reconnect confirmed in code | Verify browser Stop Sharing and app stop controls with remote participant |
| Data usage switch delay | Begin constraints immediately while effect cleanup runs | Media negotiation/keyframes still take time; rapid switching needs live tests |
| YouTube synchronization | Added 1-second owner heartbeat, ready-state application, 2-second drift threshold, inline playback | YouTube load/buffering, autoplay and network latency remain; test owner pause/seek and late join on devices |
| Poll chat and sound | Existing chat announcement, toast, notification sound confirmed | Verify delivery to remote mobile clients and audio permission |
| Performance controls | Apply receiver compatibility constraint, invalidate quality-policy cache; real audio-only mode | Verify actual bitrate/resolution and restoration live |
| Hand beside pin | Existing separate left positions confirmed | Visual device/desktop acceptance pending |
| Participant statistics | Use active participant membership instead of cached telemetry IDs | Verify joins/leaves and recorder visibility during a call |

## Acceptance sequence

Use dedicated test meetings and accounts on HTTPS. Join with desktop Chrome,
Android Chrome and iPhone Safari; record OS/browser versions. Do not use desktop
viewport emulation as proof of real mobile camera/OS behavior.

1. Open prejoin in both orientations, enter name, change devices/mute settings,
   leave and return. Check saved choices and the browser permission behavior.
2. Join from two devices. Verify participant stats show exactly the visible people,
   raise a hand and pin/unpin each participant, then switch stage/tile views.
3. Change background to blur/image/none; toggle camera repeatedly. Check both
   self-view and remote frames. Pair/disconnect Bluetooth and check real audio.
4. Receive a phone call, hang up, return to browser and verify recovery preserves
   mute state. Repeat with an expired meeting and one ended by the host: neither
   should admit the participant. Also test page suspension and network loss.
5. Start/stop desktop sharing from both browser and app controls. Assert no
   leave/join event and no frozen remote share. Test mobile capture only where
   the browser actually exposes support.
6. Switch data/quality settings and inspect actual stream stats. Share YouTube,
   pause, seek, resume and join late; note measured drift and loading times.
7. Create/vote on a poll and check remote chat, toast and sound. Exercise each
   mobile menu and dashboard/settings/RSVP/recording/share page.

Run `node scripts/test-website.cjs` for compilation and isolated regressions.
The script explicitly skips the device flows above; passing it does not certify
those flows or millisecond media/network latency.

# Performance test report

Date: 2026-09-18

| Test | Setup | Result |
| --- | --- | --- |
| Repository baseline inspection | Local checkout | PASS — documented in `PERFORMANCE_BASELINE.md`. |
| Installed lib-jitsi-meet API inspection | Local `node_modules/lib-jitsi-meet` | PASS — confirms `setLastN`, sender/receiver video constraints, desktop FPS, connection state, and active peer connection APIs. |
| TypeScript check | `npx tsc --noEmit` in `toowix-web-app` | PASS. |
| Adaptive static contract | `node tests/verify-network-quality.cjs` | PASS — verifies 2.5s sampling, hysteresis constants, the three user modes, supported Jitsi quality controls, and no desktop `replaceTrack`. |
| Production build | `npm run build` | BLOCKED — sandbox denied Vite/esbuild child-process execution; no workaround used. |
| Existing screen-share regression | `node tests/verify-screen-share-stop.cjs` with no local frontend/backend running | BLOCKED — test correctly failed with `fetch failed` before joining a meeting. |
| Two-participant browser test | Requires isolated target and Chrome | NOT RUN — start frontend/backend locally or use staging tunnel first. Expected: audio/video and adaptive state work with two users. |
| Four-participant browser test | Requires isolated target and Chrome | NOT RUN — requires four browser instances. Expected: Last-N limits received video without interrupting audio. |
| Fast 3G test | Chrome DevTools network shaping on isolated target | NOT RUN. Expected: DEGRADED state, 360p/Last-N 2, intelligible audio. |
| Slow 3G test | Chrome DevTools network shaping on isolated target | NOT RUN. Expected: POOR state, Last-N 1, audio preserved. |
| Packet-loss test | Linux `tc netem` or an approved network emulator on non-production target | NOT RUN. Expected: no rapid state flapping and recovery only after 10 seconds stable. |
| Screen-share repetition test | Existing script with local/staging services and Chrome | NOT RUN — service prerequisite absent. Expected: each viewer unmounts presentation after every stop. |
| Recording plus meeting | Approved idle staging Jibri target | NOT RUN. Expected: Jibri recording does not affect meeting connection or adaptive policy. |
| Mobile browser test | Physical device or mobile emulation target | NOT RUN. Expected: controls work and low-data preference persists. |

Production services were not restarted, redeployed, or modified. The prior server connection was
unavailable for this pass (SSH timeout), so live CPU/RAM/disk and Jitsi runtime configuration
remain unverified.

## Commands for blocked browser verification

Start the local services in separate terminals, then run:

```powershell
cd toowix-web-app
node tests/verify-screen-share-stop.cjs
```

For staging, use the existing tunnel described in
`toowix-web-app/tests/verify-lib-jitsi-audio-video.cjs`, then run the test against that isolated
target. Do not apply packet-loss shaping or load tests to production.

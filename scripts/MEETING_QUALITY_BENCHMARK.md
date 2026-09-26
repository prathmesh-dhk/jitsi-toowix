# Meeting Quality Benchmark

Run the same two-person scenario once on Toowix and once on official Jitsi Meet.

```powershell
node scripts/benchmark-meeting-quality.cjs run --product toowix --host "TOOWIX_HOST_MEETING_URL" --guest "TOOWIX_GUEST_MEETING_URL" --duration 180 --scenario "Chrome desktop Ethernet, camera, 2 participants"
node scripts/benchmark-meeting-quality.cjs run --product jitsi --host "JITSI_HOST_MEETING_URL" --guest "JITSI_GUEST_MEETING_URL" --duration 180 --scenario "Chrome desktop Ethernet, camera, 2 participants"
node scripts/benchmark-meeting-quality.cjs compare --toowix reports/benchmarks/TOOWIX.json --jitsi reports/benchmarks/JITSI.json
```

The script opens separate Chrome profiles for the two participants. Sign in, join the room, allow camera/microphone, enable camera and microphone, then press Enter in the terminal. It records browser WebRTC statistics once per second for the selected duration.

It records RTT, available outgoing bitrate, packet loss, video FPS, candidate types, connection interruptions, browser request count and long tasks. It does not capture media, chat text, authentication tokens, IP addresses or ICE credentials.

For a complete assessment repeat the test for desktop Ethernet, desktop Wi-Fi, Android, iPhone, weak Wi-Fi, mobile data, screen share, virtual background and noise suppression. Keep browser version, devices, participant count, media settings and duration equal for the Toowix and Jitsi runs. A comparison with mismatched scenarios is not a valid quality result.

# Toowix Meet performance baseline

Date: 2026-09-18

## Scope and evidence

This baseline was produced from the repository checkout. The running Jitsi stack was not
restarted or changed. Production host inspection was unavailable during this pass because SSH
to `192.168.22.59:22` timed out, so server-specific values below are explicitly marked as
unverified rather than inferred.

## Current frontend media flow

`MeetingRoomPage` obtains a single pre-join `MediaStream` through `useMediaPreview`. Once the
participant is admitted, `useJitsiMeeting` adopts that same stream using
`createLocalTracksFromMediaStreams`; it does not intentionally request a second camera or
microphone stream. If there is no preview stream, lib-jitsi-meet obtains local audio/video
tracks. The hook owns the Jitsi connection, conference, local tracks and remote Jitsi tracks;
the page renders the resulting `MediaStream` objects in its custom Toowix UI.

Remote tracks arrive through Jitsi `TRACK_ADDED`, are converted to streams, and are assigned to
audio/video elements. Dominant speaker and recorder state are conference events. The direct
lib-jitsi-meet integration is therefore the media owner; the React page is a renderer, not a
second WebRTC implementation.

## Current Jitsi and network flow

The browser loads `https://talk.toowix.com/config.js` and `/lib-jitsi-meet.min.js`, then creates
a `JitsiConnection` with the fetched configuration and JWT. The checked-in `config.js` is a
source/default configuration, not proof of the deployed configuration. Its relevant defaults are:

* P2P is enabled for exactly two participants.
* UDP and TCP ICE disabling flags are commented out, so source defaults preserve direct UDP.
* P2P uses `stun:meet-jit-si-turnrelay.jitsi.net:443` as a STUN server.
* `channelLastN` is `-1` (unlimited); `startLastN` is commented out.
* Preferred camera resolution and capture constraints are commented out, leaving Jitsi defaults
  (normally 720p).
* Simulcast remains enabled by default because `disableSimulcast` is not enabled.

The actual JVB, Jicofo, Prosody, TURN credentials and NAT advertisement values are external to
this checkout (`/opt/toowix/jitsi-stack` on the server) and must be inspected there before any
infrastructure change.

## Screen-sharing flow

Screen sharing is a separate Jitsi desktop track. `useJitsiMeeting` creates it with
`createLocalTracks({ devices: ['desktop'] })`, caps initial capture at 1920x1080, and publishes
it with `room.addTrack(desktopTrack)`. The camera remains a separate source. On browser-native
or Toowix stop, the hook clears the local view, removes/disposes the desktop track, and remote
clients clear presentation state on desktop `TRACK_MUTE_CHANGED` or `TRACK_REMOVED`. A dedicated
two-browser regression script exists at `toowix-web-app/tests/verify-screen-share-stop.cjs`.

The stop path uses `room.removeTrack(desktopTrack)` with a bounded timeout, followed by local
cleanup. It never replaces a desktop track with a camera track.

## Ports and routing

Known from repository configuration:

* Toowix frontend container: loopback `127.0.0.1:3001` to container port 3000.
* Toowix backend: port 4000.
* Public HTTPS/WSS and Jitsi BOSH/websocket ports, JVB UDP port, TURN UDP/TCP/TLS ports and
  external NAT addresses: unverified; inspect the live docker-jitsi-meet compose/env files.
* The local reverse proxy sends `/api/` to backend 4000 and Jitsi websocket/BOSH traffic to the
  Jitsi web service.

## Server and recording workload

The frontend is static nginx. The backend is a Node 20 Alpine container with FFmpeg installed.
Jibri is server-side and records through Jitsi; the browser does not canvas-capture recording
frames. The recording finalizer validates/processes a single Jibri output file. CPU, RAM, disk,
Jibri placement, and FFmpeg concurrency are unverified for the current server. If Jibri shares a
VM with JVB, recording can contend with bridge CPU and disk I/O; a separate Jibri worker is the
safe scaling path after measuring actual usage.

## Existing performance issues

* The meeting page polls signalling every 600 ms and live meeting status every second; this is
  expensive at scale and should ultimately move to WebSocket/SSE or long polling.
* Existing source configuration permits unlimited received videos (`channelLastN: -1`).
* `MeetingRoomPage.tsx` is a large stateful component; timers and panel changes can cause broad
  re-renders.
* PiP uses a 15 fps canvas compositor when enabled. It is opt-in and should remain off when not
  used; it must not be used to relay participant media.
* There was no application-level network state machine or user low-data control.

## Existing tests

* `toowix-web-app/tests/verify-screen-share-stop.cjs`: two-browser screen-share stop regression.
* `toowix-web-app/tests/verify-network-quality.cjs`: static adaptive-policy and desktop-track
  lifecycle guard.
* `toowix-web-app/tests/verify-jitsi-integration.cjs` and
  `verify-lib-jitsi-audio-video.cjs`: direct Jitsi integration checks.
* Recording test scripts include `recording-e2e.cjs` and `recording-live.cjs`.
* Upstream Jitsi browser/media tests exist under `tests/specs/media`, including Last-N and desktop
  sharing tests.

## Unsafe or duplicate handling found

No intentional duplicate camera/microphone capture was found in the main meeting route: the
pre-join stream is adopted by Jitsi. The screen stop path warrants regression testing because of
the historical `replaceTrack(desktopTrack, null)` workaround. No JWT, ICE, TURN, JVB, Jicofo,
Prosody, UDP, or server configuration has been changed by this analysis.

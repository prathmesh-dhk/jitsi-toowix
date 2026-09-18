# Low-network behavior

## States

The meeting client evaluates WebRTC statistics every 2.5 seconds and keeps raw samples in refs.
React state changes only when the connection state changes.

| State | Entry signal | Media policy |
| --- | --- | --- |
| GOOD | RTT <150 ms and loss <2% | Camera/receive cap 720p, normal Last-N (6; 4 for larger rooms), desktop up to 1080p. |
| DEGRADED | RTT 150-300 ms or loss 2-5% | Camera/receive cap 360p, Last-N 2, desktop FPS reduced. Audio remains active. |
| POOR | RTT >300 ms, loss >5%, very low upstream bitrate, or disconnected | Camera/receive cap 180p, Last-N 1, desktop FPS 5, visible limited-connection status. Audio remains active. |
| RECOVERING | 10 seconds of GOOD measurements after DEGRADED/POOR | Restore one conservative quality step, then wait for additional stable samples before GOOD. |

Thresholds are client constants so they can be tuned after collecting real diagnostic samples.
Missing statistics never force a user into POOR mode; disconnected/reconnecting states do.

## Low Data Mode

The user can choose **Auto**, **Low data**, or **Audio only** from the meeting menu. The choice is
persisted in browser local storage.

* Auto follows the network state machine.
* Low data caps camera/received video at 360p, limits remote video, uses 720p desktop capture for
  a future share, and clears local virtual backgrounds.
* Audio only keeps microphone audio and unsubscribes remote video. It mutes only the local camera
  track that the mode muted itself; leaving the mode restores it if the user did not independently
  change it.

Changing desktop resolution requires a new browser capture grant, so an active share is not
re-created automatically. The adaptive policy can safely lower its frame rate live; its resolution
policy applies the next time sharing starts.

## Server configuration policy

The production Jitsi config must be inspected before changing global Last-N. The frontend uses
the installed lib-jitsi-meet public `setLastN` API as a per-client receiver preference. A future
server config change may set `channelLastN: 6` and `startLastN: 4` after staging validation; use
4/2 for large-meeting profiles. Direct UDP remains preferred; TURN TCP/TLS remains fallback.

No configuration can guarantee zero lag on every network. The goal is intelligible audio and a
gradual, reversible reduction in video load.

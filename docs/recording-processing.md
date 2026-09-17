# Local recording processing

Toowix keeps recordings on a shared local volume. MongoDB stores recording
metadata only; the backend streams the local file through its existing
`GET /api/recordings/:id/stream` route.

## Flow

1. The browser calls `room.startRecording({ mode: "file" })`.
2. Jicofo assigns Jibri, and Jibri writes its encoded output through JVB.
3. The existing `RECORDER_STATE_CHANGED` path confirms the session ID. The
   browser stops recording with `room.stopRecording(recordingSessionId)`.
4. The finalizer waits for a stable `jibri-output.mp4`, validates it with
   ffprobe and an FFmpeg decode pass, and posts `Processing`.
5. FFmpeg writes `final.mp4.tmp` in the same session directory. The finalizer
   validates that temporary file, atomically renames it to `final.mp4`, and
   posts `Ready` only after the final file passes validation.
6. The backend stores `final.mp4` as the relative file and the existing Toowix
   API serves it with HTTP Range support.

The storage layout is:

```text
/storage/recordings/<recordingSessionId>/
  jibri-output.mp4
  final.mp4
  final.mp4.tmp          # transient; never used by the stream route
  processing.json
  processing.log
  processing.lock         # transient advisory lock
```

Invoke the worker with the explicit arguments:

```text
python3 /config/finalize-recording.py ROOM_SLUG RECORDING_SESSION_ID \
  /storage/recordings/RECORDING_SESSION_ID/jibri-output.mp4
```

The legacy one-directory invocation remains supported for an existing Jibri
hook, but new deployment wiring should pass all three arguments. The worker
uses one lock per session, so separate sessions can process concurrently while
duplicate attempts for one session are rejected. An interrupted attempt leaves
the source intact and a later retry can remove a stale temporary output and
resume. A valid existing final is revalidated and reused idempotently.

## FFmpeg command

With the defaults, the worker runs the equivalent of:

```text
ffmpeg -v error -nostdin -y -i jibri-output.mp4 \
  -map 0:v:0 -map 0:a:0 -c:v libx264 -preset medium -crf 23 \
  -vf "scale=w='min(iw,1920)':h=-2" \
  -c:a aac -b:a 192k -movflags +faststart final.mp4.tmp
```

`RECORDING_PROCESSING_ENABLED=false` still validates the source and copies it
to the temporary output before validation and atomic publication. The default
`RECORDING_KEEP_SOURCE=true` preserves Jibri output after success and always
preserves it after failure. Setting it to false removes the source only after
the Ready update succeeds.

## Environment variables

Required configuration has safe defaults:

| Variable | Default | Purpose |
| --- | --- | --- |
| `RECORDING_PROCESSING_ENABLED` | `true` | Re-encode, or copy when false |
| `RECORDING_ROOT` | `/storage/recordings` | Root allowed for all recording paths |
| `RECORDING_OUTPUT_DIR` | `.` | Output directory relative to the root |
| `RECORDING_PROCESSING_FFMPEG_PATH` | `ffmpeg` | FFmpeg executable |
| `RECORDING_VIDEO_CODEC` | `libx264` | Output video codec |
| `RECORDING_CRF` | `23` | Video quality/size setting |
| `RECORDING_PRESET` | `medium` | Encoder speed/quality tradeoff |
| `RECORDING_MAX_WIDTH` | `1920` | Maximum output width; `0` disables scaling |
| `RECORDING_AUDIO_CODEC` | `aac` | Output audio codec |
| `RECORDING_AUDIO_BITRATE` | `192k` | Output audio bitrate |
| `RECORDING_KEEP_SOURCE` | `true` | Retain `jibri-output.mp4` after success |

Operational tunables (`RECORDING_STABLE_CHECKS`,
`RECORDING_STABLE_CHECK_INTERVAL_SECONDS`,
`RECORDING_STABLE_TIMEOUT_SECONDS`, and `RECORDING_MIN_FREE_BYTES`) are also
documented in `toowix-backend/.env.example`. `RECORDING_INGEST_KEY` remains a
runtime secret shared by the worker and backend and is intentionally not given
a value here. The backend’s existing validation process names remain
`FFPROBE_PATH` and `FFMPEG_PATH`; configure those if its container does not
resolve the system binaries.

## Deployment and rollback

- Use a separate recording volume with enough free space for both source and
  output. The finalizer worker needs read/write access; the backend only needs
  read access to the same mount.
- Install the script and configure the Jibri finalize hook to invoke it. Do not
  start a second worker for the same session unless it uses the same volume and
  lock files.
- Build and deploy the backend/frontend during a maintenance window after
  confirming there are no active calls. This repository does not deploy to
  production automatically.
- For rollback, stop the finalizer worker, restore the previous script/backend
  image, and leave the recording volume untouched. Existing `final.mp4` files
  remain available; failed attempts retain `jibri-output.mp4` for retry.

This pipeline intentionally creates one mixed Jibri recording. True
per-participant recording or compositing is a future feature requiring a
separate recorder/track compositor and is not implemented here.

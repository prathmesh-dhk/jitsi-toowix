#!/usr/bin/env python3
"""Finalize one Jibri recording on the shared local recording volume.

The worker treats Jibri's file as an already-encoded source. It waits for the
source to stop changing, validates it, optionally re-encodes it to a
same-directory temporary file, validates that output, and atomically publishes
``final.mp4``. All paths are constrained to RECORDING_ROOT.

Preferred invocation::

    finalize-recording.py ROOM_SLUG RECORDING_SESSION_ID /recordings/session/jibri-output.mp4

The one-directory form (``finalize-recording.py /recordings/session``) remains
accepted for older Jibri hooks; it looks specifically for jibri-output.mp4,
then falls back to the sole MP4 in that directory.
"""

from __future__ import annotations

import argparse
import errno
import json
import os
import pathlib
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, Optional, Tuple

try:
    import fcntl  # Unix/Linux worker
except ImportError:  # pragma: no cover - used only by Windows-local development
    fcntl = None


SESSION_RE = r"^[A-Za-z0-9_-]{8,128}$"
DEFAULT_ROOT = "/storage/recordings"
DEFAULT_STABLE_CHECKS = 3
DEFAULT_STABLE_INTERVAL_SECONDS = 2.0
DEFAULT_STABLE_TIMEOUT_SECONDS = 15 * 60.0
DEFAULT_MIN_FREE_BYTES = 64 * 1024 * 1024


class FinalizationError(RuntimeError):
    """An expected, reportable finalization failure."""


def env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() not in {"0", "false", "no", "off"}


def env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except ValueError as exc:
        raise FinalizationError(f"{name} must be an integer") from exc


def env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, str(default)))
    except ValueError as exc:
        raise FinalizationError(f"{name} must be a number") from exc


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def ensure_inside(root: pathlib.Path, candidate: pathlib.Path, allow_root: bool = False) -> pathlib.Path:
    try:
        relative = candidate.resolve().relative_to(root.resolve())
    except ValueError as exc:
        raise FinalizationError("Recording path is outside RECORDING_ROOT") from exc
    if not allow_root and not relative.parts:
        raise FinalizationError("Recording path cannot be the recording root")
    return candidate.resolve()


def root_path() -> pathlib.Path:
    root = pathlib.Path(os.environ.get("RECORDING_ROOT", DEFAULT_ROOT)).expanduser().resolve()
    if not root.exists() or not root.is_dir():
        raise FinalizationError(f"Recording root does not exist or is not a directory: {root}")
    return root


def output_root(root: pathlib.Path) -> pathlib.Path:
    configured = os.environ.get("RECORDING_OUTPUT_DIR")
    if not configured:
        return root
    value = pathlib.Path(configured).expanduser()
    candidate = (root / value if not value.is_absolute() else value).resolve()
    ensure_inside(root, candidate, allow_root=True)
    if not candidate.exists() or not candidate.is_dir():
        raise FinalizationError(f"Recording output directory does not exist: {candidate}")
    return candidate


def validate_session_id(session_id: str) -> str:
    import re

    if not re.fullmatch(SESSION_RE, session_id):
        raise FinalizationError("Invalid recording session ID")
    return session_id


def relative_name(root: pathlib.Path, file_path: pathlib.Path) -> str:
    return file_path.resolve().relative_to(root.resolve()).as_posix()


def parse_probe(probe: Dict[str, Any], size_bytes: int) -> Dict[str, Any]:
    try:
        duration = float(probe.get("format", {}).get("duration", 0) or 0)
    except (TypeError, ValueError) as exc:
        raise FinalizationError("ffprobe returned an invalid duration") from exc
    streams = probe.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if size_bytes <= 0 or duration <= 0 or video is None or audio is None:
        raise FinalizationError("Completed recording must contain video, audio, and a positive duration")
    return {
        "durationSeconds": duration,
        "sizeBytes": size_bytes,
        "codec": str(video.get("codec_name") or "unknown"),
        "width": int(video.get("width") or 0),
        "height": int(video.get("height") or 0),
        "audioCodec": str(audio.get("codec_name") or "unknown"),
    }


def run_command(command: Iterable[str], timeout: float, log: pathlib.Path) -> subprocess.CompletedProcess:
    command_list = list(command)
    with log.open("a", encoding="utf-8") as stream:
        stream.write(f"\n$ {subprocess.list2cmdline(command_list)}\n")
        stream.flush()
        try:
            result = subprocess.run(
                command_list,
                stdout=stream,
                stderr=subprocess.STDOUT,
                timeout=timeout,
                check=False,
                stdin=subprocess.DEVNULL,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            stream.write(f"command failed: {exc}\n")
            raise FinalizationError(f"Command failed: {command_list[0]}") from exc
    if result.returncode != 0:
        raise FinalizationError(f"Command exited with status {result.returncode}: {command_list[0]}")
    return result


def probe_file(file_path: pathlib.Path, log: pathlib.Path) -> Dict[str, Any]:
    ffprobe = os.environ.get("RECORDING_PROCESSING_FFPROBE_PATH", os.environ.get("FFPROBE_PATH", "ffprobe"))
    command = [ffprobe, "-v", "error", "-show_format", "-show_streams", "-of", "json", str(file_path)]
    with log.open("a", encoding="utf-8") as stream:
        stream.write(f"\n$ {subprocess.list2cmdline(command)}\n")
        try:
            result = subprocess.run(
                command,
                stdout=subprocess.PIPE,
                stderr=stream,
                timeout=30,
                check=False,
                stdin=subprocess.DEVNULL,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            stream.write(f"ffprobe failed: {exc}\n")
            raise FinalizationError("ffprobe failed") from exc
    if result.returncode != 0:
        raise FinalizationError(f"ffprobe exited with status {result.returncode}")
    try:
        probe = json.loads(result.stdout.decode("utf-8"))
        return parse_probe(probe, file_path.stat().st_size)
    except (OSError, ValueError, TypeError, KeyError) as exc:
        raise FinalizationError("ffprobe returned invalid media metadata") from exc


def decode_validate(file_path: pathlib.Path, log: pathlib.Path) -> None:
    ffmpeg = os.environ.get("RECORDING_PROCESSING_FFMPEG_PATH", os.environ.get("FFMPEG_PATH", "ffmpeg"))
    run_command(
        [ffmpeg, "-v", "error", "-xerror", "-nostdin", "-i", str(file_path), "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-"],
        10 * 60,
        log,
    )


def inspect_media(file_path: pathlib.Path, log: pathlib.Path) -> Dict[str, Any]:
    if not file_path.exists() or not file_path.is_file():
        raise FinalizationError(f"Recording file is missing: {file_path}")
    before = file_path.stat()
    if before.st_size <= 0:
        raise FinalizationError("Recording file is empty")
    metadata = probe_file(file_path, log)
    decode_validate(file_path, log)
    after = file_path.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise FinalizationError("Recording file is still being written")
    metadata["sizeBytes"] = after.st_size
    return metadata


def wait_for_stable_file(file_path: pathlib.Path, _log: pathlib.Path) -> os.stat_result:
    checks = max(1, env_int("RECORDING_STABLE_CHECKS", DEFAULT_STABLE_CHECKS))
    interval = max(0.0, env_float("RECORDING_STABLE_CHECK_INTERVAL_SECONDS", DEFAULT_STABLE_INTERVAL_SECONDS))
    timeout = max(interval, env_float("RECORDING_STABLE_TIMEOUT_SECONDS", DEFAULT_STABLE_TIMEOUT_SECONDS))
    deadline = time.monotonic() + timeout
    previous: Optional[Tuple[int, int]] = None
    stable = 0
    while time.monotonic() <= deadline:
        try:
            stat = file_path.stat()
        except FileNotFoundError:
            stat = None
        if stat is not None and stat.st_size > 0:
            current = (stat.st_size, stat.st_mtime_ns)
            if current == previous:
                stable += 1
                if stable >= checks:
                    return stat
            else:
                previous = current
                stable = 1
        else:
            previous = None
            stable = 0
        time.sleep(interval)
    raise FinalizationError("Jibri output did not become a stable, non-empty file before timeout")


def check_disk_space(source: pathlib.Path) -> None:
    source_size = source.stat().st_size
    minimum_free = max(0, env_int("RECORDING_MIN_FREE_BYTES", DEFAULT_MIN_FREE_BYTES))
    required = source_size + max(source_size, minimum_free)
    free = shutil.disk_usage(source.parent).free
    if free < required:
        raise FinalizationError(f"Insufficient disk space: {free} bytes free, {required} required")


def processing_command(source: pathlib.Path, temporary: pathlib.Path, log: pathlib.Path) -> None:
    ffmpeg = os.environ.get("RECORDING_PROCESSING_FFMPEG_PATH", os.environ.get("FFMPEG_PATH", "ffmpeg"))
    if not env_bool("RECORDING_PROCESSING_ENABLED", True):
        temporary.unlink(missing_ok=True)
        shutil.copyfile(source, temporary)
        return

    video_codec = os.environ.get("RECORDING_VIDEO_CODEC", "libx264")
    crf = os.environ.get("RECORDING_CRF", "23")
    preset = os.environ.get("RECORDING_PRESET", "medium")
    max_width = env_int("RECORDING_MAX_WIDTH", 1920)
    audio_codec = os.environ.get("RECORDING_AUDIO_CODEC", "aac")
    audio_bitrate = os.environ.get("RECORDING_AUDIO_BITRATE", "192k")
    command = [
        ffmpeg,
        "-v", "error",
        "-nostdin",
        "-y",
        "-i", str(source),
        "-map", "0:v:0",
        "-map", "0:a:0",
        "-c:v", video_codec,
    ]
    if video_codec != "copy":
        command.extend(["-preset", preset, "-crf", crf])
        if max_width > 0:
            command.extend(["-vf", f"scale=w='min(iw,{max_width})':h=-2"])
    command.extend(["-c:a", audio_codec, "-b:a", audio_bitrate, "-movflags", "+faststart", str(temporary)])
    run_command(command, 60 * 60, log)


def remove_source_after_success(source: pathlib.Path, log: pathlib.Path) -> None:
    if env_bool("RECORDING_KEEP_SOURCE", True):
        return
    try:
        source.unlink()
    except OSError as exc:
        # The final has already been validated and reported Ready. A cleanup
        # failure must not turn a playable recording into a false failure.
        with log.open("a", encoding="utf-8") as stream:
            stream.write(f"{utc_now()} source cleanup skipped: {exc}\n")


def write_state(state_file: pathlib.Path, state: Dict[str, Any]) -> None:
    temporary = state_file.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(temporary, state_file)


class SessionLock:
    def __init__(self, lock_file, marker: Optional[pathlib.Path] = None):
        self.lock_file = lock_file
        self.marker = marker

    def release(self) -> None:
        if fcntl is not None:
            fcntl.flock(self.lock_file.fileno(), fcntl.LOCK_UN)
        else:  # pragma: no cover - Windows-local development fallback
            import msvcrt

            self.lock_file.seek(0)
            msvcrt.locking(self.lock_file.fileno(), msvcrt.LK_UNLCK, 1)
        self.lock_file.close()


def acquire_lock(lock_path: pathlib.Path) -> SessionLock:
    lock_file = lock_path.open("a+b")
    if fcntl is not None:
        try:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            lock_file.close()
            if exc.errno in (errno.EACCES, errno.EAGAIN):
                raise FinalizationError("Recording session is already being finalized") from exc
            raise
    else:  # pragma: no cover - Windows-local development fallback
        import msvcrt

        lock_file.write(b"0")
        lock_file.flush()
        lock_file.seek(0)
        try:
            msvcrt.locking(lock_file.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError as exc:
            lock_file.close()
            raise FinalizationError("Recording session is already being finalized") from exc
    return SessionLock(lock_file)


def read_ingest_key() -> str:
    key = os.environ.get("RECORDING_INGEST_KEY")
    if key:
        return key
    key_file = pathlib.Path(os.environ.get("RECORDING_INGEST_KEY_FILE", "/config/recording-ingest.key"))
    try:
        key = key_file.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise FinalizationError("RECORDING_INGEST_KEY or RECORDING_INGEST_KEY_FILE is required") from exc
    if not key:
        raise FinalizationError("Recording ingest key is empty")
    return key


def post_status(payload: Dict[str, Any], status: str, log: pathlib.Path, retries: int = 4) -> None:
    url = os.environ.get("RECORDING_BACKEND_URL", "http://toowix-backend:4000").rstrip("/") + "/api/recordings/ingest"
    body = json.dumps(dict(payload, status=status)).encode("utf-8")
    key = read_ingest_key()
    last_error: Optional[Exception] = None
    for attempt in range(retries):
        try:
            request = urllib.request.Request(
                url,
                data=body,
                headers={"Content-Type": "application/json", "Authorization": "Bearer " + key},
            )
            with urllib.request.urlopen(request, timeout=660) as response:
                response.read()
            with log.open("a", encoding="utf-8") as stream:
                stream.write(f"{utc_now()} {status}\n")
            return
        except (OSError, urllib.error.URLError, urllib.error.HTTPError) as exc:
            last_error = exc
            if attempt + 1 < retries:
                time.sleep(2 ** attempt)
    raise FinalizationError(f"Backend status update failed after {retries} attempts") from last_error


def locate_inputs(root: pathlib.Path, configured_output_root: pathlib.Path, args: list[str]) -> Tuple[str, str, pathlib.Path]:
    if len(args) == 3:
        room_slug, session_id, source_text = args
        source = pathlib.Path(source_text).expanduser().resolve()
    elif len(args) == 1:
        folder = pathlib.Path(args[0]).expanduser().resolve()
        ensure_inside(root, folder)
        session_id = folder.name
        preferred = folder / "jibri-output.mp4"
        candidates = [preferred] if preferred.exists() else sorted(folder.glob("*.mp4"))
        if len(candidates) != 1:
            raise FinalizationError("Expected exactly one Jibri MP4 in the recording directory")
        source = candidates[0].resolve()
        room_slug = source.stem.rsplit("_", 1)[0]
    else:
        raise FinalizationError("Usage: finalize-recording.py ROOM_SLUG RECORDING_SESSION_ID JIBRI_OUTPUT_PATH")

    validate_session_id(session_id)
    ensure_inside(root, source)
    session_dir = source.parent
    ensure_inside(configured_output_root, session_dir)
    if session_dir.name != session_id:
        raise FinalizationError("Jibri output must be inside the directory named by recordingSessionId")
    if source.name != "jibri-output.mp4":
        raise FinalizationError("Jibri output must be named jibri-output.mp4")
    if not room_slug or len(room_slug) > 255:
        raise FinalizationError("Invalid room slug")
    return room_slug, session_id, source


def finalize(room_slug: str, session_id: str, source: pathlib.Path, root: pathlib.Path) -> Dict[str, Any]:
    session_dir = source.parent
    final = session_dir / "final.mp4"
    temporary = session_dir / "final.mp4.tmp"
    state_file = session_dir / "processing.json"
    log = session_dir / "processing.log"
    lock = acquire_lock(session_dir / "processing.lock")
    relative_final = relative_name(root, final)
    payload = {
        "roomSlug": room_slug,
        "recordingSessionId": session_id,
        "relativeFile": relative_final,
        "fileUrl": relative_final,
        "sourceFile": relative_name(root, source),
        "processedFile": relative_final,
    }
    state: Dict[str, Any] = {
        "roomSlug": room_slug,
        "recordingSessionId": session_id,
        "sourceFile": payload["sourceFile"],
        "processedFile": payload["processedFile"],
        "status": "Processing",
        "processingStartedAt": utc_now(),
    }
    try:
        session_dir.mkdir(parents=True, exist_ok=True)
        write_state(state_file, state)
        post_status(payload, "Processing", log)

        # A valid final is the idempotent fast path. It is still re-probed and
        # decode-checked so a crash or manual replacement cannot be exposed.
        if final.exists():
            try:
                metadata = inspect_media(final, log)
                state.update(metadata, status="Ready", processingCompletedAt=utc_now())
                write_state(state_file, state)
                post_status(dict(payload, **metadata), "Ready", log)
                remove_source_after_success(source, log)
                return metadata
            except FinalizationError:
                final.unlink(missing_ok=True)

        wait_for_stable_file(source, log)
        check_disk_space(source)
        source_metadata = inspect_media(source, log)
        temporary.unlink(missing_ok=True)
        processing_command(source, temporary, log)
        if not temporary.exists() or temporary.stat().st_size <= 0:
            raise FinalizationError("FFmpeg did not create a non-empty temporary output")
        metadata = inspect_media(temporary, log)
        os.replace(temporary, final)
        try:
            metadata = inspect_media(final, log)
        except FinalizationError:
            final.unlink(missing_ok=True)
            raise
        state.update(metadata, sourceMetadata=source_metadata, status="Ready", processingCompletedAt=utc_now())
        write_state(state_file, state)
        post_status(dict(payload, **metadata), "Ready", log)
        remove_source_after_success(source, log)
        return metadata
    except Exception as exc:
        temporary.unlink(missing_ok=True)
        state.update(status="Failed", processingError=str(exc), processingCompletedAt=utc_now())
        try:
            write_state(state_file, state)
        except OSError:
            pass
        try:
            post_status(dict(payload, processingError=str(exc)), "Failed", log)
        except Exception as report_error:
            with log.open("a", encoding="utf-8") as stream:
                stream.write(f"{utc_now()} Failed status could not be reported: {report_error}\n")
        raise
    finally:
        lock.release()


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("recording_args", nargs="+")
    parsed = parser.parse_args(argv)
    try:
        root = root_path()
        configured_output_root = output_root(root)
        room_slug, session_id, source = locate_inputs(root, configured_output_root, parsed.recording_args)
        metadata = finalize(room_slug, session_id, source, root)
        print(json.dumps(dict(recordingSessionId=session_id, status="Ready", **metadata)), flush=True)
        return 0
    except Exception as exc:
        print(f"finalization failed: {exc}", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

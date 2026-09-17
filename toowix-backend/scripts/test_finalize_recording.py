import importlib.util
import os
import pathlib
import shutil
import unittest
from unittest.mock import patch


SCRIPT = pathlib.Path(__file__).with_name("finalize-recording.py")
SPEC = importlib.util.spec_from_file_location("finalize_recording", SCRIPT)
FINALIZER = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(FINALIZER)


METADATA = {
    "durationSeconds": 4.0,
    "sizeBytes": 12,
    "codec": "h264",
    "width": 640,
    "height": 360,
    "audioCodec": "aac",
}


class FinalizerTests(unittest.TestCase):
    def setUp(self):
        self.root = SCRIPT.parents[2] / ".recording-test-tmp"
        shutil.rmtree(self.root, ignore_errors=True)
        self.root.mkdir()
        self.session = self.root / "session-1234"
        self.session.mkdir()
        self.source = self.session / "jibri-output.mp4"
        self.source.write_bytes(b"source-media")
        self.environment = patch.dict(os.environ, {
            "RECORDING_ROOT": str(self.root),
            "RECORDING_OUTPUT_DIR": ".",
            "RECORDING_STABLE_CHECKS": "2",
            "RECORDING_STABLE_CHECK_INTERVAL_SECONDS": "0",
            "RECORDING_STABLE_TIMEOUT_SECONDS": "1",
            "RECORDING_MIN_FREE_BYTES": "0",
            "RECORDING_INGEST_KEY": "test-key",
        }, clear=False)
        self.environment.start()

    def tearDown(self):
        self.environment.stop()
        shutil.rmtree(self.root, ignore_errors=True)

    def test_stable_file_detects_size_and_mtime(self):
        stat = FINALIZER.wait_for_stable_file(self.source, self.session / "processing.log")
        self.assertEqual(stat.st_size, len(b"source-media"))

    def test_path_traversal_and_wrong_source_name_are_rejected(self):
        with self.assertRaises(FINALIZER.FinalizationError):
            FINALIZER.locate_inputs(self.root, self.root, ["room", "session-1234", str(self.root.parent / "outside.mp4")])
        wrong = self.session / "other.mp4"
        wrong.write_bytes(b"x")
        with self.assertRaises(FINALIZER.FinalizationError):
            FINALIZER.locate_inputs(self.root, self.root, ["room", "session-1234", str(wrong)])

    def test_success_is_atomic_and_preserves_source(self):
        statuses = []

        def copy_to_temp(source, temporary, _log):
            temporary.write_bytes(source.read_bytes() + b"-processed")

        with patch.object(FINALIZER, "post_status", side_effect=lambda payload, status, log: statuses.append(status)), \
                patch.object(FINALIZER, "inspect_media", return_value=METADATA), \
                patch.object(FINALIZER, "check_disk_space"), \
                patch.object(FINALIZER, "processing_command", side_effect=copy_to_temp):
            result = FINALIZER.finalize("room", "session-1234", self.source, self.root)

        self.assertEqual(result, METADATA)
        self.assertEqual(statuses, ["Processing", "Ready"])
        self.assertEqual((self.session / "final.mp4").read_bytes(), b"source-media-processed")
        self.assertFalse((self.session / "final.mp4.tmp").exists())
        self.assertTrue(self.source.exists())
        self.assertIn('"status": "Ready"', (self.session / "processing.json").read_text(encoding="utf-8"))

    def test_ffmpeg_failure_reports_failed_and_preserves_source(self):
        statuses = []
        with patch.object(FINALIZER, "post_status", side_effect=lambda payload, status, log: statuses.append(status)), \
                patch.object(FINALIZER, "inspect_media", return_value=METADATA), \
                patch.object(FINALIZER, "check_disk_space"), \
                patch.object(FINALIZER, "processing_command", side_effect=FINALIZER.FinalizationError("FFmpeg failed")):
            with self.assertRaises(FINALIZER.FinalizationError):
                FINALIZER.finalize("room", "session-1234", self.source, self.root)

        self.assertEqual(statuses, ["Processing", "Failed"])
        self.assertTrue(self.source.exists())
        self.assertFalse((self.session / "final.mp4").exists())
        self.assertFalse((self.session / "final.mp4.tmp").exists())

    def test_existing_valid_final_is_idempotent(self):
        final = self.session / "final.mp4"
        final.write_bytes(b"already-final")
        statuses = []
        with patch.object(FINALIZER, "post_status", side_effect=lambda payload, status, log: statuses.append(status)), \
                patch.object(FINALIZER, "inspect_media", return_value=METADATA), \
                patch.object(FINALIZER, "processing_command") as process:
            FINALIZER.finalize("room", "session-1234", self.source, self.root)
        process.assert_not_called()
        self.assertEqual(statuses, ["Processing", "Ready"])
        self.assertTrue(final.exists())

    def test_duplicate_processing_is_rejected_by_session_lock(self):
        lock = FINALIZER.acquire_lock(self.session / "processing.lock")
        try:
            with self.assertRaises(FINALIZER.FinalizationError):
                FINALIZER.finalize("room", "session-1234", self.source, self.root)
        finally:
            lock.release()


if __name__ == "__main__":
    unittest.main()

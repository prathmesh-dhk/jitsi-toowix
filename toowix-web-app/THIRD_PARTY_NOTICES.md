# Third-party notices

This file lists third-party libraries and model assets vendored/self-hosted in this app whose
license terms aren't already covered by `package.json`'s ordinary npm dependency tracking, or
that carry an inferred (not explicitly stated) license worth recording.

## @mediapipe/tasks-vision (npm package)

- Version: `1.0.1` (pinned exactly in `package.json`)
- License: Apache License 2.0
- Source: https://www.npmjs.com/package/@mediapipe/tasks-vision
- Self-hosted at: `public/libs/mediapipe/wasm/` (byte-for-byte copy of the package's own `wasm/`
  folder, required unrenamed by `FilesetResolver`). Verified at build time by
  `scripts/verify-mediapipe-assets.cjs`.

## selfie_segmenter_landscape.tflite (MediaPipe model)

- Source: `https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/latest/selfie_segmenter_landscape.tflite`
- Pinned to Google Cloud Storage generation: `1683436452396689` (locks this exact immutable
  file even if the `latest` alias in the URL above later points elsewhere)
- Self-hosted at: `public/libs/mediapipe/selfie_segmenter_landscape.tflite`
- Size: 250,177 bytes
- SHA-256: `490e9ea734313e0de10fa0cd9e3c6133e36ea4db2b7a49bde9ef019f72796b8e`
- License: **Inferred** as Apache License 2.0 -- the model is distributed from the
  `google-ai-edge/mediapipe` GitHub repository, whose top-level `LICENSE` file is Apache-2.0, and
  no model-card page found stated a separate or different license for this specific file. This is
  an inference, not a license statement found directly on the model itself; revisit if Google
  publishes explicit per-model licensing terms that say otherwise.

## selfie_segmentation_landscape.tflite (existing V1 TFLite model, unchanged)

- Self-hosted at: `public/libs/selfie_segmentation_landscape.tflite`
- Predates this notices file; recorded here for completeness. Same model family/license
  inference as above (Apache-2.0, inferred from the MediaPipe repo).

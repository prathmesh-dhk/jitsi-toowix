#!/usr/bin/env bash
set -e

echo "==> Initializing libs directory"
rm -rf libs
mkdir -p libs

echo "==> Building CSS"
npx sass css/main.scss css/all.bundle.css
npx cleancss --skip-rebase css/all.bundle.css > css/all.css
rm -f css/all.bundle.css

echo "==> Copying assets"
cp node_modules/@jitsi/rnnoise-wasm/dist/rnnoise.wasm libs/
cp react/features/stream-effects/virtual-background/vendor/tflite/*.wasm libs/
cp react/features/stream-effects/virtual-background/vendor/models/*.tflite libs/
mkdir -p libs/mediapipe-segmentation
cp -f node_modules/@mediapipe/selfie_segmentation/selfie_segmentation* libs/mediapipe-segmentation/
cp node_modules/lib-jitsi-meet/dist/umd/lib-jitsi-meet.* libs/
cp node_modules/@matrix-org/olm/olm.wasm libs/
cp node_modules/@tensorflow/tfjs-backend-wasm/dist/*.wasm libs/
mkdir -p libs/excalidraw
cp -R node_modules/@jitsi/excalidraw/dist/dev/fonts libs/excalidraw/
cp node_modules/@vladmandic/human-models/models/blazeface-front.bin libs/
cp node_modules/@vladmandic/human-models/models/blazeface-front.json libs/
cp node_modules/@vladmandic/human-models/models/emotion.bin libs/
cp node_modules/@vladmandic/human-models/models/emotion.json libs/

echo "==> Assets and CSS preparation completed successfully"

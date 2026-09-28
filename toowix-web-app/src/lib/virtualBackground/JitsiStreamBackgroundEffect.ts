// Trimmed port of jitsi-meet's JitsiStreamBackgroundEffect.ts -- V1 engine only (main-thread
// TFLite WASM inference + Canvas 2D compositing + a Worker-driven frame timer). The upstream
// file also has a V2 engine (Worker-based TF.js/WebGL/insertable-streams with device-tier
// detection) which needs several more files and two extra npm packages -- left out here to keep
// this feature light; V1 is the same engine jitsi-meet itself shipped with for years.
import {
  CLEAR_TIMEOUT,
  SET_TIMEOUT,
  TIMEOUT_TICK,
  timerWorkerScript
} from './TimerWorker';

export const VIRTUAL_BACKGROUND_TYPE = {
  BLUR: 'blur',
  IMAGE: 'image',
  NONE: 'none'
} as const;

export interface IVirtualBackground {
  backgroundType: 'blur' | 'image' | 'none';
  blurValue?: number;
  virtualSource?: string;
}

const SEG_WIDTH = 256;
const SEG_HEIGHT = 144;

// Segmentation always runs at the small fixed size above, but compositing (drawing the mask +
// sharp foreground + blurred/image background together) happens at full camera resolution every
// frame -- CPU work that scales with pixel count. Camera capture can now request up to 4K/1080p,
// and rendering/encoding a background effect at that size every frame is what caused dropped
// frames (visible as flicker and softer video) once capture stopped being hard-capped at 720p.
// 720p keeps this real-time on ordinary hardware; useJitsiMeeting lowers it further to match the
// same network-driven cap the rest of the call's video quality follows (setMaxOutputHeight).
const DEFAULT_MAX_OUTPUT_HEIGHT = 720;

// How much of the previous frame's mask carries into this one (0 = no smoothing, 1 = frozen).
// A raw per-frame mask has no memory, so the silhouette edge jitters/fluctuates independently every
// frame -- most visible exactly when moving, which is when the low-res (256x144) segmentation model
// is least stable frame to frame. 0.3 was tried and wasn't enough to stop that jitter; the edge lag
// this trades in return is a few frames (~100ms at 30fps) and isn't perceptible at normal speed.
const MASK_TEMPORAL_SMOOTHING = 0.6;

export default class JitsiStreamBackgroundEffect {
  _inputVideoElement: HTMLVideoElement;
  _maskFrameTimerWorker: Worker | null = null;
  _model: any;
  _options: { height: number; virtualBackground: IVirtualBackground; width: number };
  _outputCanvasCtx: CanvasRenderingContext2D | null = null;
  _outputCanvasElement: HTMLCanvasElement;
  _segmentationMask!: ImageData;
  _segmentationMaskCanvas: HTMLCanvasElement | null = null;
  _segmentationMaskCtx: CanvasRenderingContext2D | null = null;
  _segmentationPixelCount: number;
  _stream: MediaStream | null = null;
  _virtualImage!: HTMLImageElement;
  _blurCanvas = document.createElement('canvas');
  _sourceTrack: MediaStreamTrack | null = null;
  _lastPlaybackError = '';
  _frameErrorReported = false;
  _maxOutputHeight = DEFAULT_MAX_OUTPUT_HEIGHT;
  _smoothedMask: Float32Array | null = null;
  _resumeInput = () => {
    if (!this._stream || document.hidden) return;
    void this._inputVideoElement.play().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== this._lastPlaybackError) {
        console.warn('[VirtualBackground] Camera playback could not resume:', message);
        this._lastPlaybackError = message;
      }
    });
  };

  constructor(model: any, virtualBackground: IVirtualBackground) {
    // Workaround for a Firefox issue (https://bugzilla.mozilla.org/show_bug.cgi?id=1388974):
    // a canvas needs its context requested once before captureStream() works reliably.
    this._outputCanvasElement = document.createElement('canvas');
    this._outputCanvasElement.getContext('2d');
    this._inputVideoElement = document.createElement('video');
    this._inputVideoElement.muted = true;
    this._inputVideoElement.playsInline = true;
    this._inputVideoElement.setAttribute('playsinline', '');
    this._inputVideoElement.setAttribute('webkit-playsinline', '');

    this._options = { height: SEG_HEIGHT, virtualBackground, width: SEG_WIDTH };
    this._model = model;
    this._segmentationPixelCount = SEG_WIDTH * SEG_HEIGHT;

    if (virtualBackground.backgroundType === VIRTUAL_BACKGROUND_TYPE.IMAGE) {
      this._virtualImage = document.createElement('img');
      this._virtualImage.crossOrigin = 'anonymous';
      this._virtualImage.src = virtualBackground.virtualSource ?? '';
    }
  }

  isEnabled(jitsiLocalTrack: any) {
    return jitsiLocalTrack.isVideoTrack() && jitsiLocalTrack.videoType === 'camera';
  }

  // Lets the caller (useJitsiMeeting's network-quality effect) lower or raise the rendered/
  // encoded output resolution to match the same call-size/network-state cap the rest of the
  // call's video quality already follows -- so a background effect on a weak connection or a
  // large call renders less, instead of always paying full 720p compositing cost regardless.
  setMaxOutputHeight(height: number) {
    this._maxOutputHeight = Math.max(90, Math.round(height) || DEFAULT_MAX_OUTPUT_HEIGHT);
  }

  // Scales (nativeWidth, nativeHeight) down to fit within _maxOutputHeight, preserving aspect
  // ratio. Never scales up -- a camera already at or under the cap renders at its own resolution.
  _getOutputSize(nativeWidth: number, nativeHeight: number): { height: number; width: number } {
    const scale = Math.min(1, this._maxOutputHeight / (nativeHeight || this._maxOutputHeight));

    return {
      height: Math.max(1, Math.round(nativeHeight * scale)),
      width: Math.max(1, Math.round(nativeWidth * scale))
    };
  }

  startEffect(stream: MediaStream): MediaStream {
    this.stopEffect();
    const firstVideoTrack = stream.getVideoTracks()[0];
    if (!firstVideoTrack || firstVideoTrack.readyState === 'ended') {
      throw new Error('Turn on your camera before applying a background.');
    }
    if (typeof this._outputCanvasElement.captureStream !== 'function') {
      throw new Error('Background effects are not supported in this browser.');
    }
    this._stream = stream;
    this._lastPlaybackError = '';
    this._frameErrorReported = false;
    this._smoothedMask = null;
    this._sourceTrack = firstVideoTrack;
    const settings = firstVideoTrack.getSettings ? firstVideoTrack.getSettings() : firstVideoTrack.getConstraints();
    const { height, frameRate, width } = settings as any;
    const nativeWidth = Number(width) || 640;
    const nativeHeight = Number(height) || 360;
    const output = this._getOutputSize(nativeWidth, nativeHeight);

    this._outputCanvasElement.width = output.width;
    this._outputCanvasElement.height = output.height;
    this._outputCanvasCtx = this._outputCanvasElement.getContext('2d');
    // The <video> element's own box is kept at the camera's NATIVE size (not the capped output)
    // so segmentation (resizeSource) always samples the full picture; only the final composite
    // draws are scaled down to the capped output size.
    this._inputVideoElement.width = nativeWidth;
    this._inputVideoElement.height = nativeHeight;
    this._inputVideoElement.autoplay = true;
    this._inputVideoElement.srcObject = stream;
    document.addEventListener('visibilitychange', this._resumeInput);
    window.addEventListener('pageshow', this._resumeInput);
    firstVideoTrack.addEventListener('unmute', this._resumeInput);
    this._resumeInput();

    this._segmentationMask = new ImageData(this._options.width, this._options.height);
    this._segmentationMaskCanvas = document.createElement('canvas');
    this._segmentationMaskCanvas.width = this._options.width;
    this._segmentationMaskCanvas.height = this._options.height;
    this._segmentationMaskCtx = this._segmentationMaskCanvas.getContext('2d');

    this._startTimerLoop();

    return this._outputCanvasElement.captureStream(parseInt(String(frameRate), 10) || 30);
  }

  stopEffect() {
    this._stopTimerLoop();
    document.removeEventListener('visibilitychange', this._resumeInput);
    window.removeEventListener('pageshow', this._resumeInput);
    this._sourceTrack?.removeEventListener('unmute', this._resumeInput);
    this._sourceTrack = null;
    this._stream = null;
    this._inputVideoElement.onloadeddata = null;
    this._inputVideoElement.pause();
    this._inputVideoElement.srcObject = null;
  }

  _startTimerLoop() {
    this._maskFrameTimerWorker = new Worker(timerWorkerScript, { name: 'VirtualBackground timer' });
    this._maskFrameTimerWorker.onmessage = (response: MessageEvent) => {
      if (response.data.id === TIMEOUT_TICK) {
        try {
          this._renderMask();
        } catch (error) {
          // A transient draw failure must not permanently kill the frame loop.
          if (!this._frameErrorReported) {
            console.warn('[VirtualBackground] Frame processing failed:', error);
            this._frameErrorReported = true;
          }
        } finally {
          this._maskFrameTimerWorker?.postMessage({ id: SET_TIMEOUT, timeMs: 1000 / 30 });
        }
      }
    };

    // Poll readiness too: loadeddata alone may not fire again after a mobile interruption.
    this._maskFrameTimerWorker.postMessage({ id: SET_TIMEOUT, timeMs: 1000 / 30 });
  }

  _stopTimerLoop() {
    if (this._maskFrameTimerWorker) {
      this._maskFrameTimerWorker.postMessage({ id: CLEAR_TIMEOUT });
      this._maskFrameTimerWorker.terminate();
      this._maskFrameTimerWorker = null;
    }
  }

  runPostProcessing() {
    const track = this._stream?.getVideoTracks()[0];

    if (!track || !this._outputCanvasCtx) {
      return;
    }
    const settings = track.getSettings ? track.getSettings() : track.getConstraints();
    const { height, width } = settings as any;
    const { backgroundType } = this._options.virtualBackground;

    const nativeWidth = this._inputVideoElement.videoWidth || Number(width) || 640;
    const nativeHeight = this._inputVideoElement.videoHeight || Number(height) || 360;
    this._inputVideoElement.width = nativeWidth;
    this._inputVideoElement.height = nativeHeight;

    const { width: outWidth, height: outHeight } = this._getOutputSize(nativeWidth, nativeHeight);
    if (this._outputCanvasElement.height !== outHeight) this._outputCanvasElement.height = outHeight;
    if (this._outputCanvasElement.width !== outWidth) this._outputCanvasElement.width = outWidth;
    this._outputCanvasCtx.globalCompositeOperation = 'copy';

    // Draw the (blurred-edge) segmentation mask, scaled to the (possibly capped) output size.
    const supportsFilter = 'filter' in this._outputCanvasCtx;
    if (supportsFilter) this._outputCanvasCtx.filter = backgroundType === VIRTUAL_BACKGROUND_TYPE.IMAGE ? 'blur(4px)' : 'blur(8px)';
    this._outputCanvasCtx.drawImage(
        // @ts-ignore
        this._segmentationMaskCanvas,
        0, 0, this._options.width, this._options.height,
        0, 0, outWidth, outHeight
    );
    this._outputCanvasCtx.globalCompositeOperation = 'source-in';
    if (supportsFilter) this._outputCanvasCtx.filter = 'none';

    // Draw the sharp foreground (you) on top, masked by the alpha channel above -- scaled from
    // the camera's native resolution down to the (possibly capped) output size.
    // @ts-ignore
    this._outputCanvasCtx.drawImage(this._inputVideoElement, 0, 0, nativeWidth, nativeHeight, 0, 0, outWidth, outHeight);

    // Draw the background behind everything else.
    this._outputCanvasCtx.globalCompositeOperation = 'destination-over';
    if (backgroundType === VIRTUAL_BACKGROUND_TYPE.IMAGE) {
      this._outputCanvasCtx.drawImage(this._virtualImage, 0, 0, outWidth, outHeight);
    } else if (supportsFilter) {
      this._outputCanvasCtx.filter = `blur(${this._options.virtualBackground.blurValue}px)`;
      // @ts-ignore
      this._outputCanvasCtx.drawImage(this._inputVideoElement, 0, 0, nativeWidth, nativeHeight, 0, 0, outWidth, outHeight);
    } else {
      // Safari versions without Canvas2D.filter: approximate blur by downsampling
      // and smoothing the background only. The masked foreground remains sharp.
      const scale = Math.max(8, this._options.virtualBackground.blurValue || 8);
      const bWidth = Math.max(1, Math.round(outWidth / scale));
      const bHeight = Math.max(1, Math.round(outHeight / scale));
      if (this._blurCanvas.width !== bWidth) this._blurCanvas.width = bWidth;
      if (this._blurCanvas.height !== bHeight) this._blurCanvas.height = bHeight;
      const context = this._blurCanvas.getContext('2d');
      if (context) {
        context.drawImage(this._inputVideoElement, 0, 0, nativeWidth, nativeHeight, 0, 0, bWidth, bHeight);
        this._outputCanvasCtx.imageSmoothingEnabled = true;
        this._outputCanvasCtx.drawImage(this._blurCanvas, 0, 0, outWidth, outHeight);
      }
    }
  }

  runInference() {
    this._model._runInference();
    const outputMemoryOffset = this._model._getOutputMemoryOffset() / 4;

    if (!this._smoothedMask || this._smoothedMask.length !== this._segmentationPixelCount) {
      this._smoothedMask = new Float32Array(this._segmentationPixelCount);
    }
    for (let i = 0; i < this._segmentationPixelCount; i++) {
      const person = this._model.HEAPF32[outputMemoryOffset + i];
      // Blend toward the previous frame's value instead of using this frame's raw mask directly
      // -- see MASK_TEMPORAL_SMOOTHING above for why (reduces edge flicker on movement).
      const smoothed = (this._smoothedMask[i] * MASK_TEMPORAL_SMOOTHING) + (person * (1 - MASK_TEMPORAL_SMOOTHING));

      this._smoothedMask[i] = smoothed;
      this._segmentationMask.data[(i * 4) + 3] = 255 * smoothed;
    }
    this._segmentationMaskCtx?.putImageData(this._segmentationMask, 0, 0);
  }

  _renderMask() {
    // iOS may suspend capture while the tab is hidden or another app owns the camera.
    // Keep the last valid frame instead of segmenting a black/muted source into background-only video.
    if (document.hidden || !this._sourceTrack || this._sourceTrack.muted
      || !this._sourceTrack.enabled || this._sourceTrack.readyState !== 'live') return;
    if (this._inputVideoElement.readyState < 2) return;
    if (this._options.virtualBackground.backgroundType === VIRTUAL_BACKGROUND_TYPE.IMAGE
      && (!this._virtualImage.complete || !this._virtualImage.naturalWidth)) return;
    this.resizeSource();
    this.runInference();
    this.runPostProcessing();
  }

  resizeSource() {
    this._segmentationMaskCtx?.drawImage(
        // @ts-ignore
        this._inputVideoElement,
        0, 0, this._inputVideoElement.width, this._inputVideoElement.height,
        0, 0, this._options.width, this._options.height
    );

    const imageData = this._segmentationMaskCtx?.getImageData(0, 0, this._options.width, this._options.height);
    const inputMemoryOffset = this._model._getInputMemoryOffset() / 4;

    for (let i = 0; i < this._segmentationPixelCount; i++) {
      this._model.HEAPF32[inputMemoryOffset + (i * 3)] = Number(imageData?.data[i * 4]) / 255;
      this._model.HEAPF32[inputMemoryOffset + (i * 3) + 1] = Number(imageData?.data[(i * 4) + 1]) / 255;
      this._model.HEAPF32[inputMemoryOffset + (i * 3) + 2] = Number(imageData?.data[(i * 4) + 2]) / 255;
    }
  }
}

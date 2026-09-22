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
    this._sourceTrack = firstVideoTrack;
    const settings = firstVideoTrack.getSettings ? firstVideoTrack.getSettings() : firstVideoTrack.getConstraints();
    const { height, frameRate, width } = settings as any;

    this._outputCanvasElement.width = Number(width) || 640;
    this._outputCanvasElement.height = Number(height) || 360;
    this._outputCanvasCtx = this._outputCanvasElement.getContext('2d');
    this._inputVideoElement.width = this._outputCanvasElement.width;
    this._inputVideoElement.height = this._outputCanvasElement.height;
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

    const frameWidth = this._inputVideoElement.videoWidth || Number(width) || 640;
    const frameHeight = this._inputVideoElement.videoHeight || Number(height) || 360;
    this._inputVideoElement.width = frameWidth;
    this._inputVideoElement.height = frameHeight;
    if (this._outputCanvasElement.height !== frameHeight) this._outputCanvasElement.height = frameHeight;
    if (this._outputCanvasElement.width !== frameWidth) this._outputCanvasElement.width = frameWidth;
    this._outputCanvasCtx.globalCompositeOperation = 'copy';

    // Draw the (blurred-edge) segmentation mask.
    const supportsFilter = 'filter' in this._outputCanvasCtx;
    if (supportsFilter) this._outputCanvasCtx.filter = backgroundType === VIRTUAL_BACKGROUND_TYPE.IMAGE ? 'blur(4px)' : 'blur(8px)';
    this._outputCanvasCtx.drawImage(
        // @ts-ignore
        this._segmentationMaskCanvas,
        0, 0, this._options.width, this._options.height,
        0, 0, this._inputVideoElement.width, this._inputVideoElement.height
    );
    this._outputCanvasCtx.globalCompositeOperation = 'source-in';
    if (supportsFilter) this._outputCanvasCtx.filter = 'none';

    // Draw the sharp foreground (you) on top, masked by the alpha channel above.
    // @ts-ignore
    this._outputCanvasCtx.drawImage(this._inputVideoElement, 0, 0);

    // Draw the background behind everything else.
    this._outputCanvasCtx.globalCompositeOperation = 'destination-over';
    if (backgroundType === VIRTUAL_BACKGROUND_TYPE.IMAGE) {
      this._outputCanvasCtx.drawImage(
          this._virtualImage, 0, 0, this._outputCanvasElement.width, this._outputCanvasElement.height
      );
    } else if (supportsFilter) {
      this._outputCanvasCtx.filter = `blur(${this._options.virtualBackground.blurValue}px)`;
      // @ts-ignore
      this._outputCanvasCtx.drawImage(this._inputVideoElement, 0, 0);
    } else {
      // Safari versions without Canvas2D.filter: approximate blur by downsampling
      // and smoothing the background only. The masked foreground remains sharp.
      const scale = Math.max(8, this._options.virtualBackground.blurValue || 8);
      const width = Math.max(1, Math.round(frameWidth / scale));
      const height = Math.max(1, Math.round(frameHeight / scale));
      if (this._blurCanvas.width !== width) this._blurCanvas.width = width;
      if (this._blurCanvas.height !== height) this._blurCanvas.height = height;
      const context = this._blurCanvas.getContext('2d');
      if (context) {
        context.drawImage(this._inputVideoElement, 0, 0, width, height);
        this._outputCanvasCtx.imageSmoothingEnabled = true;
        this._outputCanvasCtx.drawImage(this._blurCanvas, 0, 0, frameWidth, frameHeight);
      }
    }
  }

  runInference() {
    this._model._runInference();
    const outputMemoryOffset = this._model._getOutputMemoryOffset() / 4;

    for (let i = 0; i < this._segmentationPixelCount; i++) {
      const person = this._model.HEAPF32[outputMemoryOffset + i];

      this._segmentationMask.data[(i * 4) + 3] = 255 * person;
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

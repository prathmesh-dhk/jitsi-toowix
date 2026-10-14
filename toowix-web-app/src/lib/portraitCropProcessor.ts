// LAST RESORT for phones whose camera driver reports a portrait-matching MediaTrackSettings
// (see attemptOrientationCorrection in networkQuality.ts) while the REAL decoded frame buffer, and
// the frame actually transmitted to other participants, stays landscape -- confirmed live across
// three different browser engines (Android Chrome, Android Brave, iOS Safari) on real devices, so
// this is a camera-driver/OS limitation, not something any getUserMedia constraint (ideal OR the
// spec's own "advanced" hard-constraint form, both already tried) can fix from the request side.
// lib-jitsi-meet itself was also checked directly (see the investigation this exists from) and
// does no rotation handling at all -- it is a thin passthrough, so this has to happen in our own
// code, after capture.
//
// This draws the real (landscape) camera frame into a <canvas> cropped to a centered, full-height
// 9:16 slice, then publishes canvas.captureStream() instead of the raw camera track. This is a
// REAL crop -- it loses the left/right edges of the frame, there is no way to invent portrait
// field-of-view from pixels a landscape sensor never captured -- but it is the only lever left
// that actually changes what bytes get encoded and sent, rather than just what the getUserMedia
// API reports about them.
import { getCameraDeviceCategory, getCameraCaptureOrientationPreference } from './networkQuality';

export interface PortraitCropHandle {
  track: MediaStreamTrack;
  stop: () => void;
}

// width / height -- matches the 9:16 ideal every phone capture already requests (see
// getCameraCaptureIdeal in networkQuality.ts), so a successfully-cropped track looks like what the
// capture was always SUPPOSED to deliver, not an arbitrary new shape.
const TARGET_RATIO = 9 / 16;

// Only worth attempting when there is a real, confirmed mismatch to correct: a phone, wanting
// portrait, whose negotiated track is nonetheless wider than it is tall. Never touches desktop/
// tablet cameras or a phone that is genuinely held sideways (landscape IS the correct shape then).
export function needsPortraitCrop(nativeTrack: MediaStreamTrack | null | undefined): boolean {
  if (!nativeTrack || typeof nativeTrack.getSettings !== 'function') return false;
  if (getCameraDeviceCategory() !== 'phone') return false;
  if (getCameraCaptureOrientationPreference() !== 'portrait') return false;

  let settings: MediaTrackSettings;

  try {
    settings = nativeTrack.getSettings();
  } catch {
    return false;
  }
  const width = Number(settings.width) || 0;
  const height = Number(settings.height) || 0;

  return width > 0 && height > 0 && width > height;
}

// Draws `nativeTrack`'s real frames into a canvas, cropped to the largest centered 9:16 slice the
// source can produce (full source height, a centered horizontal slice of it), and returns a track
// backed by that canvas. Returns null (never throws) on any failure -- callers fall back to the
// original, uncropped track rather than breaking the call.
export async function createPortraitCroppedTrack(
    nativeTrack: MediaStreamTrack,
): Promise<PortraitCropHandle | null> {
  try {
    const sourceVideo = document.createElement('video');

    sourceVideo.muted = true;
    sourceVideo.playsInline = true;
    sourceVideo.srcObject = new MediaStream([ nativeTrack ]);

    try {
      await sourceVideo.play();
    } catch {
      // Some browsers require a user gesture to call .play() explicitly, but frames still arrive
      // once the element is attached to a live track -- readyState below is the real gate.
    }

    if (sourceVideo.readyState < 2) {
      await new Promise<void>((resolve) => {
        const onReady = () => { sourceVideo.removeEventListener('loadedmetadata', onReady); resolve(); };

        sourceVideo.addEventListener('loadedmetadata', onReady);
        // Never hang the caller forever if metadata never arrives (e.g. the track ended first).
        setTimeout(resolve, 1500);
      });
    }

    const sourceWidth = sourceVideo.videoWidth;
    const sourceHeight = sourceVideo.videoHeight;

    if (!(sourceWidth > 0) || !(sourceHeight > 0)) {
      sourceVideo.srcObject = null;

      return null;
    }

    const cropHeight = sourceHeight;
    const cropWidth = Math.min(sourceWidth, Math.round(cropHeight * TARGET_RATIO));
    const cropX = Math.round((sourceWidth - cropWidth) / 2);

    const canvas = document.createElement('canvas');

    canvas.width = cropWidth;
    canvas.height = cropHeight;
    const ctx = canvas.getContext('2d', { alpha: false });

    if (!ctx) {
      sourceVideo.srcObject = null;

      return null;
    }

    let stopped = false;
    let rafId = 0;

    const drawFrame = () => {
      if (stopped) return;
      try {
        ctx.drawImage(sourceVideo, cropX, 0, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
      } catch {
        // A transient decode error on one frame is not fatal -- the next frame just tries again.
      }
      rafId = requestAnimationFrame(drawFrame);
    };

    rafId = requestAnimationFrame(drawFrame);

    const outputStream = canvas.captureStream(30);
    const [ outputTrack ] = outputStream.getVideoTracks();

    if (!outputTrack) {
      stopped = true;
      cancelAnimationFrame(rafId);
      sourceVideo.srcObject = null;

      return null;
    }

    const stop = () => {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(rafId);
      sourceVideo.srcObject = null;
      outputTrack.stop();
    };

    // If the SOURCE camera track ends (camera stopped, device switched away from), stop the
    // derived output track too -- otherwise it would keep publishing a frozen last frame forever.
    nativeTrack.addEventListener('ended', stop);

    return { track: outputTrack, stop };
  } catch {
    return null;
  }
}

// Wraps a just-acquired JitsiLocalTrack (lib-jitsi-meet video track) with the cropped version when
// (and only when) needsPortraitCrop says it's genuinely needed. On any failure, or when no crop is
// needed, returns the original track unchanged -- this must never be the reason a call fails.
//
// The ORIGINAL raw-camera JitsiLocalTrack is deliberately never disposed here: its native track is
// what feeds the hidden <video>/<canvas> pipeline for as long as the derived track is in use. It is
// kept alive, unpublished (never added to the room, never attached to any visible element), and
// its cleanup is chained onto the derived track's own dispose() so every existing call site that
// already disposes a camera track normally (camera off, device switch, leaving the call) tears
// down both together without needing to know this wrapping happened.
export async function applyPortraitCropIfNeeded(JitsiMeetJS: any, jitsiTrack: any): Promise<any> {
  if (!jitsiTrack) return jitsiTrack;

  const nativeTrack = jitsiTrack.getTrack?.();

  if (!needsPortraitCrop(nativeTrack)) return jitsiTrack;

  try {
    const cropped = await createPortraitCroppedTrack(nativeTrack);

    if (!cropped) return jitsiTrack;

    const [ derivedTrack ] = await JitsiMeetJS.createLocalTracksFromMediaStreams([
      { stream: new MediaStream([ cropped.track ]), mediaType: 'video', videoType: 'camera' },
    ]);

    if (!derivedTrack) {
      cropped.stop();

      return jitsiTrack;
    }

    const originalDispose = derivedTrack.dispose?.bind(derivedTrack);

    derivedTrack.dispose = async (...args: any[]) => {
      cropped.stop();
      try {
        await jitsiTrack.dispose();
      } catch {
        // best-effort -- the derived track's own dispose below is what actually matters to the caller
      }

      return originalDispose ? originalDispose(...args) : undefined;
    };

    return derivedTrack;
  } catch {
    return jitsiTrack;
  }
}

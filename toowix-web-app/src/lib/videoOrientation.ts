// Receiver-side "Option A" orientation-aware video fit (mobile camera orientation fix). A
// desktop/tablet camera is landscape and already fills an existing 16:9 participant card
// correctly with object-fit: cover (unchanged, existing behavior, never touched here). A mobile
// participant's portrait camera -- Toowix phones already request 9:16 capture, see
// getPreferredCameraCaptureConstraints in networkQuality.ts -- does NOT fit a landscape card the
// same way under 'cover': it crops the sides off into an extreme vertical zoom into the face.
// 'contain' instead shows the full image, centered, with empty space left/right -- no cropping,
// no stretching, no change to the card's own dimensions (the card/container is untouched; only
// the <video> element's own fit changes).
//
// Orientation is read from the ACTUAL incoming video (videoWidth/videoHeight), never assumed
// from the participant's device/user-agent -- a desktop user can still send a portrait-cropped
// stream from an external USB camera, and a phone held sideways (or a tablet) sends landscape.
// This also means a participant rotating their phone mid-call is picked up live, via the video
// element's own 'resize' event (fired whenever its intrinsic size changes), not just once at
// load.
import { useCallback, useRef, useState } from 'react';

export type CameraVideoObjectFit = 'cover' | 'contain';

// Pure, no DOM -- trivially unit-testable in isolation.
export function determineObjectFit(videoWidth: number, videoHeight: number): CameraVideoObjectFit {
  return videoHeight > videoWidth ? 'contain' : 'cover';
}

// Pure DOM logic, no React -- attaches to the real decoded-frame-size signals a <video> element
// exposes ('loadedmetadata' fires once dimensions are first known; 'resize' fires again on any
// later change) and calls `onChange` with the current fit whenever a real size is available.
// Returns an unsubscribe function. Safe to call on an element with no stream/dimensions yet --
// `onChange` simply isn't called until real dimensions exist, so a caller's default/initial value
// (normally 'cover', matching the existing pre-fix behavior) is left alone until then.
export function bindCameraVideoOrientationListener(
    video: HTMLVideoElement, onChange: (fit: CameraVideoObjectFit) => void
): () => void {
  const update = () => {
    const { videoWidth, videoHeight } = video;

    if (videoWidth > 0 && videoHeight > 0) {
      onChange(determineObjectFit(videoWidth, videoHeight));
    }
  };

  video.addEventListener('loadedmetadata', update);
  video.addEventListener('resize', update);
  update(); // Covers a reused element/stream whose metadata is already available right now.

  return () => {
    video.removeEventListener('loadedmetadata', update);
    video.removeEventListener('resize', update);
  };
}

// React hook wrapper for a component that owns exactly one camera <video> element at a time --
// one hook call per PERSISTENT instance (a dynamic participant list must render each tile as its
// own component so each gets its own hook call, same rule as any other React hook; never call
// this once per list item inside a bare .map() callback). `bind` is meant to be composed with any
// EXISTING ref logic for the same element, e.g. `ref={(el) => { existingRef(el); bind(el); }}` --
// this hook only tracks orientation, it never sets srcObject or calls play() itself, and never
// touches the surrounding card/container's own size.
export function useCameraVideoOrientation(): {
  objectFit: CameraVideoObjectFit;
  bind: (node: HTMLVideoElement | null) => void;
} {
  const [ objectFit, setObjectFit ] = useState<CameraVideoObjectFit>('cover');
  const boundRef = useRef<{ node: HTMLVideoElement; unsubscribe: () => void } | null>(null);

  const bind = useCallback((node: HTMLVideoElement | null) => {
    if (boundRef.current && boundRef.current.node !== node) {
      boundRef.current.unsubscribe();
      boundRef.current = null;
    }
    if (!node) {
      setObjectFit('cover');

      return;
    }
    if (boundRef.current?.node === node) return; // already bound to this exact element

    const unsubscribe = bindCameraVideoOrientationListener(node, setObjectFit);

    boundRef.current = { node, unsubscribe };
  }, []);

  return { objectFit, bind };
}

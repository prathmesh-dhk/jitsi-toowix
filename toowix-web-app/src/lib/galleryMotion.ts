/** A cell's layout frame, in stage coordinates. Layout frames never include animation transforms. */
export interface GalleryFrame {
  left: number;
  top: number;
  width: number;
  height: number;
}

const SLIDE_DURATION_MS = 180;
const SLIDE_EASING = 'cubic-bezier(.2,.8,.2,1)';

/**
 * Where a cell is visibly drawn right now: its layout frame plus any transform an animation is still
 * applying. Read this before cancelling a running animation, so an interrupted slide continues from
 * its current place instead of snapping to a stale one.
 */
export function readVisualFrame(node: HTMLElement, layoutFrame: GalleryFrame): GalleryFrame {
  const transform = window.getComputedStyle(node).transform;

  if (!transform || transform === 'none') return layoutFrame;

  // transform-origin is top left, so the matrix translation is the top-left offset and its diagonal is the scale.
  const matrix = new DOMMatrixReadOnly(transform);

  return {
    left: layoutFrame.left + matrix.e,
    top: layoutFrame.top + matrix.f,
    width: layoutFrame.width * matrix.a,
    height: layoutFrame.height * matrix.d,
  };
}

/**
 * Animates one cell from where it was visibly drawn to its new layout frame. The cell's own layout
 * already holds the NEW width/height as a plain (unanimated) CSS style -- only POSITION animates,
 * via a translate-only transform. Returns null when there is no visible position change to animate.
 *
 * TOOWIX_PHASE_3_1_VIDEO_INTEGRITY_SMART_CROPPING.md section 2C/"Important animation rule": the
 * flexible full-fill solver (unlike the earlier aspect-preserving engines) routinely changes a
 * card's width/height ratio between layouts, since card shape is now a scored preference, not a
 * preserved exact ratio -- so a structural change very commonly also changes a card's size, not
 * just its position. This function used to additionally animate `scale(sx, sy)` on the wrapper to
 * fake a smooth size transition (the classic FLIP technique) -- but `sx`/`sy` are independently
 * derived from width/height and are routinely UNEQUAL, so that scale briefly stretches every pixel
 * inside the wrapper NON-UNIFORMLY, including the `<video>` element, even though its own
 * `object-fit` is `cover` -- object-fit has no power to protect against a transform applied to its
 * own containing box. A real person's face would visibly squash/stretch for the ~180ms of every
 * such transition. Dropping the scale component means the wrapper's box size simply snaps to its
 * final (already-correct, undistorted) size immediately, and only its on-screen POSITION glides
 * smoothly -- exactly the "translate-only FLIP with final sizes applied before movement" the plan
 * calls for.
 */
export function animateGalleryCell(node: HTMLElement, from: GalleryFrame, to: GalleryFrame): Animation | null {
  const dx = from.left - to.left;
  const dy = from.top - to.top;

  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return null;

  return node.animate(
    [
      { transform: `translate(${dx}px, ${dy}px)` },
      { transform: 'translate(0px, 0px)' },
    ],
    { duration: SLIDE_DURATION_MS, easing: SLIDE_EASING },
  );
}

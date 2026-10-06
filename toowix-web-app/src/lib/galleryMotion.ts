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
 * already holds the new frame; the transform only covers the difference. Returns null when there is
 * nothing visible to animate.
 */
export function animateGalleryCell(node: HTMLElement, from: GalleryFrame, to: GalleryFrame): Animation | null {
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  const sx = to.width > 0 ? from.width / to.width : 1;
  const sy = to.height > 0 ? from.height / to.height : 1;

  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) {
    return null;
  }

  return node.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
      { transform: 'translate(0px, 0px) scale(1, 1)' },
    ],
    { duration: SLIDE_DURATION_MS, easing: SLIDE_EASING },
  );
}

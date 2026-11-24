import { useEffect, useRef, type RefObject } from 'react';

// Toowix brand gradient (same diagonal stops as public/toowix-logo.svg's own paint0/paint1/paint2
// gradients, indigo -> purple -> pink) used for the volume-reactive speaking glow on participant
// cards, replacing the old flat single-color ringColor ring.
const GLOW_INDIGO = '45, 1, 194'; // #2D01C2
const GLOW_INDIGO_PURPLE = '97, 32, 222'; // midpoint, indigo -> purple
const GLOW_PURPLE = '149, 63, 250'; // #953FFA
const GLOW_PURPLE_PINK = '202, 65, 208'; // midpoint, purple -> pink
const GLOW_PINK = '254, 67, 165'; // #FE43A5

// Static shape (how many shadow layers, their fixed offsets/direction) -- only the CSS custom
// properties below (--tw-glow-blur/--tw-glow-spread/--tw-glow-a) change per audio-level tick, via
// direct DOM writes (see applySpeakingGlowLevel), never through a React re-render. Keeping the
// shadow LIST structure identical between the "on" and "off" states (just the vars changing) is
// also what lets the boxShadow transition below interpolate smoothly instead of popping.
//
// `inset` is the whole point here: an inset shadow is confined to the element's own padding box
// (and further clipped by its border-radius), so the glow bleeds INWARD from the card's edges --
// matching the reference screenshots, where the tint sits inside the tile, never as a halo cast
// outside it. A positive offset (dx, dy) leaves the uncovered/visible strip on the opposite edges
// -- (8, 8) shows indigo along the top+left, (-8, -8) shows pink along the bottom+right, same
// diagonal direction as the logo's own gradient.
//
// CONFIRMED BUG: 3 widely-spaced layers (indigo / purple / pink, each a flat solid patch) read as
// two or three separate colored blobs rather than one continuous blend, since box-shadow has no
// true gradient interpolation between layers -- unlike the logo's own actual SVG linearGradient,
// which blends every intermediate shade continuously. Two extra layers at the two literal RGB
// midpoints (indigo-purple, purple-pink), placed at intermediate offsets along the same diagonal,
// approximate that continuous blend by overlapping/alpha-compositing five adjacent steps instead
// of three widely-spaced ones.
export const SPEAKING_GLOW_SHADOW =
  `inset 8px 8px var(--tw-glow-blur, 12px) var(--tw-glow-spread, 0px) rgba(${GLOW_INDIGO}, var(--tw-glow-a, 0.25)), ` +
  `inset 4px 4px var(--tw-glow-blur, 12px) var(--tw-glow-spread, 0px) rgba(${GLOW_INDIGO_PURPLE}, var(--tw-glow-a, 0.25)), ` +
  `inset 0 0 calc(var(--tw-glow-blur, 12px) * 1.2) var(--tw-glow-spread, 0px) rgba(${GLOW_PURPLE}, var(--tw-glow-a, 0.25)), ` +
  `inset -4px -4px var(--tw-glow-blur, 12px) var(--tw-glow-spread, 0px) rgba(${GLOW_PURPLE_PINK}, var(--tw-glow-a, 0.25)), ` +
  `inset -8px -8px var(--tw-glow-blur, 12px) var(--tw-glow-spread, 0px) rgba(${GLOW_PINK}, var(--tw-glow-a, 0.25)), ` +
  '0 8px 32px rgba(0, 0, 0, 0.6)';

// CONFIRMED BUG: this used to be a single flat '0 8px 32px rgba(0,0,0,0.4)' layer, directly
// contradicting this file's own comment above about keeping the shadow list structure identical --
// a browser cannot smoothly interpolate a box-shadow transition between lists of different lengths,
// so every speaking on/off flip SNAPPED instantly instead of fading, no matter how long
// SPEAKING_GLOW_TRANSITION's duration was set to. Matching the same layer structure (same
// offsets/blur-var, alpha simply at 0) lets every layer -- color, blur, spread -- interpolate
// continuously, producing a genuine cross-fade in both directions.
export const SPEAKING_AMBIENT_SHADOW =
  `inset 8px 8px var(--tw-glow-blur, 12px) var(--tw-glow-spread, 0px) rgba(${GLOW_INDIGO}, 0), ` +
  `inset 4px 4px var(--tw-glow-blur, 12px) var(--tw-glow-spread, 0px) rgba(${GLOW_INDIGO_PURPLE}, 0), ` +
  `inset 0 0 calc(var(--tw-glow-blur, 12px) * 1.2) var(--tw-glow-spread, 0px) rgba(${GLOW_PURPLE}, 0), ` +
  `inset -4px -4px var(--tw-glow-blur, 12px) var(--tw-glow-spread, 0px) rgba(${GLOW_PURPLE_PINK}, 0), ` +
  `inset -8px -8px var(--tw-glow-blur, 12px) var(--tw-glow-spread, 0px) rgba(${GLOW_PINK}, 0), ` +
  '0 8px 32px rgba(0, 0, 0, 0.4)';

// ease-in-out so the cross-fade reads as a gentle glow settling in/out rather than a sudden,
// eye-catching pop -- paired with the now-matching shadow layer structure above, which is what
// actually makes a smooth fade possible at all. 420ms read as too slow/laggy once it was actually
// smooth; 260ms keeps the same gentle easing curve while settling noticeably quicker.
export const SPEAKING_GLOW_TRANSITION = 'box-shadow 260ms ease-in-out';

// Real reported issue: the glow's reach was a wide, diffuse wash that scaled with the card's own
// size (up to 120px on a large stage tile) -- reduced and fixed to a slim, constant 12px band
// around the tile's edge at every card size, rather than a size-scaled diffuse glow.
const REACH_FRACTION = 0.14; // of the card's shorter side
const MIN_REACH = 12;
const MAX_REACH = 12;
const MIN_SPREAD = 1;
const MAX_SPREAD = 6;
// Real reported issue: normal conversational volume rarely pins the mic meter near 1.0 -- a
// linear alpha curve from MIN_ALPHA to MAX_ALPHA only reaches its brighter end at levels ordinary
// speech almost never hits, so the glow looked (and was reported as) barely-there while actually
// talking at a normal volume. INTENSITY_GAMMA < 1 front-loads the response curve (see
// intensityCurve below) so a moderate level already reads as a clearly visible glow, reserving the
// very top of MAX_ALPHA for genuinely loud speech.
const MIN_ALPHA = 0.4;
const MAX_ALPHA = 0.95;
const INTENSITY_GAMMA = 0.55;
// Exponential moving average factor -- smooths the store's quantised (0.05-step) level ticks into
// a continuous glow instead of visibly stepping between them, same intent as MicLevelIcon's own
// 80ms CSS transition on its fill height, just done in JS here since multiple shadow layers need
// to move together.
const SMOOTHING = 0.35;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const intensityCurve = (t: number) => Math.pow(t, INTENSITY_GAMMA);

// Writes the glow's current intensity straight to the host element's own style (CSS custom
// properties the box-shadow above reads via var()) -- never through React state/props, so this can
// run at mic-level tick rate (~10x/second) without re-rendering the card component that owns the
// host element. Only alpha/spread (brightness) move here; the reach (--tw-glow-blur) is owned by
// useSpeakingGlowSize below, since it depends on the card's size, not its current volume.
export function applySpeakingGlowLevel(host: HTMLElement, rawLevel: number, smoothedRef: { current: number }) {
  smoothedRef.current += (rawLevel - smoothedRef.current) * SMOOTHING;
  const t = intensityCurve(Math.min(1, Math.max(0, smoothedRef.current)));

  host.style.setProperty('--tw-glow-spread', `${lerp(MIN_SPREAD, MAX_SPREAD, t).toFixed(1)}px`);
  host.style.setProperty('--tw-glow-a', lerp(MIN_ALPHA, MAX_ALPHA, t).toFixed(3));
}

// Shared hook: feeds a raw 0..1 level value (from wherever the caller already has it -- a store
// subscription, a locally-polled meter) into the host's glow intensity. Keeping this in one place
// means every call site uses the exact same smoothing/intensity mapping.
export function useSpeakingGlowLevel(hostRef: RefObject<HTMLElement | null>, level: number) {
  const smoothedRef = useRef(0);

  useEffect(() => {
    const host = hostRef.current;

    if (host) {
      applySpeakingGlowLevel(host, level, smoothedRef);
    }
  }, [level, hostRef]);
}

// Keeps the glow's reach proportional to the card's OWN rendered size (see REACH_FRACTION's own
// comment) -- recomputed only when the card is actually resized, never on an audio-level tick, via
// ResizeObserver rather than a render-time measurement so it stays correct through layout changes
// (gallery reflow, window resize, entering/leaving presentation view) without re-rendering the card.
export function useSpeakingGlowSize(hostRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    let observer: ResizeObserver | null = null;
    let rafId: number | null = null;
    let cancelled = false;

    const apply = (host: HTMLElement, width: number, height: number) => {
      const reach = Math.min(MAX_REACH, Math.max(MIN_REACH, Math.min(width, height) * REACH_FRACTION));

      host.style.setProperty('--tw-glow-blur', `${reach.toFixed(1)}px`);
    };

    // Real reported bug: hostRef's identity never changes, so a plain `[hostRef]`-dependency
    // effect only ever runs once, at THIS effect's own mount time -- if the caller's host element
    // hasn't mounted yet (e.g. it's behind a later conditional render branch, as the solo-stage
    // stage card is), `hostRef.current` reads null here, the effect bails, and the ResizeObserver
    // is never attached for the rest of this component's lifetime. useSpeakingGlowLevel next door
    // self-heals by re-running on every level tick, which is why only the blur/reach got stuck.
    // Poll via rAF until the node actually exists, then attach exactly once -- cheap (stops the
    // moment it finds the node) and works no matter when the host mounts relative to this hook.
    const tryAttach = () => {
      if (cancelled) {
        return;
      }
      const host = hostRef.current;

      if (!host) {
        rafId = requestAnimationFrame(tryAttach);
        return;
      }
      apply(host, host.clientWidth, host.clientHeight);
      observer = new ResizeObserver(([entry]) => {
        const box = entry.contentBoxSize?.[0];

        if (box) {
          apply(host, box.inlineSize, box.blockSize);
        } else {
          apply(host, entry.contentRect.width, entry.contentRect.height);
        }
      });
      observer.observe(host);
    };

    tryAttach();

    return () => {
      cancelled = true;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      observer?.disconnect();
    };
  }, [hostRef]);
}

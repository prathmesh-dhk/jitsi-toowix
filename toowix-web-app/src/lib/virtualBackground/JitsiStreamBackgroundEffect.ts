// Trimmed port of jitsi-meet's JitsiStreamBackgroundEffect.ts -- V1 engine only (main-thread
// TFLite WASM inference + Canvas 2D compositing + a Worker-driven frame timer). The upstream
// file also has a V2 engine (Worker-based TF.js/WebGL/insertable-streams with device-tier
// detection) which needs several more files and two extra npm packages -- left out here to keep
// this feature light; V1 is the same engine jitsi-meet itself shipped with for years.
//
// Phase 2 adds a second, opt-in segmentation engine (MediaPipe Tasks Vision) behind the small
// internal interface below (_runMediaPipeInference), selected only via the dev-only
// readSegmentationEngineOverride() flag -- V1 (resizeSource/runInference, unchanged from before
// Phase 2) remains the default and the mid-call fallback target if MediaPipe fails repeatedly.
import { computeStats, isMaskDebugEnabled, isOverlayDebugEnabled, roundTo1Decimal } from './backgroundDebugTools';
import { type SegmentationEngine, getNextMediaPipeTimestamp, readMediaPipeSegSizeOverride } from './mediaPipeSegmentation';

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

// What createVirtualBackgroundEffect.ts hands the constructor -- exactly one of the two shapes,
// matching which engine it already loaded.
export type ISegmentationEngineHandle =
  | { engine: 'v1'; tflite: any; }
  | { engine: 'mediapipe-cpu' | 'mediapipe-gpu'; mediaPipeSegmenter: any; };

// A governor lever's predicted duty at its next tier -- `estimated` distinguishes a real learned
// measurement from the conservative height-ratio guess used before that tier has ever been
// observed for this engine (see _predictDutyAtNextTier/_chooseLever).
interface IDutyPrediction {
    duty: number; estimated: boolean;
}

const SEG_WIDTH = 256;
const SEG_HEIGHT = 144;

// MediaPipe's pinned landscape model has a native 256x144 input/output grid. Supplying a 512x288
// source canvas only upscales pixels before the model's own resize; it does not turn this into an
// HD segmentation model. Keep the runtime input at the model's native grid so the mask, source
// coordinates and per-frame cost remain honest. A 512x288 development-only A/B override still
// exists for measured experiments, but is never the production default.
const MEDIAPIPE_SEG_WIDTH = 256;
const MEDIAPIPE_SEG_HEIGHT = 144;
const MEDIAPIPE_SEG_SIZE_512: { height: number; width: number; } = { height: 288, width: 512 };

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
//
// V1-ONLY. This stays a flat constant deliberately -- V1's runInference() below is pinned
// byte-for-byte unchanged (see the 'V1 SAFETY' test), so the motion-adaptive smoothing added for
// MediaPipe (see motionAdaptiveSmoothing and MEDIAPIPE_MASK_TEMPORAL_SMOOTHING below) does not
// apply here. All of this session's motion/edge-quality fixes were validated against MediaPipe,
// never against V1 -- V1 remains the already-proven, untouched fallback engine.
const MASK_TEMPORAL_SMOOTHING = 0.6;

// A pixel's confidence delta (frame to frame) at or above this magnitude is treated as full
// motion (uses MEDIAPIPE_MASK_SMOOTHING_MIN); below it, the blend interpolates linearly toward
// MEDIAPIPE_MASK_TEMPORAL_SMOOTHING (stationary). MediaPipe-only -- see motionAdaptiveSmoothing.
const MOTION_DELTA_FULL = 0.3;

// Blends `smoothingMax` (stationary) down toward `smoothingMin` (full motion) based on how much
// this pixel's confidence actually changed since the last frame -- see MASK_TEMPORAL_SMOOTHING's
// comment for why a single flat number caused visible lag on real hand motion.
function motionAdaptiveSmoothing(delta: number, smoothingMin: number, smoothingMax: number): number {
    const motionFactor = Math.min(1, Math.abs(delta) / MOTION_DELTA_FULL);

    return smoothingMax - (motionFactor * (smoothingMax - smoothingMin));
}

// MediaPipe-only, lower than V1's above. V1's 0.6 was tuned against a noisy, low-res (256x144)
// CPU model, where that much smoothing was needed just to stop per-frame flicker -- the tradeoff
// being a visible motion "ghost trail" (the mask lagging behind fast real movement, the old value
// bleeding through). MediaPipe uses the same native 256x144 model grid, so this adaptive policy
// must still favour prompt motion response over stale history. Not 0 (a completely raw per-frame
// mask still has SOME flicker). Was pushed up to 0.4 at one point to paper over holes (a real,
// low-confidence moment from the model -- e.g. an arm against a low-contrast background -- showing
// through as an actual gap to the real room), but that just traded holes for a WORSE ghost trail,
// since more smoothing means more of a stale "person was here" value lingers after they've moved
// away. Holes are now handled separately and correctly by _fillSpatialHoles (a spatial, same-frame
// fix, not a temporal one), which means this can go back to favoring low ghosting again without
// reopening the hole problem -- the two are no longer fighting over the same knob.
const MEDIAPIPE_MASK_TEMPORAL_SMOOTHING = 0.25;
// MediaPipe's motion floor, well below V1's -- its cleaner, higher-res mask can afford tracking
// fast motion almost immediately (near-zero smoothing) without the flicker risk V1's noisier mask
// has at the same floor, and the spatial hole-fill (_fillSpatialHoles) now covers the "real person,
// momentarily low confidence" case that low smoothing alone would otherwise expose as a hole.
const MEDIAPIPE_MASK_SMOOTHING_MIN = 0.05;

// Steepens the mask's alpha value around the 0.5 (person/background) boundary before it's drawn.
// Missing entirely before this: the raw model confidence (0..1, "how much is this a person") was
// written straight to alpha with no shaping, so any pixel the model was genuinely unsure about
// (0.4, 0.5, 0.6...) rendered as a semi-transparent gray band instead of committing to a clean
// edge -- this is what read as a "disturbed"/muddy edge rather than a crisp one, independent of
// and in addition to the temporal ghosting MASK_TEMPORAL_SMOOTHING already addresses. Values near
// the extremes (confidently person or confidently background) are left almost unchanged; only the
// ambiguous middle is pushed outward. Applied AFTER temporal smoothing, so it shapes each frame's
// already-stabilized value, not the raw noisy one.
// Exponent tuned down from an initial 0.6 -- steepening the transition also steepens the model's
// own per-pixel NOISE right at the boundary (a value hovering around 0.5 from real sensor/model
// jitter, not real edge motion, gets pushed to full-on/full-off), which showed up as visible
// speckle/graininess right at the edge instead of a clean line. 0.8 is closer to linear (gentler),
// trading some of the crispness gain for not amplifying that per-pixel noise into speckling.
const SHARPEN_EXPONENT = 0.8;
// Real reported defect (2026-09-30): the curve above alone still left a genuinely confident
// foreground pixel (e.g. raw 0.9) at only ~233/255 alpha -- visibly translucent/"faded" body, not
// the fully solid person a viewer expects, since the curve approaches but never actually reaches
// 0/1 except at the true extremes. A pixel this confident is not an edge case that needs a soft
// transition; it should just commit to fully opaque (or fully transparent, symmetric case).
// MASK_EDGE_BAND is the only region that still gets the soft steepened curve -- everything more
// confident than that is hard-clamped, which is what gives a solid body with a comparatively
// thin, deliberately-feathered (not just "less blurred") edge band instead of a uniformly soft
// silhouette.
// Narrowed further on 2026-09-30 after live feedback that hands specifically still looked
// translucent/"like I can see the image through" at the 0.75/0.25 band -- hands are a genuinely
// harder region for a lightweight segmentation model (thin, fast-moving, easily confused with
// background at the fingers), so their raw confidence tends to land in the 0.5-0.75 range that
// the wider band still treated as "ambiguous, feather it." Narrowing the soft zone to 0.55-0.45
// pulls that range into the hard-opaque/transparent clamp instead, at the cost of a slightly
// thinner true feather (a real, accepted tradeoff -- prioritizing a solid, sharp body over a
// wider soft transition).
const MASK_HARD_OPAQUE_ABOVE = 0.55;
const MASK_HARD_TRANSPARENT_BELOW = 0.45;

function sharpenMaskAlpha(value: number): number {
    if (value >= MASK_HARD_OPAQUE_ABOVE) return 1;
    if (value <= MASK_HARD_TRANSPARENT_BELOW) return 0;
    const centered = value - 0.5;
    const steepened = Math.sign(centered) * Math.pow(Math.abs(centered) * 2, SHARPEN_EXPONENT) * 0.5;

    return Math.min(1, Math.max(0, steepened + 0.5));
}

// Camera-guided, MediaPipe-only enclosed-hole correction. Unlike the previous blur-and-expand
// approach, this never grows the whole silhouette. A correction is permitted only when all eight
// neighbours are already strong foreground and their source-frame luminance is close to the
// candidate pixel. That preserves genuine gaps between fingers, arms and hair strands.
const MASK_HOLE_CANDIDATE_ALPHA = 80;
const MASK_HOLE_FOREGROUND_ALPHA = 200;
const MASK_HOLE_MAX_LUMA_DELTA = 28;

// Output resolution floor -- setMaxOutputHeight (network/call-size driven, see
// getBackgroundEffectMaxHeight) is clamped to this range regardless of what the caller asks for.
const MIN_OUTPUT_HEIGHT = 480;
const MAX_OUTPUT_HEIGHT = 1080;

// Performance governor -- independent of the network/call-size target above. That target says
// what the CALL justifies; this says what THIS machine can actually composite in real time, and
// the two are combined (the lower of the two wins) in _getOutputSize. Ordered low-to-high so
// "step down" / "step up" below just move one index left/right.
const PERF_TIERS = [ 480, 720, 1080 ];
// Phase 2c/3: the second governor lever -- how often the effect composites a frame at all, not
// just at what resolution. Floor is 15fps (never lower -- untested below that and a plausible
// point where motion starts looking broken rather than merely less smooth). Ordered low-to-high,
// same convention as PERF_TIERS.
const FPS_TIERS = [ 15, 20, 30 ];
// EMA smoothing for the raw per-frame render time (ms) -- unchanged formula/alpha from Phase 1;
// only what's DONE with the smoothed value changed (duty cycle below, not a flat ms threshold).
const PERF_EMA_ALPHA = 0.2;
// Phase 3 governor redesign -- replaces the old flat PERF_STEP_DOWN_MS=26 / PERF_STEP_UP_MS=12
// thresholds, which results-baseline/ proves cannot work: v1@480 (the CHEAPEST tier available to
// it) costs ~25.7ms, so 0.7x that (18ms) is still above the render time itself and 12ms is
// impossible to reach at ANY resolution for a CPU-bound engine -- see the duty-cycle table in the
// Phase 3 report. duty = smoothedRenderMs * effectiveFps / 1000 -- the fraction of one second
// this effect spends compositing at its CURRENT fps, so (unlike a flat per-frame-ms threshold) it
// actually responds to the fps lever, not just the resolution lever.
const PERF_DUTY_DOWN = 0.75;
const PERF_DUTY_UP = 0.60;
const PERF_DUTY_DOWN_SUSTAIN_MS = 1000;
const PERF_DUTY_UP_SUSTAIN_MS = 8000;
// Shared cooldown after ANY step (up or down) before the next one -- without this, a duty value
// hovering right at a threshold could flip a lever back and forth every second or two.
const PERF_CHANGE_COOLDOWN_MS = 5000;
// Independent of the cooldown above (which only limits how SOON the next change can happen) --
// an explicit ceiling on how many changes can land in any rolling 60s window, so a borderline
// duty value flip-flopping right at the cooldown boundary still can't churn indefinitely.
const PERF_MAX_CHANGES_PER_MINUTE = 6;
// After this many consecutive "want to step down but both levers are already at their floor"
// governor ticks, treat it as "this ENGINE cannot keep up on this device at all", not just "this
// tier can't" -- triggers a fallback to a cheaper engine (see _handlePerfFloorExhausted) instead
// of silently staying at 480p/15fps forever with no other recourse.
const PERF_FLOOR_EXHAUSTED_THRESHOLD = 3;
// Exponential backoff for the "probe upward" step-up attempt -- if a step up is immediately
// reverted (duty crosses back over PERF_DUTY_DOWN within one sustain window), waiting the full
// PERF_DUTY_UP_SUSTAIN_MS again before retrying the SAME lever wastes time on a lever that just
// proved it isn't ready yet; doubling (capped) means a lever that keeps failing to hold backs off,
// while a lever that succeeds resets back to the base wait for its next probe.
const PERF_PROBE_BACKOFF_BASE_MS = PERF_DUTY_UP_SUSTAIN_MS;
const PERF_PROBE_BACKOFF_CAP_MS = 64000;
// Two predicted duty values within this of each other are treated as a tie (see _chooseLever) --
// wide enough to swallow floating-point noise in the resolution lever's estimate, narrow enough
// to never mask a real, meaningfully different measured cost.
const PERF_LEVER_TIE_EPS = 0.02;
// A learned resolution-tier cost older than this is no longer trusted to GATE a step-up decision
// -- without an expiry, a bad measurement taken once under heavy load (e.g. 80ms at 720p during a
// CPU-throttled moment) would permanently predict "720p is too slow" even after real load drops
// to near-zero and 720p would now be comfortably fast; found by the randomized anti-trap test
// (C3), which is exactly the class of bug this whole governor redesign exists to eliminate. Once
// expired, the prediction falls back to the height-ratio estimate (scaled from the CURRENT live
// frameMsEma), which responds to real, current conditions instead of a stale one.
const PERF_LEARNED_COST_MAX_AGE_MS = 30000;
// Real median bench.total.average at 720p from the Phase 3 re-measure (bench/results/phase3-720-
// *-rep{1,2,3}.json, median of 3, taken AFTER the Phase 2c small-mask/loop fixes) -- used ONLY as
// a static reference by _handlePerfFloorExhausted to decide whether falling back to v1 is
// actually a move to a cheaper engine. These fixes made both MediaPipe engines faster than v1 at
// 720p on this test machine, the opposite of the Phase 2 numbers the original "always fall back
// to v1" design assumed -- see the Phase 3 report for the full table.
const ENGINE_REFERENCE_COST_MS: Record<SegmentationEngine, number> = {
    v1: 27.5,
    'mediapipe-cpu': 15.3,
    'mediapipe-gpu': 10.7
};

// Prints perfCap/target/frame-time once a second -- OFF by default. Flip to true only while
// actively tuning the governor above; never ship this on.
const DEBUG_PERF_LOG = false;

// Phase 2c: the next tick's delay is now render-time-aware (see _startTimerLoop) instead of a
// fixed 1000/30 -- delay = max(MIN_TICK_GAP_MS, 1000/frameRate - elapsedRenderMs). Without a
// floor, a very fast render (e.g. mediapipe-gpu at low resolution) could schedule back-to-back
// ticks with ~0ms gap and starve the rest of the main thread (input handling, other rendering).
const MIN_TICK_GAP_MS = 4;

// Phase 3, dev-only: speeds up the governor's own sustain/cooldown/backoff windows for real-
// browser testing (a real 8s sustain window is impractical to assert against directly). Read
// once per effect start, NEVER in a production build -- gated on both the flag AND
// import.meta.env.PROD (this codebase's own existing convention, see src/main.tsx) so this can't
// accidentally affect real users even if someone sets the localStorage key by mistake. Production
// governor timing is verified with a fake clock instead (see the JitsiStreamBackgroundEffect
// tests); this override exists ONLY for the real-browser acceptance test's governor scenarios.
function readGovTimescale(): number {
    if (import.meta.env?.PROD) {
        return 1;
    }
    try {
        const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('toowix_bg_gov_timescale') : null;
        const parsed = stored ? Number(stored) : 1;

        return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    } catch {
        return 1;
    }
}

// If the MediaPipe engine throws this many frames IN A ROW, treat it as failing for the rest of
// the call rather than retrying forever -- switches to V1 (see _fallBackToV1) so the call keeps
// producing a real, moving picture instead of the last good frame frozen indefinitely. A single
// transient throw (one bad frame) does not trigger this -- only a genuine run of failures does.
const MEDIAPIPE_CONSECUTIVE_ERROR_FALLBACK_THRESHOLD = 5;

// GO 3: named cooldown for the give-up tier (see _handlePerfFloorExhausted) -- once this effect
// has given up (both governor levers exhausted on v1, the cheapest engine, with nowhere left to
// fall back to), it does not retry running the effect on this device for at least this long.
// Enforcement is the CALLER's responsibility (see createVirtualBackgroundEffect's onGiveUp
// option): this effect instance stops itself permanently and hands control back rather than
// looping/retrying internally, and the caller is expected not to re-apply a background
// automatically within this window.
const GIVE_UP_COOLDOWN_MS = 5 * 60 * 1000;

// Phase 2b: window.__bgBench(seconds) -- routes to whichever effect instance is currently active
// (startEffect/stopEffect keep this in sync). Declared ahead of the class (not after it, as
// before) purely to satisfy no-use-before-define -- behaviour is unchanged, this was already
// valid at runtime since nothing reads it until startEffect/stopEffect actually run.
let activeDebugEffect: JitsiStreamBackgroundEffect | null = null;

export default class JitsiStreamBackgroundEffect {
    _inputVideoElement: HTMLVideoElement;
    // Handle returned by HTMLVideoElement.requestVideoFrameCallback -- null means the loop is
    // currently stopped (see _startTimerLoop/_stopTimerLoop).
    _rvfcHandle: number | null = null;
    _lastRenderAt = 0;
    _model: any;
    _options: { height: number; virtualBackground: IVirtualBackground; width: number; };
    _outputCanvasCtx: CanvasRenderingContext2D | null = null;
    _outputCanvasElement: HTMLCanvasElement;
    // A single camera frame is captured before inference. Both segmentation and compositing use
    // this canvas, preventing a freshly-decoded video frame from being combined with an older mask.
    _sourceFrameCanvas: HTMLCanvasElement | null = null;
    _sourceFrameCtx: CanvasRenderingContext2D | null = null;
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
    // Performance governor state -- see PERF_*/FPS_TIERS constants above. _perfCap/_perfFpsCap both
    // start at the top tier; real hardware that can't sustain it steps down within about a second.
    _perfCap = PERF_TIERS[PERF_TIERS.length - 1];
    _perfFpsCap = FPS_TIERS[FPS_TIERS.length - 1];
    _frameMsEma = 0;
    _perfDutyOverBudgetSince: number | null = null;
    _perfDutyUnderBudgetSince: number | null = null;
    _lastPerfChangeAt = 0;
    // Rolling list of change timestamps (any lever, either direction), pruned to the last 60s --
    // enforces PERF_MAX_CHANGES_PER_MINUTE independently of the (shorter) per-change cooldown.
    _perfChangeTimestamps: number[] = [];
    _perfFloorWarned = false;
    // Incremented every governor tick that wants to step down but both levers are already at their
    // floor (480p, 15fps); reset to 0 the moment either lever isn't at its floor. See
    // PERF_FLOOR_EXHAUSTED_THRESHOLD and _handlePerfFloorExhausted.
    _perfFloorExhaustedCount = 0;
    _perfFloorExhaustedFallbackDone = false;
    // Learned per-tier cost (EMA ms + when it was last updated), keyed `${engine}:${resolutionTier}`
    // -- populated from every frame's real measured cost at whatever tier is currently active. Read
    // by the step-up prediction for the resolution lever (fps lever's prediction is exact, no table
    // needed, since per-frame render cost does not depend on fps). Entries older than
    // PERF_LEARNED_COST_MAX_AGE_MS are treated as unlearned by _learnedCostMsAt -- see that
    // constant's comment for why (a stale measurement must not permanently block a step-up).
    _perfLearnedCostMs: Map<string, { at: number; costMs: number; }> = new Map();
    // Exponential backoff state per lever ('res' | 'fps') -- see PERF_PROBE_BACKOFF_* above.
    _perfProbeBackoffMs: { fps: number; res: number; } = { fps: PERF_PROBE_BACKOFF_BASE_MS, res: PERF_PROBE_BACKOFF_BASE_MS };
    _perfNextProbeAllowedAt: { fps: number; res: number; } = { fps: 0, res: 0 };
    // Set once when a step UP is attempted, cleared once that tier has held for a full
    // PERF_DUTY_DOWN_SUSTAIN_MS without reverting -- lets the governor tell "this step-up held" from
    // "this step-up immediately proved wrong" apart, to drive the backoff above.
    _perfPendingProbe: { at: number; lever: 'fps' | 'res'; } | null = null;
    // Dev-only (see readGovTimescale) -- read once when the effect starts, NEVER in production.
    _govTimescale = 1;
    _lastDebugLogAt = 0;
    // Which engine is currently processing frames. Starts as whatever createVirtualBackgroundEffect
    // resolved (v1, or a MediaPipe delegate) and can move to 'v1' mid-call via _fallBackToV1, but
    // never moves the other way -- once fallen back, stays on V1 for the rest of this effect's life.
    _engine: SegmentationEngine;
    _mediaPipeSegmenter: any = null;
    // Only set when the engine handle wasn't already 'v1' -- lets _fallBackToV1 load the TFLite
    // model on demand instead of every effect paying for it upfront regardless of engine.
    _loadV1Fallback: (() => Promise<{ tflite: any; }>) | null = null;
    _mediaPipeConsecutiveErrors = 0;
    _mediaPipeFallbackInProgress = false;
    // Phase 2b measurement tools -- all dev-only, all off unless their localStorage flag is set
    // (see backgroundDebugTools.ts). None of this affects the composited frame on the normal path;
    // _debugAccum/_benchSamples are just numbers being accumulated, never drawn or sent anywhere on
    // their own. _lastMediaPipe{Segment,Readback}Ms are populated by _runMediaPipeInference every
    // frame regardless of any flag (cheap) so the accumulation below has something to read.
    _lastMediaPipeSegmentMs = 0;
    _lastMediaPipeReadbackMs = 0;
    // Phase 2c: _blendMaskValues (the EMA-smoothing loop, see below) was previously untimed -- its
    // cost was invisible in the segmentation/readback/compositing sub-metrics but included in
    // totalMs, which is why segmentation+readback+compositing didn't sum to total in the Phase 2
    // benchmark. Timed on its own now for both engines (0 for v1, whose equivalent blend work stays
    // fused inside the untouched runInference()).
    _lastMediaPipeBlendMs = 0;
    _debugAccum = { blend: 0, compositing: 0, count: 0, droppedFrames: 0, readback: 0, segmentation: 0, total: 0 };
    _lastOverlayMetrics: Record<string, number | string> | null = null;
    _benchSamples: { blend: number[]; compositing: number[]; readback: number[]; segmentation: number[]; total: number[]; } | null = null;
    _benchDroppedFrames = 0;
    // Phase 2c: monotonic, never reset by runBenchmark/toggling -- unlike _debugAccum.count (which
    // resets every ~1s log interval), this is the ground truth for "is the frame loop still
    // running", used by the visibility-resume stability check.
    _totalFrameCount = 0;
    // Phase 2c: a small canvas MediaPipe is fed instead of the raw camera-resolution video element --
    // mirrors V1's resizeSource() stretch exactly (same SEG_WIDTH x SEG_HEIGHT, same drawImage call
    // shape), so MediaPipe's mask comes back at the same small fixed size V1 already uses instead of
    // scaling with camera resolution. Created once in startEffect, reused every frame.
    _mediaPipeInputCanvas: HTMLCanvasElement | null = null;
    _mediaPipeInputCtx: CanvasRenderingContext2D | null = null;
    // Resolved once in the constructor (see readMediaPipeSegSizeOverride) -- MEDIAPIPE_SEG_WIDTH/
    // HEIGHT (512x288) unless the dev-only ?bgSegSize=256 override is set, in which case 256x144.
    // Read once, not per-frame: the override is meant to be compared across separate page loads
    // (A/B), not changed mid-call.
    _mediaPipeSegWidth = MEDIAPIPE_SEG_WIDTH;
    _mediaPipeSegHeight = MEDIAPIPE_SEG_HEIGHT;
    // Settings' reported frameRate (falls back to 30) -- read once in startEffect, used by the
    // render-time-aware timer loop below.
    _frameRate = 30;
    // Last _renderMask()'s totalMs -- read by the timer loop to compute the next tick's delay.
    _lastRenderElapsedMs = 0;
    // GO 3 give-up tier: set true when the governor exhausts both levers on v1 (the cheapest
    // engine, nowhere left to fall back to) -- see _handlePerfFloorExhausted. Once true, _renderMask
    // stops doing any work (segmentation/compositing skipped every tick) and the caller's onGiveUp
    // callback has already been invoked so it can restore the raw camera track. This effect
    // instance never un-gives-up on its own (see GIVE_UP_COOLDOWN_MS's comment -- enforcement of
    // the cooldown is the caller's job, this flag just stops burning CPU on a hopeless effect).
    _hasGivenUp = false;
    _gaveUpAt: number | null = null;
    _onGiveUp: (() => void) | null = null;
    _onFallback: ((reason: string) => void) | null = null;
    // Diagnostics-only (see EDGE-STATUS task item 1/2). The engine this effect FIRST resolved to at
    // creation (before any mid-call fallback) -- set once in the constructor, never mutated -- so
    // the debug overlay can show "started X, now on Y" instead of just the current engine, which
    // alone can't distinguish "always been v1" from "fell back to v1 mid-call".
    _engineAtStart: SegmentationEngine;
    // Diagnostics-only. Set whenever a fallback (init-time engine-selection fallback, passed in via
    // the constructor, OR a mid-call fallback via _fallBackToV1/_giveUp) actually happens, to the
    // real reason/error string -- never cleared, so it answers "did a fallback happen this session
    // and why" for the whole lifetime of the effect, not just the instant it occurred.
    _lastFallbackReason: string | null = null;
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

    constructor(
            engineHandle: ISegmentationEngineHandle,
            virtualBackground: IVirtualBackground,
            loadV1Fallback: (() => Promise<{ tflite: any; }>) | null = null,
            onGiveUp: (() => void) | null = null,
            // Diagnostics-only. When createVirtualBackgroundEffect.ts requested a MediaPipe engine but
            // had to fall back to v1 at CREATION time (GPU/CPU init failed), it passes the real reason
            // here so the overlay/console can report it -- distinct from a MID-CALL fallback, which is
            // detected and recorded on its own (see _fallBackToV1/_giveUp).
            initFallbackReason: string | null = null,
            // Called the moment _lastFallbackReason becomes non-null (init-time OR mid-call) -- the
            // visible-fallback-toast requirement. Fires with the reason string; unlike onGiveUp this
            // does NOT mean the effect stopped, only that it's now running a different/degraded engine
            // than requested.
            onFallback: ((reason: string) => void) | null = null
    ) {
        this._onGiveUp = onGiveUp;
        this._onFallback = onFallback;
        const segSizeOverride = readMediaPipeSegSizeOverride();

        if (segSizeOverride === 512) {
            this._mediaPipeSegWidth = MEDIAPIPE_SEG_SIZE_512.width;
            this._mediaPipeSegHeight = MEDIAPIPE_SEG_SIZE_512.height;
        }
        this._engineAtStart = engineHandle.engine;
        this._lastFallbackReason = initFallbackReason;
        if (initFallbackReason) {
            try {
                this._onFallback?.(initFallbackReason);
            } catch (err) {
                console.warn('[VirtualBackground] onFallback callback threw:', err);
            }
        }
        // Workaround for a Firefox issue (https://bugzilla.mozilla.org/show_bug.cgi?id=1388974):
        // a canvas needs its context requested once before captureStream() works reliably.
        this._outputCanvasElement = document.createElement('canvas');
        this._outputCanvasElement.getContext('2d');
        this._inputVideoElement = document.createElement('video');
        this._inputVideoElement.muted = true;
        this._inputVideoElement.playsInline = true;
        this._inputVideoElement.setAttribute('playsinline', '');
        this._inputVideoElement.setAttribute('webkit-playsinline', '');

        // V1's own mask stays fixed at SEG_WIDTH x SEG_HEIGHT, same as before Phase 2. A MediaPipe
        // engine instead resizes these (_options.width/height, _segmentationMask, the mask canvas,
        // _smoothedMask) to match whatever size ITS mask reports, the first time a frame is actually
        // segmented -- see _ensureMaskSize.
        this._options = { height: SEG_HEIGHT, virtualBackground, width: SEG_WIDTH };
        this._segmentationPixelCount = SEG_WIDTH * SEG_HEIGHT;
        this._engine = engineHandle.engine;
        this._loadV1Fallback = loadV1Fallback;

        if (engineHandle.engine === 'v1') {
            this._model = engineHandle.tflite;
        } else {
            this._mediaPipeSegmenter = engineHandle.mediaPipeSegmenter;
        }

        if (virtualBackground.backgroundType === VIRTUAL_BACKGROUND_TYPE.IMAGE) {
            this._virtualImage = document.createElement('img');
            this._virtualImage.crossOrigin = 'anonymous';
            this._virtualImage.src = virtualBackground.virtualSource ?? '';
        }
    }

    // Real reported defect (2026-09-30): switching backgrounds (blur strength, or to a different
    // image) used to tear down this whole effect and build a BRAND NEW one via
    // createVirtualBackgroundEffect() -- a new instance means a fresh performance governor with no
    // learned-cost history, starting back at the top tier (1080p/30fps) every single time, which is
    // exactly what produced the reported "changing background is laggy, ~5fps" symptom: the
    // governor had to re-discover this device's real capability from scratch after every switch,
    // dropping frames for a few seconds each time instead of staying at whatever tier it had
    // already proven this device can sustain. This lets the CALLER (useJitsiMeeting) update an
    // already-running effect's background config in place instead, keeping the same engine,
    // governor state, and learned-cost table across a switch. Only the background-specific state
    // below changes; segmentation/compositing/governor code is untouched by this method.
    setVirtualBackground(virtualBackground: IVirtualBackground) {
        const previous = this._options.virtualBackground;

        this._options.virtualBackground = virtualBackground;
        if (virtualBackground.backgroundType === VIRTUAL_BACKGROUND_TYPE.IMAGE) {
            const nextSrc = virtualBackground.virtualSource ?? '';

            if (!this._virtualImage) {
                this._virtualImage = document.createElement('img');
                this._virtualImage.crossOrigin = 'anonymous';
            }
            // Only reassign .src (which restarts image decode) if it actually changed -- switching
            // blur strength while already on an image background, for example, must not re-decode.
            if (this._virtualImage.src !== nextSrc && this._virtualImage.getAttribute('src') !== nextSrc) {
                this._virtualImage.src = nextSrc;
            }
        } else if (previous.backgroundType === VIRTUAL_BACKGROUND_TYPE.IMAGE) {
            // Leaving an image background -- no need to keep decoding/holding it; the readyState checks
            // in _renderMask() only gate the IMAGE branch, so this is safe to leave alone either way,
            // but clearing the source stops a background decode/network fetch that's no longer needed.
            try {
                this._virtualImage.removeAttribute('src');
            } catch { /* best-effort only */ }
        }
    }

    isEnabled(jitsiLocalTrack: any) {
        return jitsiLocalTrack.isVideoTrack() && jitsiLocalTrack.videoType === 'camera';
    }

    // Lets the caller (useJitsiMeeting's network-quality effect) lower or raise the rendered/
    // encoded output resolution to match the same call-size/network-state/bandwidth target the
    // rest of the call's video quality already follows -- always within [MIN_OUTPUT_HEIGHT,
    // MAX_OUTPUT_HEIGHT]. This is only the NETWORK-justified target; _perfCap (see the governor
    // below) separately caps what THIS machine can actually composite in real time, and the two
    // are combined in _getOutputSize.
    setMaxOutputHeight(height: number) {
        const rounded = Math.round(height) || DEFAULT_MAX_OUTPUT_HEIGHT;

        this._maxOutputHeight = Math.min(MAX_OUTPUT_HEIGHT, Math.max(MIN_OUTPUT_HEIGHT, rounded));
    }

    // Scales (nativeWidth, nativeHeight) down to fit within whichever of _maxOutputHeight (network/
    // call-size target) or _perfCap (what this machine can keep up with) is smaller, preserving
    // aspect ratio. Never scales up -- a camera already at or under the cap renders at its own
    // resolution (so e.g. a native 360p camera stays 360p even though MIN_OUTPUT_HEIGHT is 480;
    // there's no real detail to add by upscaling it).
    _getOutputSize(nativeWidth: number, nativeHeight: number): { height: number; width: number; } {
        const cap = Math.min(this._maxOutputHeight, this._perfCap);
        const scale = Math.min(1, cap / (nativeHeight || cap));

        return {
            height: Math.max(1, Math.round(nativeHeight * scale)),
            width: Math.max(1, Math.round(nativeWidth * scale))
        };
    }

    // The height this effect will actually render at right now -- for the caller (useJitsiMeeting)
    // to combine with getTargetVideoHeight() when deciding the sender's video-quality ceiling, so
    // the sender is never asked to send more than this effect actually produces. Deliberately
    // computed from the current caps and the camera's reported native size, NOT from the last
    // composited frame -- correct even before the first frame has rendered, or while rendering is
    // currently skipped (tab hidden, track muted, etc).
    getCurrentOutputHeight(): number {
        if (!this._sourceTrack) {
            return Math.min(this._maxOutputHeight, this._perfCap);
        }
        const settings = this._sourceTrack.getSettings ? this._sourceTrack.getSettings() : this._sourceTrack.getConstraints();
        const nativeHeight = this._inputVideoElement.videoHeight || Number((settings as any)?.height) || this._maxOutputHeight;

        return Math.min(this._maxOutputHeight, this._perfCap, nativeHeight);
    }

    // Phase 2c: a monotonic, never-reset frame counter -- the visibility-resume stability check uses
    // this instead of _debugAccum.count, which resets every ~1s log interval and so cannot tell
    // "the loop stopped" apart from "we're just between log flushes".
    getTotalFrameCount(): number {
        return this._totalFrameCount;
    }

    // The effect's own current composite rate -- min(camera's native frameRate, the governor's fps
    // lever) -- mirrors getCurrentOutputHeight()'s shape. Read-only; useJitsiMeeting.ts may read
    // this (e.g. for a future UI indicator) but nothing in the sender/network sync depends on it --
    // frame rate is not something the JVB negotiates the way resolution is, unlike _perfCap.
    getCurrentFrameRate(): number {
        return Math.min(this._frameRate, this._perfFpsCap);
    }

    _learnedCostKey(resTier: number): string {
        return `${this._engine}:${resTier}`;
    }

    // Real measured cost (EMA ms) at a resolution tier this engine has actually run at RECENTLY (see
    // PERF_LEARNED_COST_MAX_AGE_MS), or null if never observed this call or the measurement has
    // expired. Used only by the resolution lever's step-up prediction -- the fps lever's prediction
    // is exact (see _predictDutyAtNextTier) since per-frame cost doesn't depend on fps.
    _learnedCostMsAt(resTier: number): number | null {
        const entry = this._perfLearnedCostMs.get(this._learnedCostKey(resTier));

        if (!entry || Date.now() - entry.at > PERF_LEARNED_COST_MAX_AGE_MS) return null;

        return entry.costMs;
    }

    // Tiny helper: index of `value` in `tiers`, defaulting to the top tier if somehow not found
    // (mirrors the old _stepPerfCap's fromIndex fallback).
    _tierIndex(tiers: number[], value: number): number {
        const idx = tiers.indexOf(value);

        return idx === -1 ? tiers.length - 1 : idx;
    }

    // Chooses which lever to move, given which are available and their predicted post-move duty
    // ({ duty, estimated } -- estimated=true means the resolution-lever prediction used the
    // conservative height-ratio guess, not a real learned measurement at that tier). Whenever the
    // resolution side is still just an ESTIMATE, its predicted duty is not compared numerically
    // against the fps lever's EXACT prediction at all -- an estimate vs. an exact number is not a
    // fair comparison, and the two can land within floating-point noise of each other purely by
    // coincidence. Instead this is exactly the "cold-start rule": fps for v1 (results-baseline/
    // shows its per-frame cost is nearly resolution-independent, so only the fps lever meaningfully
    // changes its duty), resolution for the MediaPipe engines (their cost -- readback/blend
    // included -- scales with resolution, per the Phase 2c fix). Once the resolution lever has real
    // learned data for the tier in question (typically already true, from the initial descent
    // through higher tiers when the effect starts at the top), the numeric comparison (with
    // PERF_LEVER_TIE_EPS as a genuine-tie guard) takes over.
    _chooseLever(
            fpsAvailable: boolean, resAvailable: boolean,
            fpsPrediction: IDutyPrediction | null, resPrediction: IDutyPrediction | null
    ): 'fps' | 'res' {
        if (!resAvailable) return 'fps';
        if (!fpsAvailable) return 'res';
        if (resPrediction?.estimated) {
            return this._engine === 'v1' ? 'fps' : 'res';
        }

        const fpsD = fpsPrediction?.duty ?? Infinity;
        const resD = resPrediction?.duty ?? Infinity;

        if (Math.abs(fpsD - resD) < PERF_LEVER_TIE_EPS) {
            return this._engine === 'v1' ? 'fps' : 'res';
        }

        return fpsD <= resD ? 'fps' : 'res';
    }

    // Predicted duty if lever `lever` stepped from its current tier to `direction`'s neighbour,
    // using the OTHER lever's current tier unchanged. Returns null if there's no neighbour that
    // direction (already at that lever's floor/ceiling).
    _predictDutyAtNextTier(lever: 'fps' | 'res', direction: -1 | 1): IDutyPrediction | null {
        if (lever === 'fps') {
            const idx = this._tierIndex(FPS_TIERS, this._perfFpsCap);
            const nextIdx = idx + direction;

            if (nextIdx < 0 || nextIdx >= FPS_TIERS.length) return null;

            // Exact: per-frame render cost does not depend on fps, only the EMA render-ms changes.
            return { duty: (this._frameMsEma * FPS_TIERS[nextIdx]) / 1000, estimated: false };
        }

        const idx = this._tierIndex(PERF_TIERS, this._perfCap);
        const nextIdx = idx + direction;

        if (nextIdx < 0 || nextIdx >= PERF_TIERS.length) return null;

        const nextResTier = PERF_TIERS[nextIdx];
        const learned = this._learnedCostMsAt(nextResTier);
        // Conservative estimate when we've never actually run this engine at the next resolution
        // tier: assume cost scales at least linearly with height (compositing cost genuinely does;
        // segmentation cost may not, but a resolution STEP-UP prediction erring toward "don't step up
        // yet" is the safe direction for a prediction gating an upgrade, not a downgrade). Once the
        // governor has actually run at that tier (e.g. on the way down from a higher starting tier),
        // this table has real data and this estimate is no longer used for it.
        const estimatedCostMs = learned ?? (this._frameMsEma * (nextResTier / this._perfCap));

        return { duty: (estimatedCostMs * this.getCurrentFrameRate()) / 1000, estimated: learned === null };
    }

    // Enforces PERF_MAX_CHANGES_PER_MINUTE -- prunes the rolling timestamp list to the last 60s and
    // reports whether one more change is currently allowed.
    _perfChangeBudgetAvailable(now: number): boolean {
        while (this._perfChangeTimestamps.length && now - this._perfChangeTimestamps[0] > 60000) {
            this._perfChangeTimestamps.shift();
        }

        return this._perfChangeTimestamps.length < PERF_MAX_CHANGES_PER_MINUTE;
    }

    _recordPerfChange(now: number) {
        this._lastPerfChangeAt = now;
        this._perfChangeTimestamps.push(now);
    }

    // Steps one lever one tier toward `direction`. Returns true if it actually moved.
    _stepLever(lever: 'fps' | 'res', direction: -1 | 1): boolean {
        if (lever === 'fps') {
            const idx = this._tierIndex(FPS_TIERS, this._perfFpsCap);
            const nextIdx = Math.min(FPS_TIERS.length - 1, Math.max(0, idx + direction));

            if (nextIdx === idx) return false;
            this._perfFpsCap = FPS_TIERS[nextIdx];

            return true;
        }

        const idx = this._tierIndex(PERF_TIERS, this._perfCap);
        const nextIdx = Math.min(PERF_TIERS.length - 1, Math.max(0, idx + direction));

        if (nextIdx === idx) return false;
        this._perfCap = PERF_TIERS[nextIdx];

        return true;
    }

    _leverAtFloor(lever: 'fps' | 'res'): boolean {
        return lever === 'fps' ? this._perfFpsCap <= FPS_TIERS[0] : this._perfCap <= PERF_TIERS[0];
    }

    _leverAtCeiling(lever: 'fps' | 'res'): boolean {
        return lever === 'fps'
            ? this._perfFpsCap >= FPS_TIERS[FPS_TIERS.length - 1]
            : this._perfCap >= PERF_TIERS[PERF_TIERS.length - 1];
    }

    // Both levers already at their floor (480p, 15fps) and still over budget -- this ENGINE cannot
    // keep up on this device at all, not just at some tier. The only automatic fallback target is
    // 'v1' (mediapipe-gpu is dev-only opt-in and is never chosen automatically, per Phase 2's rule),
    // reusing the existing _fallBackToV1 -- but ONLY if v1 is actually a MEASURABLY CHEAPER engine.
    // The Phase 2c small-mask/loop fixes made mediapipe-cpu and mediapipe-gpu genuinely faster than
    // v1 at 720p (see ENGINE_REFERENCE_COST_MS below, from the real Phase 3 720p re-measure) -- a
    // blind "always fall back to v1" would make a struggling mediapipe-cpu session WORSE, not
    // better. Prefers this engine's own LIVE learned cost at the floor tier when available (more
    // relevant to this specific device/session) over the static reference. If v1 is not measurably
    // cheaper, stays on the current engine and logs once -- never silently do nothing without a log.
    _handlePerfFloorExhausted() {
        if (this._perfFloorExhaustedFallbackDone) return;
        this._perfFloorExhaustedFallbackDone = true;
        if (this._engine !== 'v1') {
            const currentEngineCostMs = this._learnedCostMsAt(this._perfCap) ?? ENGINE_REFERENCE_COST_MS[this._engine];
            const v1CostMs = ENGINE_REFERENCE_COST_MS.v1;

            if (v1CostMs < currentEngineCostMs) {
                console.warn(
            '[VirtualBackground] Performance governor: floor exhausted at 480p/15fps -- falling back to v1 '
            + `(measurably cheaper: ~${v1CostMs}ms vs ~${currentEngineCostMs.toFixed(1)}ms for ${this._engine}).`
                );
                this._fallBackToV1();

                return;
            }
            // No cheaper engine exists for THIS device/session (v1 isn't measurably cheaper either) --
            // this is the give-up case, same as the v1-already branch below.
            this._giveUp(
          `floor exhausted at 480p/15fps on ${this._engine}, and v1 (~${v1CostMs}ms) is not measurably `
          + `cheaper than the measured cost here (~${currentEngineCostMs.toFixed(1)}ms)`
            );

            return;
        }
        this._giveUp('this device cannot keep up even at the minimum output size and frame rate (480p/15fps) on the v1 engine');
    }

    // GO 3: the floor is exhausted and no cheaper engine exists -- turn the effect off (stop
    // burning CPU on a hopeless configuration) and hand control back to the caller via onGiveUp,
    // which is expected to restore the raw camera track (never a black/frozen frame -- the raw
    // camera keeps producing real frames the whole time, this effect just stops touching them) and
    // surface a short notice to the user. Idempotent: only ever fires once per effect instance (see
    // _perfFloorExhaustedFallbackDone, checked by the caller of this method).
    _giveUp(reason: string) {
        if (this._hasGivenUp) return;
        this._hasGivenUp = true;
        this._gaveUpAt = Date.now();
        console.warn(`[VirtualBackground] Performance governor giving up -- ${reason}; turning the background effect off (no retry for ${Math.round(GIVE_UP_COOLDOWN_MS / 60000)} min, enforced by the caller).`);
        // Real bug this closes: captureStream()'s track starts emitting from an ENTIRELY BLANK
        // (transparent -> renders black) canvas the instant startEffect() hands it to the caller,
        // and stays that way until the first successful _renderMask() tick draws something real. If
        // the governor gives up before that ever happens (a slow device failing even the first few
        // ticks), the track's last-ever frame is that initial blank one -- it then sits frozen/black
        // for however long the caller's async onGiveUp takes to swap the track back to the raw
        // camera (removeVirtualBackgroundEffect awaits track.setEffect(undefined), not instant).
        // Drawing one real, unprocessed camera frame here -- best-effort, must never throw -- means
        // whatever the receiver sees during that swap is a real picture of the person, not black.
        this._drawRawPassthroughFrame();
        this._stopTimerLoop();
        try {
            this._onGiveUp?.();
        } catch (err) {
            console.warn('[VirtualBackground] onGiveUp callback threw:', err);
        }
    }

    // Best-effort, no-segmentation direct camera draw -- see _giveUp's comment for why this exists.
    // Deliberately does not touch this._segmentationMask/any mask state (this is not a real
    // composited frame, just "something real instead of black"), and never throws: a failure here
    // must not block give-up from completing and handing control back to the caller.
    _drawRawPassthroughFrame() {
        try {
            if (!this._outputCanvasCtx || this._inputVideoElement.readyState < 2) return;
            const width = this._outputCanvasElement.width;
            const height = this._outputCanvasElement.height;

            if (!width || !height) return;
            this._outputCanvasCtx.globalCompositeOperation = 'copy';
            // @ts-ignore
            this._outputCanvasCtx.drawImage(
          this._inputVideoElement,
          0, 0, this._inputVideoElement.width || width, this._inputVideoElement.height || height,
          0, 0, width, height
            );
        } catch (err) {
            console.warn('[VirtualBackground] _drawRawPassthroughFrame failed (non-fatal):', err);
        }
    }

    // Whether this effect instance has given up (see _giveUp) -- read-only, for a caller/test that
    // wants to confirm state without depending on the callback having fired.
    hasGivenUp(): boolean {
        return this._hasGivenUp;
    }

    // Phase 3 governor: duty-cycle based (see PERF_DUTY_* constants for why this replaced the old
    // flat per-frame-ms thresholds), two independent levers (resolution, fps), lever choice driven
    // by measured/learned sensitivity, exponential-backoff probing on step-up, a hard cap on changes
    // per minute independent of the per-change cooldown, and an explicit floor-exhausted fallback so
    // a struggling engine never leaves the user stuck at the floor forever.
    _updatePerfGovernor(frameMs: number) {
        this._frameMsEma = this._frameMsEma === 0 ? frameMs : (this._frameMsEma * (1 - PERF_EMA_ALPHA)) + (frameMs * PERF_EMA_ALPHA);

        const now = Date.now();
        const resKey = this._learnedCostKey(this._perfCap);
        const prevLearnedEntry = this._perfLearnedCostMs.get(resKey);
        const blendedCostMs = prevLearnedEntry === undefined
            ? this._frameMsEma
            : (prevLearnedEntry.costMs * 0.8) + (this._frameMsEma * 0.2);

        this._perfLearnedCostMs.set(resKey, { at: now, costMs: blendedCostMs });

        const timescale = this._govTimescale;
        const dutySustainDownMs = PERF_DUTY_DOWN_SUSTAIN_MS / timescale;
        const dutySustainUpMs = PERF_DUTY_UP_SUSTAIN_MS / timescale;
        const cooldownMs = PERF_CHANGE_COOLDOWN_MS / timescale;
        const duty = (this._frameMsEma * this.getCurrentFrameRate()) / 1000;

        // Resolve a pending probe (a step-up attempted earlier) once it's held long enough without
        // reverting -- success resets that lever's backoff back to the base wait.
        if (this._perfPendingProbe && now - this._perfPendingProbe.at >= dutySustainDownMs) {
            this._perfProbeBackoffMs[this._perfPendingProbe.lever] = PERF_PROBE_BACKOFF_BASE_MS;
            this._perfPendingProbe = null;
        }

        if (duty > PERF_DUTY_DOWN) {
            this._perfDutyUnderBudgetSince = null;
            this._perfDutyOverBudgetSince ??= now;
            if (this._perfPendingProbe) {
                // The step-up that led to this state gets blamed -- back off that lever harder next time.
                const lever = this._perfPendingProbe.lever;

                this._perfProbeBackoffMs[lever] = Math.min(PERF_PROBE_BACKOFF_CAP_MS, this._perfProbeBackoffMs[lever] * 2);
                this._perfNextProbeAllowedAt[lever] = now + this._perfProbeBackoffMs[lever];
                this._perfPendingProbe = null;
            }

            if (
                now - this._perfDutyOverBudgetSince >= dutySustainDownMs
        && now - this._lastPerfChangeAt >= cooldownMs
        && this._perfChangeBudgetAvailable(now)
            ) {
                // Prefer stepping the lever NOT already at its floor; if both are available, prefer the
                // one this engine is more sensitive to (bigger predicted duty drop from learned/exact
                // data) -- for a step DOWN both predictions are for tiers we're either already at (moot)
                // or already know the cost of on the way down, so this is a real (not estimated) choice.
                const canStepFps = !this._leverAtFloor('fps');
                const canStepRes = !this._leverAtFloor('res');

                if (!canStepFps && !canStepRes) {
                    this._perfFloorExhaustedCount += 1;
                    this._perfDutyOverBudgetSince = null;
                    if (this._perfFloorExhaustedCount >= PERF_FLOOR_EXHAUSTED_THRESHOLD) {
                        this._handlePerfFloorExhausted();
                    }
                } else {
                    this._perfFloorExhaustedCount = 0;
                    const fpsDutyAfter = canStepFps ? this._predictDutyAtNextTier('fps', -1) : null;
                    const resDutyAfter = canStepRes ? this._predictDutyAtNextTier('res', -1) : null;
                    const lever = this._chooseLever(canStepFps, canStepRes, fpsDutyAfter, resDutyAfter);

                    if (this._stepLever(lever, -1)) {
                        this._recordPerfChange(now);
                        this._perfDutyOverBudgetSince = null;
                    }
                }
            }

            return;
        }

        this._perfDutyOverBudgetSince = null;
        this._perfFloorExhaustedCount = 0;

        // Real, GO-2-found bug this fixes: the sustain timer used to reset to null on ANY single tick
        // where NEITHER lever's prediction cleared PERF_DUTY_UP, even though duty itself was
        // comfortable (< PERF_DUTY_DOWN). A noisy EMA sitting near the eligibility boundary flickers
        // eligibility tick to tick, which wiped out all sustained progress every time and meant the
        // sustain window effectively never completed in practice -- confirmed live in a real browser
        // (G1/G2/G3 never recovered a tier even with an 8x accelerated timescale). Fixed by making
        // "duty is comfortable" (this branch) the ONLY thing that accumulates/resets this timer;
        // per-lever eligibility is a snapshot taken once the window has already elapsed, not a
        // condition the timer itself depends on.
        this._perfDutyUnderBudgetSince ??= now;

        // Stepping up past what the network/call-size target already caps _getOutputSize to would
        // just be immediately re-capped there anyway -- only the resolution lever has that ceiling;
        // the fps lever has no network-driven ceiling (frame rate isn't sender-negotiated).
        const canStepUpRes = !this._leverAtCeiling('res') && this._perfCap < this._maxOutputHeight
      && now >= this._perfNextProbeAllowedAt.res;
        const canStepUpFps = !this._leverAtCeiling('fps') && now >= this._perfNextProbeAllowedAt.fps;

        if (!canStepUpRes && !canStepUpFps) {
            return; // nothing available right now (ceiling/backoff) -- keep the comfortable-time clock running for later
        }

        if (
            now - this._perfDutyUnderBudgetSince >= dutySustainUpMs
      && now - this._lastPerfChangeAt >= cooldownMs
      && this._perfChangeBudgetAvailable(now)
        ) {
            const fpsPredicted = canStepUpFps ? this._predictDutyAtNextTier('fps', 1) : null;
            const resPredicted = canStepUpRes ? this._predictDutyAtNextTier('res', 1) : null;
            // Only a lever whose PREDICTED next-tier duty is comfortably under budget is eligible --
            // this is what stops the governor probing a tier it already has good reason to expect will
            // just bounce it back down again. Checked ONLY here, now that the sustain window has
            // actually elapsed -- if neither is eligible THIS tick, simply don't step; the timer is NOT
            // reset, so the very next tick (or whenever the EMA settles) tries again immediately.
            const fpsEligible = fpsPredicted !== null && fpsPredicted.duty < PERF_DUTY_UP;
            const resEligible = resPredicted !== null && resPredicted.duty < PERF_DUTY_UP;

            if (!fpsEligible && !resEligible) {
                return;
            }

            // Prefer whichever eligible lever has the LOWER predicted duty (more headroom / this
            // engine is more sensitive to that lever, per the learned/exact data).
            const lever = this._chooseLever(fpsEligible, resEligible, fpsPredicted, resPredicted);

            if (this._stepLever(lever, 1)) {
                this._recordPerfChange(now);
                this._perfFloorWarned = false;
                this._perfPendingProbe = { at: now, lever };
            }
            this._perfDutyUnderBudgetSince = null;
        }
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
        // Fresh performance governor state -- a previous camera/effect instance's measured frame
        // times say nothing about this one (different resolution, different device might be in use).
        this._perfCap = PERF_TIERS[PERF_TIERS.length - 1];
        this._perfFpsCap = FPS_TIERS[FPS_TIERS.length - 1];
        this._frameMsEma = 0;
        this._perfDutyOverBudgetSince = null;
        this._perfDutyUnderBudgetSince = null;
        this._lastPerfChangeAt = 0;
        this._perfChangeTimestamps = [];
        this._perfFloorWarned = false;
        this._perfFloorExhaustedCount = 0;
        this._perfFloorExhaustedFallbackDone = false;
        // A fresh camera/device on a restarted instance might well be fast enough even if a previous
        // one wasn't -- give-up state is per-attempt, not permanent for the instance's whole lifetime.
        this._hasGivenUp = false;
        this._gaveUpAt = null;
        this._perfLearnedCostMs = new Map();
        this._perfProbeBackoffMs = { fps: PERF_PROBE_BACKOFF_BASE_MS, res: PERF_PROBE_BACKOFF_BASE_MS };
        this._perfNextProbeAllowedAt = { fps: 0, res: 0 };
        this._perfPendingProbe = null;
        this._govTimescale = readGovTimescale();
        // NOT reset: _engine. A device switch mid-call re-runs startEffect on this SAME instance --
        // if an earlier mid-call fallback already moved this effect to V1, a new camera device isn't
        // a reason to risk the same repeated MediaPipe failures again.
        this._mediaPipeConsecutiveErrors = 0;
        this._sourceTrack = firstVideoTrack;
        const settings = firstVideoTrack.getSettings ? firstVideoTrack.getSettings() : firstVideoTrack.getConstraints();
        const { height, frameRate, width } = settings as any;

        this._frameRate = parseInt(String(frameRate), 10) || 30;
        this._lastRenderElapsedMs = 0;
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

        // Phase 2c: fixed SEG_WIDTH x SEG_HEIGHT regardless of engine -- created unconditionally (like
        // _segmentationMaskCanvas above) since a mid-call fallback or a dev switching the engine flag
        // could need it later even if this effect started on v1.
        if (!this._mediaPipeInputCanvas) {
            this._mediaPipeInputCanvas = document.createElement('canvas');
            this._mediaPipeInputCanvas.width = this._mediaPipeSegWidth;
            this._mediaPipeInputCanvas.height = this._mediaPipeSegHeight;
            this._mediaPipeInputCtx = this._mediaPipeInputCanvas.getContext('2d');
        }

        this._startTimerLoop();
        // Phase 2b: window.__bgBench routes to whichever effect started most recently. Not a
        // this-alias in the sense the lint rule guards against (no closure capturing a stale
        // `this` across callbacks) -- it's a deliberate module-level registry of the active
        // instance for a dev console hook.
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        activeDebugEffect = this;

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
        if (activeDebugEffect === this) {
            activeDebugEffect = null;
        }
    }

    // Phase 2c: kept as a pure helper -- the minimum gap that must have elapsed since the last
    // render before another one is allowed, render-time-aware (elapsedRenderMs subtracted from the
    // target frame period) so a slow frame doesn't "borrow" from the next one and a fast frame
    // (mediapipe-gpu at 480p, for example) isn't held to a fixed 30fps ceiling it could exceed.
    // MIN_TICK_GAP_MS floors it so the main thread always gets idle time even when rendering is
    // very fast. The target period uses getCurrentFrameRate() (min of the camera's native rate and
    // the governor's fps lever) -- this is the ONLY place the fps lever actually changes runtime
    // behaviour; captureStream() itself is untouched (see getCurrentFrameRate's doc comment).
    _nextTickDelayMs(): number {
        return Math.max(MIN_TICK_GAP_MS, (1000 / this.getCurrentFrameRate()) - this._lastRenderElapsedMs);
    }

    // Real reported defect (2026-10-01): the previous loop drove _renderMask() off a Worker/
    // setTimeout timer with its own guessed delay, decoupled from when the camera actually delivers
    // a new frame -- it could re-render a frame it had already processed, or fire slightly out of
    // phase with real frame arrival, both visible as micro-stutter even when the average fps looked
    // fine. requestVideoFrameCallback instead fires exactly once per genuinely new decoded video
    // frame, giving the same tight native pacing a plain <video> playback gets. The fps governor
    // still gets a say: _nextTickDelayMs() (unchanged, still render-time-aware) gates whether THIS
    // particular frame callback actually renders, so a lowered fps tier still skips frames exactly
    // as before -- only the trigger that drives the loop has changed, not what decides to render.
    _startTimerLoop() {
        const onVideoFrame = () => {
            if (this._rvfcHandle === null) return; // stopped mid-flight; do not reschedule
            const now = Date.now();

            if (now - this._lastRenderAt >= this._nextTickDelayMs()) {
                this._lastRenderAt = now;
                try {
                    this._renderMask();
                } catch (error) {
                    // A transient draw failure must not permanently kill the frame loop.
                    if (!this._frameErrorReported) {
                        console.warn('[VirtualBackground] Frame processing failed:', error);
                        this._frameErrorReported = true;
                    }
                }
            }
            if (this._rvfcHandle !== null) {
                this._rvfcHandle = this._inputVideoElement.requestVideoFrameCallback(onVideoFrame);
            }
        };

        this._rvfcHandle = this._inputVideoElement.requestVideoFrameCallback(onVideoFrame);
    }

    _stopTimerLoop() {
        if (this._rvfcHandle !== null) {
            this._inputVideoElement.cancelVideoFrameCallback(this._rvfcHandle);
            this._rvfcHandle = null;
        }
    }

    runPostProcessing(sourceFrame: CanvasImageSource = this._inputVideoElement) {
        const track = this._stream?.getVideoTracks()[0];

        if (!track || !this._outputCanvasCtx) {
            return;
        }
        const settings = track.getSettings ? track.getSettings() : track.getConstraints();
        const { height, width } = settings as any;
        const { backgroundType } = this._options.virtualBackground;

        const nativeWidth = Number((sourceFrame as any).width) || this._inputVideoElement.videoWidth || Number(width) || 640;
        const nativeHeight = Number((sourceFrame as any).height) || this._inputVideoElement.videoHeight || Number(height) || 360;

        this._inputVideoElement.width = nativeWidth;
        this._inputVideoElement.height = nativeHeight;

        const { width: outWidth, height: outHeight } = this._getOutputSize(nativeWidth, nativeHeight);

        if (this._outputCanvasElement.height !== outHeight) this._outputCanvasElement.height = outHeight;
        if (this._outputCanvasElement.width !== outWidth) this._outputCanvasElement.width = outWidth;
        this._outputCanvasCtx.globalCompositeOperation = 'copy';
        // The mask is only SEG_WIDTH/MEDIAPIPE_SEG_WIDTH pixels wide and gets stretched up to the
        // full output size below -- often 4-8x. Without explicitly requesting high-quality smoothing,
        // a browser can fall back to a cheaper (blockier, more jagged-edged) scaling method for that
        // stretch. This is close to free and applies to every draw on this context, so it's set once
        // here rather than per-drawImage call.
        this._outputCanvasCtx.imageSmoothingEnabled = true;
        this._outputCanvasCtx.imageSmoothingQuality = 'high';

        // Draw the (blurred-edge) segmentation mask, scaled to the (possibly capped) output size.
        // Real reported defect (2026-09-30): the old ratio-scaled formula (tuned for an 8px/4px base
        // against a coarse source) landed around 7-8px at typical call resolutions once BOTH engines
        // settled on the same native 256x144 grid (MediaPipe's 512x288 experiment was reverted) --
        // that reads as a soft/"faded" edge, not the sharp-with-a-little-feather look asked for. Both
        // engines now also get an opacity-clamped, sharpened alpha (see sharpenMaskAlpha and
        // _sharpenV1Mask) before this draw, so the mask itself already commits to a clean edge; this
        // blur only needs to be enough to soften that edge's staircase/upscale blockiness, not to
        // hide a muddy/unshaped mask the way the old heavier blur was compensating for.
        const supportsFilter = 'filter' in this._outputCanvasCtx;
        // Real reported defect (2026-09-30): a fixed 2/2.5px blur was tuned against the output canvas,
        // but the mask itself is only ever this._options.width x this._options.height (256x144) --
        // stretched up to outWidth x outHeight, often a 4-8x jump at typical call resolutions. Each
        // mask pixel's hard-clamped (near-binary, see sharpenMaskAlpha) edge lands on a whole block of
        // output pixels, and a blur far narrower than that block (2-2.5px against a 4-8px block) barely
        // touches it -- visible as a staircase/blocky edge, worst on fine detail like hairline. The fix
        // is to scale the blur with the actual mask->output upscale factor so it spans roughly one
        // source-mask-pixel's footprint (enough to erase the block edges into a clean line), capped so
        // a very large call window doesn't drift into a soft/faded look.
        const maskUpscale = Math.max(outWidth / this._options.width, outHeight / this._options.height);
        const edgeBlurPx = Math.min(8, Math.max(2, maskUpscale * 0.6));

        if (supportsFilter) this._outputCanvasCtx.filter = `blur(${edgeBlurPx}px)`;
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
        this._outputCanvasCtx.drawImage(sourceFrame, 0, 0, nativeWidth, nativeHeight, 0, 0, outWidth, outHeight);

        // Draw the background behind everything else. Blur destroys fine detail, so drawing the full
        // native video into the full output size and THEN blurring it (as this used to do on any
        // browser with Canvas2D.filter) wastes almost all of that work -- it was a second full-
        // resolution draw of the whole camera frame every single frame, on top of the sharp foreground
        // draw above, and was the single heaviest part of the per-frame CPU cost: the extra work is
        // what dropped frames under load, visible as stutter/strobing especially while moving. Instead,
        // downsample first (same technique the old Safari-only fallback used, now used everywhere) --
        // a small blurred source scaled back up looks the same as a full-size one once blurred, for a
        // fraction of the pixels.
        this._outputCanvasCtx.globalCompositeOperation = 'destination-over';
        if (backgroundType === VIRTUAL_BACKGROUND_TYPE.IMAGE) {
            this._outputCanvasCtx.drawImage(this._virtualImage, 0, 0, outWidth, outHeight);
        } else {
            const scale = Math.max(4, this._options.virtualBackground.blurValue || 8);
            const bWidth = Math.max(1, Math.round(outWidth / scale));
            const bHeight = Math.max(1, Math.round(outHeight / scale));

            if (this._blurCanvas.width !== bWidth) this._blurCanvas.width = bWidth;
            if (this._blurCanvas.height !== bHeight) this._blurCanvas.height = bHeight;
            const context = this._blurCanvas.getContext('2d');

            if (context) {
                // A touch of real blur on the now-tiny source is nearly free and smooths out the
                // downsampling itself; browsers without Canvas2D.filter (older Safari) just skip it and
                // rely on the downsample + upscale alone, as before.
                if (supportsFilter) context.filter = 'blur(1px)';
                context.drawImage(sourceFrame, 0, 0, nativeWidth, nativeHeight, 0, 0, bWidth, bHeight);
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

    // Post-processing wrapper around runInference() -- NOT part of it, called separately from
    // _renderMask() so the pinned method above stays byte-for-byte untouched. Re-reads the alpha
    // channel runInference() just wrote, applies sharpenMaskAlpha (opaque body, thin feathered
    // edge -- see that function's comment) in place, and re-commits the result to the mask canvas.
    _sharpenV1Mask() {
        const data = this._segmentationMask.data;

        for (let i = 0; i < this._segmentationPixelCount; i++) {
            const alphaIndex = (i * 4) + 3;

            data[alphaIndex] = 255 * sharpenMaskAlpha(data[alphaIndex] / 255);
        }
        this._segmentationMaskCtx?.putImageData(this._segmentationMask, 0, 0);
    }

    // Resizes _options.width/height, the mask ImageData, the mask canvas, and _smoothedMask to
    // match a MediaPipe mask's actual reported size -- a no-op once the size stabilizes (MediaPipe
    // reports the same size every frame for a given camera/model pair in practice, but nothing
    // guarantees it can't change, e.g. a device switch). V1 never calls this -- its mask size is
    // the fixed SEG_WIDTH x SEG_HEIGHT set once in the constructor/startEffect, unchanged from
    // before Phase 2.
    _ensureMaskSize(width: number, height: number) {
        if (this._options.width === width && this._options.height === height) {
            return;
        }
        this._options.width = width;
        this._options.height = height;
        this._segmentationPixelCount = width * height;
        this._segmentationMask = new ImageData(width, height);
        if (this._segmentationMaskCanvas) {
            this._segmentationMaskCanvas.width = width;
            this._segmentationMaskCanvas.height = height;
        }
        // The smoothing EMA is meaningless across a resolution change (different pixel grid
        // entirely) -- same reasoning as the reset already done in startEffect for a fresh camera.
        this._smoothedMask = null;
    }

    // Blends one frame's raw per-pixel person-confidence values into _segmentationMask/
    // _smoothedMask using the SAME EMA formula runInference() uses (MASK_TEMPORAL_SMOOTHING) --
    // kept as its own copy rather than a shared helper so runInference() (V1's inference loop)
    // stays completely untouched, per Phase 2's "do not refactor the existing TFLite path" rule.
    _blendMaskValues(values: Float32Array) {
    // See the matching comment in runInference() -- same first-frame fade-in bug, same fix.
        const isFirstFrame = !this._smoothedMask || this._smoothedMask.length !== this._segmentationPixelCount;

        if (isFirstFrame) {
            this._smoothedMask = new Float32Array(this._segmentationPixelCount);
        }
        for (let i = 0; i < this._segmentationPixelCount; i++) {
            const person = values[i];
            let smoothed: number;

            if (isFirstFrame) {
                smoothed = person;
            } else {
                const prev = this._smoothedMask![i];
                const smoothingNow = motionAdaptiveSmoothing(person - prev, MEDIAPIPE_MASK_SMOOTHING_MIN, MEDIAPIPE_MASK_TEMPORAL_SMOOTHING);

                smoothed = (prev * smoothingNow) + (person * (1 - smoothingNow));
            }

            this._smoothedMask![i] = smoothed;
            this._segmentationMask.data[(i * 4) + 3] = 255 * sharpenMaskAlpha(smoothed);
        }
        this._segmentationMaskCtx?.putImageData(this._segmentationMask, 0, 0);
        this._fillSpatialHoles();
    }

    // Correct only demonstrably enclosed mask defects. A blanket blurred-mask fill was able to
    // bridge real background gaps between fingers because it had no evidence from the camera frame.
    // This bounded check works in the model's small coordinate space and performs no dilation.
    _fillSpatialHoles() {
        if (!this._segmentationMaskCtx || !this._mediaPipeInputCtx) return;
        const w = this._options.width;
        const h = this._options.height;
        let source: ImageData;

        try {
            source = this._mediaPipeInputCtx.getImageData(0, 0, w, h);
        } catch {
            return;
        }
        const original = new Uint8ClampedArray(this._segmentationMask.data);
        const luma = (index: number) => (source.data[index] * 0.2126) + (source.data[index + 1] * 0.7152) + (source.data[index + 2] * 0.0722);
        let changed = false;

        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                const pixel = ((y * w) + x) * 4;

                if (original[pixel + 3] > MASK_HOLE_CANDIDATE_ALPHA) continue;
                const neighbours = [ -w - 1, -w, -w + 1, -1, 1, w - 1, w, w + 1 ].map(offset => pixel + (offset * 4));

                if (neighbours.some(index => original[index + 3] < MASK_HOLE_FOREGROUND_ALPHA)) continue;
                const centerLuma = luma(pixel);
                const averageNeighbourLuma = neighbours.reduce((total, index) => total + luma(index), 0) / neighbours.length;

                if (Math.abs(centerLuma - averageNeighbourLuma) > MASK_HOLE_MAX_LUMA_DELTA) continue;
                this._segmentationMask.data[pixel + 3] = Math.min(...neighbours.map(index => original[index + 3]));
                changed = true;
            }
        }
        if (changed) {
            this._segmentationMaskCtx.putImageData(this._segmentationMask, 0, 0);
        }
    }

    // The MediaPipe engine's counterpart to resizeSource()+runInference() combined. Phase 2c change:
    // MediaPipe is now fed a small SEG_WIDTH x SEG_HEIGHT canvas (drawn from the video element with
    // the exact same drawImage call shape resizeSource() uses), not the raw camera-resolution video
    // element -- this is what keeps its returned mask at the same small fixed size V1 already uses,
    // instead of scaling with camera resolution (which was the real cause of the Phase 2 benchmark's
    // untimed blend-cost regression at 720p/1080p; see _blendMaskValues timing below).
    // Returns whether this frame's segmentation actually succeeded. The caller (_renderMask) uses
    // this to decide whether to composite at all this frame -- see that method's comment for why
    // compositing on a failure would mean drawing THIS frame's fresh camera image against the mask
    // canvas's last successful (now-stale) segmentation, which can visibly misalign for as long as
    // the failure streak lasts, not just the one frame a naive reading of "skip a frame" suggests.
    _runMediaPipeInference(sourceFrame: CanvasImageSource = this._inputVideoElement): boolean {
    // Phase 2b/2c timing -- reset every call so a failure before any measurement point still
    // reports something meaningful (0, not last frame's stale number) rather than lying to the
    // debug log/bench about how long this frame actually took.
        this._lastMediaPipeSegmentMs = 0;
        this._lastMediaPipeReadbackMs = 0;
        this._lastMediaPipeBlendMs = 0;
        const segmenter = this._mediaPipeSegmenter;

        if (!segmenter || !this._mediaPipeInputCtx || !this._mediaPipeInputCanvas) {
            this._handleMediaPipeFrameFailure(new Error('MediaPipe segmenter is not available'));

            return false;
        }
        const timestamp = getNextMediaPipeTimestamp();
        let mask: any = null;
        const segmentStart = Date.now();

        try {
            // Same source rect shape as resizeSource() -- see that method. Dest rect is
            // MEDIAPIPE_SEG_WIDTH/HEIGHT, not V1's SEG_WIDTH/HEIGHT -- see that constant's comment.
            this._mediaPipeInputCtx.drawImage(
          sourceFrame,
          0, 0, Number((sourceFrame as any).width) || this._inputVideoElement.width,
          Number((sourceFrame as any).height) || this._inputVideoElement.height,
          0, 0, this._mediaPipeSegWidth, this._mediaPipeSegHeight
            );

            const result = segmenter.segmentForVideo(this._mediaPipeInputCanvas, timestamp);

            this._lastMediaPipeSegmentMs = Date.now() - segmentStart;
            mask = result?.confidenceMasks?.[0];
            if (!mask) {
                throw new Error('MediaPipe returned no confidence mask');
            }
            // Person-vs-background polarity (confidenceMasks[0] = person, for this model) and mask
            // size are both read from the mask itself, never assumed -- see mask.width/mask.height and
            // the Phase 2 analysis on confidenceMasks[0] polarity. Expected to be SEG_WIDTH x SEG_HEIGHT
            // now (the size of the canvas just fed in), so _ensureMaskSize should only actually resize
            // anything on the very first frame.
            this._ensureMaskSize(mask.width, mask.height);
            const readbackStart = Date.now();
            const values = mask.getAsFloat32Array();

            this._lastMediaPipeReadbackMs = Date.now() - readbackStart;
            const blendStart = Date.now();

            this._blendMaskValues(values);
            this._lastMediaPipeBlendMs = Date.now() - blendStart;
            this._mediaPipeConsecutiveErrors = 0;

            return true;
        } catch (error) {
            if (this._lastMediaPipeSegmentMs === 0) {
                this._lastMediaPipeSegmentMs = Date.now() - segmentStart;
            }
            this._handleMediaPipeFrameFailure(error);

            return false;
        } finally {
            // Owned by this single frame regardless of outcome -- must be released every time,
            // including every error path above, or MediaPipe leaks the mask's backing memory.
            mask?.close?.();
        }
    }

    // A single bad frame is not unusual (a transient decode hiccup); MEDIAPIPE_CONSECUTIVE_ERROR_
    // FALLBACK_THRESHOLD consecutive ones means the engine itself is actually failing for this
    // call, so fall back to V1 instead of retrying forever and leaving the last good frame frozen.
    _handleMediaPipeFrameFailure(error: unknown) {
        this._mediaPipeConsecutiveErrors++;
        if (!this._frameErrorReported) {
            console.warn('[VirtualBackground] MediaPipe frame processing failed:', error);
            this._frameErrorReported = true;
        }
        if (this._mediaPipeConsecutiveErrors >= MEDIAPIPE_CONSECUTIVE_ERROR_FALLBACK_THRESHOLD) {
            const message = error instanceof Error ? error.message : String(error);

            this._lastFallbackReason = `${MEDIAPIPE_CONSECUTIVE_ERROR_FALLBACK_THRESHOLD} consecutive segmentation failures (last: ${message})`;
            try {
                this._onFallback?.(this._lastFallbackReason);
            } catch (err) {
                console.warn('[VirtualBackground] onFallback callback threw:', err);
            }
            this._fallBackToV1();
        }
    }

    // Switches this effect to the V1 engine for the rest of its life (see the "NOT reset: _engine"
    // note in startEffect). Loads the TFLite model on demand -- an effect that started on
    // MediaPipe never paid for V1's model download until it actually needs it. Until that load
    // finishes, _renderMask's MediaPipe branch keeps running (and keeps failing/retrying) rather
    // than doing nothing -- the canvas simply keeps showing its last successfully composited frame
    // in the meantime, same as any other skipped frame.
    _fallBackToV1() {
        if (this._engine === 'v1' || this._mediaPipeFallbackInProgress) {
            return;
        }
        this._mediaPipeFallbackInProgress = true;
        console.warn(`[VirtualBackground] MediaPipe failed repeatedly during this call (${this._lastFallbackReason ?? 'reason unknown'}) -- switching to the V1 engine for the rest of it.`);
        void (async () => {
            try {
                if (!this._loadV1Fallback) {
                    throw new Error('No V1 fallback loader was provided to this effect');
                }
                const { tflite } = await this._loadV1Fallback();

                this._model = tflite;
                this._smoothedMask = null;
                this._options.width = SEG_WIDTH;
                this._options.height = SEG_HEIGHT;
                this._segmentationPixelCount = SEG_WIDTH * SEG_HEIGHT;
                this._segmentationMask = new ImageData(SEG_WIDTH, SEG_HEIGHT);
                if (this._segmentationMaskCanvas) {
                    this._segmentationMaskCanvas.width = SEG_WIDTH;
                    this._segmentationMaskCanvas.height = SEG_HEIGHT;
                }
                this._engine = 'v1';
            } catch (err) {
                // Previously just logged and left the effect on the still-broken MediaPipe engine,
                // retrying (and failing) forever with no path back to a real, moving picture -- exactly
                // the "no reliable recovery to the raw camera" gap this closes. There is nowhere left to
                // fall back TO once V1 itself won't load, so give up (stops the effect, hands control
                // back via onGiveUp, which the caller uses to restore the raw camera track and tell the
                // user) instead of leaving them stuck on a frozen/broken effect indefinitely.
                console.warn('[VirtualBackground] Falling back to V1 also failed to load:', err);
                this._giveUp('MediaPipe failed repeatedly and the V1 fallback also failed to load');
            } finally {
                this._mediaPipeFallbackInProgress = false;
            }
        })();
    }

    _captureSourceFrame(): HTMLCanvasElement | null {
        const track = this._stream?.getVideoTracks()[0];
        const settings = track?.getSettings ? track.getSettings() : track?.getConstraints?.();
        const width = this._inputVideoElement.videoWidth || Number((settings as any)?.width) || 640;
        const height = this._inputVideoElement.videoHeight || Number((settings as any)?.height) || 360;

        if (!this._sourceFrameCanvas) {
            this._sourceFrameCanvas = document.createElement('canvas');
            this._sourceFrameCtx = this._sourceFrameCanvas.getContext('2d');
        }
        if (!this._sourceFrameCtx) return null;
        if (this._sourceFrameCanvas.width !== width || this._sourceFrameCanvas.height !== height) {
            this._sourceFrameCanvas.width = width;
            this._sourceFrameCanvas.height = height;
            // A changed camera geometry invalidates every position in temporal mask history.
            this._smoothedMask = null;
        }
        try {
            this._sourceFrameCtx.drawImage(this._inputVideoElement, 0, 0, width, height);

            return this._sourceFrameCanvas;
        } catch (error) {
            if (!this._frameErrorReported) {
                console.warn('[VirtualBackground] Could not capture a camera frame:', error);
                this._frameErrorReported = true;
            }

            return null;
        }
    }

    _renderMask() {
    // GO 3: once given up, this effect does no further work -- _giveUp already stopped the timer
    // loop, but this is a defensive no-op in case _renderMask is ever invoked directly (a test, a
    // stray call during teardown).
        if (this._hasGivenUp) return;
        // iOS may suspend capture while the tab is hidden or another app owns the camera.
        // Keep the last valid frame instead of segmenting a black/muted source into background-only video.
        if (document.hidden || !this._sourceTrack || this._sourceTrack.muted
      || !this._sourceTrack.enabled || this._sourceTrack.readyState !== 'live') return;
        if (this._inputVideoElement.readyState < 2) return;
        if (this._options.virtualBackground.backgroundType === VIRTUAL_BACKGROUND_TYPE.IMAGE
      && (!this._virtualImage.complete || !this._virtualImage.naturalWidth)) return;
        const sourceFrame = this._captureSourceFrame();

        if (!sourceFrame) return;
        // Date.now() (not performance.now()) deliberately -- millisecond resolution is plenty against
        // the ~12-26ms governor thresholds, and this keeps the timing usable in any environment.
        const frameStart = Date.now();
        let segmentationMs: number;
        let readbackMs = 0;
        let blendMs = 0;
        let segmentationSucceeded = true;

        if (this._engine === 'v1') {
            // Unchanged from before Phase 2 -- exactly resizeSource() then runInference(), in that
            // order, same as always. Timed from OUTSIDE (not by editing either method) so this stays
            // true for the "do not touch the V1 path" rule. blendMs stays 0: V1's equivalent blend work
            // is fused inside the untouched runInference() and reported as part of segmentationMs, same
            // as it always has been. runInference()/resizeSource() have no failure signal of their own
            // (they don't throw under normal operation), so segmentationSucceeded stays true here --
            // this fix is scoped to the MediaPipe path below, where _runMediaPipeInference DOES have a
            // real, observed failure mode (see that method's comment).
            const segmentStart = Date.now();

            this.resizeSource(sourceFrame);
            this.runInference();
            // Post-processing ONLY -- runInference() itself, above, is untouched (still pinned
            // byte-for-byte by the V1 SAFETY test). Applies the SAME edge-sharpening/opacity-clamp
            // curve MediaPipe already used (see sharpenMaskAlpha) to V1's raw alpha output, fixing a
            // reported real defect: a translucent/"faded" body and soft edges on V1 (which, unlike
            // MediaPipe, never had any shaping applied to its raw per-pixel confidence at all).
            this._sharpenV1Mask();
            segmentationMs = Date.now() - segmentStart;
        } else {
            segmentationSucceeded = this._runMediaPipeInference(sourceFrame);
            segmentationMs = this._lastMediaPipeSegmentMs;
            readbackMs = this._lastMediaPipeReadbackMs;
            blendMs = this._lastMediaPipeBlendMs;
        }

        const compositeStart = Date.now();

        // Skip compositing entirely on a failed frame instead of drawing THIS frame's fresh camera
        // image against the mask canvas's last successful (now stale) segmentation -- that mismatch
        // is what could show a misaligned/frozen-looking cutout for as long as a failure streak
        // lasts, not just a single skipped frame. The output canvas simply keeps showing its last
        // successfully composited frame instead, which reads as a brief pause, not a visible glitch.
        if (segmentationSucceeded) {
            this.runPostProcessing(sourceFrame);
        }
        const compositingMs = Date.now() - compositeStart;
        const totalMs = Date.now() - frameStart;

        this._lastRenderElapsedMs = totalMs;
        this._totalFrameCount += 1;

        // Governor input and the debug/bench accumulation are both measured on the SAME real
        // compositing work above and stop here -- the two optional debug draws below run strictly
        // after, so enabling them never skews the governor's own decisions or the numbers being
        // measured.
        this._updatePerfGovernor(totalMs);
        this._updateDebugMetrics(totalMs, segmentationMs, readbackMs, blendMs, compositingMs);

        if (isMaskDebugEnabled()) {
            this._drawMaskDebugOverlay();
        }
        if (isOverlayDebugEnabled()) {
            this._drawDebugTextOverlay();
        }
    }

    // Phase 2b: accumulates this frame's timings into the once-per-second debug bucket (always --
    // cheap bookkeeping, not a visible behaviour change) and, if a benchmark is currently running
    // (see runBenchmark), into its raw sample arrays. Printing to the console remains gated by
    // DEBUG_PERF_LOG, same flag as before Phase 2b; the once-per-second averages themselves are
    // also cached on the instance so the text overlay (a separate flag) can draw them without
    // needing DEBUG_PERF_LOG on too.
    _updateDebugMetrics(totalMs: number, segmentationMs: number, readbackMs: number, blendMs: number, compositingMs: number) {
        const droppedThisFrame = totalMs > 1000 / 30;

        this._debugAccum.total += totalMs;
        this._debugAccum.segmentation += segmentationMs;
        this._debugAccum.readback += readbackMs;
        this._debugAccum.blend += blendMs;
        this._debugAccum.compositing += compositingMs;
        this._debugAccum.count += 1;
        if (droppedThisFrame) {
            this._debugAccum.droppedFrames += 1;
        }

        if (this._benchSamples) {
            this._benchSamples.total.push(totalMs);
            this._benchSamples.segmentation.push(segmentationMs);
            this._benchSamples.readback.push(readbackMs);
            this._benchSamples.blend.push(blendMs);
            this._benchSamples.compositing.push(compositingMs);
            if (droppedThisFrame) {
                this._benchDroppedFrames += 1;
            }
        }

        const now = Date.now();

        if (now - this._lastDebugLogAt < 1000) {
            return;
        }
        this._lastDebugLogAt = now;

        const count = this._debugAccum.count || 1;
        // performance.memory is Chrome-only and non-standard -- absent elsewhere, and that's fine,
        // it's simply left out of the metrics object rather than reported as 0 (which would look
        // like "no heap growth" instead of "not measurable here").
        const heapBytes = (globalThis.performance as any)?.memory?.usedJSHeapSize;
        const avgTotalMs = this._debugAccum.total / count;
        const avgSegmentationMs = this._debugAccum.segmentation / count;
        const avgReadbackMs = this._debugAccum.readback / count;
        const avgBlendMs = this._debugAccum.blend / count;
        const avgCompositingMs = this._debugAccum.compositing / count;

        this._lastOverlayMetrics = {
            engine: this._engine,
            // Diagnostics (EDGE-STATUS task item 1): distinguishes "always been this engine" from "fell
            // back here mid-call" -- engineAtStart never changes, engine can (see _fallBackToV1).
            engineAtStart: this._engineAtStart,
            fallbackReason: this._lastFallbackReason ?? 'none',
            outputHeight: Math.min(this._maxOutputHeight, this._perfCap),
            fpsTier: this._perfFpsCap,
            // Diagnostics (?bgSegSize=256|512 A/B override) -- only meaningful for the MediaPipe
            // engines; V1 always segments at its own fixed SEG_WIDTH/HEIGHT (256x144), unaffected by
            // this override, so it's shown regardless of engine rather than only when MediaPipe-active.
            mediaPipeSegSize: `${this._mediaPipeSegWidth}x${this._mediaPipeSegHeight}`,
            avgTotalMs: roundTo1Decimal(avgTotalMs),
            avgSegmentationMs: roundTo1Decimal(avgSegmentationMs),
            avgReadbackMs: roundTo1Decimal(avgReadbackMs),
            avgBlendMs: roundTo1Decimal(avgBlendMs),
            avgCompositingMs: roundTo1Decimal(avgCompositingMs),
            // What's left of avgTotalMs once every timed sub-metric is subtracted -- should be small and
            // stable; a large or growing residual means some real cost still isn't being timed.
            residualMs: roundTo1Decimal(avgTotalMs - avgSegmentationMs - avgReadbackMs - avgBlendMs - avgCompositingMs),
            droppedFrames: this._debugAccum.droppedFrames,
            totalFrameCount: this._totalFrameCount,
            ...(typeof heapBytes === 'number' ? { jsHeapMB: roundTo1Decimal(heapBytes / (1024 * 1024)) } : {})
        };

        if (DEBUG_PERF_LOG) {
            // eslint-disable-next-line no-console
            console.info('[VirtualBackground][perf]', this._lastOverlayMetrics);
        }

        this._debugAccum = { blend: 0, compositing: 0, count: 0, droppedFrames: 0, readback: 0, segmentation: 0, total: 0 };
    }

    // Dev-only (toowix_bg_debug_mask=1): overwrites the mask canvas with a full-frame grayscale
    // visualization of the raw person-confidence values (so polarity/alignment can be judged by
    // eye), draws it over the ALREADY-COMPOSITED output canvas, then restores the mask canvas's
    // real alpha-only contents -- next frame's segmentation overwrites it again regardless, but
    // restoring immediately keeps this method self-contained rather than relying on that.
    _drawMaskDebugOverlay() {
        if (!this._outputCanvasCtx || !this._segmentationMaskCtx || !this._segmentationMaskCanvas) {
            return;
        }
        const w = this._options.width;
        const h = this._options.height;
        let visual: ImageData;

        try {
            visual = this._segmentationMaskCtx.getImageData(0, 0, w, h);
        } catch {
            return;
        }
        const data = visual.data;

        for (let i = 0; i < data.length; i += 4) {
            const gray = data[i + 3];

            data[i] = gray;
            data[i + 1] = gray;
            data[i + 2] = gray;
            data[i + 3] = 255;
        }
        this._segmentationMaskCtx.putImageData(visual, 0, 0);
        const previousComposite = this._outputCanvasCtx.globalCompositeOperation;

        this._outputCanvasCtx.globalCompositeOperation = 'source-over';
        this._outputCanvasCtx.drawImage(
        // @ts-ignore
        this._segmentationMaskCanvas,
        0, 0, w, h,
        0, 0, this._outputCanvasElement.width, this._outputCanvasElement.height
        );
        this._outputCanvasCtx.globalCompositeOperation = previousComposite;
        // Restore the real (alpha-only) mask -- this._segmentationMask still holds this frame's
        // actual blended values, untouched by the grayscale visualization above.
        this._segmentationMaskCtx.putImageData(this._segmentationMask, 0, 0);
    }

    // Dev-only (toowix_bg_debug_overlay=1): draws the same numbers _updateDebugMetrics computes
    // once a second as a small text block on the output canvas, so a screenshot of a call captures
    // which engine/delegate produced it and its measured cost -- independent of DEBUG_PERF_LOG,
    // which only controls whether the SAME numbers also go to the console.
    _drawDebugTextOverlay() {
        if (!this._outputCanvasCtx || !this._lastOverlayMetrics) {
            return;
        }
        const metrics = this._lastOverlayMetrics;
        const lines = [
            `engine: ${metrics.engine}${metrics.engineAtStart !== metrics.engine ? ` (started: ${metrics.engineAtStart})` : ''}`,
            `fallback: ${metrics.fallbackReason}`,
            `out: ${metrics.outputHeight}p @ ${metrics.fpsTier}fps`,
            `seg size: ${metrics.mediaPipeSegSize}`,
            `total: ${metrics.avgTotalMs}ms`,
            `seg: ${metrics.avgSegmentationMs}ms`,
            `readback: ${metrics.avgReadbackMs}ms`,
            `blend: ${metrics.avgBlendMs}ms`,
            `composite: ${metrics.avgCompositingMs}ms`,
            `residual: ${metrics.residualMs}ms`,
            `dropped: ${metrics.droppedFrames}`,
            `frames: ${metrics.totalFrameCount}`,
            ...(metrics.jsHeapMB !== undefined ? [ `heap: ${metrics.jsHeapMB}MB` ] : [])
        ];
        const ctx = this._outputCanvasCtx;
        const padding = 6;
        const lineHeight = 14;
        const boxWidth = 170;
        const boxHeight = (padding * 2) + (lineHeight * lines.length);
        const previousComposite = ctx.globalCompositeOperation;

        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(4, 4, boxWidth, boxHeight);
        ctx.fillStyle = '#00FF00';
        ctx.font = '11px monospace';
        lines.forEach((line, i) => ctx.fillText(line, 4 + padding, 4 + padding + (lineHeight * (i + 1)) - 4));
        ctx.globalCompositeOperation = previousComposite;
    }

    // Dev console entry point (see the window.__bgBench registration below): collects RAW per-frame
    // samples (not the once-a-second averages _updateDebugMetrics keeps) for exactly `seconds`,
    // then resolves with min/average/p95/max for each timing plus fps and dropped-frame count.
    // Independent of DEBUG_PERF_LOG/the overlay flags -- works whether or not either is enabled.
    runBenchmark(seconds: number) {
        return new Promise(resolve => {
            this._benchSamples = { blend: [], compositing: [], readback: [], segmentation: [], total: [] };
            this._benchDroppedFrames = 0;
            const startedAt = Date.now();
            const startFrameCount = this._totalFrameCount;

            setTimeout(() => {
                const samples = this._benchSamples;

                this._benchSamples = null;
                const frames = samples ? samples.total.length : 0;
                const elapsedSeconds = (Date.now() - startedAt) / 1000;
                const total = computeStats(samples?.total ?? []);
                const segmentation = computeStats(samples?.segmentation ?? []);
                const readback = computeStats(samples?.readback ?? []);
                const blend = computeStats(samples?.blend ?? []);
                const compositing = computeStats(samples?.compositing ?? []);

                resolve({
                    engine: this._engine,
                    frames,
                    // Monotonic counter delta -- unlike `frames` above (raw sample-array length, reset by
                    // this same call), this is unaffected by any other concurrent bench/debug bookkeeping.
                    totalFramesDelta: this._totalFrameCount - startFrameCount,
                    fps: elapsedSeconds > 0 ? roundTo1Decimal(frames / elapsedSeconds) : 0,
                    droppedFrames: this._benchDroppedFrames,
                    total,
                    segmentation,
                    readback,
                    blend,
                    compositing,
                    // segmentation + readback + blend + compositing should sum close to total; this is
                    // what's left over when they don't, computed from the same average each row already
                    // reports rather than a separate measurement.
                    residualMs: roundTo1Decimal(
              total.average - segmentation.average - readback.average - blend.average - compositing.average
                    )
                });
            }, Math.max(0, seconds) * 1000);
        });
    }

    resizeSource(sourceFrame: CanvasImageSource = this._inputVideoElement) {
        this._segmentationMaskCtx?.drawImage(
        sourceFrame,
        0, 0, Number((sourceFrame as any).width) || this._inputVideoElement.width,
        Number((sourceFrame as any).height) || this._inputVideoElement.height,
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

// Returns a rejected promise rather than throwing synchronously if nothing is active, since
// callers await it from a console. GO 3 hardening: excluded from production builds outright (see
// isProductionBuild's comment in backgroundDebugTools.ts) -- this was previously registered
// unconditionally for every user, a real gap this closes, not just a theoretical one.
if (typeof window !== 'undefined' && !(import.meta as any)?.env?.PROD) {
    (window as any).__bgBench = (seconds: number) => {
        if (!activeDebugEffect) {
            return Promise.reject(new Error('No virtual background effect is currently active.'));
        }

        return activeDebugEffect.runBenchmark(seconds);
    };
}

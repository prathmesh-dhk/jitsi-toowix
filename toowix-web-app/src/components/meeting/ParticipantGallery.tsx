// Extracted from MeetingRoomPage.tsx (Track 3, Phase 2, item 5 -- the highest-stakes extraction in
// the whole plan). Owns everything the gallery concern needs internally: stage measurement, the
// mobile 2-column/8-per-page pagination + swipe logic, the layout calculator, and the structural
// FLIP animation -- none of this state is read anywhere else on the page (confirmed by grep before
// extracting), so it's fully self-contained rather than needing a separate hook + component split.
// Moved verbatim; no behavior change. Verified post-extraction with the project's own headless-
// Chrome gallery test suite (tests/meeting-gallery-browser.cjs, tests/meeting-gallery-layout.test.cjs)
// against the live dev server, not just tsc/build -- see the Track 3 report for exact results.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  calculateCellPositions,
  calculateMobileAspectAwareLayout,
  MOBILE_GALLERY_TILES_PER_PAGE,
  useStableMeetingLayout,
  useStableMixedAspectLayout,
  type MixedAspectCardInput,
} from '../../lib/meetingLayout';
import { animateGalleryCell, readVisualFrame } from '../../lib/galleryMotion';
import { logGalleryDebug } from '../../lib/galleryOrientationDebug';
import type { GalleryFrame } from '../../lib/galleryMotion';
import { getParticipantColorTheme, type IParticipantColorTheme } from '../../lib/participantColorTheme';
import { isSpeakingNow } from '../../lib/speakingStore';
import { ScreenShareTile } from '../ScreenShareTile';
import { MeetingParticipantCard } from '../MeetingParticipantCard';

// Keep this in lockstep with the mobile CSS in MeetingRoomPage.tsx. A coarse-pointer landscape
// phone can be wider than the portrait breakpoint, so it needs its own clause rather than falling
// back to the desktop gallery calculator after rotation.
const MOBILE_GALLERY_MEDIA_QUERY = '(max-width: 768px), (max-width: 1024px) and (pointer: coarse) and (orientation: landscape)';
const GALLERY_SWIPE_MIN_DISTANCE_PX = 48;
const GALLERY_GAP = 12;

export interface IParticipantGalleryShare {
  key: string;
  stream: MediaStream | null;
  name: string;
}

export interface IParticipantGalleryRemote {
  id: string;
  name: string;
  avatarUrl?: string | null;
  muted: boolean;
  video: boolean;
  raisedHand?: boolean;
  stream?: MediaStream | null;
}

export interface IParticipantGalleryProps {
  allShares: IParticipantGalleryShare[];
  remoteParticipants: IParticipantGalleryRemote[];
  displayName: string;
  localAvatarUrl?: string | null;
  inCallStream: MediaStream | null;
  inCallVideo: boolean;
  inCallMuted: boolean | null;
  isHandRaised: boolean;
  localTheme: IParticipantColorTheme;
  isSpeaking: boolean;
  setInCallVideoNode: (node: HTMLVideoElement | null) => void;
  pinnedParticipantId: string | null;
  setPinnedManually: (id: string | null) => void;
  setTileViewEnabled: (value: boolean) => void;
  isModerator: boolean;
  handleRemoteAudioControl: (participantId: string) => void;
  activePanel: 'chat' | 'people' | 'info' | 'host' | 'activities' | null;
}

export function ParticipantGallery({
  allShares, remoteParticipants, displayName, localAvatarUrl, inCallStream, inCallVideo, inCallMuted,
  isHandRaised, localTheme, isSpeaking, setInCallVideoNode, pinnedParticipantId, setPinnedManually,
  setTileViewEnabled, isModerator, handleRemoteAudioControl, activePanel,
}: IParticipantGalleryProps) {
  // The gallery stage is the exact area the cards are placed in: a flex child with no padding,
  // inside the padded .tw-grid. Measuring it (not the window or the canvas) keeps the calculator
  // and the placed cards on one set of numbers. Cards are absolutely positioned, so they cannot
  // enlarge the stage they measure.
  // BUG FOUND AND FIXED DURING THIS EXTRACTION (not present in the moved behavior otherwise --
  // flagging clearly since this is an actual logic change, not a verbatim move): the original
  // code created the ResizeObserver inside the ref CALLBACK (fires exactly once per DOM node,
  // never re-run by React) but disconnected it from a separate teardown-only useEffect. Under
  // React StrictMode (this app wraps its root in <React.StrictMode>, confirmed in main.tsx),
  // every effect's cleanup+setup is deliberately double-invoked once in dev -- for a normal
  // effect that's harmless, but a teardown-only effect has no matching "setup" half to recreate
  // what it tears down. The net effect: StrictMode's double-invoke disconnected the observer
  // immediately after the very first measurement, with nothing left to ever reconnect it -- the
  // gallery would silently freeze at whatever size it was on mount and never resize again. This
  // was caught by the project's own headless-Chrome gallery tests after extraction (not by tsc
  // or the build, which can't see this), diagnosed by instrumenting the observer call counts,
  // confirmed with an independent control ResizeObserver on the same DOM node (which did keep
  // firing), and is now fixed by using the standard StrictMode-safe pattern: the DOM node lives
  // in state (so it's a proper effect dependency), and setup + cleanup are the two halves of the
  // SAME effect, which StrictMode's double-invoke runs as a matched pair instead of only ever
  // running the teardown half.
  const galleryStageRef = useRef<HTMLDivElement | null>(null);
  const [galleryStageNode, setGalleryStageNode] = useState<HTMLDivElement | null>(null);
  const [galleryStageSize, setGalleryStageSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    galleryStageRef.current = galleryStageNode;
    if (!galleryStageNode) return;
    const node = galleryStageNode;

    const commitStageSize = (width: number, height: number) => {
      setGalleryStageSize((previous) => (
        Math.abs(previous.width - width) < 0.5 && Math.abs(previous.height - height) < 0.5
          ? previous
          : { width, height }
      ));
    };
    const initial = node.getBoundingClientRect();

    commitStageSize(initial.width, initial.height);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      // One callback per frame, after layout and before paint. Using the latest entry means a burst of
      // resize notifications collapses into one geometry update. Committing synchronously here keeps the
      // cards and the placed cards geometry in the same frame: a deferred commit would paint a frame with
      // the old card geometry inside the new stage size.
      const box = entries[entries.length - 1]?.contentRect;

      if (box) flushSync(() => commitStageSize(box.width, box.height));
    });

    observer.observe(node);

    return () => observer.disconnect();
  }, [galleryStageNode]);

  // Gallery sizing is computed unconditionally (not gated on any parent condition) because
  // useStableMeetingLayout is a real hook. Its previous-structure ref must persist across renders.
  // Every gallery cell, in display order: screen shares first, then the local card, then remote participants.
  // Cells are keyed by these stable ids, so a card keeps its DOM node (and its <video>) across any change of
  // structure, size or position around it.
  const galleryAllCellKeys = [
    ...allShares.map((share) => `share:${share.key}`),
    'local',
    ...remoteParticipants.map((remote, idx) => `remote:${remote.id || idx}`),
  ];

  // Mobile tile view: 1-3 participants keep today's unconstrained layout untouched (see
  // calculateMeetingLayout). 4+ always use a fixed 2-column grid, paginated to
  // MOBILE_GALLERY_TILES_PER_PAGE (local tile included) per page, navigated by a horizontal swipe.
  // "Mobile" is the exact same breakpoint this page's own CSS already uses elsewhere (the pre-join
  // screen): a narrow portrait viewport, or a touch device in landscape up to 1024px wide (many
  // phones exceed 768px wide in landscape). Resolved via matchMedia (not a one-time check) so
  // rotating the device re-evaluates it.
  const [isMobileGallery, setIsMobileGallery] = useState(() => (
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia(MOBILE_GALLERY_MEDIA_QUERY).matches
  ));
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(MOBILE_GALLERY_MEDIA_QUERY);
    const update = () => setIsMobileGallery(query.matches);

    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  // Keyed off the TOTAL participant count, not any one page's count, so a short last page (e.g.
  // one tile left over after paginating) still forces 2-column sizing instead of being treated as
  // a lone "solo" tile that fills the whole stage.
  const mobileGalleryPaged = isMobileGallery && galleryAllCellKeys.length >= 4;
  const galleryTotalPages = mobileGalleryPaged
    ? Math.max(1, Math.ceil(galleryAllCellKeys.length / MOBILE_GALLERY_TILES_PER_PAGE))
    : 1;
  const [galleryPageIndex, setGalleryPageIndex] = useState(0);
  // Clamps the committed page when the page count shrinks (participants leaving, or dropping out
  // of paginated mode entirely) so navigating back to a page that no longer exists can't leave the
  // gallery "stuck" on an empty page.
  const safeGalleryPageIndex = Math.min(Math.max(galleryPageIndex, 0), galleryTotalPages - 1);
  useEffect(() => {
    if (safeGalleryPageIndex !== galleryPageIndex) setGalleryPageIndex(safeGalleryPageIndex);
  }, [safeGalleryPageIndex, galleryPageIndex]);
  const galleryPageStart = safeGalleryPageIndex * MOBILE_GALLERY_TILES_PER_PAGE;
  const galleryCellKeys = mobileGalleryPaged
    ? galleryAllCellKeys.slice(galleryPageStart, galleryPageStart + MOBILE_GALLERY_TILES_PER_PAGE)
    : galleryAllCellKeys;

  // Swipe left -> next page, swipe right -> previous page. No wraparound: there's no existing
  // wraparound convention anywhere else in this app (checked), so the first/last page simply
  // clamps. A swipe is only recognised once it clearly exceeds both a minimum distance and the
  // vertical movement, so an ordinary tap/double-tap on a tile is unaffected; there is no existing
  // pinch or other swipe gesture anywhere in this app's mobile UI to conflict with (checked), so
  // this is a small dependency-free touch handler rather than reusing an existing mechanism.
  const gallerySwipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const onGalleryTouchStart = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (!mobileGalleryPaged || galleryTotalPages <= 1) return;
    const touch = event.touches[0];

    gallerySwipeStartRef.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  }, [mobileGalleryPaged, galleryTotalPages]);
  const onGalleryTouchEnd = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    const start = gallerySwipeStartRef.current;

    gallerySwipeStartRef.current = null;
    if (!start || !mobileGalleryPaged || galleryTotalPages <= 1) return;
    const touch = event.changedTouches[0];

    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;

    if (Math.abs(dx) < GALLERY_SWIPE_MIN_DISTANCE_PX || Math.abs(dx) < Math.abs(dy)) return;
    setGalleryPageIndex((page) => Math.min(Math.max(dx < 0 ? page + 1 : page - 1, 0), galleryTotalPages - 1));
  }, [mobileGalleryPaged, galleryTotalPages]);

  const galleryLayout = useStableMeetingLayout({
    participantCount: galleryCellKeys.length,
    // Measured from the stage, the exact area the cells are placed in. Zero until the first measurement.
    width: Math.max(1, galleryStageSize.width),
    height: Math.max(1, galleryStageSize.height),
    mode: 'gallery',
    sidePanelOpen: Boolean(activePanel),
    gap: GALLERY_GAP,
    forceColumns: mobileGalleryPaged ? 2 : undefined,
  });
  const galleryMeasured = galleryStageSize.width > 0 && galleryStageSize.height > 0;
  const galleryPositions = calculateCellPositions(
    galleryCellKeys.length, galleryLayout, galleryStageSize.width, galleryStageSize.height, GALLERY_GAP,
  );

  // Per-participant real video aspect ratio (bucketed, see videoOrientation.ts), reported upward
  // by each MeetingParticipantCard via onAspectRatioChange -- null means "no live video right
  // now" (camera off, no stream), reported IMMEDIATELY from authoritative videoEnabled/stream
  // state, not guessed by this card itself. Screen shares always stay 16:9 (their own tile type,
  // never reports here).
  const [ cellRatios, setCellRatios ] = useState<Map<string, number | null>>(new Map());
  const setCellRatio = useCallback((key: string, ratio: number | null) => {
    setCellRatios((previous) => {
      if (previous.get(key) === ratio) return previous;
      const next = new Map(previous);

      next.set(key, ratio);

      return next;
    });
  }, []);
  // Dropping a departed participant's remembered ratio isn't required for correctness (unused
  // entries are simply never read), but keeps the map from growing across a long call's worth of
  // joins/leaves.
  useEffect(() => {
    setCellRatios((previous) => {
      const liveKeys = new Set(galleryAllCellKeys);
      let changed = false;
      const next = new Map(previous);

      previous.forEach((_, key) => {
        if (!liveKeys.has(key)) {
          next.delete(key);
          changed = true;
        }
      });

      return changed ? next : previous;
    });
    // galleryAllCellKeys is a fresh array every render; comparing its CONTENT (join) is what
    // actually matters here, not object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ galleryAllCellKeys.join(',') ]);

  // Camera-off fallback ratio depends on how many participants are actually in the gallery, per
  // the adaptive-gallery spec: a small call (2-3) keeps the familiar 16:9 default; once the
  // gallery is dense enough (4+) a more compact 4:3 shape fits noticeably more cards per row for
  // every camera-off participant, without affecting anyone whose camera is actually on (an active
  // portrait/landscape ratio always wins -- cellRatios.get(key) is only null/absent when there is
  // no live video to measure).
  const cameraOffDefaultRatio = galleryCellKeys.length <= 3 ? 16 / 9 : 4 / 3;
  const mixedAspectCards: MixedAspectCardInput[] = galleryCellKeys.map((key) => ({
    key,
    ratio: key.startsWith('share:') ? 16 / 9 : (cellRatios.get(key) ?? cameraOffDefaultRatio),
  }));
  const mixedLayout = useStableMixedAspectLayout(
    mixedAspectCards, galleryStageSize.width, galleryStageSize.height, GALLERY_GAP,
  );
  const mixedCellFramesByKey = new Map(mixedLayout.cells.map((cell) => [ cell.key, cell ]));

  // Mobile 4+ Gallery View: the fixed 2-column/8-per-page pagination itself (above) stays
  // untouched, but each page's own cell GEOMETRY now comes from the aspect-aware packer instead of
  // the old uniform crop-to-fill grid (TOOWIX_MOBILE_PORTRAIT_GALLERY_FIX_PLAN.md fixes 1-2): a
  // real 9:16 portrait stream renders as a genuinely 9:16 outer card, not a square/landscape cell
  // with the video merely letterboxed inside it. This is a plain pure-function call, not a hook --
  // no hysteresis is needed here because the row PAIRING is derived only from this page's card
  // count (ceil(n/2)), never from stage size, so there is no structural ambiguity to hold stable
  // against the way there is for the general mixed-aspect engine's row-count search; only the
  // continuous scale factor changes on resize, which is already smooth.
  const mobileAspectLayout = calculateMobileAspectAwareLayout(
    mixedAspectCards, galleryStageSize.width, galleryStageSize.height, GALLERY_GAP,
  );
  const mobileAspectFramesByKey = new Map(mobileAspectLayout.cells.map((cell) => [ cell.key, cell ]));

  // Exactly 4 participants (non-mobile-paginated) is a dedicated case: the justified-row mixed-
  // aspect packer above treats a portrait participant as its own narrow column (or its own tall,
  // unevenly-sized row), which reads as a lopsided, unstable grid rather than the classic
  // "balanced 2x2" every 4-person video call is expected to look like. Instead, reuse the
  // ORIGINAL, already-stable uniform engine (calculateMeetingLayout/calculateCellPositions) to
  // give all 4 cells one shared, equal size -- it already auto-balances between 16:9 and 4:3 for
  // whatever uses the stage best, it's never literally forcing 16:9. A portrait participant's
  // video still shows in full (never cropped/distorted): MeetingParticipantCard's own
  // adaptiveObjectFit switches to 'contain' for a portrait source regardless of the outer cell's
  // own shape, so the video letterboxes neatly inside its equal-sized 2x2 cell instead of the cell
  // itself being reshaped around it. This dedicated case is unaffected by the mobile aspect-aware
  // packer above, which only ever applies while mobileGalleryPaged is true.
  const useUniformFourGrid = !mobileGalleryPaged && galleryCellKeys.length === 4;
  const cellFrames = galleryCellKeys.map((key, index) => {
    if (mobileGalleryPaged) {
      return mobileAspectFramesByKey.get(key)
        ?? { key, left: 0, top: 0, width: galleryLayout.cardWidth, height: galleryLayout.cardHeight };
    }
    if (useUniformFourGrid) {
      return { key, ...galleryPositions[index], width: galleryLayout.cardWidth, height: galleryLayout.cardHeight };
    }

    return mixedCellFramesByKey.get(key) ?? { key, left: 0, top: 0, width: galleryLayout.cardWidth, height: galleryLayout.cardHeight };
  });
  const cellFramesByKey = new Map(cellFrames.map((frame) => [ frame.key, frame ]));
  const galleryStructureKey = mobileGalleryPaged
    ? `mobile-aspect:${safeGalleryPageIndex}:${mobileAspectLayout.rows}:${mixedAspectCards.map((c) => `${c.key}@${c.ratio.toFixed(3)}`).join(',')}`
    : useUniformFourGrid
      ? `uniform4:${galleryLayout.columns}x${galleryLayout.rows}:${galleryLayout.ratio}`
      : `mixed:${mixedLayout.rows}:${mixedAspectCards.map((c) => `${c.key}@${c.ratio.toFixed(3)}`).join(',')}`;

  // TEMPORARY diagnostic (see galleryOrientationDebug.ts) -- logs the exact ratio map the gallery
  // is working from and which layout path/engine was selected, only when that structure actually
  // changes (not every render), so a "ratio arrived correctly but the card stayed landscape"
  // report can be distinguished from "the ratio itself never arrived".
  const debugLoggedStructureRef = useRef('');
  useEffect(() => {
    if (galleryStructureKey === debugLoggedStructureRef.current) return;
    debugLoggedStructureRef.current = galleryStructureKey;
    logGalleryDebug('gallery layout selection', {
      viewMode: mobileGalleryPaged ? 'mobile-paginated-aspect-aware-grid' : useUniformFourGrid ? 'four-participant-uniform-2x2' : 'gallery-mixed-aspect',
      cellRatios: Object.fromEntries(cellRatios),
      cameraOffDefaultRatio,
      mixedAspectCards,
      finalCellFrames: cellFrames,
    });
    // cellFrames/cellRatios/mixedAspectCards are freshly built every render; the dependency that
    // actually matters is whether the STRUCTURE (key) changed, checked above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ galleryStructureKey ]);

  // Only an intentional structure change animates. Ordinary size updates and unrelated renders leave running
  // animations alone. Only animations this effect started are cancelled, never all of a card's animations.
  const galleryFramesRef = useRef<Map<string, GalleryFrame>>(new Map());
  const galleryStructureRef = useRef('');
  const galleryAnimationsRef = useRef<Map<string, Animation>>(new Map());
  useLayoutEffect(() => {
    const animations = galleryAnimationsRef.current;
    const cancelAnimation = (key: string) => {
      animations.get(key)?.cancel();
      animations.delete(key);
    };
    const stage = galleryStageRef.current;

    if (!stage) {
      animations.forEach((_, key) => cancelAnimation(key));
      galleryFramesRef.current = new Map();
      galleryStructureRef.current = '';

      return;
    }

    const frames = new Map<string, GalleryFrame>();

    galleryCellKeys.forEach((key) => {
      const frame = cellFramesByKey.get(key);

      if (frame) frames.set(key, { left: frame.left, top: frame.top, width: frame.width, height: frame.height });
    });

    const previousFrames = galleryFramesRef.current;
    const structureChanged = galleryStructureRef.current !== '' && galleryStructureRef.current !== galleryStructureKey;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    if (structureChanged) {
      stage.querySelectorAll<HTMLElement>('[data-gallery-cell]').forEach((node) => {
        const key = node.dataset.galleryCell ?? '';
        const from = previousFrames.get(key);
        const to = frames.get(key);
        // Read where the cell is visibly drawn before cancelling, so an interrupted slide continues from its
        // current place rather than snapping to a stale one.
        const visible = from ? readVisualFrame(node, from) : null;

        cancelAnimation(key);
        if (!visible || !to || reduceMotion) return;

        const animation = animateGalleryCell(node, visible, to);

        if (!animation) return;
        animations.set(key, animation);
        const forget = () => {
          if (animations.get(key) === animation) animations.delete(key);
        };

        animation.addEventListener('finish', forget);
        animation.addEventListener('cancel', forget);
      });
    }

    // Cells that left the gallery stop animating.
    animations.forEach((_, key) => {
      if (!frames.has(key)) cancelAnimation(key);
    });

    galleryFramesRef.current = frames;
    galleryStructureRef.current = galleryStructureKey;
  });
  useEffect(() => () => {
    galleryAnimationsRef.current.forEach((animation) => animation.cancel());
    galleryAnimationsRef.current.clear();
  }, []);

  return (
    /* Multi-Participant Responsive Grid. The calculated structure is the only authority: each card is placed
       at its calculated position, so CSS cannot wrap cards into a different structure. */
    <div
      className="tw-grid"
      data-count={galleryCellKeys.length}
      data-gallery-layout={`${galleryLayout.columns}x${galleryLayout.rows}`}
      data-layout-mode={mobileGalleryPaged ? 'mobile-aspect-aware' : useUniformFourGrid ? 'uniform-four' : 'mixed-aspect'}
      style={{
        width: '100%',
        flex: 1,
        maxWidth: activePanel ? 'calc(100% - 380px)' : '100%',
        height: '100%',
        maxHeight: '100%',
        minHeight: 0,
        padding: '8px 12px 16px',
        boxSizing: 'border-box',
        display: 'flex',
        overflow: 'hidden',
        // Keep vertical panning and pinch zoom native; a deliberate horizontal drag is
        // handled by the pager without preventing the underlying touch events.
        touchAction: mobileGalleryPaged && galleryTotalPages > 1 ? 'pan-y pinch-zoom' : undefined,
      }}
      onTouchStart={onGalleryTouchStart}
      onTouchEnd={onGalleryTouchEnd}
    >
      <div
        ref={setGalleryStageNode}
        data-gallery-stage
        style={{ position: 'relative', flex: 1, minWidth: 0, minHeight: 0, height: '100%', overflow: 'hidden' }}
      >
        {galleryMeasured && (() => {
          // Same order as galleryCellKeys. Each cell is a stable keyed wrapper; the card fills it.
          const cells = [
            ...allShares.map((share) => ({
              key: `share:${share.key}`,
              node: <ScreenShareTile stream={share.stream} label={share.name} />,
            })),
            {
              key: 'local',
              node: (
                <MeetingParticipantCard
                  participantId="local"
                  name={`${displayName || 'You'} (You)`}
                  avatarUrl={localAvatarUrl}
                  stream={inCallStream}
                  videoEnabled={inCallVideo}
                  muted={Boolean(inCallMuted)}
                  raisedHand={isHandRaised}
                  theme={localTheme}
                  speaking={isSpeaking}
                  mirrored
                  style={{ width: '100%', height: '100%', maxWidth: '100%' }}
                  onVideoElement={setInCallVideoNode}
                  adaptiveAspect
                  onAspectRatioChange={(ratio) => setCellRatio('local', ratio)}
                  isPinned={pinnedParticipantId === 'local'}
                  onPin={() => { setPinnedManually(pinnedParticipantId === 'local' ? null : 'local'); setTileViewEnabled(false); }}
                  onDoubleClick={() => { setPinnedManually('local'); setTileViewEnabled(false); }}
                />
              ),
            },
            ...remoteParticipants.map((remote, idx) => {
              const remoteKey = `remote:${remote.id || idx}`;

              return {
              key: remoteKey,
              node: (
                <MeetingParticipantCard
                  participantId={remote.id}
                  name={remote.name}
                  avatarUrl={remote.avatarUrl}
                  stream={remote.stream}
                  videoEnabled={remote.video}
                  muted={remote.muted}
                  raisedHand={remote.raisedHand}
                  theme={getParticipantColorTheme(remote.name, idx + 1)}
                  speaking={isSpeakingNow(remote.id)}
                  style={{ width: '100%', height: '100%', maxWidth: '100%' }}
                  adaptiveAspect
                  onAspectRatioChange={(ratio) => setCellRatio(remoteKey, ratio)}
                  isPinned={pinnedParticipantId === remote.id}
                  onPin={() => {
                    const isPinned = pinnedParticipantId === remote.id;
                    setPinnedManually(isPinned ? null : remote.id);
                    setTileViewEnabled(isPinned);
                  }}
                  onDoubleClick={() => {
                    const isPinned = pinnedParticipantId === remote.id;
                    setPinnedManually(isPinned ? null : remote.id);
                    setTileViewEnabled(isPinned);
                  }}
                  onMute={isModerator && !remote.muted ? () => handleRemoteAudioControl(remote.id) : undefined}
                />
              ),
              };
            }),
          ];

          // Only mount this page's cells. Filtering before assigning positions is vital:
          // positions are page-relative and videos on another page must not consume a
          // slot or be mounted off-screen. The participant key itself stays stable, so
          // a re-render of the same page preserves its existing video element.
          const visibleCells = cells.filter((cell) => galleryCellKeys.includes(cell.key));

          return visibleCells.map((cell) => {
            const frame = cellFramesByKey.get(cell.key);

            if (!frame) return null;

            return (
              <div
                key={cell.key}
                data-gallery-cell={cell.key}
                data-gallery-cell-key={cell.key}
                data-video-ratio={(frame.width / Math.max(1, frame.height)).toFixed(4)}
                style={{
                  position: 'absolute',
                  left: `${frame.left}px`,
                  top: `${frame.top}px`,
                  width: `${frame.width}px`,
                  height: `${frame.height}px`,
                  transformOrigin: 'top left',
                }}
              >
                {cell.node}
              </div>
            );
          });
        })()}
      </div>
    </div>
  );
}

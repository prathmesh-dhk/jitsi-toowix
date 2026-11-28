// Extracted from MeetingRoomPage.tsx (Track 3, Phase 2, item 2). Both pieces are pure/presentational
// -- everything they need comes in as props, no closures over the page's own state -- which is what
// made this the second-lowest-risk extraction in the plan. Moved verbatim; no behavior change.
import { useCallback, useEffect, useMemo, useRef, useState, memo, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowLeft, Hand, Mic, MicOff, Phone, Video, VideoOff } from 'lucide-react';
import { getParticipantColorTheme } from '../../lib/participantColorTheme';
import { useSpeaking, useAudioLevel } from '../../lib/speakingStore';
import { SPEAKING_AMBIENT_SHADOW, SPEAKING_GLOW_SHADOW, SPEAKING_GLOW_TRANSITION, useSpeakingGlowLevel, useSpeakingGlowSize } from '../../lib/speakingGlow';
// Kept in its own tiny module, not defined here, so MeetingRoomPage.tsx's canvas/video fallback
// PiP path (drawPipFrame) can import this one page-size constant statically without pulling in
// this whole file's lazy-loaded component code into the main bundle.
import { PIP_PAGE_SIZE } from '../../lib/pipConstants';

export { PIP_PAGE_SIZE };

export interface IPipTile {
  id: string;
  name: string;
  muted: boolean;
  video: boolean;
  stream: MediaStream | null;
  avatarUrl?: string | null;
  raisedHand: boolean;
  isLocal: boolean;
}

// Live remote camera inside the Picture-in-Picture window. `mirrored` is only ever passed for the
// local tile -- every other local self-view in the app (MeetingParticipantCard, the main stage,
// the presenter floating circle) renders the camera flipped like a mirror; this one didn't, so
// switching into PiP made your own camera appear to "flip" relative to how it just looked in the
// main meeting view, even though nothing about the actual camera/outgoing stream changed.
export function PipRemoteVideo({ stream, mirrored = false }: { stream: MediaStream; mirrored?: boolean }) {
  const nodeRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const node = nodeRef.current;

    if (node) {
      node.srcObject = stream;
      node.play().catch(() => { });
    }
  }, [stream]);

  return (
    <video
      ref={nodeRef}
      autoPlay
      playsInline
      muted
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: mirrored ? 'scaleX(-1)' : undefined }}
    />
  );
}

// One tile -- local or remote, both rendered identically here (unlike the single-participant
// layouts elsewhere in this file, which still special-case local via setLocalVideoNode/
// localVideoRef, since local can now land on any page, not always a fixed first cell).
function PipTile({ tile, theme }: { tile: IPipTile; theme: { tileBg: string; avatarBg: string } }) {
  const initial = (tile.isLocal ? 'You' : tile.name).trim().charAt(0).toUpperCase() || 'P';
  const label = tile.isLocal ? `You ${tile.muted ? '(Muted)' : ''}` : (tile.name.length > 12 ? `${tile.name.slice(0, 11)}…` : tile.name);

  // Real reported request: the main meeting view's volume-reactive speaking glow never reached
  // the PiP window's own tiles. The PiP window shares the SAME JS/React context as the opener
  // (that's what lets this file portal React components into it at all), so the existing
  // speakingStore/speakingGlow modules already track live state for every one of these ids here
  // too -- no separate wiring needed, just reusing them the same way MeetingParticipantCard does.
  const isSpeaking = useSpeaking(tile.id);
  const audioLevel = useAudioLevel(tile.id);
  const glowRef = useRef<HTMLDivElement | null>(null);

  useSpeakingGlowLevel(glowRef, audioLevel);
  useSpeakingGlowSize(glowRef);

  return (
    <div
      style={{
        position: 'relative',
        borderRadius: '10px',
        // Local tile keeps its own neutral dark background, matching the original design --
        // only remote tiles get the per-identity color theme.
        backgroundColor: tile.isLocal ? '#2D2E30' : theme.tileBg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {tile.video && tile.stream ? (
        <PipRemoteVideo stream={tile.stream} mirrored={tile.isLocal} />
      ) : (
        <div
          style={{
            width: tile.isLocal ? '42px' : '38px',
            height: tile.isLocal ? '42px' : '38px',
            borderRadius: '50%',
            backgroundColor: tile.isLocal ? '#1A73E8' : theme.avatarBg,
            color: '#FFFFFF',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: tile.isLocal ? '17px' : '16px',
            fontWeight: 600,
            overflow: 'hidden',
          }}
        >
          {tile.avatarUrl ? (
            <img src={tile.avatarUrl} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
          ) : (
            initial
          )}
        </div>
      )}
      <span
        style={{
          position: 'absolute',
          bottom: '4px',
          left: '6px',
          fontSize: '10px',
          color: '#FFFFFF',
          backgroundColor: 'rgba(0,0,0,0.55)',
          padding: '2px 5px',
          borderRadius: '4px',
          zIndex: 2,
          maxWidth: '120px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      {tile.raisedHand && (
        <span
          style={{
            position: 'absolute',
            top: '4px',
            right: '4px',
            backgroundColor: '#1A73E8',
            borderRadius: '50%',
            padding: '2px 4px',
            fontSize: '11px',
          }}
        >
          ✋
        </span>
      )}
      {!tile.isLocal && tile.muted && (
        <span
          style={{
            position: 'absolute',
            top: '4px',
            left: '4px',
            backgroundColor: 'rgba(0,0,0,0.6)',
            borderRadius: '50%',
            width: '18px',
            height: '18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '10px',
            color: '#F87171',
          }}
        >
          ✕
        </span>
      )}
      {/* Same overlay-after-content pattern as MeetingParticipantCard's own glow fix -- an inset
          box-shadow paints behind a box's own children, so this has to render after the video/
          avatar above to actually be visible instead of hidden underneath it. */}
      <div
        aria-hidden
        ref={glowRef}
        style={{
          position: 'absolute', inset: 0, borderRadius: 'inherit', pointerEvents: 'none',
          boxShadow: isSpeaking ? SPEAKING_GLOW_SHADOW : SPEAKING_AMBIENT_SHADOW,
          transition: SPEAKING_GLOW_TRANSITION,
        }}
      />
    </div>
  );
}

// Real reported request: with more than 4 participants, the grid used to silently drop everyone
// past the 4th -- no way to see them at all. Pages of PIP_PAGE_SIZE (4, matching the previous
// grid's own look) are laid out side by side in a strip, so every participant is reachable by
// paging/dragging instead of being dropped (see onPointerMove/onPointerUp below).
//
// Tile POSITION is otherwise meant to hold perfectly still -- it only ever moves for two reasons
// (see orderedTiles' own comment for the actual logic): whoever Jitsi's own dominant-speaker
// detection reports is talking gets moved to the very front the moment that changes, and in that
// same moment, everyone else gets sorted camera-on-first (so when one person is clearly speaking
// and the rest are quiet, whoever already has their camera on gets priority for the remaining
// page-1 seats). Nothing else -- a mute toggle, a name change, an unrelated re-render -- is ever
// allowed to reshuffle anyone.
function PipMultiParticipantPages({
  inCallVideo,
  inCallStream,
  inCallMuted,
  isHandRaised,
  avatarUrl,
  remoteParticipants,
  dominantSpeakerId,
  localParticipantId,
}: {
  inCallVideo: boolean;
  inCallStream: MediaStream | null;
  inCallMuted: boolean | null;
  isHandRaised: boolean;
  avatarUrl?: string | null;
  remoteParticipants: Array<{ id: string; name: string; muted: boolean; video: boolean; raisedHand?: boolean; stream?: MediaStream | null; avatarUrl?: string | null }>;
  dominantSpeakerId?: string | null;
  localParticipantId?: string | null;
}) {
  const [pageIndex, setPageIndex] = useState(0);
  // Live pixel offset while an actual drag is in progress (0 the rest of the time). Applied
  // alongside pageIndex's own percentage-based offset so the strip tracks the pointer 1:1 during
  // a drag, with zero transition lag -- a CSS transition only ever applies during the settle
  // after release (isSettling), never while a finger/cursor is actually still moving it.
  const [dragOffset, setDragOffset] = useState(0);
  const [isSettling, setIsSettling] = useState(false);
  const dragRef = useRef<{ pointerId: number; startX: number; startPageIndex: number; moved: boolean } | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);

  // Real reported request: positions used to get recomputed from scratch on every render -- in
  // practice stable (since the dominant speaker only moves to the front when it's genuinely NOT
  // already there), but still fragile to rely on object-identity-free recomputation for something
  // that's supposed to hold perfectly still. This keeps the actual committed order in a ref, which
  // only ever gets touched at the exact moment the active speaker changes -- never on an unrelated
  // re-render (a mute toggle, a name update, anything else).
  const pinnedOrderRef = useRef<string[]>([]);
  const lastDominantRef = useRef<string | null>(null);

  const rawTiles = useMemo(() => {
    const localTile: IPipTile = {
      id: 'local', name: 'You', muted: Boolean(inCallMuted), video: inCallVideo,
      stream: inCallStream, avatarUrl, raisedHand: isHandRaised, isLocal: true,
    };

    return [
      localTile,
      ...remoteParticipants.map((p): IPipTile => ({
        id: p.id, name: p.name, muted: p.muted, video: p.video,
        stream: p.stream ?? null, avatarUrl: p.avatarUrl, raisedHand: Boolean(p.raisedHand), isLocal: false,
      })),
    ];
    // userInitial/avatarUrl intentionally excluded -- avatarUrl is already read directly above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inCallVideo, inCallStream, inCallMuted, isHandRaised, avatarUrl, remoteParticipants]);

  const orderedTiles = useMemo(() => {
    const tileById = new Map(rawTiles.map((t) => [t.id, t] as const));
    const currentIds = rawTiles.map((t) => t.id);
    // Carry over whichever ids from the last committed order still exist, in the SAME relative
    // order -- this is what keeps everyone else's position from shifting just because, say,
    // someone else toggled their mic. Anyone brand new (just joined) is appended at the end,
    // never inserted into the middle of an already-settled order.
    const stillHere = pinnedOrderRef.current.filter((id) => tileById.has(id));
    const newcomers = currentIds.filter((id) => !stillHere.includes(id));
    let pinnedIds = stillHere.length ? [...stillHere, ...newcomers] : currentIds;

    const resolvedDominantId = dominantSpeakerId && dominantSpeakerId === localParticipantId ? 'local' : dominantSpeakerId;
    // The ONLY two things that are ever allowed to move a tile: (1) the active speaker genuinely
    // changing to someone who wasn't already in front, and, in that same moment, (2) sorting
    // everyone else by camera-on-first -- so when one person is clearly speaking and the rest are
    // quiet, whoever already has their camera on gets priority for the remaining page-1 seats
    // instead of whoever happened to join first.
    const dominantChanged = !!resolvedDominantId && resolvedDominantId !== lastDominantRef.current && pinnedIds.includes(resolvedDominantId);

    if (dominantChanged) {
      const rest = pinnedIds.filter((id) => id !== resolvedDominantId);

      rest.sort((a, b) => Number(tileById.get(b)?.video) - Number(tileById.get(a)?.video));
      pinnedIds = [resolvedDominantId as string, ...rest];
    }
    lastDominantRef.current = resolvedDominantId ?? null;
    pinnedOrderRef.current = pinnedIds;

    return pinnedIds.map((id) => tileById.get(id)).filter((t): t is IPipTile => !!t);
  }, [rawTiles, dominantSpeakerId, localParticipantId]);

  const pages = useMemo(() => {
    const result: IPipTile[][] = [];

    for (let i = 0; i < orderedTiles.length; i += PIP_PAGE_SIZE) {
      result.push(orderedTiles.slice(i, i + PIP_PAGE_SIZE));
    }

    return result.length ? result : [[]];
  }, [orderedTiles]);

  // Clamp in case a page disappeared (e.g. people left) while viewing a later page that no
  // longer exists.
  useEffect(() => {
    if (pageIndex > pages.length - 1) setPageIndex(Math.max(0, pages.length - 1));
  }, [pageIndex, pages.length]);

  // Real reported request: Instagram-carousel-style swipe, not a native scrollbar/strip. Every
  // page is laid out side by side in one flex row (clipped by the wrapper's own overflow:hidden
  // below, which is why no scrollbar can ever appear -- this never uses native scroll at all),
  // moved as one unit via `transform`. `settleTo` is the single place that ever actually commits
  // to a new pageIndex; it clears the live drag offset and turns on the CSS transition for the
  // one settle animation, which `onTransitionEnd` below turns back off once it finishes (so the
  // NEXT drag tracks the pointer with zero lag again, same as this one did).
  const settleTo = useCallback((target: number) => {
    const clamped = Math.max(0, Math.min(pages.length - 1, target));

    setIsSettling(true);
    setDragOffset(0);
    setPageIndex(clamped);
  }, [pages.length]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (pages.length <= 1) return;
    (event.target as Element).setPointerCapture?.(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startPageIndex: pageIndex, moved: false };
    setIsSettling(false);
  }, [pages.length, pageIndex]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;

    if (!drag) return;
    const delta = event.clientX - drag.startX;

    if (Math.abs(delta) > 3) drag.moved = true;
    // Rubber-band to a third of the real distance past the first/last page, instead of either
    // dragging forever into empty space or hard-stopping dead at the edge.
    const atStart = drag.startPageIndex === 0 && delta > 0;
    const atEnd = drag.startPageIndex === pages.length - 1 && delta < 0;

    setDragOffset((atStart || atEnd) ? delta / 3 : delta);
  }, [pages.length]);

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;

    dragRef.current = null;
    if (!drag) return;
    if (!drag.moved) {
      // A plain tap/click (no real drag distance) still advances by one page -- the same
      // convenience the earlier click-to-advance version had before real drag support existed.
      settleTo(drag.startPageIndex + 1);
      return;
    }
    const width = stripRef.current?.clientWidth || 1;
    const delta = event.clientX - drag.startX;
    const threshold = width * 0.2;

    if (delta <= -threshold) settleTo(drag.startPageIndex + 1);
    else if (delta >= threshold) settleTo(drag.startPageIndex - 1);
    else settleTo(drag.startPageIndex);
  }, [settleTo]);

  return (
    <div
      ref={stripRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      title={pages.length > 1 ? 'Drag to see other participants' : undefined}
      style={{
        width: '100%', height: '100%', position: 'relative', overflow: 'hidden',
        cursor: pages.length > 1 ? 'grab' : 'default', touchAction: pages.length > 1 ? 'pan-y' : 'auto',
      }}
    >
      <div
        onTransitionEnd={() => setIsSettling(false)}
        style={{
          display: 'flex',
          width: '100%',
          height: '100%',
          transform: `translate3d(calc(${-pageIndex * 100}% + ${dragOffset}px), 0, 0)`,
          transition: isSettling ? 'transform 280ms cubic-bezier(0.2, 0, 0, 1)' : 'none',
        }}
      >
        {pages.map((page, pageNum) => (
          <div
            // eslint-disable-next-line react/no-array-index-key
            key={pageNum}
            style={{
              flex: '0 0 100%',
              width: '100%',
              height: '100%',
              display: 'grid',
              gridTemplateColumns: page.length === 1 ? 'minmax(0, 1fr)' : 'repeat(2, minmax(0, 1fr))',
              gridTemplateRows: 'repeat(2, minmax(0, 1fr))',
              gap: '6px',
              padding: '6px',
              boxSizing: 'border-box',
            }}
          >
            {page.map((tile, idx) => (
              <PipTile key={tile.id || idx} tile={tile} theme={getParticipantColorTheme(tile.isLocal ? 'You' : tile.name, idx)} />
            ))}
          </div>
        ))}
      </div>
      {pages.length > 1 && (
        <div
          style={{
            position: 'absolute', bottom: '4px', left: '50%', transform: 'translateX(-50%)',
            display: 'flex', gap: '5px', zIndex: 5,
          }}
        >
          {pages.map((_, i) => (
            <button
              // eslint-disable-next-line react/no-array-index-key
              key={i}
              type="button"
              title={`Page ${i + 1}`}
              // Jumps straight to that page. stopPropagation keeps the click from also reaching
              // the strip's own pointerup-based tap-to-advance handler above.
              onClick={(event) => {
                event.stopPropagation();
                settleTo(i);
              }}
              onPointerDown={(event) => event.stopPropagation()}
              style={{
                width: '8px', height: '8px', padding: 0, borderRadius: '50%', border: 'none',
                backgroundColor: i === pageIndex ? '#8AB4F8' : 'rgba(255,255,255,0.35)',
                cursor: 'pointer',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Interactive Document Picture-in-Picture window content (Google Meet experience)
export const DocumentPipContent = memo(function DocumentPipContent({
  isScreenSharing,
  screenStream,
  remoteScreenStream,
  remotePresenterName,
  inCallVideo,
  inCallStream,
  inCallMuted,
  displayName,
  isHandRaised,
  remoteParticipants,
  roomTitle,
  avatarUrl,
  dominantSpeakerId,
  localParticipantId,
  onToggleMic,
  onToggleVideo,
  onToggleHand,
  onReturnToMeeting,
  onLeaveMeeting,
}: {
  isScreenSharing: boolean;
  screenStream: MediaStream | null;
  remoteScreenStream: MediaStream | null;
  remotePresenterName: string | null;
  inCallVideo: boolean;
  inCallStream: MediaStream | null;
  inCallMuted: boolean | null;
  displayName: string;
  isHandRaised: boolean;
  remoteParticipants: Array<{ id: string; name: string; muted: boolean; video: boolean; raisedHand?: boolean; stream?: MediaStream | null; avatarUrl?: string | null }>;
  roomTitle: string;
  avatarUrl?: string | null;
  // Real reported request: with more than 4 participants, the PiP grid used to silently DROP
  // everyone past the 4th (remoteParticipants.slice(0, 3) + the local tile) -- no way to see them
  // at all. Pages of 4 (see PIP_PAGE_SIZE below) plus these two props (Jitsi's own native
  // dominant-speaker detection, already used elsewhere for speaker-view pinning) let whoever is
  // CURRENTLY talking the most always be on the first page, not stuck on a later one.
  dominantSpeakerId?: string | null;
  localParticipantId?: string | null;
  onToggleMic: () => void;
  onToggleVideo: () => void;
  onToggleHand: () => void;
  onReturnToMeeting: () => void;
  onLeaveMeeting: () => void;
}) {
  const activeScreenStream = isScreenSharing ? screenStream : remoteScreenStream;
  const isPresenting = Boolean(activeScreenStream);

  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);

  const setScreenVideoNode = useCallback((node: HTMLVideoElement | null) => {
    screenVideoRef.current = node;
    if (node) {
      node.srcObject = activeScreenStream;
      if (activeScreenStream) {
        node.play().catch(() => { });
      }
    }
  }, [activeScreenStream]);

  const setLocalVideoNode = useCallback((node: HTMLVideoElement | null) => {
    localVideoRef.current = node;
    if (node) {
      if (inCallVideo && inCallStream) {
        node.srcObject = inCallStream;
        node.play().catch(() => { });
      } else {
        node.srcObject = null;
      }
    }
  }, [inCallVideo, inCallStream]);

  // Reactive binding for screen presentation stream
  useEffect(() => {
    if (screenVideoRef.current) {
      screenVideoRef.current.srcObject = activeScreenStream;
      if (activeScreenStream) {
        screenVideoRef.current.play().catch(() => { });
      }
    }
  }, [activeScreenStream]);

  // Reactive binding for live camera stream
  useEffect(() => {
    if (localVideoRef.current) {
      if (inCallVideo && inCallStream) {
        localVideoRef.current.srcObject = inCallStream;
        localVideoRef.current.play().catch(() => { });
      } else {
        localVideoRef.current.srcObject = null;
      }
    }
  }, [inCallVideo, inCallStream]);

  const userInitial = (displayName || 'You').trim().charAt(0).toUpperCase() || 'U';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        backgroundColor: '#1E1F21',
        color: '#FFFFFF',
        boxSizing: 'border-box',
        overflow: 'hidden',
        userSelect: 'none',
        fontFamily: "'Google Sans', Roboto, sans-serif",
      }}
    >
      {/* Top Header with Meeting Title and Return to Tab */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          backgroundColor: 'rgba(0, 0, 0, 0.45)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          zIndex: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
          <span style={{ fontSize: '12px' }}>🟢</span>
          <span
            style={{
              fontSize: '12px',
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: '220px',
              color: '#E8EAED',
            }}
          >
            {roomTitle}
          </span>
        </div>
        <button
          onClick={onReturnToMeeting}
          title="Return to meeting tab"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            background: 'rgba(138, 180, 248, 0.15)',
            border: '1px solid rgba(138, 180, 248, 0.3)',
            borderRadius: '12px',
            padding: '4px 10px',
            color: '#8AB4F8',
            fontSize: '11px',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'background-color 0.15s ease',
          }}
        >
          Back to tab
        </button>
      </div>

      {/* Main Video Stage */}
      <div
        style={{
          flex: 1,
          position: 'relative',
          backgroundColor: '#000000',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {isPresenting ? (
          /* PRESENTATION MODE: Shared screen prominent + floating self-view thumbnail */
          <div
            style={{
              width: '100%',
              height: '100%',
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#000000',
            }}
          >
            <video
              ref={setScreenVideoNode}
              autoPlay
              playsInline
              muted
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />

            {/* Floating Presenter Pill Badge */}
            <div
              style={{
                position: 'absolute',
                top: '8px',
                left: '8px',
                backgroundColor: 'rgba(0, 0, 0, 0.72)',
                backdropFilter: 'blur(4px)',
                padding: '4px 10px',
                borderRadius: '8px',
                fontSize: '11px',
                fontWeight: 500,
                color: '#8AB4F8',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                zIndex: 10,
              }}
            >
              <span>🖥 {isScreenSharing ? 'You are presenting' : `${remotePresenterName || 'Participant'} is presenting`}</span>
            </div>

            {/* Corner floating self-view participant tile */}
            <div
              style={{
                position: 'absolute',
                bottom: '10px',
                right: '10px',
                width: '110px',
                height: '70px',
                borderRadius: '10px',
                backgroundColor: '#202124',
                overflow: 'hidden',
                boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                zIndex: 15,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {inCallVideo && inCallStream ? (
                <video
                  ref={setLocalVideoNode}
                  autoPlay
                  playsInline
                  muted
                  style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}
                />
              ) : (
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    backgroundColor: '#1A73E8',
                    color: '#FFFFFF',
                    fontSize: '13px',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                  }}
                >
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                  ) : (
                    userInitial
                  )}
                </div>
              )}
              <div
                style={{
                  position: 'absolute',
                  bottom: '3px',
                  left: '4px',
                  fontSize: '9px',
                  color: '#FFFFFF',
                  backgroundColor: 'rgba(0,0,0,0.6)',
                  padding: '1px 4px',
                  borderRadius: '3px',
                  maxWidth: '90px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                You {inCallMuted ? '(Muted)' : ''}
              </div>
            </div>
          </div>
        ) : remoteParticipants.length === 0 ? (
          /* SOLO PARTICIPANT STAGE */
          <div
            style={{
              width: '100%',
              height: '100%',
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#202124',
            }}
          >
            {inCallVideo && inCallStream ? (
              <video
                ref={setLocalVideoNode}
                autoPlay
                playsInline
                muted
                style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}
              />
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <div
                  style={{
                    width: '68px',
                    height: '68px',
                    borderRadius: '50%',
                    backgroundColor: '#1A73E8',
                    color: '#FFFFFF',
                    fontSize: '26px',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                    overflow: 'hidden',
                  }}
                >
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                  ) : (
                    userInitial
                  )}
                </div>
              </div>
            )}
            <div
              style={{
                position: 'absolute',
                bottom: '8px',
                left: '8px',
                fontSize: '11px',
                color: '#FFFFFF',
                backgroundColor: 'rgba(0,0,0,0.6)',
                padding: '3px 8px',
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <span>{displayName || 'You'} (You)</span>
              {inCallMuted && <span style={{ color: '#F87171' }}>● Muted</span>}
            </div>
            {isHandRaised && (
              <div
                style={{
                  position: 'absolute',
                  top: '8px',
                  right: '8px',
                  backgroundColor: '#1A73E8',
                  borderRadius: '50%',
                  padding: '4px 6px',
                  fontSize: '13px',
                }}
              >
                ✋
              </div>
            )}
          </div>
        ) : (
          <PipMultiParticipantPages
            inCallVideo={inCallVideo}
            inCallStream={inCallStream}
            inCallMuted={inCallMuted}
            isHandRaised={isHandRaised}
            avatarUrl={avatarUrl}
            remoteParticipants={remoteParticipants}
            dominantSpeakerId={dominantSpeakerId}
            localParticipantId={localParticipantId}
          />
        )}
      </div>

      {/* Interactive Bottom Controls Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '10px',
          padding: '10px 12px',
          backgroundColor: '#1E1F21',
          borderTop: '1px solid rgba(255, 255, 255, 0.1)',
          zIndex: 20,
        }}
      >
        {/* Mic Toggle */}
        <button
          onClick={onToggleMic}
          title={inCallMuted ? 'Turn on microphone' : 'Turn off microphone'}
          style={{
            width: '38px',
            height: '38px',
            borderRadius: '50%',
            backgroundColor: inCallMuted ? '#EA4335' : '#3C4043',
            color: '#FFFFFF',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 2px 6px rgba(0, 0, 0, 0.3)',
            transition: 'background-color 0.15s ease',
          }}
        >
          {inCallMuted ? <MicOff size={16} /> : <Mic size={16} />}
        </button>

        {/* Camera Toggle */}
        <button
          onClick={onToggleVideo}
          title={inCallVideo ? 'Turn off camera' : 'Turn on camera'}
          style={{
            width: '38px',
            height: '38px',
            borderRadius: '50%',
            backgroundColor: inCallVideo ? '#3C4043' : '#EA4335',
            color: '#FFFFFF',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 2px 6px rgba(0, 0, 0, 0.3)',
            transition: 'background-color 0.15s ease',
          }}
        >
          {inCallVideo ? <Video size={16} /> : <VideoOff size={16} />}
        </button>

        {/* Raise Hand Toggle */}
        <button
          onClick={onToggleHand}
          title={isHandRaised ? 'Lower hand' : 'Raise hand'}
          style={{
            width: '38px',
            height: '38px',
            borderRadius: '50%',
            backgroundColor: isHandRaised ? '#1A73E8' : '#3C4043',
            color: '#FFFFFF',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 2px 6px rgba(0, 0, 0, 0.3)',
            transition: 'background-color 0.15s ease',
          }}
        >
          <Hand size={16} />
        </button>

        {/* Return to Meeting Tab */}
        <button
          onClick={onReturnToMeeting}
          title="Return to meeting tab"
          style={{
            width: '38px',
            height: '38px',
            borderRadius: '50%',
            backgroundColor: '#3C4043',
            color: '#8AB4F8',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 2px 6px rgba(0, 0, 0, 0.3)',
            transition: 'background-color 0.15s ease',
          }}
        >
          <ArrowLeft size={16} />
        </button>

        {/* Leave Meeting Button */}
        <button
          onClick={onLeaveMeeting}
          title="Leave meeting"
          style={{
            width: '44px',
            height: '38px',
            borderRadius: '19px',
            backgroundColor: '#EA4335',
            color: '#FFFFFF',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 2px 6px rgba(234, 67, 53, 0.4)',
            transition: 'background-color 0.15s ease',
          }}
        >
          <Phone size={16} style={{ transform: 'rotate(135deg)' }} />
        </button>
      </div>
    </div>
  );
});

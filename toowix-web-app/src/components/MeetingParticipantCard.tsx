import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { Hand, Mic, MicOff, Pin } from 'lucide-react';
import { SpeakingOverlay } from './SpeakingOverlay';
import { useCameraVideoAspect } from '../lib/videoOrientation';
import { computeSmartVideoBoundary, type BoundaryMode } from '../lib/videoBoundary';
import { logGalleryDebug } from '../lib/galleryOrientationDebug';

export interface ParticipantCardTheme {
  avatarBg: string;
  tileBg: string;
  badgeBg: string;
  ringColor: string;
}

export interface MeetingParticipantCardProps {
  participantId: string;
  name: string;
  avatarUrl?: string | null;
  stream?: MediaStream | null;
  videoEnabled: boolean;
  muted: boolean;
  raisedHand?: boolean;
  theme: ParticipantCardTheme;
  style?: React.CSSProperties;
  compact?: boolean;
  mirrored?: boolean;
  speaking?: boolean;
  isPinned?: boolean;
  onPin?: () => void;
  onDoubleClick?: () => void;
  onMute?: () => void;
  onVideoElement?: (node: HTMLVideoElement | null) => void;
  // Opt-in: only the plain Gallery View (grid/tile view) card is allowed to reshape itself and
  // switch to 'contain' for a portrait source. Every other usage of this shared component --
  // Toggle View's right-side rail, Screen Share's participant thumbnails, the "side people box" --
  // must stay the existing fixed-shape, always-'cover' (centered crop) card regardless of the
  // real source orientation, per the adaptive-gallery spec's explicit "square-looking rail, never
  // 9:16" requirement. Defaults to false so every existing non-gallery call site is unaffected
  // unless it deliberately opts in.
  adaptiveAspect?: boolean;
  // Reports this card's real, bucketed video aspect ratio whenever it changes, or null while no
  // video is actually live (camera off, no stream, or metadata not loaded yet) -- the gallery
  // (not this card) owns what ratio a camera-off participant should fall back to, since that
  // depends on the TOTAL participant count (see ParticipantGallery.tsx), not anything this single
  // card knows. Only ever called when adaptiveAspect is true. The card's OWN size is still fully
  // controlled by `style` from the caller; this never resizes itself.
  onAspectRatioChange?: (ratio: number | null) => void;
  // Gallery View's flexible full-fill layout (TOOWIX_PHASE_1_2_FLEXIBLE_FULL_FILL_GALLERY_IMPLEMENTATION.md)
  // sizes the outer card from a weighted row/column tessellation rather than the card's own real
  // ratio -- the card's resulting box is therefore essentially never exactly the source's own
  // ratio. Real reported bug: 'flexible-cover' (always force 'cover', regardless of the real
  // source orientation) cropped a portrait source's left/right edges whenever its card wasn't
  // narrow enough to need Smart Video Boundary's own protection -- the desktop gallery now uses
  // 'adaptive' instead (same as the non-adaptive-aspect default elsewhere): 'cover' for a
  // landscape source (fills the cell, same as before), 'contain' for a portrait one (shows the
  // whole frame, letterboxed if needed, never cropped). 'contain' unconditionally shows the WHOLE
  // decoded frame regardless of orientation -- used for the mobile gallery, which never crops a
  // phone's own camera into any shape (see ParticipantGallery.tsx's own isMobileGallery check).
  // Defaults to 'adaptive', which preserves the existing adaptiveAspect-driven cover/contain switch.
  layoutFit?: 'adaptive' | 'flexible-cover' | 'contain';
  // TOOWIX_SMART_VIDEO_SIDE_BOUNDARIES_IMPLEMENTATION_PLAN.md -- opt-in, Gallery View only. When
  // 'smart-height' and this card's outer box (cardWidth/cardHeight, the caller's OWN measured
  // frame -- never remeasured here) is excessively wide relative to the live source's real ratio,
  // the <video> itself narrows to a centered inner viewport that protects the full source height
  // (no top/bottom crop, no stretch) instead of being cropped wide by 'cover'. The outer card's own
  // size/position is never touched by this -- only the video's own width within it. Defaults to
  // 'none', so every existing non-gallery call site (and gallery cards that don't pass cardWidth/
  // cardHeight) is unaffected.
  videoBoundaryMode?: 'none' | 'smart-height';
  // The caller's own already-measured outer card content dimensions (e.g. a flexible-fill/uniform-
  // grid cell's frame.width/frame.height) -- required for 'smart-height' to do anything; this
  // component never installs its own ResizeObserver to re-derive what the caller already knows.
  cardWidth?: number;
  cardHeight?: number;
}

/** Shared visual card used by gallery, pin and presentation participant layouts. */
export function MeetingParticipantCard({
  participantId, name, avatarUrl, stream, videoEnabled, muted, raisedHand, theme, style,
  compact = false, mirrored = false, speaking = false, isPinned = false, onPin,
  onDoubleClick, onMute, onVideoElement, adaptiveAspect = false, onAspectRatioChange,
  layoutFit = 'adaptive', videoBoundaryMode = 'none', cardWidth, cardHeight,
}: MeetingParticipantCardProps) {
  const initial = (name.trim() || 'P').charAt(0).toUpperCase();
  const size = compact ? 44 : 72;
  // Mobile camera orientation fix: a portrait (9:16) incoming stream must show fully, not get
  // cropped by 'cover' into a vertical zoom (objectFit), AND -- ONLY when adaptiveAspect is true --
  // the gallery that places this card can reshape the card itself to match (ratio, reported
  // upward via onAspectRatioChange). Both come from the video's own actual decoded size, never
  // assumed from device type. The hook itself is called unconditionally regardless of
  // adaptiveAspect (React's own rule: hooks can't be called conditionally) -- only whether its
  // result is USED differs below.
  // TEMPORARY diagnostic (see galleryOrientationDebug.ts): only passed when adaptiveAspect is true
  // (the Gallery View card), so the rail/filmstrip/screen-share cards -- which never report a
  // ratio anywhere -- stay silent even with the debug flag on.
  const { objectFit: adaptiveObjectFit, ratio, bind: bindOrientation } = useCameraVideoAspect(
    adaptiveAspect ? participantId : undefined,
  );
  const hasLiveVideo = videoEnabled && !!stream;
  const objectFit = layoutFit === 'flexible-cover'
    ? 'cover'
    : layoutFit === 'contain'
      ? 'contain'
      : (adaptiveAspect ? adaptiveObjectFit : 'cover');

  // Smart inner video boundary (Gallery View only, opt-in -- see videoBoundaryMode's own doc
  // comment). `ratio` above is the SAME real, bucketed decoded-video ratio the gallery already
  // uses as its layout preference -- reused here, not re-derived, per the plan's own "don't
  // duplicate orientation detection" instruction. Only computed while there's live video to
  // measure; camera-off (or no cardWidth/cardHeight yet) always falls back to 'normal' mode at the
  // card's own full width via computeSmartVideoBoundary's own safe-input handling.
  const boundaryModeRef = useRef<BoundaryMode>('normal');
  const boundary = videoBoundaryMode === 'smart-height' && hasLiveVideo
    ? computeSmartVideoBoundary(cardWidth ?? 0, cardHeight ?? 0, ratio, boundaryModeRef.current)
    : { mode: 'normal' as BoundaryMode, innerWidth: cardWidth ?? 0, leftInset: 0, rightInset: 0 };

  // Committed in a layout effect, not written during render, so a discarded render (StrictMode
  // double-invoke, concurrent retry) can't corrupt the held hysteresis state -- same pattern every
  // other stable-topology hook in this codebase uses (see meetingLayout.ts).
  useLayoutEffect(() => {
    boundaryModeRef.current = boundary.mode;
  });

  const videoWidthStyle = boundary.mode === 'height-protected' && boundary.innerWidth > 0
    ? `${boundary.innerWidth}px`
    : '100%';
  const videoObjectFit = boundary.mode === 'height-protected' ? 'contain' : objectFit;

  useEffect(() => {
    if (!adaptiveAspect) return;
    // Authoritative reset: report null (not a guessed 16:9) the INSTANT there is no live video,
    // straight from videoEnabled/stream -- not from waiting on the <video> element's own unmount/
    // ref-callback timing. The gallery is the one that knows what a camera-off participant should
    // fall back to (see ParticipantGallery.tsx's own participant-count-aware default).
    const nextRatio = hasLiveVideo ? ratio : null;

    logGalleryDebug('card reporting ratio to gallery', { participantId, hasLiveVideo, ratio: nextRatio });
    onAspectRatioChange?.(nextRatio);
  }, [ adaptiveAspect, hasLiveVideo, ratio, onAspectRatioChange, participantId ]);

  const attachVideo = useCallback((node: HTMLVideoElement | null) => {
    onVideoElement?.(node);
    bindOrientation(node);
    if (node && stream && node.srcObject !== stream) {
      node.srcObject = stream;
      void node.play().catch(() => { /* browser may require a gesture */ });
    }
  }, [onVideoElement, stream, bindOrientation]);

  return (
    <div
      data-participant-id={participantId}
      onDoubleClick={onDoubleClick}
      style={{
        position: 'relative', overflow: 'hidden', minWidth: 0, minHeight: 0,
        borderRadius: compact ? '16px' : '24px', backgroundColor: theme.tileBg,
        boxShadow: speaking
          ? `0 0 0 3px ${theme.ringColor}, 0 8px 32px rgba(0, 0, 0, 0.6)`
          : '0 8px 32px rgba(0, 0, 0, 0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: onDoubleClick || onPin ? 'pointer' : 'default',
        ...style,
      }}
    >
      <SpeakingOverlay id={participantId} compact={compact} />
      {hasLiveVideo ? (
        <video
          autoPlay
          playsInline
          muted={participantId === 'local'}
          ref={attachVideo}
          data-video-boundary-mode={videoBoundaryMode === 'smart-height' ? boundary.mode : undefined}
          data-video-inner-width={videoBoundaryMode === 'smart-height' ? boundary.innerWidth.toFixed(2) : undefined}
          data-video-left-inset={videoBoundaryMode === 'smart-height' ? boundary.leftInset.toFixed(2) : undefined}
          data-video-right-inset={videoBoundaryMode === 'smart-height' ? boundary.rightInset.toFixed(2) : undefined}
          // The outer card div is already `display: flex; justify-content: center`, so a narrower
          // (height-protected) video centers itself automatically -- no extra wrapper/background
          // element needed; the outer card's own backgroundColor (theme.tileBg, set above) already
          // shows through on both sides.
          style={{ width: videoWidthStyle, height: '100%', objectFit: videoObjectFit, transform: mirrored ? 'scaleX(-1)' : undefined }}
        />
      ) : (
        <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', backgroundColor: theme.tileBg }}>
          <div style={{
            width: `${size}px`, height: `${size}px`, borderRadius: '50%', backgroundColor: theme.avatarBg,
            color: '#FFFFFF', fontSize: `${compact ? 20 : 32}px`, fontWeight: 500,
            display: 'grid', placeItems: 'center', overflow: 'hidden', boxShadow: '0 4px 20px rgba(0,0,0,.3)',
          }}>
            {avatarUrl ? <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initial}
          </div>
        </div>
      )}
      <div style={{
        position: 'absolute', left: compact ? '8px' : '16px', bottom: compact ? '8px' : '16px',
        maxWidth: 'calc(100% - 24px)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        color: '#FFFFFF', fontSize: compact ? '11px' : '14px', fontWeight: 500,
        background: 'rgba(16, 18, 22, .76)', backdropFilter: 'blur(6px)', borderRadius: '7px',
        padding: compact ? '2px 6px' : '4px 10px', textShadow: '0 1px 3px rgba(0,0,0,.8)',
      }}>{name}</div>
      {onPin && (
        <button
          type="button"
          title={isPinned ? `Unpin ${name}` : `Pin ${name}`}
          onClick={(event) => { event.stopPropagation(); onPin(); }}
          style={{
            position: 'absolute', top: compact ? '8px' : '16px', left: compact ? '8px' : '16px', zIndex: 2,
            width: compact ? '24px' : '32px', height: compact ? '24px' : '32px', borderRadius: '50%',
            display: 'grid', placeItems: 'center', border: '1px solid rgba(255,255,255,.16)',
            background: 'rgba(20,22,26,.76)', cursor: 'pointer',
          }}><Pin size={compact ? 13 : 16} fill={isPinned ? '#8AB4F8' : 'none'} color="#8AB4F8" /></button>
      )}
      {raisedHand && <div title={`${name} raised hand`} style={{
        position: 'absolute', top: compact ? '8px' : '16px', left: onPin ? (compact ? '40px' : '56px') : (compact ? '8px' : '16px'),
        width: compact ? '24px' : '32px', height: compact ? '24px' : '32px', borderRadius: '50%', background: '#1A73E8',
        display: 'grid', placeItems: 'center', boxShadow: '0 2px 8px rgba(0,0,0,.35)', zIndex: 2,
      }}><Hand size={compact ? 13 : 18} color="#FFFFFF" /></div>}
      {onMute && !muted ? <button type="button" title={`Mute ${name}`} onClick={(event) => { event.stopPropagation(); onMute(); }} style={{
        position: 'absolute', top: compact ? '8px' : '16px', right: compact ? '8px' : '16px', zIndex: 2,
        width: compact ? '24px' : '32px', height: compact ? '24px' : '32px', borderRadius: '50%', display: 'grid', placeItems: 'center',
        border: '1px solid rgba(255,255,255,.16)', background: 'rgba(20,22,26,.76)', cursor: 'pointer',
      }}><Mic size={compact ? 13 : 16} color="#8AB4F8" /></button> : muted && <div style={{
        position: 'absolute', top: compact ? '8px' : '16px', right: compact ? '8px' : '16px',
        width: compact ? '22px' : '28px', height: compact ? '22px' : '28px', borderRadius: '50%', background: theme.badgeBg,
        border: '1px solid rgba(255,255,255,.1)', display: 'grid', placeItems: 'center', zIndex: 2,
      }}><MicOff size={compact ? 13 : 16} color="#F87171" /></div>}
    </div>
  );
}

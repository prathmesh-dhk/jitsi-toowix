import { useCallback, useEffect } from 'react';
import { Hand, Mic, MicOff, Pin } from 'lucide-react';
import { SpeakingOverlay } from './SpeakingOverlay';
import { useCameraVideoAspect } from '../lib/videoOrientation';

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
  // Reports this card's real, bucketed video aspect ratio (default 16:9, see
  // DEFAULT_CAMERA_VIDEO_ASPECT) whenever it changes -- so a gallery that sizes cards per-
  // participant (see ParticipantGallery.tsx / calculateMixedAspectLayout) can react. The card's
  // OWN size is still fully controlled by `style` from the caller; this never resizes itself.
  onAspectRatioChange?: (ratio: number) => void;
}

/** Shared visual card used by gallery, pin and presentation participant layouts. */
export function MeetingParticipantCard({
  participantId, name, avatarUrl, stream, videoEnabled, muted, raisedHand, theme, style,
  compact = false, mirrored = false, speaking = false, isPinned = false, onPin,
  onDoubleClick, onMute, onVideoElement, onAspectRatioChange,
}: MeetingParticipantCardProps) {
  const initial = (name.trim() || 'P').charAt(0).toUpperCase();
  const size = compact ? 44 : 72;
  // Mobile camera orientation fix: a portrait (9:16) incoming stream must show fully, not get
  // cropped by 'cover' into a vertical zoom (objectFit), AND the gallery that places this card
  // can reshape the card itself to match (ratio, reported upward via onAspectRatioChange). Both
  // come from the video's own actual decoded size, never assumed from device type.
  const { objectFit, ratio, bind: bindOrientation } = useCameraVideoAspect();

  useEffect(() => {
    onAspectRatioChange?.(ratio);
  }, [ ratio, onAspectRatioChange ]);

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
      {videoEnabled && stream ? (
        <video
          autoPlay
          playsInline
          muted={participantId === 'local'}
          ref={attachVideo}
          style={{ width: '100%', height: '100%', objectFit, transform: mirrored ? 'scaleX(-1)' : undefined }}
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

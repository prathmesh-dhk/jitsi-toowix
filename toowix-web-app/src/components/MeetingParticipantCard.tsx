import { useCallback } from 'react';
import { Hand, Mic, MicOff, Pin } from 'lucide-react';
import { SpeakingOverlay } from './SpeakingOverlay';

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
}

/** Shared visual card used by gallery, pin and presentation participant layouts. */
export function MeetingParticipantCard({
  participantId, name, avatarUrl, stream, videoEnabled, muted, raisedHand, theme, style,
  compact = false, mirrored = false, speaking = false, isPinned = false, onPin,
  onDoubleClick, onMute, onVideoElement,
}: MeetingParticipantCardProps) {
  const initial = (name.trim() || 'P').charAt(0).toUpperCase();
  const size = compact ? 44 : 72;
  const attachVideo = useCallback((node: HTMLVideoElement | null) => {
    onVideoElement?.(node);
    if (node && stream && node.srcObject !== stream) {
      node.srcObject = stream;
      void node.play().catch(() => { /* browser may require a gesture */ });
    }
  }, [onVideoElement, stream]);

  return (
    <div
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
          style={{ width: '100%', height: '100%', objectFit: 'cover', transform: mirrored ? 'scaleX(-1)' : undefined }}
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

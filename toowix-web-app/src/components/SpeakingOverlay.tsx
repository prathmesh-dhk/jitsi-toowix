import { useSpeaking } from '../lib/speakingStore';

interface IProps {
  // Remote participant id, or pass `active` for the local user (driven by the mic meter).
  id?: string;
  active?: boolean;
  compact?: boolean;
}

// Google-Meet-style talking cue: a soft pulsing ring around the tile plus three bouncing bars.
export function SpeakingOverlay({ id, active, compact }: IProps) {
  const remoteSpeaking = useSpeaking(id);
  const isSpeaking = id ? remoteSpeaking : Boolean(active);

  if (!isSpeaking) {
    return null;
  }
  const size = compact ? 22 : 32;
  const bar = compact ? 3 : 4;

  return (
    <>
      <style>{`
        @keyframes toowix-speak-ring { 0%,100% { box-shadow: inset 0 0 0 3px rgba(138,180,248,0.95), 0 0 0 0 rgba(138,180,248,0.35); } 50% { box-shadow: inset 0 0 0 3px rgba(138,180,248,0.95), 0 0 14px 2px rgba(138,180,248,0.5); } }
        @keyframes toowix-speak-bar { 0%,100% { transform: scaleY(0.35); } 50% { transform: scaleY(1); } }
      `}</style>
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 'inherit',
          pointerEvents: 'none',
          zIndex: 11,
          animation: 'toowix-speak-ring 1.2s ease-in-out infinite'
        }}
      />
      <div
        aria-label="Speaking"
        style={{
          position: 'absolute',
          top: compact ? '8px' : '16px',
          right: compact ? '8px' : '16px',
          width: `${size}px`,
          height: `${size}px`,
          borderRadius: '50%',
          backgroundColor: '#8AB4F8',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '2px',
          zIndex: 12,
          pointerEvents: 'none'
        }}
      >
        {[ 0, 0.18, 0.36 ].map((delay) => (
          <span
            key={delay}
            style={{
              width: `${bar}px`,
              height: `${size * 0.5}px`,
              borderRadius: `${bar}px`,
              backgroundColor: '#202124',
              transformOrigin: 'center',
              animation: `toowix-speak-bar 0.7s ease-in-out ${delay}s infinite`
            }}
          />
        ))}
      </div>
    </>
  );
}

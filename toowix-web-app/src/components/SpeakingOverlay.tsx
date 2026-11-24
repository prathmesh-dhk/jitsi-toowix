import { useSpeaking } from '../lib/speakingStore';

interface IProps {
  // Remote participant id, or pass `active` for the local user (driven by the mic meter).
  id?: string;
  active?: boolean;
  compact?: boolean;
}

// Google-Meet-style talking cue: three bouncing bars. The tile's own ring is now the
// volume-reactive gradient glow (see speakingGlow.ts/SpeakingGlow.tsx) applied directly to the
// card's box-shadow -- this component used to also draw its own flat blue pulsing ring here, which
// is removed since it visually competed with (and this component can't see) the gradient glow.
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
        @keyframes toowix-speak-bar { 0%,100% { transform: scaleY(0.35); } 50% { transform: scaleY(1); } }
      `}</style>
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

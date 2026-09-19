import { useId } from 'react';
import { useAudioLevel } from '../lib/speakingStore';

interface IProps {
  id?: string;
  size?: number;
  color?: string;
}

// A microphone whose capsule fills green from the bottom as you talk -- the same look as the
// pre-join lobby -- driven by the live input level.
export function MicLevelIcon({ id = 'local', size = 22, color = '#E8EAED' }: IProps) {
  const level = useAudioLevel(id);
  const clipId = `mic-level-${useId().replace(/:/g, '')}`;
  const fillHeight = Math.max(1.5, Math.min(11, level * 32));

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <clipPath id={clipId}>
          <rect x="8.6" y="2.5" width="6.8" height="11" rx="3.4" />
        </clipPath>
      </defs>
      <rect
        x="8.6"
        y={13.5 - fillHeight}
        width="6.8"
        height={fillHeight}
        fill="#34A853"
        clipPath={`url(#${clipId})`}
        style={{ transition: 'y 80ms ease, height 80ms ease' }}
      />
      <rect x="8.6" y="2.5" width="6.8" height="11" rx="3.4" fill="none" stroke={color} strokeWidth="1.8" />
      <path d="M5.8 10.5v.8a6.2 6.2 0 0 0 12.4 0v-.8M12 17.5v3.2M8.8 20.7h6.4" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

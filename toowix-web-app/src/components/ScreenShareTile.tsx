import { useEffect, useRef } from 'react';
import { ScreenShare } from 'lucide-react';

interface IProps {
  stream: MediaStream | null;
  label: string;
  compact?: boolean;
}

export function ScreenShareTile({ stream, label, compact }: IProps) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const node = ref.current;

    if (!node) {
      return;
    }
    node.srcObject = stream;
    if (stream) {
      node.play().catch(() => { });
    }
  }, [ stream ]);

  return (
    <div
      style={{
        width: '100%',
        height: compact ? undefined : '100%',
        aspectRatio: compact ? '16 / 9' : undefined,
        minHeight: 0,
        borderRadius: compact ? '16px' : '24px',
        overflow: 'hidden',
        position: 'relative',
        backgroundColor: '#000000',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
        flexShrink: 0,
      }}
    >
      <video
        ref={ref}
        autoPlay
        playsInline
        muted
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: compact ? '8px' : '16px',
          left: compact ? '8px' : '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          color: '#FFFFFF',
          fontSize: compact ? '11px' : '14px',
          fontWeight: 500,
          backgroundColor: 'rgba(32, 33, 36, 0.75)',
          padding: compact ? '2px 6px' : '4px 10px',
          borderRadius: '8px',
        }}
      >
        <ScreenShare size={compact ? 12 : 14} color="#8AB4F8" />
        {label}
      </div>
    </div>
  );
}

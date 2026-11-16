import { useEffect, useRef, useState } from 'react';
import { ScreenShare, Loader2 } from 'lucide-react';

interface IProps {
  stream: MediaStream | null;
  label: string;
  compact?: boolean;
}

// T2-2 (lighter-client audit): a remote share that's signaling-active but hasn't delivered a real
// frame yet (still negotiating, or a slow/weak uplink on the presenter's end) rendered as a plain
// black rectangle -- indistinguishable from a genuinely broken share. Anything under this long is
// the ordinary, expected gap between "share started" and "first frame decoded" and isn't worth a
// loading state flashing in and out; only a share that's STILL not delivering a frame after this
// long gets the explicit "waiting" treatment.
const SCREEN_SHARE_STALL_MS = 5000;

export function ScreenShareTile({ stream, label, compact }: IProps) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [hasFrame, setHasFrame] = useState(false);
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    const node = ref.current;

    if (!node) {
      return;
    }
    node.srcObject = stream;
    setHasFrame(false);
    setStalled(false);
    if (stream) {
      node.play().catch((err) => {
        if (import.meta.env.DEV || import.meta.env.VITE_JITSI_DIAGNOSTICS === 'true') {
          // eslint-disable-next-line no-console
          console.warn('[ScreenShareTile] video.play() failed:', err?.name, err?.message, err);
        }
      });
    }
  }, [ stream ]);

  // Real decoded-frame signal, not just "a stream object exists" -- a stream can be attached and
  // signaling-active for several seconds before the first frame actually decodes.
  useEffect(() => {
    const node = ref.current;

    if (!node || !stream) return undefined;
    const onFrame = () => {
      if (node.videoWidth > 0 && node.videoHeight > 0) setHasFrame(true);
    };

    node.addEventListener('loadedmetadata', onFrame);
    node.addEventListener('resize', onFrame);
    onFrame();

    return () => {
      node.removeEventListener('loadedmetadata', onFrame);
      node.removeEventListener('resize', onFrame);
    };
  }, [ stream ]);

  useEffect(() => {
    if (!stream || hasFrame) {
      setStalled(false);

      return undefined;
    }
    const timer = setTimeout(() => setStalled(true), SCREEN_SHARE_STALL_MS);

    return () => clearTimeout(timer);
  }, [ stream, hasFrame ]);

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
      {stalled && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '10px',
            backgroundColor: 'rgba(0, 0, 0, 0.55)',
          }}
        >
          <Loader2 size={compact ? 20 : 28} color="#8AB4F8" className="animate-spin" />
          <span style={{ color: '#E8EAED', fontSize: compact ? '11px' : '13px', fontWeight: 500 }}>
            Waiting for presenter's screen…
          </span>
        </div>
      )}
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

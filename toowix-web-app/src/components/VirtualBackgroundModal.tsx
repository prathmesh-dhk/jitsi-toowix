import React, { useState } from 'react';
import { X, Sparkles, Ban, Loader2 } from 'lucide-react';

import { getSavedBackground, saveBackground } from '../lib/meetingPrefs';
import { IVirtualBackground } from '../lib/virtualBackground/JitsiStreamBackgroundEffect';

export interface IVirtualBackgroundModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (config: IVirtualBackground | null) => Promise<void>;
}

const BLUR_OPTIONS: Array<{ label: string; blurValue: number }> = [
  { label: 'Light blur', blurValue: 8 },
  { label: 'Strong blur', blurValue: 25 }
];

const PRESET_IMAGES = Array.from({ length: 7 }, (_, i) => `/images/virtual-background/background-${i + 1}.jpg`);

type SelectionKey = 'none' | `blur-${number}` | `image-${number}`;

function getBackgroundErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '');
  const normalized = message.toLowerCase();

  if (normalized.includes('low data mode')) return message;
  if (normalized.includes('turn on your camera') || normalized.includes('camera')) {
    return 'Turn on your camera, then try the background again.';
  }
  if (normalized.includes('capturestream') || normalized.includes('not supported') || normalized.includes('webassembly')) {
    return "This browser doesn't support virtual backgrounds for this call.";
  }
  if (normalized.includes('model') || normalized.includes('download') || normalized.includes('http')) {
    return 'The background engine could not load. Refresh the page and try again.';
  }

  return 'Could not apply this background. Keep your camera on and try again.';
}

export function VirtualBackgroundModal({ isOpen, onClose, onSelect }: IVirtualBackgroundModalProps) {
  const [ selected, setSelected ] = useState<SelectionKey>(() => {
    const saved = getSavedBackground();

    if (saved?.backgroundType === 'blur') {
      return `blur-${BLUR_OPTIONS.findIndex((o) => o.blurValue === saved.blurValue)}` as SelectionKey;
    }
    if (saved?.backgroundType === 'image') {
      return `image-${PRESET_IMAGES.indexOf(saved.virtualSource || '')}` as SelectionKey;
    }

    return 'none';
  });
  const [ busyKey, setBusyKey ] = useState<SelectionKey | null>(null);
  const [ error, setError ] = useState<string | null>(null);

  if (!isOpen) {
    return null;
  }

  const apply = async (key: SelectionKey, config: IVirtualBackground | null) => {
    setBusyKey(key);
    setError(null);
    try {
      await onSelect(config);
      saveBackground(config);
      setSelected(key);
    } catch (err: any) {
      // Preserve the useful reason without exposing a raw browser/internal error to the user.
      setError(getBackgroundErrorMessage(err));
    } finally {
      setBusyKey(null);
    }
  };

  const optionStyle = (key: SelectionKey): React.CSSProperties => ({
    position: 'relative',
    borderRadius: '10px',
    border: selected === key ? '2px solid #8AB4F8' : '2px solid transparent',
    cursor: busyKey ? 'wait' : 'pointer',
    overflow: 'hidden',
    opacity: busyKey && busyKey !== key ? 0.5 : 1
  });

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 500
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: '#2D2E30',
          borderRadius: '16px',
          padding: '24px',
          width: '460px',
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: '75vh',
          overflowY: 'auto',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 12px 32px rgba(0,0,0,0.5)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <span style={{ fontSize: '16px', fontWeight: 600, color: '#FFFFFF', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sparkles size={18} color="#8AB4F8" /> Select background
          </span>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: '50%', display: 'flex' }}
          >
            <X size={18} color="#9AA0A6" />
          </button>
        </div>
        <div style={{ fontSize: '12px', color: '#9AA0A6', marginBottom: '16px' }}>
          Blur or replace what's behind you. Runs entirely on your device.
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
          <div style={optionStyle('none')} onClick={() => !busyKey && apply('none', null)}>
            <div
              style={{
                aspectRatio: '1',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(255,255,255,0.06)'
              }}
            >
              {busyKey === 'none' ? <Loader2 size={18} className="animate-spin" color="#9AA0A6" /> : <Ban size={18} color="#9AA0A6" />}
            </div>
            <div style={{ fontSize: '10px', color: '#9AA0A6', textAlign: 'center', padding: '4px 0' }}>None</div>
          </div>

          {BLUR_OPTIONS.map((opt) => {
            const key: SelectionKey = `blur-${opt.blurValue}`;

            return (
              <div key={key} style={optionStyle(key)} onClick={() => !busyKey && apply(key, { backgroundType: 'blur', blurValue: opt.blurValue })}>
                <div
                  style={{
                    aspectRatio: '1',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'rgba(255,255,255,0.06)',
                    backdropFilter: `blur(${Math.min(opt.blurValue / 3, 6)}px)`
                  }}
                >
                  {busyKey === key && <Loader2 size={18} className="animate-spin" color="#9AA0A6" />}
                </div>
                <div style={{ fontSize: '10px', color: '#9AA0A6', textAlign: 'center', padding: '4px 0' }}>{opt.label}</div>
              </div>
            );
          })}

          {PRESET_IMAGES.map((src, idx) => {
            const key: SelectionKey = `image-${idx}`;

            return (
              <div key={key} style={optionStyle(key)} onClick={() => !busyKey && apply(key, { backgroundType: 'image', virtualSource: src })}>
                <div style={{ aspectRatio: '1', position: 'relative' }}>
                  <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  {busyKey === key && (
                    <div
                      style={{
                        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        backgroundColor: 'rgba(0,0,0,0.4)'
                      }}
                    >
                      <Loader2 size={18} className="animate-spin" color="#FFFFFF" />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {error && <div style={{ fontSize: '12px', color: '#F87171', marginTop: '12px' }}>{error}</div>}
      </div>
    </div>
  );
}

export default VirtualBackgroundModal;

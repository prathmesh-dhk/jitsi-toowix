import React from 'react';
import { X, Gauge } from 'lucide-react';

export interface IPerformanceSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentMaxHeight: number;
  onSelect: (maxHeight: number) => void;
}

const PRESETS: Array<{ maxHeight: number; label: string; detail: string }> = [
  { maxHeight: 720, label: 'High definition', detail: 'Best quality -- needs a fast, stable connection' },
  { maxHeight: 360, label: 'Standard definition', detail: 'Balanced -- good for most connections' },
  { maxHeight: 180, label: 'Low bandwidth', detail: 'Saves data -- best for slow/unstable networks' },
  { maxHeight: 0, label: 'Audio only', detail: 'No incoming video at all -- lowest possible data use' },
];

export function PerformanceSettingsModal({ isOpen, onClose, currentMaxHeight, onSelect }: IPerformanceSettingsModalProps) {
  if (!isOpen) return null;

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
        zIndex: 500,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: '#2D2E30',
          borderRadius: '16px',
          padding: '24px',
          width: '380px',
          maxWidth: 'calc(100vw - 32px)',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <span style={{ fontSize: '16px', fontWeight: 600, color: '#FFFFFF', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Gauge size={18} color="#8AB4F8" /> Performance settings
          </span>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: '50%', display: 'flex' }}
          >
            <X size={18} color="#9AA0A6" />
          </button>
        </div>
        <div style={{ fontSize: '12px', color: '#9AA0A6', marginBottom: '16px' }}>
          Lowers the video quality you receive (and send) to save bandwidth on a slow connection.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {PRESETS.map((p) => {
            const active = currentMaxHeight === p.maxHeight;

            return (
              <button
                key={p.maxHeight}
                onClick={() => onSelect(p.maxHeight)}
                style={{
                  textAlign: 'left',
                  padding: '10px 12px',
                  borderRadius: '10px',
                  border: active ? '1px solid #8AB4F8' : '1px solid rgba(255,255,255,0.1)',
                  backgroundColor: active ? 'rgba(138,180,248,0.12)' : 'rgba(255,255,255,0.03)',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: '13px', fontWeight: 600, color: active ? '#8AB4F8' : '#E8EAED' }}>{p.label}</div>
                <div style={{ fontSize: '11px', color: '#9AA0A6', marginTop: '2px' }}>{p.detail}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default PerformanceSettingsModal;

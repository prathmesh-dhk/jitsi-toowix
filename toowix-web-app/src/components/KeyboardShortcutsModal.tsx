import React from 'react';
import { X } from 'lucide-react';

export interface IKeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SHORTCUTS: Array<{ key: string; label: string }> = [
  { key: 'M', label: 'Mute / unmute microphone' },
  { key: 'V', label: 'Turn camera on / off' },
  { key: 'F', label: 'Enter / exit full screen' },
  { key: 'W', label: 'Toggle tile view' },
];

export function KeyboardShortcutsModal({ isOpen, onClose }: IKeyboardShortcutsModalProps) {
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
          width: '360px',
          maxWidth: 'calc(100vw - 32px)',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <span style={{ fontSize: '16px', fontWeight: 600, color: '#FFFFFF' }}>Keyboard shortcuts</span>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: '50%', display: 'flex' }}
          >
            <X size={18} color="#9AA0A6" />
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {SHORTCUTS.map((s) => (
            <div
              key={s.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 4px',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <span style={{ fontSize: '13px', color: '#E8EAED' }}>{s.label}</span>
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: 700,
                  color: '#E8EAED',
                  backgroundColor: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: '6px',
                  padding: '2px 8px',
                  minWidth: '24px',
                  textAlign: 'center',
                }}
              >
                {s.key}
              </span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: '11px', color: '#9AA0A6', marginTop: '12px' }}>
          Shortcuts are disabled while typing in a text field.
        </div>
      </div>
    </div>
  );
}

export default KeyboardShortcutsModal;

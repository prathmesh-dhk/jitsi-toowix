import { useSyncExternalStore } from 'react';
import {
  dismissPortraitCropNotice, getPortraitCropNoticeState, subscribePortraitCropNotice,
} from '../lib/portraitCropNotice';

// Small, dismissible, non-blocking banner -- tells the person their OWN camera is being cropped to
// a portrait shape because the device couldn't deliver real portrait pixels (see
// portraitCropProcessor.ts), so what others see of them has a narrower field of view than usual.
// Requirement: keep the user informed of the loss of field of view, not hide it behind a debug
// overlay only a developer would think to open.
export function PortraitCropNotice() {
  const state = useSyncExternalStore(subscribePortraitCropNotice, getPortraitCropNoticeState);

  if (!state.active || state.dismissed) return null;

  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        bottom: '88px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9000,
        maxWidth: '92vw',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        background: 'rgba(28, 25, 10, 0.92)',
        color: '#FFF3DB',
        fontSize: '13px',
        lineHeight: 1.4,
        padding: '10px 14px',
        borderRadius: '10px',
        border: '1px solid rgba(255, 200, 100, 0.35)',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
      }}
    >
      <span>
        Your camera couldn't switch to portrait mode, so your video is cropped narrower than usual
        for other participants.
      </span>
      <button
        type="button"
        onClick={dismissPortraitCropNotice}
        aria-label="Dismiss"
        style={{
          flexShrink: 0,
          background: 'transparent',
          border: 'none',
          color: 'inherit',
          cursor: 'pointer',
          fontSize: '16px',
          lineHeight: 1,
          padding: '2px 4px',
        }}
      >
        ×
      </button>
    </div>
  );
}

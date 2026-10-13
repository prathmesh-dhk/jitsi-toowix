import { useSyncExternalStore } from 'react';
import {
  getGalleryDebugSnapshot,
  isGalleryDebugEnabled,
  subscribeGalleryDebugSnapshot,
} from '../lib/galleryOrientationDebug';

// TEMPORARY, dev-only overlay (see galleryOrientationDebug.ts). Renders nothing unless the
// ?galleryDebug=1 flag is on, and is never reachable in a production build. Exists specifically
// because a real phone's own console is not reachable without a USB-tethered remote-debugging
// session (chrome://inspect on a computer for Android, Safari Web Inspector on a Mac for iPhone) --
// most people testing a meeting on their own phone have neither. This draws the same diagnostics
// logGalleryDebug() already logs directly on screen instead, read with your own eyes.
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(3);
  if (typeof value === 'object') return JSON.stringify(value);

  return String(value);
}

function Row({ label, value }: { label: string; value: unknown }) {
  return (
    <div style={{ display: 'flex', gap: '6px' }}>
      <span style={{ opacity: 0.7 }}>{label}:</span>
      <span style={{ fontWeight: 600 }}>{formatValue(value)}</span>
    </div>
  );
}

export function GalleryOrientationDebugOverlay() {
  const snapshot = useSyncExternalStore(subscribeGalleryDebugSnapshot, getGalleryDebugSnapshot);

  if (!isGalleryDebugEnabled()) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: '8px',
        left: '8px',
        zIndex: 99999,
        maxWidth: '92vw',
        maxHeight: '70vh',
        overflowY: 'auto',
        background: 'rgba(10, 12, 16, 0.88)',
        color: '#E8EAED',
        fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
        fontSize: '11px',
        lineHeight: 1.5,
        padding: '8px 10px',
        borderRadius: '8px',
        border: '1px solid rgba(255,255,255,0.25)',
        pointerEvents: 'none',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: '4px' }}>gallery-orientation-debug</div>

      <div style={{ marginTop: '4px', opacity: 0.85 }}>-- capture (this device's own camera) --</div>
      {snapshot.captureSettings ? (
        <>
          <Row label="deviceCategory" value={snapshot.captureSettings.deviceCategory} />
          <Row label="actualWidth" value={snapshot.captureSettings.actualWidth} />
          <Row label="actualHeight" value={snapshot.captureSettings.actualHeight} />
          <Row label="actualAspectRatio" value={snapshot.captureSettings.actualAspectRatio} />
          <Row label="requested" value={snapshot.captureSettings.requested} />
        </>
      ) : (
        <div>(no local video track yet)</div>
      )}

      <div style={{ marginTop: '6px', opacity: 0.85 }}>-- active view mode --</div>
      {snapshot.viewMode ? (
        <>
          <Row label="viewMode" value={snapshot.viewMode.viewMode} />
          <Row label="remoteParticipantCount" value={snapshot.viewMode.remoteParticipantCount} />
          <Row label="tileViewEnabled" value={snapshot.viewMode.tileViewEnabled} />
        </>
      ) : (
        <div>(not yet known)</div>
      )}

      <div style={{ marginTop: '6px', opacity: 0.85 }}>-- receiver video metadata, per participant --</div>
      {Object.keys(snapshot.receiverByParticipant).length === 0 ? (
        <div>(no live receiver video yet)</div>
      ) : (
        Object.entries(snapshot.receiverByParticipant).map(([participant, info]) => (
          <div key={participant} style={{ marginBottom: '2px' }}>
            <Row label={`${participant}.videoWidth`} value={info.videoWidth} />
            <Row label={`${participant}.videoHeight`} value={info.videoHeight} />
            <Row label={`${participant}.bucketedRatio`} value={info.bucketedRatio} />
            <Row label={`${participant}.objectFit`} value={info.objectFit} />
          </div>
        ))
      )}

      <div style={{ marginTop: '6px', opacity: 0.85 }}>-- gallery layout selection --</div>
      {snapshot.gallerySelection ? (
        <>
          <Row label="engine" value={snapshot.gallerySelection.viewMode} />
          <Row label="cellRatios" value={snapshot.gallerySelection.cellRatios} />
          <Row label="finalCellFrames" value={snapshot.gallerySelection.finalCellFrames} />
        </>
      ) : (
        <div>(not yet computed)</div>
      )}
    </div>
  );
}

import React from 'react';
import { X } from 'lucide-react';

export interface IParticipantStatsModalProps {
  isOpen: boolean;
  onClose: () => void;
  localName: string;
  connectionStats: Record<string, any>;
  participantNames: Record<string, string>;
}

function qualityColor(percent: number | undefined): string {
  if (percent === undefined) return '#9AA0A6';
  if (percent >= 70) return '#34A853';
  if (percent >= 40) return '#FBBC04';
  return '#EA4335';
}

function StatRow({ name, stats, isLocal }: { name: string; stats: any; isLocal: boolean }) {
  const resolution = stats?.resolution ? Object.values(stats.resolution)[0] as any : null;
  const framerate = stats?.framerate ? Object.values(stats.framerate)[0] : null;
  const bitrate = stats?.bitrate;
  const packetLoss = stats?.packetLoss;
  const quality = stats?.connectionQuality;

  return (
    <div
      style={{
        padding: '10px 12px',
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderRadius: '10px',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '13px', fontWeight: 600, color: '#E8EAED' }}>
          {name}{isLocal ? ' (You)' : ''}
        </span>
        <span
          style={{
            fontSize: '11px',
            fontWeight: 700,
            color: qualityColor(quality),
          }}
        >
          {quality !== undefined ? `${Math.round(quality)}%` : 'N/A'}
        </span>
      </div>
      <div style={{ fontSize: '11px', color: '#9AA0A6', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        {resolution && <span>{resolution.width}×{resolution.height}</span>}
        {framerate !== null && framerate !== undefined && <span>{String(framerate)} fps</span>}
        {bitrate && <span>↓{bitrate.download ?? 0} ↑{bitrate.upload ?? 0} kbps</span>}
        {packetLoss && <span>loss ↓{packetLoss.download ?? 0}% ↑{packetLoss.upload ?? 0}%</span>}
        {!resolution && !framerate && !bitrate && <span>Gathering stats…</span>}
      </div>
    </div>
  );
}

export function ParticipantStatsModal({ isOpen, onClose, localName, connectionStats, participantNames }: IParticipantStatsModalProps) {
  if (!isOpen) return null;

  // Membership, not cached telemetry, determines who is currently in the call.
  const remoteIds = Object.keys(participantNames).filter((id) => id !== 'local');

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
          width: '420px',
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: '70vh',
          overflowY: 'auto',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <span style={{ fontSize: '16px', fontWeight: 600, color: '#FFFFFF' }}>Connection stats</span>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: '50%', display: 'flex' }}
          >
            <X size={18} color="#9AA0A6" />
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <StatRow name={localName} stats={connectionStats.local} isLocal />
          {remoteIds.map((id) => (
            <StatRow key={id} name={participantNames[id] || 'Participant'} stats={connectionStats[id]} isLocal={false} />
          ))}
          {remoteIds.length === 0 && (
            <div style={{ fontSize: '12px', color: '#9AA0A6', textAlign: 'center', padding: '8px' }}>
              No other participants yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ParticipantStatsModal;

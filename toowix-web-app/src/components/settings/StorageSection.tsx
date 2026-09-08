import React, { useEffect, useState } from 'react';
import { settingsApi } from '../../lib/settingsApi';
import { sectionHeaderStyle, sectionTitleStyle, sectionSubtitleStyle, cardStyle, labelStyle, inputStyle, Toggle } from './SettingsShared';

const formatBytes = (bytes: number) => {
  if (!bytes) return '0 MB';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
};

const BREAKDOWN_LABELS: Record<string, string> = {
  video: 'Video recordings', audio: 'Audio files', transcripts: 'Transcripts', captions: 'Captions', chatAndFiles: 'Meeting chat and shared files',
};
const BREAKDOWN_COLORS: Record<string, string> = {
  video: '#4F46E5', audio: '#10B981', transcripts: '#F59E0B', captions: '#EC4899', chatAndFiles: '#6B7280',
};

export function StorageSection() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [notify80, setNotify80] = useState(true);
  const [notify90, setNotify90] = useState(true);
  const [autoDelete, setAutoDelete] = useState(false);

  useEffect(() => {
    settingsApi.get<any>('/storage').then((d) => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading || !data) return <p style={{ color: '#9CA3AF', fontSize: '13px' }}>Loading storage...</p>;

  const percentUsed = data.limitBytes ? Math.min(100, Math.round((data.usedBytes / data.limitBytes) * 100)) : 0;
  const breakdownTotal = Object.values(data.breakdown).reduce((a: number, b: any) => a + b, 0) as number;

  return (
    <div>
      <div style={sectionHeaderStyle}>
        <h1 style={sectionTitleStyle}>Storage</h1>
        <p style={sectionSubtitleStyle}>Monitor recording storage and retention.</p>
      </div>

      <div style={{ ...cardStyle, marginBottom: '16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '16px' }}>
          <div><div style={{ fontSize: '11px', color: '#9CA3AF' }}>Storage used</div><div style={{ fontSize: '18px', fontWeight: 700, color: '#141B2B' }}>{formatBytes(data.usedBytes)}</div></div>
          <div><div style={{ fontSize: '11px', color: '#9CA3AF' }}>Total storage limit</div><div style={{ fontSize: '18px', fontWeight: 700, color: '#141B2B' }}>{data.limitBytes !== null ? formatBytes(data.limitBytes) : 'Unlimited'}</div></div>
          <div><div style={{ fontSize: '11px', color: '#9CA3AF' }}>Available</div><div style={{ fontSize: '18px', fontWeight: 700, color: '#141B2B' }}>{data.availableBytes !== null ? formatBytes(data.availableBytes) : '—'}</div></div>
        </div>
        {data.limitBytes !== null && (
          <div>
            <div style={{ height: '8px', borderRadius: '4px', background: '#F3F4F6', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${percentUsed}%`, background: percentUsed >= 90 ? '#DC2626' : percentUsed >= 80 ? '#D97706' : '#4F46E5', transition: 'width 0.3s ease' }} />
            </div>
            <div style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '4px' }}>{percentUsed}% used</div>
          </div>
        )}
      </div>

      <div style={{ ...cardStyle, marginBottom: '16px' }}>
        <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#141B2B', margin: '0 0 12px 0' }}>Storage breakdown</h3>
        {breakdownTotal === 0 ? (
          <p style={{ fontSize: '12px', color: '#9CA3AF' }}>No recordings yet — nothing to break down.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {Object.entries(data.breakdown).map(([key, bytes]: [string, any]) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: BREAKDOWN_COLORS[key], flexShrink: 0 }} />
                <span style={{ fontSize: '13px', color: '#374151', flex: 1 }}>{BREAKDOWN_LABELS[key]}</span>
                <span style={{ fontSize: '12px', color: '#6B7280' }}>{formatBytes(bytes)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ ...cardStyle, marginBottom: '16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '12px' }}>
          <div>
            <label style={labelStyle}>Recording retention</label>
            <select style={inputStyle} defaultValue={data.retentionDays} disabled={!data.canManageStoragePolicy}>
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
              <option value={90}>90 days</option>
              <option value={180}>180 days</option>
              <option value={0}>Keep until manually deleted</option>
            </select>
          </div>
        </div>
        <Toggle label="Notify me when storage reaches 80%" checked={notify80} onChange={setNotify80} />
        <Toggle label="Notify me when storage reaches 90%" checked={notify90} onChange={setNotify90} />
        <Toggle label="Automatically delete recordings after the retention period" checked={autoDelete} onChange={setAutoDelete} disabled={!data.canManageStoragePolicy} />
        {!data.canManageStoragePolicy && (
          <p style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '6px' }}>Only an organization Admin can change retention and deletion policy.</p>
        )}
        <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
          <button style={{ padding: '9px 16px', borderRadius: '8px', border: '1px solid #4F46E5', color: '#4F46E5', background: '#FFFFFF', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Request more storage</button>
          <button
            onClick={() => (window.location.href = '/dashboard?tab=recordings')}
            style={{ padding: '9px 16px', borderRadius: '8px', border: '1px solid #D1D5DB', color: '#141B2B', background: '#FFFFFF', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
          >
            Manage recordings
          </button>
        </div>
      </div>

      <div style={cardStyle}>
        <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#141B2B', margin: '0 0 12px 0' }}>Largest recordings</h3>
        {data.largestRecordings.length === 0 ? (
          <p style={{ fontSize: '12px', color: '#9CA3AF' }}>No recordings yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #E5E7EB' }}>
                  <th style={{ textAlign: 'left', padding: '8px 6px', fontSize: '11px', fontWeight: 700, color: '#6B7280' }}>RECORDING</th>
                  <th style={{ textAlign: 'left', padding: '8px 6px', fontSize: '11px', fontWeight: 700, color: '#6B7280' }}>DATE</th>
                  <th style={{ textAlign: 'left', padding: '8px 6px', fontSize: '11px', fontWeight: 700, color: '#6B7280' }}>ORGANIZER</th>
                  <th style={{ textAlign: 'left', padding: '8px 6px', fontSize: '11px', fontWeight: 700, color: '#6B7280' }}>SIZE</th>
                  <th style={{ textAlign: 'right', padding: '8px 6px', fontSize: '11px', fontWeight: 700, color: '#6B7280' }}>MANAGE</th>
                </tr>
              </thead>
              <tbody>
                {data.largestRecordings.map((r: any) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                    <td style={{ padding: '9px 6px', fontSize: '13px', fontWeight: 600, color: '#141B2B' }}>{r.name}</td>
                    <td style={{ padding: '9px 6px', fontSize: '12px', color: '#6B7280' }}>{new Date(r.recordedAt).toLocaleDateString()}</td>
                    <td style={{ padding: '9px 6px', fontSize: '12px', color: '#6B7280' }}>{r.organizer}</td>
                    <td style={{ padding: '9px 6px', fontSize: '12px', color: '#6B7280' }}>{formatBytes(r.sizeBytes)}</td>
                    <td style={{ padding: '9px 6px', textAlign: 'right' }}>
                      <button onClick={() => (window.location.href = '/dashboard?tab=recordings')} style={{ padding: '5px 12px', borderRadius: '6px', border: '1px solid #C7D2FE', color: '#4F46E5', background: '#FFFFFF', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>Manage</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

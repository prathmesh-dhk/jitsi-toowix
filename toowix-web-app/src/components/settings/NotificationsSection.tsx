import React, { useEffect, useState } from 'react';
import { settingsApi } from '../../lib/settingsApi';
import {
  sectionHeaderStyle, sectionTitleStyle, sectionSubtitleStyle, cardStyle, labelStyle,
  inputStyle, SettingsFooterActions, Toast, useSettingsDirty,
} from './SettingsShared';
import { Info } from 'lucide-react';

const NOTIFICATION_ROWS: { key: string; label: string; locked?: boolean }[] = [
  { key: 'MEETING_INVITATION', label: 'Meeting invitations' },
  { key: 'MEETING_STARTS_SOON', label: 'Meeting starts soon' },
  { key: 'MEETING_STARTED', label: 'Meeting started' },
  { key: 'MEETING_RESCHEDULED', label: 'Meeting rescheduled' },
  { key: 'MEETING_CANCELLED', label: 'Meeting cancelled' },
  { key: 'GUEST_WAITING_LOBBY', label: 'Guest waiting in lobby' },
  { key: 'PARTICIPANT_REQUESTED_JOIN', label: 'Participant requested to join' },
  { key: 'RECORDING_STARTED', label: 'Recording started' },
  { key: 'RECORDING_READY', label: 'Recording ready' },
  { key: 'RECORDING_FAILED', label: 'Recording processing failed' },
  { key: 'RECORDING_SHARED', label: 'Recording shared with me' },
  { key: 'ROLE_ACCOUNT_CHANGED', label: 'Role or account changed' },
  { key: 'USER_ADDED_UNDER_ME', label: 'User added under my account' },
  { key: 'SECURITY_ALERT', label: 'New login or security alert', locked: true },
  { key: 'STORAGE_LIMIT_WARNING', label: 'Storage limit warning' },
  { key: 'MAINTENANCE_SCHEDULED', label: 'Scheduled maintenance' },
  { key: 'PRODUCT_UPDATES', label: 'Product updates' },
];

interface IEntry { inApp: boolean; email: boolean; }
type IEntries = Record<string, IEntry>;

const defaultEntries = (): IEntries =>
  Object.fromEntries(NOTIFICATION_ROWS.map((r) => [r.key, { inApp: true, email: r.key === 'SECURITY_ALERT' }]));

export function NotificationsSection() {
  const { setDirty } = useSettingsDirty();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const [originalEntries, setOriginalEntries] = useState<IEntries | null>(null);
  const [entries, setEntries] = useState<IEntries | null>(null);
  const [originalMuteAll, setOriginalMuteAll] = useState(false);
  const [muteAll, setMuteAll] = useState(false);
  const [originalReminder, setOriginalReminder] = useState(10);
  const [reminder, setReminder] = useState(10);

  useEffect(() => {
    settingsApi.get<any>('/').then((data) => {
      const np = data.notificationPreferences || {};
      const loaded: IEntries = Object.keys(np.entries || {}).length > 0 ? np.entries : defaultEntries();
      setOriginalEntries(loaded);
      setEntries(loaded);
      setOriginalMuteAll(!!np.muteAll);
      setMuteAll(!!np.muteAll);
      setOriginalReminder(np.reminderMinutesBefore || 10);
      setReminder(np.reminderMinutesBefore || 10);
      setLoading(false);
    }).catch(() => { setToast({ message: 'Could not load notification preferences.', type: 'error' }); setLoading(false); });
  }, []);

  const isDirty = JSON.stringify(entries) !== JSON.stringify(originalEntries) || muteAll !== originalMuteAll || reminder !== originalReminder;

  useEffect(() => {
    setDirty(isDirty);
    return () => setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty, setDirty]);

  const toggleCell = (key: string, channel: 'inApp' | 'email') => {
    if (key === 'SECURITY_ALERT') return; // critical, never fully off
    setEntries((prev) => (prev ? { ...prev, [key]: { ...prev[key], [channel]: !prev[key][channel] } } : prev));
  };

  const handleSave = async () => {
    if (!entries || saving) return;
    setSaving(true);
    try {
      const data = await settingsApi.patch<any>('/notifications', { muteAll, reminderMinutesBefore: reminder, entries });
      const np = data.notificationPreferences;
      setEntries(np.entries);
      setOriginalEntries(np.entries);
      setMuteAll(np.muteAll);
      setOriginalMuteAll(np.muteAll);
      setOriginalReminder(np.reminderMinutesBefore);
      setDirty(false);
      setToast({ message: 'Notification preferences saved.', type: 'success' });
    } catch (err: any) {
      setToast({ message: err.message || 'Could not save.', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (originalEntries) setEntries(originalEntries);
    setMuteAll(originalMuteAll);
    setReminder(originalReminder);
    setDirty(false);
  };

  if (loading || !entries) return <p style={{ color: '#9CA3AF', fontSize: '13px' }}>Loading...</p>;

  return (
    <div>
      <div style={sectionHeaderStyle}>
        <h1 style={sectionTitleStyle}>Notifications</h1>
        <p style={sectionSubtitleStyle}>Choose which updates you want to receive.</p>
      </div>

      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#141B2B' }}>Mute all notifications</span>
            <span
              onClick={() => setMuteAll((m) => !m)}
              role="switch"
              aria-checked={muteAll}
              style={{ width: '38px', height: '22px', borderRadius: '11px', background: muteAll ? '#4F46E5' : '#D1D5DB', position: 'relative', cursor: 'pointer' }}
            >
              <span style={{ position: 'absolute', top: '2px', left: muteAll ? '18px' : '2px', width: '18px', height: '18px', borderRadius: '50%', background: '#FFFFFF', transition: 'left 0.15s ease' }} />
            </span>
          </div>
          <div>
            <label style={{ ...labelStyle, marginBottom: '4px', display: 'inline-block', marginRight: '8px' }}>Meeting reminder timing</label>
            <select style={{ ...inputStyle, width: 'auto', height: '32px', display: 'inline-block' }} value={reminder} onChange={(e) => setReminder(Number(e.target.value))}>
              <option value={5}>5 minutes before</option>
              <option value={10}>10 minutes before</option>
              <option value={15}>15 minutes before</option>
              <option value={30}>30 minutes before</option>
              <option value={60}>1 hour before</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', background: '#F9FAFB', border: '1px solid #F3F4F6', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', fontSize: '12px', color: '#6B7280' }}>
          <Info size={14} style={{ marginTop: '1px', flexShrink: 0 }} />
          Critical security notifications can't be fully disabled — they'll always reach you in-app, even with mute all on.
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #E5E7EB' }}>
                <th style={{ textAlign: 'left', padding: '8px 6px', fontSize: '11px', fontWeight: 700, color: '#6B7280' }}>NOTIFICATION</th>
                <th style={{ textAlign: 'center', padding: '8px 6px', fontSize: '11px', fontWeight: 700, color: '#6B7280' }}>IN-APP</th>
                <th style={{ textAlign: 'center', padding: '8px 6px', fontSize: '11px', fontWeight: 700, color: '#6B7280' }}>EMAIL</th>
              </tr>
            </thead>
            <tbody>
              {NOTIFICATION_ROWS.map((row) => {
                const entry = entries[row.key] || { inApp: true, email: false };
                return (
                  <tr key={row.key} style={{ borderBottom: '1px solid #F3F4F6' }}>
                    <td style={{ padding: '9px 6px', fontSize: '13px', color: '#374151' }}>
                      {row.label}
                      {row.locked && <span style={{ marginLeft: '6px', fontSize: '10px', color: '#9CA3AF' }}>(always on)</span>}
                    </td>
                    <td style={{ textAlign: 'center', padding: '9px 6px' }}>
                      <input type="checkbox" checked={entry.inApp} disabled={row.locked} onChange={() => toggleCell(row.key, 'inApp')} style={{ accentColor: '#4F46E5', width: '16px', height: '16px', cursor: row.locked ? 'not-allowed' : 'pointer' }} />
                    </td>
                    <td style={{ textAlign: 'center', padding: '9px 6px' }}>
                      <input type="checkbox" checked={entry.email} disabled={row.locked && entry.email} onChange={() => toggleCell(row.key, 'email')} style={{ accentColor: '#4F46E5', width: '16px', height: '16px', cursor: 'pointer' }} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <SettingsFooterActions onCancel={handleCancel} onSave={handleSave} saving={saving} disabled={!isDirty} />
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

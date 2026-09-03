import React, { useEffect, useState } from 'react';
import { settingsApi } from '../../lib/settingsApi';
import {
  sectionHeaderStyle, sectionTitleStyle, sectionSubtitleStyle, cardStyle, labelStyle,
  inputStyle, SettingsFooterActions, Toggle, Toast, useSettingsDirty,
} from './SettingsShared';

const DEFAULTS = {
  cameraOffOnJoin: false, useHdVideo: true, mirrorMyVideo: true, displayParticipantNames: true,
  muteMicOnJoin: false, autoAdjustMicVolume: true, playJoinLeaveSounds: true, noiseSuppression: true,
  requireLobby: false, allowJoinBeforeHost: true, requireAuthenticatedUsers: false, allowExternalGuests: true,
  autoAdmitInternalUsers: true, notifyHostOnLobbyEntry: true, defaultDurationMinutes: 30, defaultMeetingType: 'Internal' as 'Internal' | 'Guest',
};
type IForm = typeof DEFAULTS;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '20px' }}>
      <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#141B2B', margin: '0 0 6px 0' }}>{title}</h3>
      {children}
    </div>
  );
}

export function MeetingsSection() {
  const { setDirty } = useSettingsDirty();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [original, setOriginal] = useState<IForm | null>(null);
  const [form, setForm] = useState<IForm | null>(null);

  useEffect(() => {
    settingsApi.get<any>('/').then((data) => {
      const parsed = { ...DEFAULTS, ...data.meetingDefaults };
      setOriginal(parsed);
      setForm(parsed);
      setLoading(false);
    }).catch(() => { setToast({ message: 'Could not load meeting preferences.', type: 'error' }); setLoading(false); });
  }, []);

  useEffect(() => {
    if (!original || !form) return;
    setDirty(JSON.stringify(original) !== JSON.stringify(form));
    return () => setDirty(false);
  }, [form, original, setDirty]);

  const set = <K extends keyof IForm>(field: K, value: IForm[K]) => setForm((f) => (f ? { ...f, [field]: value } : f));

  const handleSave = async () => {
    if (!form || saving) return;
    setSaving(true);
    try {
      await settingsApi.patch('/meetings', form);
      setOriginal(form);
      setDirty(false);
      setToast({ message: 'Meeting preferences saved.', type: 'success' });
    } catch (err: any) {
      setToast({ message: err.message || 'Could not save.', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  if (loading || !form) return <p style={{ color: '#9CA3AF', fontSize: '13px' }}>Loading...</p>;

  return (
    <div>
      <div style={sectionHeaderStyle}>
        <h1 style={sectionTitleStyle}>Meeting preferences</h1>
        <p style={sectionSubtitleStyle}>Set defaults for meetings you organize.</p>
      </div>

      <div style={cardStyle}>
        <Section title="Video">
          <Toggle label="Camera off when joining" checked={form.cameraOffOnJoin} onChange={(v) => set('cameraOffOnJoin', v)} />
          <Toggle label="Use HD video when available" checked={form.useHdVideo} onChange={(v) => set('useHdVideo', v)} />
          <Toggle label="Mirror my video" checked={form.mirrorMyVideo} onChange={(v) => set('mirrorMyVideo', v)} />
          <Toggle label="Display participant names" checked={form.displayParticipantNames} onChange={(v) => set('displayParticipantNames', v)} />
        </Section>

        <div style={{ height: '1px', background: '#F3F4F6', margin: '16px 0' }} />

        <Section title="Audio">
          <Toggle label="Mute microphone when joining" checked={form.muteMicOnJoin} onChange={(v) => set('muteMicOnJoin', v)} />
          <Toggle label="Automatically adjust microphone volume" checked={form.autoAdjustMicVolume} onChange={(v) => set('autoAdjustMicVolume', v)} />
          <Toggle label="Play join and leave sounds" checked={form.playJoinLeaveSounds} onChange={(v) => set('playJoinLeaveSounds', v)} />
          <Toggle label="Noise suppression" checked={form.noiseSuppression} onChange={(v) => set('noiseSuppression', v)} />
        </Section>

        <div style={{ height: '1px', background: '#F3F4F6', margin: '16px 0' }} />

        <Section title="Joining and access">
          <Toggle label="Require guests to wait in the lobby" checked={form.requireLobby} onChange={(v) => set('requireLobby', v)} />
          <Toggle label="Allow participants to join before the host" checked={form.allowJoinBeforeHost} onChange={(v) => set('allowJoinBeforeHost', v)} />
          <Toggle label="Require authenticated company users" checked={form.requireAuthenticatedUsers} onChange={(v) => set('requireAuthenticatedUsers', v)} />
          <Toggle label="Allow external guests" checked={form.allowExternalGuests} onChange={(v) => set('allowExternalGuests', v)} />
          <Toggle label="Automatically admit internal users" checked={form.autoAdmitInternalUsers} onChange={(v) => set('autoAdmitInternalUsers', v)} />
          <Toggle label="Notify the host when someone enters the lobby" checked={form.notifyHostOnLobbyEntry} onChange={(v) => set('notifyHostOnLobbyEntry', v)} />
        </Section>

        <div style={{ height: '1px', background: '#F3F4F6', margin: '16px 0' }} />

        <Section title="Defaults">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={labelStyle}>Default meeting duration</label>
              <select style={inputStyle} value={form.defaultDurationMinutes} onChange={(e) => set('defaultDurationMinutes', Number(e.target.value))}>
                {[15, 30, 45, 60, 90].map((m) => <option key={m} value={m}>{m} min</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Default meeting type</label>
              <select style={inputStyle} value={form.defaultMeetingType} onChange={(e) => set('defaultMeetingType', e.target.value as any)}>
                <option value="Internal">Internal</option>
                <option value="Guest">External</option>
              </select>
            </div>
          </div>
        </Section>

        <SettingsFooterActions onCancel={() => { if (original) setForm(original); setDirty(false); }} onSave={handleSave} saving={saving} disabled={JSON.stringify(original) === JSON.stringify(form)} />
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

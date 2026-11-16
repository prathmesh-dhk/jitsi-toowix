import React, { useEffect, useState } from 'react';
import { settingsApi } from '../../lib/settingsApi';
import {
  sectionHeaderStyle, sectionTitleStyle, sectionSubtitleStyle, cardStyle,
  SettingsFooterActions, Toggle, Toast, useSettingsDirty,
} from './SettingsShared';
import { useTheme } from '../../lib/theme';

const DEFAULTS = {
  cameraOffOnJoin: false, useHdVideo: true,
  muteMicOnJoin: false, autoAdjustMicVolume: true, noiseSuppression: true,
};
type IForm = typeof DEFAULTS;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { isDark } = useTheme();
  return (
    <div style={{ marginBottom: '20px' }}>
      <h3 style={{ fontSize: '13px', fontWeight: 700, color: isDark ? '#F9FAFB' : '#141B2B', margin: '0 0 6px 0' }}>{title}</h3>
      {children}
    </div>
  );
}

export function MeetingsSection() {
  const { isDark } = useTheme();
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
        <h1 style={sectionTitleStyle(isDark)}>Meeting preferences</h1>
        <p style={sectionSubtitleStyle(isDark)}>Set defaults for meetings you organize.</p>
      </div>

      <div style={cardStyle(isDark)}>
        <Section title="Video">
          <Toggle label="Camera off when joining" checked={form.cameraOffOnJoin} onChange={(v) => set('cameraOffOnJoin', v)} />
          <Toggle label="Use HD video when available" checked={form.useHdVideo} onChange={(v) => set('useHdVideo', v)} />
        </Section>

        <div style={{ height: '1px', background: isDark ? '#1E293B' : '#F3F4F6', margin: '16px 0' }} />

        <Section title="Audio">
          <Toggle label="Mute microphone when joining" checked={form.muteMicOnJoin} onChange={(v) => set('muteMicOnJoin', v)} />
          <Toggle label="Automatically adjust microphone volume" checked={form.autoAdjustMicVolume} onChange={(v) => set('autoAdjustMicVolume', v)} />
          <Toggle label="Noise suppression" checked={form.noiseSuppression} onChange={(v) => set('noiseSuppression', v)} />
        </Section>

        <SettingsFooterActions onCancel={() => { if (original) setForm(original); setDirty(false); }} onSave={handleSave} saving={saving} disabled={JSON.stringify(original) === JSON.stringify(form)} />
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { settingsApi } from '../../lib/settingsApi';
import { useTheme } from '../../lib/theme';
import { auth } from '../../lib/firebase';
import {
  sectionHeaderStyle, sectionTitleStyle, sectionSubtitleStyle, cardStyle, labelStyle,
  inputStyle, SettingsFooterActions, Toggle, Toast, useSettingsDirty,
} from './SettingsShared';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000';

async function policyRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const idToken = await auth.currentUser?.getIdToken();
  const response = await fetch(`${BACKEND_URL}/api/companies${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}), ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data as T;
}

interface IMeetingPolicyForm {
  allowGuestAccess: boolean;
  requireLobby: boolean;
  recordingEnabled: boolean;
  autoRecording: boolean;
  allowScreenShare: boolean;
  micLockEnabled: boolean;
  maxMeetingDurationMinutes: number | null;
}

interface IGeneralForm {
  language: string;
  timezone: string;
  dateFormat: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
  timeFormat: '12h' | '24h';
  weekStartsOn: 'SUNDAY' | 'MONDAY';
  appearance: 'light' | 'dark' | 'system';
  reduceMotion: boolean;
  highContrast: boolean;
}

const TIMEZONES = ['UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Asia/Kolkata', 'Asia/Singapore', 'Australia/Sydney'];
const LANGUAGES = [{ code: 'en', label: 'English' }, { code: 'hi', label: 'Hindi' }, { code: 'es', label: 'Spanish' }, { code: 'fr', label: 'French' }];

export function GeneralSection() {
  const { setTheme } = useTheme();
  const { setDirty } = useSettingsDirty();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [original, setOriginal] = useState<IGeneralForm | null>(null);
  const [form, setForm] = useState<IGeneralForm | null>(null);

  const [canManagePolicy, setCanManagePolicy] = useState(false);
  const [policyOriginal, setPolicyOriginal] = useState<IMeetingPolicyForm | null>(null);
  const [policyForm, setPolicyForm] = useState<IMeetingPolicyForm | null>(null);
  const [policySaving, setPolicySaving] = useState(false);

  useEffect(() => {
    settingsApi.get<any>('/').then((data) => {
      const parsed: IGeneralForm = {
        language: data.profileExtra.language || 'en',
        timezone: data.profileExtra.timezone || 'UTC',
        dateFormat: data.preferences.dateFormat || 'DD/MM/YYYY',
        timeFormat: data.preferences.timeFormat || '12h',
        weekStartsOn: data.preferences.weekStartsOn || 'SUNDAY',
        appearance: data.preferences.appearance || 'system',
        reduceMotion: !!data.preferences.reduceMotion,
        highContrast: !!data.preferences.highContrast,
      };
      setOriginal(parsed);
      setForm(parsed);
      setLoading(false);
    }).catch(() => { setToast({ message: 'Could not load preferences.', type: 'error' }); setLoading(false); });

    // Company Meeting Policy is org-wide, not personal -- only rendered/loaded for
    // Company Admins (or Super Admin) since only they're allowed to change it.
    policyRequest<any>('/meeting-policy').then((data) => {
      if (!data.canEdit) return;
      setCanManagePolicy(true);
      const p: IMeetingPolicyForm = {
        allowGuestAccess: data.meetingPolicy.allowGuestAccess,
        requireLobby: data.meetingPolicy.requireLobby,
        recordingEnabled: data.meetingPolicy.recordingEnabled,
        autoRecording: data.meetingPolicy.autoRecording,
        allowScreenShare: data.meetingPolicy.allowScreenShare,
        micLockEnabled: data.meetingPolicy.micLockEnabled,
        maxMeetingDurationMinutes: data.meetingPolicy.maxMeetingDurationMinutes,
      };
      setPolicyOriginal(p);
      setPolicyForm(p);
    }).catch(() => {
      // Not part of a company, or not an admin -- silently skip; this card just won't render.
    });
  }, []);

  const updatePolicy = <K extends keyof IMeetingPolicyForm>(field: K, value: IMeetingPolicyForm[K]) => {
    setPolicyForm((f) => (f ? { ...f, [field]: value } : f));
  };

  const handleSavePolicy = async () => {
    if (!policyForm || policySaving) return;
    setPolicySaving(true);
    try {
      const data = await policyRequest<any>('/meeting-policy', { method: 'PATCH', body: JSON.stringify(policyForm) });
      const p: IMeetingPolicyForm = {
        allowGuestAccess: data.meetingPolicy.allowGuestAccess,
        requireLobby: data.meetingPolicy.requireLobby,
        recordingEnabled: data.meetingPolicy.recordingEnabled,
        autoRecording: data.meetingPolicy.autoRecording,
        allowScreenShare: data.meetingPolicy.allowScreenShare,
        micLockEnabled: data.meetingPolicy.micLockEnabled,
        maxMeetingDurationMinutes: data.meetingPolicy.maxMeetingDurationMinutes,
      };
      setPolicyOriginal(p);
      setPolicyForm(p);
      setToast({ message: 'Meeting policy saved.', type: 'success' });
    } catch (err: any) {
      setToast({ message: err.message || 'Could not save meeting policy.', type: 'error' });
    } finally {
      setPolicySaving(false);
    }
  };

  useEffect(() => {
    if (!original || !form) return;
    setDirty(JSON.stringify(original) !== JSON.stringify(form));
    return () => setDirty(false);
  }, [form, original, setDirty]);

  const update = <K extends keyof IGeneralForm>(field: K, value: IGeneralForm[K]) => {
    setForm((f) => (f ? { ...f, [field]: value } : f));
    // "Should update the application preview immediately" -- apply appearance live via the
    // existing theme hook, but it only gets PERSISTED to the backend on Save.
    if (field === 'appearance') {
      const v = value as IGeneralForm['appearance'];
      if (v === 'system') {
        const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
        setTheme(prefersDark ? 'dark' : 'light');
      } else {
        setTheme(v);
      }
    }
  };

  const handleSave = async () => {
    if (!form || saving) return;
    setSaving(true);
    try {
      await settingsApi.patch('/general', {
        dateFormat: form.dateFormat,
        timeFormat: form.timeFormat,
        weekStartsOn: form.weekStartsOn,
        appearance: form.appearance,
        reduceMotion: form.reduceMotion,
        highContrast: form.highContrast,
      });
      await settingsApi.patch('/profile', { timezone: form.timezone, language: form.language });
      setOriginal(form);
      setDirty(false);
      setToast({ message: 'Preferences saved.', type: 'success' });
    } catch (err: any) {
      setToast({ message: err.message || 'Could not save preferences.', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (original) {
      setForm(original);
      if (original.appearance !== 'system') setTheme(original.appearance);
    }
    setDirty(false);
  };

  if (loading || !form) return <p style={{ color: '#9CA3AF', fontSize: '13px' }}>Loading...</p>;

  return (
    <div>
      <div style={sectionHeaderStyle}>
        <h1 style={sectionTitleStyle}>General</h1>
        <p style={sectionSubtitleStyle}>Choose your language, time and appearance preferences.</p>
      </div>

      <div style={cardStyle}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
          <div>
            <label style={labelStyle}>App language</label>
            <select style={inputStyle} value={form.language} onChange={(e) => update('language', e.target.value)}>
              {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Time zone</label>
            <select style={inputStyle} value={form.timezone} onChange={(e) => update('timezone', e.target.value)}>
              {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
          <div>
            <label style={labelStyle}>Date format</label>
            <select style={inputStyle} value={form.dateFormat} onChange={(e) => update('dateFormat', e.target.value as any)}>
              <option value="DD/MM/YYYY">DD/MM/YYYY</option>
              <option value="MM/DD/YYYY">MM/DD/YYYY</option>
              <option value="YYYY-MM-DD">YYYY-MM-DD</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Time format</label>
            <select style={inputStyle} value={form.timeFormat} onChange={(e) => update('timeFormat', e.target.value as any)}>
              <option value="12h">12-hour</option>
              <option value="24h">24-hour</option>
            </select>
          </div>
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={labelStyle}>Week starts on</label>
          <select style={inputStyle} value={form.weekStartsOn} onChange={(e) => update('weekStartsOn', e.target.value as any)}>
            <option value="SUNDAY">Sunday</option>
            <option value="MONDAY">Monday</option>
          </select>
        </div>

        <label style={labelStyle}>Appearance</label>
        <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
          {(['light', 'dark', 'system'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => update('appearance', mode)}
              style={{
                flex: 1,
                padding: '10px',
                borderRadius: '8px',
                border: form.appearance === mode ? '2px solid #4F46E5' : '1px solid #D1D5DB',
                background: form.appearance === mode ? '#EEF2FF' : '#FFFFFF',
                color: form.appearance === mode ? '#4F46E5' : '#374151',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}
            >
              {mode}
            </button>
          ))}
        </div>

        <div style={{ height: '1px', background: '#F3F4F6', margin: '18px 0' }} />

        <Toggle label="Reduce motion" checked={form.reduceMotion} onChange={(v) => update('reduceMotion', v)} />
        <Toggle label="High contrast" checked={form.highContrast} onChange={(v) => update('highContrast', v)} />

        <SettingsFooterActions onCancel={handleCancel} onSave={handleSave} saving={saving} disabled={JSON.stringify(original) === JSON.stringify(form)} />
      </div>

      {canManagePolicy && policyForm && (
        <div style={{ ...cardStyle, marginTop: '16px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#141B2B', margin: '0 0 4px 0' }}>Company meeting policy</h3>
          <p style={{ fontSize: '12px', color: '#9CA3AF', margin: '0 0 16px 0' }}>
            Applies to every meeting created in your organization. Only Admins can change this.
          </p>

          <Toggle label="Allow guest (non-invitee) meetings" checked={policyForm.allowGuestAccess} onChange={(v) => updatePolicy('allowGuestAccess', v)} />
          <Toggle label="Require lobby for every meeting" checked={policyForm.requireLobby} onChange={(v) => updatePolicy('requireLobby', v)} />
          <Toggle label="Recording allowed" checked={policyForm.recordingEnabled} onChange={(v) => updatePolicy('recordingEnabled', v)} />
          <Toggle label="Start recording automatically (requires Jibri configured on the Jitsi server)" checked={policyForm.autoRecording} onChange={(v) => updatePolicy('autoRecording', v)} />
          <Toggle label="Allow screen sharing" checked={policyForm.allowScreenShare} onChange={(v) => updatePolicy('allowScreenShare', v)} />
          <Toggle label="Lock microphone for participants by default" checked={policyForm.micLockEnabled} onChange={(v) => updatePolicy('micLockEnabled', v)} />

          <div style={{ marginTop: '14px', maxWidth: '260px' }}>
            <label style={labelStyle}>Max meeting duration (minutes, blank = no limit)</label>
            <input
              type="number"
              min={1}
              style={inputStyle}
              value={policyForm.maxMeetingDurationMinutes ?? ''}
              onChange={(e) => updatePolicy('maxMeetingDurationMinutes', e.target.value ? Number(e.target.value) : null)}
            />
          </div>

          <SettingsFooterActions
            onCancel={() => setPolicyForm(policyOriginal)}
            onSave={handleSavePolicy}
            saving={policySaving}
            disabled={JSON.stringify(policyOriginal) === JSON.stringify(policyForm)}
          />
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

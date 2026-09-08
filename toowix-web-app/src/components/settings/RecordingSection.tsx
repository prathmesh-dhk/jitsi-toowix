import React, { useEffect, useState } from 'react';
import { settingsApi } from '../../lib/settingsApi';
import {
  sectionHeaderStyle, sectionTitleStyle, sectionSubtitleStyle, cardStyle, labelStyle,
  inputStyle, SettingsFooterActions, Toggle, Toast, useSettingsDirty,
} from './SettingsShared';
import { Info } from 'lucide-react';

const DEFAULTS = {
  autoRecordOwnMeetings: false, recordActiveSpeakerAndScreen: true, recordGallery: false,
  generateAudioOnly: false, generateTranscript: false, generateCaptions: false, includeChatInResources: false,
  quality: '1080p' as '720p' | '1080p', layout: 'ActiveSpeaker' as 'ActiveSpeaker' | 'Gallery' | 'SharedScreenWithSpeaker',
  retentionDays: 90, allowParticipantDownload: true, allowExternalGuestAccess: false,
};
type IForm = typeof DEFAULTS;

export function RecordingSection() {
  const { setDirty } = useSettingsDirty();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [original, setOriginal] = useState<IForm | null>(null);
  const [form, setForm] = useState<IForm | null>(null);
  const [confirmAutoRecord, setConfirmAutoRecord] = useState(false);

  useEffect(() => {
    settingsApi.get<any>('/').then((data) => {
      const parsed = { ...DEFAULTS, ...data.recordingPreferences };
      setOriginal(parsed);
      setForm(parsed);
      setLoading(false);
    }).catch(() => { setToast({ message: 'Could not load recording preferences.', type: 'error' }); setLoading(false); });
  }, []);

  useEffect(() => {
    if (!original || !form) return;
    setDirty(JSON.stringify(original) !== JSON.stringify(form));
    return () => setDirty(false);
  }, [form, original, setDirty]);

  const set = <K extends keyof IForm>(field: K, value: IForm[K]) => setForm((f) => (f ? { ...f, [field]: value } : f));

  const doSave = async () => {
    if (!form || saving) return;
    setSaving(true);
    try {
      await settingsApi.patch('/recording', form);
      setOriginal(form);
      setDirty(false);
      setToast({ message: 'Recording preferences saved.', type: 'success' });
    } catch (err: any) {
      setToast({ message: err.message || 'Could not save.', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleSave = () => {
    // "If automatic recording is enabled, require confirmation before saving."
    if (form?.autoRecordOwnMeetings && !original?.autoRecordOwnMeetings) {
      setConfirmAutoRecord(true);
      return;
    }
    doSave();
  };

  if (loading || !form) return <p style={{ color: '#9CA3AF', fontSize: '13px' }}>Loading...</p>;

  return (
    <div>
      <div style={sectionHeaderStyle}>
        <h1 style={sectionTitleStyle}>Recording</h1>
        <p style={sectionSubtitleStyle}>Control how meeting recordings are created and stored.</p>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', background: '#EEF2FF', border: '1px solid #C7D2FE', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', fontSize: '12px', color: '#3730A3' }}>
        <Info size={14} style={{ marginTop: '1px', flexShrink: 0 }} />
        Participants will be notified when recording starts.
      </div>

      <div style={cardStyle}>
        <Toggle label="Automatically record meetings I organize" checked={form.autoRecordOwnMeetings} onChange={(v) => set('autoRecordOwnMeetings', v)} />
        <Toggle label="Record active speaker and shared screen" checked={form.recordActiveSpeakerAndScreen} onChange={(v) => set('recordActiveSpeakerAndScreen', v)} />
        <Toggle label="Record participant gallery" checked={form.recordGallery} onChange={(v) => set('recordGallery', v)} />
        <Toggle label="Generate an audio-only file" checked={form.generateAudioOnly} onChange={(v) => set('generateAudioOnly', v)} />
        <Toggle label="Generate meeting transcript" checked={form.generateTranscript} onChange={(v) => set('generateTranscript', v)} />
        <Toggle label="Generate captions" checked={form.generateCaptions} onChange={(v) => set('generateCaptions', v)} />
        <Toggle label="Include meeting chat in recording resources" checked={form.includeChatInResources} onChange={(v) => set('includeChatInResources', v)} />

        <div style={{ height: '1px', background: '#F3F4F6', margin: '16px 0' }} />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
          <div>
            <label style={labelStyle}>Recording quality</label>
            <select style={inputStyle} value={form.quality} onChange={(e) => set('quality', e.target.value as any)}>
              <option value="720p">720p</option>
              <option value="1080p">1080p</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Recording layout</label>
            <select style={inputStyle} value={form.layout} onChange={(e) => set('layout', e.target.value as any)}>
              <option value="ActiveSpeaker">Active speaker</option>
              <option value="Gallery">Gallery</option>
              <option value="SharedScreenWithSpeaker">Shared screen with speaker</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
          <div>
            <label style={labelStyle}>Storage location</label>
            <input style={{ ...inputStyle, background: '#F9FAFB', color: '#6B7280' }} value="Cloudflare R2 (company default)" readOnly />
          </div>
          <div>
            <label style={labelStyle}>Recording retention period</label>
            <select style={inputStyle} value={form.retentionDays} onChange={(e) => set('retentionDays', Number(e.target.value))}>
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
              <option value={90}>90 days</option>
              <option value={180}>180 days</option>
              <option value={0}>Keep until manually deleted</option>
            </select>
          </div>
        </div>

        <Toggle label="Allow participants to download recordings" checked={form.allowParticipantDownload} onChange={(v) => set('allowParticipantDownload', v)} />
        <Toggle label="Allow external guests to access recordings" checked={form.allowExternalGuestAccess} onChange={(v) => set('allowExternalGuestAccess', v)} />

        <SettingsFooterActions onCancel={() => { if (original) setForm(original); setDirty(false); }} onSave={handleSave} saving={saving} disabled={JSON.stringify(original) === JSON.stringify(form)} />
      </div>

      {confirmAutoRecord && (
        <div role="alertdialog" aria-modal="true" style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 'min(400px, 92vw)', background: '#FFFFFF', borderRadius: '14px', padding: '22px' }}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', fontWeight: 700, color: '#141B2B' }}>Enable automatic recording?</h3>
            <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: '#6B7280' }}>
              Every meeting you organize will be recorded automatically from the start, and participants will be notified.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button onClick={() => { setConfirmAutoRecord(false); set('autoRecordOwnMeetings', false); }} style={{ padding: '9px 16px', borderRadius: '8px', border: '1px solid #D1D5DB', background: '#FFFFFF', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => { setConfirmAutoRecord(false); doSave(); }} style={{ padding: '9px 16px', borderRadius: '8px', border: 'none', background: '#4F46E5', color: '#FFFFFF', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>Enable</button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

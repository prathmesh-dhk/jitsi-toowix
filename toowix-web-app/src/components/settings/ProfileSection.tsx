import React, { useEffect, useState } from 'react';
import { settingsApi } from '../../lib/settingsApi';
import {
  sectionHeaderStyle, sectionTitleStyle, sectionSubtitleStyle, cardStyle, labelStyle,
  inputStyle, readOnlyInputStyle, SettingsFooterActions, Toast, useSettingsDirty,
} from './SettingsShared';
import { CheckCircle2 } from 'lucide-react';

const TIMEZONES = ['UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Asia/Kolkata', 'Asia/Singapore', 'Australia/Sydney'];
const LANGUAGES = [{ code: 'en', label: 'English' }, { code: 'hi', label: 'Hindi' }, { code: 'es', label: 'Spanish' }, { code: 'fr', label: 'French' }];

interface IProfileForm {
  firstName: string;
  lastName: string;
  phoneNumber: string;
  jobTitle: string;
  timezone: string;
  language: string;
}

const initialsOf = (name: string) => name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';

export function ProfileSection() {
  const { setDirty } = useSettingsDirty();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [account, setAccount] = useState<any>(null);
  const [original, setOriginal] = useState<IProfileForm | null>(null);
  const [form, setForm] = useState<IProfileForm | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    settingsApi.get<any>('/').then((data) => {
      const [firstName, ...rest] = (data.account.fullName || '').split(' ');
      const parsed: IProfileForm = {
        firstName: firstName || '',
        lastName: rest.join(' ') || '',
        phoneNumber: data.profileExtra.phoneNumber || '',
        jobTitle: data.profileExtra.jobTitle || '',
        timezone: data.profileExtra.timezone || 'UTC',
        language: data.profileExtra.language || 'en',
      };
      setAccount(data.account);
      setAvatarUrl(data.account.avatarUrl);
      setOriginal(parsed);
      setForm(parsed);
      setLoading(false);
    }).catch(() => { setToast({ message: 'Could not load profile.', type: 'error' }); setLoading(false); });
  }, []);

  useEffect(() => {
    if (!original || !form) return;
    setDirty(JSON.stringify(original) !== JSON.stringify(form));
    return () => setDirty(false);
  }, [form, original, setDirty]);

  const update = (field: keyof IProfileForm, value: string) => setForm((f) => (f ? { ...f, [field]: value } : f));

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!form?.firstName.trim()) errs.firstName = 'First name is required';
    if (form?.phoneNumber && !/^[+]?[\d\s()-]{7,20}$/.test(form.phoneNumber)) errs.phoneNumber = 'Enter a valid phone number';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setToast({ message: 'Please choose a PNG, JPEG, or WEBP image.', type: 'error' });
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setToast({ message: 'Photo must be under 4MB.', type: 'error' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setAvatarUrl(reader.result as string);
    reader.readAsDataURL(file);
    setDirty(true);
  };

  const handleSave = async () => {
    if (!form || saving) return;
    if (!validate()) return;
    setSaving(true);
    try {
      await settingsApi.patch('/profile', {
        fullName: `${form.firstName.trim()} ${form.lastName.trim()}`.trim(),
        avatarUrl,
        phoneNumber: form.phoneNumber || null,
        jobTitle: form.jobTitle || null,
        timezone: form.timezone,
        language: form.language,
      });
      setOriginal(form);
      setDirty(false);
      setToast({ message: 'Profile updated.', type: 'success' });
    } catch (err: any) {
      setToast({ message: err.message || 'Could not save profile.', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (original) setForm(original);
    setAvatarUrl(account?.avatarUrl || null);
    setErrors({});
    setDirty(false);
  };

  if (loading || !form) return <p style={{ color: '#9CA3AF', fontSize: '13px' }}>Loading profile...</p>;

  return (
    <div>
      <div style={sectionHeaderStyle}>
        <h1 style={sectionTitleStyle}>Profile</h1>
        <p style={sectionSubtitleStyle}>Manage your personal information.</p>
      </div>

      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
          {avatarUrl ? (
            <img src={avatarUrl} alt="" style={{ width: '56px', height: '56px', borderRadius: '50%', objectFit: 'cover' }} />
          ) : (
            <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: '#EEF2FF', color: '#4F46E5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', fontWeight: 700 }}>
              {initialsOf(`${form.firstName} ${form.lastName}`)}
            </div>
          )}
          <label style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid #4F46E5', color: '#4F46E5', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            Change photo
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handlePhotoChange} style={{ display: 'none' }} />
          </label>
          {avatarUrl && (
            <button onClick={() => { setAvatarUrl(null); setDirty(true); }} style={{ background: 'transparent', border: 'none', color: '#DC2626', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              Remove
            </button>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
          <div>
            <label style={labelStyle}>First name</label>
            <input style={inputStyle} value={form.firstName} onChange={(e) => update('firstName', e.target.value)} aria-invalid={!!errors.firstName} />
            {errors.firstName && <span style={{ fontSize: '11px', color: '#DC2626' }}>{errors.firstName}</span>}
          </div>
          <div>
            <label style={labelStyle}>Last name</label>
            <input style={inputStyle} value={form.lastName} onChange={(e) => update('lastName', e.target.value)} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
          <div>
            <label style={labelStyle}>Email address</label>
            <div style={{ position: 'relative' }}>
              <input style={readOnlyInputStyle} value={account.email} readOnly />
              {account.emailVerified && (
                <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 700, color: '#059669' }}>
                  <CheckCircle2 size={13} /> Verified
                </span>
              )}
            </div>
          </div>
          <div>
            <label style={labelStyle}>Phone number</label>
            <input style={inputStyle} value={form.phoneNumber} onChange={(e) => update('phoneNumber', e.target.value)} placeholder="+91 98765 43210" />
            {errors.phoneNumber && <span style={{ fontSize: '11px', color: '#DC2626' }}>{errors.phoneNumber}</span>}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
          <div>
            <label style={labelStyle}>Job title</label>
            <input style={inputStyle} value={form.jobTitle} onChange={(e) => update('jobTitle', e.target.value)} placeholder="e.g. Product Admin" />
          </div>
          <div>
            <label style={labelStyle}>Time zone</label>
            <select style={inputStyle} value={form.timezone} onChange={(e) => update('timezone', e.target.value)}>
              {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>
        </div>

        <div style={{ marginBottom: '4px' }}>
          <label style={labelStyle}>Language</label>
          <select style={inputStyle} value={form.language} onChange={(e) => update('language', e.target.value)}>
            {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </div>

        <div style={{ height: '1px', background: '#F3F4F6', margin: '22px 0' }} />

        <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#141B2B', margin: '0 0 14px 0' }}>Organization</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div>
            <label style={labelStyle}>Organization</label>
            <input style={readOnlyInputStyle} value={account.organization || '—'} readOnly />
          </div>
          <div>
            <label style={labelStyle}>Role</label>
            <input style={readOnlyInputStyle} value={account.roleLabel} readOnly />
          </div>
        </div>

        <div style={{ height: '1px', background: '#F3F4F6', margin: '22px 0' }} />

        <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#141B2B', margin: '0 0 10px 0' }}>Account summary</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', fontSize: '13px', color: '#4B5563' }}>
          <div><div style={{ color: '#9CA3AF', fontSize: '11px' }}>Member since</div><div>{account.memberSince ? new Date(account.memberSince).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}</div></div>
          <div><div style={{ color: '#9CA3AF', fontSize: '11px' }}>Last sign-in</div><div>{account.lastSignIn ? new Date(account.lastSignIn).toLocaleString() : 'Not tracked'}</div></div>
        </div>

        <SettingsFooterActions onCancel={handleCancel} onSave={handleSave} saving={saving} disabled={JSON.stringify(original) === JSON.stringify(form) && avatarUrl === account.avatarUrl} />
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

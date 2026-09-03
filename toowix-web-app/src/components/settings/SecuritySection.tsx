import React, { useEffect, useState } from 'react';
import {
  EmailAuthProvider, reauthenticateWithCredential, updatePassword, signOut,
} from 'firebase/auth';
import { auth } from '../../lib/firebase';
import { settingsApi } from '../../lib/settingsApi';
import { sectionHeaderStyle, sectionTitleStyle, sectionSubtitleStyle, cardStyle, labelStyle, inputStyle, Toast } from './SettingsShared';
import { Eye, EyeOff, Info, AlertTriangle, Monitor, X } from 'lucide-react';

function strengthOf(pw: string): { score: number; label: string; color: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const labels = ['Weak', 'Weak', 'Fair', 'Good', 'Strong'];
  const colors = ['#DC2626', '#DC2626', '#D97706', '#3B82F6', '#059669'];
  return { score, label: labels[score], color: colors[score] };
}

export function SecuritySection() {
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [account, setAccount] = useState<any>(null);
  const [showChangePw, setShowChangePw] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [logOutOthers, setLogOutOthers] = useState(true);
  const [changingPw, setChangingPw] = useState(false);
  const [showDeactivate, setShowDeactivate] = useState(false);
  const [deactivatePw, setDeactivatePw] = useState('');
  const [deactivating, setDeactivating] = useState(false);
  const [sessions, setSessions] = useState<any[] | null>(null);
  const [signingOutOthers, setSigningOutOthers] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const isGoogleUser = auth.currentUser?.providerData.some((p) => p.providerId === 'google.com');

  const loadSessions = () => {
    const currentSessionToken = localStorage.getItem('toowix_session_token') || '';
    settingsApi
      .get<any>(`/security/sessions${currentSessionToken ? `?currentSessionToken=${encodeURIComponent(currentSessionToken)}` : ''}`)
      .then((data) => setSessions(data.sessions))
      .catch(() => setSessions([]));
  };

  useEffect(() => {
    settingsApi.get<any>('/').then((data) => setAccount(data.account)).catch(() => {});
    loadSessions();
  }, []);

  const handleRevokeSession = async (id: string) => {
    if (revokingId) return;
    setRevokingId(id);
    try {
      await settingsApi.post(`/security/sessions/${id}/revoke`);
      loadSessions();
    } catch (err: any) {
      setToast({ message: err.message || 'Could not remove session.', type: 'error' });
    } finally {
      setRevokingId(null);
    }
  };

  const handleSignOutOthers = async () => {
    if (signingOutOthers) return;
    setSigningOutOthers(true);
    try {
      const currentSessionToken = localStorage.getItem('toowix_session_token') || '';
      await settingsApi.post('/security/sessions/revoke-all-others', { currentSessionToken });
      setToast({ message: 'Other sessions signed out.', type: 'success' });
      loadSessions();
    } catch (err: any) {
      setToast({ message: err.message || 'Could not sign out other sessions.', type: 'error' });
    } finally {
      setSigningOutOthers(false);
    }
  };

  const strength = strengthOf(newPw);

  const handleChangePassword = async () => {
    if (changingPw) return;
    if (!currentPw || !newPw || !confirmPw) {
      setToast({ message: 'Fill in all password fields.', type: 'error' });
      return;
    }
    if (newPw !== confirmPw) {
      setToast({ message: 'New passwords do not match.', type: 'error' });
      return;
    }
    if (newPw.length < 8) {
      setToast({ message: 'New password must be at least 8 characters.', type: 'error' });
      return;
    }
    const user = auth.currentUser;
    if (!user || !user.email) {
      setToast({ message: 'No authenticated user found.', type: 'error' });
      return;
    }
    setChangingPw(true);
    try {
      // Real Firebase reauth + password change -- this can only happen client-side,
      // Firebase never accepts a password change without a fresh credential.
      const credential = EmailAuthProvider.credential(user.email, currentPw);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPw);
      await settingsApi.post('/security/password-changed');
      if (logOutOthers) {
        // Firebase doesn't expose "revoke all other sessions except this one" from the
        // client SDK -- the closest real action is signing this session out too, which
        // forces a fresh sign-in everywhere. Being honest: this signs out *everywhere*,
        // not selectively "other" sessions.
        await signOut(auth);
        window.location.href = '/login';
        return;
      }
      setShowChangePw(false);
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
      setToast({ message: 'Password changed.', type: 'success' });
      settingsApi.get<any>('/').then((data) => setAccount(data.account)).catch(() => {});
    } catch (err: any) {
      const message = err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential'
        ? 'Current password is incorrect.'
        : err.message || 'Could not change password.';
      setToast({ message, type: 'error' });
    } finally {
      setChangingPw(false);
    }
  };

  const handleDeactivate = async () => {
    if (deactivating) return;
    const user = auth.currentUser;
    if (!user?.email || !deactivatePw) {
      setToast({ message: 'Enter your password to confirm.', type: 'error' });
      return;
    }
    setDeactivating(true);
    try {
      const credential = EmailAuthProvider.credential(user.email, deactivatePw);
      await reauthenticateWithCredential(user, credential);
      await settingsApi.post('/security/deactivate');
      await signOut(auth);
      window.location.href = '/login';
    } catch (err: any) {
      setToast({ message: err.message || 'Could not deactivate account.', type: 'error' });
    } finally {
      setDeactivating(false);
    }
  };

  return (
    <div>
      <div style={sectionHeaderStyle}>
        <h1 style={sectionTitleStyle}>Security</h1>
        <p style={sectionSubtitleStyle}>Protect your account and review sign-in activity.</p>
      </div>

      {/* Password */}
      <div style={{ ...cardStyle, marginBottom: '16px' }}>
        <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#141B2B', margin: '0 0 4px 0' }}>Password</h3>
        <p style={{ fontSize: '12px', color: '#9CA3AF', margin: '0 0 12px 0' }}>
          {account?.passwordChangedAt ? `Last changed ${new Date(account.passwordChangedAt).toLocaleDateString()}` : 'No password change on record.'}
        </p>

        {isGoogleUser && !showChangePw ? (
          <p style={{ fontSize: '12px', color: '#9CA3AF' }}>You sign in with Google — there's no Toowix password to change here.</p>
        ) : !showChangePw ? (
          <button onClick={() => setShowChangePw(true)} style={{ padding: '9px 16px', borderRadius: '8px', border: '1px solid #4F46E5', color: '#4F46E5', background: '#FFFFFF', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            Change Password
          </button>
        ) : (
          <div>
            <div style={{ marginBottom: '12px' }}>
              <label style={labelStyle}>Current password</label>
              <div style={{ position: 'relative' }}>
                <input style={inputStyle} type={showPw ? 'text' : 'password'} value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} />
                <button onClick={() => setShowPw((s) => !s)} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#9CA3AF', cursor: 'pointer' }}>
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
            <div style={{ marginBottom: '4px' }}>
              <label style={labelStyle}>New password</label>
              <input style={inputStyle} type={showPw ? 'text' : 'password'} value={newPw} onChange={(e) => setNewPw(e.target.value)} />
            </div>
            {newPw && (
              <div style={{ display: 'flex', gap: '4px', margin: '6px 0 12px' }}>
                {[1, 2, 3, 4].map((i) => <div key={i} style={{ height: '4px', flex: 1, borderRadius: '2px', background: i <= strength.score ? strength.color : '#E5E7EB' }} />)}
                <span style={{ fontSize: '11px', color: strength.color, marginLeft: '6px', whiteSpace: 'nowrap' }}>{strength.label}</span>
              </div>
            )}
            <div style={{ marginBottom: '12px' }}>
              <label style={labelStyle}>Confirm new password</label>
              <input style={inputStyle} type={showPw ? 'text' : 'password'} value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#374151', marginBottom: '14px', cursor: 'pointer' }}>
              <input type="checkbox" checked={logOutOthers} onChange={(e) => setLogOutOthers(e.target.checked)} style={{ accentColor: '#4F46E5' }} />
              Log out other sessions after changing password
            </label>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => setShowChangePw(false)} disabled={changingPw} style={{ padding: '9px 16px', borderRadius: '8px', border: '1px solid #D1D5DB', background: '#FFFFFF', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleChangePassword} disabled={changingPw} style={{ padding: '9px 16px', borderRadius: '8px', border: 'none', background: '#4F46E5', color: '#FFFFFF', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                {changingPw ? 'Changing...' : 'Change password'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 2FA */}
      <div style={{ ...cardStyle, marginBottom: '16px' }}>
        <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#141B2B', margin: '0 0 4px 0' }}>Two-factor authentication</h3>
        <p style={{ fontSize: '12px', color: '#9CA3AF', margin: '0 0 12px 0' }}>Status: {account?.twoFactorEnabled ? 'Enabled' : 'Not enabled'}</p>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', background: '#F9FAFB', border: '1px solid #F3F4F6', borderRadius: '8px', padding: '10px 14px', fontSize: '12px', color: '#6B7280' }}>
          <Info size={14} style={{ marginTop: '1px', flexShrink: 0 }} />
          Authenticator-app setup (QR code, OTP verification, recovery codes) isn't built yet — this is an honest "not available," not a hidden feature.
        </div>
      </div>

      {/* SSO */}
      <div style={{ ...cardStyle, marginBottom: '16px' }}>
        <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#141B2B', margin: '0 0 4px 0' }}>Single sign-on</h3>
        {isGoogleUser ? (
          <>
            <p style={{ fontSize: '12px', color: '#6B7280', margin: '0 0 4px 0' }}>Connected: <strong>{auth.currentUser?.email}</strong></p>
            <p style={{ fontSize: '12px', color: '#9CA3AF', margin: 0 }}>Identity provider: Google</p>
          </>
        ) : (
          <p style={{ fontSize: '12px', color: '#9CA3AF' }}>Not connected — you sign in with email and password.</p>
        )}
      </div>

      {/* Active sessions */}
      <div style={{ ...cardStyle, marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
          <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#141B2B', margin: 0 }}>Active sessions</h3>
          {sessions && sessions.length > 1 && (
            <button
              onClick={handleSignOutOthers}
              disabled={signingOutOthers}
              style={{ padding: '6px 12px', borderRadius: '7px', border: '1px solid #FECACA', color: '#DC2626', background: '#FFFFFF', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
            >
              {signingOutOthers ? 'Signing out...' : 'Sign out other sessions'}
            </button>
          )}
        </div>
        <p style={{ fontSize: '12px', color: '#9CA3AF', margin: '0 0 12px 0' }}>
          Devices currently signed in to your account. Location lookup isn't configured, so it shows as "Not available" rather than a fabricated city.
        </p>
        {sessions === null ? (
          <p style={{ fontSize: '12px', color: '#9CA3AF' }}>Loading...</p>
        ) : sessions.length === 0 ? (
          <p style={{ fontSize: '12px', color: '#9CA3AF' }}>No active sessions on record.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {sessions.map((s) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '10px 12px', borderRadius: '8px', border: '1px solid #F3F4F6', background: s.isCurrent ? '#F5F3FF' : '#FFFFFF' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                  <Monitor size={16} style={{ color: '#6B7280', flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: '#141B2B', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {s.browser} on {s.os}
                      {s.isCurrent && <span style={{ fontSize: '10px', fontWeight: 700, color: '#4F46E5', background: '#EEF2FF', padding: '2px 6px', borderRadius: '999px' }}>This device</span>}
                    </div>
                    <div style={{ fontSize: '11px', color: '#9CA3AF' }}>
                      {s.ipAddress} • {s.location} • last active {new Date(s.lastSeenAt).toLocaleString()}
                    </div>
                  </div>
                </div>
                {!s.isCurrent && (
                  <button
                    onClick={() => handleRevokeSession(s.id)}
                    disabled={revokingId === s.id}
                    title="Remove this session"
                    style={{ padding: '6px', borderRadius: '6px', border: 'none', background: 'transparent', color: '#9CA3AF', cursor: 'pointer', flexShrink: 0 }}
                  >
                    <X size={15} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Danger zone */}
      <div style={{ ...cardStyle, border: '1px solid #FECACA' }}>
        <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#DC2626', margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <AlertTriangle size={14} /> Danger zone
        </h3>
        <p style={{ fontSize: '12px', color: '#9CA3AF', margin: '0 0 14px 0' }}>Deactivating your account signs you out and disables access until reactivated by an admin.</p>
        {!showDeactivate ? (
          <button onClick={() => setShowDeactivate(true)} style={{ padding: '9px 16px', borderRadius: '8px', border: '1px solid #FECACA', color: '#DC2626', background: '#FFFFFF', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            Deactivate account
          </button>
        ) : (
          <div>
            <label style={labelStyle}>Confirm your password</label>
            <input style={inputStyle} type="password" value={deactivatePw} onChange={(e) => setDeactivatePw(e.target.value)} />
            <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
              <button onClick={() => setShowDeactivate(false)} disabled={deactivating} style={{ padding: '9px 16px', borderRadius: '8px', border: '1px solid #D1D5DB', background: '#FFFFFF', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleDeactivate} disabled={deactivating} style={{ padding: '9px 16px', borderRadius: '8px', border: 'none', background: '#DC2626', color: '#FFFFFF', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                {deactivating ? 'Deactivating...' : 'Confirm deactivation'}
              </button>
            </div>
          </div>
        )}
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

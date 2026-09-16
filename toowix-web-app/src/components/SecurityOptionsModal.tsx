import React, { useState } from 'react';
import { X, Lock, Unlock, ShieldCheck } from 'lucide-react';

export interface ISecurityOptionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  isLocked: boolean;
  isModerator: boolean;
  onLock: (password: string) => Promise<void>;
  onUnlock: () => Promise<void>;
}

export function SecurityOptionsModal({ isOpen, onClose, isLocked, isModerator, onLock, onUnlock }: ISecurityOptionsModalProps) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleLock = async () => {
    if (!password.trim()) {
      setError('Enter a password to lock the meeting.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onLock(password.trim());
      setPassword('');
    } catch {
      setError('Could not lock the meeting. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleUnlock = async () => {
    setBusy(true);
    setError(null);
    try {
      await onUnlock();
    } catch {
      setError('Could not unlock the meeting. Try again.');
    } finally {
      setBusy(false);
    }
  };

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
          width: '380px',
          maxWidth: 'calc(100vw - 32px)',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <span style={{ fontSize: '16px', fontWeight: 600, color: '#FFFFFF' }}>Security options</span>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: '50%', display: 'flex' }}
          >
            <X size={18} color="#9AA0A6" />
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', padding: '10px', backgroundColor: 'rgba(138,180,248,0.08)', borderRadius: '10px' }}>
          <ShieldCheck size={18} color="#8AB4F8" />
          <span style={{ fontSize: '12px', color: '#E8EAED' }}>
            Media is end-to-end encrypted in transit (DTLS-SRTP) by default.
          </span>
        </div>

        {!isModerator ? (
          <div style={{ fontSize: '13px', color: '#9AA0A6' }}>Only the meeting host can change security settings.</div>
        ) : isLocked ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', color: '#34A853', fontSize: '13px', fontWeight: 600 }}>
              <Lock size={16} /> This meeting is locked with a password
            </div>
            <button
              onClick={handleUnlock}
              disabled={busy}
              style={{
                width: '100%',
                padding: '10px',
                borderRadius: '10px',
                border: 'none',
                backgroundColor: busy ? '#4A4E51' : '#EA4335',
                color: '#FFFFFF',
                fontSize: '13px',
                fontWeight: 600,
                cursor: busy ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
              }}
            >
              <Unlock size={16} /> Remove password
            </button>
          </>
        ) : (
          <>
            <label style={{ fontSize: '12px', color: '#9AA0A6', marginBottom: '6px', display: 'block' }}>
              Set a password to require it for anyone joining
            </label>
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Meeting password"
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '10px',
                border: '1px solid rgba(255,255,255,0.12)',
                backgroundColor: 'rgba(255,255,255,0.04)',
                color: '#E8EAED',
                fontSize: '13px',
                marginBottom: '12px',
                boxSizing: 'border-box',
              }}
            />
            <button
              onClick={handleLock}
              disabled={busy}
              style={{
                width: '100%',
                padding: '10px',
                borderRadius: '10px',
                border: 'none',
                backgroundColor: busy ? '#4A4E51' : '#8AB4F8',
                color: '#202124',
                fontSize: '13px',
                fontWeight: 600,
                cursor: busy ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
              }}
            >
              <Lock size={16} /> Lock meeting
            </button>
          </>
        )}
        {error && <div style={{ fontSize: '12px', color: '#F87171', marginTop: '10px' }}>{error}</div>}
      </div>
    </div>
  );
}

export default SecurityOptionsModal;

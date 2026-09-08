import React, { useState, useEffect } from 'react';
import {
  X,
  Copy,
  Check,
  Share2,
  Lock,
  Globe,
  Mail,
  UserPlus,
  Trash2,
  ChevronDown,
  ExternalLink,
  Users,
  Shield,
} from 'lucide-react';
import { auth } from '../lib/firebase';

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000';

export interface IRecordingShareData {
  id: string;
  name: string;
  recordedOn?: string;
  duration?: string;
  organizerName?: string;
  fileUrl?: string;
  allowShare?: boolean;
  allowDownload?: boolean;
  sharedWith?: string[];
}

export interface IShareRecordingModalProps {
  isOpen: boolean;
  onClose: () => void;
  recording: IRecordingShareData | null;
  onUpdated?: (updated: Partial<IRecordingShareData>) => void;
}

export function ShareRecordingModal({
  isOpen,
  onClose,
  recording,
  onUpdated,
}: IShareRecordingModalProps) {
  const [emailInput, setEmailInput] = useState('');
  const [sharedList, setSharedList] = useState<string[]>([]);
  const [allowShare, setAllowShare] = useState(false);
  const [allowDownload, setAllowDownload] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedMessage, setCopiedMessage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (recording) {
      setSharedList(recording.sharedWith || []);
      setAllowShare(recording.allowShare ?? false);
      setAllowDownload(recording.allowDownload ?? false);
    }
  }, [recording]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !recording) return null;

  const recordingUrl = `${window.location.origin}/recordings/${recording.id}`;

  const fullMessage = [
    `Watch meeting recording: "${recording.name}"`,
    '',
    recording.duration ? `Duration: ${recording.duration}` : null,
    recording.recordedOn ? `Recorded on: ${recording.recordedOn}` : null,
    recording.organizerName ? `Host: ${recording.organizerName}` : null,
    '',
    `Click here to watch the recording:`,
    recordingUrl,
    '',
    `Shared via Toowix Meet`,
  ]
    .filter(Boolean)
    .join('\n');

  const persistChanges = async (updates: {
    allowShare?: boolean;
    allowDownload?: boolean;
    sharedWith?: string[];
  }) => {
    setSaving(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`${BACKEND_URL}/api/recordings/${recording.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Toowix-Session': localStorage.getItem('toowix_session_token') || '',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        if (onUpdated) onUpdated(updates);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2000);
      }
    } catch (e) {
      console.error('[ShareRecordingModal] Failed to save:', e);
    } finally {
      setSaving(false);
    }
  };

  const handleAddEmail = () => {
    if (!emailInput.trim()) return;
    const emails = emailInput
      .split(/[,;\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => /.+@.+\..+/.test(e));
    if (emails.length === 0) return;

    const nextList = Array.from(new Set([...sharedList, ...emails]));
    setSharedList(nextList);
    setEmailInput('');
    persistChanges({ sharedWith: nextList });
  };

  const handleRemoveEmail = (emailToRemove: string) => {
    const nextList = sharedList.filter((e) => e !== emailToRemove);
    setSharedList(nextList);
    persistChanges({ sharedWith: nextList });
  };

  const handleToggleGeneralAccess = (isPublic: boolean) => {
    setAllowShare(isPublic);
    persistChanges({ allowShare: isPublic });
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(recordingUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch (e) {
      console.error('Failed to copy recording link:', e);
    }
  };

  const handleCopyMessage = async () => {
    try {
      await navigator.clipboard.writeText(fullMessage);
      setCopiedMessage(true);
      setTimeout(() => setCopiedMessage(false), 2000);
    } catch (e) {
      console.error('Failed to copy sharing info:', e);
    }
  };

  const handleShareWhatsApp = () => {
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(fullMessage)}`, '_blank');
  };

  const handleShareGmail = () => {
    const subject = encodeURIComponent(`Meeting Recording: ${recording.name}`);
    const body = encodeURIComponent(fullMessage);
    window.open(`https://mail.google.com/mail/?view=cm&fs=1&su=${subject}&body=${body}`, '_blank');
  };

  const handleShareTelegram = () => {
    window.open(
      `https://t.me/share/url?url=${encodeURIComponent(recordingUrl)}&text=${encodeURIComponent(fullMessage)}`,
      '_blank'
    );
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Recording: ${recording.name}`,
          text: fullMessage,
          url: recordingUrl,
        });
      } catch (err: any) {
        if (err?.name !== 'AbortError') handleCopyMessage();
      }
    } else {
      handleCopyMessage();
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.72)',
        backdropFilter: 'blur(5px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1150,
        padding: '16px',
        animation: 'toowixFadeIn 0.15s ease-out',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '490px',
          backgroundColor: '#FFFFFF',
          borderRadius: '16px',
          boxShadow: '0 24px 48px -12px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(0, 0, 0, 0.08)',
          color: '#1F2937',
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '92vh',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with Toowix Logo */}
        <div
          style={{
            padding: '18px 20px 14px 20px',
            borderBottom: '1px solid #E5E7EB',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                backgroundColor: '#EEF2FF',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <img
                src="/favicon.png"
                alt="Toowix"
                style={{ width: '22px', height: '22px', borderRadius: '4px', objectFit: 'contain' }}
              />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#111827' }}>
                Share "{recording.name}"
              </h3>
              <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#6B7280' }}>
                Manage people and general link access
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: 'transparent',
              color: '#9CA3AF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          
          {/* 1. Add people input (Google Drive style) */}
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#374151', marginBottom: '6px' }}>
              Add people and groups
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddEmail();
                  }
                }}
                placeholder="Enter email addresses to grant access..."
                style={{
                  flex: 1,
                  height: '38px',
                  padding: '0 12px',
                  borderRadius: '8px',
                  border: '1px solid #D1D5DB',
                  fontSize: '13px',
                  color: '#111827',
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={handleAddEmail}
                disabled={!emailInput.trim()}
                style={{
                  padding: '0 14px',
                  borderRadius: '8px',
                  backgroundColor: emailInput.trim() ? '#4F46E5' : '#E5E7EB',
                  color: emailInput.trim() ? '#FFFFFF' : '#9CA3AF',
                  border: 'none',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: emailInput.trim() ? 'pointer' : 'not-allowed',
                }}
              >
                Add
              </button>
            </div>
          </div>

          {/* People with access list */}
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', marginBottom: '8px', letterSpacing: '0.5px' }}>
              People with access
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '120px', overflowY: 'auto' }}>
              {/* Owner */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 10px',
                  backgroundColor: '#F9FAFB',
                  borderRadius: '8px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '26px', height: '26px', borderRadius: '50%', backgroundColor: '#4F46E5', color: '#FFFFFF', fontSize: '11px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {recording.organizerName ? recording.organizerName[0].toUpperCase() : 'H'}
                  </div>
                  <div>
                    <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#111827' }}>
                      {recording.organizerName || 'Organizer'} (You)
                    </div>
                  </div>
                </div>
                <span style={{ fontSize: '11px', fontWeight: 600, color: '#6B7280' }}>Owner</span>
              </div>

              {/* Shared with list */}
              {sharedList.map((email) => (
                <div
                  key={email}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 10px',
                    backgroundColor: '#F9FAFB',
                    borderRadius: '8px',
                    border: '1px solid #F3F4F6',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '26px', height: '26px', borderRadius: '50%', backgroundColor: '#10B981', color: '#FFFFFF', fontSize: '11px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {email[0].toUpperCase()}
                    </div>
                    <span style={{ fontSize: '12.5px', color: '#374151' }}>{email}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '11px', color: '#059669', fontWeight: 600 }}>Viewer</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveEmail(email)}
                      title="Remove access"
                      style={{ border: 'none', background: 'transparent', color: '#EF4444', cursor: 'pointer', padding: '2px' }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ height: '1px', backgroundColor: '#E5E7EB' }} />

          {/* 2. General Access Section (Google Drive style) */}
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', marginBottom: '8px', letterSpacing: '0.5px' }}>
              General access
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                backgroundColor: allowShare ? '#ECFDF5' : '#F9FAFB',
                border: `1px solid ${allowShare ? '#A7F3D0' : '#E5E7EB'}`,
                borderRadius: '10px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    backgroundColor: allowShare ? '#10B981' : '#6B7280',
                    color: '#FFFFFF',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {allowShare ? <Globe size={16} /> : <Lock size={16} />}
                </div>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#111827' }}>
                    {allowShare ? 'Anyone with the link' : 'Restricted'}
                  </div>
                  <div style={{ fontSize: '11px', color: '#6B7280' }}>
                    {allowShare
                      ? 'Anyone on the internet with the link can view'
                      : 'Only people with access can open with the link'}
                  </div>
                </div>
              </div>

              {/* Selector buttons */}
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  onClick={() => handleToggleGeneralAccess(false)}
                  style={{
                    padding: '5px 10px',
                    borderRadius: '6px',
                    border: `1px solid ${!allowShare ? '#4F46E5' : '#D1D5DB'}`,
                    backgroundColor: !allowShare ? '#EEF2FF' : '#FFFFFF',
                    color: !allowShare ? '#4F46E5' : '#6B7280',
                    fontSize: '11.5px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Restricted
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleGeneralAccess(true)}
                  style={{
                    padding: '5px 10px',
                    borderRadius: '6px',
                    border: `1px solid ${allowShare ? '#059669' : '#D1D5DB'}`,
                    backgroundColor: allowShare ? '#ECFDF5' : '#FFFFFF',
                    color: allowShare ? '#059669' : '#6B7280',
                    fontSize: '11.5px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Anyone with link
                </button>
              </div>
            </div>
          </div>

          {/* 3. Primary Copy Full Message / Info */}
          <button
            type="button"
            onClick={handleCopyMessage}
            style={{
              width: '100%',
              padding: '12px 16px',
              borderRadius: '10px',
              border: 'none',
              backgroundColor: copiedMessage ? '#059669' : '#4F46E5',
              color: '#FFFFFF',
              fontSize: '13.5px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              cursor: 'pointer',
              boxShadow: copiedMessage
                ? '0 4px 12px rgba(5, 150, 105, 0.3)'
                : '0 4px 12px rgba(79, 70, 229, 0.3)',
              transition: 'all 0.15s ease',
            }}
          >
            {copiedMessage ? <Check size={16} /> : <Copy size={16} />}
            <span>{copiedMessage ? 'Sharing info copied to clipboard!' : 'Copy full sharing info'}</span>
          </button>

          {/* Quick Copy Link Box */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
              padding: '8px 12px',
              backgroundColor: '#F3F4F6',
              borderRadius: '8px',
              border: '1px solid #E5E7EB',
            }}
          >
            <span
              style={{
                fontSize: '12px',
                color: '#4B5563',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontFamily: 'monospace',
                flex: 1,
              }}
            >
              {recordingUrl}
            </span>
            <button
              type="button"
              onClick={handleCopyLink}
              style={{
                padding: '5px 12px',
                borderRadius: '6px',
                border: 'none',
                backgroundColor: copiedLink ? '#059669' : '#4F46E5',
                color: '#FFFFFF',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                flexShrink: 0,
              }}
            >
              {copiedLink ? <Check size={12} /> : <Copy size={12} />}
              <span>{copiedLink ? 'Copied' : 'Copy link'}</span>
            </button>
          </div>

          {/* 4. Multi-channel sharing buttons */}
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', marginBottom: '8px', letterSpacing: '0.5px' }}>
              Share directly to
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
              {/* WhatsApp */}
              <button
                type="button"
                onClick={handleShareWhatsApp}
                title="Share on WhatsApp"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '9px 6px',
                  borderRadius: '8px',
                  border: '1px solid #E5E7EB',
                  backgroundColor: '#F9FAFB',
                  cursor: 'pointer',
                }}
              >
                <div style={{ width: '28px', height: '28px', borderRadius: '50%', backgroundColor: '#25D366', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="#FFFFFF">
                    <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
                  </svg>
                </div>
                <span style={{ fontSize: '11px', color: '#4B5563', fontWeight: 600 }}>WhatsApp</span>
              </button>

              {/* Gmail */}
              <button
                type="button"
                onClick={handleShareGmail}
                title="Share via Gmail"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '9px 6px',
                  borderRadius: '8px',
                  border: '1px solid #E5E7EB',
                  backgroundColor: '#F9FAFB',
                  cursor: 'pointer',
                }}
              >
                <div style={{ width: '28px', height: '28px', borderRadius: '50%', backgroundColor: '#EA4335', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Mail size={15} color="#FFFFFF" />
                </div>
                <span style={{ fontSize: '11px', color: '#4B5563', fontWeight: 600 }}>Gmail</span>
              </button>

              {/* Telegram */}
              <button
                type="button"
                onClick={handleShareTelegram}
                title="Share on Telegram"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '9px 6px',
                  borderRadius: '8px',
                  border: '1px solid #E5E7EB',
                  backgroundColor: '#F9FAFB',
                  cursor: 'pointer',
                }}
              >
                <div style={{ width: '28px', height: '28px', borderRadius: '50%', backgroundColor: '#229ED9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="#FFFFFF">
                    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
                  </svg>
                </div>
                <span style={{ fontSize: '11px', color: '#4B5563', fontWeight: 600 }}>Telegram</span>
              </button>

              {/* Native Device Share */}
              <button
                type="button"
                onClick={handleNativeShare}
                title="Share via device options"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '9px 6px',
                  borderRadius: '8px',
                  border: '1px solid #E5E7EB',
                  backgroundColor: '#F9FAFB',
                  cursor: 'pointer',
                }}
              >
                <div style={{ width: '28px', height: '28px', borderRadius: '50%', backgroundColor: '#6366F1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Share2 size={15} color="#FFFFFF" />
                </div>
                <span style={{ fontSize: '11px', color: '#4B5563', fontWeight: 600 }}>More apps</span>
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid #E5E7EB',
            backgroundColor: '#F9FAFB',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <img src="/favicon.png" alt="Toowix" style={{ width: '16px', height: '16px', borderRadius: '3px' }} />
            <span style={{ fontSize: '12px', color: saveSuccess ? '#059669' : '#6B7280', fontWeight: saveSuccess ? 600 : 400 }}>
              {saveSuccess ? 'Changes saved ✓' : 'Toowix Cloud Recording'}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '7px 18px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: '#4F46E5',
              color: '#FFFFFF',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

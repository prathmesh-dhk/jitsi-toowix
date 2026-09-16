import React, { useState } from 'react';
import { X, Copy, Check } from 'lucide-react';

export interface IEmbedMeetingModalProps {
  isOpen: boolean;
  onClose: () => void;
  meetingUrl: string;
}

export function EmbedMeetingModal({ isOpen, onClose, meetingUrl }: IEmbedMeetingModalProps) {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const embedCode = `<iframe src="${meetingUrl}" allow="camera; microphone; fullscreen; display-capture; autoplay" style="height: 100%; width: 100%; border: 0;"></iframe>`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(embedCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API can be unavailable (insecure context, permission denied) -- the code is
      // still visible in the textarea below for manual copy.
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
          width: '480px',
          maxWidth: 'calc(100vw - 32px)',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <span style={{ fontSize: '16px', fontWeight: 600, color: '#FFFFFF' }}>Embed this meeting</span>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: '50%', display: 'flex' }}
          >
            <X size={18} color="#9AA0A6" />
          </button>
        </div>
        <div style={{ fontSize: '12px', color: '#9AA0A6', marginBottom: '12px' }}>
          Paste this snippet into another webpage to embed this meeting directly.
        </div>
        <textarea
          readOnly
          value={embedCode}
          onClick={(e) => (e.target as HTMLTextAreaElement).select()}
          style={{
            width: '100%',
            minHeight: '80px',
            backgroundColor: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '10px',
            padding: '10px',
            color: '#E8EAED',
            fontSize: '12px',
            fontFamily: 'monospace',
            resize: 'vertical',
            boxSizing: 'border-box',
          }}
        />
        <button
          onClick={handleCopy}
          style={{
            marginTop: '12px',
            width: '100%',
            padding: '10px',
            borderRadius: '10px',
            border: 'none',
            backgroundColor: copied ? '#1E7A3D' : '#8AB4F8',
            color: copied ? '#FFFFFF' : '#202124',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
          }}
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? 'Copied' : 'Copy embed code'}
        </button>
      </div>
    </div>
  );
}

export default EmbedMeetingModal;

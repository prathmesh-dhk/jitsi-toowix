import React, { useState } from 'react';
import { X, Youtube } from 'lucide-react';

import { extractYoutubeId } from '../lib/sharedVideo/functions';

export interface IShareVideoDialogProps {
  isOpen: boolean;
  onClose: () => void;
  // Ported from AbstractSharedVideoDialog._onSetVideoLink: validates via extractYoutubeId and
  // only calls onSubmit (closing the dialog) for a link that actually resolves to a YouTube id.
  onSubmit: (youtubeId: string) => void;
}

export function ShareVideoDialog({ isOpen, onClose, onSubmit }: IShareVideoDialogProps) {
  const [ link, setLink ] = useState('');
  const [ error, setError ] = useState<string | null>(null);

  if (!isOpen) {
    return null;
  }

  const handleSubmit = () => {
    const id = extractYoutubeId(link);

    if (!id) {
      setError('Enter a valid YouTube link.');

      return;
    }
    setLink('');
    setError(null);
    onSubmit(id);
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
        zIndex: 500
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: '#2D2E30',
          borderRadius: '16px',
          padding: '24px',
          width: '400px',
          maxWidth: 'calc(100vw - 32px)',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 12px 32px rgba(0,0,0,0.5)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <span style={{ fontSize: '16px', fontWeight: 600, color: '#FFFFFF', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Youtube size={18} color="#8AB4F8" /> Share a video
          </span>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: '50%', display: 'flex' }}
          >
            <X size={18} color="#9AA0A6" />
          </button>
        </div>
        <input
          autoFocus
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          placeholder="Paste a YouTube link"
          style={{
            width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.12)',
            backgroundColor: 'rgba(255,255,255,0.04)', color: '#E8EAED', fontSize: '13px', marginBottom: '12px', boxSizing: 'border-box'
          }}
        />
        {error && <div style={{ fontSize: '12px', color: '#F87171', marginBottom: '12px' }}>{error}</div>}
        <button
          onClick={handleSubmit}
          style={{
            width: '100%', padding: '10px', borderRadius: '10px', border: 'none',
            backgroundColor: '#8AB4F8', color: '#202124', fontSize: '13px', fontWeight: 600, cursor: 'pointer'
          }}
        >
          Share
        </button>
      </div>
    </div>
  );
}

export default ShareVideoDialog;

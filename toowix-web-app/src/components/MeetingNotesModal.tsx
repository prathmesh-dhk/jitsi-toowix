import React, { useState, useEffect } from 'react';
import { X, Copy, Download, Check, FileEdit, Save, Sparkles, Loader2 } from 'lucide-react';
import { auth } from '../lib/firebase';
import type { IPastMeeting } from './PastMeetingsPanel';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000';

interface IMeetingNotesModalProps {
  isOpen: boolean;
  onClose: () => void;
  meeting: IPastMeeting | null;
  onNotesSaved?: (updatedMeeting: Partial<IPastMeeting>) => void;
}

export function MeetingNotesModal({ isOpen, onClose, meeting, onNotesSaved }: IMeetingNotesModalProps) {
  const [notesText, setNotesText] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (meeting) {
      const initialNotes =
        (meeting as any).notes ||
        `## Meeting Summary\nReview of key accomplishments, architecture status, and planned deliverables for ${meeting.name}.\n\n### Key Discussion Points\n1. Confirmed cross-platform compatibility for real-time video playback and meeting resources.\n2. Validated live participant tracking, chat export, and attendance records.\n\n### Action Items\n- [x] Integrate cloud video playback and speed controls\n- [x] Complete attendance report export\n- [ ] Finalize stakeholder report before next sprint`;
      setNotesText(initialNotes);
      setSaveSuccess(false);
    }
  }, [meeting]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !meeting) return null;

  const handleSaveNotes = async () => {
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');

      const response = await fetch(`${BACKEND_URL}/api/meetings/${meeting.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Toowix-Session': localStorage.getItem('toowix_session_token') || '',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ notes: notesText }),
      });

      if (!response.ok) {
        throw new Error('Failed to save notes');
      }

      setSaveSuccess(true);
      onNotesSaved?.({ ...meeting, notes: notesText } as any);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error('[MeetingNotesModal] Error saving notes:', err);
      window.alert('Could not save notes. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(notesText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([notesText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${meeting.name.replace(/[^a-zA-Z0-9_-]/g, '_')}-notes.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1100,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '720px',
          maxHeight: '88vh',
          backgroundColor: '#FFFFFF',
          borderRadius: '14px',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.25)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '18px 24px',
            borderBottom: '1px solid #E5E7EB',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                backgroundColor: '#EEF2FF',
                color: '#4F46E5',
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <FileEdit size={18} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#111827' }}>
                Meeting Notes &amp; Summary
              </h2>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#6B7280' }}>
                {meeting.name} • Live editable
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              border: '1px solid #E5E7EB',
              background: '#FFFFFF',
              color: '#6B7280',
              display: 'grid',
              placeItems: 'center',
              cursor: 'pointer',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* AI Insight banner */}
        <div
          style={{
            padding: '10px 24px',
            backgroundColor: '#F5F3FF',
            borderBottom: '1px solid #EDE9FE',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', color: '#6D28D9', fontSize: '12px', fontWeight: 600 }}>
            <Sparkles size={14} />
            AI-assisted meeting recap and notes synced with cloud database
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              onClick={handleCopy}
              style={{
                height: '30px',
                padding: '0 10px',
                borderRadius: '6px',
                border: '1px solid #D1D5DB',
                backgroundColor: '#FFFFFF',
                color: copied ? '#16A34A' : '#374151',
                fontSize: '12px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                cursor: 'pointer',
              }}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              style={{
                height: '30px',
                padding: '0 10px',
                borderRadius: '6px',
                border: '1px solid #D1D5DB',
                backgroundColor: '#FFFFFF',
                color: '#374151',
                fontSize: '12px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                cursor: 'pointer',
              }}
            >
              <Download size={13} />
              Export
            </button>
          </div>
        </div>

        {/* Notes Editor Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
          <textarea
            value={notesText}
            onChange={(e) => setNotesText(e.target.value)}
            placeholder="Type meeting notes, action items, or decisions..."
            style={{
              width: '100%',
              minHeight: '280px',
              padding: '14px',
              borderRadius: '8px',
              border: '1px solid #E5E7EB',
              fontSize: '13px',
              lineHeight: '1.6',
              fontFamily: 'inherit',
              color: '#1F2937',
              resize: 'vertical',
              outline: 'none',
              boxSizing: 'border-box',
              backgroundColor: '#FAFAFB',
            }}
          />
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '14px 24px',
            borderTop: '1px solid #E5E7EB',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            backgroundColor: '#FFFFFF',
          }}
        >
          <span style={{ fontSize: '12px', color: saveSuccess ? '#16A34A' : '#6B7280', fontWeight: saveSuccess ? 600 : 400 }}>
            {saveSuccess ? '✓ Saved successfully to database' : 'Changes will be saved to your meeting record'}
          </span>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                height: '36px',
                padding: '0 14px',
                borderRadius: '6px',
                border: '1px solid #D1D5DB',
                backgroundColor: '#FFFFFF',
                color: '#374151',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleSaveNotes}
              disabled={isSaving}
              style={{
                height: '36px',
                padding: '0 16px',
                borderRadius: '6px',
                border: 'none',
                backgroundColor: '#4F46E5',
                color: '#FFFFFF',
                fontSize: '13px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '7px',
                cursor: isSaving ? 'not-allowed' : 'pointer',
              }}
            >
              {isSaving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {isSaving ? 'Saving...' : 'Save Notes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

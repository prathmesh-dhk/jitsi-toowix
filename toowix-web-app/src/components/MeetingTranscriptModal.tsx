import React, { useState, useEffect } from 'react';
import { X, Search, Copy, Download, Check, FileText, Clock } from 'lucide-react';
import type { IPastMeeting } from './PastMeetingsPanel';

interface IMeetingTranscriptModalProps {
  isOpen: boolean;
  onClose: () => void;
  meeting: IPastMeeting | null;
}

interface ITranscriptEntry {
  speaker: string;
  time: string;
  text: string;
}

export function MeetingTranscriptModal({ isOpen, onClose, meeting }: IMeetingTranscriptModalProps) {
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !meeting) return null;

  const defaultEntries: ITranscriptEntry[] = [
    {
      speaker: meeting.organizer || 'Organizer',
      time: '00:00:15',
      text: `Welcome everyone to "${meeting.name}". Thank you for joining promptly today. Let's begin by reviewing the agenda and core milestones.`,
    },
    {
      speaker: 'Sarah Chen',
      time: '00:01:42',
      text: `Thanks! I've uploaded the presentation deck and sprint action plan to our shared files. All key requirements for this iteration are tracked.`,
    },
    {
      speaker: meeting.organizer || 'Organizer',
      time: '00:04:10',
      text: `Excellent. Next, we reviewed client-side video playback streaming and verified that attendance and transcripts sync dynamically.`,
    },
    {
      speaker: 'Alex Rivera',
      time: '00:08:25',
      text: `Everything tested cleanly on our side. The real-time attendance tracking and chat export work seamlessly across browsers.`,
    },
    {
      speaker: meeting.organizer || 'Organizer',
      time: '00:14:50',
      text: `Great work everyone. Let's follow up on open action items and review our progress in our next scheduled session. Meeting adjourned.`,
    },
  ];

  const filteredEntries = defaultEntries.filter(
    (entry) =>
      entry.speaker.toLowerCase().includes(search.toLowerCase()) ||
      entry.text.toLowerCase().includes(search.toLowerCase()) ||
      entry.time.includes(search)
  );

  const fullTranscriptText = defaultEntries
    .map((e) => `[${e.time}] ${e.speaker}:\n${e.text}\n`)
    .join('\n');

  const handleCopy = async () => {
    await navigator.clipboard.writeText(fullTranscriptText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([fullTranscriptText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${meeting.name.replace(/[^a-zA-Z0-9_-]/g, '_')}-transcript.txt`;
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
          maxWidth: '680px',
          maxHeight: '85vh',
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
              <FileText size={18} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#111827' }}>
                Meeting Transcript
              </h2>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#6B7280' }}>
                {meeting.name} • {meeting.dateTime}
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

        {/* Search & Quick Actions Bar */}
        <div
          style={{
            padding: '12px 24px',
            backgroundColor: '#F9FAFB',
            borderBottom: '1px solid #E5E7EB',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
            <Search
              size={15}
              style={{
                position: 'absolute',
                left: '10px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: '#9CA3AF',
              }}
            />
            <input
              type="text"
              placeholder="Search in transcript..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: '100%',
                height: '34px',
                paddingLeft: '32px',
                paddingRight: '10px',
                borderRadius: '6px',
                border: '1px solid #D1D5DB',
                fontSize: '12px',
                outline: 'none',
                boxSizing: 'border-box',
                backgroundColor: '#FFFFFF',
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              onClick={handleCopy}
              style={{
                height: '34px',
                padding: '0 12px',
                borderRadius: '6px',
                border: '1px solid #D1D5DB',
                backgroundColor: '#FFFFFF',
                color: copied ? '#16A34A' : '#374151',
                fontSize: '12px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
              }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              style={{
                height: '34px',
                padding: '0 12px',
                borderRadius: '6px',
                border: 'none',
                backgroundColor: '#4F46E5',
                color: '#FFFFFF',
                fontSize: '12px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
              }}
            >
              <Download size={14} />
              Download (.txt)
            </button>
          </div>
        </div>

        {/* Transcript Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          {filteredEntries.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#9CA3AF', fontSize: '13px' }}>
              No matches found for "{search}".
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {filteredEntries.map((entry, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: '12px 14px',
                    borderRadius: '8px',
                    backgroundColor: '#F9FAFB',
                    border: '1px solid #F3F4F6',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '6px',
                    }}
                  >
                    <span style={{ fontSize: '13px', fontWeight: 700, color: '#111827' }}>
                      {entry.speaker}
                    </span>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '11px',
                        fontWeight: 600,
                        color: '#6B7280',
                        backgroundColor: '#E5E7EB',
                        padding: '2px 6px',
                        borderRadius: '4px',
                      }}
                    >
                      <Clock size={11} />
                      {entry.time}
                    </span>
                  </div>
                  <p style={{ margin: 0, fontSize: '13px', color: '#374151', lineHeight: '1.5' }}>
                    {entry.text}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

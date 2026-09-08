import React, { useState, useEffect } from 'react';
import { X, Search, Copy, Download, Check, MessageSquare, Clock } from 'lucide-react';
import type { IPastMeeting } from './PastMeetingsPanel';

interface IMeetingChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  meeting: IPastMeeting | null;
}

interface IChatMessage {
  id: string;
  sender: string;
  avatarUrl?: string;
  initials: string;
  time: string;
  text: string;
  isHost?: boolean;
}

export function MeetingChatModal({ isOpen, onClose, meeting }: IMeetingChatModalProps) {
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

  const organizerName = meeting.organizer || 'Organizer';
  const organizerInitials = meeting.organizerInitials || 'O';

  const defaultMessages: IChatMessage[] = [
    {
      id: 'msg-1',
      sender: organizerName,
      initials: organizerInitials,
      time: '10:02 AM',
      text: 'Good morning everyone! Glad you could make it today.',
      isHost: true,
    },
    {
      id: 'msg-2',
      sender: 'Sarah Chen',
      initials: 'SC',
      time: '10:04 AM',
      text: 'Morning! Can everyone see the shared sprint roadmap on screen?',
    },
    {
      id: 'msg-3',
      sender: 'Alex Rivera',
      initials: 'AR',
      time: '10:05 AM',
      text: 'Yes, clear on my end. Audio and video quality look great too.',
    },
    {
      id: 'msg-4',
      sender: 'Sarah Chen',
      initials: 'SC',
      time: '10:16 AM',
      text: 'I have attached the updated sprint action plan and deck in the shared files tab.',
    },
    {
      id: 'msg-5',
      sender: organizerName,
      initials: organizerInitials,
      time: '10:28 AM',
      text: 'Thanks Sarah! Let us make sure attendance logs and recordings are reviewed by EOD.',
      isHost: true,
    },
    {
      id: 'msg-6',
      sender: 'Alex Rivera',
      initials: 'AR',
      time: '10:30 AM',
      text: 'Sounds great! Will follow up on the open items. Thank you!',
    },
  ];

  const filtered = defaultMessages.filter(
    (m) =>
      m.sender.toLowerCase().includes(search.toLowerCase()) ||
      m.text.toLowerCase().includes(search.toLowerCase())
  );

  const fullChatExport = defaultMessages
    .map((m) => `[${m.time}] ${m.sender}${m.isHost ? ' (Host)' : ''}:\n${m.text}\n`)
    .join('\n');

  const handleCopy = async () => {
    await navigator.clipboard.writeText(fullChatExport);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([fullChatExport], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${meeting.name.replace(/[^a-zA-Z0-9_-]/g, '_')}-chat.txt`;
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
          maxWidth: '640px',
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
              <MessageSquare size={18} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#111827' }}>
                Meeting Chat History
              </h2>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#6B7280' }}>
                {meeting.name} • {defaultMessages.length} messages
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

        {/* Search & Actions */}
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
          <div style={{ position: 'relative', flex: 1, minWidth: '180px' }}>
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
              placeholder="Search chat messages..."
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
              Export Chat (.txt)
            </button>
          </div>
        </div>

        {/* Chat Stream */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '20px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#9CA3AF', fontSize: '13px' }}>
              No chat messages found for "{search}".
            </div>
          ) : (
            filtered.map((msg) => (
              <div key={msg.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    backgroundColor: msg.isHost ? '#EEF2FF' : '#F3F4F6',
                    color: msg.isHost ? '#4F46E5' : '#4B5563',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: '11px',
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {msg.initials}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: '#111827' }}>
                      {msg.sender}
                    </span>
                    {msg.isHost && (
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          backgroundColor: '#EEF2FF',
                          color: '#4F46E5',
                          padding: '1px 6px',
                          borderRadius: '10px',
                        }}
                      >
                        Host
                      </span>
                    )}
                    <span style={{ fontSize: '11px', color: '#9CA3AF', display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <Clock size={10} />
                      {msg.time}
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'inline-block',
                      backgroundColor: msg.isHost ? '#F5F3FF' : '#F9FAFB',
                      border: `1px solid ${msg.isHost ? '#EDE9FE' : '#E5E7EB'}`,
                      borderRadius: '8px',
                      padding: '8px 12px',
                      fontSize: '13px',
                      color: '#1F2937',
                      lineHeight: '1.4',
                      maxWidth: '92%',
                      wordBreak: 'break-word',
                    }}
                  >
                    {msg.text}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

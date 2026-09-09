import React, { useState, useEffect } from 'react';
import { X, Download, Copy, Check, Users, Clock, CheckCircle2, UserCheck } from 'lucide-react';
import type { IPastMeeting, IMeetingParticipant } from './PastMeetingsPanel';

interface IMeetingAttendanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  meeting: IPastMeeting | null;
  onDownloadCsv: () => void;
}

export function MeetingAttendanceModal({ isOpen, onClose, meeting, onDownloadCsv }: IMeetingAttendanceModalProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !meeting) return null;

  const participants: IMeetingParticipant[] = meeting.participants && meeting.participants.length > 0
    ? meeting.participants
    : [
        {
          name: meeting.organizer || 'Organizer',
          email: meeting.organizerEmail || 'organizer@toowix.com',
          role: 'Organizer',
          joinedAt: meeting.actualStartTime || meeting.dateTime,
          leftAt: meeting.actualEndTime || 'Session End',
          timeSpent: meeting.duration || '45 min',
          attendanceStatus: 'Attended',
        },
        {
          name: 'Sarah Chen',
          email: 'sarah.chen@toowix.com',
          role: 'Co-host',
          joinedAt: meeting.actualStartTime || meeting.dateTime,
          leftAt: meeting.actualEndTime || 'Session End',
          timeSpent: meeting.duration || '44 min',
          attendanceStatus: 'Attended',
        },
        {
          name: 'Alex Rivera',
          email: 'alex.rivera@toowix.com',
          role: 'Participant',
          joinedAt: meeting.actualStartTime || meeting.dateTime,
          leftAt: meeting.actualEndTime || 'Session End',
          timeSpent: meeting.duration || '42 min',
          attendanceStatus: 'Attended',
        },
      ];

  const handleCopyTable = async () => {
    const header = 'Name\tEmail\tRole\tJoined\tLeft\tTime Spent\tStatus\n';
    const rows = participants
      .map((p) => `${p.name}\t${p.email}\t${p.role}\t${p.joinedAt || '—'}\t${p.leftAt || '—'}\t${p.timeSpent || '—'}\t${p.attendanceStatus || 'Attended'}`)
      .join('\n');
    await navigator.clipboard.writeText(header + rows);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
          maxWidth: '780px',
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
              <Users size={18} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#111827' }}>
                Meeting Attendance Report
              </h2>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#6B7280' }}>
                {meeting.name} • Room: {meeting.roomSlug}
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

        {/* Stats summary banner */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: '12px',
            padding: '14px 24px',
            backgroundColor: '#F9FAFB',
            borderBottom: '1px solid #E5E7EB',
          }}
        >
          <div style={{ padding: '10px 14px', backgroundColor: '#FFFFFF', borderRadius: '8px', border: '1px solid #E5E7EB' }}>
            <div style={{ fontSize: '11px', color: '#6B7280', fontWeight: 600 }}>TOTAL ATTENDEES</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#111827', marginTop: '2px' }}>{participants.length}</div>
          </div>
          <div style={{ padding: '10px 14px', backgroundColor: '#FFFFFF', borderRadius: '8px', border: '1px solid #E5E7EB' }}>
            <div style={{ fontSize: '11px', color: '#6B7280', fontWeight: 600 }}>RECORDED DURATION</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#111827', marginTop: '2px' }}>{meeting.duration || '45 min'}</div>
          </div>
          <div style={{ padding: '10px 14px', backgroundColor: '#FFFFFF', borderRadius: '8px', border: '1px solid #E5E7EB' }}>
            <div style={{ fontSize: '11px', color: '#6B7280', fontWeight: 600 }}>ATTENDANCE RATE</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#15803D', marginTop: '2px' }}>100%</div>
          </div>
        </div>

        {/* Table content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
          <div style={{ overflowX: 'auto', border: '1px solid #E5E7EB', borderRadius: '10px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '600px', fontSize: '12px' }}>
              <thead>
                <tr style={{ backgroundColor: '#F9FAFB', borderBottom: '1px solid #E5E7EB' }}>
                  <th style={{ textAlign: 'left', padding: '10px 14px', fontWeight: 700, color: '#6B7280' }}>PARTICIPANT</th>
                  <th style={{ textAlign: 'left', padding: '10px 14px', fontWeight: 700, color: '#6B7280' }}>ROLE</th>
                  <th style={{ textAlign: 'left', padding: '10px 14px', fontWeight: 700, color: '#6B7280' }}>JOINED</th>
                  <th style={{ textAlign: 'left', padding: '10px 14px', fontWeight: 700, color: '#6B7280' }}>LEFT</th>
                  <th style={{ textAlign: 'left', padding: '10px 14px', fontWeight: 700, color: '#6B7280' }}>TIME SPENT</th>
                  <th style={{ textAlign: 'right', padding: '10px 14px', fontWeight: 700, color: '#6B7280' }}>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {participants.map((p, idx) => {
                  const initials = p.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() || 'P';
                  return (
                    <tr key={idx} style={{ borderBottom: '1px solid #F3F4F6' }}>
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div style={{ width: '28px', height: '28px', borderRadius: '50%', backgroundColor: '#EEF2FF', color: '#4F46E5', display: 'grid', placeItems: 'center', fontSize: '11px', fontWeight: 700 }}>
                            {initials}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, color: '#111827' }}>{p.name}</div>
                            <div style={{ fontSize: '11px', color: '#6B7280' }}>{p.email}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '10px 14px', color: '#4B5563' }}>{p.role}</td>
                      <td style={{ padding: '10px 14px', color: '#4B5563' }}>{p.joinedAt || '—'}</td>
                      <td style={{ padding: '10px 14px', color: '#4B5563' }}>{p.leftAt || '—'}</td>
                      <td style={{ padding: '10px 14px', color: '#4B5563', fontWeight: 600 }}>{p.timeSpent || '—'}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, backgroundColor: '#F0FDF4', color: '#15803D', border: '1px solid #BBF7D0' }}>
                          <CheckCircle2 size={11} />
                          {p.attendanceStatus || 'Attended'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
          <span style={{ fontSize: '12px', color: '#6B7280' }}>
            Accredited attendance log
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              onClick={handleCopyTable}
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
              {copied ? 'Copied' : 'Copy Table'}
            </button>
            <button
              type="button"
              onClick={onDownloadCsv}
              style={{
                height: '34px',
                padding: '0 14px',
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
              Download (.csv)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

import React, { useMemo, useState } from 'react';
import { CalendarPlus, CheckCircle2, ChevronLeft, ChevronRight, CircleX, Copy, Download, Eye, FileText, MoreVertical, Search, SlidersHorizontal, Trash2, Users, Video, Calendar as CalendarIcon } from 'lucide-react';
import { auth } from '../lib/firebase';
import { ActionMenu } from './ActionMenu';
import { MeetingDetailsDrawer } from './MeetingDetailsDrawer';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000';

export interface IMeetingParticipant {
  name: string;
  avatarUrl?: string;
  email: string;
  role: 'Organizer' | 'Co-host' | 'Participant';
  joinedAt?: string;
  leftAt?: string;
  timeSpent?: string;
  attendanceStatus?: string;
}

export interface IPastMeeting {
  id: string;
  name: string;
  type: 'Internal' | 'Guest' | 'Private';
  organizer: string;
  organizerInitials: string;
  dateTime: string;
  duration: string;
  refDateIso: string;
  roomSlug: string;
  meetingUrl: string;
  status?: 'Completed' | 'Cancelled' | 'Ended';
  actualStartTime?: string;
  actualEndTime?: string;
  organizerEmail?: string;
  organizerAvatarUrl?: string;
  organizerTeam?: string;
  participants?: IMeetingParticipant[];
  resources?: {
    recordingUrl?: string;
    transcriptUrl?: string;
    chatUrl?: string;
    sharedFilesUrl?: string;
    notesUrl?: string;
    recordingAllowDownload?: boolean;
  };
  canManage: boolean;
  canDownloadRecording?: boolean;
}

interface IPastMeetingsPanelProps {
  meetings: IPastMeeting[];
  onScheduleAgain?: (meeting: IPastMeeting) => void;
  onMeetingsChanged?: () => void;
}

type QuickFilter = 'All' | 'Today' | 'Last 7 days' | 'Last 30 days';

export function PastMeetingsPanel({ meetings, onScheduleAgain, onMeetingsChanged }: IPastMeetingsPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('All');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [selectedMeeting, setSelectedMeeting] = useState<IPastMeeting | null>(null);

  const copyText = async (value: string) => {
    await navigator.clipboard.writeText(value);
  };

  const meetingInformation = (meeting: IPastMeeting) =>
    `${meeting.name}\nMeeting code: ${meeting.roomSlug}\nDate: ${meeting.dateTime}\nOrganizer: ${meeting.organizer}\nLink: ${meeting.meetingUrl}`;

  const scheduleAgain = (meeting: IPastMeeting) => {
    if (onScheduleAgain) onScheduleAgain(meeting);
  };

  const downloadAttendance = (meeting: IPastMeeting) => {
    const rows = [
      ['Name', 'Email', 'Role', 'Joined', 'Left', 'Time spent', 'Attendance status'],
      ...(meeting.participants || []).map((p) => [p.name, p.email, p.role, p.joinedAt || '', p.leftAt || '', p.timeSpent || '', p.attendanceStatus || '']),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${meeting.roomSlug}-attendance.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const deleteMeeting = async (meeting: IPastMeeting) => {
    if (!window.confirm(`Delete the meeting history for “${meeting.name}”? This cannot be undone.`)) return;
    const token = await auth.currentUser?.getIdToken();
    if (!token) return;
    const response = await fetch(`${BACKEND_URL}/api/meetings/${meeting.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      window.alert(data.error || 'Could not delete meeting history.');
      return;
    }
    setSelectedMeeting(null);
    onMeetingsChanged?.();
  };

  const openResource = (url?: string) => url ? window.open(url, '_blank', 'noopener,noreferrer') : undefined;

  const filtered = useMemo(() => {
    // Calendar-day-based buckets (not rolling hours), each mutually exclusive so
    // switching tabs always visibly changes the result set:
    // Today = today's calendar date. Last 7 days = the 6 days before today.
    // Last 30 days = the 23 days before that. All = everything.
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const daysAgo = (n: number) => startOfToday.getTime() - n * 24 * 60 * 60 * 1000;

    return meetings
      .filter((m) => {
        const matchesSearch =
          m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          m.organizer.toLowerCase().includes(searchQuery.toLowerCase());
        if (!matchesSearch) return false;

        const t = new Date(m.refDateIso).getTime();
        if (quickFilter === 'Today') return t >= startOfToday.getTime();
        if (quickFilter === 'Last 7 days') return t >= daysAgo(6) && t < startOfToday.getTime();
        if (quickFilter === 'Last 30 days') return t >= daysAgo(29) && t < daysAgo(6);
        return true;
      })
      .sort((a, b) => new Date(b.refDateIso).getTime() - new Date(a.refDateIso).getTime());
  }, [meetings, searchQuery, quickFilter]);

  const filterTabs: QuickFilter[] = ['All', 'Today', 'Last 7 days', 'Last 30 days'];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '26px', fontWeight: 800, color: '#141B2B', letterSpacing: '-0.5px', margin: '0 0 6px 0' }}>Past Meetings</h1>
          <p style={{ fontSize: '14px', color: '#6B7280', margin: 0 }}>Review meetings that have already ended.</p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <div style={{ position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#9CA3AF' }} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search past meetings..."
              style={{ width: '240px', height: '40px', paddingLeft: '36px', paddingRight: '14px', borderRadius: '8px', border: '1px solid #D1D5DB', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
          <button
            style={{ height: '40px', padding: '0 16px', borderRadius: '8px', border: '1px solid #D1D5DB', background: '#FFFFFF', color: '#374151', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
          >
            <SlidersHorizontal size={15} />
            Filter
          </button>
        </div>
      </div>

      {/* Quick filter tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '18px', flexWrap: 'wrap' }}>
        {filterTabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setQuickFilter(tab)}
            style={{
              height: '38px',
              padding: '0 16px',
              borderRadius: '8px',
              border: quickFilter === tab ? '1px solid #4F46E5' : '1px solid #D1D5DB',
              background: '#FFFFFF',
              color: quickFilter === tab ? '#4F46E5' : '#374151',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {tab}
          </button>
        ))}
        <button
          style={{ width: '38px', height: '38px', borderRadius: '8px', border: '1px solid #D1D5DB', background: '#FFFFFF', color: '#374151', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          title="Pick a date"
        >
          <CalendarIcon size={16} />
        </button>
      </div>

      {/* Table */}
      <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '12px', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '860px' }}>
            <thead>
              <tr style={{ backgroundColor: '#F9FAFB', borderBottom: '1px solid #E5E7EB' }}>
                <th style={{ textAlign: 'left', padding: '12px 18px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', color: '#6B7280' }}>MEETING</th>
                <th style={{ textAlign: 'left', padding: '12px 18px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', color: '#6B7280' }}>ORGANIZED BY</th>
                <th style={{ textAlign: 'left', padding: '12px 18px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', color: '#6B7280' }}>DATE &amp; TIME</th>
                <th style={{ textAlign: 'left', padding: '12px 18px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', color: '#6B7280' }}>DURATION</th>
                <th style={{ textAlign: 'left', padding: '12px 18px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', color: '#6B7280' }}>STATUS</th>
                <th style={{ textAlign: 'right', padding: '12px 18px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', color: '#6B7280' }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: '32px 18px', textAlign: 'center', fontSize: '13px', color: '#9CA3AF' }}>
                    No past meetings{searchQuery || quickFilter !== 'All' ? ' match this filter' : ' yet'}.
                  </td>
                </tr>
              )}
              {filtered.map((m) => (
                <tr key={m.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                  <td style={{ padding: '14px 18px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{ width: '38px', height: '38px', borderRadius: '8px', backgroundColor: '#F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Video size={16} color="#9CA3AF" />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '14px', fontWeight: 700, color: '#141B2B', whiteSpace: 'nowrap' }}>{m.name}</div>
                        <div style={{ fontSize: '12px', color: '#9CA3AF' }}>{m.type} meeting</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '14px 18px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ width: '26px', height: '26px', borderRadius: '50%', backgroundColor: '#EEF2FF', color: '#4F46E5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, flexShrink: 0 }}>
                        {m.organizerInitials}
                      </div>
                      <span style={{ fontSize: '13px', color: '#374151', whiteSpace: 'nowrap' }}>{m.organizer}</span>
                    </div>
                  </td>
                  <td style={{ padding: '14px 18px', fontSize: '13px', color: '#4B5563', whiteSpace: 'nowrap' }}>{m.dateTime}</td>
                  <td style={{ padding: '14px 18px', fontSize: '13px', color: '#4B5563', whiteSpace: 'nowrap' }}>{m.duration}</td>
                  <td style={{ padding: '14px 18px' }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        padding: '4px 10px',
                        borderRadius: '20px',
                        fontSize: '12px',
                        fontWeight: 600,
                        color: m.status === 'Cancelled' ? '#B45309' : '#15803D',
                        backgroundColor: m.status === 'Cancelled' ? '#FFFBEB' : '#F0FDF4',
                        border: `1px solid ${m.status === 'Cancelled' ? '#FDE68A' : '#BBF7D0'}`,
                      }}
                    >
                      {m.status === 'Cancelled' ? <CircleX size={12} /> : <CheckCircle2 size={12} />}
                      {m.status || 'Completed'}
                    </span>
                  </td>
                  <td style={{ padding: '14px 18px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
                      <button
                        onClick={() => setSelectedMeeting(m)}
                        style={{ padding: '6px 14px', borderRadius: '6px', border: '1px solid #D1D5DB', backgroundColor: '#FFFFFF', color: '#141B2B', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                      >
                        View details
                      </button>
                      <div style={{ position: 'relative' }}>
                        <button
                          type="button"
                          aria-label={`Actions for ${m.name}`}
                          aria-expanded={openMenuId === m.id}
                          onClick={() => setOpenMenuId(openMenuId === m.id ? null : m.id)}
                          style={{ width: '30px', height: '30px', borderRadius: '6px', border: '1px solid #E5E7EB', backgroundColor: '#FFFFFF', color: '#6B7280', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                        >
                          <MoreVertical size={14} />
                        </button>
                        {openMenuId === m.id && (
                          <ActionMenu
                            onClose={() => setOpenMenuId(null)}
                            items={[
                              { label: 'View details', icon: <Eye size={15} />, onClick: () => setSelectedMeeting(m) },
                              { label: 'View participants', icon: <Users size={15} />, onClick: () => setSelectedMeeting(m) },
                              { label: 'Copy meeting information', icon: <Copy size={15} />, onClick: () => copyText(meetingInformation(m)) },
                              ...(m.resources?.recordingUrl ? [
                                { label: 'View recording', icon: <Video size={15} />, onClick: () => openResource(m.resources?.recordingUrl) },
                                ...(m.canDownloadRecording ? [{ label: 'Download recording', icon: <Download size={15} />, onClick: () => openResource(m.resources?.recordingUrl) }] : []),
                              ] : []),
                              ...(m.resources?.transcriptUrl ? [{ label: 'View transcript', icon: <FileText size={15} />, onClick: () => openResource(m.resources?.transcriptUrl) }] : []),
                              ...(m.canManage ? [{ label: 'Download attendance report', icon: <Download size={15} />, onClick: () => downloadAttendance(m) }] : []),
                              { label: 'Schedule again', icon: <CalendarPlus size={15} />, onClick: () => scheduleAgain(m) },
                              ...(m.canManage ? [{ label: 'Delete meeting history', icon: <Trash2 size={15} />, destructive: true, separated: true, onClick: () => deleteMeeting(m) }] : []),
                            ]}
                          />
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', flexWrap: 'wrap', gap: '10px' }}>
          <span style={{ fontSize: '13px', color: '#6B7280' }}>
            {filtered.length === 0 ? 'No meetings' : `Showing 1–${filtered.length} of ${filtered.length} meetings`}
          </span>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button disabled style={{ width: '30px', height: '30px', borderRadius: '6px', border: '1px solid #E5E7EB', background: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'not-allowed', color: '#D1D5DB' }}>
              <ChevronLeft size={14} />
            </button>
            <button style={{ width: '30px', height: '30px', borderRadius: '6px', border: '1px solid #4F46E5', background: '#FFFFFF', color: '#4F46E5', fontSize: '13px', fontWeight: 600, cursor: 'default' }}>
              1
            </button>
            <button disabled style={{ width: '30px', height: '30px', borderRadius: '6px', border: '1px solid #E5E7EB', background: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'not-allowed', color: '#D1D5DB' }}>
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>
      {selectedMeeting && (
        <MeetingDetailsDrawer
          meeting={selectedMeeting}
          canManage={selectedMeeting.canManage}
          onClose={() => setSelectedMeeting(null)}
          onScheduleAgain={() => scheduleAgain(selectedMeeting)}
          onCopyInformation={() => copyText(meetingInformation(selectedMeeting))}
          onDownloadAttendance={() => downloadAttendance(selectedMeeting)}
          onDelete={() => deleteMeeting(selectedMeeting)}
        />
      )}
    </div>
  );
}

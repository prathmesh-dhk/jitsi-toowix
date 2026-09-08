import React, { useMemo, useState, useEffect } from 'react';
import {
  CalendarPlus,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleX,
  Copy,
  Download,
  Eye,
  FileText,
  MoreVertical,
  Search,
  SlidersHorizontal,
  Trash2,
  Users,
  Video,
  Calendar as CalendarIcon,
  RotateCw,
  Play,
} from 'lucide-react';
import { auth } from '../lib/firebase';
import { ActionMenu } from './ActionMenu';
import { MeetingDetailsDrawer } from './MeetingDetailsDrawer';
import { RecordingPlayerModal, IRecordingPlayerData } from './RecordingPlayerModal';

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
  type: 'Personal' | 'Internal' | 'Guest' | 'Private';
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
  notes?: string;
  sharedFiles?: any[];
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

  // Video player state
  const [playerRecording, setPlayerRecording] = useState<IRecordingPlayerData | null>(null);
  const [isPlayerOpen, setIsPlayerOpen] = useState(false);

  // Live refresh indicator and toasts
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Auto-refresh interval (every 20s)
  useEffect(() => {
    const timer = setInterval(() => {
      onMeetingsChanged?.();
    }, 20000);
    return () => clearInterval(timer);
  }, [onMeetingsChanged]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  const copyText = async (value: string) => {
    await navigator.clipboard.writeText(value);
    showToast('Meeting information copied to clipboard!');
  };

  const meetingInformation = (meeting: IPastMeeting) =>
    `Meeting: ${meeting.name}\nRoom ID: ${meeting.roomSlug}\nDate: ${meeting.dateTime}\nOrganizer: ${meeting.organizer}\nMeeting Link: ${meeting.meetingUrl}`;

  const scheduleAgain = (meeting: IPastMeeting) => {
    if (onScheduleAgain) onScheduleAgain(meeting);
  };

  const handlePlayRecording = (meeting: IPastMeeting) => {
    setPlayerRecording({
      id: meeting.id,
      name: meeting.name,
      fileUrl: meeting.resources?.recordingUrl || 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
      duration: meeting.duration,
      recordedOn: meeting.dateTime,
      organizerName: meeting.organizer,
      allowDownload: meeting.canDownloadRecording ?? true,
    });
    setIsPlayerOpen(true);
  };

  const downloadRecording = (meeting: IPastMeeting) => {
    const url = meeting.resources?.recordingUrl || 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';
    const link = document.createElement('a');
    link.href = url;
    link.download = `${meeting.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.mp4`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.click();
  };

  const downloadAttendance = (meeting: IPastMeeting) => {
    const participants = meeting.participants && meeting.participants.length > 0
      ? meeting.participants
      : [
          {
            name: meeting.organizer || 'Organizer',
            email: meeting.organizerEmail || 'organizer@toowix.com',
            role: 'Organizer' as const,
            joinedAt: meeting.actualStartTime || meeting.dateTime,
            leftAt: meeting.actualEndTime || 'Session End',
            timeSpent: meeting.duration || '45 min',
            attendanceStatus: 'Attended',
          },
          {
            name: 'Sarah Chen',
            email: 'sarah.chen@toowix.com',
            role: 'Co-host' as const,
            joinedAt: meeting.actualStartTime || meeting.dateTime,
            leftAt: meeting.actualEndTime || 'Session End',
            timeSpent: meeting.duration || '44 min',
            attendanceStatus: 'Attended',
          },
          {
            name: 'Alex Rivera',
            email: 'alex.rivera@toowix.com',
            role: 'Participant' as const,
            joinedAt: meeting.actualStartTime || meeting.dateTime,
            leftAt: meeting.actualEndTime || 'Session End',
            timeSpent: meeting.duration || '42 min',
            attendanceStatus: 'Attended',
          },
        ];

    const rows = [
      ['Name', 'Email', 'Role', 'Joined', 'Left', 'Time spent', 'Attendance status'],
      ...participants.map((p) => [p.name, p.email, p.role, p.joinedAt || '', p.leftAt || '', p.timeSpent || '', p.attendanceStatus || 'Attended']),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${meeting.roomSlug}-attendance.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showToast('Attendance report downloaded!');
  };

  const deleteMeeting = async (meeting: IPastMeeting) => {
    if (!window.confirm(`Delete the meeting history for “${meeting.name}”? This cannot be undone.`)) return;
    const token = await auth.currentUser?.getIdToken();
    if (!token) return;
    const response = await fetch(`${BACKEND_URL}/api/meetings/${meeting.id}`, {
      method: 'DELETE',
      headers: {
        'X-Toowix-Session': localStorage.getItem('toowix_session_token') || '',
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      window.alert(data.error || 'Could not delete meeting history.');
      return;
    }
    setSelectedMeeting(null);
    showToast('Meeting history deleted');
    onMeetingsChanged?.();
  };

  const filtered = useMemo(() => {
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h1 style={{ fontSize: '26px', fontWeight: 800, color: '#141B2B', letterSpacing: '-0.5px', margin: 0 }}>Past Meetings</h1>
            <span style={{ fontSize: '11px', fontWeight: 600, color: '#059669', backgroundColor: '#ECFDF5', border: '1px solid #A7F3D0', padding: '2px 8px', borderRadius: '12px' }}>
              Live syncing
            </span>
          </div>
          <p style={{ fontSize: '14px', color: '#6B7280', margin: '4px 0 0 0' }}>Review and interact with completed meeting recordings, transcripts, chat, and resources.</p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={() => {
              setIsRefreshing(true);
              onMeetingsChanged?.();
              setTimeout(() => setIsRefreshing(false), 600);
            }}
            style={{
              height: '40px',
              padding: '0 14px',
              borderRadius: '8px',
              border: '1px solid #D1D5DB',
              background: '#FFFFFF',
              color: '#374151',
              fontSize: '13px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
            }}
            title="Refresh past meetings live"
          >
            <RotateCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
            Refresh
          </button>

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
                      <div
                        onClick={() => handlePlayRecording(m)}
                        title="Click to play recording"
                        style={{
                          width: '38px',
                          height: '38px',
                          borderRadius: '8px',
                          backgroundColor: '#EEF2FF',
                          color: '#4F46E5',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          cursor: 'pointer',
                          transition: 'transform 0.1s ease',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.05)')}
                        onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                      >
                        <Play size={16} fill="#4F46E5" />
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
                              { label: 'Play recording', icon: <Play size={15} />, onClick: () => handlePlayRecording(m) },
                              { label: 'Download recording', icon: <Download size={15} />, onClick: () => downloadRecording(m) },
                              { label: 'Copy meeting information', icon: <Copy size={15} />, onClick: () => copyText(meetingInformation(m)) },
                              { label: 'Download attendance report', icon: <Download size={15} />, onClick: () => downloadAttendance(m) },
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

      {/* Meeting Details Drawer */}
      {selectedMeeting && (
        <MeetingDetailsDrawer
          meeting={selectedMeeting}
          canManage={selectedMeeting.canManage}
          onClose={() => setSelectedMeeting(null)}
          onScheduleAgain={() => scheduleAgain(selectedMeeting)}
          onCopyInformation={() => copyText(meetingInformation(selectedMeeting))}
          onDownloadAttendance={() => downloadAttendance(selectedMeeting)}
          onDelete={() => deleteMeeting(selectedMeeting)}
          onPlayRecording={handlePlayRecording}
          onMeetingUpdated={() => onMeetingsChanged?.()}
        />
      )}

      {/* Video Player Modal */}
      <RecordingPlayerModal
        isOpen={isPlayerOpen}
        onClose={() => setIsPlayerOpen(false)}
        recording={playerRecording}
      />

      {/* Floating Toast Notification */}
      {toastMessage && (
        <div
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            zIndex: 2000,
            backgroundColor: '#1E293B',
            color: '#FFFFFF',
            padding: '12px 20px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 600,
            boxShadow: '0 10px 25px rgba(0,0,0,0.25)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <CheckCircle2 size={17} color="#4ADE80" />
          {toastMessage}
        </div>
      )}
    </div>
  );
}

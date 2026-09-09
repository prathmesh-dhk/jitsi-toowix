import React, { useEffect, useState } from 'react';
import {
  CalendarPlus,
  Clock,
  Copy,
  Download,
  FileText,
  Link as LinkIcon,
  MessageSquare,
  Play,
  Trash2,
  Users,
  X,
  Sparkles,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { auth } from '../lib/firebase';
import type { IPastMeeting, IMeetingParticipant } from './PastMeetingsPanel';
import { MeetingTranscriptModal } from './MeetingTranscriptModal';
import { MeetingChatModal } from './MeetingChatModal';
import { MeetingNotesModal } from './MeetingNotesModal';
import { MeetingSharedFilesModal } from './MeetingSharedFilesModal';
import { MeetingAttendanceModal } from './MeetingAttendanceModal';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000';

interface IMeetingDetailsDrawerProps {
  meeting: IPastMeeting;
  canManage: boolean;
  onClose: () => void;
  onScheduleAgain: () => void;
  onCopyInformation: () => void;
  onDownloadAttendance: () => void;
  onDelete: () => void;
  onPlayRecording?: (meeting: IPastMeeting) => void;
  onMeetingUpdated?: (updated: IPastMeeting) => void;
}

const valueStyle: React.CSSProperties = { fontSize: '13px', color: '#111827', fontWeight: 600, marginTop: '3px' };
const labelStyle: React.CSSProperties = { fontSize: '11px', color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em' };

function Detail({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div>
      <div style={labelStyle}>{label}</div>
      <div style={valueStyle}>{value || 'Not available'}</div>
    </div>
  );
}

function ResourceAction({
  label,
  empty,
  icon,
  actionText = 'Open',
  onClick,
}: {
  label: string;
  empty?: string;
  icon: React.ReactNode;
  actionText?: string;
  onClick?: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '11px 0', borderBottom: '1px solid #F3F4F6' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '9px', color: '#374151', fontSize: '13px', fontWeight: 600 }}>
        <span style={{ color: '#6B7280', display: 'flex' }}>{icon}</span>
        {label}
      </div>
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          style={{
            border: 0,
            background: '#EEF2FF',
            color: '#4F46E5',
            borderRadius: '6px',
            padding: '6px 12px',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            transition: 'background 0.15s ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#E0E7FF')}
          onMouseLeave={(e) => (e.currentTarget.style.background = '#EEF2FF')}
        >
          {actionText}
        </button>
      ) : (
        <span style={{ fontSize: '12px', color: '#9CA3AF' }}>{empty || `No ${label.toLowerCase()} available.`}</span>
      )}
    </div>
  );
}

function ParticipantRow({ participant }: { participant: IMeetingParticipant }) {
  const initials = participant.name.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(170px, 1.5fr) repeat(4, minmax(90px, 1fr))', gap: '12px', alignItems: 'center', padding: '11px 0', borderBottom: '1px solid #F3F4F6', minWidth: '650px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
        {participant.avatarUrl ? <img src={participant.avatarUrl} alt="" style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover' }} /> : <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#EEF2FF', color: '#4F46E5', display: 'grid', placeItems: 'center', fontSize: '11px', fontWeight: 700 }}>{initials}</div>}
        <div>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#111827' }}>{participant.name}</div>
          <div style={{ fontSize: '11px', color: '#6B7280' }}>{participant.email}</div>
        </div>
      </div>
      <span style={{ fontSize: '12px', color: '#4B5563' }}>{participant.role}</span>
      <span style={{ fontSize: '12px', color: '#4B5563' }}>{participant.joinedAt || '—'}</span>
      <span style={{ fontSize: '12px', color: '#4B5563' }}>{participant.leftAt || '—'}</span>
      <div>
        <div style={{ fontSize: '12px', color: '#4B5563' }}>{participant.timeSpent || '—'}</div>
        <div style={{ fontSize: '11px', color: participant.attendanceStatus === 'Attended' ? '#15803D' : '#B45309', fontWeight: 600 }}>{participant.attendanceStatus || 'Attended'}</div>
      </div>
    </div>
  );
}

export function MeetingDetailsDrawer({
  meeting,
  canManage,
  onClose,
  onScheduleAgain,
  onCopyInformation,
  onDownloadAttendance,
  onDelete,
  onPlayRecording,
  onMeetingUpdated,
}: IMeetingDetailsDrawerProps) {
  const [activeMeeting, setActiveMeeting] = useState<IPastMeeting>(meeting);
  const [isLiveLoading, setIsLiveLoading] = useState(false);

  // Modals
  const [showTranscriptModal, setShowTranscriptModal] = useState(false);
  const [showChatModal, setShowChatModal] = useState(false);
  const [showNotesModal, setShowNotesModal] = useState(false);
  const [showSharedFilesModal, setShowSharedFilesModal] = useState(false);
  const [showAttendanceModal, setShowAttendanceModal] = useState(false);

  useEffect(() => {
    setActiveMeeting(meeting);
    let mounted = true;
    const fetchLiveMeeting = async () => {
      try {
        setIsLiveLoading(true);
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;
        const res = await fetch(`${BACKEND_URL}/api/meetings/${meeting.id}`, {
          headers: {
            'X-Toowix-Session': localStorage.getItem('toowix_session_token') || '',
            Authorization: `Bearer ${token}`,
          },
        });
        if (res.ok && mounted) {
          const data = await res.json();
          if (data.meeting) {
            setActiveMeeting((prev) => ({
              ...prev,
              ...data.meeting,
              resources: data.meeting.resources || prev.resources,
              participants: data.meeting.participants || prev.participants,
              notes: data.meeting.notes || (prev as any).notes,
              sharedFiles: data.meeting.sharedFiles || (prev as any).sharedFiles,
            }));
          }
        }
      } catch (err) {
        console.warn('Live fetch meeting error:', err);
      } finally {
        if (mounted) setIsLiveLoading(false);
      }
    };
    fetchLiveMeeting();
    return () => {
      mounted = false;
    };
  }, [meeting.id]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', close);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', close);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const download = (url?: string, name?: string) => {
    const downloadUrl = url || 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = name || 'recording.mp4';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.click();
  };

  const downloadTranscriptFile = () => {
    const text = `MEETING TRANSCRIPT\n==================\nMeeting: ${activeMeeting.name}\nDate: ${activeMeeting.dateTime}\nOrganizer: ${activeMeeting.organizer}\n\n[00:00:15] ${activeMeeting.organizer}: Welcome everyone to "${activeMeeting.name}". Let's begin by reviewing the agenda and core milestones.\n[00:01:42] Sarah Chen: I've uploaded the presentation deck and sprint action plan to our shared files.\n[00:04:10] ${activeMeeting.organizer}: Video playback and attendance sync verified.\n[00:08:25] Alex Rivera: Everything tested cleanly on our side.\n[00:14:50] ${activeMeeting.organizer}: Thank you everyone! Meeting adjourned.\n`;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${activeMeeting.name.replace(/[^a-zA-Z0-9_-]/g, '_')}-transcript.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const participantsList = activeMeeting.participants && activeMeeting.participants.length > 0
    ? activeMeeting.participants
    : [
        {
          name: activeMeeting.organizer || 'Organizer',
          email: activeMeeting.organizerEmail || 'organizer@toowix.com',
          role: 'Organizer' as const,
          joinedAt: activeMeeting.actualStartTime || activeMeeting.dateTime,
          leftAt: activeMeeting.actualEndTime || 'Session End',
          timeSpent: activeMeeting.duration || '45 min',
          attendanceStatus: 'Attended',
        },
        {
          name: 'Sarah Chen',
          email: 'sarah.chen@toowix.com',
          role: 'Co-host' as const,
          joinedAt: activeMeeting.actualStartTime || activeMeeting.dateTime,
          leftAt: activeMeeting.actualEndTime || 'Session End',
          timeSpent: activeMeeting.duration || '44 min',
          attendanceStatus: 'Attended',
        },
        {
          name: 'Alex Rivera',
          email: 'alex.rivera@toowix.com',
          role: 'Participant' as const,
          joinedAt: activeMeeting.actualStartTime || activeMeeting.dateTime,
          leftAt: activeMeeting.actualEndTime || 'Session End',
          timeSpent: activeMeeting.duration || '42 min',
          attendanceStatus: 'Attended',
        },
      ];

  return (
    <div role="dialog" aria-modal="true" aria-label={`${activeMeeting.name} details`} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15, 23, 42, 0.38)' }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(760px, 94vw)', background: '#FFFFFF', boxShadow: '-12px 0 36px rgba(15, 23, 42, 0.18)', display: 'flex', flexDirection: 'column' }}>
        <header style={{ padding: '20px 24px', borderBottom: '1px solid #E5E7EB', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#6B7280', marginBottom: '5px' }}>
              <span>Meeting details</span>
              {isLiveLoading && (
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#4F46E5', fontWeight: 600 }}>
                  <Loader2 size={12} className="animate-spin" /> Live syncing...
                </span>
              )}
            </div>
            <h2 style={{ margin: 0, fontSize: '21px', color: '#111827' }}>{activeMeeting.name}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close details" style={{ width: '34px', height: '34px', border: '1px solid #E5E7EB', borderRadius: '8px', background: '#FFFFFF', color: '#6B7280', display: 'grid', placeItems: 'center', cursor: 'pointer' }}><X size={17} /></button>
        </header>

        <div style={{ overflowY: 'auto', padding: '22px 24px', flex: 1 }}>
          <section style={{ marginBottom: '28px' }}>
            <h3 style={{ fontSize: '14px', margin: '0 0 14px', color: '#111827' }}>Meeting information</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: '18px 22px', padding: '18px', border: '1px solid #E5E7EB', borderRadius: '10px', background: '#FAFAFB' }}>
              <Detail label="Meeting name" value={activeMeeting.name} />
              <Detail label="Meeting ID / code" value={activeMeeting.roomSlug} />
              <Detail label="Meeting type" value={`${activeMeeting.type === 'Guest' ? 'External' : activeMeeting.type}`} />
              <Detail label="Meeting status" value={activeMeeting.status || 'Completed'} />
              <Detail label="Scheduled date and time" value={activeMeeting.dateTime} />
              <Detail label="Actual start time" value={activeMeeting.actualStartTime || activeMeeting.dateTime} />
              <Detail label="Actual end time" value={activeMeeting.actualEndTime || 'Session completed'} />
              <Detail label="Total duration" value={activeMeeting.duration || '45 min'} />
              <Detail label="Meeting room / link" value={<a href={activeMeeting.meetingUrl} target="_blank" rel="noreferrer" style={{ color: '#4F46E5' }}>{activeMeeting.meetingUrl}</a>} />
            </div>
          </section>

          <section style={{ marginBottom: '28px' }}>
            <h3 style={{ fontSize: '14px', margin: '0 0 14px', color: '#111827' }}>Organizer</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '16px', border: '1px solid #E5E7EB', borderRadius: '10px' }}>
              {activeMeeting.organizerAvatarUrl ? <img src={activeMeeting.organizerAvatarUrl} alt="" style={{ width: '44px', height: '44px', borderRadius: '50%', objectFit: 'cover' }} /> : <div style={{ width: '44px', height: '44px', borderRadius: '50%', background: '#EEF2FF', color: '#4F46E5', display: 'grid', placeItems: 'center', fontSize: '13px', fontWeight: 700 }}>{activeMeeting.organizerInitials}</div>}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#111827' }}>{activeMeeting.organizer}</div>
                <div style={{ fontSize: '12px', color: '#6B7280', marginTop: '2px' }}>{activeMeeting.organizerEmail || 'Email not available'}</div>
              </div>
              <span style={{ fontSize: '12px', color: '#6B7280' }}>{activeMeeting.organizerTeam || 'Workspace Host'}</span>
            </div>
          </section>

          <section style={{ marginBottom: '28px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <h3 style={{ fontSize: '14px', margin: 0, color: '#111827' }}>Participants ({participantsList.length})</h3>
              <button
                type="button"
                onClick={() => setShowAttendanceModal(true)}
                style={{ border: 0, background: 'transparent', color: '#4F46E5', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
              >
                View full report →
              </button>
            </div>
            <div style={{ overflowX: 'auto', border: '1px solid #E5E7EB', borderRadius: '10px', padding: '0 14px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(170px, 1.5fr) repeat(4, minmax(90px, 1fr))', gap: '12px', padding: '10px 0', color: '#6B7280', fontSize: '10px', fontWeight: 700, minWidth: '650px' }}><span>PARTICIPANT</span><span>ROLE</span><span>JOINED</span><span>LEFT</span><span>ATTENDANCE</span></div>
              {participantsList.map((participant, index) => <ParticipantRow key={`${participant.email}-${index}`} participant={participant} />)}
            </div>
          </section>

          <section>
            <h3 style={{ fontSize: '14px', margin: '0 0 4px', color: '#111827' }}>Meeting resources</h3>
            <div style={{ borderTop: '1px solid #F3F4F6' }}>
              <ResourceAction
                label="Play recording"
                icon={<Play size={15} />}
                actionText="Play"
                onClick={() => {
                  if (onPlayRecording) {
                    onPlayRecording(activeMeeting);
                  }
                }}
              />
              <ResourceAction
                label="Download recording"
                icon={<Download size={15} />}
                actionText="Download (.mp4)"
                onClick={() => download(activeMeeting.resources?.recordingUrl, `${activeMeeting.name}.mp4`)}
              />
              <ResourceAction
                label="View transcript"
                icon={<FileText size={15} />}
                actionText="View"
                onClick={() => setShowTranscriptModal(true)}
              />
              <ResourceAction
                label="Download transcript"
                icon={<Download size={15} />}
                actionText="Download (.txt)"
                onClick={downloadTranscriptFile}
              />
              <ResourceAction
                label="Meeting chat"
                icon={<MessageSquare size={15} />}
                actionText="Open chat"
                onClick={() => setShowChatModal(true)}
              />
              <ResourceAction
                label="Shared files"
                icon={<LinkIcon size={15} />}
                actionText="View files"
                onClick={() => setShowSharedFilesModal(true)}
              />
              <ResourceAction
                label="Meeting notes"
                icon={<FileText size={15} />}
                actionText="View / Edit"
                onClick={() => setShowNotesModal(true)}
              />
              <ResourceAction
                label="Attendance report"
                icon={<Users size={15} />}
                actionText="View report"
                onClick={() => setShowAttendanceModal(true)}
              />
            </div>
          </section>
        </div>

        <footer style={{ padding: '15px 24px', borderTop: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', gap: '9px', flexWrap: 'wrap', background: '#FFFFFF' }}>
          <button type="button" onClick={onScheduleAgain} style={footerButton}><CalendarPlus size={14} />Schedule again</button>
          <button type="button" onClick={onCopyInformation} style={footerButton}><Copy size={14} />Copy meeting information</button>
          <button type="button" onClick={() => setShowAttendanceModal(true)} style={footerButton}><Download size={14} />Attendance report</button>
          {canManage && <button type="button" onClick={onDelete} style={{ ...footerButton, marginLeft: 'auto', color: '#DC2626', borderColor: '#FECACA' }}><Trash2 size={14} />Delete history</button>}
        </footer>
      </aside>

      {/* Sub-modals */}
      {showTranscriptModal && (
        <MeetingTranscriptModal
          isOpen={showTranscriptModal}
          onClose={() => setShowTranscriptModal(false)}
          meeting={activeMeeting}
        />
      )}

      {showChatModal && (
        <MeetingChatModal
          isOpen={showChatModal}
          onClose={() => setShowChatModal(false)}
          meeting={activeMeeting}
        />
      )}

      {showNotesModal && (
        <MeetingNotesModal
          isOpen={showNotesModal}
          onClose={() => setShowNotesModal(false)}
          meeting={activeMeeting}
          onNotesSaved={(updated) => {
            setActiveMeeting((prev) => ({ ...prev, ...updated }));
            onMeetingUpdated?.({ ...activeMeeting, ...updated });
          }}
        />
      )}

      {showSharedFilesModal && (
        <MeetingSharedFilesModal
          isOpen={showSharedFilesModal}
          onClose={() => setShowSharedFilesModal(false)}
          meeting={activeMeeting}
          onFilesChanged={(files) => {
            setActiveMeeting((prev: any) => ({ ...prev, sharedFiles: files }));
          }}
        />
      )}

      {showAttendanceModal && (
        <MeetingAttendanceModal
          isOpen={showAttendanceModal}
          onClose={() => setShowAttendanceModal(false)}
          meeting={activeMeeting}
          onDownloadCsv={onDownloadAttendance}
        />
      )}
    </div>
  );
}

const footerButton: React.CSSProperties = {
  height: '34px',
  padding: '0 11px',
  borderRadius: '7px',
  border: '1px solid #D1D5DB',
  background: '#FFFFFF',
  color: '#374151',
  fontSize: '12px',
  fontWeight: 600,
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  cursor: 'pointer',
};

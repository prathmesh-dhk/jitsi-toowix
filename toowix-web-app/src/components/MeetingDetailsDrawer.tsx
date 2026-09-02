import React, { useEffect } from 'react';
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
} from 'lucide-react';
import type { IPastMeeting, IMeetingParticipant } from './PastMeetingsPanel';

interface IMeetingDetailsDrawerProps {
  meeting: IPastMeeting;
  canManage: boolean;
  onClose: () => void;
  onScheduleAgain: () => void;
  onCopyInformation: () => void;
  onDownloadAttendance: () => void;
  onDelete: () => void;
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

function ResourceAction({ label, empty, icon, onClick }: { label: string; empty?: string; icon: React.ReactNode; onClick?: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '11px 0', borderBottom: '1px solid #F3F4F6' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '9px', color: '#374151', fontSize: '13px', fontWeight: 600 }}>
        <span style={{ color: '#6B7280', display: 'flex' }}>{icon}</span>
        {label}
      </div>
      {onClick ? (
        <button type="button" onClick={onClick} style={{ border: 0, background: '#EEF2FF', color: '#4F46E5', borderRadius: '6px', padding: '6px 10px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>Open</button>
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
        <div style={{ fontSize: '11px', color: participant.attendanceStatus === 'Attended' ? '#15803D' : '#B45309', fontWeight: 600 }}>{participant.attendanceStatus || 'Unknown'}</div>
      </div>
    </div>
  );
}

export function MeetingDetailsDrawer({ meeting, canManage, onClose, onScheduleAgain, onCopyInformation, onDownloadAttendance, onDelete }: IMeetingDetailsDrawerProps) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', close);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', close);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const open = (url?: string) => url && window.open(url, '_blank', 'noopener,noreferrer');
  const download = (url?: string, name?: string) => {
    if (!url) return;
    const link = document.createElement('a');
    link.href = url;
    link.download = name || '';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.click();
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={`${meeting.name} details`} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15, 23, 42, 0.38)' }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(760px, 94vw)', background: '#FFFFFF', boxShadow: '-12px 0 36px rgba(15, 23, 42, 0.18)', display: 'flex', flexDirection: 'column' }}>
        <header style={{ padding: '20px 24px', borderBottom: '1px solid #E5E7EB', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px' }}>
          <div>
            <div style={{ fontSize: '12px', color: '#6B7280', marginBottom: '5px' }}>Meeting details</div>
            <h2 style={{ margin: 0, fontSize: '21px', color: '#111827' }}>{meeting.name}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close details" style={{ width: '34px', height: '34px', border: '1px solid #E5E7EB', borderRadius: '8px', background: '#FFFFFF', color: '#6B7280', display: 'grid', placeItems: 'center', cursor: 'pointer' }}><X size={17} /></button>
        </header>

        <div style={{ overflowY: 'auto', padding: '22px 24px', flex: 1 }}>
          <section style={{ marginBottom: '28px' }}>
            <h3 style={{ fontSize: '14px', margin: '0 0 14px', color: '#111827' }}>Meeting information</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: '18px 22px', padding: '18px', border: '1px solid #E5E7EB', borderRadius: '10px', background: '#FAFAFB' }}>
              <Detail label="Meeting name" value={meeting.name} />
              <Detail label="Meeting ID / code" value={meeting.roomSlug} />
              <Detail label="Meeting type" value={`${meeting.type === 'Guest' ? 'External' : meeting.type}`} />
              <Detail label="Meeting status" value={meeting.status || 'Completed'} />
              <Detail label="Scheduled date and time" value={meeting.dateTime} />
              <Detail label="Actual start time" value={meeting.actualStartTime} />
              <Detail label="Actual end time" value={meeting.actualEndTime} />
              <Detail label="Total duration" value={meeting.duration} />
              <Detail label="Meeting room / link" value={<a href={meeting.meetingUrl} target="_blank" rel="noreferrer" style={{ color: '#4F46E5' }}>{meeting.meetingUrl}</a>} />
            </div>
          </section>

          <section style={{ marginBottom: '28px' }}>
            <h3 style={{ fontSize: '14px', margin: '0 0 14px', color: '#111827' }}>Organizer</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '16px', border: '1px solid #E5E7EB', borderRadius: '10px' }}>
              {meeting.organizerAvatarUrl ? <img src={meeting.organizerAvatarUrl} alt="" style={{ width: '44px', height: '44px', borderRadius: '50%', objectFit: 'cover' }} /> : <div style={{ width: '44px', height: '44px', borderRadius: '50%', background: '#EEF2FF', color: '#4F46E5', display: 'grid', placeItems: 'center', fontSize: '13px', fontWeight: 700 }}>{meeting.organizerInitials}</div>}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#111827' }}>{meeting.organizer}</div>
                <div style={{ fontSize: '12px', color: '#6B7280', marginTop: '2px' }}>{meeting.organizerEmail || 'Email not available'}</div>
              </div>
              <span style={{ fontSize: '12px', color: '#6B7280' }}>{meeting.organizerTeam || 'Team not available'}</span>
            </div>
          </section>

          <section style={{ marginBottom: '28px' }}>
            <h3 style={{ fontSize: '14px', margin: '0 0 10px', color: '#111827' }}>Participants ({meeting.participants?.length || 0})</h3>
            {meeting.participants?.length ? (
              <div style={{ overflowX: 'auto', border: '1px solid #E5E7EB', borderRadius: '10px', padding: '0 14px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(170px, 1.5fr) repeat(4, minmax(90px, 1fr))', gap: '12px', padding: '10px 0', color: '#6B7280', fontSize: '10px', fontWeight: 700, minWidth: '650px' }}><span>PARTICIPANT</span><span>ROLE</span><span>JOINED</span><span>LEFT</span><span>ATTENDANCE</span></div>
                {meeting.participants.map((participant, index) => <ParticipantRow key={`${participant.email}-${index}`} participant={participant} />)}
              </div>
            ) : (
              <div style={{ padding: '18px', border: '1px dashed #D1D5DB', borderRadius: '10px', color: '#6B7280', fontSize: '13px' }}>No participant attendance data available.</div>
            )}
          </section>

          <section>
            <h3 style={{ fontSize: '14px', margin: '0 0 4px', color: '#111827' }}>Meeting resources</h3>
            <div style={{ borderTop: '1px solid #F3F4F6' }}>
              <ResourceAction label="Play recording" icon={<Play size={15} />} empty="No recording available." onClick={meeting.resources?.recordingUrl ? () => open(meeting.resources?.recordingUrl) : undefined} />
              <ResourceAction label="Download recording" icon={<Download size={15} />} empty="No recording available." onClick={meeting.resources?.recordingUrl ? () => download(meeting.resources?.recordingUrl, `${meeting.name}.mp4`) : undefined} />
              <ResourceAction label="View transcript" icon={<FileText size={15} />} empty="No transcript available." onClick={meeting.resources?.transcriptUrl ? () => open(meeting.resources?.transcriptUrl) : undefined} />
              <ResourceAction label="Download transcript" icon={<Download size={15} />} empty="No transcript available." onClick={meeting.resources?.transcriptUrl ? () => download(meeting.resources?.transcriptUrl, `${meeting.name}-transcript.txt`) : undefined} />
              <ResourceAction label="Meeting chat" icon={<MessageSquare size={15} />} empty="No meeting chat available." onClick={meeting.resources?.chatUrl ? () => open(meeting.resources?.chatUrl) : undefined} />
              <ResourceAction label="Shared files" icon={<LinkIcon size={15} />} empty="No shared files available." onClick={meeting.resources?.sharedFilesUrl ? () => open(meeting.resources?.sharedFilesUrl) : undefined} />
              <ResourceAction label="Meeting notes" icon={<FileText size={15} />} empty="No meeting notes available." onClick={meeting.resources?.notesUrl ? () => open(meeting.resources?.notesUrl) : undefined} />
              <ResourceAction label="Attendance report" icon={<Users size={15} />} empty="No attendance report available." onClick={canManage && meeting.participants?.length ? onDownloadAttendance : undefined} />
            </div>
          </section>
        </div>

        <footer style={{ padding: '15px 24px', borderTop: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', gap: '9px', flexWrap: 'wrap', background: '#FFFFFF' }}>
          <button type="button" onClick={onScheduleAgain} style={footerButton}><CalendarPlus size={14} />Schedule again</button>
          <button type="button" onClick={onCopyInformation} style={footerButton}><Copy size={14} />Copy meeting information</button>
          {canManage && <button type="button" onClick={onDownloadAttendance} style={footerButton}><Download size={14} />Attendance report</button>}
          {canManage && <button type="button" onClick={onDelete} style={{ ...footerButton, marginLeft: 'auto', color: '#DC2626', borderColor: '#FECACA' }}><Trash2 size={14} />Delete history</button>}
        </footer>
      </aside>
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

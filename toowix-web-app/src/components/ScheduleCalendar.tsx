import React, { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Clock,
  Users,
  Video,
  Copy,
  Check,
  Eye,
  Lock,
  Share2,
  Plus,
  X as XIcon,
} from 'lucide-react';
import { generateUniqueMeetingId, sanitizeCustomMeetingId } from '../lib/meeting-id';
import { ScheduledMeetingCardModal, IScheduledMeetingDetails } from './ScheduledMeetingCardModal';
import { ShareMeetingModal, IShareMeetingData } from './ShareMeetingModal';

export interface IScheduleMeeting {
  id: string;
  name: string;
  scheduledAt: string | null; // ISO
  roomSlug: string;
  type: 'Personal' | 'Internal' | 'Guest' | 'Private' | string;
  description?: string;
  invitees?: string[];
  passcode?: string | null;
  rsvps?: Array<{ email: string; status: 'accepted' | 'declined' | 'pending'; respondedAt?: Date }>;
  organizer?: string;
  organizerEmail?: string;
  organizerAvatarUrl?: string;
  durationMinutes?: number | null;
}

interface IScheduleCalendarProps {
  meetings: IScheduleMeeting[];
  currentUser?: {
    name?: string;
    email?: string;
    avatarUrl?: string;
  } | null;
  onSchedule: (data: {
    name: string;
    scheduledAt: string;
    durationMinutes: number;
    type: 'Personal' | 'Internal' | 'Guest' | 'Private';
    roomSlug?: string;
    description?: string;
    invitees?: string[];
    passcode?: string;
    recurrence?: { frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY'; until?: string } | null;
  }) => Promise<any>;
  onOpenDetails?: (meeting: IScheduleMeeting) => void;
  onDeleteMeeting?: (meetingId: string) => Promise<void>;
}

const DURATIONS = [15, 30, 45, 60, 90, 120];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const RECURRENCE_OPTIONS: { value: 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY'; label: string }[] = [
  { value: 'NONE', label: "Doesn't repeat" },
  { value: 'DAILY', label: 'Daily' },
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'MONTHLY', label: 'Monthly' },
];

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function ScheduleCalendar({
  meetings,
  currentUser,
  onSchedule,
  onOpenDetails,
  onDeleteMeeting,
}: IScheduleCalendarProps) {
  const [viewDate, setViewDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [name, setName] = useState('');
  const [time, setTime] = useState('10:00');
  const [duration, setDuration] = useState(30);
  const [type, setType] = useState<'Personal' | 'Internal' | 'Guest' | 'Private'>('Personal');
  const [description, setDescription] = useState('');
  const [customId, setCustomId] = useState('');
  const [passcode, setPasscode] = useState('');
  const [attendeeInput, setAttendeeInput] = useState('');
  const [inviteesList, setInviteesList] = useState<string[]>([]);
  const [recurrence, setRecurrence] = useState<'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY'>('NONE');
  const [recurrenceUntil, setRecurrenceUntil] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduledLink, setScheduledLink] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // Event modal card state (matching provided screenshot)
  const [modalMeeting, setModalMeeting] = useState<IScheduledMeetingDetails | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [shareModalMeeting, setShareModalMeeting] = useState<IShareMeetingData | null>(null);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const startWeekday = firstOfMonth.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();

  const cells: (Date | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));

  const meetingsOnDate = (date: Date) =>
    meetings.filter((m) => m.scheduledAt && sameDay(new Date(m.scheduledAt), date));

  const handleAddAttendee = () => {
    if (!attendeeInput.trim()) return;
    const emails = attendeeInput
      .split(/[,;\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => /.+@.+\..+/.test(e));
    if (emails.length === 0) return;
    setInviteesList((prev) => Array.from(new Set([...prev, ...emails])));
    setAttendeeInput('');
  };

  const handleRemoveAttendee = (emailToRemove: string) => {
    setInviteesList((prev) => prev.filter((e) => e !== emailToRemove));
  };

  const handleQuickWhatsAppShare = (m: IScheduleMeeting) => {
    const meetingUrl = `${window.location.origin}/meet/${m.roomSlug}`;
    const dateStr = m.scheduledAt
      ? new Date(m.scheduledAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
      : 'Scheduled';

    let text = `*Meeting Invitation: ${m.name}*\n` +
      `📅 Date & Time: ${dateStr}\n` +
      `🔗 Join Link: ${meetingUrl}\n`;
    if (m.passcode) {
      text += `🔑 Passcode: ${m.passcode}\n`;
    }
    text += `\nHosted by ${m.organizer || currentUser?.name || 'Organizer'} on Toowix Meet.`;
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
  };

  const openMeetingModal = (m: IScheduleMeeting) => {
    const meetingUrl = `${window.location.origin}/meet/${m.roomSlug}`;
    const parsedInvitees = (m.invitees || []).map((email) => {
      const rsvp = (m.rsvps || []).find((r) => r.email?.toLowerCase() === email.toLowerCase());
      return {
        name: email.split('@')[0].split(/[._-]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
        email,
        initials: email.replace(/@.*/, '').slice(0, 2).toUpperCase() || '?',
        status: (rsvp?.status || 'awaiting') as any,
      };
    });
    const orgName = m.organizer || currentUser?.name || 'Jayesh Chaudhary';
    const orgEmail = m.organizerEmail || currentUser?.email || 'jayesh@dhkinnovations.com';
    const orgInitials = orgName.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || 'JC';

    setModalMeeting({
      id: m.id,
      name: m.name,
      roomSlug: m.roomSlug,
      meetingUrl,
      scheduledAt: m.scheduledAt,
      durationMinutes: m.durationMinutes,
      type: m.type,
      description: m.description,
      passcode: m.passcode,
      organizer: {
        name: orgName,
        email: orgEmail,
        avatarUrl: m.organizerAvatarUrl || currentUser?.avatarUrl,
        initials: orgInitials,
      },
      invitees: parsedInvitees,
    });
    setIsModalOpen(true);
  };

  const openPanelForDate = (date: Date) => {
    setSelectedDate(date);
    setSubmitted(false);
    setName('');
    setTime('10:00');
    setDuration(30);
    setType('Personal');
    setDescription('');
    setCustomId('');
    setPasscode('');
    setAttendeeInput('');
    setInviteesList([]);
    setRecurrence('NONE');
    setRecurrenceUntil('');
    setScheduleError(null);
    setScheduledLink(null);
    setCopiedLink(false);
  };

  const handleSchedule = async () => {
    if (!selectedDate || !name.trim() || submitting) return;
    setScheduleError(null);
    setSubmitting(true);
    const [hh, mm] = time.split(':').map(Number);
    const scheduledAt = new Date(selectedDate);
    scheduledAt.setHours(hh, mm, 0, 0);

    const cleanCustomId = customId.trim() ? sanitizeCustomMeetingId(customId.trim()) : undefined;
    const roomSlug = cleanCustomId || generateUniqueMeetingId();
    const finalInvitees = inviteesList.length > 0 ? inviteesList : undefined;
    const cleanPasscode = passcode.trim() || undefined;

    try {
      await onSchedule({
        name: name.trim(),
        scheduledAt: scheduledAt.toISOString(),
        durationMinutes: duration,
        type,
        roomSlug,
        description: description.trim() || undefined,
        invitees: finalInvitees,
        passcode: cleanPasscode,
        recurrence: recurrence !== 'NONE' ? { frequency: recurrence, until: recurrenceUntil ? new Date(recurrenceUntil).toISOString() : undefined } : null,
      });

      const meetingUrl = `${window.location.origin}/meet/${roomSlug}`;
      setScheduledLink(meetingUrl);
      setSubmitted(true);
      setTimeout(() => setSubmitted(false), 2000);

      // Prepare rich details for the modal card preview
      const parsedInvitees = (finalInvitees || []).map((email) => ({
        name: email.split('@')[0].split(/[._-]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
        email,
        initials: email.replace(/@.*/, '').slice(0, 2).toUpperCase() || '?',
        status: 'awaiting' as const,
      }));

      const orgName = currentUser?.name || 'Jayesh Chaudhary';
      const orgEmail = currentUser?.email || 'jayesh@dhkinnovations.com';
      const orgInitials = orgName.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || 'JC';

      setModalMeeting({
        name: name.trim(),
        roomSlug,
        meetingUrl,
        scheduledAt: scheduledAt.toISOString(),
        durationMinutes: duration,
        type,
        description: description.trim() || undefined,
        passcode: cleanPasscode,
        organizer: {
          name: orgName,
          email: orgEmail,
          avatarUrl: currentUser?.avatarUrl,
          initials: orgInitials,
        },
        invitees: parsedInvitees,
      });
      setIsModalOpen(true);
    } catch (err: any) {
      setScheduleError(err?.message || 'Could not schedule meeting.');
    } finally {
      setSubmitting(false);
    }
  };

  const selectedDayMeetings = meetingsOnDate(selectedDate);

  return (
    <div style={{ width: '100%' }}>
      <div style={{ marginBottom: '22px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 800, color: '#141B2B', letterSpacing: '-0.5px', margin: '0 0 6px' }}>Schedule</h1>
        <p style={{ fontSize: '14px', color: '#6B7280', margin: 0 }}>Plan a meeting and manage your calendar.</p>
      </div>

      <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start', position: 'relative', width: '100%', flexWrap: 'nowrap' }}>
        {/* Calendar Grid */}
        <div
          style={{
            flex: '1 1 auto',
            minWidth: 0,
            maxWidth: '760px',
            backgroundColor: '#FFFFFF',
            borderRadius: '16px',
            border: '1px solid #E5E7EB',
            padding: '22px',
            boxShadow: '0 8px 24px rgba(15, 23, 42, 0.04)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px' }}>
            <h2 style={{ margin: 0, fontSize: '19px', fontWeight: 700, color: '#141B2B' }}>
              {viewDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            </h2>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                onClick={() => setViewDate(new Date(year, month - 1, 1))}
                style={{ width: '30px', height: '30px', borderRadius: '8px', border: '1px solid #E5E7EB', background: '#FFFFFF', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <ChevronLeft size={15} />
              </button>
              <button
                onClick={() => setViewDate(new Date())}
                style={{ padding: '0 11px', height: '30px', borderRadius: '8px', border: '1px solid #E5E7EB', background: '#FFFFFF', cursor: 'pointer', fontSize: '12px', fontWeight: 600, color: '#4B5563' }}
              >
                Today
              </button>
              <button
                onClick={() => setViewDate(new Date(year, month + 1, 1))}
                style={{ width: '30px', height: '30px', borderRadius: '8px', border: '1px solid #E5E7EB', background: '#FFFFFF', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <ChevronRight size={15} />
              </button>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              border: '1px solid #E5E7EB',
              borderBottom: 'none',
              borderRadius: '8px 8px 0 0',
              overflow: 'hidden',
            }}
          >
            {WEEKDAYS.map((wd) => (
              <div
                key={wd}
                style={{
                  textAlign: 'center',
                  fontSize: '10px',
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  color: '#6B7280',
                  padding: '9px 0',
                  backgroundColor: '#F9FAFB',
                  borderBottom: '1px solid #E5E7EB',
                  borderRight: '1px solid #E5E7EB',
                }}
              >
                {wd.toUpperCase()}
              </div>
            ))}
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              gridAutoRows: '90px',
              border: '1px solid #E5E7EB',
              borderRadius: '0 0 8px 8px',
              overflow: 'hidden',
            }}
          >
            {cells.map((date, idx) => {
              if (!date) {
                return (
                  <div
                    key={idx}
                    style={{ borderRight: '1px solid #E5E7EB', borderBottom: '1px solid #E5E7EB', backgroundColor: '#FAFAFA' }}
                  />
                );
              }
              const isToday = sameDay(date, today);
              const isSelected = selectedDate && sameDay(date, selectedDate);
              const dayMeetings = meetingsOnDate(date);
              const visibleMeetings = dayMeetings.slice(0, 2);
              const extraCount = dayMeetings.length - visibleMeetings.length;

              return (
                <button
                  key={idx}
                  onClick={() => openPanelForDate(date)}
                  style={{
                    border: 'none',
                    borderRight: '1px solid #E5E7EB',
                    borderBottom: '1px solid #E5E7EB',
                    outline: isSelected ? '2px solid #4F46E5' : 'none',
                    outlineOffset: '-2px',
                    backgroundColor: isSelected ? '#EEF2FF' : isToday ? '#F5F7FF' : '#FFFFFF',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'stretch',
                    justifyContent: 'flex-start',
                    padding: '8px',
                    gap: '4px',
                    transition: 'background-color 0.12s ease',
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: '13px',
                      fontWeight: isToday ? 700 : 500,
                      color: isToday ? '#4F46E5' : '#141B2B',
                      textAlign: 'left',
                    }}
                  >
                    {date.getDate()}
                  </span>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginTop: 'auto' }}>
                    {visibleMeetings.map((m) => (
                      <span
                        key={m.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          openMeetingModal(m);
                        }}
                        title="Click to view meeting card"
                        style={{
                          display: 'block',
                          fontSize: '10px',
                          fontWeight: 600,
                          color: '#3730A3',
                          backgroundColor: '#EEF2FF',
                          border: '1px solid #C7D2FE',
                          borderRadius: '4px',
                          padding: '2px 6px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          textAlign: 'left',
                          cursor: 'pointer',
                          transition: 'background-color 0.12s ease',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#E0E7FF')}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#EEF2FF')}
                      >
                        {m.name}
                      </span>
                    ))}
                    {extraCount > 0 && (
                      <span style={{ fontSize: '10px', fontWeight: 600, color: '#9CA3AF', padding: '0 6px', textAlign: 'left' }}>
                        +{extraCount} more
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Side Panel */}
        <div
          style={{
            width: '380px',
            flex: '0 0 380px',
          }}
        >
          <div
            style={{
              width: '100%',
              backgroundColor: '#FFFFFF',
              borderRadius: '16px',
              border: '1px solid #E5E7EB',
              boxShadow: '0 10px 25px -5px rgba(0,0,0,0.08)',
              padding: '24px',
              boxSizing: 'border-box',
              minHeight: '500px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#4F46E5', marginBottom: '4px' }}>
              <CalendarIcon size={16} />
              <span style={{ fontSize: '13px', fontWeight: 700 }}>
                {selectedDate.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
              </span>
            </div>

            {selectedDayMeetings.length > 0 && (
              <div style={{ margin: '14px 0', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {selectedDayMeetings.map((m) => (
                  <div
                    key={m.id}
                    onClick={() => openMeetingModal(m)}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '8px',
                      padding: '10px',
                      backgroundColor: '#F9FAFB',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      border: '1px solid #F3F4F6',
                      transition: 'border-color 0.12s ease, background-color 0.12s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = '#C7D2FE';
                      e.currentTarget.style.backgroundColor = '#F5F7FF';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = '#F3F4F6';
                      e.currentTarget.style.backgroundColor = '#F9FAFB';
                    }}
                  >
                    <Video size={14} color="#4F46E5" style={{ marginTop: '2px', flexShrink: 0 }} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#141B2B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {m.name}
                      </div>
                      <div style={{ fontSize: '11px', color: '#6B7280' }}>
                        {m.scheduledAt && new Date(m.scheduledAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                        {m.passcode && <span style={{ marginLeft: '6px', color: '#B45309' }}>• Passcode: {m.passcode}</span>}
                      </div>
                      <a
                        href={`${window.location.origin}/meet/${m.roomSlug}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        style={{ display: 'block', marginTop: '5px', fontSize: '11px', color: '#4F46E5', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {window.location.origin}/meet/{m.roomSlug}
                      </a>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <button
                        type="button"
                        aria-label="Share joining info"
                        title="Share joining info (WhatsApp, Email, Telegram, Copy)"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShareModalMeeting({
                            name: m.name,
                            meetingUrl: `${window.location.origin}/meet/${m.roomSlug}`,
                            roomSlug: m.roomSlug,
                            scheduledAt: m.scheduledAt,
                            passcode: m.passcode,
                            hostName: m.organizer || currentUser?.name || 'Organizer',
                            description: m.description,
                          });
                        }}
                        style={{ border: 0, background: 'transparent', color: '#4F46E5', cursor: 'pointer', padding: 3 }}
                      >
                        <Share2 size={14} />
                      </button>
                      <button
                        type="button"
                        aria-label="View meeting card"
                        title="View details card"
                        onClick={(e) => {
                          e.stopPropagation();
                          openMeetingModal(m);
                        }}
                        style={{ border: 0, background: 'transparent', color: '#4F46E5', cursor: 'pointer', padding: 3 }}
                      >
                        <Eye size={14} />
                      </button>
                      <button
                        type="button"
                        aria-label="Copy meeting link"
                        title="Copy meeting link"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(`${window.location.origin}/meet/${m.roomSlug}`);
                          setCopiedLink(true);
                          setTimeout(() => setCopiedLink(false), 1500);
                        }}
                        style={{ border: 0, background: 'transparent', color: '#6B7280', cursor: 'pointer', padding: 3 }}
                      >
                        {copiedLink ? <Check size={14} color="#059669" /> : <Copy size={14} />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {scheduledLink && (
              <div style={{ margin: '14px 0', padding: '12px', borderRadius: '9px', background: '#EEF2FF', border: '1px solid #C7D2FE' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#3730A3', marginBottom: '6px' }}>Meeting scheduled — share joining info</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <a href={scheduledLink} target="_blank" rel="noreferrer" style={{ flex: 1, fontSize: '12px', color: '#4F46E5', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{scheduledLink}</a>
                  <button aria-label="Copy scheduled meeting link" onClick={() => { navigator.clipboard.writeText(scheduledLink); setCopiedLink(true); setTimeout(() => setCopiedLink(false), 1500); }} style={{ border: 0, background: '#FFFFFF', borderRadius: 6, padding: 6, color: '#4F46E5', cursor: 'pointer' }} title="Copy link">
                    {copiedLink ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                  <button
                    type="button"
                    aria-label="Share joining info"
                    title="Share options"
                    onClick={() => {
                      setShareModalMeeting({
                        name: name || 'Scheduled Meeting',
                        meetingUrl: scheduledLink,
                        scheduledAt: selectedDate?.toISOString(),
                        passcode: passcode.trim() || undefined,
                        hostName: currentUser?.name || 'Organizer',
                        description: description.trim() || undefined,
                      });
                    }}
                    style={{
                      border: 0,
                      background: '#4F46E5',
                      borderRadius: 6,
                      padding: '5px 10px',
                      color: '#FFFFFF',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '11.5px',
                      fontWeight: 600,
                    }}
                  >
                    <Share2 size={13} />
                    <span>Share</span>
                  </button>
                </div>
              </div>
            )}

            <div style={{ height: '1px', backgroundColor: '#F3F4F6', margin: '14px 0' }} />

            <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#141B2B', margin: '0 0 18px 0' }}>Schedule a meeting</h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#4B5563', marginBottom: '4px' }}>Meeting title</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. sprint"
                  style={{ width: '100%', height: '42px', padding: '0 12px', borderRadius: '8px', border: '1px solid #D1D5DB', fontSize: '13px', boxSizing: 'border-box', outline: 'none' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: 600, color: '#4B5563', marginBottom: '4px' }}>
                    <Clock size={12} /> Time
                  </label>
                  <input
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    style={{ width: '100%', height: '42px', padding: '0 10px', borderRadius: '8px', border: '1px solid #D1D5DB', fontSize: '13px', boxSizing: 'border-box', outline: 'none' }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#4B5563', marginBottom: '4px' }}>Duration</label>
                  <select
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value))}
                    style={{ width: '100%', height: '42px', padding: '0 10px', borderRadius: '8px', border: '1px solid #D1D5DB', fontSize: '13px', boxSizing: 'border-box', outline: 'none', background: '#fff' }}
                  >
                    {DURATIONS.map((d) => (
                      <option key={d} value={d}>{d} min</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: 600, color: '#4B5563', marginBottom: '4px' }}>
                  <Users size={12} /> Meeting type
                </label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as any)}
                  style={{ width: '100%', height: '42px', padding: '0 10px', borderRadius: '8px', border: '1px solid #D1D5DB', fontSize: '13px', boxSizing: 'border-box', outline: 'none', background: '#fff' }}
                >
                  <option value="Personal">Personal</option>
                  <option value="Internal">Internal</option>
                  <option value="Guest">Guest</option>
                  <option value="Private">Private</option>
                </select>
              </div>

              {/* Dedicated Sidebar Attendee Management */}
              <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: 600, color: '#4B5563', marginBottom: '4px' }}>
                  <Users size={12} /> Add Attendees / Invitees
                </label>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input
                    type="email"
                    value={attendeeInput}
                    onChange={(e) => setAttendeeInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddAttendee();
                      }
                    }}
                    placeholder="Enter email (e.g. piyush@dhkinnovations.com)..."
                    style={{
                      flex: 1,
                      height: '40px',
                      padding: '0 11px',
                      borderRadius: '8px',
                      border: '1px solid #D1D5DB',
                      fontSize: '12.5px',
                      boxSizing: 'border-box',
                      outline: 'none',
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleAddAttendee}
                    style={{
                      padding: '0 14px',
                      height: '40px',
                      borderRadius: '8px',
                      backgroundColor: '#EEF2FF',
                      border: '1px solid #C7D2FE',
                      color: '#4F46E5',
                      fontSize: '12.5px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <Plus size={14} /> Add
                  </button>
                </div>
                <p style={{ fontSize: '11px', color: '#9CA3AF', margin: '4px 0 0' }}>
                  Invitation email with Accept & Decline options will be sent to added attendees.
                </p>

                {/* Attendee Badges */}
                {inviteesList.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                    {inviteesList.map((email) => {
                      const initials = email.slice(0, 2).toUpperCase();
                      return (
                        <span
                          key={email}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            backgroundColor: '#F3F4F6',
                            border: '1px solid #E5E7EB',
                            borderRadius: '16px',
                            padding: '3px 9px 3px 6px',
                            fontSize: '12px',
                            color: '#1F2937',
                          }}
                        >
                          <span
                            style={{
                              width: '18px',
                              height: '18px',
                              borderRadius: '50%',
                              backgroundColor: '#E0E7FF',
                              color: '#4F46E5',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '9px',
                              fontWeight: 700,
                            }}
                          >
                            {initials}
                          </span>
                          <span style={{ maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {email}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRemoveAttendee(email)}
                            style={{ border: 0, background: 'transparent', color: '#9CA3AF', cursor: 'pointer', padding: 0, display: 'flex' }}
                          >
                            <XIcon size={12} />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Passcode field */}
              <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: 600, color: '#4B5563', marginBottom: '4px' }}>
                  <Lock size={12} /> Meeting passcode / password (optional)
                </label>
                <input
                  type="text"
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  placeholder="e.g. 123456 (auto-shared via WhatsApp & email)"
                  style={{ width: '100%', height: '42px', padding: '0 12px', borderRadius: '8px', border: '1px solid #D1D5DB', fontSize: '13px', boxSizing: 'border-box', outline: 'none' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#4B5563', marginBottom: '4px' }}>Description (optional)</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What's this meeting about?"
                  rows={2}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #D1D5DB', fontSize: '13px', boxSizing: 'border-box', outline: 'none', resize: 'vertical', fontFamily: 'inherit' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#4B5563', marginBottom: '4px' }}>Custom meeting ID (optional)</label>
                <input
                  type="text"
                  value={customId}
                  onChange={(e) => setCustomId(e.target.value)}
                  placeholder="e.g. sprint-standup"
                  style={{ width: '100%', height: '42px', padding: '0 12px', borderRadius: '8px', border: '1px solid #D1D5DB', fontSize: '13px', boxSizing: 'border-box', outline: 'none' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#4B5563', marginBottom: '4px' }}>Repeat</label>
                <select
                  value={recurrence}
                  onChange={(e) => setRecurrence(e.target.value as any)}
                  style={{ width: '100%', height: '42px', padding: '0 10px', borderRadius: '8px', border: '1px solid #D1D5DB', fontSize: '13px', boxSizing: 'border-box', outline: 'none', background: '#fff' }}
                >
                  {RECURRENCE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {recurrence !== 'NONE' && (
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#4B5563', marginBottom: '4px' }}>Repeat until (optional, max 12 occurrences without one)</label>
                  <input
                    type="date"
                    value={recurrenceUntil}
                    onChange={(e) => setRecurrenceUntil(e.target.value)}
                    style={{ width: '100%', height: '42px', padding: '0 12px', borderRadius: '8px', border: '1px solid #D1D5DB', fontSize: '13px', boxSizing: 'border-box', outline: 'none' }}
                  />
                </div>
              )}

              {scheduleError && (
                <div style={{ padding: '10px 12px', borderRadius: '8px', background: '#FEF2F2', border: '1px solid #FECACA', color: '#DC2626', fontSize: '12px' }}>
                  {scheduleError}
                </div>
              )}

              <button
                onClick={handleSchedule}
                disabled={!name.trim() || submitting}
                style={{
                  marginTop: '4px',
                  height: '46px',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: submitted ? '#10B981' : !name.trim() || submitting ? '#C7D2FE' : '#4F46E5',
                  color: '#FFFFFF',
                  fontSize: '14px',
                  fontWeight: 700,
                  cursor: !name.trim() || submitting ? 'not-allowed' : 'pointer',
                  transition: 'background-color 0.15s ease',
                }}
              >
                {submitted ? 'Scheduled ✓' : submitting ? 'Scheduling...' : 'Schedule Meeting'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Scheduled Meeting Preview Modal Card (matches reference screenshot) */}
      <ScheduledMeetingCardModal
        isOpen={isModalOpen}
        meeting={modalMeeting}
        onClose={() => setIsModalOpen(false)}
        onEdit={(mtg) => {
          if (mtg.scheduledAt) {
            const d = new Date(mtg.scheduledAt);
            setSelectedDate(d);
            setTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
          }
          setName(mtg.name);
          setDuration(mtg.durationMinutes || 30);
          setType((mtg.type as any) || 'Personal');
          setDescription(mtg.description || '');
          setCustomId(mtg.roomSlug);
          setPasscode(mtg.passcode || '');
          setInviteesList((mtg.invitees || []).map((i) => i.email));
          setIsModalOpen(false);
        }}
        onMoreDetails={(mtg) => {
          if (onOpenDetails && mtg.id) {
            const found = meetings.find((m) => m.id === mtg.id || m.roomSlug === mtg.roomSlug);
            if (found) {
              setIsModalOpen(false);
              onOpenDetails(found);
              return;
            }
          }
          window.open(mtg.meetingUrl, '_blank');
        }}
        onDelete={onDeleteMeeting && modalMeeting?.id ? () => onDeleteMeeting(modalMeeting.id!) : undefined}
      />

      {/* Google Meet style Share Joining Info Modal */}
      <ShareMeetingModal
        isOpen={!!shareModalMeeting}
        onClose={() => setShareModalMeeting(null)}
        meeting={shareModalMeeting}
      />
    </div>
  );
}

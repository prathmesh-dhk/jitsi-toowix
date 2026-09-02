import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarPlus, Copy, Edit3, Eye, LogOut, Search, SlidersHorizontal, Trash2, Users, Video, Calendar as CalendarIcon, Clock, MoreVertical, Plus, X } from 'lucide-react';
import { auth } from '../lib/firebase';
import { ActionMenu, IActionMenuItem } from './ActionMenu';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000';

export interface IUpcomingMeeting {
  id: string;
  name: string;
  type: 'Internal' | 'Guest' | 'Private';
  organizer: string;
  organizerInitials: string;
  scheduledAtIso: string;
  durationMinutes: number | null;
  roomSlug: string;
  organizerEmail?: string;
  canManage: boolean;
  isInvitedParticipant?: boolean;
}

interface IUpcomingMeetingsPanelProps {
  meetings: IUpcomingMeeting[];
  onJoinWithCode: () => void;
  onNewMeeting: () => void;
  onMeetingsChanged?: () => void;
}

type QuickFilter = 'All' | 'Today' | 'This week' | 'Later';

const formatDateTime = (iso: string): string => {
  const date = new Date(iso);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (isToday) return `Today, ${time}`;
  return `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}, ${time}`;
};

const formatDuration = (minutes: number | null): string => {
  if (!minutes) return 'Instant';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return m > 0 ? `${h} hr ${m} min` : `${h} hr`;
  return `${m} min`;
};

const formatStartsIn = (iso: string): string => {
  const diffMs = new Date(iso).getTime() - Date.now();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin <= 0) return 'Starting now';
  if (diffMin < 60) return `Starts in ${diffMin} minute${diffMin === 1 ? '' : 's'}`;
  const diffHr = Math.round(diffMin / 60);
  return `Starts in ${diffHr} hour${diffHr === 1 ? '' : 's'}`;
};

export function UpcomingMeetingsPanel({ meetings, onJoinWithCode, onNewMeeting, onMeetingsChanged }: IUpcomingMeetingsPanelProps) {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('All');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [selectedMeeting, setSelectedMeeting] = useState<IUpcomingMeeting | null>(null);

  const meetingUrl = (meeting: IUpcomingMeeting) => `${window.location.origin}/meet/${meeting.roomSlug}`;
  const copyText = (text: string) => navigator.clipboard.writeText(text);

  const addToCalendar = (meeting: IUpcomingMeeting) => {
    const start = new Date(meeting.scheduledAtIso);
    const end = new Date(start.getTime() + (meeting.durationMinutes || 60) * 60000);
    const icsDate = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const content = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', `UID:${meeting.id}@toowix`, `DTSTART:${icsDate(start)}`, `DTEND:${icsDate(end)}`, `SUMMARY:${meeting.name}`, `DESCRIPTION:Join Toowix meeting: ${meetingUrl(meeting)}`, `URL:${meetingUrl(meeting)}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${meeting.roomSlug}.ics`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const editMeeting = async (meeting: IUpcomingMeeting) => {
    const name = window.prompt('Meeting name', meeting.name)?.trim();
    if (!name || name === meeting.name) return;
    const token = await auth.currentUser?.getIdToken();
    if (!token) return;
    const response = await fetch(`${BACKEND_URL}/api/meetings/${meeting.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ name }) });
    if (!response.ok) window.alert('Could not update the meeting.');
    else onMeetingsChanged?.();
  };

  const cancelMeeting = async (meeting: IUpcomingMeeting) => {
    if (!window.confirm(`Cancel “${meeting.name}”?`)) return;
    const token = await auth.currentUser?.getIdToken();
    if (!token) return;
    const response = await fetch(`${BACKEND_URL}/api/meetings/${meeting.id}/cancel`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) window.alert('Could not cancel the meeting.');
    else onMeetingsChanged?.();
  };

  const menuItems = (meeting: IUpcomingMeeting): IActionMenuItem[] => {
    const startsInMs = new Date(meeting.scheduledAtIso).getTime() - Date.now();
    const isStartingSoon = startsInMs <= 15 * 60 * 1000;
    return [
      { label: 'View meeting details', icon: <Eye size={15} />, onClick: () => setSelectedMeeting(meeting) },
      { label: 'Copy meeting link', icon: <Copy size={15} />, onClick: () => copyText(meetingUrl(meeting)) },
      { label: 'Copy meeting code', icon: <Copy size={15} />, onClick: () => copyText(meeting.roomSlug) },
      { label: 'Add to calendar', icon: <CalendarPlus size={15} />, onClick: () => addToCalendar(meeting) },
      ...(meeting.canManage ? [
        { label: 'Edit meeting', icon: <Edit3 size={15} />, onClick: () => editMeeting(meeting) },
        { label: 'Manage participants', icon: <Users size={15} />, onClick: () => setSelectedMeeting(meeting) },
        { label: 'Start meeting', icon: <Video size={15} />, onClick: () => navigate(`/meet/${meeting.roomSlug}`) },
        { label: 'Cancel meeting', icon: <Trash2 size={15} />, destructive: true, separated: true, onClick: () => cancelMeeting(meeting) },
      ] : []),
      ...(meeting.isInvitedParticipant ? [{ label: 'Leave meeting', icon: <LogOut size={15} />, destructive: true, separated: true, onClick: () => window.alert('You have left this meeting invitation.') }] : []),
      ...(isStartingSoon ? [{ label: 'Join Meeting', icon: <Video size={15} />, onClick: () => navigate(`/meet/${meeting.roomSlug}`) }] : []),
    ];
  };

  const sorted = useMemo(
    () => [...meetings].sort((a, b) => new Date(a.scheduledAtIso).getTime() - new Date(b.scheduledAtIso).getTime()),
    [meetings]
  );

  const nextMeeting = sorted[0] || null;
  const laterMeetings = sorted.slice(1);

  const filtered = useMemo(() => {
    // Mutually exclusive buckets so switching tabs always visibly changes the result:
    // Today = today's calendar date. This week = tomorrow through end of this calendar
    // week (excludes today). Later = everything after that.
    const now = new Date();
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    const endOfWeek = new Date(now);
    endOfWeek.setDate(now.getDate() + (7 - now.getDay()));
    endOfWeek.setHours(23, 59, 59, 999);

    return laterMeetings.filter((m) => {
      const matchesSearch =
        m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.organizer.toLowerCase().includes(searchQuery.toLowerCase());
      if (!matchesSearch) return false;

      const start = new Date(m.scheduledAtIso);
      if (quickFilter === 'Today') return start.toDateString() === now.toDateString();
      if (quickFilter === 'This week') return start > endOfToday && start <= endOfWeek;
      if (quickFilter === 'Later') return start > endOfWeek;
      return true;
    });
  }, [laterMeetings, searchQuery, quickFilter]);

  const filterTabs: QuickFilter[] = ['All', 'Today', 'This week', 'Later'];
  const totalCount = meetings.length;
  const nextStartsSoon = nextMeeting ? new Date(nextMeeting.scheduledAtIso).getTime() - Date.now() <= 15 * 60 * 1000 : false;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '26px', fontWeight: 800, color: '#141B2B', letterSpacing: '-0.5px', margin: '0 0 6px 0' }}>Upcoming Meetings</h1>
          <p style={{ fontSize: '14px', color: '#6B7280', margin: 0 }}>View and manage your scheduled meetings.</p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={onJoinWithCode}
            style={{ height: '40px', padding: '0 18px', borderRadius: '8px', border: '1px solid #4F46E5', background: '#FFFFFF', color: '#4F46E5', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
          >
            Join with code
          </button>
          <button
            onClick={onNewMeeting}
            style={{ height: '40px', padding: '0 18px', borderRadius: '8px', border: 'none', background: '#4F46E5', color: '#FFFFFF', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', boxShadow: '0 2px 4px rgba(79, 70, 229, 0.25)' }}
          >
            <Plus size={15} />
            New Meeting
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '22px', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', gap: '20px' }}>
          {filterTabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setQuickFilter(tab)}
              style={{
                background: 'transparent',
                border: 'none',
                borderBottom: quickFilter === tab ? '2px solid #4F46E5' : '2px solid transparent',
                paddingBottom: '8px',
                color: quickFilter === tab ? '#4F46E5' : '#6B7280',
                fontSize: '14px',
                fontWeight: quickFilter === tab ? 700 : 500,
                cursor: 'pointer',
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <div style={{ position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#9CA3AF' }} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search upcoming meetings..."
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

      {/* Next meeting hero */}
      {nextMeeting && (
        <>
          <h2 style={{ fontSize: '15px', fontWeight: 700, color: '#141B2B', margin: '0 0 10px 0' }}>Next meeting</h2>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '18px',
              backgroundColor: '#FFFFFF',
              border: '1px solid #E5E7EB',
              borderLeft: '4px solid #4F46E5',
              borderRadius: '12px',
              padding: '18px 20px',
              marginBottom: '28px',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ width: '46px', height: '46px', borderRadius: '10px', backgroundColor: '#EEF2FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Video size={20} color="#4F46E5" />
            </div>

            <div style={{ minWidth: '200px' }}>
              <div style={{ fontSize: '17px', fontWeight: 700, color: '#141B2B', marginBottom: '4px' }}>{nextMeeting.name}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#6B7280', marginBottom: '2px' }}>
                <CalendarIcon size={13} />
                {formatDateTime(nextMeeting.scheduledAtIso)}
                {nextMeeting.durationMinutes ? ` – ${new Date(new Date(nextMeeting.scheduledAtIso).getTime() + nextMeeting.durationMinutes * 60000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : ''}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#4F46E5', fontWeight: 600 }}>
                <Clock size={13} />
                {formatStartsIn(nextMeeting.scheduledAtIso)}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginLeft: '10px' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: '#EEF2FF', color: '#4F46E5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700 }}>
                {nextMeeting.organizerInitials}
              </div>
              <div>
                <div style={{ fontSize: '11px', color: '#9CA3AF' }}>Organized by</div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#141B2B' }}>{nextMeeting.organizer}</div>
              </div>
            </div>

            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button
                onClick={() => nextStartsSoon ? navigate(`/meet/${nextMeeting.roomSlug}`) : setSelectedMeeting(nextMeeting)}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', height: '42px', padding: '0 22px', borderRadius: '8px', border: 'none', background: '#4F46E5', color: '#FFFFFF', fontSize: '14px', fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 4px rgba(79, 70, 229, 0.25)' }}
              >
                {nextStartsSoon ? <Video size={16} /> : <Eye size={16} />}
                {nextStartsSoon ? 'Join Meeting' : 'View details'}
              </button>
              <div style={{ position: 'relative' }}>
                <button type="button" aria-label={`Actions for ${nextMeeting.name}`} onClick={() => setOpenMenuId(openMenuId === nextMeeting.id ? null : nextMeeting.id)} style={{ width: '38px', height: '38px', borderRadius: '8px', border: '1px solid #E5E7EB', background: '#FFFFFF', color: '#6B7280', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                  <MoreVertical size={16} />
                </button>
                {openMenuId === nextMeeting.id && <ActionMenu items={menuItems(nextMeeting)} onClose={() => setOpenMenuId(null)} />}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Later table */}
      <h2 style={{ fontSize: '15px', fontWeight: 700, color: '#141B2B', margin: '0 0 10px 0' }}>Later</h2>
      <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '12px', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '760px' }}>
            <thead>
              <tr style={{ backgroundColor: '#F9FAFB', borderBottom: '1px solid #E5E7EB' }}>
                <th style={{ textAlign: 'left', padding: '12px 18px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', color: '#6B7280' }}>MEETING</th>
                <th style={{ textAlign: 'left', padding: '12px 18px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', color: '#6B7280' }}>ORGANIZED BY</th>
                <th style={{ textAlign: 'left', padding: '12px 18px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', color: '#6B7280' }}>DATE &amp; TIME</th>
                <th style={{ textAlign: 'left', padding: '12px 18px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', color: '#6B7280' }}>DURATION</th>
                <th style={{ textAlign: 'right', padding: '12px 18px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', color: '#6B7280' }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: '32px 18px', textAlign: 'center', fontSize: '13px', color: '#9CA3AF' }}>
                    No other upcoming meetings{searchQuery || quickFilter !== 'All' ? ' match this filter' : ''}.
                  </td>
                </tr>
              )}
              {filtered.map((m) => {
                const startsSoonMs = new Date(m.scheduledAtIso).getTime() - Date.now();
                const canJoinNow = startsSoonMs <= 15 * 60 * 1000;
                return (
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
                    <td style={{ padding: '14px 18px', fontSize: '13px', color: '#4B5563', whiteSpace: 'nowrap' }}>{formatDateTime(m.scheduledAtIso)}</td>
                    <td style={{ padding: '14px 18px', fontSize: '13px', color: '#4B5563', whiteSpace: 'nowrap' }}>{formatDuration(m.durationMinutes)}</td>
                    <td style={{ padding: '14px 18px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
                        <button
                          onClick={() => canJoinNow ? navigate(`/meet/${m.roomSlug}`) : setSelectedMeeting(m)}
                          style={{ padding: '6px 14px', borderRadius: '6px', border: '1px solid #C7D2FE', backgroundColor: '#FFFFFF', color: '#4F46E5', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                        >
                          {canJoinNow ? 'Join' : 'View'}
                        </button>
                        <div style={{ position: 'relative' }}>
                          <button type="button" aria-label={`Actions for ${m.name}`} onClick={() => setOpenMenuId(openMenuId === m.id ? null : m.id)} style={{ width: '30px', height: '30px', borderRadius: '6px', border: '1px solid #E5E7EB', backgroundColor: '#FFFFFF', color: '#6B7280', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                            <MoreVertical size={14} />
                          </button>
                          {openMenuId === m.id && <ActionMenu items={menuItems(m)} onClose={() => setOpenMenuId(null)} />}
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ padding: '14px 18px' }}>
          <span style={{ fontSize: '13px', color: '#6B7280' }}>
            {totalCount === 0 ? 'No upcoming meetings' : `Showing ${Math.min(filtered.length, laterMeetings.length)} of ${totalCount} meetings`}
          </span>
        </div>
      </div>
      {selectedMeeting && (
        <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, zIndex: 900, background: 'rgba(15,23,42,.35)' }} onMouseDown={(event) => event.target === event.currentTarget && setSelectedMeeting(null)}>
          <aside style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(460px, 94vw)', background: '#FFFFFF', boxShadow: '-10px 0 30px rgba(15,23,42,.18)', padding: '24px', boxSizing: 'border-box' }}>
            <button type="button" aria-label="Close details" onClick={() => setSelectedMeeting(null)} style={{ position: 'absolute', top: '18px', right: '18px', width: '34px', height: '34px', border: '1px solid #E5E7EB', borderRadius: '8px', background: '#FFFFFF', display: 'grid', placeItems: 'center', cursor: 'pointer' }}><X size={17} /></button>
            <div style={{ fontSize: '12px', color: '#6B7280' }}>Upcoming meeting</div>
            <h2 style={{ fontSize: '21px', color: '#111827', margin: '5px 50px 22px 0' }}>{selectedMeeting.name}</h2>
            {[
              ['Meeting code', selectedMeeting.roomSlug],
              ['Type', `${selectedMeeting.type === 'Guest' ? 'External' : selectedMeeting.type} meeting`],
              ['Scheduled', formatDateTime(selectedMeeting.scheduledAtIso)],
              ['Duration', formatDuration(selectedMeeting.durationMinutes)],
              ['Organizer', selectedMeeting.organizer],
              ['Organizer email', selectedMeeting.organizerEmail || 'Not available'],
              ['Meeting link', meetingUrl(selectedMeeting)],
            ].map(([label, value]) => <div key={label} style={{ padding: '12px 0', borderBottom: '1px solid #F3F4F6' }}><div style={{ fontSize: '11px', color: '#6B7280', textTransform: 'uppercase' }}>{label}</div><div style={{ fontSize: '13px', color: '#111827', fontWeight: 600, marginTop: '3px', overflowWrap: 'anywhere' }}>{value}</div></div>)}
            <div style={{ marginTop: '22px', padding: '14px', borderRadius: '9px', background: '#F9FAFB', color: '#6B7280', fontSize: '13px' }}>Participant management will show invited attendees as invitations are added to this meeting.</div>
          </aside>
        </div>
      )}
    </div>
  );
}

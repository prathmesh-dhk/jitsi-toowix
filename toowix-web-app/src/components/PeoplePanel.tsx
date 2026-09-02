import React, { useMemo, useState } from 'react';
import { Search, SlidersHorizontal, Upload, Calendar as CalendarIcon, X, Users, Download } from 'lucide-react';

interface IParticipant {
  name: string;
  email: string;
  avatarUrl?: string;
  role: string;
  joinedAt?: string;
  leftAt?: string;
  timeSpent?: string;
  attendanceStatus?: string;
}

export interface IAttendanceMeeting {
  id: string;
  name: string;
  organizer: string;
  organizerEmail?: string;
  dateTime: string;
  refDateIso: string;
  participants?: IParticipant[];
}

interface IPeoplePanelProps {
  meetings: IAttendanceMeeting[];
}

type Tab = 'All meetings' | 'With guests' | 'Internal only';

const meetingCode = (id: string) => `MTG-${id.slice(-4).toUpperCase()}`;

const initialsOf = (name: string) =>
  name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';

const domainOf = (email?: string) => (email ? email.split('@')[1]?.toLowerCase() : undefined);

const splitParticipants = (meeting: IAttendanceMeeting) => {
  const companyDomain = domainOf(meeting.organizerEmail);
  const all = meeting.participants || [];
  const internal = all.filter((p) => !companyDomain || domainOf(p.email) === companyDomain);
  const guests = all.filter((p) => companyDomain && domainOf(p.email) !== companyDomain);
  return { internal, guests };
};

function AvatarStack({ people, max = 4 }: { people: IParticipant[]; max?: number }) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  if (people.length === 0) return <span style={{ fontSize: '12px', color: '#9CA3AF' }}>—</span>;
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {shown.map((p, idx) => (
        <div
          key={idx}
          title={p.name}
          style={{
            width: '26px',
            height: '26px',
            borderRadius: '50%',
            backgroundColor: '#EEF2FF',
            color: '#4F46E5',
            border: '2px solid #FFFFFF',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '10px',
            fontWeight: 700,
            marginLeft: idx === 0 ? 0 : '-8px',
          }}
        >
          {initialsOf(p.name)}
        </div>
      ))}
      {extra > 0 && (
        <div style={{ width: '26px', height: '26px', borderRadius: '50%', backgroundColor: '#F3F4F6', color: '#6B7280', border: '2px solid #FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 700, marginLeft: '-8px' }}>
          +{extra}
        </div>
      )}
    </div>
  );
}

function csvEscape(value: string) {
  return `"${(value || '').replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, rows: string[][]) {
  const content = rows.map((r) => r.map(csvEscape).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function PeoplePanel({ meetings }: IPeoplePanelProps) {
  const [tab, setTab] = useState<Tab>('All meetings');
  const [searchQuery, setSearchQuery] = useState('');
  const [selected, setSelected] = useState<IAttendanceMeeting | null>(null);
  const [drawerTab, setDrawerTab] = useState<'Guests' | 'Internal'>('Guests');

  const rows = useMemo(() => {
    return meetings
      .map((m) => {
        const { internal, guests } = splitParticipants(m);
        return { meeting: m, internal, guests, total: internal.length + guests.length };
      })
      .filter((r) => {
        const matchesSearch =
          r.meeting.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          meetingCode(r.meeting.id).toLowerCase().includes(searchQuery.toLowerCase());
        if (!matchesSearch) return false;
        if (tab === 'With guests') return r.guests.length > 0;
        if (tab === 'Internal only') return r.guests.length === 0;
        return true;
      })
      .sort((a, b) => new Date(b.meeting.refDateIso).getTime() - new Date(a.meeting.refDateIso).getTime());
  }, [meetings, searchQuery, tab]);

  const exportReport = () => {
    const csvRows: string[][] = [['Meeting', 'Meeting ID', 'Date & Time', 'Name', 'Email', 'Role', 'Type', 'Joined', 'Left', 'Duration', 'Status']];
    rows.forEach(({ meeting, internal, guests }) => {
      [...internal.map((p) => ({ ...p, kind: 'Internal' })), ...guests.map((p) => ({ ...p, kind: 'Guest' }))].forEach((p) => {
        csvRows.push([meeting.name, meetingCode(meeting.id), meeting.dateTime, p.name, p.email, p.role, p.kind, p.joinedAt || '', p.leftAt || '', p.timeSpent || '', p.attendanceStatus || '']);
      });
      if ((internal.length + guests.length) === 0) {
        csvRows.push([meeting.name, meetingCode(meeting.id), meeting.dateTime, '', '', '', '', '', '', '', 'No attendance recorded']);
      }
    });
    downloadCsv('meeting-attendance.csv', csvRows);
  };

  const downloadMeetingAttendance = (r: { meeting: IAttendanceMeeting; internal: IParticipant[]; guests: IParticipant[] }) => {
    const csvRows: string[][] = [['Name', 'Email', 'Role', 'Type', 'Joined', 'Left', 'Duration', 'Status']];
    [...r.internal.map((p) => ({ ...p, kind: 'Internal' })), ...r.guests.map((p) => ({ ...p, kind: 'Guest' }))].forEach((p) => {
      csvRows.push([p.name, p.email, p.role, p.kind, p.joinedAt || '', p.leftAt || '', p.timeSpent || '', p.attendanceStatus || '']);
    });
    downloadCsv(`${meetingCode(r.meeting.id)}-attendance.csv`, csvRows);
  };

  const tabs: Tab[] = ['All meetings', 'With guests', 'Internal only'];
  const selectedRow = selected ? rows.find((r) => r.meeting.id === selected.id) : null;
  const drawerPeople = selectedRow ? (drawerTab === 'Guests' ? selectedRow.guests : selectedRow.internal) : [];

  return (
    <div>
      <div>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h1 style={{ fontSize: '26px', fontWeight: 800, color: '#141B2B', letterSpacing: '-0.5px', margin: '0 0 6px 0' }}>Meeting Attendance</h1>
            <p style={{ fontSize: '14px', color: '#6B7280', margin: 0 }}>See who joined each meeting, including internal members and external guests.</p>
          </div>
          <button
            onClick={exportReport}
            style={{ height: '40px', padding: '0 16px', borderRadius: '8px', border: '1px solid #4F46E5', background: '#FFFFFF', color: '#4F46E5', fontSize: '13px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
          >
            <Upload size={15} />
            Export report
          </button>
        </div>

        <div style={{ display: 'flex', gap: '20px', marginBottom: '18px', borderBottom: '1px solid #E5E7EB' }}>
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{ background: 'transparent', border: 'none', borderBottom: tab === t ? '2px solid #4F46E5' : '2px solid transparent', paddingBottom: '10px', color: tab === t ? '#4F46E5' : '#6B7280', fontSize: '14px', fontWeight: tab === t ? 700 : 500, cursor: 'pointer' }}
            >
              {t}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px', flexWrap: 'wrap' }}>
          <button style={{ height: '40px', padding: '0 14px', borderRadius: '8px', border: '1px solid #D1D5DB', background: '#FFFFFF', color: '#374151', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <CalendarIcon size={15} />
            All dates
          </button>
          <div style={{ position: 'relative', flex: 1, minWidth: '220px' }}>
            <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#9CA3AF' }} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by meeting name or ID..."
              style={{ width: '100%', height: '40px', paddingLeft: '36px', paddingRight: '14px', borderRadius: '8px', border: '1px solid #D1D5DB', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
          <button style={{ height: '40px', padding: '0 16px', borderRadius: '8px', border: '1px solid #D1D5DB', background: '#FFFFFF', color: '#374151', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <SlidersHorizontal size={15} />
            Filter
          </button>
        </div>

        <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '12px', overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '820px' }}>
              <thead>
                <tr style={{ backgroundColor: '#F9FAFB', borderBottom: '1px solid #E5E7EB' }}>
                  <th style={{ textAlign: 'left', padding: '12px 18px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', color: '#6B7280' }}>MEETING</th>
                  <th style={{ textAlign: 'left', padding: '12px 18px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', color: '#6B7280' }}>MEETING ID</th>
                  <th style={{ textAlign: 'left', padding: '12px 18px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', color: '#6B7280' }}>DATE &amp; TIME</th>
                  <th style={{ textAlign: 'left', padding: '12px 18px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', color: '#6B7280' }}>INTERNAL PEOPLE</th>
                  <th style={{ textAlign: 'left', padding: '12px 18px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', color: '#6B7280' }}>GUEST PEOPLE</th>
                  <th style={{ textAlign: 'left', padding: '12px 18px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', color: '#6B7280' }}>TOTAL</th>
                  <th style={{ textAlign: 'right', padding: '12px 18px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', color: '#6B7280' }}>DETAILS</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ padding: '32px 18px', textAlign: 'center', fontSize: '13px', color: '#9CA3AF' }}>
                      No meetings match this view.
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr key={r.meeting.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                    <td style={{ padding: '14px 18px', fontSize: '14px', fontWeight: 700, color: '#141B2B', whiteSpace: 'nowrap' }}>{r.meeting.name}</td>
                    <td style={{ padding: '14px 18px', fontSize: '13px', color: '#6B7280', whiteSpace: 'nowrap' }}>{meetingCode(r.meeting.id)}</td>
                    <td style={{ padding: '14px 18px', fontSize: '13px', color: '#4B5563', whiteSpace: 'nowrap' }}>{r.meeting.dateTime}</td>
                    <td style={{ padding: '14px 18px' }}>
                      <AvatarStack people={r.internal} />
                      <div style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '4px' }}>{r.internal.length} internal</div>
                    </td>
                    <td style={{ padding: '14px 18px', fontSize: '13px', color: '#4B5563', whiteSpace: 'nowrap' }}>
                      {r.guests.length > 0 ? `${r.guests.length} guest${r.guests.length === 1 ? '' : 's'}` : '—'}
                    </td>
                    <td style={{ padding: '14px 18px', fontSize: '13px', fontWeight: 700, color: '#141B2B' }}>{r.total}</td>
                    <td style={{ padding: '14px 18px', textAlign: 'right' }}>
                      <button
                        onClick={() => { setSelected(r.meeting); setDrawerTab(r.guests.length > 0 ? 'Guests' : 'Internal'); }}
                        style={{ padding: '6px 14px', borderRadius: '6px', border: '1px solid #C7D2FE', backgroundColor: '#FFFFFF', color: '#4F46E5', fontSize: '12px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                      >
                        View details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '14px 18px' }}>
            <span style={{ fontSize: '13px', color: '#6B7280' }}>Showing 1–{rows.length} of {rows.length} meetings</span>
          </div>
        </div>
      </div>

      {selectedRow && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${selectedRow.meeting.name} attendance`}
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15, 23, 42, 0.38)' }}
          onMouseDown={(event) => event.target === event.currentTarget && setSelected(null)}
        >
          <aside style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(480px, 94vw)', background: '#FFFFFF', boxShadow: '-12px 0 36px rgba(15, 23, 42, 0.18)', display: 'flex', flexDirection: 'column' }}>
            <header style={{ padding: '20px 24px', borderBottom: '1px solid #E5E7EB', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px' }}>
              <div>
                <div style={{ fontSize: '12px', color: '#6B7280', marginBottom: '5px' }}>Meeting attendance</div>
                <h2 style={{ margin: 0, fontSize: '20px', color: '#111827' }}>{selectedRow.meeting.name}</h2>
                <div style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '4px' }}>{meetingCode(selectedRow.meeting.id)}</div>
              </div>
              <button type="button" onClick={() => setSelected(null)} aria-label="Close" style={{ width: '34px', height: '34px', border: '1px solid #E5E7EB', borderRadius: '8px', background: '#FFFFFF', color: '#6B7280', display: 'grid', placeItems: 'center', cursor: 'pointer', flexShrink: 0 }}>
                <X size={17} />
              </button>
            </header>

            <div style={{ overflowY: 'auto', padding: '20px 24px', flex: 1 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px', color: '#4B5563', marginBottom: '18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <CalendarIcon size={14} color="#9CA3AF" />
                  {selectedRow.meeting.dateTime}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Users size={14} color="#9CA3AF" />
                  {selectedRow.total} participants · {selectedRow.internal.length} internal · {selectedRow.guests.length} guest{selectedRow.guests.length === 1 ? '' : 's'}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '18px', borderBottom: '1px solid #E5E7EB' }}>
                <button onClick={() => setDrawerTab('Guests')} style={{ background: 'transparent', border: 'none', borderBottom: drawerTab === 'Guests' ? '2px solid #4F46E5' : '2px solid transparent', paddingBottom: '8px', color: drawerTab === 'Guests' ? '#4F46E5' : '#6B7280', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                  Guests ({selectedRow.guests.length})
                </button>
                <button onClick={() => setDrawerTab('Internal')} style={{ background: 'transparent', border: 'none', borderBottom: drawerTab === 'Internal' ? '2px solid #4F46E5' : '2px solid transparent', paddingBottom: '8px', color: drawerTab === 'Internal' ? '#4F46E5' : '#6B7280', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                  Internal ({selectedRow.internal.length})
                </button>
              </div>

              <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {drawerPeople.length === 0 && (
                  <div style={{ padding: '18px', border: '1px dashed #D1D5DB', borderRadius: '10px', color: '#6B7280', fontSize: '13px', textAlign: 'center' }}>
                    No {drawerTab === 'Guests' ? 'guest' : 'internal'} attendance recorded for this meeting.
                  </div>
                )}
                {drawerPeople.map((p, idx) => (
                  <div key={idx} style={{ border: '1px solid #F3F4F6', borderRadius: '10px', padding: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      {p.avatarUrl ? (
                        <img src={p.avatarUrl} alt="" style={{ width: '34px', height: '34px', borderRadius: '50%', objectFit: 'cover' }} />
                      ) : (
                        <div style={{ width: '34px', height: '34px', borderRadius: '50%', backgroundColor: '#EEF2FF', color: '#4F46E5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700 }}>
                          {initialsOf(p.name)}
                        </div>
                      )}
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: '13px', fontWeight: 700, color: '#141B2B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                        <div style={{ fontSize: '11px', color: '#6B7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.email}</div>
                      </div>
                      <span style={{ fontSize: '11px', fontWeight: 600, color: '#4F46E5', backgroundColor: '#EEF2FF', padding: '2px 8px', borderRadius: '10px', whiteSpace: 'nowrap' }}>{p.role}</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '10px', fontSize: '12px', color: '#4B5563' }}>
                      <div><span style={{ color: '#9CA3AF' }}>Joined</span><div style={{ fontWeight: 600 }}>{p.joinedAt || 'Not tracked'}</div></div>
                      <div><span style={{ color: '#9CA3AF' }}>Left</span><div style={{ fontWeight: 600 }}>{p.leftAt || 'Not tracked'}</div></div>
                      <div><span style={{ color: '#9CA3AF' }}>Duration</span><div style={{ fontWeight: 600 }}>{p.timeSpent || 'Not tracked'}</div></div>
                      <div><span style={{ color: '#9CA3AF' }}>Status</span><div style={{ fontWeight: 600, color: p.attendanceStatus === 'Attended' ? '#15803D' : '#B45309' }}>{p.attendanceStatus || 'Unknown'}</div></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <footer style={{ padding: '15px 24px', borderTop: '1px solid #E5E7EB', background: '#FFFFFF' }}>
              <button
                onClick={() => downloadMeetingAttendance(selectedRow)}
                style={{ width: '100%', height: '42px', borderRadius: '8px', border: '1px solid #4F46E5', background: '#FFFFFF', color: '#4F46E5', fontSize: '13px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer' }}
              >
                <Download size={15} />
                Download attendance
              </button>
            </footer>
          </aside>
        </div>
      )}
    </div>
  );
}

import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Clock, Users, Video } from 'lucide-react';

export interface IScheduleMeeting {
  id: string;
  name: string;
  scheduledAt: string | null; // ISO
  roomSlug: string;
  type: 'Internal' | 'Guest' | 'Private';
}

interface IScheduleCalendarProps {
  meetings: IScheduleMeeting[];
  onSchedule: (data: {
    name: string;
    scheduledAt: string;
    durationMinutes: number;
    type: 'Internal' | 'Guest' | 'Private';
  }) => Promise<void>;
}

const DURATIONS = [15, 30, 45, 60, 90, 120];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function ScheduleCalendar({ meetings, onSchedule }: IScheduleCalendarProps) {
  const [viewDate, setViewDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [name, setName] = useState('');
  const [time, setTime] = useState('10:00');
  const [duration, setDuration] = useState(30);
  const [type, setType] = useState<'Internal' | 'Guest' | 'Private'>('Internal');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

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

  const openPanelForDate = (date: Date) => {
    setSelectedDate(date);
    setSubmitted(false);
    setName('');
    setTime('10:00');
    setDuration(30);
    setType('Internal');
  };

  const handleSchedule = async () => {
    if (!selectedDate || !name.trim() || submitting) return;
    setSubmitting(true);
    const [hh, mm] = time.split(':').map(Number);
    const scheduledAt = new Date(selectedDate);
    scheduledAt.setHours(hh, mm, 0, 0);

    try {
      await onSchedule({
        name: name.trim(),
        scheduledAt: scheduledAt.toISOString(),
        durationMinutes: duration,
        type,
      });
      setSubmitted(true);
      setTimeout(() => setSubmitted(false), 1800);
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

      <div style={{ display: 'flex', gap: '28px', alignItems: 'flex-start', position: 'relative', width: '100%', flexWrap: 'wrap' }}>
      {/* Calendar */}
      <div
        style={{
          flex: '1 1 690px',
          minWidth: '620px',
          backgroundColor: '#FFFFFF',
          borderRadius: '16px',
          border: '1px solid #E5E7EB',
          padding: '26px',
          boxShadow: '0 8px 24px rgba(15, 23, 42, 0.04)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '22px' }}>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#141B2B' }}>
            {viewDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </h2>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              onClick={() => setViewDate(new Date(year, month - 1, 1))}
              style={{ width: '32px', height: '32px', borderRadius: '8px', border: '1px solid #E5E7EB', background: '#FFFFFF', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => setViewDate(new Date())}
              style={{ padding: '0 12px', height: '32px', borderRadius: '8px', border: '1px solid #E5E7EB', background: '#FFFFFF', cursor: 'pointer', fontSize: '13px', fontWeight: 600, color: '#4B5563' }}
            >
              Today
            </button>
            <button
              onClick={() => setViewDate(new Date(year, month + 1, 1))}
              style={{ width: '32px', height: '32px', borderRadius: '8px', border: '1px solid #E5E7EB', background: '#FFFFFF', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <ChevronRight size={16} />
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
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '0.04em',
                color: '#6B7280',
                padding: '10px 0',
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
            gridAutoRows: '104px',
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
                  padding: '9px',
                  gap: '5px',
                  transition: 'background-color 0.12s ease',
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    fontSize: '14px',
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
                      style={{
                        display: 'block',
                        fontSize: '11px',
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
                      }}
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

      {/* Side Panel -- always visible, fixed width, defaults to today */}
      <div
        style={{
          width: '390px',
          flex: '0 1 390px',
        }}
      >
        <div
          style={{
            width: '100%',
            backgroundColor: '#FFFFFF',
            borderRadius: '16px',
            border: '1px solid #E5E7EB',
            boxShadow: '0 10px 25px -5px rgba(0,0,0,0.08)',
            padding: '26px',
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
                  <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', backgroundColor: '#F9FAFB', borderRadius: '8px' }}>
                    <Video size={14} color="#4F46E5" />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#141B2B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</div>
                      <div style={{ fontSize: '11px', color: '#6B7280' }}>
                        {m.scheduledAt && new Date(m.scheduledAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                ))}
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
                  placeholder="e.g. Sprint planning"
                  style={{ width: '100%', height: '44px', padding: '0 12px', borderRadius: '8px', border: '1px solid #D1D5DB', fontSize: '13px', boxSizing: 'border-box', outline: 'none' }}
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
                    style={{ width: '100%', height: '44px', padding: '0 10px', borderRadius: '8px', border: '1px solid #D1D5DB', fontSize: '13px', boxSizing: 'border-box', outline: 'none' }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#4B5563', marginBottom: '4px' }}>Duration</label>
                  <select
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value))}
                    style={{ width: '100%', height: '44px', padding: '0 10px', borderRadius: '8px', border: '1px solid #D1D5DB', fontSize: '13px', boxSizing: 'border-box', outline: 'none', background: '#fff' }}
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
                  style={{ width: '100%', height: '44px', padding: '0 10px', borderRadius: '8px', border: '1px solid #D1D5DB', fontSize: '13px', boxSizing: 'border-box', outline: 'none', background: '#fff' }}
                >
                  <option value="Internal">Internal</option>
                  <option value="Guest">Guest</option>
                  <option value="Private">Private</option>
                </select>
              </div>

              <button
                onClick={handleSchedule}
                disabled={!name.trim() || submitting}
                style={{
                  marginTop: '6px',
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
    </div>
  );
}

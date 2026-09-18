import { Link } from 'react-router-dom';
import { CalendarPlus, Link2Off, Video } from 'lucide-react';

export function MeetingLinkExpiredPage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        padding: '24px',
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#F8F9FA',
        color: '#202124',
        fontFamily: "'Google Sans', Roboto, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      <section
        aria-labelledby="meeting-link-expired-title"
        style={{
          width: '100%',
          maxWidth: '520px',
          padding: '42px 34px',
          boxSizing: 'border-box',
          textAlign: 'center',
          background: '#FFFFFF',
          border: '1px solid #E5E7EB',
          borderRadius: '24px',
          boxShadow: '0 12px 34px rgba(0, 0, 0, 0.08)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '18px' }}>
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#FFF4E5',
              color: '#D97706',
            }}
          >
            <Link2Off size={32} aria-hidden="true" />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '9px', marginBottom: '20px' }}>
          <Video size={21} color="#4F46E5" aria-hidden="true" />
          <span style={{ fontSize: '20px', fontWeight: 700 }}>
            Toowix <span style={{ color: '#4F46E5' }}>Meet</span>
          </span>
        </div>

        <h1 id="meeting-link-expired-title" style={{ margin: '0 0 12px', fontSize: '28px', lineHeight: 1.25 }}>
          This meeting link has expired
        </h1>
        <p style={{ margin: '0 auto 28px', maxWidth: '400px', color: '#5F6368', fontSize: '15px', lineHeight: 1.55 }}>
          This meeting no longer exists or the link is invalid. Please create a new meeting or ask the organizer for a new link.
        </p>

        <Link
          to="/"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '9px',
            minHeight: '44px',
            padding: '0 20px',
            borderRadius: '10px',
            background: '#4F46E5',
            color: '#FFFFFF',
            fontWeight: 700,
            textDecoration: 'none',
            boxShadow: '0 3px 10px rgba(79, 70, 229, 0.28)',
          }}
        >
          <CalendarPlus size={19} aria-hidden="true" />
          Create a new meeting
        </Link>
      </section>
    </main>
  );
}

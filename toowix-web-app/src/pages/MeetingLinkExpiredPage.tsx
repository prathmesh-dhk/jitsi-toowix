import { Link } from 'react-router-dom';
import { CalendarPlus } from 'lucide-react';

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
        background: 'var(--color-bg)',
        color: 'var(--color-text-primary)',
        fontFamily: 'var(--font-family)',
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
          background: 'var(--color-card)',
          border: '1px solid var(--color-card-border)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px', marginBottom: '30px' }}>
          <img
            src="/assets/toowix-logo.svg"
            alt="Toowix"
            style={{ width: '30px', height: '30px', objectFit: 'contain' }}
          />
          <span style={{ fontSize: '20px', fontWeight: 700, color: 'var(--color-text-primary)' }}>
            Toowix <span style={{ color: 'var(--color-primary)' }}>Meet</span>
          </span>
        </div>

        <h1
          id="meeting-link-expired-title"
          style={{ margin: '0 0 12px', fontSize: '28px', lineHeight: 1.25, color: 'var(--color-text-primary)' }}
        >
          This link has expired.
        </h1>
        <p
          style={{
            margin: '0 auto 28px',
            maxWidth: '400px',
            color: 'var(--color-text-secondary)',
            fontSize: '15px',
            lineHeight: 1.55,
          }}
        >
          Please create a new meeting or ask the organizer for a new link.
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
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-primary)',
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

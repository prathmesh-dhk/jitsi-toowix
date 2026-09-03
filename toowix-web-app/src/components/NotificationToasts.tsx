import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, Video, Users, Shield, AlertTriangle, X } from 'lucide-react';
import { auth } from '../lib/firebase';
import type { INotification } from './NotificationBell';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000';
const TOAST_DURATION_MS = 10000;
const POLL_INTERVAL_MS = 20000;

const categoryIcon = (category: INotification['category']) => {
  switch (category) {
    case 'MEETINGS': return <Calendar size={16} />;
    case 'RECORDINGS': return <Video size={16} />;
    case 'PEOPLE_TEAMS': return <Users size={16} />;
    case 'SECURITY': return <Shield size={16} />;
    default: return <AlertTriangle size={16} />;
  }
};

/** Polls for new notifications and pops a top-right toast for each one that's new
 * since the last check, auto-dismissing after 10 seconds. Runs once, mounted at the
 * dashboard root, independent of whether the bell dropdown is open. */
export function NotificationToasts() {
  const navigate = useNavigate();
  const [toasts, setToasts] = useState<INotification[]>([]);
  const seenIds = useRef<Set<string>>(new Set());
  const firstLoad = useRef(true);

  useEffect(() => {
    const poll = async () => {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) return;
      try {
        const response = await fetch(`${BACKEND_URL}/api/notifications?unread=true`, {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const data = await response.json();
        if (!response.ok) return;
        const fresh: INotification[] = data.notifications || [];

        if (firstLoad.current) {
          // Don't toast the entire backlog on first mount -- only mark it seen.
          fresh.forEach((n) => seenIds.current.add(n.id));
          firstLoad.current = false;
          return;
        }

        const unseen = fresh.filter((n) => !seenIds.current.has(n.id));
        unseen.forEach((n) => seenIds.current.add(n.id));
        if (unseen.length > 0) {
          setToasts((prev) => [...unseen, ...prev].slice(0, 4));
          unseen.forEach((n) => {
            setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== n.id)), TOAST_DURATION_MS);
          });
        }
      } catch (e) {
        console.error('[NotificationToasts] Poll failed:', e);
      }
    };

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  const dismiss = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));

  const handleClick = (n: INotification) => {
    dismiss(n.id);
    if (n.actionUrl) navigate(n.actionUrl);
  };

  if (toasts.length === 0) return null;

  return (
    <div style={{ position: 'fixed', top: '76px', right: '20px', zIndex: 500, display: 'flex', flexDirection: 'column', gap: '10px', width: '320px' }}>
      {toasts.map((n) => (
        <div
          key={n.id}
          onClick={() => handleClick(n)}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px',
            padding: '14px',
            backgroundColor: '#131B2E',
            border: '1px solid #1E293B',
            borderRadius: '12px',
            boxShadow: '0 12px 30px rgba(0,0,0,0.35)',
            cursor: n.actionUrl ? 'pointer' : 'default',
            animation: 'toowix-toast-in 0.2s ease',
          }}
        >
          <div style={{ width: '30px', height: '30px', borderRadius: '8px', backgroundColor: 'rgba(79,70,229,0.2)', color: '#818CF8', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {categoryIcon(n.category)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#F9FAFB' }}>{n.title}</div>
            <div style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '2px' }}>{n.description}</div>
            {n.actionLabel && (
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#818CF8', marginTop: '6px' }}>{n.actionLabel} →</div>
            )}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); dismiss(n.id); }}
            style={{ background: 'transparent', border: 'none', color: '#6B7280', cursor: 'pointer', flexShrink: 0 }}
          >
            <X size={14} />
          </button>
        </div>
      ))}
      <style>{`@keyframes toowix-toast-in { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }`}</style>
    </div>
  );
}

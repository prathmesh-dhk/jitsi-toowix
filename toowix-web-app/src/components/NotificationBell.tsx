import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Calendar, Video, Users, Shield, AlertTriangle, Check } from 'lucide-react';
import { auth } from '../lib/firebase';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000';

export interface INotification {
  id: string;
  category: 'MEETINGS' | 'RECORDINGS' | 'PEOPLE_TEAMS' | 'SECURITY' | 'SYSTEM';
  type: string;
  title: string;
  description: string;
  relatedName?: string | null;
  actionLabel?: 'Join' | 'Review' | 'View' | 'Download' | null;
  actionUrl?: string | null;
  isRead: boolean;
  createdAt: string;
}

const CATEGORY_TABS: { key: string; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'MEETINGS', label: 'Meetings' },
  { key: 'RECORDINGS', label: 'Recordings' },
  { key: 'PEOPLE_TEAMS', label: 'People & Teams' },
  { key: 'SECURITY', label: 'Security' },
];

const categoryIcon = (category: INotification['category']) => {
  switch (category) {
    case 'MEETINGS': return <Calendar size={15} />;
    case 'RECORDINGS': return <Video size={15} />;
    case 'PEOPLE_TEAMS': return <Users size={15} />;
    case 'SECURITY': return <Shield size={15} />;
    default: return <AlertTriangle size={15} />;
  }
};

const categoryColor = (category: INotification['category']) => {
  switch (category) {
    case 'MEETINGS': return { bg: '#EEF2FF', fg: '#4F46E5' };
    case 'RECORDINGS': return { bg: '#FEF3E8', fg: '#D97706' };
    case 'PEOPLE_TEAMS': return { bg: '#ECFDF5', fg: '#059669' };
    case 'SECURITY': return { bg: '#FEF2F2', fg: '#DC2626' };
    default: return { bg: '#F3F4F6', fg: '#4B5563' };
  }
};

const timeAgo = (iso: string): string => {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
};

export function NotificationBell({ isDark }: { isDark: boolean }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('ALL');
  const [notifications, setNotifications] = useState<INotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = async (category?: string) => {
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) return;
    const query = category && category !== 'ALL' ? `?category=${category}` : '';
    const response = await fetch(`${BACKEND_URL}/api/notifications${query}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    const data = await response.json();
    if (response.ok) {
      setNotifications(data.notifications || []);
      setUnreadCount(data.unreadCount || 0);
    }
  };

  useEffect(() => {
    fetchNotifications(tab);
    const interval = setInterval(() => fetchNotifications(tab), 20000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    const closeOnOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutside);
    return () => document.removeEventListener('mousedown', closeOnOutside);
  }, []);

  const markRead = async (id: string) => {
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) return;
    await fetch(`${BACKEND_URL}/api/notifications/${id}/read`, { method: 'POST', headers: { Authorization: `Bearer ${idToken}` } });
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
  };

  const markAllRead = async () => {
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) return;
    await fetch(`${BACKEND_URL}/api/notifications/mark-all-read`, { method: 'POST', headers: { Authorization: `Bearer ${idToken}` } });
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
  };

  const handleAction = (n: INotification) => {
    if (!n.isRead) markRead(n.id);
    if (n.actionUrl) navigate(n.actionUrl);
    setOpen(false);
  };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          position: 'relative',
          width: '36px',
          height: '36px',
          borderRadius: '50%',
          backgroundColor: isDark ? '#1E293B' : '#F9FAFB',
          border: `1px solid ${isDark ? '#334155' : '#E5E7EB'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: isDark ? '#9CA3AF' : '#4B5563',
          cursor: 'pointer',
        }}
        title="Notifications"
      >
        <Bell size={17} />
        {unreadCount > 0 && (
          <span style={{ position: 'absolute', top: '4px', right: '4px', minWidth: '15px', height: '15px', padding: '0 3px', backgroundColor: '#EF4444', borderRadius: '8px', border: `2px solid ${isDark ? '#0E1526' : '#FFFFFF'}`, color: '#fff', fontSize: '9px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: '46px',
            right: 0,
            width: '380px',
            maxHeight: '520px',
            backgroundColor: isDark ? '#131B2E' : '#FFFFFF',
            border: `1px solid ${isDark ? '#1E293B' : '#E5E7EB'}`,
            borderRadius: '14px',
            boxShadow: '0 20px 45px rgba(15,23,42,0.25)',
            zIndex: 200,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ padding: '16px 18px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: isDark ? '#F9FAFB' : '#111827' }}>Meeting notifications</h3>
            <button onClick={markAllRead} style={{ background: 'transparent', border: 'none', color: '#4F46E5', fontSize: '12px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Check size={13} /> Mark all as read
            </button>
          </div>

          <div style={{ display: 'flex', gap: '4px', padding: '0 14px 10px', overflowX: 'auto' }}>
            {CATEGORY_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                style={{
                  padding: '5px 10px',
                  borderRadius: '14px',
                  border: `1px solid ${tab === t.key ? '#4F46E5' : isDark ? '#334155' : '#E5E7EB'}`,
                  background: tab === t.key ? (isDark ? 'rgba(79,70,229,0.2)' : '#EEF2FF') : 'transparent',
                  color: tab === t.key ? '#4F46E5' : isDark ? '#9CA3AF' : '#6B7280',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div style={{ overflowY: 'auto', flex: 1, borderTop: `1px solid ${isDark ? '#1E293B' : '#F3F4F6'}` }}>
            {notifications.length === 0 && (
              <div style={{ padding: '32px 18px', textAlign: 'center', fontSize: '13px', color: '#9CA3AF' }}>No notifications yet.</div>
            )}
            {notifications.map((n) => {
              const colors = categoryColor(n.category);
              return (
                <div
                  key={n.id}
                  onClick={() => !n.isRead && markRead(n.id)}
                  style={{
                    display: 'flex',
                    gap: '10px',
                    padding: '12px 18px',
                    borderBottom: `1px solid ${isDark ? '#1E293B' : '#F3F4F6'}`,
                    backgroundColor: n.isRead ? 'transparent' : (isDark ? 'rgba(79,70,229,0.06)' : '#FAFBFF'),
                    cursor: n.isRead ? 'default' : 'pointer',
                  }}
                >
                  <div style={{ width: '30px', height: '30px', borderRadius: '8px', backgroundColor: colors.bg, color: colors.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {categoryIcon(n.category)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 700, color: isDark ? '#F9FAFB' : '#111827' }}>{n.title}</span>
                      {!n.isRead && <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#4F46E5', flexShrink: 0 }} />}
                    </div>
                    <div style={{ fontSize: '12px', color: isDark ? '#9CA3AF' : '#6B7280', margin: '2px 0' }}>{n.description}</div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
                      <span style={{ fontSize: '11px', color: '#9CA3AF' }}>{n.relatedName ? `${n.relatedName} · ` : ''}{timeAgo(n.createdAt)}</span>
                      {n.actionLabel && n.actionUrl && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleAction(n); }}
                          style={{ fontSize: '11px', fontWeight: 700, color: '#4F46E5', background: 'transparent', border: 'none', cursor: 'pointer' }}
                        >
                          {n.actionLabel}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ padding: '10px 18px', borderTop: `1px solid ${isDark ? '#1E293B' : '#F3F4F6'}`, textAlign: 'center' }}>
            <button
              onClick={() => setOpen(false)}
              style={{ background: 'transparent', border: 'none', color: '#4F46E5', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
            >
              View all notifications
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

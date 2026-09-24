import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Bell, Calendar, Check, MessageSquare, Shield, Users, Video } from 'lucide-react';
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

const CATEGORY_TABS = [
  { key: 'ALL', label: 'All' }, { key: 'MEETINGS', label: 'Meetings' },
  { key: 'RECORDINGS', label: 'Recordings' }, { key: 'PEOPLE_TEAMS', label: 'People' },
  { key: 'SECURITY', label: 'Security' },
];

const timeAgo = (iso: string): string => {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} hr ago` : `${Math.floor(hours / 24)}d ago`;
};

function NotificationIcon({ notification }: { notification: INotification }) {
  if (notification.type === 'CHAT_MESSAGE') return <MessageSquare size={16} />;
  if (notification.category === 'MEETINGS') return <Calendar size={16} />;
  if (notification.category === 'RECORDINGS') return <Video size={16} />;
  if (notification.category === 'PEOPLE_TEAMS') return <Users size={16} />;
  if (notification.category === 'SECURITY') return <Shield size={16} />;
  return <AlertTriangle size={16} />;
}

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
    const response = await fetch(`${BACKEND_URL}/api/notifications${query}`, { headers: { 'X-Toowix-Session': localStorage.getItem('toowix_session_token') || '', Authorization: `Bearer ${idToken}` } });
    const data = await response.json().catch(() => ({}));
    if (response.ok) { setNotifications(data.notifications || []); setUnreadCount(data.unreadCount || 0); }
  };

  useEffect(() => {
    void fetchNotifications(tab);
    const interval = window.setInterval(() => void fetchNotifications(tab), 20_000);
    return () => window.clearInterval(interval);
  }, [tab]);

  useEffect(() => {
    const closeOnOutside = (event: MouseEvent) => { if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', closeOnOutside);
    return () => document.removeEventListener('mousedown', closeOnOutside);
  }, []);

  const markRead = async (id: string) => {
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) return;
    await fetch(`${BACKEND_URL}/api/notifications/${id}/read`, { method: 'POST', headers: { 'X-Toowix-Session': localStorage.getItem('toowix_session_token') || '', Authorization: `Bearer ${idToken}` } });
    setNotifications((previous) => previous.map((item) => item.id === id ? { ...item, isRead: true } : item));
    setUnreadCount((count) => Math.max(0, count - 1));
  };

  const markAllRead = async () => {
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) return;
    await fetch(`${BACKEND_URL}/api/notifications/mark-all-read`, { method: 'POST', headers: { 'X-Toowix-Session': localStorage.getItem('toowix_session_token') || '', Authorization: `Bearer ${idToken}` } });
    setNotifications((previous) => previous.map((item) => ({ ...item, isRead: true })));
    setUnreadCount(0);
  };

  const openNotification = (notification: INotification) => {
    if (!notification.isRead) void markRead(notification.id);
    if (notification.actionUrl) navigate(notification.actionUrl);
    setOpen(false);
  };

  return <div ref={containerRef} className="tm-notification-bell-wrap">
    <button type="button" className={`tm-notification-bell ${isDark ? 'is-dark' : 'is-light'}`} onClick={() => setOpen((value) => !value)} title="Notifications" aria-label="Notifications"><Bell size={17} />{unreadCount > 0 && <span className="tm-notification-count">{unreadCount > 9 ? '9+' : unreadCount}</span>}</button>
    {open && <section className={`tm-notification-panel ${isDark ? 'is-dark' : 'is-light'}`} aria-label="Notifications">
      <header className="tm-notification-panel-header"><div><h3>Notifications</h3><p>{unreadCount ? `${unreadCount} unread` : 'You are all caught up'}</p></div><button type="button" onClick={() => void markAllRead()} disabled={unreadCount === 0}><Check size={14} /> Mark all read</button></header>
      <div className="tm-notification-tabs" role="tablist">{CATEGORY_TABS.map((item) => <button key={item.key} type="button" className={tab === item.key ? 'active' : ''} onClick={() => setTab(item.key)}>{item.label}</button>)}</div>
      <div className="tm-notification-list">{notifications.length === 0 ? <div className="tm-notification-empty"><Bell size={20} /> No notifications yet.</div> : notifications.map((notification) => <button key={notification.id} type="button" className={`tm-notification-item ${notification.isRead ? '' : 'unread'}`} onClick={() => openNotification(notification)}><span className={`tm-notification-icon ${notification.type === 'CHAT_MESSAGE' ? 'chat' : notification.category.toLowerCase()}`}><NotificationIcon notification={notification} /></span><span className="tm-notification-copy"><span className="tm-notification-title-row"><strong>{notification.title}</strong>{!notification.isRead && <i aria-label="Unread" />}</span><span className="tm-notification-description">{notification.description}</span><span className="tm-notification-meta">{notification.relatedName ? `${notification.relatedName} · ` : ''}{timeAgo(notification.createdAt)}{notification.actionLabel ? ` · ${notification.actionLabel}` : ''}</span></span></button>)}</div>
    </section>}
  </div>;
}

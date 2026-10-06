import { useCallback, useEffect, useState } from 'react';
import { auth } from './firebase';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000';
const POLL_INTERVAL_MS = 20_000;

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

const authHeaders = (idToken: string) => ({
  'X-Toowix-Session': localStorage.getItem('toowix_session_token') || '',
  Authorization: `Bearer ${idToken}`,
});

/**
 * Single shared source for notifications, polled once every POLL_INTERVAL_MS no matter how many
 * components call useNotificationsPoll(). NotificationBell and NotificationToasts used to each run
 * their own independent 20s setInterval + fetch against overlapping endpoints (GET /api/notifications
 * and GET /api/notifications?unread=true), doubling the request volume for the same underlying data.
 *
 * This is a module-level singleton (not a React Context) so neither consumer needs to move in the
 * component tree: whichever of them mounts first starts the shared interval, and it stops only when
 * the last one unmounts. Each browser tab gets its own module instance (loaded fresh per page load),
 * so multiple tabs still poll independently of each other.
 *
 * The full (unfiltered, up to 100 most recent) list is fetched every tick; both the bell's
 * category-tab filtering and the toasts' unread-only filtering are now derived client-side from this
 * one payload instead of each requesting their own server-side filter.
 */
let notifications: INotification[] = [];
let unreadCount = 0;
let hasLoaded = false;
let intervalId: ReturnType<typeof setInterval> | null = null;
let listenerCount = 0;
const subscribers = new Set<() => void>();

function notifySubscribers(): void {
  subscribers.forEach((listener) => listener());
}

async function fetchNotifications(): Promise<void> {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) return;
  const response = await fetch(`${BACKEND_URL}/api/notifications`, { headers: authHeaders(idToken) });
  const data = await response.json().catch(() => ({}));
  if (response.ok) {
    notifications = data.notifications || [];
    unreadCount = data.unreadCount || 0;
    hasLoaded = true;
    notifySubscribers();
  }
}

function start(): void {
  listenerCount += 1;
  if (listenerCount === 1) {
    void fetchNotifications();
    intervalId = setInterval(() => void fetchNotifications(), POLL_INTERVAL_MS);
  }
}

function stop(): void {
  listenerCount = Math.max(0, listenerCount - 1);
  if (listenerCount === 0 && intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

export function useNotificationsPoll() {
  const [, forceRender] = useState(0);

  useEffect(() => {
    const listener = () => forceRender((tick) => tick + 1);

    subscribers.add(listener);
    start();

    return () => {
      subscribers.delete(listener);
      stop();
    };
  }, []);

  const markRead = useCallback(async (id: string) => {
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) return;
    await fetch(`${BACKEND_URL}/api/notifications/${id}/read`, { method: 'POST', headers: authHeaders(idToken) });
    notifications = notifications.map((item) => (item.id === id ? { ...item, isRead: true } : item));
    unreadCount = Math.max(0, unreadCount - 1);
    notifySubscribers();
  }, []);

  const markAllRead = useCallback(async () => {
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) return;
    await fetch(`${BACKEND_URL}/api/notifications/mark-all-read`, { method: 'POST', headers: authHeaders(idToken) });
    notifications = notifications.map((item) => ({ ...item, isRead: true }));
    unreadCount = 0;
    notifySubscribers();
  }, []);

  const refetch = useCallback(() => fetchNotifications(), []);

  return { notifications, unreadCount, hasLoaded, markRead, markAllRead, refetch };
}

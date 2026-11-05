import type { ChatConversation, ChatMessage } from './types';

const startOfDay = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

const pad = (n: number): string => String(n).padStart(2, '0');

/** 09:41 / 21:05 -- the time shown inside a bubble. */
export function formatBubbleTime(iso: string): string {
  const d = new Date(iso);

  return Number.isNaN(d.getTime()) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The right-hand time in the chat list: a time today, "Yesterday", a weekday this week, else a date. */
export function formatListTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);

  if (Number.isNaN(d.getTime())) return '';
  const days = Math.round((startOfDay(now) - startOfDay(d)) / DAY_MS);

  if (days <= 0) return formatBubbleTime(iso);
  if (days === 1) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });

  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** The centred pill between days in a chat: Today / Yesterday / weekday / 12 March 2026. */
export function formatDayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);

  if (Number.isNaN(d.getTime())) return '';
  const days = Math.round((startOfDay(now) - startOfDay(d)) / DAY_MS);

  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });

  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

export type MessageRow =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'message'; key: string; message: ChatMessage; groupStart: boolean };

/** Flattens messages into rows with a day separator wherever the date changes. `groupStart` is true for the
 * first bubble of a run from the same person (that one gets the little "tail"). */
export function buildMessageRows(messages: ChatMessage[], now: Date = new Date()): MessageRow[] {
  const rows: MessageRow[] = [];
  let lastDay = '';
  let lastSender = '';

  for (const message of messages) {
    const d = new Date(message.createdAt);
    const dayKey = Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

    if (dayKey !== lastDay) {
      rows.push({ kind: 'day', key: `day-${dayKey}`, label: formatDayLabel(message.createdAt, now) });
      lastDay = dayKey;
      lastSender = '';
    }
    rows.push({ kind: 'message', key: message.clientId ? `c-${message.clientId}` : message.id, message, groupStart: message.senderId !== lastSender });
    lastSender = message.senderId;
  }

  return rows;
}

export const initialsOf = (name: string): string => {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();

  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
};

const AVATAR_COLORS = [ '#6366f1', '#8b5cf6', '#ec4899', '#0ea5e9', '#f59e0b', '#14b8a6', '#ef4444', '#3b82f6' ];

/** The same person always gets the same colour. */
export function avatarColor(seed: string): string {
  let hash = 0;

  for (const char of String(seed)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;

  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/** What to print under a name in the chat list: the last message, with "You: " for your own. */
export function previewText(conversation: ChatConversation, meId: string): string {
  const last = conversation.lastMessage;

  if (!last) return '';

  return last.senderId === meId ? `You: ${last.text}` : last.text;
}

/** "9" stays "9", anything above 99 becomes "99+" so the badge never grows out of its circle. */
export const badgeLabel = (count: number): string => (count > 99 ? '99+' : String(count));

export const newClientId = (): string => {
  const c = (globalThis as { crypto?: Crypto }).crypto;

  if (c && typeof c.randomUUID === 'function') return c.randomUUID();

  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

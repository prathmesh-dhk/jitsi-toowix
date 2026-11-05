import { useState } from 'react';
import { AlertCircle, Check, CheckCheck, Clock } from 'lucide-react';
import { avatarColor, initialsOf } from '../../lib/directChat/format';
import type { ChatMessageStatus } from '../../lib/directChat/types';

export function Avatar({ name, url, size = 49 }: { name: string; url?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);

  return (
    <span
      className="dc-avatar"
      aria-hidden="true"
      style={{ width: size, height: size, background: url && !broken ? 'transparent' : avatarColor(name), fontSize: Math.round(size * 0.38) }}
    >
      {url && !broken ? <img src={url} alt="" onError={() => setBroken(true)} /> : initialsOf(name)}
    </span>
  );
}

const LABELS: Record<ChatMessageStatus, string> = {
  pending: 'Sending',
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
  failed: 'Not sent',
};

/** WhatsApp ticks: clock while sending, one grey tick sent, two grey delivered, two blue read. */
export function Ticks({ status, size = 15 }: { status: ChatMessageStatus; size?: number }) {
  const label = LABELS[status];

  switch (status) {
    case 'pending': return <Clock size={size - 3} aria-label={label} role="img" />;
    case 'sent': return <Check size={size} aria-label={label} role="img" />;
    case 'delivered': return <CheckCheck size={size} aria-label={label} role="img" />;
    case 'read': return <CheckCheck size={size} className="dc-tick-read" aria-label={label} role="img" />;
    default: return <AlertCircle size={size} color="#f15c6d" aria-label={label} role="img" />;
  }
}

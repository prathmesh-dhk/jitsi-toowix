import { auth } from './firebase';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000';

export const MAX_CHAT_IMAGE_BYTES = 3 * 1024 * 1024;

export function resolveChatImageUrl(imageUrl: string): string {
  if (imageUrl.startsWith('/')) return imageUrl;

  try {
    const parsed = new URL(imageUrl);
    if (parsed.pathname.startsWith('/api/uploads/chat-images/')) {
      return `${parsed.pathname}${parsed.search}`;
    }
  } catch {
    // Keep malformed legacy values unchanged so the browser can report the broken URL.
  }

  return imageUrl;
}

/**
 * Best-effort persistence for one chat message -- only meetings created from the dashboard have
 * anywhere to save this (the backend silently no-ops otherwise), so callers don't need to check
 * meetingInfo.persisted first; failures here are swallowed since chat itself is delivered
 * separately over the existing signaling channel regardless of whether it gets saved.
 */
export async function persistChatMessage(
  roomId: string,
  message: { senderName: string; senderId?: string; text?: string; imageUrl?: string }
): Promise<void> {
  try {
    await fetch(`${BACKEND_URL}/api/meetings/room/${encodeURIComponent(roomId)}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });
  } catch {
    // best-effort
  }
}

function readFileAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the selected file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Uploads a chat image attachment (JPG/PNG/GIF/WEBP, max 3MB) and returns its fetchable URL.
 * Only available in meetings created from the dashboard -- the backend rejects the upload
 * otherwise, matching the guard callers should already apply on meetingInfo.persisted before
 * even showing the attach-image button.
 */
export async function uploadChatImage(roomId: string, file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Only image files (JPG, PNG, GIF, WEBP) can be attached.');
  }
  if (file.size > MAX_CHAT_IMAGE_BYTES) {
    throw new Error('Image is too large -- the limit is 3MB.');
  }

  const dataUri = await readFileAsDataUri(file);
  const response = await fetch(`${BACKEND_URL}/api/meetings/room/${encodeURIComponent(roomId)}/chat/image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataUri }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error || 'Failed to upload image');
  }

  return data.url as string;
}

export interface IConversationSummary {
  id: string;
  name: string;
  roomSlug: string;
  type: string;
  messageCount: number;
  lastMessageAt: string;
  participantCount: number;
  status: 'Upcoming' | 'Live' | 'Ended';
  joinable: boolean;
  sharedFiles?: Array<{ name: string; url: string; size?: string; sharedBy?: string; sharedAt?: string }>;
}

export interface ISavedChatMessage {
  id: string;
  senderName: string;
  senderId?: string | null;
  text?: string | null;
  imageUrl?: string | null;
  createdAt: string;
}

async function authHeaders(): Promise<Record<string, string>> {
  await auth.authStateReady();
  if (!auth.currentUser) return {};
  return {
    Authorization: `Bearer ${await auth.currentUser.getIdToken()}`,
    'X-Toowix-Session': localStorage.getItem('toowix_session_token') || '',
  };
}

export async function fetchConversations(): Promise<IConversationSummary[]> {
  const response = await fetch(`${BACKEND_URL}/api/meetings/conversations`, {
    headers: await authHeaders(),
  });
  if (!response.ok) throw new Error('Failed to load conversations');
  const data = await response.json();
  return data.conversations || [];
}

export async function fetchChatHistory(roomSlug: string): Promise<ISavedChatMessage[]> {
  const response = await fetch(`${BACKEND_URL}/api/meetings/room/${encodeURIComponent(roomSlug)}/chat`, {
    headers: await authHeaders(),
  });
  if (!response.ok) throw new Error('Failed to load this conversation');
  const data = await response.json();
  return data.messages || [];
}

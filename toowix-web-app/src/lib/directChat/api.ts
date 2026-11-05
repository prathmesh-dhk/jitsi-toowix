import { auth } from '../firebase';
import type { ChatCallMode, ChatConversation, ChatMessage, ChatSearchResult, MuteDuration } from './types';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000';
const BASE = `${String(BACKEND_URL).replace(/\/$/, '')}/api/direct-chat`;

export const CHAT_STREAM_URL = `${BASE}/stream`;

export class ChatApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ChatApiError';
    this.status = status;
    this.code = code;
  }
}

async function waitForSignedInUser(): Promise<void> {
  if (auth.currentUser) return;
  const maybe = auth as unknown as { authStateReady?: () => Promise<void> };

  if (typeof maybe.authStateReady === 'function') await maybe.authStateReady();
}

/** Same two headers every other authenticated call in this app sends: the Firebase ID token and the app session. */
export async function chatHeaders(): Promise<Record<string, string>> {
  await waitForSignedInUser();
  if (!auth.currentUser) throw new ChatApiError(401, 'NOT_SIGNED_IN', 'Please sign in again.');

  return {
    Authorization: `Bearer ${await auth.currentUser.getIdToken()}`,
    'X-Toowix-Session': localStorage.getItem('toowix_session_token') || '',
  };
}

async function request<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${BASE}${path}`, {
      method: init.method || 'GET',
      headers: { ...(await chatHeaders()), ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
    });
  } catch (error) {
    if (error instanceof ChatApiError) throw error;
    if ((error as { name?: string })?.name === 'AbortError') throw error;
    throw new ChatApiError(0, 'NETWORK', 'You appear to be offline. Check your connection and try again.');
  }

  let body: any = null;

  try {
    body = await response.json();
  } catch {
    // an empty or non-JSON body is handled by the status check below
  }

  if (!response.ok) {
    throw new ChatApiError(response.status, body?.code || `HTTP_${response.status}`, body?.error || 'Something went wrong. Please try again.');
  }

  return body as T;
}

export const searchChatUsers = (query: string, signal?: AbortSignal) =>
  request<{ users: ChatSearchResult[] }>(`/users/search?q=${encodeURIComponent(query)}`, { signal });

export const openChatWith = (userId: string) =>
  request<{ conversation: ChatConversation }>('/conversations', { method: 'POST', body: { userId } });

export const fetchConversations = () =>
  request<{ conversations: ChatConversation[]; totalUnread: number }>('/conversations');

export const fetchMessages = (conversationId: string, before?: string) =>
  request<{ messages: ChatMessage[]; hasMore: boolean }>(
    `/conversations/${encodeURIComponent(conversationId)}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`,
  );

export const postMessage = (conversationId: string, text: string, clientId: string) =>
  request<{ message: ChatMessage; duplicate: boolean }>(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
    { method: 'POST', body: { text, clientId } },
  );

export const postRead = (conversationId: string) =>
  request<{ ok: boolean; totalUnread: number }>(`/conversations/${encodeURIComponent(conversationId)}/read`, { method: 'POST' });

const chatPath = (conversationId: string): string => `/conversations/${encodeURIComponent(conversationId)}`;

export const postMute = (conversationId: string, duration: MuteDuration) =>
  request<{ ok: boolean; mutedUntil: string | null }>(`${chatPath(conversationId)}/mute`, { method: 'POST', body: { duration } });

export const postClearChat = (conversationId: string) =>
  request<{ ok: boolean }>(`${chatPath(conversationId)}/clear`, { method: 'POST' });

export const deleteChatRequest = (conversationId: string) =>
  request<{ ok: boolean }>(chatPath(conversationId), { method: 'DELETE' });

export const postBlock = (conversationId: string, blocked: boolean) =>
  request<{ ok: boolean; blockedByMe: boolean }>(`${chatPath(conversationId)}/block`, { method: 'POST', body: { blocked } });

export const postStartCall = (conversationId: string, mode: ChatCallMode) =>
  request<{ message: ChatMessage; callId: string; roomSlug: string; ringing: boolean }>(`${chatPath(conversationId)}/calls`, { method: 'POST', body: { mode } });

export const postAcceptCall = (callId: string) =>
  request<{ ok: boolean; mode: ChatCallMode; roomSlug: string; conversationId: string }>(`/calls/${encodeURIComponent(callId)}/accept`, { method: 'POST' });

export const postDeclineCall = (callId: string) => request<{ ok: boolean }>(`/calls/${encodeURIComponent(callId)}/decline`, { method: 'POST' });

export const postCancelCall = (callId: string) => request<{ ok: boolean }>(`/calls/${encodeURIComponent(callId)}/cancel`, { method: 'POST' });

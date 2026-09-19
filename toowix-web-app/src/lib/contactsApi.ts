import { auth } from './firebase';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000';

export interface IContact {
  id: string;
  name: string;
  email: string;
}

async function authedFetch(path: string, init: RequestInit = {}): Promise<any> {
  await auth.authStateReady();
  const token = await auth.currentUser?.getIdToken();

  if (!token) {
    throw new Error('Sign in to use your contact book.');
  }
  const response = await fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Toowix-Session': localStorage.getItem('toowix_session_token') || '',
      ...(init.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

export async function listContacts(): Promise<IContact[]> {
  return (await authedFetch('/api/contacts')).contacts as IContact[];
}

export async function createContact(name: string, email: string): Promise<IContact> {
  return (await authedFetch('/api/contacts', { method: 'POST', body: JSON.stringify({ name, email }) })).contact;
}

export async function updateContact(id: string, name: string, email: string): Promise<IContact> {
  return (await authedFetch(`/api/contacts/${id}`, { method: 'PUT', body: JSON.stringify({ name, email }) })).contact;
}

export async function deleteContact(id: string): Promise<void> {
  await authedFetch(`/api/contacts/${id}`, { method: 'DELETE' });
}

export async function inviteByEmail(roomSlug: string, emails: string[]): Promise<number> {
  const data = await authedFetch(`/api/meetings/room/${encodeURIComponent(roomSlug)}/invite`, {
    method: 'POST',
    body: JSON.stringify({ emails })
  });

  return data.sent as number;
}

import { auth } from '../firebase';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000';

export async function getTelemetrySession(roomId: string): Promise<{ token: string; participantId: string; displayName?: string } | null> {
  if (!auth.currentUser) return null;
  const response = await fetch(`${BACKEND_URL}/api/meetings/room/${encodeURIComponent(roomId)}/monitoring/telemetry-session`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await auth.currentUser.getIdToken()}`,
      'X-Toowix-Session': localStorage.getItem('toowix_session_token') || '',
    },
  });
  if (!response.ok) return null;
  const session = await response.json();
  return typeof session.token === 'string' && typeof session.participantId === 'string' ? session : null;
}

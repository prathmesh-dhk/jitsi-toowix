// Shared helper for every "Sign out" / "Log out" action in the app. Calls the backend logout
// endpoint (best-effort -- local sign-out must proceed either way) BEFORE any local session
// data is cleared, since it needs the still-present Firebase ID token + X-Toowix-Session header.
// The backend revokes this device's session and, strictly, this same person's Mail session too.
import { auth } from './firebase';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000';

export async function backendLogout(): Promise<void> {
  try {
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) return;
    await fetch(`${BACKEND_URL}/api/auth/logout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'X-Toowix-Session': localStorage.getItem('toowix_session_token') || '',
      },
    });
  } catch (e) {
    console.warn('Backend logout warning:', e);
  }
}

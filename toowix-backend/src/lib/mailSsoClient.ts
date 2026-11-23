// Outbound half of strict cross-app logout: calls Mail's matching internal endpoint so a Meet
// logout also revokes that same person's Mail session. Best-effort by design -- a Mail-side
// failure must never block a Meet user from logging out locally.
import { internalSsoConfig, isInternalSsoOutboundConfigured } from '../config/internalSso';

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function revokeMailSessionsByEmail(email: string): Promise<void> {
  if (!isInternalSsoOutboundConfigured() || !email) return;
  try {
    await fetchWithTimeout(`${internalSsoConfig.mailBaseUrl}/api/internal/sessions/revoke-by-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Service-Key': internalSsoConfig.serviceSecret },
      body: JSON.stringify({ email }),
    }, internalSsoConfig.timeoutMs);
  } catch (err: any) {
    console.warn('[Internal SSO] Could not revoke Mail sessions:', err?.name === 'AbortError' ? 'timeout' : (err?.message || 'unknown error'));
  }
}

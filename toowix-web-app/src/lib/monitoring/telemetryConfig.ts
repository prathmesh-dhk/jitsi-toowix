export interface ITelemetryPublisherConfig {
  endpoint: string;
  token: string;
  participantId: string;
}

function createParticipantId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// This identifies one browser tab in one room across a page reload. It is telemetry metadata,
// not an authentication credential; the ingest API authenticates the request using its dedicated
// bearer token.
function getParticipantId(roomId: string): string {
  const key = `toowix_telemetry_participant:${roomId.toLowerCase()}`;
  const fallback = createParticipantId();

  try {
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    window.sessionStorage.setItem(key, fallback);
  } catch {
    // Storage can be blocked by strict/private browser modes. Telemetry must stay optional.
  }

  return fallback;
}

/**
 * Telemetry is deliberately opt-in at build time. Do not fall back to localhost here: in a
 * production browser localhost points to the participant's own device, not Toowix infrastructure.
 */
export function getTelemetryPublisherConfig(roomId: string): ITelemetryPublisherConfig | null {
  const endpoint = String(import.meta.env.VITE_MONITORING_TELEMETRY_URL || '').trim();
  const token = String(import.meta.env.VITE_TELEMETRY_INGEST_TOKEN || '').trim();

  if (!endpoint || !token) return null;

  return { endpoint, token, participantId: getParticipantId(roomId) };
}

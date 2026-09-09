/**
 * Generates a clean, unique meeting room slug (e.g. twx-abc-def-ghi)
 * Requirement 1.3
 */
export const generateUniqueMeetingId = (): string => {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  const getRandomChunk = (len: number) => {
    let result = '';
    for (let i = 0; i < len; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  return `twx-${getRandomChunk(3)}-${getRandomChunk(3)}-${getRandomChunk(3)}`;
};

/**
 * Sanitizes and formats custom meeting ID input
 * Requirement 1.4
 */
export const sanitizeCustomMeetingId = (input: string): string => {
  let code = input.trim();
  try {
    const url = new URL(code);
    code = url.pathname.split('/').filter(Boolean).pop() || '';
  } catch { code = code.split(/[?#]/)[0]; }
  return code
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
};

/**
 * Builds the full meeting room URL for Toowix Meet web app
 */
export const getMeetingUrl = (roomId: string): string => {
  const cleanId = sanitizeCustomMeetingId(roomId);
  const base = typeof window !== 'undefined' && window.location.origin
    ? window.location.origin
    : (import.meta.env.VITE_APP_URL || 'http://localhost:3000');
  return `${base}/meet/${cleanId}`;
};

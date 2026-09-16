import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

// Profile pictures were previously stored as base64 data: URIs directly on the User document
// and embedded as-is into the Jitsi JWT's context.user.avatar field -- for any real photo that
// made the JWT huge enough to blow past nginx's request-line limit on the WebSocket handshake
// (414 Unexpected response code), silently breaking that participant's connection to the whole
// conference. This module gives avatars a real short URL instead, the same way recordings get
// a real fetchable URL rather than being embedded inline.
const UPLOAD_ROOT = process.env.AVATAR_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'avatars');

const DATA_URI_PATTERN = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/;

const EXT_BY_MIME: Record<string, string> = { png: 'png', jpg: 'jpg', jpeg: 'jpg', webp: 'webp', gif: 'gif' };

/**
 * If `avatarUrl` is a base64 data: URI, decodes it, writes it to disk, and returns a real
 * fetchable URL (rooted at requestOrigin + '/api/uploads/avatars/...') for the caller to store
 * instead. A non-data-URI value (already a real URL, or null/undefined) is returned unchanged.
 */
export async function persistAvatarIfDataUri(
    avatarUrl: string | null | undefined,
    userId: string,
    requestOrigin: string
): Promise<string | null | undefined> {
  if (!avatarUrl) {
    return avatarUrl;
  }

  const match = DATA_URI_PATTERN.exec(avatarUrl);

  if (!match) {
    return avatarUrl;
  }

  const [ , mime, base64Data ] = match;
  const ext = EXT_BY_MIME[mime.toLowerCase()] || 'jpg';
  const buffer = Buffer.from(base64Data, 'base64');

  // 5MB cap -- the client already resizes/compresses via canvas before upload, so a real photo
  // should land well under this; this just guards against something pathological.
  if (buffer.length > 5 * 1024 * 1024) {
    throw new Error('Profile picture is too large (max 5MB)');
  }

  await fs.mkdir(UPLOAD_ROOT, { recursive: true });

  const filename = `${userId}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  const filePath = path.join(UPLOAD_ROOT, filename);

  await fs.writeFile(filePath, buffer);

  return `${requestOrigin}/api/uploads/avatars/${filename}`;
}

export function getAvatarUploadRoot(): string {
  return UPLOAD_ROOT;
}

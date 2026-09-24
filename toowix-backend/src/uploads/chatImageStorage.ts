import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

// Chat images are sent to the backend as base64 data: URIs (same convention as avatarStorage.ts)
// and written to disk here instead of embedded inline in the chat message/signal payload, which
// would otherwise bloat the polling signal buffer and the persisted chatMessages array on the
// Meeting document.
const UPLOAD_ROOT = process.env.CHAT_IMAGE_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'chat-images');

const DATA_URI_PATTERN = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/;

const EXT_BY_MIME: Record<string, string> = { png: 'png', jpg: 'jpg', jpeg: 'jpg', webp: 'webp', gif: 'gif' };

const MAX_CHAT_IMAGE_BYTES = 3 * 1024 * 1024;

/**
 * Decodes a base64 image data: URI, writes it to disk, and returns a real fetchable URL (rooted
 * at requestOrigin + '/api/uploads/chat-images/...'). Throws if the value isn't a recognized
 * image data URI or exceeds the 3MB chat attachment limit.
 */
export async function persistChatImage(
    dataUri: string,
    roomSlug: string,
    _requestOrigin: string
): Promise<string> {
  const match = DATA_URI_PATTERN.exec(dataUri || '');

  if (!match) {
    throw new Error('Unsupported image format -- please use JPG, PNG, GIF, or WEBP.');
  }

  const [ , mime, base64Data ] = match;
  const ext = EXT_BY_MIME[mime.toLowerCase()] || 'jpg';
  const buffer = Buffer.from(base64Data, 'base64');

  if (buffer.length > MAX_CHAT_IMAGE_BYTES) {
    throw new Error('Image is too large (max 3MB).');
  }

  const safeRoom = String(roomSlug || 'room').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60) || 'room';
  await fs.mkdir(UPLOAD_ROOT, { recursive: true });

  const filename = `${safeRoom}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
  const filePath = path.join(UPLOAD_ROOT, filename);

  await fs.writeFile(filePath, buffer);

  // Keep this same-origin so a development URL (localhost:4000) is never persisted into
  // a conversation that may later be opened through the deployed web app.
  return `/api/uploads/chat-images/${filename}`;
}

export function getChatImageUploadRoot(): string {
  return UPLOAD_ROOT;
}

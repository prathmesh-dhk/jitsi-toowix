import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

// Chat images are sent to the backend as base64 data: URIs (same convention as avatarStorage.ts)
// and written to disk here instead of embedded inline in the chat message/signal payload, which
// would otherwise bloat the polling signal buffer and the persisted chatMessages array on the
// Meeting document.
const UPLOAD_ROOT = process.env.CHAT_IMAGE_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'chat-images');

// CONFIRMED BUG: this used to hard-reject any image MIME subtype outside png/jpeg/webp/gif
// (reported as "an image which is not coming" -- e.g. bmp, svg, avif, ico, or a phone's heic
// export would all silently fail to upload with "Unsupported image format"). Accept any
// data:image/<subtype> the browser reports instead of a hardcoded allow-list.
const DATA_URI_PATTERN = /^data:image\/([a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/;

// Keeps the stored file's extension (and therefore the Content-Type express.static infers when
// serving it back from /api/uploads/chat-images) matched to what was actually uploaded, instead
// of silently mislabeling an unrecognized subtype as .jpg -- which would serve real BMP/SVG/etc.
// bytes under an image/jpeg Content-Type and fail to render in the receiver's browser.
function extensionForImageMimeSubtype(subtype: string): string {
  const normalized = subtype.toLowerCase();

  if (normalized === 'jpeg') return 'jpg';
  if (normalized === 'svg+xml') return 'svg';

  const safe = normalized.replace(/[^a-z0-9]/g, '');

  return safe || 'img';
}

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
    throw new Error('Unsupported image format.');
  }

  const [ , mime, base64Data ] = match;
  const ext = extensionForImageMimeSubtype(mime);
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

// Matches persistChatImage's own filename format (`${safeRoom}-${16 hex chars}.${extension}`)
// so retention can identify the originating room without relying on a database document. The
// room part may contain hyphens, hence the greedy first capture.
const IMAGE_FILENAME_PATTERN = /^(.+)-([0-9a-f]{16})\.[a-z0-9]+$/i;

export function parseRoomSlugFromChatImageFilename(filename: string): string | null {
  const match = IMAGE_FILENAME_PATTERN.exec(filename);

  return match ? match[1] : null;
}

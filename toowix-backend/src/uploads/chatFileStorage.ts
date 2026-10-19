import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

// Generic chat file attachments (anything that isn't the existing dedicated image/audio paths --
// PDF, DOCX, ZIP, video, or any other file type, up to 5MB). Same base64 data: URI convention as
// chatImageStorage.ts/chatAudioStorage.ts, but stored one level deeper -- uploads/chat-files/
// <randomId>/<original-filename> -- so the SAME URL both serves the file (via the existing
// express.static mount) and carries the real original filename, which is what makes a plain
// `<a href={url} download>` on the frontend offer a sensible downloaded filename (e.g.
// "report.pdf", not a random hash) rather than needing a separate signed-download endpoint.
const UPLOAD_ROOT = process.env.CHAT_FILE_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'chat-files');

const DATA_URI_PATTERN = /^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+)(?:;[a-zA-Z0-9=_-]+)*;base64,([A-Za-z0-9+/=]+)$/;

export const MAX_CHAT_FILE_BYTES = 5 * 1024 * 1024;

export interface IPersistedChatFile {
  url: string;
  fileName: string;
  fileSize: number;
  fileType: string;
}

/**
 * Decodes a base64 file data: URI (any MIME type) and writes it to disk under a random
 * subdirectory, preserving the ORIGINAL filename so the resulting URL downloads with a sensible
 * name. Throws if the value isn't a recognized data URI or exceeds the 5MB chat attachment limit.
 */
export async function persistChatFile(
    dataUri: string,
    originalFileName: string,
    roomSlug: string,
): Promise<IPersistedChatFile> {
  const match = DATA_URI_PATTERN.exec((dataUri || '').trim());

  if (!match) {
    throw new Error('Could not read this file -- please try a different one.');
  }

  const [ , mimeType, base64Data ] = match;
  const buffer = Buffer.from(base64Data, 'base64');

  if (buffer.length === 0) {
    throw new Error('This file appears to be empty.');
  }
  if (buffer.length > MAX_CHAT_FILE_BYTES) {
    throw new Error('File is too large -- the limit is 5MB.');
  }

  // Strip any path separators and control characters a crafted filename could carry -- this
  // becomes a real path segment on disk, not just a display label.
  const safeName = (path.basename(originalFileName || 'file') || 'file')
      .replace(/[\\/\0<>:"|?*\x00-\x1F]/g, '_')
      .slice(0, 180) || 'file';
  const safeRoom = String(roomSlug || 'room').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60) || 'room';
  const subdir = `${safeRoom}-${crypto.randomBytes(8).toString('hex')}`;
  const dirPath = path.join(UPLOAD_ROOT, subdir);

  await fs.mkdir(dirPath, { recursive: true });
  await fs.writeFile(path.join(dirPath, safeName), buffer);

  return {
    url: `/api/uploads/chat-files/${subdir}/${encodeURIComponent(safeName)}`,
    fileName: safeName,
    fileSize: buffer.length,
    fileType: mimeType.toLowerCase(),
  };
}

export function getChatFileUploadRoot(): string {
  return UPLOAD_ROOT;
}

// Matches persistChatFile's own subdir naming (`${safeRoom}-${16 hex chars}`) so a sweep can
// recover which room a stored upload belongs to.
const SUBDIR_PATTERN = /^(.+)-([0-9a-f]{16})$/;

export function parseRoomSlugFromChatFileSubdir(subdir: string): string | null {
  const match = SUBDIR_PATTERN.exec(subdir);

  return match ? match[1] : null;
}

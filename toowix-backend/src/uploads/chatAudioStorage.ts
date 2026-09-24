import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

const UPLOAD_ROOT = process.env.CHAT_AUDIO_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'chat-audios');

// Matches data:audio/webm;base64,... or data:audio/webm;codecs=opus;base64,... or audio/ogg, audio/mp4, audio/wav, audio/mpeg, etc.
const AUDIO_DATA_URI_PATTERN = /^data:audio\/(webm|ogg|wav|mp4|aac|mpeg|m4a|x-m4a)(?:;[a-zA-Z0-9=_-]+)*;base64,([A-Za-z0-9+/=]+)$/i;

const EXT_BY_MIME: Record<string, string> = {
  webm: 'webm',
  ogg: 'ogg',
  wav: 'wav',
  mp4: 'mp4',
  m4a: 'm4a',
  'x-m4a': 'm4a',
  aac: 'aac',
  mpeg: 'mp3',
};

const MAX_CHAT_AUDIO_BYTES = 10 * 1024 * 1024; // 10MB max for voice notes

/**
 * Decodes a base64 audio data: URI, writes it to disk, and returns a URL path
 * (/api/uploads/chat-audios/filename).
 */
export async function persistChatAudio(
  dataUri: string,
  roomSlug: string,
  _requestOrigin: string
): Promise<string> {
  const match = AUDIO_DATA_URI_PATTERN.exec((dataUri || '').trim());

  if (!match) {
    // If strict regex fails due to complex audio params, fallback to loose data URI extraction
    if (dataUri.startsWith('data:audio/') && dataUri.includes(';base64,')) {
      const parts = dataUri.split(';base64,');
      const mimePart = parts[0].replace('data:audio/', '').split(';')[0].toLowerCase();
      const ext = EXT_BY_MIME[mimePart] || 'webm';
      const buffer = Buffer.from(parts[1], 'base64');

      if (buffer.length > MAX_CHAT_AUDIO_BYTES) {
        throw new Error('Voice message is too large (max 10MB).');
      }

      const safeRoom = String(roomSlug || 'room').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60) || 'room';
      await fs.mkdir(UPLOAD_ROOT, { recursive: true });

      const filename = `${safeRoom}-voice-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
      const filePath = path.join(UPLOAD_ROOT, filename);
      await fs.writeFile(filePath, buffer);

      return `/api/uploads/chat-audios/${filename}`;
    }
    throw new Error('Unsupported audio format -- please use WebM, OGG, MP4, WAV, or MP3.');
  }

  const [, mime, base64Data] = match;
  const ext = EXT_BY_MIME[mime.toLowerCase()] || 'webm';
  const buffer = Buffer.from(base64Data, 'base64');

  if (buffer.length > MAX_CHAT_AUDIO_BYTES) {
    throw new Error('Voice message is too large (max 10MB).');
  }

  const safeRoom = String(roomSlug || 'room').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60) || 'room';
  await fs.mkdir(UPLOAD_ROOT, { recursive: true });

  const filename = `${safeRoom}-voice-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  const filePath = path.join(UPLOAD_ROOT, filename);

  await fs.writeFile(filePath, buffer);

  return `/api/uploads/chat-audios/${filename}`;
}

export function getChatAudioUploadRoot(): string {
  return UPLOAD_ROOT;
}

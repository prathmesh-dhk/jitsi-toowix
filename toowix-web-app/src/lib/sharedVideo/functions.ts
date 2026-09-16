// Ported from jitsi-meet's react/features/shared-video/functions.ts. Trimmed to the YouTube-only
// path -- upstream also supports sharing a direct video-file URL (subject to a domain whitelist
// and a "do you trust this link" confirmation dialog for non-owners), which is left out here.
// YouTube is stock Jitsi's own DEFAULT_ALLOWED_URL_DOMAINS, so this is a subset of the real
// feature, not a different one.
import { PLAYBACK_START, PLAYBACK_STATUSES, SHARED_VIDEO } from './constants';

const YOUTUBE_ID_PATTERN = /^(?:https?:\/\/)?(?:www\.)?(?:youtu\.be\/|(?:m\.)?youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))((\w|-){11})(?:\S+)?$/; // eslint-disable-line max-len

/** Extracts the 11-character YouTube video id from a URL, or a bare id typed directly. */
export function extractYoutubeId(input: string): string | undefined {
  if (!input) {
    return undefined;
  }
  const trimmed = input.trim();

  if (!trimmed) {
    return undefined;
  }

  const match = trimmed.match(YOUTUBE_ID_PATTERN);

  if (match) {
    return match[1];
  }

  // A bare 11-char id typed directly (no URL wrapper).
  return /^[\w-]{11}$/.test(trimmed) ? trimmed : undefined;
}

export function isSharingStatus(status: string): boolean {
  return [ PLAYBACK_STATUSES.PLAYING, PLAYBACK_STATUSES.PAUSED, PLAYBACK_START ].includes(status);
}

export function sendShareVideoCommand({ id, status, room, localParticipantId = '', time, muted, volume }: {
  id: string; localParticipantId?: string; muted?: boolean; room: any;
  status: string; time: number; volume?: number;
}): void {
  room?.sendCommandOnce(SHARED_VIDEO, {
    value: id,
    attributes: {
      from: localParticipantId,
      muted,
      state: status,
      time,
      volume
    }
  });
}

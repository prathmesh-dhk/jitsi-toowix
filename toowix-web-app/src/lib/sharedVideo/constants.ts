// Ported as-is from jitsi-meet's react/features/shared-video/constants.ts -- same command name
// and same playback status strings, so our sync protocol is byte-for-byte compatible with
// stock Jitsi's (in case a stock Jitsi client is ever in the same room).
export const SHARED_VIDEO = 'shared-video';

export const PLAYBACK_STATUSES = {
  PLAYING: 'playing',
  PAUSED: 'pause',
  STOPPED: 'stop'
};

export const PLAYBACK_START = 'start';

export const YOUTUBE_URL_DOMAIN = 'youtube.com';

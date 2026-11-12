import crypto from 'crypto';
import { turnConfig } from '../config/turn';

export interface ITurnCredentials {
  urls: string[];
  username: string;
  credential: string;
  ttlSeconds: number;
}

// coturn's standard time-limited credential scheme (the same one Prosody's extdisco would hand
// out if it worked): username is "<expiry-unix-seconds>:<label>", password is
// base64(HMAC-SHA1(secret, username)). coturn validates both fields itself against its own
// static-auth-secret -- the backend never talks to coturn directly, it only needs to agree with
// it on the secret.
export function generateTurnCredentials(label = 'toowix'): ITurnCredentials {
  const expiresAt = Math.floor(Date.now() / 1000) + turnConfig.credentialTtlSeconds;
  const username = `${expiresAt}:${label}`;
  const credential = crypto.createHmac('sha1', turnConfig.secret).update(username).digest('base64');
  const hostPort = `${turnConfig.host}:${turnConfig.port}`;

  return {
    urls: [
      `stun:${hostPort}`,
      `turn:${hostPort}?transport=udp`,
      `turn:${hostPort}?transport=tcp`,
    ],
    username,
    credential,
    ttlSeconds: turnConfig.credentialTtlSeconds,
  };
}

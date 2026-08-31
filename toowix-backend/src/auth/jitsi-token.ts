import jwt from 'jsonwebtoken';
import { jitsiConfig } from '../config/jitsi';

export interface IJitsiUserContext {
  id: string;
  name: string;
  email: string;
  avatar?: string | null;
}

export interface IJitsiFeaturesContext {
  moderator: boolean;
  recording?: boolean;
  screenShare?: boolean;
  livestreaming?: boolean;
  transcription?: boolean;
}

export interface IGenerateJitsiTokenOptions {
  user: IJitsiUserContext;
  room?: string; // specific room name or '*' for all rooms
  features?: Partial<IJitsiFeaturesContext>;
  companyId?: string | null;
  expiresInSeconds?: number;
}

/**
 * Generates a signed JWT token conforming to Prosody mod_auth_token specifications.
 */
export const generateJitsiToken = (options: IGenerateJitsiTokenOptions): string => {
  const { user, room = '*', features = {}, companyId, expiresInSeconds = jitsiConfig.tokenExpirySeconds } = options;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expSeconds = nowSeconds + expiresInSeconds;

  const payload = {
    iss: jitsiConfig.appId,
    aud: jitsiConfig.appId,
    sub: jitsiConfig.domain,
    room: room,
    iat: nowSeconds,
    nbf: nowSeconds - 10,
    exp: expSeconds,
    context: {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: user.avatar || undefined,
      },
      group: companyId || 'default',
      features: {
        moderator: features.moderator ?? false,
        recording: features.recording ?? true,
        'screen-sharing': features.screenShare ?? true,
        livestreaming: features.livestreaming ?? false,
        transcription: features.transcription ?? false,
      },
    },
  };

  return jwt.sign(payload, jitsiConfig.appSecret, {
    algorithm: 'HS256',
  });
};

/**
 * Verifies a Jitsi JWT token.
 */
export const verifyJitsiToken = (token: string): jwt.JwtPayload => {
  return jwt.verify(token, jitsiConfig.appSecret, {
    issuer: jitsiConfig.appId,
    audience: jitsiConfig.appId,
  }) as jwt.JwtPayload;
};

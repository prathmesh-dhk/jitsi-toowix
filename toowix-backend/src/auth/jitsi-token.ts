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
  room: string; // required exact room
  features?: Partial<IJitsiFeaturesContext>;
  requireLobby?: boolean;
  companyId?: string | null;
  expiresInSeconds?: number;
}

/**
 * Generates a signed JWT token conforming to Prosody mod_auth_token specifications.
 */
export const generateJitsiToken = (options: IGenerateJitsiTokenOptions): string => {
  const { user, room, features = {}, companyId, expiresInSeconds = jitsiConfig.tokenExpirySeconds } = options;

  if (!room || room === '*' || !/^[a-z0-9-]{3,100}$/.test(room)) throw new Error('An exact room is required');
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expSeconds = nowSeconds + Math.min(expiresInSeconds, 900);

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
        moderator: features.moderator ?? false,
        name: user.name,
        email: user.email,
        avatar: user.avatar || undefined,
      },
      group: companyId || 'default',
      room: { lobby: options.requireLobby === true },
      features: {
        moderator: features.moderator ?? false,
        recording: features.recording ?? false,
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
    algorithms: ['HS256'],
    issuer: jitsiConfig.appId,
    audience: jitsiConfig.appId,
  }) as jwt.JwtPayload;
};

import dotenv from 'dotenv';
dotenv.config();

export interface ITurnConfig {
  host: string;
  port: number;
  realm: string;
  secret: string;
  credentialTtlSeconds: number;
}

export const turnConfig: ITurnConfig = {
  host: process.env.TURN_HOST || '',
  port: parseInt(process.env.TURN_PORT || '3478', 10),
  realm: process.env.TURN_REALM || '',
  secret: process.env.TURN_SECRET || '',
  credentialTtlSeconds: parseInt(process.env.TURN_CREDENTIAL_TTL_SECONDS || '3600', 10),
};

export const isTurnConfigured = (): boolean => Boolean(turnConfig.host && turnConfig.secret);

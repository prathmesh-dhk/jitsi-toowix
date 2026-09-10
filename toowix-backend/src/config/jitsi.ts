import dotenv from 'dotenv';
dotenv.config();

export interface IJitsiConfig {
  appId: string;
  appSecret: string;
  domain: string;
  tokenExpirySeconds: number;
}

if (process.env.NODE_ENV === 'production' && (!process.env.JITSI_APP_SECRET || process.env.JITSI_APP_SECRET.length < 32 || process.env.JITSI_APP_SECRET === 'toowix-secret-dev-key-change-in-prod')) {
  throw new Error('A strong JITSI_APP_SECRET is required in production');
}

export const jitsiConfig: IJitsiConfig = {
  appId: process.env.JITSI_APP_ID || 'toowix-meet',
  appSecret: process.env.JITSI_APP_SECRET || 'toowix-secret-dev-key-change-in-prod',
  domain: process.env.JITSI_DOMAIN || 'talk.toowix.com',
  tokenExpirySeconds: parseInt(process.env.JITSI_TOKEN_EXPIRY_SECONDS || '900', 10), // capped at 15 minutes by the issuer
};

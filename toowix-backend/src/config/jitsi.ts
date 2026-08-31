import dotenv from 'dotenv';
dotenv.config();

export interface IJitsiConfig {
  appId: string;
  appSecret: string;
  domain: string;
  tokenExpirySeconds: number;
}

export const jitsiConfig: IJitsiConfig = {
  appId: process.env.JITSI_APP_ID || 'toowix-meet',
  appSecret: process.env.JITSI_APP_SECRET || 'toowix-secret-dev-key-change-in-prod',
  domain: process.env.JITSI_DOMAIN || 'meet.toowix.com',
  tokenExpirySeconds: parseInt(process.env.JITSI_TOKEN_EXPIRY_SECONDS || '86400', 10), // 24 hours
};

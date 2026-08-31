import dotenv from 'dotenv';
dotenv.config();

export interface IEmailConfig {
  fromName: string;
  fromEmail: string;
  supportEmail: string;
  appUrl: string;
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    auth: {
      user: string;
      pass: string;
    };
  };
}

export const emailConfig: IEmailConfig = {
  fromName: process.env.EMAIL_FROM_NAME || 'Toowix Meet',
  fromEmail: process.env.EMAIL_FROM_ADDRESS || 'notifications@toowix.com',
  supportEmail: process.env.SUPPORT_EMAIL || 'support@toowix.com',
  appUrl: process.env.APP_URL || 'https://meet.toowix.com',
  smtp: process.env.SMTP_HOST
    ? {
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER || '',
          pass: process.env.SMTP_PASS || '',
        },
      }
    : undefined,
};

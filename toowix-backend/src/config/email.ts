import dotenv from 'dotenv';
import { EmailTemplateName } from '../models/EmailLog';
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
  appUrl: process.env.APP_URL || 'http://localhost:3000',
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

export type EmailCategory = 'ACCOUNTS' | 'NOTIFICATIONS';

// Both identities authenticate with the same SMTP credentials (emailConfig.smtp) -- only the
// From header differs, so recipients see which Toowix team an email is actually from.
export const emailSenders: Record<EmailCategory, { fromName: string; fromEmail: string }> = {
  ACCOUNTS: {
    fromName: process.env.EMAIL_ACCOUNTS_FROM_NAME || 'Toowix Accounts',
    fromEmail: process.env.EMAIL_ACCOUNTS_FROM_ADDRESS || 'accounts@toowix.com',
  },
  NOTIFICATIONS: {
    fromName: process.env.EMAIL_NOTIFICATIONS_FROM_NAME || 'Toowix Notifications',
    fromEmail: process.env.EMAIL_NOTIFICATIONS_FROM_ADDRESS || 'notifications@toowix.com',
  },
};

// OTPs/verification/reset/security alerts -> ACCOUNTS; everything else operational -> NOTIFICATIONS.
const templateCategoryMap: Record<EmailTemplateName, EmailCategory> = {
  E1_VERIFY_EMAIL: 'ACCOUNTS',
  E2_REG_RECEIVED: 'ACCOUNTS',
  E3_REG_APPROVED: 'ACCOUNTS',
  E4_REG_REJECTED: 'ACCOUNTS',
  E5_USER_SIGNIN: 'ACCOUNTS',
  E6_ADMIN_SIGNIN: 'ACCOUNTS',
  E7_PASSWORD_RESET: 'ACCOUNTS',
  E8_INVITE_MEMBER: 'NOTIFICATIONS',
  E9_MEETING_INVITE: 'NOTIFICATIONS',
  E10_2FA_ENABLED: 'ACCOUNTS',
  E11_CONVERSATION_INVITE: 'NOTIFICATIONS',
};

export const resolveEmailCategory = (templateName: EmailTemplateName): EmailCategory =>
  templateCategoryMap[templateName] || 'NOTIFICATIONS';

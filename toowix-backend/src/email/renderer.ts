import fs from 'fs';
import path from 'path';
import { emailConfig } from '../config/email';

export interface IRenderEmailOptions {
  title: string;
  preheader?: string;
  content: string; // HTML or multi-line formatted text
  actionButton?: {
    text: string;
    url: string;
  };
  variables?: Record<string, string | number | undefined>;
}

let baseTemplateCache: string | null = null;

export const loadBaseTemplate = (): string => {
  if (baseTemplateCache) {
    return baseTemplateCache;
  }

  const templatePath = path.join(__dirname, 'templates', '_base.html');
  try {
    baseTemplateCache = fs.readFileSync(templatePath, 'utf8');
    return baseTemplateCache;
  } catch (error) {
    console.error('[Email Renderer] Failed to load _base.html template:', error);
    throw error;
  }
};

/**
 * Helper to build an email-compatible CTA button table
 */
export const buildActionButtonHtml = (text: string, url: string): string => {
  return `
    <tr>
      <td align="center" style="padding: 12px 0 28px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
          <tr>
            <td align="center" style="border-radius: 8px; background: linear-gradient(135deg, #2E72B2 0%, #4799E3 100%); background-color: #3A86CA;" bgcolor="#3A86CA">
              <a href="${url}" target="_blank" style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 15px; font-weight: 600; color: #FFFFFF; text-decoration: none; display: inline-block; padding: 14px 32px; border-radius: 8px; border: 1px solid #2778BC; box-shadow: 0 2px 6px rgba(0, 95, 157, 0.25);">
                ${text} &rarr;
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `;
};

/**
 * Renders full HTML email from _base.html layout with dynamic variables.
 */
export const renderEmailLayout = (options: IRenderEmailOptions): string => {
  let template = loadBaseTemplate();

  const currentYear = new Date().getFullYear().toString();
  const preheader = options.preheader || options.title;
  const actionButtonHtml = options.actionButton
    ? buildActionButtonHtml(options.actionButton.text, options.actionButton.url)
    : '';

  const replacements: Record<string, string> = {
    title: options.title,
    preheader: preheader,
    content: options.content,
    action_button: actionButtonHtml,
    support_email: emailConfig.supportEmail,
    app_url: emailConfig.appUrl,
    current_year: currentYear,
  };

  // Merge extra variables if provided
  if (options.variables) {
    for (const [key, value] of Object.entries(options.variables)) {
      if (value !== undefined) {
        replacements[key] = String(value);
      }
    }
  }

  // Replace all {{key}} tags
  for (const [key, value] of Object.entries(replacements)) {
    const regex = new RegExp(`{{${key}}}`, 'g');
    template = template.replace(regex, value);
  }

  return template;
};

import nodemailer from 'nodemailer';
import { emailConfig } from '../config/email';
import { renderEmailLayout, IRenderEmailOptions } from './renderer';
import { EmailLog, EmailTemplateName, IEmailLogMetadata, IEmailLogDocument } from '../models/EmailLog';

let transporter: nodemailer.Transporter | null = null;

const getTransporter = (): nodemailer.Transporter => {
  if (transporter) {
    return transporter;
  }

  if (emailConfig.smtp) {
    transporter = nodemailer.createTransport({
      host: emailConfig.smtp.host,
      port: emailConfig.smtp.port,
      secure: emailConfig.smtp.secure,
      auth: emailConfig.smtp.auth,
    });
  } else {
    // Development fallback: json transport for logging without throwing
    transporter = nodemailer.createTransport({
      jsonTransport: true,
    });
  }

  return transporter;
};

export interface ISendEmailOptions {
  to: string;
  templateName: EmailTemplateName;
  subject: string;
  renderOptions: IRenderEmailOptions;
  metadata?: IEmailLogMetadata;
}

export interface ISendEmailResult {
  logId: string;
  status: 'QUEUED';
}

/**
 * Dispatches an email asynchronously in the background.
 * Guarantees that the caller is NEVER blocked and errors NEVER crash the caller.
 */
export const sendEmailAsync = async (options: ISendEmailOptions): Promise<ISendEmailResult> => {
  const { to, templateName, subject, renderOptions, metadata = {} } = options;

  let logRecord: IEmailLogDocument | null = null;
  try {
    // 1. Immediately record PENDING log in MongoDB
    logRecord = await EmailLog.create({
      recipientEmail: to.toLowerCase().trim(),
      templateName,
      subject,
      status: 'PENDING',
      metadata,
    });
  } catch (dbError) {
    console.error('[Email Sender] Failed to create initial EmailLog entry:', dbError);
  }

  const logId = logRecord ? String(logRecord._id) : 'unlogged';

  // 2. Dispatch sending in a non-blocking detached background task
  setImmediate(async () => {
    try {
      const html = renderEmailLayout(renderOptions);
      const mailTransporter = getTransporter();

      const mailOptions = {
        from: `"${emailConfig.fromName}" <${emailConfig.fromEmail}>`,
        to,
        subject,
        html,
      };

      const info = await mailTransporter.sendMail(mailOptions);

      if (!emailConfig.smtp) {
        console.log(`[Email Sender DEV MODE] Email "${subject}" dispatched to ${to}. MessageId: ${info.messageId}`);
      }

      // 3. Mark as SENT in MongoDB
      if (logRecord) {
        await EmailLog.findByIdAndUpdate(logRecord._id, {
          status: 'SENT',
          sentAt: new Date(),
        });
      }
    } catch (sendError: any) {
      console.error(`[Email Sender] Error sending email to ${to} (${templateName}):`, sendError.message);

      // 4. Record failure in MongoDB without crashing the app
      if (logRecord) {
        try {
          await EmailLog.findByIdAndUpdate(logRecord._id, {
            status: 'FAILED',
            errorMessage: sendError.message || 'Unknown delivery failure',
            $inc: { retryCount: 1 },
          });
        } catch (updateError) {
          console.error('[Email Sender] Failed to update failed status in EmailLog:', updateError);
        }
      }
    }
  });

  return {
    logId,
    status: 'QUEUED',
  };
};

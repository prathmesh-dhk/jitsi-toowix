import mongoose, { Document, Schema, Model, Types } from 'mongoose';

export type EmailTemplateName =
  | 'E1_VERIFY_EMAIL'
  | 'E2_REG_RECEIVED'
  | 'E3_REG_APPROVED'
  | 'E4_REG_REJECTED'
  | 'E5_USER_SIGNIN'
  | 'E6_ADMIN_SIGNIN'
  | 'E7_PASSWORD_RESET'
  | 'E8_INVITE_MEMBER'
  | 'E9_MEETING_INVITE'
  | 'E10_2FA_ENABLED';

export type EmailDeliveryStatus = 'PENDING' | 'SENT' | 'FAILED';

export interface IEmailLogMetadata {
  userId?: Types.ObjectId | string;
  companyId?: Types.ObjectId | string;
  ipAddress?: string;
  userAgent?: string;
  context?: Record<string, unknown>;
}

export interface IEmailLog {
  recipientEmail: string;
  templateName: EmailTemplateName;
  subject: string;
  status: EmailDeliveryStatus;
  errorMessage?: string | null;
  retryCount: number;
  metadata?: IEmailLogMetadata;
  sentAt?: Date | null;
  createdAt: Date;
}

export interface IEmailLogDocument extends IEmailLog, Document {}

const EmailLogSchema = new Schema<IEmailLogDocument>(
  {
    recipientEmail: {
      type: String,
      required: [true, 'Recipient email is required'],
      lowercase: true,
      trim: true,
      index: true,
    },
    templateName: {
      type: String,
      enum: [
        'E1_VERIFY_EMAIL',
        'E2_REG_RECEIVED',
        'E3_REG_APPROVED',
        'E4_REG_REJECTED',
        'E5_USER_SIGNIN',
        'E6_ADMIN_SIGNIN',
        'E7_PASSWORD_RESET',
        'E8_INVITE_MEMBER',
        'E9_MEETING_INVITE',
        'E10_2FA_ENABLED',
      ],
      required: [true, 'Email template name is required'],
      index: true,
    },
    subject: {
      type: String,
      required: [true, 'Subject is required'],
      trim: true,
    },
    status: {
      type: String,
      enum: ['PENDING', 'SENT', 'FAILED'],
      default: 'PENDING',
      index: true,
    },
    errorMessage: {
      type: String,
      default: null,
    },
    retryCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: () => ({}),
    },
    sentAt: {
      type: Date,
      default: null,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: false,
    toJSON: {
      virtuals: true,
      transform: (_, ret: any) => {
        ret.id = ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

EmailLogSchema.index({ status: 1, createdAt: 1 });
EmailLogSchema.index({ 'metadata.userId': 1 });
EmailLogSchema.index({ 'metadata.companyId': 1 });

export const EmailLog: Model<IEmailLogDocument> =
  mongoose.models.EmailLog || mongoose.model<IEmailLogDocument>('EmailLog', EmailLogSchema);

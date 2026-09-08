import mongoose, { Document, Schema, Model } from 'mongoose';

export type CompanyStatus = 'PENDING' | 'ACTIVE' | 'REJECTED' | 'SUSPENDED';
export type CompanyPlan = 'FREE' | 'PRO' | 'ENTERPRISE';

export interface ICompanyFeatureFlags {
  recordingEnabled: boolean;
  customBranding: boolean;
  sipDialIn: boolean;
  lobbyEnabled: boolean;
}

export interface ICompanyLimits {
  maxUsers: number;
  maxMeetingDurationMinutes: number | null;
  storageLimitBytes: number;
  recordingRetentionDays: number;
  featureFlags: ICompanyFeatureFlags;
}

export type MeetingCreatorRole = 'COMPANY_ADMIN' | 'HOST' | 'MEMBER';

export interface ICompanyMeetingPolicy {
  whoCanHost: MeetingCreatorRole[];
  whoCanCreateMeetings: MeetingCreatorRole[];
  allowGuestAccess: boolean;
  requireLobby: boolean;
  recordingEnabled: boolean;
  autoRecording: boolean;
  allowScreenShare: boolean;
  micLockEnabled: boolean;
  maxMeetingDurationMinutes: number | null;
  require2FA: boolean;
}

export interface ICompany {
  name: string;
  slug: string;
  logoUrl?: string | null;
  status: CompanyStatus;
  rejectionReason?: string | null;
  plan: CompanyPlan;
  limits: ICompanyLimits;
  meetingPolicy: ICompanyMeetingPolicy;
  suspendedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICompanyDocument extends ICompany, Document {}

const CompanyLimitsSchema = new Schema<ICompanyLimits>(
  {
    maxUsers: {
      type: Number,
      default: 50,
      min: 1,
    },
    maxMeetingDurationMinutes: {
      type: Number,
      default: 60,
    },
    storageLimitBytes: {
      type: Number,
      default: 5368709120, // 5 GB
      min: 0,
    },
    recordingRetentionDays: {
      type: Number,
      default: 30,
      min: 1,
    },
    featureFlags: {
      recordingEnabled: { type: Boolean, default: true },
      customBranding: { type: Boolean, default: false },
      sipDialIn: { type: Boolean, default: false },
      lobbyEnabled: { type: Boolean, default: true },
    },
  },
  { _id: false }
);

const CompanySchema = new Schema<ICompanyDocument>(
  {
    name: {
      type: String,
      required: [true, 'Company name is required'],
      trim: true,
      maxlength: [255, 'Company name cannot exceed 255 characters'],
    },
    slug: {
      type: String,
      required: [true, 'Company slug is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[a-z0-9-]+$/, 'Slug can only contain lowercase alphanumeric characters and hyphens'],
      index: true,
    },
    logoUrl: {
      type: String,
      default: null,
      trim: true,
    },
    status: {
      type: String,
      enum: ['PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED'],
      default: 'PENDING',
      index: true,
    },
    rejectionReason: {
      type: String,
      default: null,
      trim: true,
    },
    plan: {
      type: String,
      enum: ['FREE', 'PRO', 'ENTERPRISE'],
      default: 'FREE',
    },
    limits: {
      type: CompanyLimitsSchema,
      default: () => ({}),
    },
    meetingPolicy: {
      whoCanHost: { type: [String], enum: ['COMPANY_ADMIN', 'HOST', 'MEMBER'], default: ['COMPANY_ADMIN', 'HOST', 'MEMBER'] },
      whoCanCreateMeetings: { type: [String], enum: ['COMPANY_ADMIN', 'HOST', 'MEMBER'], default: ['COMPANY_ADMIN', 'HOST', 'MEMBER'] },
      allowGuestAccess: { type: Boolean, default: true },
      requireLobby: { type: Boolean, default: false },
      recordingEnabled: { type: Boolean, default: true },
      autoRecording: { type: Boolean, default: false },
      allowScreenShare: { type: Boolean, default: true },
      micLockEnabled: { type: Boolean, default: true },
      maxMeetingDurationMinutes: { type: Number, default: null },
      require2FA: { type: Boolean, default: false },
    },
    suspendedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
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

CompanySchema.index({ status: 1, createdAt: -1 });
CompanySchema.index({ createdAt: -1 });

export const Company: Model<ICompanyDocument> =
  mongoose.models.Company || mongoose.model<ICompanyDocument>('Company', CompanySchema);

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

export interface ICompany {
  name: string;
  slug: string;
  logoUrl?: string | null;
  status: CompanyStatus;
  rejectionReason?: string | null;
  plan: CompanyPlan;
  limits: ICompanyLimits;
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

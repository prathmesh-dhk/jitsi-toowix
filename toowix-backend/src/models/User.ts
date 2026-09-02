import mongoose, { Document, Schema, Model, Types } from 'mongoose';

export type UserRole = 'SUPER_ADMIN' | 'COMPANY_ADMIN' | 'HOST' | 'MEMBER';
export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'INACTIVE';
export type OAuthProvider = 'google' | 'microsoft';

export interface IOAuthIdentity {
  provider: OAuthProvider;
  providerUserId: string;
  providerEmail: string;
  createdAt: Date;
}

export interface IUserTwoFactor {
  isEnabled: boolean;
  totpSecret?: string | null;
}

export interface IUser {
  firebaseUid: string;
  companyId?: Types.ObjectId | null;
  email: string;
  fullName: string;
  avatarUrl?: string | null;
  role: UserRole;
  status: UserStatus;
  emailVerifiedAt?: Date | null;
  twoFactor: IUserTwoFactor;
  forcePasswordReset: boolean;
  oauthIdentities: IOAuthIdentity[];
  suspendedAt?: Date | null;
  reportsTo?: Types.ObjectId | null;
  lastActiveAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IUserDocument extends IUser, Document {}

const OAuthIdentitySchema = new Schema<IOAuthIdentity>(
  {
    provider: {
      type: String,
      enum: ['google', 'microsoft'],
      required: true,
    },
    providerUserId: {
      type: String,
      required: true,
    },
    providerEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const UserSchema = new Schema<IUserDocument>(
  {
    firebaseUid: {
      type: String,
      required: [true, 'Firebase UID is required'],
      unique: true,
      trim: true,
      index: true,
    },
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      default: null,
      index: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address'],
    },
    fullName: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true,
      maxlength: [255, 'Full name cannot exceed 255 characters'],
    },
    avatarUrl: {
      type: String,
      default: null,
      trim: true,
    },
    role: {
      type: String,
      enum: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'HOST', 'MEMBER'],
      default: 'MEMBER',
      index: true,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'SUSPENDED', 'INACTIVE'],
      default: 'ACTIVE',
      index: true,
    },
    emailVerifiedAt: {
      type: Date,
      default: null,
    },
    twoFactor: {
      isEnabled: {
        type: Boolean,
        default: false,
      },
      totpSecret: {
        type: String,
        default: null,
      },
    },
    forcePasswordReset: {
      type: Boolean,
      default: false,
    },
    oauthIdentities: {
      type: [OAuthIdentitySchema],
      default: [],
    },
    suspendedAt: {
      type: Date,
      default: null,
    },
    reportsTo: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    lastActiveAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_, ret: any) => {
        ret.id = ret._id;
        delete ret.__v;
        if (ret.twoFactor) {
          delete ret.twoFactor.totpSecret;
        }
        return ret;
      },
    },
  }
);

UserSchema.index({ companyId: 1, role: 1 });
UserSchema.index({ 'oauthIdentities.provider': 1, 'oauthIdentities.providerUserId': 1 });

export const User: Model<IUserDocument> =
  mongoose.models.User || mongoose.model<IUserDocument>('User', UserSchema);

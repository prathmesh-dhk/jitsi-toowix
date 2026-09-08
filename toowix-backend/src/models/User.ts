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

export interface IUserProfileExtra {
  phoneNumber?: string | null;
  jobTitle?: string | null;
  timezone?: string;
  language?: string;
}

export interface IUserPreferences {
  dateFormat?: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
  timeFormat?: '12h' | '24h';
  weekStartsOn?: 'SUNDAY' | 'MONDAY';
  appearance?: 'light' | 'dark' | 'system';
  reduceMotion?: boolean;
  highContrast?: boolean;
}

export interface IMeetingDefaults {
  cameraOffOnJoin?: boolean;
  useHdVideo?: boolean;
  mirrorMyVideo?: boolean;
  displayParticipantNames?: boolean;
  muteMicOnJoin?: boolean;
  autoAdjustMicVolume?: boolean;
  playJoinLeaveSounds?: boolean;
  noiseSuppression?: boolean;
  requireLobby?: boolean;
  allowJoinBeforeHost?: boolean;
  requireAuthenticatedUsers?: boolean;
  allowExternalGuests?: boolean;
  autoAdmitInternalUsers?: boolean;
  notifyHostOnLobbyEntry?: boolean;
  defaultDurationMinutes?: number;
  defaultMeetingType?: 'Internal' | 'Guest';
}

export interface IRecordingPreferences {
  autoRecordOwnMeetings?: boolean;
  recordActiveSpeakerAndScreen?: boolean;
  recordGallery?: boolean;
  generateAudioOnly?: boolean;
  generateTranscript?: boolean;
  generateCaptions?: boolean;
  includeChatInResources?: boolean;
  quality?: '720p' | '1080p';
  layout?: 'ActiveSpeaker' | 'Gallery' | 'SharedScreenWithSpeaker';
  retentionDays?: 30 | 60 | 90 | 180 | 0; // 0 = keep until manually deleted
  allowParticipantDownload?: boolean;
  allowExternalGuestAccess?: boolean;
}

export interface INotificationPreferenceEntry {
  inApp: boolean;
  email: boolean;
}

export interface INotificationPreferences {
  muteAll?: boolean;
  reminderMinutesBefore?: 5 | 10 | 15 | 30 | 60;
  entries?: Record<string, INotificationPreferenceEntry>;
  // Snapshot of individual toggles taken right before "mute all" was turned on,
  // restored when it's turned back off -- so unmuting doesn't just enable everything.
  preMuteSnapshot?: Record<string, INotificationPreferenceEntry> | null;
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
  profileExtra?: IUserProfileExtra;
  preferences?: IUserPreferences;
  meetingDefaults?: IMeetingDefaults;
  recordingPreferences?: IRecordingPreferences;
  notificationPreferences?: INotificationPreferences;
  passwordChangedAt?: Date | null;
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
    profileExtra: {
      phoneNumber: { type: String, default: null, trim: true },
      jobTitle: { type: String, default: null, trim: true },
      timezone: { type: String, default: 'UTC' },
      language: { type: String, default: 'en' },
    },
    preferences: {
      dateFormat: { type: String, enum: ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'], default: 'DD/MM/YYYY' },
      timeFormat: { type: String, enum: ['12h', '24h'], default: '12h' },
      weekStartsOn: { type: String, enum: ['SUNDAY', 'MONDAY'], default: 'SUNDAY' },
      appearance: { type: String, enum: ['light', 'dark', 'system'], default: 'system' },
      reduceMotion: { type: Boolean, default: false },
      highContrast: { type: Boolean, default: false },
    },
    meetingDefaults: {
      cameraOffOnJoin: { type: Boolean, default: false },
      useHdVideo: { type: Boolean, default: true },
      mirrorMyVideo: { type: Boolean, default: true },
      displayParticipantNames: { type: Boolean, default: true },
      muteMicOnJoin: { type: Boolean, default: false },
      autoAdjustMicVolume: { type: Boolean, default: true },
      playJoinLeaveSounds: { type: Boolean, default: true },
      noiseSuppression: { type: Boolean, default: true },
      requireLobby: { type: Boolean, default: false },
      allowJoinBeforeHost: { type: Boolean, default: true },
      requireAuthenticatedUsers: { type: Boolean, default: false },
      allowExternalGuests: { type: Boolean, default: true },
      autoAdmitInternalUsers: { type: Boolean, default: true },
      notifyHostOnLobbyEntry: { type: Boolean, default: true },
      defaultDurationMinutes: { type: Number, default: 30 },
      defaultMeetingType: { type: String, enum: ['Internal', 'Guest'], default: 'Internal' },
    },
    recordingPreferences: {
      autoRecordOwnMeetings: { type: Boolean, default: false },
      recordActiveSpeakerAndScreen: { type: Boolean, default: true },
      recordGallery: { type: Boolean, default: false },
      generateAudioOnly: { type: Boolean, default: false },
      generateTranscript: { type: Boolean, default: false },
      generateCaptions: { type: Boolean, default: false },
      includeChatInResources: { type: Boolean, default: false },
      quality: { type: String, enum: ['720p', '1080p'], default: '1080p' },
      layout: { type: String, enum: ['ActiveSpeaker', 'Gallery', 'SharedScreenWithSpeaker'], default: 'ActiveSpeaker' },
      retentionDays: { type: Number, enum: [30, 60, 90, 180, 0], default: 90 },
      allowParticipantDownload: { type: Boolean, default: true },
      allowExternalGuestAccess: { type: Boolean, default: false },
    },
    notificationPreferences: {
      muteAll: { type: Boolean, default: false },
      reminderMinutesBefore: { type: Number, enum: [5, 10, 15, 30, 60], default: 10 },
      entries: { type: Schema.Types.Mixed, default: {} },
      preMuteSnapshot: { type: Schema.Types.Mixed, default: null },
    },
    passwordChangedAt: {
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

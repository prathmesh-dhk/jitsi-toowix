import mongoose, { Document, Schema, Model, Types } from 'mongoose';

export type MeetingType = 'Internal' | 'Guest' | 'Private';

export interface IMeetingParticipant {
  name: string;
  email: string;
  avatarUrl?: string | null;
  role: 'Organizer' | 'Co-host' | 'Participant';
  joinedAt?: Date | null;
  leftAt?: Date | null;
  timeSpentMinutes?: number | null;
  attendanceStatus?: string;
}

export interface IMeeting {
  companyId?: Types.ObjectId | null;
  createdBy: Types.ObjectId;
  name: string;
  roomSlug: string;
  type: MeetingType;
  scheduledAt?: Date | null;
  durationMinutes?: number | null;
  cancelledAt?: Date | null;
  notified60?: boolean;
  notified10?: boolean;
  notifiedNow?: boolean;
  actualStartedAt?: Date | null;
  actualEndedAt?: Date | null;
  description?: string | null;
  invitees?: string[];
  recurrence?: {
    frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY';
    seriesId: string;
    until?: Date | null;
  } | null;
  participants?: IMeetingParticipant[];
  resources?: {
    recordingUrl?: string | null;
    transcriptUrl?: string | null;
    chatUrl?: string | null;
    sharedFilesUrl?: string | null;
    notesUrl?: string | null;
    recordingAllowDownload?: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface IMeetingDocument extends IMeeting, Document {}

const MeetingSchema = new Schema<IMeetingDocument>(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      default: null,
      index: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Meeting name is required'],
      trim: true,
      maxlength: [255, 'Meeting name cannot exceed 255 characters'],
    },
    roomSlug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['Internal', 'Guest', 'Private'],
      default: 'Internal',
    },
    scheduledAt: {
      type: Date,
      default: null,
      index: true,
    },
    durationMinutes: {
      type: Number,
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    notified60: { type: Boolean, default: false },
    notified10: { type: Boolean, default: false },
    notifiedNow: { type: Boolean, default: false },
    actualStartedAt: { type: Date, default: null },
    actualEndedAt: { type: Date, default: null },
    description: { type: String, default: null, trim: true, maxlength: 2000 },
    invitees: { type: [String], default: undefined }, // undefined (not []) means "no invitee restriction" for non-Private types
    recurrence: {
      type: {
        frequency: { type: String, enum: ['DAILY', 'WEEKLY', 'MONTHLY'] },
        seriesId: { type: String },
        until: { type: Date, default: null },
      },
      default: null,
    },
    participants: {
      type: [{
        name: { type: String, required: true },
        email: { type: String, required: true },
        avatarUrl: { type: String, default: null },
        role: { type: String, enum: ['Organizer', 'Co-host', 'Participant'], default: 'Participant' },
        joinedAt: { type: Date, default: null },
        leftAt: { type: Date, default: null },
        timeSpentMinutes: { type: Number, default: null, min: 0 },
        attendanceStatus: { type: String, default: 'Unknown' },
      }],
      default: [],
    },
    resources: {
      recordingUrl: { type: String, default: null },
      transcriptUrl: { type: String, default: null },
      chatUrl: { type: String, default: null },
      sharedFilesUrl: { type: String, default: null },
      notesUrl: { type: String, default: null },
      recordingAllowDownload: { type: Boolean, default: false },
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

MeetingSchema.index({ companyId: 1, createdAt: -1 });
MeetingSchema.index({ createdBy: 1, createdAt: -1 });
MeetingSchema.index({ 'recurrence.seriesId': 1 });

export const Meeting: Model<IMeetingDocument> =
  mongoose.models.Meeting || mongoose.model<IMeetingDocument>('Meeting', MeetingSchema);

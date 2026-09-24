import mongoose, { Document, Schema, Model, Types } from 'mongoose';

export type MeetingType = 'Personal' | 'Internal' | 'Guest' | 'Private';

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
  passcode?: string | null;
  lockedPassword?: string | null;
  recordingHoldUntil?: Date | null;
  rsvps?: Array<{
    email: string;
    status: 'accepted' | 'declined' | 'pending';
    respondedAt?: Date;
  }>;
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
  notes?: string | null;
  transcriptText?: string | null;
  sharedFiles?: Array<{
    name: string;
    url: string;
    size?: string;
    sharedBy?: string;
    sharedAt?: string;
  }>;
  // Only populated for meetings that exist as a Meeting document (created from the dashboard --
  // "New Meeting" or "Schedule for later"). A room joined straight from the public homepage's
  // free instant-meeting link has no Meeting document at all, so its chat is never written here
  // and is destroyed with the in-memory signaling buffer once the meeting ends.
  chatMessages?: Array<{
    id: string;
    senderName: string;
    senderId?: string | null;
    text?: string | null;
    imageUrl?: string | null;
    audioUrl?: string | null;
    audioDuration?: number | null;
    mentions?: string[];
    createdAt: Date;
  }>;
  // One entry per person who has opened this conversation, so the sender's view can show a
  // WhatsApp-style read receipt (blue double-check once the other side's lastReadAt is at or
  // after the message's createdAt).
  chatReadReceipts?: Array<{
    viewerId: string;
    viewerName: string;
    lastReadAt: Date;
  }>;
  // Conversation ownership is deliberately separate from the meeting organizer. It lets an
  // organizer leave the saved chat while keeping the meeting record and its audit trail intact.
  conversationAdminEmail?: string | null;
  waitingQueue?: Array<{
    id: string;
    name: string;
    email?: string;
    requestedAt: Date;
    status: 'WAITING' | 'ADMITTED' | 'DENIED';
    admittedAt?: Date | null;
    deniedAt?: Date | null;
    jitsiToken?: string | null;
    attendanceToken?: string | null;
    participantEntryId?: string | null;
  }>;
  hostAnnouncement?: string | null;
  hostJoined?: boolean;
  quickAccessEnabled?: boolean;
  endedAt?: Date | null;
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
      enum: ['Personal', 'Internal', 'Guest', 'Private'],
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
    passcode: { type: String, default: null, trim: true },
    // Set by the host mid-meeting ("Lock meeting"); overrides passcode and forces the waiting room.
    lockedPassword: { type: String, default: null, trim: true },
    // While in the future the meeting must not be deleted: a recording is running or still being processed.
    recordingHoldUntil: { type: Date, default: null },
    rsvps: {
      type: [{
        email: { type: String, required: true },
        status: { type: String, enum: ['accepted', 'declined', 'pending'], default: 'pending' },
        respondedAt: { type: Date, default: Date.now },
      }],
      default: [],
    },
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
    notes: { type: String, default: null },
    transcriptText: { type: String, default: null },
    sharedFiles: {
      type: [{
        name: { type: String, required: true },
        url: { type: String, required: true },
        size: { type: String, default: '1.2 MB' },
        sharedBy: { type: String, default: 'Participant' },
        sharedAt: { type: String, default: null },
      }],
      default: [],
    },
    chatMessages: {
      type: [{
        id: { type: String, required: true },
        senderName: { type: String, required: true },
        senderId: { type: String, default: null },
        text: { type: String, default: null },
        imageUrl: { type: String, default: null },
        audioUrl: { type: String, default: null },
        audioDuration: { type: Number, default: null },
        mentions: { type: [String], default: [] },
        createdAt: { type: Date, default: Date.now },
      }],
      default: [],
    },
    chatReadReceipts: {
      type: [{
        viewerId: { type: String, required: true },
        viewerName: { type: String, required: true },
        lastReadAt: { type: Date, default: Date.now },
      }],
      default: [],
    },
    conversationAdminEmail: { type: String, default: null, trim: true, lowercase: true },
    waitingQueue: {
      type: [{
        id: { type: String, required: true },
        name: { type: String, required: true },
        email: { type: String, default: '' },
        requestedAt: { type: Date, default: Date.now },
        status: { type: String, enum: ['WAITING', 'ADMITTED', 'DENIED'], default: 'WAITING' },
        admittedAt: { type: Date, default: null },
        deniedAt: { type: Date, default: null },
        jitsiToken: { type: String, default: null },
        attendanceToken: { type: String, default: null },
        participantEntryId: { type: String, default: null },
      }],
      default: [],
    },
    hostAnnouncement: { type: String, default: null },
    hostJoined: { type: Boolean, default: false },
    quickAccessEnabled: { type: Boolean, default: true },
    endedAt: { type: Date, default: null },
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

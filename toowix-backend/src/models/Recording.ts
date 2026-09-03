import mongoose, { Document, Schema, Model, Types } from 'mongoose';

export interface IRecording {
  companyId?: Types.ObjectId | null;
  meetingId?: Types.ObjectId | null;
  createdBy: Types.ObjectId;
  name: string;
  recordedAt: Date;
  durationMinutes: number;
  sizeBytes: number;
  fileUrl?: string | null;
  audioUrl?: string | null;
  audioSizeBytes?: number | null;
  transcriptUrl?: string | null;
  transcriptSizeBytes?: number | null;
  transcriptFormat?: 'TXT' | 'PDF';
  captionsUrl?: string | null;
  captionsSizeBytes?: number | null;
  captionsFormat?: 'VTT' | 'SRT';
  chatUrl?: string | null;
  chatSizeBytes?: number | null;
  archiveUrl?: string | null;
  archiveSizeBytes?: number | null;
  folder?: string;
  allowDownload?: boolean;
  allowShare?: boolean;
  sharedWith?: string[]; // specific emails granted access, in addition to owner/company admins
  createdAt: Date;
  updatedAt: Date;
}

export interface IRecordingDocument extends IRecording, Document {}

const RecordingSchema = new Schema<IRecordingDocument>(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      default: null,
      index: true,
    },
    meetingId: {
      type: Schema.Types.ObjectId,
      ref: 'Meeting',
      default: null,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Recording name is required'],
      trim: true,
      maxlength: [255, 'Recording name cannot exceed 255 characters'],
    },
    recordedAt: {
      type: Date,
      required: true,
      index: true,
    },
    durationMinutes: {
      type: Number,
      required: true,
      min: 0,
    },
    sizeBytes: {
      type: Number,
      required: true,
      min: 0,
    },
    fileUrl: {
      type: String,
      default: null,
    },
    audioUrl: { type: String, default: null },
    audioSizeBytes: { type: Number, default: null, min: 0 },
    transcriptUrl: { type: String, default: null },
    transcriptSizeBytes: { type: Number, default: null, min: 0 },
    transcriptFormat: { type: String, enum: ['TXT', 'PDF'], default: 'TXT' },
    captionsUrl: { type: String, default: null },
    captionsSizeBytes: { type: Number, default: null, min: 0 },
    captionsFormat: { type: String, enum: ['VTT', 'SRT'], default: 'VTT' },
    chatUrl: { type: String, default: null },
    chatSizeBytes: { type: Number, default: null, min: 0 },
    archiveUrl: { type: String, default: null },
    archiveSizeBytes: { type: Number, default: null, min: 0 },
    folder: { type: String, default: '', trim: true },
    allowDownload: { type: Boolean, default: false },
    allowShare: { type: Boolean, default: false },
    sharedWith: { type: [String], default: [] },
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

RecordingSchema.index({ companyId: 1, recordedAt: -1 });
RecordingSchema.index({ createdBy: 1, recordedAt: -1 });

export const Recording: Model<IRecordingDocument> =
  mongoose.models.Recording || mongoose.model<IRecordingDocument>('Recording', RecordingSchema);

import mongoose, { Document, Schema, Types } from 'mongoose';

// A snapshot of "who owns the recording" taken when a host starts recording. A meeting document can be
// deleted before the recorder finishes processing (instant meetings are destroyed the moment the host
// ends them, scheduled ones shortly after their end time), so the recording ingest falls back to this
// snapshot instead of failing with "meeting not found".
export interface IRecordingHold {
  roomSlug: string;
  meetingId?: Types.ObjectId | null;
  companyId?: Types.ObjectId | null;
  createdBy: Types.ObjectId;
  name: string;
  expiresAt: Date;
}

export interface IRecordingHoldDocument extends IRecordingHold, Document {}

const RecordingHoldSchema = new Schema<IRecordingHoldDocument>(
  {
    roomSlug: { type: String, required: true, lowercase: true, trim: true, index: true },
    meetingId: { type: Schema.Types.ObjectId, ref: 'Meeting', default: null },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true },
    // Kept for a week after the recording, then removed automatically.
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  },
  { timestamps: true }
);

export const RecordingHold = mongoose.models.RecordingHold || mongoose.model<IRecordingHoldDocument>('RecordingHold', RecordingHoldSchema);

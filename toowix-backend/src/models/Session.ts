import mongoose, { Document, Schema, Model, Types } from 'mongoose';

export interface ISession {
  userId: Types.ObjectId;
  sessionToken: string; // opaque token stored client-side (localStorage) to identify "this" session
  userAgent: string;
  browser?: string;
  os?: string;
  ipAddress: string;
  createdAt: Date;
  lastSeenAt: Date;
  revokedAt?: Date | null;
}

export interface ISessionDocument extends ISession, Document {}

const SessionSchema = new Schema<ISessionDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    sessionToken: { type: String, required: true, unique: true, index: true },
    userAgent: { type: String, required: true },
    browser: { type: String, default: 'Unknown' },
    os: { type: String, default: 'Unknown' },
    ipAddress: { type: String, required: true },
    lastSeenAt: { type: Date, default: Date.now },
    revokedAt: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
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

SessionSchema.index({ userId: 1, revokedAt: 1, lastSeenAt: -1 });

export const Session: Model<ISessionDocument> =
  mongoose.models.Session || mongoose.model<ISessionDocument>('Session', SessionSchema);

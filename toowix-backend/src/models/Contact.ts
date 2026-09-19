import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IContact {
  ownerId: Types.ObjectId;
  name: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IContactDocument extends IContact, Document {}

const ContactSchema = new Schema<IContactDocument>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
  },
  { timestamps: true }
);

// One entry per email in each person's own contact book.
ContactSchema.index({ ownerId: 1, email: 1 }, { unique: true });

export const Contact = mongoose.models.Contact || mongoose.model<IContactDocument>('Contact', ContactSchema);

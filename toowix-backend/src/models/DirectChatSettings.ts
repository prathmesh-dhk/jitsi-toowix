import mongoose, { Document, Model, Schema, Types } from 'mongoose';

// One document per (person, conversation): that person's OWN choices about the chat -- mute, clear, delete,
// block. Deliberately separate from DirectConversation (shared by both people) so one person clearing or muting
// a chat never changes what the other person sees.
export interface IDirectChatSettings {
  userId: Types.ObjectId;
  conversationId: Types.ObjectId;
  // Notifications are silenced until this time ("Always" is far in the future). null = not muted.
  mutedUntil: Date | null;
  // Messages up to this moment are hidden for this person ("Clear chat").
  clearedAt: Date | null;
  // The chat is removed from this person's list until a newer message arrives ("Delete chat").
  hiddenAt: Date | null;
  // This person blocked the other: no messages or calls either way.
  blocked: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IDirectChatSettingsDocument extends IDirectChatSettings, Document {}

const DirectChatSettingsSchema = new Schema<IDirectChatSettingsDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    conversationId: { type: Schema.Types.ObjectId, ref: 'DirectConversation', required: true },
    mutedUntil: { type: Date, default: null },
    clearedAt: { type: Date, default: null },
    hiddenAt: { type: Date, default: null },
    blocked: { type: Boolean, default: false },
  },
  { timestamps: true },
);

DirectChatSettingsSchema.index({ userId: 1, conversationId: 1 }, { unique: true });

export const MUTE_FOREVER = new Date('9999-12-31T00:00:00.000Z');

export const DirectChatSettings: Model<IDirectChatSettingsDocument> =
  mongoose.models.DirectChatSettings
  || mongoose.model<IDirectChatSettingsDocument>('DirectChatSettings', DirectChatSettingsSchema);

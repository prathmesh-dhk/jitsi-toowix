import mongoose, { Document, Model, Schema, Types } from 'mongoose';

export const DIRECT_MESSAGE_MAX_LENGTH = 4000;

// A "call" message is the entry a voice/video call leaves in the chat (Calling... / Missed / Declined / Answered).
export type DirectCallMode = 'video' | 'voice';
export type DirectCallStatus = 'ringing' | 'answered' | 'declined' | 'missed' | 'cancelled';

export interface IDirectCallInfo {
  mode: DirectCallMode;
  status: DirectCallStatus;
  // The throwaway meeting room behind the call. Never sent in chat history -- only to the two people, when the call starts.
  roomSlug: string;
  answeredAt?: Date | null;
}

export interface IDirectMessage {
  conversationId: Types.ObjectId;
  senderId: Types.ObjectId;
  recipientId: Types.ObjectId;
  text: string;
  kind: 'text' | 'call';
  call?: IDirectCallInfo | null;
  // Client-generated id used only to make a retried send idempotent (a flaky network re-posting the
  // same message must never create a duplicate). Unique per sender, never shown to anyone.
  clientId?: string | null;
  // WhatsApp-style receipts: null -> one grey tick, deliveredAt -> two grey ticks, readAt -> two blue.
  deliveredAt: Date | null;
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IDirectMessageDocument extends IDirectMessage, Document {}

const DirectMessageSchema = new Schema<IDirectMessageDocument>(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: 'DirectConversation', required: true },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    recipientId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    text: { type: String, required: true, maxlength: DIRECT_MESSAGE_MAX_LENGTH },
    kind: { type: String, enum: [ 'text', 'call' ], default: 'text' },
    call: {
      type: new Schema<IDirectCallInfo>(
        {
          mode: { type: String, enum: [ 'video', 'voice' ], required: true },
          status: { type: String, enum: [ 'ringing', 'answered', 'declined', 'missed', 'cancelled' ], required: true },
          roomSlug: { type: String, required: true },
          answeredAt: { type: Date, default: null },
        },
        { _id: false },
      ),
      default: undefined,
    },
    clientId: { type: String, default: undefined, maxlength: 64 },
    deliveredAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
  },
  { timestamps: true },
);

DirectMessageSchema.index({ conversationId: 1, createdAt: -1, _id: -1 });
// Serves the unread counts (per conversation and in total) derived from readAt.
DirectMessageSchema.index({ recipientId: 1, readAt: 1, conversationId: 1 });
// Partial (not sparse) so only messages that actually carry a clientId take part in the uniqueness.
DirectMessageSchema.index(
  { senderId: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: 'string' } } },
);

export type DirectMessageStatus = 'sent' | 'delivered' | 'read';

export const directMessageStatus = (message: { deliveredAt?: Date | null; readAt?: Date | null }): DirectMessageStatus => {
  if (message.readAt) return 'read';
  if (message.deliveredAt) return 'delivered';
  return 'sent';
};

export const DirectMessage: Model<IDirectMessageDocument> =
  mongoose.models.DirectMessage || mongoose.model<IDirectMessageDocument>('DirectMessage', DirectMessageSchema);

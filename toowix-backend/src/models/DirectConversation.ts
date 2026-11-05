import mongoose, { Document, Model, Schema, Types } from 'mongoose';

// One document per PAIR of users (1:1 direct chat, WhatsApp-style). `participantKey` is the two user
// ids sorted and joined, with a unique index, so two people can never end up with two parallel
// conversations even if both open the chat at the same instant. Unread counts are deliberately NOT
// stored here: they are derived from DirectMessage.readAt, so they can never drift out of sync.
export interface IDirectLastMessage {
  messageId: Types.ObjectId;
  senderId: Types.ObjectId;
  text: string;
  at: Date;
}

export interface IDirectConversation {
  participantKey: string;
  participants: Types.ObjectId[];
  lastMessage: IDirectLastMessage | null;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IDirectConversationDocument extends IDirectConversation, Document {}

const LastMessageSchema = new Schema<IDirectLastMessage>(
  {
    messageId: { type: Schema.Types.ObjectId, ref: 'DirectMessage', required: true },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, default: '' },
    at: { type: Date, required: true },
  },
  { _id: false },
);

const DirectConversationSchema = new Schema<IDirectConversationDocument>(
  {
    participantKey: { type: String, required: true, unique: true },
    participants: { type: [ Schema.Types.ObjectId ], ref: 'User', required: true },
    lastMessage: { type: LastMessageSchema, default: null },
    lastMessageAt: { type: Date, default: null },
  },
  { timestamps: true },
);

DirectConversationSchema.index({ participants: 1, lastMessageAt: -1 });

export const buildParticipantKey = (a: string, b: string): string => [ String(a), String(b) ].sort().join(':');

export const DirectConversation: Model<IDirectConversationDocument> =
  mongoose.models.DirectConversation
  || mongoose.model<IDirectConversationDocument>('DirectConversation', DirectConversationSchema);

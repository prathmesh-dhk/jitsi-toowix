import mongoose, { Document, Schema, Model, Types } from 'mongoose';

export type NotificationCategory = 'MEETINGS' | 'RECORDINGS' | 'PEOPLE_TEAMS' | 'SECURITY' | 'SYSTEM';

export type NotificationType =
  // Meetings
  | 'MEETING_STARTS_IN_60' | 'MEETING_STARTS_IN_10' | 'MEETING_STARTS_NOW' | 'MEETING_INVITATION' | 'MEETING_RESCHEDULED'
  | 'MEETING_CANCELLED' | 'MEETING_LINK_UPDATED' | 'MEETING_REMOVED' | 'MEETING_ORGANIZER_STARTED'
  | 'PARTICIPANT_REQUESTED_JOIN' | 'GUEST_WAITING_IN_LOBBY'
  // Recordings
  | 'RECORDING_STARTED' | 'RECORDING_STOPPED' | 'RECORDING_PROCESSING' | 'RECORDING_READY'
  | 'RECORDING_FAILED' | 'RECORDING_SHARED' | 'RECORDING_EXPIRING' | 'RECORDING_DELETED_BY_ADMIN'
  // People & Teams
  | 'USER_ADDED_TO_ORG' | 'USER_INVITE_PENDING' | 'USER_ACCEPTED_INVITE' | 'USER_REMOVED'
  | 'ROLE_CHANGED' | 'USER_ADDED_UNDER_ADMIN' | 'USER_MOVED_ADMIN' | 'USER_DISABLED' | 'TEAM_MEMBER_JOINED_LEFT'
  // Security
  | 'NEW_LOGIN' | 'NEW_DEVICE_LOGIN' | 'FAILED_LOGIN_ATTEMPTS' | 'PASSWORD_CHANGED'
  | 'SSO_CONNECTED' | 'SUSPICIOUS_MEETING_ACCESS' | 'UNKNOWN_GUEST_JOINED'
  // System
  | 'STORAGE_THRESHOLD' | 'MEETING_SERVICE_DOWN' | 'RECORDING_SERVICE_DOWN' | 'MAINTENANCE_SCHEDULED' | 'EXPORT_READY';

export type NotificationAction = 'Join' | 'Review' | 'View' | 'Download' | null;

export interface INotification {
  userId: Types.ObjectId;
  companyId?: Types.ObjectId | null;
  category: NotificationCategory;
  type: NotificationType;
  title: string;
  description: string;
  relatedName?: string | null;
  actionLabel?: NotificationAction;
  actionUrl?: string | null;
  isRead: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface INotificationDocument extends INotification, Document {}

const NotificationSchema = new Schema<INotificationDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', default: null, index: true },
    category: {
      type: String,
      enum: ['MEETINGS', 'RECORDINGS', 'PEOPLE_TEAMS', 'SECURITY', 'SYSTEM'],
      required: true,
      index: true,
    },
    type: { type: String, required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    relatedName: { type: String, default: null },
    actionLabel: { type: String, enum: ['Join', 'Review', 'View', 'Download', null], default: null },
    actionUrl: { type: String, default: null },
    isRead: { type: Boolean, default: false, index: true },
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

NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, isRead: 1 });

export const Notification: Model<INotificationDocument> =
  mongoose.models.Notification || mongoose.model<INotificationDocument>('Notification', NotificationSchema);

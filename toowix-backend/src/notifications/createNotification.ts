import { Types } from 'mongoose';
import { Notification, NotificationCategory, NotificationType, NotificationAction } from '../models/Notification';
import { User } from '../models/User';

interface ICreateNotificationInput {
  userId: Types.ObjectId | string;
  companyId?: Types.ObjectId | string | null;
  category: NotificationCategory;
  type: NotificationType;
  title: string;
  description: string;
  relatedName?: string;
  actionLabel?: NotificationAction;
  actionUrl?: string;
}

/** Creates one notification for one user. Never throws -- notification delivery must
 * never break the real action (meeting created, role changed, etc.) that triggered it. */
export const notifyUser = async (input: ICreateNotificationInput): Promise<void> => {
  try {
    await Notification.create(input);
  } catch (error: any) {
    console.error('[Notifications] Failed to create notification:', error.message);
  }
};

/** Creates the same notification for every user in a company, optionally excluding one
 * (typically the user who performed the action, so they don't get notified of their own change). */
export const notifyCompany = async (
  companyId: Types.ObjectId | string,
  input: Omit<ICreateNotificationInput, 'userId' | 'companyId'>,
  excludeUserId?: Types.ObjectId | string
): Promise<void> => {
  try {
    const users = await User.find({ companyId, ...(excludeUserId ? { _id: { $ne: excludeUserId } } : {}) }).select('_id');
    await Notification.insertMany(users.map((u) => ({ ...input, userId: u._id, companyId })));
  } catch (error: any) {
    console.error('[Notifications] Failed to notify company:', error.message);
  }
};

import { Types } from 'mongoose';
import { Notification, NotificationCategory, NotificationType, NotificationAction } from '../models/Notification';
import { User } from '../models/User';

// All business rules for notifications -- the create helpers used across the rest of the
// backend (notifyUser/notifyCompany), plus the caller-facing list/read endpoints -- live here as
// plain functions. No `req`/`res` anywhere in this file; notification.controller.ts parses HTTP
// in for the three list/read endpoints, calls one of these, and sends the result back out.

export interface IServiceResult<T = any> {
  body: T;
  httpStatus: number;
}

interface ICreateNotificationInput {
  actionLabel?: NotificationAction;
  actionUrl?: string;
  category: NotificationCategory;
  companyId?: Types.ObjectId | string | null;
  description: string;
  relatedName?: string;
  title: string;
  type: NotificationType;
  userId: Types.ObjectId | string;
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

async function resolveUser(firebaseUid: string | undefined) {
  if (!firebaseUid) return null;
  return User.findOne({ firebaseUid });
}

/** Lists the caller's own notifications, newest first. */
export async function listNotifications(firebaseUid: string | undefined, category: unknown, unreadOnly: unknown): Promise<IServiceResult> {
  try {
    const user = await resolveUser(firebaseUid);
    if (!user) {
      return { body: { error: 'User profile not found' }, httpStatus: 404 };
    }

    const filter: Record<string, unknown> = { userId: user._id };
    if (category && category !== 'ALL') filter.category = category;
    if (unreadOnly === 'true') filter.isRead = false;

    const [ notifications, unreadCount ] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).limit(100),
      Notification.countDocuments({ userId: user._id, isRead: false }),
    ]);

    return { body: { notifications, unreadCount }, httpStatus: 200 };
  } catch (error: any) {
    console.error('[Notifications] Error listing notifications:', error.message);
    return { body: { error: 'Failed to fetch notifications' }, httpStatus: 500 };
  }
}

/** Marks one of the caller's own notifications as read. */
export async function markRead(firebaseUid: string | undefined, notificationId: string): Promise<IServiceResult> {
  try {
    const user = await resolveUser(firebaseUid);
    if (!user) {
      return { body: { error: 'User profile not found' }, httpStatus: 404 };
    }
    const notification = await Notification.findOne({ _id: notificationId, userId: user._id });
    if (!notification) {
      return { body: { error: 'Notification not found' }, httpStatus: 404 };
    }
    notification.isRead = true;
    await notification.save();
    return { body: { notification }, httpStatus: 200 };
  } catch (error: any) {
    console.error('[Notifications] Error marking notification read:', error.message);
    return { body: { error: 'Failed to update notification' }, httpStatus: 500 };
  }
}

/** Marks every unread notification belonging to the caller as read. */
export async function markAllRead(firebaseUid: string | undefined): Promise<IServiceResult> {
  try {
    const user = await resolveUser(firebaseUid);
    if (!user) {
      return { body: { error: 'User profile not found' }, httpStatus: 404 };
    }
    await Notification.updateMany({ userId: user._id, isRead: false }, { isRead: true });
    return { body: { message: 'All notifications marked as read' }, httpStatus: 200 };
  } catch (error: any) {
    console.error('[Notifications] Error marking all read:', error.message);
    return { body: { error: 'Failed to update notifications' }, httpStatus: 500 };
  }
}

import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { User } from '../models/User';
import { Notification } from '../models/Notification';

const resolveUser = async (req: AuthenticatedRequest) => {
  if (!req.firebaseUid) return null;
  return User.findOne({ firebaseUid: req.firebaseUid });
};

/**
 * GET /api/notifications?category=MEETINGS&unread=true
 * Lists the caller's own notifications, newest first.
 */
export const listNotificationsHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user = await resolveUser(req);
    if (!user) {
      res.status(404).json({ error: 'User profile not found' });
      return;
    }

    const filter: Record<string, unknown> = { userId: user._id };
    if (req.query.category && req.query.category !== 'ALL') filter.category = req.query.category;
    if (req.query.unread === 'true') filter.isRead = false;

    const [notifications, unreadCount] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).limit(100),
      Notification.countDocuments({ userId: user._id, isRead: false }),
    ]);

    res.json({ notifications, unreadCount });
  } catch (error: any) {
    console.error('[Notifications] Error listing notifications:', error.message);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
};

/**
 * POST /api/notifications/:id/read
 */
export const markReadHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user = await resolveUser(req);
    if (!user) {
      res.status(404).json({ error: 'User profile not found' });
      return;
    }
    const notification = await Notification.findOne({ _id: req.params.id, userId: user._id });
    if (!notification) {
      res.status(404).json({ error: 'Notification not found' });
      return;
    }
    notification.isRead = true;
    await notification.save();
    res.json({ notification });
  } catch (error: any) {
    console.error('[Notifications] Error marking notification read:', error.message);
    res.status(500).json({ error: 'Failed to update notification' });
  }
};

/**
 * POST /api/notifications/mark-all-read
 */
export const markAllReadHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user = await resolveUser(req);
    if (!user) {
      res.status(404).json({ error: 'User profile not found' });
      return;
    }
    await Notification.updateMany({ userId: user._id, isRead: false }, { isRead: true });
    res.json({ message: 'All notifications marked as read' });
  } catch (error: any) {
    console.error('[Notifications] Error marking all read:', error.message);
    res.status(500).json({ error: 'Failed to update notifications' });
  }
};

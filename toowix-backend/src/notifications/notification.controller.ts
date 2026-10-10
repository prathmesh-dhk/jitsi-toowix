import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import * as notificationService from './notification.service';

// Every function here does exactly one thing: parse the HTTP request, call one
// notification.service.ts function, and send the result back out. No business logic lives in
// this file -- see notification.service.ts for the actual rules.

/**
 * GET /api/notifications?category=MEETINGS&unread=true
 * Lists the caller's own notifications, newest first.
 */
export const listNotificationsHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await notificationService.listNotifications(req.firebaseUid, req.query.category, req.query.unread);
  res.status(result.httpStatus).json(result.body);
};

/**
 * POST /api/notifications/:id/read
 */
export const markReadHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await notificationService.markRead(req.firebaseUid, req.params.id);
  res.status(result.httpStatus).json(result.body);
};

/**
 * POST /api/notifications/mark-all-read
 */
export const markAllReadHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await notificationService.markAllRead(req.firebaseUid);
  res.status(result.httpStatus).json(result.body);
};

import { Router } from 'express';
import { verifyFirebaseToken } from '../middleware/auth';
import { notificationsRateLimiter } from '../middleware/rateLimit';
import { listNotificationsHandler, markReadHandler, markAllReadHandler } from '../notifications/notification.controller';

const router = Router();

// Rate limiter is registered AFTER verifyFirebaseToken so it can key by the signed-in user
// (see keyByUserOrIp in middleware/rateLimit.ts) instead of falling back to per-IP.
router.get('/', verifyFirebaseToken, notificationsRateLimiter, listNotificationsHandler);
router.post('/mark-all-read', verifyFirebaseToken, notificationsRateLimiter, markAllReadHandler);
router.post('/:id/read', verifyFirebaseToken, notificationsRateLimiter, markReadHandler);

export default router;

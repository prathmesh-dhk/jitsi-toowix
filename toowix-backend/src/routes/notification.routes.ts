import { Router } from 'express';
import { verifyFirebaseToken } from '../middleware/auth';
import { listNotificationsHandler, markReadHandler, markAllReadHandler } from '../notifications/notifications';

const router = Router();

router.get('/', verifyFirebaseToken, listNotificationsHandler);
router.post('/mark-all-read', verifyFirebaseToken, markAllReadHandler);
router.post('/:id/read', verifyFirebaseToken, markReadHandler);

export default router;

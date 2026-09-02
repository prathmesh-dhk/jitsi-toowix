import { Router } from 'express';
import { verifyFirebaseToken } from '../middleware/auth';
import {
  createMeetingHandler,
  listMeetingsHandler,
  updateMeetingHandler,
  cancelMeetingHandler,
  deleteMeetingHandler,
} from '../meetings/meetings';

const router = Router();

router.get('/', verifyFirebaseToken, listMeetingsHandler);
router.post('/', verifyFirebaseToken, createMeetingHandler);
router.patch('/:id', verifyFirebaseToken, updateMeetingHandler);
router.post('/:id/cancel', verifyFirebaseToken, cancelMeetingHandler);
router.delete('/:id', verifyFirebaseToken, deleteMeetingHandler);

export default router;

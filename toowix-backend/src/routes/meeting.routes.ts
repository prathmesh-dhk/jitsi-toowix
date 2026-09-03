import { Router } from 'express';
import { verifyFirebaseToken } from '../middleware/auth';
import {
  createMeetingHandler,
  listMeetingsHandler,
  updateMeetingHandler,
  cancelMeetingHandler,
  deleteMeetingHandler,
  getMeetingByRoomSlugHandler,
  recordAttendanceJoinHandler,
  recordAttendanceLeaveHandler,
} from '../meetings/meetings';

const router = Router();

router.get('/room/:roomSlug', getMeetingByRoomSlugHandler); // public, no auth -- guests need this too
router.post('/room/:roomSlug/attendance/join', recordAttendanceJoinHandler); // public, no auth
router.post('/room/:roomSlug/attendance/leave', recordAttendanceLeaveHandler); // public, no auth
router.get('/', verifyFirebaseToken, listMeetingsHandler);
router.post('/', verifyFirebaseToken, createMeetingHandler);
router.patch('/:id', verifyFirebaseToken, updateMeetingHandler);
router.post('/:id/cancel', verifyFirebaseToken, cancelMeetingHandler);
router.delete('/:id', verifyFirebaseToken, deleteMeetingHandler);

export default router;

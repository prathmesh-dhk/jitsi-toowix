import { Router } from 'express';
import { verifyFirebaseToken } from '../middleware/auth';
import {
  createTeamInviteHandler,
  deleteTeamInviteHandler,
  listTeamUsersHandler,
  resendTeamInviteHandler,
  updateTeamUserHandler,
} from '../team/team';

const router = Router();

router.get('/users', verifyFirebaseToken, listTeamUsersHandler);
router.post('/invites', verifyFirebaseToken, createTeamInviteHandler);
router.post('/invites/:id/resend', verifyFirebaseToken, resendTeamInviteHandler);
router.delete('/invites/:id', verifyFirebaseToken, deleteTeamInviteHandler);
router.patch('/users/:id', verifyFirebaseToken, updateTeamUserHandler);

export default router;

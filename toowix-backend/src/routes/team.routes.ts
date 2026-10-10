import { Router } from 'express';
import { verifyFirebaseToken } from '../middleware/auth';
import { teamRateLimiter } from '../middleware/rateLimit';
import {
  createTeamInviteHandler,
  deleteTeamInviteHandler,
  listTeamUsersHandler,
  resendTeamInviteHandler,
  updateTeamUserHandler,
} from '../team/team.controller';

const router = Router();

// teamRateLimiter is registered AFTER verifyFirebaseToken so it can key by the signed-in user
// (see keyByUserOrIp in middleware/rateLimit.ts) instead of falling back to per-IP.
router.get('/users', verifyFirebaseToken, teamRateLimiter, listTeamUsersHandler);
router.post('/invites', verifyFirebaseToken, teamRateLimiter, createTeamInviteHandler);
router.post('/invites/:id/resend', verifyFirebaseToken, teamRateLimiter, resendTeamInviteHandler);
router.delete('/invites/:id', verifyFirebaseToken, teamRateLimiter, deleteTeamInviteHandler);
router.patch('/users/:id', verifyFirebaseToken, teamRateLimiter, updateTeamUserHandler);

export default router;

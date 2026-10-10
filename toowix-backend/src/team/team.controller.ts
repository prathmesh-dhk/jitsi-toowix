import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import * as teamService from './team.service';

// Every function here does exactly one thing: parse the HTTP request, call one
// team.service.ts function, and send the result back out. No business logic lives in this
// file -- see team.service.ts for the actual rules (manager checks, role/reporting validation).

/**
 * GET /api/team
 * Lists live workspace users and pending invitations.
 */
export const listTeamUsersHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await teamService.listTeamUsers(req.firebaseUid);
  res.status(result.httpStatus).json(result.body);
};

/**
 * POST /api/team/invite
 * Creates and emails a seven-day workspace invitation.
 */
export const createTeamInviteHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { fullName, email, role, reportsTo } = req.body;
  const result = await teamService.createTeamInvite(req.firebaseUid, { fullName, email, role, reportsTo });
  res.status(result.httpStatus).json(result.body);
};

/**
 * PATCH /api/team/:id
 * Reassigns role, reporting manager, or status for a live member or pending invite.
 */
export const updateTeamUserHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { role, reportsTo, status } = req.body;
  const result = await teamService.updateTeamUser(req.firebaseUid, req.params.id, { role, reportsTo, status });
  res.status(result.httpStatus).json(result.body);
};

/**
 * POST /api/team/invite/:id/resend
 */
export const resendTeamInviteHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await teamService.resendTeamInvite(req.firebaseUid, req.params.id);
  res.status(result.httpStatus).json(result.body);
};

/**
 * DELETE /api/team/invite/:id
 */
export const deleteTeamInviteHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await teamService.deleteTeamInvite(req.firebaseUid, req.params.id);
  res.status(result.httpStatus).json(result.body);
};

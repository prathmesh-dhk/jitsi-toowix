import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';
import * as meetingService from './meeting.service';

// Every function here does exactly one thing: parse the HTTP request, call one meeting.service.ts
// function, and send the result back out. No business logic lives in this file -- see
// meeting.service.ts for the actual rules (validation, policy checks, persistence, notifications).

/**
 * POST /api/meetings
 * Creates a meeting (instant or scheduled) tied to the caller's company (or
 * to the caller directly, for a standalone user with no company workspace).
 */
export const createMeetingHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await meetingService.createMeeting({ firebaseUid: req.firebaseUid, ...req.body });
  res.status(result.httpStatus).json(result.body);
};

/**
 * GET /api/meetings
 * Lists meetings visible to the caller: every meeting for their company workspace,
 * or just their own meetings if they have no company (standalone user).
 */
export const listMeetingsHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await meetingService.listMeetings(req.firebaseUid);
  res.status(result.httpStatus).json(result.body);
};

/**
 * GET /api/meetings/:id
 * Returns a specific meeting with fully resolved recording, resources, notes, and attendance.
 */
export const getMeetingHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await meetingService.getMeeting(req.params.id, req.firebaseUid);
  res.status(result.httpStatus).json(result.body);
};

/**
 * GET /api/meetings/conversations
 * Lightweight list of meetings (visible to the caller) that have at least one saved chat message
 * -- powers the Dashboard's "Conversations" tab.
 */
export const listConversationsHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await meetingService.listConversations(req.firebaseUid);
  res.status(result.httpStatus).json(result.body);
};

/**
 * POST /api/meetings/:id/conversation/leave
 * Transfers chat administration to an existing participant before the current administrator
 * removes this conversation from their own list.
 */
export const leaveConversationHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await meetingService.leaveConversation(req.params.id, req.firebaseUid, String(req.body?.nextAdminEmail || ''));
  res.status(result.httpStatus).json(result.body);
};

/**
 * PATCH /api/meetings/:id
 * Edit a meeting's name/schedule/duration/type/notes/resources. Organizer (creator) or company admin only.
 */
export const updateMeetingHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await meetingService.updateMeeting(req.params.id, req.firebaseUid, req.body);
  res.status(result.httpStatus).json(result.body);
};

/**
 * POST /api/meetings/:id/cancel
 * Marks an upcoming meeting cancelled (soft) instead of deleting it. Organizer/admin only.
 */
export const cancelMeetingHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await meetingService.cancelMeeting(req.params.id, req.firebaseUid);
  res.status(result.httpStatus).json(result.body);
};

/**
 * DELETE /api/meetings/:id
 * Permanently deletes a meeting record (used for "Delete meeting history" on past meetings).
 * Organizer/admin only.
 */
export const deleteMeetingHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await meetingService.deleteMeeting(req.params.id, req.firebaseUid);
  res.status(result.httpStatus).json(result.body);
};

/**
 * POST /api/meetings/room/:roomSlug/invite  { emails: string[] }
 * Emails the meeting invitation (with Accept / Decline links) to more people, from the in-call
 * "Add others" dialog or the share dialog.
 */
export const inviteToMeetingHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const room = String(req.params.roomSlug).toLowerCase();
  const account: any = req.accountUser;
  const rawEmails = Array.isArray(req.body?.emails) ? req.body.emails : [];
  const result = await meetingService.inviteToMeeting(room, account?.id, rawEmails);
  res.status(result.httpStatus).json(result.body);
};

/**
 * POST /api/meetings/rsvp or GET /api/meetings/rsvp
 * Public endpoint for accepting or declining a meeting invitation.
 */
export const rsvpMeetingHandler = async (req: Request, res: Response): Promise<void> => {
  const meetingId = req.body?.meetingId || req.query?.meetingId;
  const email = req.body?.email || req.query?.email;
  const response = req.body?.response || req.query?.response;
  const wantsHtmlRedirect = req.method === 'GET' && req.accepts('html');

  const result = await meetingService.submitRsvp(meetingId, email, response, Boolean(wantsHtmlRedirect));
  if (result.kind === 'redirect') {
    res.redirect(result.url);
  } else {
    res.status(result.httpStatus).json(result.body);
  }
};

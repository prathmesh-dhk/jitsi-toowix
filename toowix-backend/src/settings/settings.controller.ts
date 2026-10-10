import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import * as settingsService from './settings.service';

// Every function here does exactly one thing: parse the HTTP request (including pulling the
// avatar upload's requestOrigin and the X-Toowix-Session header out of `req` where a function
// needs them), call one settings.service.ts function, and send the result back out. No business
// logic lives in this file -- see settings.service.ts for the actual rules.

/**
 * GET /api/settings
 */
export const getSettingsHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await settingsService.getSettings(req.firebaseUid);
  res.status(result.httpStatus).json(result.body);
};

/**
 * PATCH /api/settings/profile
 */
export const updateProfileSettingsHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { fullName, avatarUrl, phoneNumber, jobTitle, timezone, language } = req.body;
  const requestOrigin = `${req.protocol}://${req.get('host')}`;
  const result = await settingsService.updateProfileSettings(req.firebaseUid, {
    fullName, avatarUrl, phoneNumber, jobTitle, timezone, language, requestOrigin,
  });
  res.status(result.httpStatus).json(result.body);
};

/**
 * PATCH /api/settings/general
 */
export const updateGeneralSettingsHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await settingsService.updateGeneralSettings(req.firebaseUid, req.body);
  res.status(result.httpStatus).json(result.body);
};

/**
 * PATCH /api/settings/meetings
 */
export const updateMeetingSettingsHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await settingsService.updateMeetingSettings(req.firebaseUid, req.body);
  res.status(result.httpStatus).json(result.body);
};

/**
 * PATCH /api/settings/recording
 */
export const updateRecordingSettingsHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await settingsService.updateRecordingSettings(req.firebaseUid, req.body);
  res.status(result.httpStatus).json(result.body);
};

/**
 * PATCH /api/settings/notifications
 */
export const updateNotificationSettingsHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await settingsService.updateNotificationSettings(req.firebaseUid, req.body);
  res.status(result.httpStatus).json(result.body);
};

/**
 * GET /api/settings/storage
 */
export const getStorageSettingsHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await settingsService.getStorageSettings(req.firebaseUid);
  res.status(result.httpStatus).json(result.body);
};

/**
 * POST /api/settings/security/password-changed
 */
export const recordPasswordChangedHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await settingsService.recordPasswordChanged(req.firebaseUid);
  res.status(result.httpStatus).json(result.body);
};

/**
 * POST /api/settings/security/deactivate
 */
export const deactivateAccountHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await settingsService.deactivateAccount(req.firebaseUid);
  res.status(result.httpStatus).json(result.body);
};

/**
 * GET /api/settings/security/sessions
 */
export const listSessionsHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await settingsService.listSessions(req.firebaseUid, req.get('X-Toowix-Session'));
  res.status(result.httpStatus).json(result.body);
};

/**
 * DELETE /api/settings/security/sessions/:id (or similar) -- revokes one session.
 */
export const revokeSessionHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await settingsService.revokeSession(req.firebaseUid, req.params.id);
  res.status(result.httpStatus).json(result.body);
};

/**
 * Revoke every other application session, keeping the caller's current one.
 */
export const revokeOtherSessionsHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await settingsService.revokeOtherSessions(req.firebaseUid, req.get('X-Toowix-Session'));
  res.status(result.httpStatus).json(result.body);
};

import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';
import * as accountService from './account.service';
import type { IRequestMeta } from './account.service';

// Every function here does exactly one thing: parse the HTTP request (including pulling
// userAgent/ip out of `req` where a handler needs them for session/email metadata), call one
// account.service.ts function, and send the result back out. No business logic lives in this
// file -- see account.service.ts for the actual rules.

function requestMeta(req: Request): IRequestMeta {
  return {
    ip: req.ip || 'Unknown',
    userAgent: String(req.headers['user-agent'] || ''),
  };
}

/**
 * POST /api/auth/login-gate
 * Tue-BE-2: The central login gate verifying authentication, email verification,
 * user status, and company approval lifecycle before issuing an application session.
 */
export const loginGateHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await accountService.evaluateLoginGate(req.firebaseUid, req.firebaseEmail, req.firebaseEmailVerified, requestMeta(req));
  res.status(result.httpStatus).json(result.body);
};

/**
 * POST /api/auth/signup
 * Tue-BE-1: Registers a new user record in MongoDB linked to their Firebase UID.
 */
export const signupHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { fullName, avatarUrl, inviteId } = req.body;
  const result = await accountService.signup({
    firebaseUid: req.firebaseUid,
    email: req.firebaseEmail,
    emailVerified: req.firebaseEmailVerified,
    fullName,
    avatarUrl,
    inviteId,
  });
  res.status(result.httpStatus).json(result.body);
};

/**
 * POST /api/auth/verify-email
 * Tue-BE-1: Synchronizes Firebase email verified status to MongoDB User model.
 */
export const verifyEmailHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await accountService.verifyEmail(req.firebaseUid, req.firebaseEmailVerified);
  res.status(result.httpStatus).json(result.body);
};

/**
 * POST /api/auth/forgot-password
 * Tue-BE-3: Request password reset link.
 */
export const forgotPasswordHandler = async (req: Request, res: Response): Promise<void> => {
  const result = await accountService.requestPasswordReset(req.body?.email, requestMeta(req));
  res.status(result.httpStatus).json(result.body);
};

/**
 * POST /api/auth/send-verification-email
 * Sends our own branded E1_VERIFY_EMAIL instead of relying on Firebase's default.
 */
export const sendVerificationEmailHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await accountService.resendVerificationEmail(req.firebaseUid, req.firebaseEmail, req.firebaseEmailVerified, requestMeta(req));
  res.status(result.httpStatus).json(result.body);
};

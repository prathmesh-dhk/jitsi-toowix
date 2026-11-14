import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';
import * as accountService from './account.service';
import type { IRequestMeta } from './account.service';
import { KeycloakAuthenticatedRequest } from '../../middleware/keycloakAuth';

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

type KeycloakLoginGate = typeof accountService.evaluateKeycloakLoginGate;
type KeycloakSelfLink = typeof accountService.linkOwnKeycloakIdentity;

/**
 * Factory keeps the HTTP handler thin and permits isolated tests without a real MongoDB
 * database. Production uses the existing account-service login gate unchanged.
 */
export const createKeycloakSessionHandler = (
  evaluateLoginGate: KeycloakLoginGate = accountService.evaluateKeycloakLoginGate,
) => async (req: KeycloakAuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.keycloakSub) {
    // This can only happen if the middleware was accidentally removed from the route.
    res.status(401).json({ error: 'Invalid or expired Keycloak access token' });
    return;
  }

  const result = await evaluateLoginGate(
    req.keycloakSub, req.keycloakRoles ?? [], req.keycloakEmail, req.keycloakEmailVerified ?? false, requestMeta(req),
  );
  res.status(result.httpStatus).json(result.body);
};

/** POST /api/auth/keycloak-session */
export const keycloakSessionHandler = createKeycloakSessionHandler();

/**
 * POST /api/auth/keycloak-link
 * Both prior middleware stages must succeed: Firebase/Toowix authentication establishes whose
 * account may be changed, then X-Keycloak-Authorization establishes the exact external `sub`.
 */
export const createKeycloakSelfLinkHandler = (
  linkOwnIdentity: KeycloakSelfLink = accountService.linkOwnKeycloakIdentity,
) => async (req: KeycloakAuthenticatedRequest, res: Response): Promise<void> => {
  const result = await linkOwnIdentity(req.firebaseUid, req.keycloakSub);
  res.status(result.httpStatus).json(result.body);
};

export const keycloakSelfLinkHandler = createKeycloakSelfLinkHandler();

/**
 * POST /api/auth/logout
 * Revokes this device's Meet session and, strictly and unconditionally, this same person's
 * Mail session too (by email) -- see account.service.ts's logoutAndRevokeEverywhere.
 */
export const logoutHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = (req.accountUser?.id as string | undefined);
  if (!userId) {
    res.status(200).json({ success: true });
    return;
  }
  const email = req.accountUser?.email as string | undefined;
  const sessionToken = req.get('X-Toowix-Session') || undefined;
  const result = await accountService.logoutAndRevokeEverywhere(userId, sessionToken, email);
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

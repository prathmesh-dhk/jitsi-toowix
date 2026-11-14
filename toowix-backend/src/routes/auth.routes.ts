import { Router } from 'express';
import { verifyIdentityToken, verifyFirebaseToken, AuthenticatedRequest } from '../middleware/auth';
import { requireKeycloakAccessToken, requireKeycloakLinkAccessToken } from '../middleware/keycloakAuth';
import { authRateLimiter } from '../middleware/rateLimit';
import {
  signupHandler,
  verifyEmailHandler,
  loginGateHandler,
  forgotPasswordHandler,
  sendVerificationEmailHandler,
  keycloakSessionHandler,
  keycloakSelfLinkHandler,
  logoutHandler,
} from '../auth/account/account.controller';

const router = Router();

// Tue-BE-1: Signup
router.post('/signup', authRateLimiter, verifyIdentityToken, signupHandler);

// Tue-BE-1: Email verification sync
router.post('/verify-email', verifyIdentityToken, verifyEmailHandler);

// Sends our own Toowix-branded E1 template instead of Firebase's default verification email.
// Only a valid Firebase ID token is required here (verifyIdentityToken), not a full app session
// or a verified email (verifyFirebaseToken) -- both callers (SignupPage right after account
// creation, and EmailVerificationPage's resend) need this to work precisely when no app session
// exists yet and the email is still unverified, which verifyFirebaseToken would reject.
router.post('/send-verification-email', verifyIdentityToken, sendVerificationEmailHandler);

// Tue-BE-2: Login Gate
router.post('/login-gate', authRateLimiter, verifyIdentityToken, loginGateHandler);

// The Keycloak resource-server middleware cryptographically verifies the external
// token before the existing account login gate sees its `sub` claim.
router.post('/keycloak-session', authRateLimiter, requireKeycloakAccessToken, keycloakSessionHandler);

// Linking is intentionally self-service only: Firebase/Toowix identifies the existing account,
// while X-Keycloak-Authorization independently proves the external identity to attach.
router.post('/keycloak-link', authRateLimiter, verifyFirebaseToken, requireKeycloakLinkAccessToken, keycloakSelfLinkHandler);

// Tue-BE-3: Forgot Password (public)
router.post('/forgot-password', authRateLimiter, forgotPasswordHandler);

router.get('/session', verifyFirebaseToken, (req: AuthenticatedRequest, res) => { res.json({ authorized: true, user: req.accountUser }); });

// Strict cross-app logout: revokes this device's session and, by email, this same person's
// Mail session too. Must still succeed locally even if the Mail-side call fails/times out.
router.post('/logout', verifyFirebaseToken, logoutHandler);

export default router;

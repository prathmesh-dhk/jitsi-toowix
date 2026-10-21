import { Router } from 'express';
import { verifyIdentityToken, verifyFirebaseToken, AuthenticatedRequest } from '../middleware/auth';
import { requireToowixAuth } from '../middleware/requireToowixAuth';
import { authRateLimiter } from '../middleware/rateLimit';
import {
  signupHandler,
  verifyEmailHandler,
  loginGateHandler,
  forgotPasswordHandler,
  sendVerificationEmailHandler,
  keycloakSessionHandler,
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

// Keycloak-authenticated counterpart to /login-gate -- local/dev-only prototype, see
// KEYCLOAK_INTEGRATION.md. requireToowixAuth verifies the Keycloak access token itself
// (signature/issuer/audience/expiry) before keycloakSessionHandler ever runs.
router.post('/keycloak-session', authRateLimiter, requireToowixAuth, keycloakSessionHandler);

// Tue-BE-3: Forgot Password (public)
router.post('/forgot-password', authRateLimiter, forgotPasswordHandler);

router.get('/session', verifyFirebaseToken, (req: AuthenticatedRequest, res) => { res.json({ authorized: true, user: req.accountUser }); });

export default router;

import { Router } from 'express';
import { verifyIdentityToken, verifyFirebaseToken, AuthenticatedRequest } from '../middleware/auth';
import { authRateLimiter } from '../middleware/rateLimit';
import {
  signupHandler,
  verifyEmailHandler,
  loginGateHandler,
  forgotPasswordHandler,
  sendVerificationEmailHandler,
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

// Tue-BE-3: Forgot Password (public)
router.post('/forgot-password', authRateLimiter, forgotPasswordHandler);

router.get('/session', verifyFirebaseToken, (req: AuthenticatedRequest, res) => { res.json({ authorized: true, user: req.accountUser }); });

export default router;

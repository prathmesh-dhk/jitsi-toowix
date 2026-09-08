import { Router } from 'express';
import { verifyIdentityToken, verifyFirebaseToken, AuthenticatedRequest } from '../middleware/auth';
import { signupHandler } from '../auth/signup';
import { verifyEmailHandler } from '../auth/verify-email';
import { loginGateHandler } from '../auth/login';
import { forgotPasswordHandler } from '../auth/forgot-password';
import { sendVerificationEmailHandler } from '../auth/send-verification-email';

const router = Router();

// Tue-BE-1: Signup
router.post('/signup', verifyIdentityToken, signupHandler);

// Tue-BE-1: Email verification sync
router.post('/verify-email', verifyIdentityToken, verifyEmailHandler);

// Sends our own Toowix-branded E1 template instead of Firebase's default verification email
router.post('/send-verification-email', verifyIdentityToken, sendVerificationEmailHandler);

// Tue-BE-2: Login Gate
router.post('/login-gate', verifyIdentityToken, loginGateHandler);

// Tue-BE-3: Forgot Password (public)
router.post('/forgot-password', forgotPasswordHandler);

router.get('/session', verifyFirebaseToken, (req: AuthenticatedRequest, res) => { res.json({ authorized: true, user: req.accountUser }); });

export default router;

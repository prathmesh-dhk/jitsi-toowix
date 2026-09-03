import { Router } from 'express';
import { verifyFirebaseToken } from '../middleware/auth';
import { signupHandler } from '../auth/signup';
import { verifyEmailHandler } from '../auth/verify-email';
import { loginGateHandler } from '../auth/login';
import { forgotPasswordHandler } from '../auth/forgot-password';
import { sendVerificationEmailHandler } from '../auth/send-verification-email';

const router = Router();

// Tue-BE-1: Signup
router.post('/signup', verifyFirebaseToken, signupHandler);

// Tue-BE-1: Email verification sync
router.post('/verify-email', verifyFirebaseToken, verifyEmailHandler);

// Sends our own Toowix-branded E1 template instead of Firebase's default verification email
router.post('/send-verification-email', verifyFirebaseToken, sendVerificationEmailHandler);

// Tue-BE-2: Login Gate
router.post('/login-gate', verifyFirebaseToken, loginGateHandler);

// Tue-BE-3: Forgot Password (public)
router.post('/forgot-password', forgotPasswordHandler);

export default router;

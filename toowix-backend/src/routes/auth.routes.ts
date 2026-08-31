import { Router } from 'express';
import { verifyFirebaseToken } from '../middleware/auth';
import { signupHandler } from '../auth/signup';
import { verifyEmailHandler } from '../auth/verify-email';
import { loginGateHandler } from '../auth/login';
import { forgotPasswordHandler } from '../auth/forgot-password';

const router = Router();

// Tue-BE-1: Signup
router.post('/signup', verifyFirebaseToken, signupHandler);

// Tue-BE-1: Email verification sync
router.post('/verify-email', verifyFirebaseToken, verifyEmailHandler);

// Tue-BE-2: Login Gate
router.post('/login-gate', verifyFirebaseToken, loginGateHandler);

// Tue-BE-3: Forgot Password (public)
router.post('/forgot-password', forgotPasswordHandler);

export default router;

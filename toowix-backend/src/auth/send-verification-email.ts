import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { User } from '../models/User';
import { sendEmailAsync } from '../email/sender';
import { getFirebaseAuth } from '../config/firebase';
import { emailConfig } from '../config/email';

/**
 * POST /api/auth/send-verification-email
 * Sends our own branded E1_VERIFY_EMAIL (Toowix, via our SMTP) instead of relying on
 * Firebase's default verification email. Mirrors the pattern already used in
 * forgot-password.ts: Admin SDK generates the real action link, our own sender delivers it.
 */
export const sendVerificationEmailHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.firebaseUid || !req.firebaseEmail) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (req.firebaseEmailVerified) {
      res.status(200).json({ message: 'Email is already verified', alreadyVerified: true });
      return;
    }

    const user = await User.findOne({ firebaseUid: req.firebaseUid });
    const email = req.firebaseEmail.toLowerCase();

    const auth = getFirebaseAuth();
    const verificationUrl = await auth.generateEmailVerificationLink(email, {
      url: `${emailConfig.appUrl}/verify-email`,
    });

    await sendEmailAsync({
      to: email,
      templateName: 'E1_VERIFY_EMAIL',
      subject: 'Verify your email address for Toowix Meet',
      templateVariables: {
        name: user?.fullName || email.split('@')[0],
        verification_url: verificationUrl,
      },
      metadata: { userId: user?._id, ipAddress: req.ip, userAgent: req.headers['user-agent'] },
    });

    res.status(200).json({ message: 'Verification email sent' });
  } catch (error: any) {
    console.error('[Send Verification Email] Error:', error.message);
    res.status(500).json({ error: 'Could not send verification email' });
  }
};

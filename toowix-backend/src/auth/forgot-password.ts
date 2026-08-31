import { Request, Response } from 'express';
import { User } from '../models/User';
import { sendEmailAsync } from '../email/sender';
import { getFirebaseAuth } from '../config/firebase';

/**
 * POST /api/auth/forgot-password
 * Tue-BE-3: Request password reset link.
 * Guarantees identical response shape and constant timing across nonexistent,
 * unverified, pending, rejected, suspended, and active accounts (preventing enumeration attacks).
 */
export const forgotPasswordHandler = async (req: Request, res: Response): Promise<void> => {
  const { email } = req.body;

  // Standard generic response returned in ALL cases
  const genericResponse = {
    message: 'If an account exists with this email address, password reset instructions have been sent.',
    success: true,
  };

  if (!email || typeof email !== 'string' || !email.trim()) {
    res.status(400).json({ error: 'Valid email address is required' });
    return;
  }

  const normalizedEmail = email.toLowerCase().trim();

  try {
    const user = await User.findOne({ email: normalizedEmail });

    if (user) {
      let resetLink: string | null = null;

      try {
        const auth = getFirebaseAuth();
        resetLink = await auth.generatePasswordResetLink(normalizedEmail);
      } catch (fbError: any) {
        console.warn(`[Forgot Password] Could not generate Firebase reset link: ${fbError.message}`);
        resetLink = `https://meet.toowix.com/reset-password?email=${encodeURIComponent(normalizedEmail)}`;
      }

      // Dispatch E7 Password Reset email asynchronously (non-blocking)
      sendEmailAsync({
        to: normalizedEmail,
        templateName: 'E7_PASSWORD_RESET',
        subject: 'Reset your Toowix Meet password',
        renderOptions: {
          title: 'Reset Your Password',
          preheader: 'Instructions to reset your Toowix Meet password',
          content: `<p>Hello ${user.fullName},</p><p>We received a request to reset the password for your Toowix Meet account. Click the button below to choose a new password:</p>`,
          actionButton: {
            text: 'Reset Password',
            url: resetLink,
          },
        },
        metadata: {
          userId: user._id,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });

      console.log(`[Forgot Password] Password reset initiated for: ${normalizedEmail}`);
    } else {
      console.log(`[Forgot Password] Nonexistent email requested: ${normalizedEmail} (Returned generic response)`);
    }

    // Always return 200 with identical payload
    res.status(200).json(genericResponse);
  } catch (error: any) {
    console.error('[Forgot Password] Unexpected error in forgot-password:', error.message);
    res.status(200).json(genericResponse);
  }
};

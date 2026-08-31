import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { User } from '../models/User';

/**
 * POST /api/auth/signup
 * Tue-BE-1: Registers a new user record in MongoDB linked to their Firebase UID.
 */
export const signupHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const firebaseUid = req.firebaseUid;
  const email = req.firebaseEmail;
  const emailVerified = req.firebaseEmailVerified;
  const { fullName, avatarUrl } = req.body;

  if (!firebaseUid || !email) {
    res.status(400).json({ error: 'Invalid authentication context' });
    return;
  }

  if (!fullName || typeof fullName !== 'string' || !fullName.trim()) {
    res.status(400).json({ error: 'Full name is required' });
    return;
  }

  try {
    const existingUser = await User.findOne({
      $or: [{ firebaseUid }, { email: email.toLowerCase().trim() }],
    });

    if (existingUser) {
      res.status(409).json({
        error: 'User already exists',
        user: existingUser,
      });
      return;
    }

    const newUser = await User.create({
      firebaseUid,
      email: email.toLowerCase().trim(),
      fullName: fullName.trim(),
      avatarUrl: avatarUrl || null,
      role: 'MEMBER',
      status: 'ACTIVE',
      emailVerifiedAt: emailVerified ? new Date() : null,
      twoFactor: {
        isEnabled: false,
      },
    });

    console.log(`[Signup] User registered: ${newUser.email} (ID: ${newUser._id})`);

    res.status(201).json({
      message: 'Signup successful',
      user: newUser,
    });
  } catch (error: any) {
    console.error('[Signup] Error during signup:', error.message);
    res.status(500).json({ error: 'Internal server error during signup' });
  }
};

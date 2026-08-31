import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { User } from '../models/User';

/**
 * POST /api/auth/verify-email
 * Tue-BE-1: Synchronizes Firebase email verified status to MongoDB User model.
 */
export const verifyEmailHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const firebaseUid = req.firebaseUid;
  const emailVerified = req.firebaseEmailVerified;

  if (!firebaseUid) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (!emailVerified) {
    res.status(400).json({
      error: 'Email is not yet verified in Firebase',
      status: 'UNVERIFIED',
    });
    return;
  }

  try {
    const user = await User.findOneAndUpdate(
      { firebaseUid },
      {
        $set: {
          emailVerifiedAt: new Date(),
        },
      },
      { new: true }
    );

    if (!user) {
      res.status(404).json({ error: 'User not found in database' });
      return;
    }

    console.log(`[Verify Email] User email verified in MongoDB: ${user.email}`);

    res.json({
      message: 'Email verification verified and synced successfully',
      status: 'VERIFIED',
      user,
    });
  } catch (error: any) {
    console.error('[Verify Email] Error syncing email verification:', error.message);
    res.status(500).json({ error: 'Internal server error during email verification' });
  }
};

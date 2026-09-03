import crypto from 'crypto';
import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { User, IUserDocument } from '../models/User';
import { Company, ICompanyDocument } from '../models/Company';
import { Session } from '../models/Session';
import { generateJitsiToken } from './jitsi-token';
import { getFirebaseAuth } from '../config/firebase';
import { parseUserAgent } from '../utils/parseUserAgent';

/** Records a real active-session entry for this login, so Settings > Security > Active
 * Sessions reflects genuine sign-ins instead of being empty/fabricated. Returns an opaque
 * token the client stores to identify "this" session for the current/revoke UI. */
const recordSession = async (userId: any, req: AuthenticatedRequest): Promise<string> => {
  const sessionToken = crypto.randomBytes(24).toString('hex');
  const ua = String(req.headers['user-agent'] || '');
  const { browser, os } = parseUserAgent(ua);
  try {
    await Session.create({
      userId,
      sessionToken,
      userAgent: ua,
      browser,
      os,
      ipAddress: req.ip || 'Unknown',
    });
  } catch (err: any) {
    console.error('[Login Gate] Failed to record session:', err.message);
  }
  return sessionToken;
};

export type LoginGateReasonCode =
  | 'INVALID_CREDENTIALS'
  | 'NOT_REGISTERED'
  | 'UNVERIFIED'
  | 'PENDING'
  | 'REJECTED'
  | 'SUSPENDED_COMPANY'
  | 'SUSPENDED_USER'
  | 'FORCE_PASSWORD_RESET';

/**
 * POST /api/auth/login-gate
 * Tue-BE-2: The central login gate verifying authentication, email verification,
 * user status, and company approval lifecycle before issuing access and Jitsi tokens.
 */
export const loginGateHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const firebaseUid = req.firebaseUid;
  const emailVerified = req.firebaseEmailVerified;

  if (!firebaseUid) {
    res.status(401).json({
      status: 'INVALID_CREDENTIALS',
      error: 'Authentication failed: Invalid credentials',
    });
    return;
  }

  try {
    // 1. Locate User in MongoDB
    let user: IUserDocument | null = await User.findOne({ firebaseUid });

    if (!user && req.firebaseEmail) {
      user = await User.findOne({ email: req.firebaseEmail.toLowerCase() });
      if (user) {
        user.firebaseUid = firebaseUid;
        await user.save();
      }
    }

    // No Mongo record for this Firebase account -- do NOT auto-provision.
    // The user must go through /api/auth/signup (+ company registration) first.
    if (!user) {
      res.status(404).json({
        status: 'NOT_REGISTERED',
        error: 'No account found for this sign-in. Please create an account first, then sign in.',
      });
      return;
    }

    // 2. Check Email Verification
    if (!emailVerified && !user.emailVerifiedAt) {
      res.status(403).json({
        status: 'UNVERIFIED',
        error: 'Please verify your email address before signing in',
        email: user.email,
      });
      return;
    }

    // Sync emailVerifiedAt if verified in Firebase
    if (emailVerified && !user.emailVerifiedAt) {
      user.emailVerifiedAt = new Date();
      await user.save();
    }

    // 3. Check User Status
    if (user.status === 'SUSPENDED') {
      res.status(403).json({
        status: 'SUSPENDED_USER',
        error: 'Your user account has been suspended by an administrator',
      });
      return;
    }

    // 4. Check Forced Password Reset
    if (user.forcePasswordReset) {
      res.status(403).json({
        status: 'FORCE_PASSWORD_RESET',
        error: 'You must reset your password before continuing',
      });
      return;
    }

    // 5. Super Admin Bypass for Independent Admin Accounts
    let company: ICompanyDocument | null = null;

    if (user.role === 'SUPER_ADMIN') {
      // Super Admin has global access
      const jitsiToken = generateJitsiToken({
        user: {
          id: String(user._id),
          name: user.fullName,
          email: user.email,
          avatar: user.avatarUrl,
        },
        features: {
          moderator: true,
          recording: true,
          screenShare: true,
        },
      });

      // Synchronize Firebase Custom Claims
      try {
        const auth = getFirebaseAuth();
        await auth.setCustomUserClaims(firebaseUid, {
          role: 'SUPER_ADMIN',
          companyId: null,
        });
      } catch (claimsError: any) {
        console.warn('[Login Gate] Could not set custom claims:', claimsError.message);
      }

      user.lastActiveAt = new Date();
      await user.save();
      const sessionToken = await recordSession(user._id, req);
      res.json({
        status: 'ACTIVE',
        user,
        company: null,
        jitsiToken,
        sessionToken,
      });
      return;
    }

    // 6. Check Company Association & Lifecycle Status
    if (!user.companyId) {
      // Check if a company exists with matching domain
      const domain = user.email ? user.email.split('@')[1]?.toLowerCase() : '';
      if (
        domain &&
        domain !== 'gmail.com' &&
        domain !== 'yahoo.com' &&
        domain !== 'outlook.com' &&
        domain !== 'hotmail.com'
      ) {
        const matchedCompany = await Company.findOne({
          $or: [{ allowedDomains: domain }, { slug: domain.split('.')[0] }],
        });
        if (matchedCompany) {
          user.companyId = matchedCompany._id as any;
          await user.save();
        }
      }
    }

    if (!user.companyId) {
      // Standalone user without company workspace — issue direct active token
      const jitsiToken = generateJitsiToken({
        user: {
          id: String(user._id),
          name: user.fullName,
          email: user.email,
          avatar: user.avatarUrl,
        },
        features: {
          moderator: false,
          recording: false,
          screenShare: true,
        },
      });

      user.lastActiveAt = new Date();
      await user.save();
      const sessionToken = await recordSession(user._id, req);
      res.json({
        status: 'ACTIVE',
        user,
        company: null,
        jitsiToken,
        sessionToken,
      });
      return;
    }

    company = await Company.findById(user.companyId);

    if (!company) {
      res.status(404).json({
        status: 'INVALID_CREDENTIALS',
        error: 'Associated company workspace not found',
      });
      return;
    }

    if (company.status === 'PENDING') {
      res.status(403).json({
        status: 'PENDING',
        error: 'Your company registration is pending Super Admin review and approval',
        company: {
          id: company._id,
          name: company.name,
          slug: company.slug,
          status: company.status,
        },
      });
      return;
    }

    if (company.status === 'REJECTED') {
      res.status(403).json({
        status: 'REJECTED',
        error: 'Your company registration was rejected by the administrator',
        rejectionReason: company.rejectionReason || null,
        company: {
          name: company.name,
          status: company.status,
        },
      });
      return;
    }

    if (company.status === 'SUSPENDED') {
      res.status(403).json({
        status: 'SUSPENDED_COMPANY',
        error: 'Your company workspace has been suspended',
        company: {
          name: company.name,
          status: company.status,
        },
      });
      return;
    }

    // 7. All checks passed: Issue session & Jitsi JWT
    const isModerator = user.role === 'COMPANY_ADMIN' || user.role === 'HOST';

    const jitsiToken = generateJitsiToken({
      user: {
        id: String(user._id),
        name: user.fullName,
        email: user.email,
        avatar: user.avatarUrl,
      },
      companyId: String(company._id),
      features: {
        moderator: isModerator,
        recording: company.limits?.featureFlags?.recordingEnabled ?? true,
        screenShare: true,
      },
    });

    // Sync Firebase Custom Claims
    try {
      const auth = getFirebaseAuth();
      await auth.setCustomUserClaims(firebaseUid, {
        role: user.role,
        companyId: String(company._id),
        companyStatus: company.status,
      });
    } catch (claimsError: any) {
      console.warn('[Login Gate] Could not set custom claims:', claimsError.message);
    }

    console.log(`[Login Gate PASS] ${user.email} logged in successfully for company ${company.name}`);

    user.lastActiveAt = new Date();
    await user.save();
    const sessionToken = await recordSession(user._id, req);
    res.json({
      status: 'ACTIVE',
      user,
      company,
      jitsiToken,
      sessionToken,
    });
  } catch (error: any) {
    console.error('[Login Gate] Error evaluating login gate:', error.message);
    res.status(500).json({ error: 'Internal server error evaluating login gate' });
  }
};

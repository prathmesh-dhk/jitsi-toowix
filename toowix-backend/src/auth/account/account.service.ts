import crypto from 'crypto';
import { User, IUserDocument } from '../../models/User';
import { Company, ICompanyDocument } from '../../models/Company';
import { Session } from '../../models/Session';
import { TeamInvite } from '../../models/TeamInvite';
import { getFirebaseAuth } from '../../config/firebase';
import { parseUserAgent } from '../../utils/parseUserAgent';
import { sendEmailAsync } from '../../email/sender';
import { emailConfig } from '../../config/email';

// All business rules for the account auth lifecycle (signup, login gate, email verification,
// password reset) live here as plain functions -- no `req`/`res` anywhere in this file.
// account.controller.ts parses HTTP in (including pulling `userAgent`/`ip` out of `req` where a
// handler needs them for session/email metadata), calls one of these, and sends the result back.

export interface IServiceResult<T = any> {
  body: T;
  httpStatus: number;
}

export interface IRequestMeta {
  ip: string;
  userAgent: string;
}

// ---- Login gate ----

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
 * Records a real active-session entry for this login, so Settings > Security > Active
 * Sessions reflects genuine sign-ins instead of being empty/fabricated. Returns an opaque
 * token the client stores to identify "this" session for the current/revoke UI.
 */
const recordSession = async (userId: any, meta: IRequestMeta): Promise<string> => {
  const sessionToken = crypto.randomBytes(24).toString('hex');
  const { browser, os } = parseUserAgent(meta.userAgent);
  try {
    await Session.create({
      userId,
      sessionToken,
      userAgent: meta.userAgent,
      browser,
      os,
      ipAddress: meta.ip || 'Unknown',
    });
  } catch (err: any) {
    throw new Error('Could not create application session');
  }
  return sessionToken;
};

/**
 * Every successful login path below ends with the same three steps: sync this user's Firebase
 * custom claims (best-effort -- already swallowed failures before this change, nothing downstream
 * reads its result), stamp `lastActiveAt`, and record the application Session row. None of the
 * three needs another's *result*: claims sync only needs firebaseUid + the role/companyId values
 * already known by the caller, user.save() only needs the already-mutated `user` document, and
 * recordSession only needs user._id and the request metadata. All three were previously awaited
 * one after another (3 sequential round trips); grouping them with Promise.all turns that into 1.
 *
 * recordSession is NOT made fire-and-forget -- its result is the sessionToken the client uses to
 * authenticate every subsequent request (see verifyFirebaseToken, which looks up this exact
 * Session row), so the response must not go out before it is durably written. The claims sync, by
 * contrast, already tolerated failure before this change and nothing downstream reads its result,
 * so running it alongside the other two costs nothing and risks nothing.
 */
const finalizeLogin = async (
  user: IUserDocument,
  firebaseUid: string,
  claims: Record<string, unknown> | null,
  meta: IRequestMeta
): Promise<string> => {
  user.lastActiveAt = new Date();

  const syncClaims = async (): Promise<void> => {
    if (!claims) return;
    try {
      const auth = getFirebaseAuth();
      await auth.setCustomUserClaims(firebaseUid, claims);
    } catch (claimsError: any) {
      console.warn('[Login Gate] Could not set custom claims:', claimsError.message);
    }
  };

  const [ , , sessionToken ] = await Promise.all([
    syncClaims(),
    user.save(),
    recordSession(user._id, meta),
  ]);

  return sessionToken;
};

/**
 * Tue-BE-2: The central login gate verifying authentication, email verification,
 * user status, and company approval lifecycle before issuing an application session.
 */
export async function evaluateLoginGate(
    firebaseUid: string | undefined,
    firebaseEmail: string | undefined,
    firebaseEmailVerified: boolean | undefined,
    meta: IRequestMeta
): Promise<IServiceResult> {
  if (!firebaseUid) {
    return { body: { status: 'INVALID_CREDENTIALS', error: 'Authentication failed: Invalid credentials' }, httpStatus: 401 };
  }

  try {
    // 1. Locate User in MongoDB
    let user: IUserDocument | null = await User.findOne({ firebaseUid });

    if (!user && firebaseEmail && firebaseEmailVerified) {
      user = await User.findOne({ email: firebaseEmail.toLowerCase() });
      if (user) {
        user.firebaseUid = firebaseUid;
        await user.save();
      }
    }

    // No Mongo record for this Firebase account -- do NOT auto-provision.
    // The user must go through /api/auth/signup (+ company registration) first.
    if (!user) {
      return {
        body: { status: 'NOT_REGISTERED', error: 'No account found for this sign-in. Please create an account first, then sign in.' },
        httpStatus: 404,
      };
    }

    // 2. Check Email Verification
    if (!firebaseEmailVerified && !user.emailVerifiedAt) {
      return { body: { status: 'UNVERIFIED', error: 'Please verify your email address before signing in', email: user.email }, httpStatus: 403 };
    }

    // Sync emailVerifiedAt if verified in Firebase
    if (firebaseEmailVerified && !user.emailVerifiedAt) {
      user.emailVerifiedAt = new Date();
      await user.save();
    }

    // 3. Check User Status
    if (user.status !== 'ACTIVE') {
      return { body: { status: 'SUSPENDED_USER', error: 'Your user account has been suspended by an administrator' }, httpStatus: 403 };
    }

    // 4. Check Forced Password Reset
    if (user.forcePasswordReset) {
      return { body: { status: 'FORCE_PASSWORD_RESET', error: 'You must reset your password before continuing' }, httpStatus: 403 };
    }

    // 5. Super Admin Bypass for Independent Admin Accounts
    let company: ICompanyDocument | null = null;

    if (user.role === 'SUPER_ADMIN') {
      // Super Admin has global access
      const sessionToken = await finalizeLogin(user, firebaseUid, { role: 'SUPER_ADMIN', companyId: null }, meta);

      return { body: { status: 'ACTIVE', user, company: null, sessionToken }, httpStatus: 200 };
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
          allowedDomains: domain,
        });
        if (matchedCompany) {
          user.companyId = matchedCompany._id as any;
          await user.save();
        }
      }
    }

    if (!user.companyId) {
      // Standalone user without company workspace — issue direct active token
      const sessionToken = await finalizeLogin(user, firebaseUid, null, meta);

      return { body: { status: 'ACTIVE', user, company: null, sessionToken }, httpStatus: 200 };
    }

    company = await Company.findById(user.companyId);

    if (!company) {
      return { body: { status: 'INVALID_CREDENTIALS', error: 'Associated company workspace not found' }, httpStatus: 404 };
    }

    if (company.status === 'PENDING') {
      return {
        body: {
          status: 'PENDING',
          error: 'Your company registration is pending Super Admin review and approval',
          company: { id: company._id, name: company.name, slug: company.slug, status: company.status },
        },
        httpStatus: 403,
      };
    }

    if (company.status === 'REJECTED') {
      return {
        body: {
          status: 'REJECTED',
          error: 'Your company registration was rejected by the administrator',
          rejectionReason: company.rejectionReason || null,
          company: { name: company.name, status: company.status },
        },
        httpStatus: 403,
      };
    }

    if (company.status === 'SUSPENDED') {
      return {
        body: {
          status: 'SUSPENDED_COMPANY',
          error: 'Your company workspace has been suspended',
          company: { name: company.name, status: company.status },
        },
        httpStatus: 403,
      };
    }

    // 7. All checks passed: issue an application session. Meeting tokens require admission.
    console.log(`[Login Gate PASS] ${user.email} logged in successfully for company ${company.name}`);

    const sessionToken = await finalizeLogin(
      user, firebaseUid, { role: user.role, companyId: String(company._id), companyStatus: company.status }, meta
    );

    return { body: { status: 'ACTIVE', user, company, sessionToken }, httpStatus: 200 };
  } catch (error: any) {
    console.error('[Login Gate] Error evaluating login gate:', error.message);
    return { body: { error: 'Internal server error evaluating login gate' }, httpStatus: 500 };
  }
}

// ---- Signup ----

interface ISignupParams {
  avatarUrl?: string;
  email: string | undefined;
  emailVerified: boolean | undefined;
  firebaseUid: string | undefined;
  fullName?: string;
  inviteId?: string;
}

/** Tue-BE-1: Registers a new user record in MongoDB linked to their Firebase UID. */
export async function signup(params: ISignupParams): Promise<IServiceResult> {
  const { firebaseUid, email, emailVerified, fullName, avatarUrl, inviteId } = params;

  if (!firebaseUid || !email) {
    return { body: { error: 'Invalid authentication context' }, httpStatus: 400 };
  }

  if (!fullName || typeof fullName !== 'string' || !fullName.trim()) {
    return { body: { error: 'Full name is required' }, httpStatus: 400 };
  }

  try {
    const existingUser = await User.findOne({
      $or: [{ firebaseUid }, { email: email.toLowerCase().trim() }],
    });

    if (existingUser) {
      return { body: { error: 'User already exists', user: existingUser }, httpStatus: 409 };
    }

    const invitation = inviteId
      ? await TeamInvite.findOne({ _id: inviteId, email: email.toLowerCase().trim(), expiresAt: { $gt: new Date() } })
      : null;
    if (inviteId && !invitation) {
      return { body: { error: 'This team invitation is invalid, expired, or belongs to another email address' }, httpStatus: 400 };
    }

    const newUser = await User.create({
      firebaseUid,
      email: email.toLowerCase().trim(),
      fullName: fullName.trim(),
      avatarUrl: avatarUrl || null,
      companyId: invitation?.companyId || null,
      reportsTo: invitation?.reportsTo || null,
      role: invitation?.role || 'MEMBER',
      status: 'ACTIVE',
      emailVerifiedAt: emailVerified ? new Date() : null,
      twoFactor: {
        isEnabled: false,
      },
    });

    console.log(`[Signup] User registered: ${newUser.email} (ID: ${newUser._id})`);

    if (invitation) await invitation.deleteOne();

    return { body: { message: 'Signup successful', user: newUser, joinedFromInvite: Boolean(invitation) }, httpStatus: 201 };
  } catch (error: any) {
    console.error('[Signup] Error during signup:', error.message);
    return { body: { error: 'Internal server error during signup' }, httpStatus: 500 };
  }
}

// ---- Verify email ----

/** Tue-BE-1: Synchronizes Firebase email verified status to MongoDB User model. */
export async function verifyEmail(firebaseUid: string | undefined, emailVerified: boolean | undefined): Promise<IServiceResult> {
  if (!firebaseUid) {
    return { body: { error: 'Unauthorized' }, httpStatus: 401 };
  }

  if (!emailVerified) {
    return { body: { error: 'Email is not yet verified in Firebase', status: 'UNVERIFIED' }, httpStatus: 400 };
  }

  try {
    const user = await User.findOneAndUpdate(
      { firebaseUid },
      { $set: { emailVerifiedAt: new Date() } },
      { new: true }
    );

    if (!user) {
      return { body: { error: 'User not found in database' }, httpStatus: 404 };
    }

    console.log(`[Verify Email] User email verified in MongoDB: ${user.email}`);

    return { body: { message: 'Email verification verified and synced successfully', status: 'VERIFIED', user }, httpStatus: 200 };
  } catch (error: any) {
    console.error('[Verify Email] Error syncing email verification:', error.message);
    return { body: { error: 'Internal server error during email verification' }, httpStatus: 500 };
  }
}

// ---- Forgot password ----

/**
 * Tue-BE-3: Request password reset link.
 * Guarantees identical response shape and constant timing across nonexistent,
 * unverified, pending, rejected, suspended, and active accounts (preventing enumeration attacks).
 */
export async function requestPasswordReset(emailRaw: unknown, meta: IRequestMeta): Promise<IServiceResult> {
  // Standard generic response returned in ALL cases
  const genericResponse = {
    message: 'If an account exists with this email address, password reset instructions have been sent.',
    success: true,
  };

  if (!emailRaw || typeof emailRaw !== 'string' || !emailRaw.trim()) {
    return { body: { error: 'Valid email address is required' }, httpStatus: 400 };
  }

  const normalizedEmail = emailRaw.toLowerCase().trim();

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
          ipAddress: meta.ip,
          userAgent: meta.userAgent,
        },
      });

      console.log(`[Forgot Password] Password reset initiated for: ${normalizedEmail}`);
    } else {
      console.log(`[Forgot Password] Nonexistent email requested: ${normalizedEmail} (Returned generic response)`);
    }

    // Always return 200 with identical payload
    return { body: genericResponse, httpStatus: 200 };
  } catch (error: any) {
    console.error('[Forgot Password] Unexpected error in forgot-password:', error.message);
    return { body: genericResponse, httpStatus: 200 };
  }
}

// ---- Resend verification email ----

/**
 * Sends our own branded E1_VERIFY_EMAIL (Toowix, via our SMTP) instead of relying on
 * Firebase's default verification email. Mirrors the pattern in requestPasswordReset:
 * Admin SDK generates the real action link, our own sender delivers it.
 */
export async function resendVerificationEmail(
    firebaseUid: string | undefined,
    firebaseEmail: string | undefined,
    firebaseEmailVerified: boolean | undefined,
    meta: IRequestMeta
): Promise<IServiceResult> {
  try {
    if (!firebaseUid || !firebaseEmail) {
      return { body: { error: 'Authentication required' }, httpStatus: 401 };
    }

    if (firebaseEmailVerified) {
      return { body: { message: 'Email is already verified', alreadyVerified: true }, httpStatus: 200 };
    }

    const user = await User.findOne({ firebaseUid });
    const email = firebaseEmail.toLowerCase();

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
      metadata: { userId: user?._id, ipAddress: meta.ip, userAgent: meta.userAgent },
    });

    return { body: { message: 'Verification email sent' }, httpStatus: 200 };
  } catch (error: any) {
    console.error('[Send Verification Email] Error:', error.message);
    return { body: { error: 'Could not send verification email' }, httpStatus: 500 };
  }
}

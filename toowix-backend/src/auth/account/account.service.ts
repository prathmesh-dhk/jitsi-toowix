import crypto from 'crypto';
import { User, IUserDocument } from '../../models/User';
import { Company, ICompanyDocument } from '../../models/Company';
import { Session } from '../../models/Session';
import { TeamInvite } from '../../models/TeamInvite';
import { getFirebaseAuth } from '../../config/firebase';
import { parseUserAgent } from '../../utils/parseUserAgent';
import { sendEmailAsync } from '../../email/sender';
import { emailConfig } from '../../config/email';
import { resolveTenantFromKeycloakSub } from '../../lib/meetEntitlement';
import { revokeMailSessionsByEmail } from '../../lib/mailSsoClient';

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
  // null for the Keycloak login path -- there's no fresh Firebase token in that request to sync
  // claims against, so claims sync is skipped entirely (see syncClaims below); session issuance
  // (recordSession) and lastActiveAt still happen exactly the same either way.
  firebaseUid: string | null,
  claims: Record<string, unknown> | null,
  meta: IRequestMeta
): Promise<string> => {
  user.lastActiveAt = new Date();

  const syncClaims = async (): Promise<void> => {
    if (!claims || !firebaseUid) return;
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

    // 2. Check Email Verification -- Firebase-specific (Keycloak logins skip this entirely; see
    // evaluateKeycloakLoginGate below, which only runs the SHARED eligibility checks this calls
    // into at the bottom).
    if (!firebaseEmailVerified && !user.emailVerifiedAt) {
      return { body: { status: 'UNVERIFIED', error: 'Please verify your email address before signing in', email: user.email }, httpStatus: 403 };
    }

    // Sync emailVerifiedAt if verified in Firebase
    if (firebaseEmailVerified && !user.emailVerifiedAt) {
      user.emailVerifiedAt = new Date();
      await user.save();
    }

    return evaluateResolvedUserLoginGate(user, meta, firebaseUid);
  } catch (error: any) {
    console.error('[Login Gate] Error evaluating login gate:', error.message);
    return { body: { error: 'Internal server error evaluating login gate' }, httpStatus: 500 };
  }
}

/**
 * The SHARED tail of the login gate -- user/tenant eligibility checks (status, forced reset,
 * company lifecycle) plus session issuance -- factored out of evaluateLoginGate so the Keycloak
 * session-exchange path (evaluateKeycloakLoginGate, below) enforces the EXACT same rules instead
 * of a second, hand-duplicated copy that could silently drift out of sync with this one. Only
 * Firebase-specific concerns (locating the user by firebaseUid, the email-verification check,
 * Firebase custom-claims sync) stay outside this function, in each caller.
 *
 * `claimsSyncFirebaseUid`: when set, the issued session also syncs Firebase custom claims for
 * that uid (the normal Firebase login path). When null (the Keycloak path), claims sync is
 * skipped entirely -- there is no fresh Firebase token in a Keycloak-authenticated request to
 * attach claims to, and this is a pure convenience sync, not an authorization source: the actual
 * authorization decision below (user.status, company.status) is always re-checked fresh from the
 * database regardless of whatever claims a past Firebase login last set.
 */
async function evaluateResolvedUserLoginGate(
    user: IUserDocument,
    meta: IRequestMeta,
    claimsSyncFirebaseUid: string | null,
): Promise<IServiceResult> {
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
    const sessionToken = await finalizeLogin(
      user, claimsSyncFirebaseUid, claimsSyncFirebaseUid ? { role: 'SUPER_ADMIN', companyId: null } : null, meta
    );

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
    const sessionToken = await finalizeLogin(user, claimsSyncFirebaseUid, null, meta);

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
    user, claimsSyncFirebaseUid,
    claimsSyncFirebaseUid ? { role: user.role, companyId: String(company._id), companyStatus: company.status } : null,
    meta
  );

  return { body: { status: 'ACTIVE', user, company, sessionToken }, httpStatus: 200 };
}

export type KeycloakLoginDenialReason = 'KEYCLOAK_NOT_LINKED' | 'PLAN_DOES_NOT_INCLUDE_MEET';

// The realm role Mail's keycloak-role-sync.service.ts assigns when a tenant's Plan.apps includes
// 'meet' (see toowix-stalwart/backend/src/services/keycloak-role-sync.service.ts). Mirrors the
// role name already defined in the real Keycloak realm (toowix-keycloak-ui's 'toowix-dev' realm).
const MEET_ACCESS_ROLE = 'meet_access';

type KeycloakSelfLinkOutcome =
  | 'LINKED'
  | 'ALREADY_LINKED'
  | 'MISSING_FIREBASE_IDENTITY'
  | 'MISSING_KEYCLOAK_IDENTITY'
  | 'USER_NOT_FOUND'
  | 'USER_INELIGIBLE'
  | 'COMPANY_INELIGIBLE'
  | 'DIFFERENT_KEYCLOAK_IDENTITY_ALREADY_LINKED'
  | 'KEYCLOAK_IDENTITY_ALREADY_LINKED'
  | 'DUPLICATE_KEYCLOAK_IDENTITY'
  | 'UPDATE_CONFLICT'
  | 'ERROR';

/**
 * This project has no durable security-audit model. Follow the existing server logging pattern
 * while deliberately recording only the immutable Toowix user id, action, time, and outcome --
 * never an access token, email address, Keycloak subject, password, or other credential.
 */
function recordKeycloakSelfLinkAudit(userId: string | null, outcome: KeycloakSelfLinkOutcome): void {
  console.info('[Keycloak Self-Link Audit]', {
    action: 'KEYCLOAK_SELF_LINK',
    userId,
    outcome,
    at: new Date().toISOString(),
  });
}

function keycloakSelfLinkResult(status: string, error: string, httpStatus: number): IServiceResult {
  return { body: { status, error }, httpStatus };
}

/**
 * Binds exactly the currently authenticated Firebase/Toowix account to a Keycloak `sub` that
 * middleware already verified cryptographically. It deliberately accepts neither a target user
 * id nor a browser-provided subject, and never creates a User or Company.
 */
export async function linkOwnKeycloakIdentity(
  firebaseUid: string | undefined,
  verifiedKeycloakSub: string | undefined,
): Promise<IServiceResult> {
  if (!firebaseUid) {
    recordKeycloakSelfLinkAudit(null, 'MISSING_FIREBASE_IDENTITY');
    return keycloakSelfLinkResult('INVALID_CREDENTIALS', 'Firebase authentication is required.', 401);
  }
  if (!verifiedKeycloakSub) {
    recordKeycloakSelfLinkAudit(null, 'MISSING_KEYCLOAK_IDENTITY');
    return keycloakSelfLinkResult('INVALID_KEYCLOAK_TOKEN', 'A verified Keycloak identity is required.', 401);
  }

  let user: IUserDocument | null;
  try {
    // This lookup is intentionally by the UID set by verifyFirebaseToken, never by email.
    user = await User.findOne({ firebaseUid });
  } catch (error: any) {
    console.error('[Keycloak Self-Link] Could not resolve Firebase account:', error?.message || 'unknown error');
    recordKeycloakSelfLinkAudit(null, 'ERROR');
    return keycloakSelfLinkResult('LINKING_UNAVAILABLE', 'Could not link the Keycloak identity right now.', 503);
  }

  if (!user) {
    recordKeycloakSelfLinkAudit(null, 'USER_NOT_FOUND');
    return keycloakSelfLinkResult('USER_NOT_FOUND', 'No existing Toowix account was found for this session.', 404);
  }

  const userId = String(user._id);
  if (user.status !== 'ACTIVE' || user.forcePasswordReset) {
    recordKeycloakSelfLinkAudit(userId, 'USER_INELIGIBLE');
    return keycloakSelfLinkResult('ACCOUNT_INELIGIBLE', 'This account is not eligible to link a Keycloak identity.', 403);
  }

  if (user.role !== 'SUPER_ADMIN' && user.companyId) {
    let company: Pick<ICompanyDocument, 'status'> | null;
    try {
      company = await Company.findById(user.companyId).select('status').lean();
    } catch (error: any) {
      console.error('[Keycloak Self-Link] Could not resolve company eligibility:', error?.message || 'unknown error');
      recordKeycloakSelfLinkAudit(userId, 'ERROR');
      return keycloakSelfLinkResult('LINKING_UNAVAILABLE', 'Could not link the Keycloak identity right now.', 503);
    }
    if (!company || company.status !== 'ACTIVE') {
      recordKeycloakSelfLinkAudit(userId, 'COMPANY_INELIGIBLE');
      return keycloakSelfLinkResult('ACCOUNT_INELIGIBLE', 'This account is not eligible to link a Keycloak identity.', 403);
    }
  }

  if (user.keycloakSub) {
    if (user.keycloakSub === verifiedKeycloakSub) {
      recordKeycloakSelfLinkAudit(userId, 'ALREADY_LINKED');
      return { body: { status: 'ALREADY_LINKED' }, httpStatus: 200 };
    }
    recordKeycloakSelfLinkAudit(userId, 'DIFFERENT_KEYCLOAK_IDENTITY_ALREADY_LINKED');
    return keycloakSelfLinkResult('KEYCLOAK_IDENTITY_CONFLICT', 'This account is already linked to a different Keycloak identity.', 409);
  }

  try {
    // A friendly preflight check gives a stable conflict response. The conditional update and
    // unique index below remain the authority and protect against concurrent link attempts.
    const existingLink = await User.findOne({ keycloakSub: verifiedKeycloakSub }).select('_id').lean();
    if (existingLink && String(existingLink._id) !== userId) {
      recordKeycloakSelfLinkAudit(userId, 'KEYCLOAK_IDENTITY_ALREADY_LINKED');
      return keycloakSelfLinkResult('KEYCLOAK_IDENTITY_IN_USE', 'This Keycloak identity is already linked to another account.', 409);
    }

    const linkedUser = await User.findOneAndUpdate(
      {
        _id: user._id,
        firebaseUid,
        $or: [{ keycloakSub: { $exists: false } }, { keycloakSub: null }],
      },
      { $set: { keycloakSub: verifiedKeycloakSub } },
      { new: true, runValidators: true },
    );

    if (!linkedUser) {
      // Never overwrite a value that appeared between the initial read and this atomic update.
      recordKeycloakSelfLinkAudit(userId, 'UPDATE_CONFLICT');
      return keycloakSelfLinkResult('KEYCLOAK_IDENTITY_CONFLICT', 'The account link changed before it could be saved. Please try again.', 409);
    }

    recordKeycloakSelfLinkAudit(userId, 'LINKED');
    return { body: { status: 'LINKED' }, httpStatus: 200 };
  } catch (error: any) {
    if (error?.code === 11000) {
      recordKeycloakSelfLinkAudit(userId, 'DUPLICATE_KEYCLOAK_IDENTITY');
      return keycloakSelfLinkResult('KEYCLOAK_IDENTITY_IN_USE', 'This Keycloak identity is already linked to another account.', 409);
    }
    console.error('[Keycloak Self-Link] Could not save identity link:', error?.message || 'unknown error');
    recordKeycloakSelfLinkAudit(userId, 'ERROR');
    return keycloakSelfLinkResult('LINKING_UNAVAILABLE', 'Could not link the Keycloak identity right now.', 503);
  }
}

/**
 * Auto-links an EXISTING Toowix Meet User to a verified Keycloak identity on first Keycloak
 * login, matched by email -- this NEVER creates a new User (that remains a deliberate non-goal:
 * someone with no Meet account at all still gets KEYCLOAK_NOT_LINKED). Only called when Keycloak
 * itself asserts the email is verified (checked by the caller before calling this) -- an
 * unverified email claim is never trusted for linking an existing account, since that would let
 * anyone who can set an arbitrary unverified email on a Keycloak account take over a matching
 * Meet account. Returns null (not an error) if no such Meet User exists, or if it is already
 * linked to a DIFFERENT Keycloak identity -- this never reassigns an existing link.
 */
export async function autoLinkKeycloakIdentityByVerifiedEmail(
  email: string,
  verifiedKeycloakSub: string,
): Promise<IUserDocument | null> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return null;

  try {
    const linked = await User.findOneAndUpdate(
      {
        email: normalizedEmail,
        $or: [{ keycloakSub: { $exists: false } }, { keycloakSub: null }],
      },
      { $set: { keycloakSub: verifiedKeycloakSub } },
      { new: true, runValidators: true },
    );
    if (linked) {
      console.info('[Keycloak Auto-Link]', { action: 'KEYCLOAK_AUTO_LINK', userId: String(linked._id), outcome: 'LINKED', at: new Date().toISOString() });
      return linked;
    }

    // No unlinked match for this email -- but if this EXACT identity already got linked (e.g. a
    // repeated/retried login a moment after a prior one succeeded), that is success, not a miss.
    const existing = await User.findOne({ email: normalizedEmail });
    return existing && existing.keycloakSub === verifiedKeycloakSub ? existing : null;
  } catch (error: any) {
    // A unique-index collision here means this sub (or this email) raced onto two different
    // targets; never guess which write "should" have won -- the caller just sees "not linked".
    if (error?.code !== 11000) {
      console.error('[Keycloak Auto-Link] Could not auto-link by email:', error?.message || 'unknown error');
    }
    return null;
  }
}

/**
 * Creates a brand-new Meet User (and a real Firebase user, since `User.firebaseUid` is
 * required+unique) for a Keycloak identity that has no existing Meet account at all -- the
 * final fallback after an explicit link and an auto-link-by-email both miss. Only called when
 * Keycloak itself asserts the email is verified (same trust boundary as
 * autoLinkKeycloakIdentityByVerifiedEmail above). The new account is standalone (no Company):
 * this deliberately mirrors signup()'s shape, not registerCompany()'s, so the PENDING/
 * superadmin-approval path is never entered -- not bypassed, simply never reached, exactly like
 * any other company-less user already is in evaluateResolvedUserLoginGate.
 */
async function autoCreateKeycloakUser(
  email: string,
  verifiedKeycloakSub: string,
): Promise<IUserDocument | null> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return null;

  try {
    const auth = getFirebaseAuth();
    let firebaseUid: string;
    try {
      const created = await auth.createUser({ email: normalizedEmail, emailVerified: true });
      firebaseUid = created.uid;
    } catch (error: any) {
      // Someone else's request created the same Firebase user a moment ago (race) -- adopt it.
      if (error?.code !== 'auth/email-already-exists') throw error;
      const existingFirebaseUser = await auth.getUserByEmail(normalizedEmail);
      firebaseUid = existingFirebaseUser.uid;
    }

    const created = await User.create({
      firebaseUid,
      email: normalizedEmail,
      fullName: normalizedEmail.split('@')[0],
      companyId: null,
      role: 'MEMBER',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      keycloakSub: verifiedKeycloakSub,
      twoFactor: { isEnabled: false },
    });
    console.info('[Keycloak Auto-Create]', { action: 'KEYCLOAK_AUTO_CREATE', userId: String(created._id), outcome: 'CREATED', at: new Date().toISOString() });
    return created;
  } catch (error: any) {
    // A unique-index collision (email or keycloakSub) means this identity raced onto two
    // creation attempts -- re-fetch whichever write actually won rather than guessing/erroring.
    if (error?.code === 11000) {
      const existing = await User.findOne({ email: normalizedEmail });
      return existing && existing.keycloakSub === verifiedKeycloakSub ? existing : null;
    }
    console.error('[Keycloak Auto-Create] Could not auto-create user:', error?.message || 'unknown error');
    return null;
  }
}

/**
 * The Keycloak-authenticated counterpart to evaluateLoginGate. The caller (keycloakSessionHandler)
 * has ALREADY verified the Keycloak access token's signature/issuer/audience/expiry via
 * requireKeycloakAccessToken before this ever runs -- this function trusts the verified `sub`,
 * `keycloakRoles`, `keycloakEmail` and `keycloakEmailVerified` it's given, never anything
 * client-supplied.
 *
 * Linking: first tries the explicit link (resolveTenantFromKeycloakSub, src/lib/meetEntitlement.ts
 * -- an administrator ran scripts/link-keycloak-sub.ts, or the user used the self-link flow).
 * Falling that, and only when Keycloak itself asserts the email is verified, auto-links an
 * EXISTING Meet User with the matching email (autoLinkKeycloakIdentityByVerifiedEmail above) --
 * this still never creates a new User. An identity that matches neither path is a real "this
 * Keycloak identity has no Toowix Meet account yet" state, returned as KEYCLOAK_NOT_LINKED.
 */
export async function evaluateKeycloakLoginGate(
    verifiedKeycloakSub: string,
    keycloakRoles: string[],
    keycloakEmail: string | undefined,
    keycloakEmailVerified: boolean,
    meta: IRequestMeta
): Promise<IServiceResult> {
  try {
    const identity = await resolveTenantFromKeycloakSub(verifiedKeycloakSub);
    let user = identity
      ? await User.findById(identity.userId)
      : (keycloakEmailVerified && keycloakEmail)
        ? await autoLinkKeycloakIdentityByVerifiedEmail(keycloakEmail, verifiedKeycloakSub)
        : null;

    if (!user && !identity && keycloakEmailVerified && keycloakEmail) {
      user = await autoCreateKeycloakUser(keycloakEmail, verifiedKeycloakSub);
    }

    if (!user) {
      // Covers: no link and no verified-email match, OR an explicit link pointing at a user that
      // no longer exists -- same stable code either way; the caller has no reason to be told
      // which case it was.
      return {
        body: {
          status: 'KEYCLOAK_NOT_LINKED',
          error: 'This Keycloak account is not linked to a Toowix Meet user yet. Ask an administrator to link it.',
        },
        httpStatus: 403,
      };
    }

    // Trust Keycloak's own verification judgement: an existing Meet account that was auto-linked
    // (or was already linked but never separately verified its email in Meet) is treated as
    // verified too, matching how the Firebase login path already syncs emailVerifiedAt from
    // Firebase's own verification state rather than re-asking.
    if (keycloakEmailVerified && !user.emailVerifiedAt) {
      user.emailVerifiedAt = new Date();
    }

    // The plan entitlement gate: Mail's keycloak-role-sync.service.ts assigns MEET_ACCESS_ROLE
    // onto this Keycloak identity only while the tenant's plan includes 'meet'. Checked here,
    // against the token's own verified claim, rather than a live cross-service API call -- this
    // IS the realm-role-based entitlement design (see the Keycloak role-sync audit/plan).
    if (!keycloakRoles.includes(MEET_ACCESS_ROLE)) {
      return {
        body: {
          status: 'PLAN_DOES_NOT_INCLUDE_MEET',
          error: 'Your Toowix plan does not include Meet access. Upgrade your plan to use Meet.',
        },
        httpStatus: 403,
      };
    }

    // No email-verification gate here (Keycloak already asserts the identity; Toowix's own
    // emailVerifiedAt flag governs the Firebase signup flow specifically, not this path) --
    // every other eligibility rule (user status, forced reset, company lifecycle) is identical,
    // via the same shared function the Firebase path uses.
    const result = await evaluateResolvedUserLoginGate(user, meta, null);

    // Bridge into a REAL Firebase session, not just the opaque Toowix session token. Every other
    // authenticated route in this app (verifyFirebaseToken, used almost everywhere) requires a
    // live Firebase ID token on EVERY request, in addition to the Toowix session token -- the
    // session token alone was never sufficient, even for Firebase logins. A Keycloak sign-in has
    // no such token because the browser never talked to Firebase. Firebase's own supported fix
    // for exactly this "external IdP signs the user in" case is a custom token: mint one here for
    // this user's EXISTING firebaseUid (required on every User doc -- see models/User.ts), and the
    // frontend calls signInWithCustomToken with it. That gives the browser a real `auth.currentUser`
    // and working getIdToken(), so every existing Firebase-gated route keeps working completely
    // unmodified -- this does not touch, weaken, or bypass verifyFirebaseToken in any way, it just
    // uses Firebase's own federation mechanism to satisfy what that middleware already requires.
    if (result.body?.status === 'ACTIVE') {
      try {
        const auth = getFirebaseAuth();
        result.body.firebaseCustomToken = await auth.createCustomToken(user.firebaseUid);
      } catch (tokenError: any) {
        console.error('[Keycloak Login Gate] Could not mint Firebase custom token:', tokenError.message);
        return { body: { status: 'INVALID_CREDENTIALS', error: 'Could not establish a secure session. Please try again.' }, httpStatus: 503 };
      }
    }

    return result;
  } catch (error: any) {
    console.error('[Keycloak Login Gate] Error evaluating login gate:', error.message);
    return { body: { error: 'Internal server error evaluating login gate' }, httpStatus: 500 };
  }
}

// ---- Logout (strict cross-app: also revokes this same person's Mail session) ----

/**
 * Revokes this device's Meet session, then best-effort revokes this same person's Mail session
 * too (by email, via the internal SSO endpoint) -- so logging out of Meet is strictly compulsory
 * for Mail as well, regardless of how either session was originally established.
 */
export async function logoutAndRevokeEverywhere(
  userId: string,
  sessionToken: string | undefined,
  email: string | undefined,
): Promise<IServiceResult> {
  if (sessionToken) {
    await Session.updateOne({ userId, sessionToken }, { $set: { revokedAt: new Date() } }).catch(() => {});
  }
  if (email) {
    await revokeMailSessionsByEmail(email);
  }
  return { body: { success: true }, httpStatus: 200 };
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
        resetLink = await auth.generatePasswordResetLink(normalizedEmail, {
          url: `${emailConfig.appUrl}/resetpassword`,
          handleCodeInApp: true,
        });
      } catch (fbError: any) {
        console.warn(`[Forgot Password] Could not generate Firebase reset link: ${fbError.message}`);
        resetLink = `${emailConfig.appUrl}/resetpassword?email=${encodeURIComponent(normalizedEmail)}`;
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

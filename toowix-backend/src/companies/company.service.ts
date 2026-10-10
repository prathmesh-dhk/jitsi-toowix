import { Company, CompanyStatus, MeetingCreatorRole } from '../models/Company';
import { User } from '../models/User';
import { getFirebaseAuth } from '../config/firebase';
import { sendEmailAsync } from '../email/sender';
import { emailConfig } from '../config/email';

// All business rules for company registration, meeting policy, and the Super Admin
// approve/reject/suspend/reactivate lifecycle live here as plain functions -- no `req`/`res`
// anywhere in this file. company.controller.ts parses HTTP in and sends the result back out.

export interface IServiceResult<T = any> {
  body: T;
  httpStatus: number;
}

async function resolveUser(firebaseUid: string | undefined) {
  if (!firebaseUid) return null;
  return User.findOne({ firebaseUid });
}

async function resolveSuperAdmin(firebaseUid: string | undefined) {
  const user = await resolveUser(firebaseUid);
  return user && user.role === 'SUPER_ADMIN' ? user : null;
}

const isAdminRole = (role?: string) => role === 'COMPANY_ADMIN' || role === 'SUPER_ADMIN';

// ---- Registration ----

interface IRegisterParams {
  email: string | undefined;
  firebaseUid: string | undefined;
  ip: string | undefined;
  logoUrl?: string;
  name?: string;
  slug?: string;
}

/** Tue-BE-4: Register a new company workspace. Creates the company in PENDING status and
 * assigns the caller as COMPANY_ADMIN. */
export async function registerCompany(params: IRegisterParams): Promise<IServiceResult> {
  const { firebaseUid, email, name, slug: customSlug, logoUrl, ip } = params;

  if (!firebaseUid || !email) {
    return { body: { error: 'Unauthorized: Invalid authentication token' }, httpStatus: 401 };
  }

  if (!name || typeof name !== 'string' || !name.trim()) {
    return { body: { error: 'Company name is required' }, httpStatus: 400 };
  }

  try {
    // 1. Locate User in MongoDB
    const user = await User.findOne({ firebaseUid });

    if (!user) {
      return { body: { error: 'User profile not found. Please complete signup first.' }, httpStatus: 404 };
    }

    if (user.status !== 'ACTIVE' || user.forcePasswordReset) {
      return { body: { error: 'Account is not authorized' }, httpStatus: 403 };
    }
    if (user.companyId) {
      return { body: { error: 'User is already associated with a company workspace' }, httpStatus: 400 };
    }

    // 2. Generate or sanitize slug
    let slug = (customSlug || name)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    // Ensure unique slug
    const existingCompany = await Company.findOne({ slug });
    if (existingCompany) {
      slug = `${slug}-${Math.floor(1000 + Math.random() * 9000)}`;
    }

    // 3. Create Company with PENDING status (Requires Super Admin approval)
    const company = await Company.create({
      name: name.trim(),
      slug,
      logoUrl: logoUrl || null,
      status: 'PENDING',
      plan: 'FREE',
      limits: {
        maxUsers: 50,
        maxMeetingDurationMinutes: 60,
        storageLimitBytes: 5368709120, // 5GB
        recordingRetentionDays: 30,
        featureFlags: {
          recordingEnabled: true,
          customBranding: false,
          sipDialIn: false,
          lobbyEnabled: true,
        },
      },
    });

    // 4. Update user role to COMPANY_ADMIN and link companyId
    user.companyId = company._id;
    user.role = 'COMPANY_ADMIN';
    await user.save();

    // 5. Disable the Firebase account until Super Admin approves the company.
    // A disabled account cannot authenticate at all (Firebase itself rejects it),
    // so this is a real block, not just a status flag.
    try {
      const auth = getFirebaseAuth();
      await auth.updateUser(firebaseUid, { disabled: true });
    } catch (disableError: any) {
      console.warn(`[Company Registration] Could not disable Firebase account for ${user.email}:`, disableError.message);
    }

    console.log(`[Company Registration] Company "${company.name}" registered (PENDING approval) by ${user.email}`);

    // 6. Dispatch E2 Registration Received email asynchronously
    sendEmailAsync({
      to: user.email,
      templateName: 'E2_REG_RECEIVED',
      subject: `Registration received for ${company.name} - Toowix Meet`,
      renderOptions: {
        title: 'Company Registration Received',
        preheader: `We've received your registration for ${company.name}`,
        content: `
          <p>Hello ${user.fullName},</p>
          <p>Thank you for registering <strong>${company.name}</strong> on Toowix Meet.</p>
          <p>Your workspace is currently <strong>awaiting review by the Toowix Super Admin team</strong>. Once approved, you will receive a notification email, and you will be able to access your full company meeting dashboard.</p>
        `,
        actionButton: {
          text: 'Check Registration Status',
          url: 'https://meet.toowix.com/login',
        },
      },
      metadata: {
        userId: user._id,
        companyId: company._id,
        ipAddress: ip,
      },
    });

    return {
      body: {
        message: 'Company registration submitted successfully and is pending Super Admin approval',
        status: 'PENDING',
        company: { id: company._id, name: company.name, slug: company.slug, status: company.status, plan: company.plan },
        user,
      },
      httpStatus: 201,
    };
  } catch (error: any) {
    console.error('[Company Registration] Error registering company:', error.message);
    return { body: { error: 'Internal server error registering company' }, httpStatus: 500 };
  }
}

// ---- Meeting policy ----

/**
 * Returns the caller's company meeting policy. Any company member can view it (so the UI can
 * explain "why can't I create a meeting" etc.) -- only admins can change it.
 */
export async function getMeetingPolicy(firebaseUid: string | undefined): Promise<IServiceResult> {
  try {
    const user = await resolveUser(firebaseUid);
    if (!user) {
      return { body: { error: 'User profile not found' }, httpStatus: 404 };
    }
    if (!user.companyId) {
      return { body: { error: 'You are not part of a company workspace' }, httpStatus: 404 };
    }
    const company = await Company.findById(user.companyId).select('meetingPolicy name');
    if (!company) {
      return { body: { error: 'Company not found' }, httpStatus: 404 };
    }
    return { body: { meetingPolicy: company.meetingPolicy, canEdit: isAdminRole(user.role) }, httpStatus: 200 };
  } catch (error: any) {
    console.error('[Companies] Error fetching meeting policy:', error.message);
    return { body: { error: 'Failed to fetch meeting policy' }, httpStatus: 500 };
  }
}

const ROLES: MeetingCreatorRole[] = ['COMPANY_ADMIN', 'HOST', 'MEMBER'];
const BOOLEAN_FIELDS = ['allowGuestAccess', 'requireLobby', 'recordingEnabled', 'autoRecording', 'allowScreenShare', 'micLockEnabled', 'require2FA'] as const;
const ROLE_ARRAY_FIELDS = ['whoCanHost', 'whoCanCreateMeetings'] as const;

/** Company admins (or Super Admin) only. Partial update -- only supplied fields change. */
export async function updateMeetingPolicy(firebaseUid: string | undefined, body: Record<string, any>): Promise<IServiceResult> {
  try {
    const user = await resolveUser(firebaseUid);
    if (!user) {
      return { body: { error: 'User profile not found' }, httpStatus: 404 };
    }
    if (!user.companyId || !isAdminRole(user.role)) {
      return { body: { error: 'Only a company admin can change meeting policy' }, httpStatus: 403 };
    }
    const company = await Company.findById(user.companyId);
    if (!company) {
      return { body: { error: 'Company not found' }, httpStatus: 404 };
    }

    for (const field of ROLE_ARRAY_FIELDS) {
      if (body[field] !== undefined) {
        if (!Array.isArray(body[field]) || !body[field].every((r: any) => ROLES.includes(r))) {
          return { body: { error: `${field} must be an array of roles: ${ROLES.join(', ')}` }, httpStatus: 400 };
        }
        (company.meetingPolicy as any)[field] = body[field];
      }
    }

    for (const field of BOOLEAN_FIELDS) {
      if (body[field] !== undefined) {
        (company.meetingPolicy as any)[field] = Boolean(body[field]);
      }
    }

    if (body.maxMeetingDurationMinutes !== undefined) {
      const value = body.maxMeetingDurationMinutes;
      if (value !== null && (typeof value !== 'number' || value < 1)) {
        return { body: { error: 'maxMeetingDurationMinutes must be a positive number or null' }, httpStatus: 400 };
      }
      company.meetingPolicy.maxMeetingDurationMinutes = value;
    }

    await company.save();
    return { body: { meetingPolicy: company.meetingPolicy }, httpStatus: 200 };
  } catch (error: any) {
    console.error('[Companies] Error updating meeting policy:', error.message);
    return { body: { error: 'Failed to update meeting policy' }, httpStatus: 500 };
  }
}

// ---- Super Admin lifecycle ----
// approve/reject a PENDING self-registration, or suspend/reactivate an already-ACTIVE company.
// registerCompany (above) creates companies as PENDING and disables the registering admin's
// Firebase account -- until this existed, nothing in the codebase could ever move a company out
// of PENDING, so every self-registered workspace was permanently stuck (a real bug the audit
// flagged, not intentional behavior: registerCompany's own email copy says "Requires Super Admin
// approval").

const CompanySummary = 'name slug status plan logoUrl rejectionReason suspendedAt createdAt updatedAt';

/**
 * Lists companies for the Super Admin console. Defaults to PENDING (the actionable queue);
 * pass status=ACTIVE|REJECTED|SUSPENDED or omit the filter entirely with status=ALL.
 */
export async function listCompaniesForAdmin(firebaseUid: string | undefined, requestedStatusRaw: unknown): Promise<IServiceResult> {
  try {
    if (!(await resolveSuperAdmin(firebaseUid))) {
      return { body: { error: 'Super Admin access required' }, httpStatus: 403 };
    }
    const requested = typeof requestedStatusRaw === 'string' ? requestedStatusRaw.toUpperCase() : 'PENDING';
    const validStatuses: CompanyStatus[] = ['PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED'];
    const filter = validStatuses.includes(requested as CompanyStatus) ? { status: requested } : {};

    const companies = await Company.find(filter).select(CompanySummary).sort({ createdAt: -1 }).limit(500);
    return { body: { companies }, httpStatus: 200 };
  } catch (error: any) {
    console.error('[Companies Admin] Error listing companies:', error.message);
    return { body: { error: 'Failed to list companies' }, httpStatus: 500 };
  }
}

/**
 * Activates a PENDING company and re-enables every associated user's Firebase account (the
 * registering admin's account was disabled at registration time; any teammates added since
 * would already be active, so re-enabling is a safe no-op for them).
 */
export async function approveCompany(firebaseUid: string | undefined, id: string): Promise<IServiceResult> {
  try {
    const admin = await resolveSuperAdmin(firebaseUid);
    if (!admin) {
      return { body: { error: 'Super Admin access required' }, httpStatus: 403 };
    }
    const company = await Company.findById(id);
    if (!company) {
      return { body: { error: 'Company not found' }, httpStatus: 404 };
    }
    if (company.status === 'ACTIVE') {
      return { body: { company }, httpStatus: 200 };
    }

    company.status = 'ACTIVE';
    company.rejectionReason = null;
    company.suspendedAt = null;
    await company.save();

    const companyUsers = await User.find({ companyId: company._id });
    const auth = getFirebaseAuth();
    await Promise.all(companyUsers.map(async (companyUser) => {
      try {
        await auth.updateUser(companyUser.firebaseUid, { disabled: false });
      } catch (enableError: any) {
        console.warn(`[Companies Admin] Could not re-enable Firebase account for ${companyUser.email}:`, enableError.message);
      }
    }));

    const primaryAdmin = companyUsers.find((u) => u.role === 'COMPANY_ADMIN') || companyUsers[0];
    if (primaryAdmin) {
      sendEmailAsync({
        to: primaryAdmin.email,
        templateName: 'E3_REG_APPROVED',
        subject: `${company.name} is approved - Toowix Meet`,
        templateVariables: {
          admin_name: primaryAdmin.fullName,
          company_name: company.name,
          login_url: `${emailConfig.appUrl}/login`,
          workspace_url: `${emailConfig.appUrl}/dashboard`,
        },
        metadata: { userId: primaryAdmin._id, companyId: company._id },
      });
    }

    console.log(`[Companies Admin] Company "${company.name}" approved by ${admin.email}`);
    return { body: { company }, httpStatus: 200 };
  } catch (error: any) {
    console.error('[Companies Admin] Error approving company:', error.message);
    return { body: { error: 'Failed to approve company' }, httpStatus: 500 };
  }
}

/** Body: { reason?: string }. Leaves the registering admin's Firebase account disabled. */
export async function rejectCompany(firebaseUid: string | undefined, id: string, reasonRaw: unknown): Promise<IServiceResult> {
  try {
    const admin = await resolveSuperAdmin(firebaseUid);
    if (!admin) {
      return { body: { error: 'Super Admin access required' }, httpStatus: 403 };
    }
    const company = await Company.findById(id);
    if (!company) {
      return { body: { error: 'Company not found' }, httpStatus: 404 };
    }

    const reason = typeof reasonRaw === 'string' ? reasonRaw.trim().slice(0, 500) : '';
    company.status = 'REJECTED';
    company.rejectionReason = reason || 'Registration was not approved.';
    await company.save();

    const primaryAdmin = await User.findOne({ companyId: company._id, role: 'COMPANY_ADMIN' });
    if (primaryAdmin) {
      sendEmailAsync({
        to: primaryAdmin.email,
        templateName: 'E4_REG_REJECTED',
        subject: `Update on your ${company.name} registration - Toowix Meet`,
        templateVariables: {
          admin_name: primaryAdmin.fullName,
          company_name: company.name,
          rejection_reason: company.rejectionReason || '',
          support_email: emailConfig.supportEmail,
        },
        metadata: { userId: primaryAdmin._id, companyId: company._id },
      });
    }

    console.log(`[Companies Admin] Company "${company.name}" rejected by ${admin.email}`);
    return { body: { company }, httpStatus: 200 };
  } catch (error: any) {
    console.error('[Companies Admin] Error rejecting company:', error.message);
    return { body: { error: 'Failed to reject company' }, httpStatus: 500 };
  }
}

/**
 * Suspends an ACTIVE company. verifyFirebaseToken already rejects every request for a
 * non-ACTIVE company (auth.ts: `company.status !== 'ACTIVE'` -> 403), so this alone is a real,
 * immediate access block for every user in the workspace -- no per-user Firebase changes needed.
 */
export async function suspendCompany(firebaseUid: string | undefined, id: string): Promise<IServiceResult> {
  try {
    const admin = await resolveSuperAdmin(firebaseUid);
    if (!admin) {
      return { body: { error: 'Super Admin access required' }, httpStatus: 403 };
    }
    const company = await Company.findById(id);
    if (!company) {
      return { body: { error: 'Company not found' }, httpStatus: 404 };
    }
    company.status = 'SUSPENDED';
    company.suspendedAt = new Date();
    await company.save();
    console.log(`[Companies Admin] Company "${company.name}" suspended by ${admin.email}`);
    return { body: { company }, httpStatus: 200 };
  } catch (error: any) {
    console.error('[Companies Admin] Error suspending company:', error.message);
    return { body: { error: 'Failed to suspend company' }, httpStatus: 500 };
  }
}

/** Restores a SUSPENDED company to ACTIVE. */
export async function reactivateCompany(firebaseUid: string | undefined, id: string): Promise<IServiceResult> {
  try {
    const admin = await resolveSuperAdmin(firebaseUid);
    if (!admin) {
      return { body: { error: 'Super Admin access required' }, httpStatus: 403 };
    }
    const company = await Company.findById(id);
    if (!company) {
      return { body: { error: 'Company not found' }, httpStatus: 404 };
    }
    if (company.status !== 'SUSPENDED') {
      return { body: { error: 'Only a suspended company can be reactivated' }, httpStatus: 400 };
    }
    company.status = 'ACTIVE';
    company.suspendedAt = null;
    await company.save();
    console.log(`[Companies Admin] Company "${company.name}" reactivated by ${admin.email}`);
    return { body: { company }, httpStatus: 200 };
  } catch (error: any) {
    console.error('[Companies Admin] Error reactivating company:', error.message);
    return { body: { error: 'Failed to reactivate company' }, httpStatus: 500 };
  }
}

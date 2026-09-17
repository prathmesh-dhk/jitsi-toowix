import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { Company, CompanyStatus } from '../models/Company';
import { User } from '../models/User';
import { getFirebaseAuth } from '../config/firebase';
import { sendEmailAsync } from '../email/sender';
import { emailConfig } from '../config/email';

/**
 * Super Admin company lifecycle: approve/reject a PENDING self-registration, or
 * suspend/reactivate an already-ACTIVE company. `registerCompanyHandler` (register.ts) creates
 * companies as PENDING and disables the registering admin's Firebase account -- until this
 * file existed, nothing in the codebase could ever move a company out of PENDING, so every
 * self-registered workspace was permanently stuck (a real bug the audit flagged, not
 * intentional behavior: register.ts's own email copy and code comments say "Requires Super
 * Admin approval").
 */

const resolveSuperAdmin = async (req: AuthenticatedRequest) => {
  if (!req.firebaseUid) return null;
  const user = await User.findOne({ firebaseUid: req.firebaseUid });
  return user && user.role === 'SUPER_ADMIN' ? user : null;
};

const CompanySummary = 'name slug status plan logoUrl rejectionReason suspendedAt createdAt updatedAt';

/**
 * GET /api/companies/admin?status=PENDING
 * Lists companies for the Super Admin console. Defaults to PENDING (the actionable queue);
 * pass status=ACTIVE|REJECTED|SUSPENDED or omit the filter entirely with status=ALL.
 */
export const listCompaniesForAdminHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!(await resolveSuperAdmin(req))) {
      res.status(403).json({ error: 'Super Admin access required' });
      return;
    }
    const requested = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : 'PENDING';
    const validStatuses: CompanyStatus[] = ['PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED'];
    const filter = validStatuses.includes(requested as CompanyStatus) ? { status: requested } : {};

    const companies = await Company.find(filter).select(CompanySummary).sort({ createdAt: -1 }).limit(500);
    res.json({ companies });
  } catch (error: any) {
    console.error('[Companies Admin] Error listing companies:', error.message);
    res.status(500).json({ error: 'Failed to list companies' });
  }
};

/**
 * POST /api/companies/admin/:id/approve
 * Activates a PENDING company and re-enables every associated user's Firebase account (the
 * registering admin's account was disabled at registration time; any teammates added since
 * would already be active, so re-enabling is a safe no-op for them).
 */
export const approveCompanyHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const admin = await resolveSuperAdmin(req);
    if (!admin) {
      res.status(403).json({ error: 'Super Admin access required' });
      return;
    }
    const company = await Company.findById(req.params.id);
    if (!company) {
      res.status(404).json({ error: 'Company not found' });
      return;
    }
    if (company.status === 'ACTIVE') {
      res.json({ company });
      return;
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
    res.json({ company });
  } catch (error: any) {
    console.error('[Companies Admin] Error approving company:', error.message);
    res.status(500).json({ error: 'Failed to approve company' });
  }
};

/**
 * POST /api/companies/admin/:id/reject
 * Body: { reason?: string }. Leaves the registering admin's Firebase account disabled.
 */
export const rejectCompanyHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const admin = await resolveSuperAdmin(req);
    if (!admin) {
      res.status(403).json({ error: 'Super Admin access required' });
      return;
    }
    const company = await Company.findById(req.params.id);
    if (!company) {
      res.status(404).json({ error: 'Company not found' });
      return;
    }

    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : '';
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
    res.json({ company });
  } catch (error: any) {
    console.error('[Companies Admin] Error rejecting company:', error.message);
    res.status(500).json({ error: 'Failed to reject company' });
  }
};

/**
 * POST /api/companies/admin/:id/suspend
 * Suspends an ACTIVE company. verifyFirebaseToken already rejects every request for a
 * non-ACTIVE company (auth.ts: `company.status !== 'ACTIVE'` -> 403), so this alone is a real,
 * immediate access block for every user in the workspace -- no per-user Firebase changes needed.
 */
export const suspendCompanyHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const admin = await resolveSuperAdmin(req);
    if (!admin) {
      res.status(403).json({ error: 'Super Admin access required' });
      return;
    }
    const company = await Company.findById(req.params.id);
    if (!company) {
      res.status(404).json({ error: 'Company not found' });
      return;
    }
    company.status = 'SUSPENDED';
    company.suspendedAt = new Date();
    await company.save();
    console.log(`[Companies Admin] Company "${company.name}" suspended by ${admin.email}`);
    res.json({ company });
  } catch (error: any) {
    console.error('[Companies Admin] Error suspending company:', error.message);
    res.status(500).json({ error: 'Failed to suspend company' });
  }
};

/**
 * POST /api/companies/admin/:id/reactivate
 * Restores a SUSPENDED company to ACTIVE.
 */
export const reactivateCompanyHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const admin = await resolveSuperAdmin(req);
    if (!admin) {
      res.status(403).json({ error: 'Super Admin access required' });
      return;
    }
    const company = await Company.findById(req.params.id);
    if (!company) {
      res.status(404).json({ error: 'Company not found' });
      return;
    }
    if (company.status !== 'SUSPENDED') {
      res.status(400).json({ error: 'Only a suspended company can be reactivated' });
      return;
    }
    company.status = 'ACTIVE';
    company.suspendedAt = null;
    await company.save();
    console.log(`[Companies Admin] Company "${company.name}" reactivated by ${admin.email}`);
    res.json({ company });
  } catch (error: any) {
    console.error('[Companies Admin] Error reactivating company:', error.message);
    res.status(500).json({ error: 'Failed to reactivate company' });
  }
};

import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import * as companyService from './company.service';

// Every function here does exactly one thing: parse the HTTP request, call one
// company.service.ts function, and send the result back out. No business logic lives in this
// file -- see company.service.ts for the actual rules.

/**
 * POST /api/companies/register
 * Tue-BE-4: Register a new company workspace.
 */
export const registerCompanyHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { name, slug, logoUrl } = req.body;
  const result = await companyService.registerCompany({
    firebaseUid: req.firebaseUid,
    email: req.firebaseEmail,
    name,
    slug,
    logoUrl,
    ip: req.ip,
  });
  res.status(result.httpStatus).json(result.body);
};

/**
 * GET /api/companies/meeting-policy
 */
export const getMeetingPolicyHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await companyService.getMeetingPolicy(req.firebaseUid);
  res.status(result.httpStatus).json(result.body);
};

/**
 * PATCH /api/companies/meeting-policy
 */
export const updateMeetingPolicyHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await companyService.updateMeetingPolicy(req.firebaseUid, req.body || {});
  res.status(result.httpStatus).json(result.body);
};

/**
 * GET /api/companies/admin?status=PENDING
 */
export const listCompaniesForAdminHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await companyService.listCompaniesForAdmin(req.firebaseUid, req.query.status);
  res.status(result.httpStatus).json(result.body);
};

/**
 * POST /api/companies/admin/:id/approve
 */
export const approveCompanyHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await companyService.approveCompany(req.firebaseUid, req.params.id);
  res.status(result.httpStatus).json(result.body);
};

/**
 * POST /api/companies/admin/:id/reject  { reason?: string }
 */
export const rejectCompanyHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await companyService.rejectCompany(req.firebaseUid, req.params.id, req.body?.reason);
  res.status(result.httpStatus).json(result.body);
};

/**
 * POST /api/companies/admin/:id/suspend
 */
export const suspendCompanyHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await companyService.suspendCompany(req.firebaseUid, req.params.id);
  res.status(result.httpStatus).json(result.body);
};

/**
 * POST /api/companies/admin/:id/reactivate
 */
export const reactivateCompanyHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await companyService.reactivateCompany(req.firebaseUid, req.params.id);
  res.status(result.httpStatus).json(result.body);
};

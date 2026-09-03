import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { User } from '../models/User';
import { Company, MeetingCreatorRole } from '../models/Company';

const resolveUser = async (req: AuthenticatedRequest) => {
  if (!req.firebaseUid) return null;
  return User.findOne({ firebaseUid: req.firebaseUid });
};

const isAdminRole = (role?: string) => role === 'COMPANY_ADMIN' || role === 'SUPER_ADMIN';

/**
 * GET /api/companies/meeting-policy
 * Returns the caller's company meeting policy. Any company member can view it (so the
 * UI can explain "why can't I create a meeting" etc.) -- only admins can change it.
 */
export const getMeetingPolicyHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user = await resolveUser(req);
    if (!user) {
      res.status(404).json({ error: 'User profile not found' });
      return;
    }
    if (!user.companyId) {
      res.status(404).json({ error: 'You are not part of a company workspace' });
      return;
    }
    const company = await Company.findById(user.companyId).select('meetingPolicy name');
    if (!company) {
      res.status(404).json({ error: 'Company not found' });
      return;
    }
    res.json({ meetingPolicy: company.meetingPolicy, canEdit: isAdminRole(user.role) });
  } catch (error: any) {
    console.error('[Companies] Error fetching meeting policy:', error.message);
    res.status(500).json({ error: 'Failed to fetch meeting policy' });
  }
};

const ROLES: MeetingCreatorRole[] = ['COMPANY_ADMIN', 'HOST', 'MEMBER'];
const BOOLEAN_FIELDS = ['allowGuestAccess', 'requireLobby', 'recordingEnabled', 'autoRecording', 'allowScreenShare', 'micLockEnabled', 'require2FA'] as const;
const ROLE_ARRAY_FIELDS = ['whoCanHost', 'whoCanCreateMeetings'] as const;

/**
 * PATCH /api/companies/meeting-policy
 * Company admins (or Super Admin) only. Partial update -- only supplied fields change.
 */
export const updateMeetingPolicyHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user = await resolveUser(req);
    if (!user) {
      res.status(404).json({ error: 'User profile not found' });
      return;
    }
    if (!user.companyId || !isAdminRole(user.role)) {
      res.status(403).json({ error: 'Only a company admin can change meeting policy' });
      return;
    }
    const company = await Company.findById(user.companyId);
    if (!company) {
      res.status(404).json({ error: 'Company not found' });
      return;
    }

    const body = req.body || {};

    for (const field of ROLE_ARRAY_FIELDS) {
      if (body[field] !== undefined) {
        if (!Array.isArray(body[field]) || !body[field].every((r: any) => ROLES.includes(r))) {
          res.status(400).json({ error: `${field} must be an array of roles: ${ROLES.join(', ')}` });
          return;
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
        res.status(400).json({ error: 'maxMeetingDurationMinutes must be a positive number or null' });
        return;
      }
      company.meetingPolicy.maxMeetingDurationMinutes = value;
    }

    await company.save();
    res.json({ meetingPolicy: company.meetingPolicy });
  } catch (error: any) {
    console.error('[Companies] Error updating meeting policy:', error.message);
    res.status(500).json({ error: 'Failed to update meeting policy' });
  }
};

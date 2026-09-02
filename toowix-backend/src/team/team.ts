import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { Company } from '../models/Company';
import { TeamInvite } from '../models/TeamInvite';
import { User } from '../models/User';
import { emailConfig } from '../config/email';
import { sendEmailAsync } from '../email/sender';

const resolveUser = async (req: AuthenticatedRequest) => {
  if (!req.firebaseUid) return null;
  return User.findOne({ firebaseUid: req.firebaseUid });
};

const isAdminRole = (role?: string) => role === 'COMPANY_ADMIN' || role === 'SUPER_ADMIN';
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const assertManager = async (req: AuthenticatedRequest, res: Response) => {
  const user = await resolveUser(req);
  if (!user) {
    res.status(404).json({ error: 'User profile not found' });
    return null;
  }
  if (!user.companyId || !isAdminRole(user.role)) {
    res.status(403).json({ error: 'Only a company admin can manage team members' });
    return null;
  }
  return user;
};

const validateManager = async (companyId: unknown, managerId?: string | null) => {
  if (!managerId) return null;
  const manager = await User.findById(managerId);
  if (!manager || String(manager.companyId) !== String(companyId) || !['COMPANY_ADMIN', 'HOST'].includes(manager.role)) return undefined;
  return manager;
};

const sendInvite = async (invite: any, inviterName: string, companyName: string) => {
  const inviteUrl = `${emailConfig.appUrl}/signup?invite=${invite._id}&email=${encodeURIComponent(invite.email)}`;
  return sendEmailAsync({
    to: invite.email,
    templateName: 'E8_INVITE_MEMBER',
    subject: `${inviterName} invited you to ${companyName} on Toowix Meet`,
    templateVariables: {
      inviter_name: inviterName,
      company_name: companyName,
      role: invite.role === 'COMPANY_ADMIN' ? 'Admin' : invite.role === 'HOST' ? 'Subadmin' : 'User',
      invite_url: inviteUrl,
    },
    metadata: { companyId: String(invite.companyId), userId: String(invite.invitedBy) },
  });
};

/** Lists live workspace users and pending invitations in one hierarchy-ready payload. */
export const listTeamUsersHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user = await resolveUser(req);
    if (!user) {
      res.status(404).json({ error: 'User profile not found' });
      return;
    }
    if (!user.companyId) {
      res.json({ users: [] });
      return;
    }

    const [users, invites] = await Promise.all([
      User.find({ companyId: user.companyId })
        .select('fullName email avatarUrl role status reportsTo lastActiveAt createdAt updatedAt')
        .populate('reportsTo', 'fullName email')
        .sort({ createdAt: 1 }),
      TeamInvite.find({ companyId: user.companyId, expiresAt: { $gt: new Date() } })
        .populate('reportsTo', 'fullName email')
        .sort({ createdAt: 1 }),
    ]);

    const pendingInvites = invites.map((invite: any) => ({
      id: `invite:${invite._id}`,
      fullName: invite.fullName,
      email: invite.email,
      role: invite.role,
      status: 'INVITED',
      reportsTo: invite.reportsTo,
      lastActiveAt: null,
      updatedAt: invite.updatedAt,
      createdAt: invite.createdAt,
      isInvite: true,
    }));

    res.json({ users: [...users, ...pendingInvites] });
  } catch (error: any) {
    console.error('[Team] Error listing team users:', error.message);
    res.status(500).json({ error: 'Failed to fetch team users' });
  }
};

/** Creates and emails a seven-day workspace invitation. */
export const createTeamInviteHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const actingUser = await assertManager(req, res);
    if (!actingUser) return;

    const fullName = String(req.body.fullName || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const role = String(req.body.role || 'MEMBER');
    const reportsTo = req.body.reportsTo ? String(req.body.reportsTo) : null;
    if (!fullName || !/^\S+@\S+\.\S+$/.test(email)) {
      res.status(400).json({ error: 'A valid name and email address are required' });
      return;
    }
    if (!['COMPANY_ADMIN', 'HOST', 'MEMBER'].includes(role)) {
      res.status(400).json({ error: 'Invalid team role' });
      return;
    }
    if (await User.exists({ email })) {
      res.status(409).json({ error: 'A user with this email already exists' });
      return;
    }
    if (await TeamInvite.exists({ companyId: actingUser.companyId, email })) {
      res.status(409).json({ error: 'This person already has a pending invitation' });
      return;
    }

    const company = await Company.findById(actingUser.companyId);
    if (!company) {
      res.status(404).json({ error: 'Company workspace not found' });
      return;
    }
    const [memberCount, inviteCount] = await Promise.all([
      User.countDocuments({ companyId: actingUser.companyId }),
      TeamInvite.countDocuments({ companyId: actingUser.companyId, expiresAt: { $gt: new Date() } }),
    ]);
    if (memberCount + inviteCount >= company.limits.maxUsers) {
      res.status(409).json({ error: `Your ${company.plan} plan is limited to ${company.limits.maxUsers} users` });
      return;
    }

    const manager = role === 'COMPANY_ADMIN' ? null : await validateManager(actingUser.companyId, reportsTo);
    if (reportsTo && manager === undefined) {
      res.status(400).json({ error: 'The selected reporting manager is invalid' });
      return;
    }

    const invite = await TeamInvite.create({
      companyId: actingUser.companyId,
      invitedBy: actingUser._id,
      fullName,
      email,
      role,
      reportsTo: manager?._id || null,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    });
    await sendInvite(invite, actingUser.fullName, company.name);
    res.status(201).json({ invite: await invite.populate('reportsTo', 'fullName email') });
  } catch (error: any) {
    console.error('[Team] Error inviting team user:', error.message);
    res.status(error.code === 11000 ? 409 : 500).json({ error: error.code === 11000 ? 'This person already has a pending invitation' : 'Failed to invite team member' });
  }
};

/** Reassigns role, reporting manager, or status for a live member or pending invite. */
export const updateTeamUserHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const actingUser = await assertManager(req, res);
    if (!actingUser) return;

    const isInvite = req.params.id.startsWith('invite:');
    const targetId = isInvite ? req.params.id.slice(7) : req.params.id;
    const target: any = isInvite ? await TeamInvite.findById(targetId) : await User.findById(targetId);
    if (!target || String(target.companyId) !== String(actingUser.companyId)) {
      res.status(404).json({ error: 'Team member not found' });
      return;
    }
    if (!isInvite && String(target._id) === String(actingUser._id) && req.body.status && req.body.status !== 'ACTIVE') {
      res.status(400).json({ error: 'You cannot deactivate your own account' });
      return;
    }

    const { role, reportsTo, status } = req.body;
    if (role !== undefined && !['COMPANY_ADMIN', 'HOST', 'MEMBER'].includes(role)) {
      res.status(400).json({ error: 'Invalid role' });
      return;
    }
    if (status !== undefined && (isInvite || !['ACTIVE', 'SUSPENDED', 'INACTIVE'].includes(status))) {
      res.status(400).json({ error: 'Invalid status' });
      return;
    }

    const effectiveRole = role || target.role;
    if (reportsTo !== undefined || effectiveRole === 'COMPANY_ADMIN') {
      const managerId = effectiveRole === 'COMPANY_ADMIN' ? null : (reportsTo || null);
      if (managerId && String(managerId) === String(target._id)) {
        res.status(400).json({ error: 'A team member cannot report to themselves' });
        return;
      }
      const manager = await validateManager(actingUser.companyId, managerId);
      if (managerId && manager === undefined) {
        res.status(400).json({ error: 'The selected reporting manager is invalid' });
        return;
      }
      if (effectiveRole === 'HOST' && manager?.role === 'HOST') {
        res.status(400).json({ error: 'A subadmin must report to an admin' });
        return;
      }
      target.reportsTo = manager?._id || null;
    }
    if (role !== undefined) target.role = role;
    if (status !== undefined && !isInvite) target.status = status;

    await target.save();
    res.json({ user: await target.populate('reportsTo', 'fullName email') });
  } catch (error: any) {
    console.error('[Team] Error updating team user:', error.message);
    res.status(500).json({ error: 'Failed to update team member' });
  }
};

export const resendTeamInviteHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const actingUser = await assertManager(req, res);
    if (!actingUser) return;
    const invite = await TeamInvite.findById(req.params.id);
    if (!invite || String(invite.companyId) !== String(actingUser.companyId)) {
      res.status(404).json({ error: 'Invitation not found' });
      return;
    }
    const company = await Company.findById(actingUser.companyId);
    invite.expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    invite.invitedBy = actingUser._id as any;
    await invite.save();
    await sendInvite(invite, actingUser.fullName, company?.name || 'your team');
    res.json({ message: 'Invitation resent' });
  } catch (error: any) {
    console.error('[Team] Error resending invitation:', error.message);
    res.status(500).json({ error: 'Failed to resend invitation' });
  }
};

export const deleteTeamInviteHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const actingUser = await assertManager(req, res);
    if (!actingUser) return;
    const invite = await TeamInvite.findById(req.params.id);
    if (!invite || String(invite.companyId) !== String(actingUser.companyId)) {
      res.status(404).json({ error: 'Invitation not found' });
      return;
    }
    await invite.deleteOne();
    res.json({ message: 'Invitation cancelled' });
  } catch (error: any) {
    console.error('[Team] Error cancelling invitation:', error.message);
    res.status(500).json({ error: 'Failed to cancel invitation' });
  }
};

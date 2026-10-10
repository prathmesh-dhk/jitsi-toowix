import { Company } from '../models/Company';
import { TeamInvite } from '../models/TeamInvite';
import { User, IUserDocument } from '../models/User';
import { emailConfig } from '../config/email';
import { sendEmailAsync } from '../email/sender';
import { notifyUser, notifyCompany } from '../notifications/notification.service';

// All business rules for team membership (list, invite, update role/manager/status, resend/
// cancel invites) live here as plain functions -- no `req`/`res` anywhere in this file.
// team.controller.ts parses HTTP in, calls one of these, and sends the result back out.

export interface IServiceResult<T = any> {
  body: T;
  httpStatus: number;
}

async function resolveUser(firebaseUid: string | undefined) {
  if (!firebaseUid) return null;
  return User.findOne({ firebaseUid });
}

const isAdminRole = (role?: string) => role === 'COMPANY_ADMIN' || role === 'SUPER_ADMIN';
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type IManagerResult =
  | { ok: true; user: IUserDocument }
  | { ok: false; body: any; httpStatus: number };

/** Resolves the caller and confirms they're allowed to manage this company's team -- every
 * mutating team endpoint below needs exactly this check first. */
async function resolveManager(firebaseUid: string | undefined): Promise<IManagerResult> {
  const user = await resolveUser(firebaseUid);
  if (!user) {
    return { ok: false, body: { error: 'User profile not found' }, httpStatus: 404 };
  }
  if (!user.companyId || !isAdminRole(user.role)) {
    return { ok: false, body: { error: 'Only a company admin can manage team members' }, httpStatus: 403 };
  }
  return { ok: true, user };
}

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
export async function listTeamUsers(firebaseUid: string | undefined): Promise<IServiceResult> {
  try {
    const user = await resolveUser(firebaseUid);
    if (!user) {
      return { body: { error: 'User profile not found' }, httpStatus: 404 };
    }
    if (!user.companyId) {
      return { body: { users: [] }, httpStatus: 200 };
    }

    const [ users, invites ] = await Promise.all([
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

    return { body: { users: [ ...users, ...pendingInvites ] }, httpStatus: 200 };
  } catch (error: any) {
    console.error('[Team] Error listing team users:', error.message);
    return { body: { error: 'Failed to fetch team users' }, httpStatus: 500 };
  }
}

interface ICreateInviteParams {
  email?: string;
  fullName?: string;
  reportsTo?: string;
  role?: string;
}

/** Creates and emails a seven-day workspace invitation. */
export async function createTeamInvite(firebaseUid: string | undefined, params: ICreateInviteParams): Promise<IServiceResult> {
  const managerResult = await resolveManager(firebaseUid);
  if (!managerResult.ok) {
    return { body: managerResult.body, httpStatus: managerResult.httpStatus };
  }
  const actingUser = managerResult.user;

  try {
    const fullName = String(params.fullName || '').trim();
    const email = String(params.email || '').trim().toLowerCase();
    const role = String(params.role || 'MEMBER');
    const reportsTo = params.reportsTo ? String(params.reportsTo) : null;
    if (!fullName || !/^\S+@\S+\.\S+$/.test(email)) {
      return { body: { error: 'A valid name and email address are required' }, httpStatus: 400 };
    }
    if (!['COMPANY_ADMIN', 'HOST', 'MEMBER'].includes(role)) {
      return { body: { error: 'Invalid team role' }, httpStatus: 400 };
    }
    if (await User.exists({ email })) {
      return { body: { error: 'A user with this email already exists' }, httpStatus: 409 };
    }
    if (await TeamInvite.exists({ companyId: actingUser.companyId, email })) {
      return { body: { error: 'This person already has a pending invitation' }, httpStatus: 409 };
    }

    const company = await Company.findById(actingUser.companyId);
    if (!company) {
      return { body: { error: 'Company workspace not found' }, httpStatus: 404 };
    }
    const [ memberCount, inviteCount ] = await Promise.all([
      User.countDocuments({ companyId: actingUser.companyId }),
      TeamInvite.countDocuments({ companyId: actingUser.companyId, expiresAt: { $gt: new Date() } }),
    ]);
    if (memberCount + inviteCount >= company.limits.maxUsers) {
      return { body: { error: `Your ${company.plan} plan is limited to ${company.limits.maxUsers} users` }, httpStatus: 409 };
    }

    const manager = role === 'COMPANY_ADMIN' ? null : await validateManager(actingUser.companyId, reportsTo);
    if (reportsTo && manager === undefined) {
      return { body: { error: 'The selected reporting manager is invalid' }, httpStatus: 400 };
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

    notifyCompany(
      actingUser.companyId as any,
      {
        category: 'PEOPLE_TEAMS',
        type: 'USER_INVITE_PENDING',
        title: 'New user invitation pending',
        description: `${actingUser.fullName} invited ${fullName} (${email}) to join the team.`,
        relatedName: fullName,
        actionLabel: 'View',
        actionUrl: '/dashboard?tab=teams',
      },
      actingUser._id
    );

    return { body: { invite: await invite.populate('reportsTo', 'fullName email') }, httpStatus: 201 };
  } catch (error: any) {
    console.error('[Team] Error inviting team user:', error.message);
    return {
      body: { error: error.code === 11000 ? 'This person already has a pending invitation' : 'Failed to invite team member' },
      httpStatus: error.code === 11000 ? 409 : 500,
    };
  }
}

interface IUpdateTeamUserParams {
  reportsTo?: string;
  role?: string;
  status?: string;
}

/** Reassigns role, reporting manager, or status for a live member or pending invite. */
export async function updateTeamUser(firebaseUid: string | undefined, idParam: string, params: IUpdateTeamUserParams): Promise<IServiceResult> {
  const managerResult = await resolveManager(firebaseUid);
  if (!managerResult.ok) {
    return { body: managerResult.body, httpStatus: managerResult.httpStatus };
  }
  const actingUser = managerResult.user;

  try {
    const isInvite = idParam.startsWith('invite:');
    const targetId = isInvite ? idParam.slice(7) : idParam;
    const target: any = isInvite ? await TeamInvite.findById(targetId) : await User.findById(targetId);
    if (!target || String(target.companyId) !== String(actingUser.companyId)) {
      return { body: { error: 'Team member not found' }, httpStatus: 404 };
    }
    if (!isInvite && String(target._id) === String(actingUser._id) && params.status && params.status !== 'ACTIVE') {
      return { body: { error: 'You cannot deactivate your own account' }, httpStatus: 400 };
    }

    const { role, reportsTo, status } = params;
    if (role !== undefined && ![ 'COMPANY_ADMIN', 'HOST', 'MEMBER' ].includes(role)) {
      return { body: { error: 'Invalid role' }, httpStatus: 400 };
    }
    if (status !== undefined && (isInvite || ![ 'ACTIVE', 'SUSPENDED', 'INACTIVE' ].includes(status))) {
      return { body: { error: 'Invalid status' }, httpStatus: 400 };
    }

    const previousRole = target.role;
    const previousReportsTo = target.reportsTo ? String(target.reportsTo) : null;
    let reportsToChanged = false;

    const effectiveRole = role || target.role;
    if (reportsTo !== undefined || effectiveRole === 'COMPANY_ADMIN') {
      const managerId = effectiveRole === 'COMPANY_ADMIN' ? null : (reportsTo || null);
      if (managerId && String(managerId) === String(target._id)) {
        return { body: { error: 'A team member cannot report to themselves' }, httpStatus: 400 };
      }
      const manager = await validateManager(actingUser.companyId, managerId);
      if (managerId && manager === undefined) {
        return { body: { error: 'The selected reporting manager is invalid' }, httpStatus: 400 };
      }
      if (effectiveRole === 'HOST' && manager?.role === 'HOST') {
        return { body: { error: 'A subadmin must report to an admin' }, httpStatus: 400 };
      }
      const newReportsTo = manager?._id ? String(manager._id) : null;
      reportsToChanged = newReportsTo !== previousReportsTo;
      target.reportsTo = manager?._id || null;
    }
    if (role !== undefined) target.role = role;
    if (status !== undefined && !isInvite) target.status = status;

    await target.save();

    if (!isInvite) {
      const roleLabel = (r: string) => (r === 'COMPANY_ADMIN' ? 'Admin' : r === 'HOST' ? 'Subadmin' : 'User');
      if (role !== undefined && role !== previousRole) {
        notifyUser({
          userId: target._id,
          companyId: actingUser.companyId,
          category: 'PEOPLE_TEAMS',
          type: 'ROLE_CHANGED',
          title: `Role changed to ${roleLabel(role)}`,
          description: `${actingUser.fullName} changed your role to ${roleLabel(role)}.`,
        });
      }
      if (reportsToChanged) {
        notifyUser({
          userId: target._id,
          companyId: actingUser.companyId,
          category: 'PEOPLE_TEAMS',
          type: 'USER_MOVED_ADMIN',
          title: 'You were moved to another admin',
          description: `${actingUser.fullName} reassigned who you report to.`,
        });
      }
      if (status === 'SUSPENDED') {
        notifyUser({
          userId: target._id,
          companyId: actingUser.companyId,
          category: 'PEOPLE_TEAMS',
          type: 'USER_DISABLED',
          title: 'Your account was disabled',
          description: `${actingUser.fullName} disabled your account access.`,
        });
      }
    }

    return { body: { user: await target.populate('reportsTo', 'fullName email') }, httpStatus: 200 };
  } catch (error: any) {
    console.error('[Team] Error updating team user:', error.message);
    return { body: { error: 'Failed to update team member' }, httpStatus: 500 };
  }
}

/** Resends a pending invitation with a refreshed seven-day expiry. */
export async function resendTeamInvite(firebaseUid: string | undefined, inviteId: string): Promise<IServiceResult> {
  const managerResult = await resolveManager(firebaseUid);
  if (!managerResult.ok) {
    return { body: managerResult.body, httpStatus: managerResult.httpStatus };
  }
  const actingUser = managerResult.user;

  try {
    const invite = await TeamInvite.findById(inviteId);
    if (!invite || String(invite.companyId) !== String(actingUser.companyId)) {
      return { body: { error: 'Invitation not found' }, httpStatus: 404 };
    }
    const company = await Company.findById(actingUser.companyId);
    invite.expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    invite.invitedBy = actingUser._id as any;
    await invite.save();
    await sendInvite(invite, actingUser.fullName, company?.name || 'your team');
    return { body: { message: 'Invitation resent' }, httpStatus: 200 };
  } catch (error: any) {
    console.error('[Team] Error resending invitation:', error.message);
    return { body: { error: 'Failed to resend invitation' }, httpStatus: 500 };
  }
}

/** Cancels a pending invitation. */
export async function deleteTeamInvite(firebaseUid: string | undefined, inviteId: string): Promise<IServiceResult> {
  const managerResult = await resolveManager(firebaseUid);
  if (!managerResult.ok) {
    return { body: managerResult.body, httpStatus: managerResult.httpStatus };
  }
  const actingUser = managerResult.user;

  try {
    const invite = await TeamInvite.findById(inviteId);
    if (!invite || String(invite.companyId) !== String(actingUser.companyId)) {
      return { body: { error: 'Invitation not found' }, httpStatus: 404 };
    }
    await invite.deleteOne();
    return { body: { message: 'Invitation cancelled' }, httpStatus: 200 };
  } catch (error: any) {
    console.error('[Team] Error cancelling invitation:', error.message);
    return { body: { error: 'Failed to cancel invitation' }, httpStatus: 500 };
  }
}

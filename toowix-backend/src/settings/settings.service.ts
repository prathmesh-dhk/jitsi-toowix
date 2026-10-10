import { User } from '../models/User';
import { Company } from '../models/Company';
import { Recording } from '../models/Recording';
import { Session } from '../models/Session';
import { persistAvatarIfDataUri } from '../uploads/avatarStorage';

// All business rules for the Settings module (account/profile, preferences, storage, security
// sessions) live here as plain functions -- no `req`/`res` anywhere in this file.
// settings.controller.ts parses HTTP in (including pulling the avatar upload's requestOrigin and
// the X-Toowix-Session header out of `req` where a function needs them), calls one of these, and
// sends the result back out.

export interface IServiceResult<T = any> {
  body: T;
  httpStatus: number;
}

async function resolveUser(firebaseUid: string | undefined) {
  if (!firebaseUid) return null;
  return User.findOne({ firebaseUid });
}

const isAdminRole = (role?: string) => role === 'COMPANY_ADMIN' || role === 'SUPER_ADMIN';
const roleLabel = (role: string) => (role === 'COMPANY_ADMIN' || role === 'SUPER_ADMIN' ? 'Admin' : role === 'HOST' ? 'Subadmin' : 'User');

/**
 * Returns everything the Settings module needs in one call: the user's own
 * editable preferences plus read-only account/organization info.
 */
export async function getSettings(firebaseUid: string | undefined): Promise<IServiceResult> {
  try {
    const user = await resolveUser(firebaseUid);
    if (!user) {
      return { body: { error: 'User profile not found' }, httpStatus: 404 };
    }

    let company: any = null;
    if (user.companyId) {
      company = await Company.findById(user.companyId).select('name limits');
    }

    return {
      body: {
        account: {
          email: user.email,
          emailVerified: !!user.emailVerifiedAt,
          fullName: user.fullName,
          avatarUrl: user.avatarUrl,
          role: user.role,
          roleLabel: roleLabel(user.role),
          organization: company?.name || null,
          memberSince: user.createdAt,
          lastSignIn: user.lastActiveAt,
          passwordChangedAt: user.passwordChangedAt,
          twoFactorEnabled: user.twoFactor?.isEnabled || false,
          canManageOrgSettings: isAdminRole(user.role),
        },
        profileExtra: user.profileExtra || {},
        preferences: user.preferences || {},
        meetingDefaults: user.meetingDefaults || {},
        recordingPreferences: user.recordingPreferences || {},
        notificationPreferences: user.notificationPreferences || {},
      },
      httpStatus: 200,
    };
  } catch (error: any) {
    console.error('[Settings] Error fetching settings:', error.message);
    return { body: { error: 'Failed to fetch settings' }, httpStatus: 500 };
  }
}

interface IProfileParams {
  avatarUrl?: string;
  fullName?: string;
  jobTitle?: string;
  language?: string;
  phoneNumber?: string;
  requestOrigin: string;
  timezone?: string;
}

/** PATCH /settings/profile -- name/photo/phone/job title/timezone/language.
 * Email, organization, and role are intentionally not accepted here -- they're
 * read-only in the UI and enforced read-only here too, not just hidden client-side. */
export async function updateProfileSettings(firebaseUid: string | undefined, params: IProfileParams): Promise<IServiceResult> {
  try {
    const user = await resolveUser(firebaseUid);
    if (!user) {
      return { body: { error: 'User profile not found' }, httpStatus: 404 };
    }

    const { fullName, avatarUrl, phoneNumber, jobTitle, timezone, language, requestOrigin } = params;

    if (fullName !== undefined) {
      if (typeof fullName !== 'string' || !fullName.trim()) {
        return { body: { error: 'Full name is required' }, httpStatus: 400 };
      }
      user.fullName = fullName.trim();
    }
    if (avatarUrl !== undefined) {
      try {
        user.avatarUrl = (await persistAvatarIfDataUri(avatarUrl, String(user._id), requestOrigin)) || null;
      } catch (error: any) {
        return { body: { error: error.message || 'Could not process profile picture' }, httpStatus: 400 };
      }
    }

    if (phoneNumber !== undefined && phoneNumber !== null && phoneNumber !== '') {
      if (!/^[+]?[\d\s()-]{7,20}$/.test(phoneNumber)) {
        return { body: { error: 'Please provide a valid phone number' }, httpStatus: 400 };
      }
    }

    user.profileExtra = {
      ...(user.profileExtra || {}),
      ...(phoneNumber !== undefined ? { phoneNumber: phoneNumber || null } : {}),
      ...(jobTitle !== undefined ? { jobTitle: jobTitle || null } : {}),
      ...(timezone !== undefined ? { timezone } : {}),
      ...(language !== undefined ? { language } : {}),
    };

    await user.save();
    return { body: { profileExtra: user.profileExtra, fullName: user.fullName, avatarUrl: user.avatarUrl }, httpStatus: 200 };
  } catch (error: any) {
    console.error('[Settings] Error updating profile:', error.message);
    return { body: { error: 'Failed to update profile' }, httpStatus: 500 };
  }
}

/** PATCH /settings/general */
export async function updateGeneralSettings(firebaseUid: string | undefined, patch: Record<string, any>): Promise<IServiceResult> {
  try {
    const user = await resolveUser(firebaseUid);
    if (!user) {
      return { body: { error: 'User profile not found' }, httpStatus: 404 };
    }
    user.preferences = { ...(user.preferences || {}), ...patch };
    await user.save();
    return { body: { preferences: user.preferences }, httpStatus: 200 };
  } catch (error: any) {
    console.error('[Settings] Error updating general settings:', error.message);
    return { body: { error: 'Failed to update general settings' }, httpStatus: 500 };
  }
}

/** PATCH /settings/meetings */
export async function updateMeetingSettings(firebaseUid: string | undefined, patch: Record<string, any>): Promise<IServiceResult> {
  try {
    const user = await resolveUser(firebaseUid);
    if (!user) {
      return { body: { error: 'User profile not found' }, httpStatus: 404 };
    }
    user.meetingDefaults = { ...(user.meetingDefaults || {}), ...patch };
    await user.save();
    return { body: { meetingDefaults: user.meetingDefaults }, httpStatus: 200 };
  } catch (error: any) {
    console.error('[Settings] Error updating meeting settings:', error.message);
    return { body: { error: 'Failed to update meeting settings' }, httpStatus: 500 };
  }
}

/** PATCH /settings/recording */
export async function updateRecordingSettings(firebaseUid: string | undefined, patch: Record<string, any>): Promise<IServiceResult> {
  try {
    const user = await resolveUser(firebaseUid);
    if (!user) {
      return { body: { error: 'User profile not found' }, httpStatus: 404 };
    }
    user.recordingPreferences = { ...(user.recordingPreferences || {}), ...patch };
    await user.save();
    return { body: { recordingPreferences: user.recordingPreferences }, httpStatus: 200 };
  } catch (error: any) {
    console.error('[Settings] Error updating recording settings:', error.message);
    return { body: { error: 'Failed to update recording settings' }, httpStatus: 500 };
  }
}

/**
 * PATCH /settings/notifications
 * Handles the "mute all" snapshot/restore behavior server-side so it's correct
 * regardless of which client toggles it.
 */
export async function updateNotificationSettings(firebaseUid: string | undefined, patch: Record<string, any>): Promise<IServiceResult> {
  try {
    const user = await resolveUser(firebaseUid);
    if (!user) {
      return { body: { error: 'User profile not found' }, httpStatus: 404 };
    }

    const current = user.notificationPreferences || {};
    const { muteAll, reminderMinutesBefore, entries } = patch;

    let nextEntries = entries !== undefined ? entries : current.entries;
    let nextSnapshot = current.preMuteSnapshot;

    if (muteAll !== undefined && muteAll !== current.muteAll) {
      if (muteAll) {
        // Turning mute-all ON: snapshot current entries, then mute everything non-critical.
        nextSnapshot = current.entries || {};
        nextEntries = Object.fromEntries(
          Object.entries(nextSnapshot).map(([ key, value ]: [ string, any ]) => [
            key,
            key.startsWith('SECURITY_') ? value : { inApp: false, email: false },
          ])
        );
      } else {
        // Turning mute-all OFF: restore exactly what the user had before, not a fresh "all on".
        nextEntries = nextSnapshot || current.entries || {};
        nextSnapshot = null;
      }
    }

    user.notificationPreferences = {
      ...current,
      ...(muteAll !== undefined ? { muteAll } : {}),
      ...(reminderMinutesBefore !== undefined ? { reminderMinutesBefore } : {}),
      entries: nextEntries,
      preMuteSnapshot: nextSnapshot,
    };
    await user.save();
    return { body: { notificationPreferences: user.notificationPreferences }, httpStatus: 200 };
  } catch (error: any) {
    console.error('[Settings] Error updating notification settings:', error.message);
    return { body: { error: 'Failed to update notification settings' }, httpStatus: 500 };
  }
}

/**
 * GET /settings/storage
 * Real data: aggregated from actual Recording documents + the company's real
 * storageLimitBytes (already tracked on Company.limits).
 */
export async function getStorageSettings(firebaseUid: string | undefined): Promise<IServiceResult> {
  try {
    const user = await resolveUser(firebaseUid);
    if (!user) {
      return { body: { error: 'User profile not found' }, httpStatus: 404 };
    }

    const filter = user.companyId ? { companyId: user.companyId } : { createdBy: user._id };
    const company = user.companyId ? await Company.findById(user.companyId).select('limits') : null;

    const [ breakdown, largest ] = await Promise.all([
      Recording.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            videoBytes: { $sum: '$sizeBytes' },
            audioBytes: { $sum: { $ifNull: [ '$audioSizeBytes', 0 ] } },
            transcriptBytes: { $sum: { $ifNull: [ '$transcriptSizeBytes', 0 ] } },
            captionsBytes: { $sum: { $ifNull: [ '$captionsSizeBytes', 0 ] } },
            chatBytes: { $sum: { $ifNull: [ '$chatSizeBytes', 0 ] } },
          },
        },
      ]),
      Recording.find(filter)
        .populate('createdBy', 'fullName')
        .sort({ sizeBytes: -1 })
        .limit(10)
        .select('name recordedAt sizeBytes createdBy'),
    ]);

    const b = breakdown[0] || { videoBytes: 0, audioBytes: 0, transcriptBytes: 0, captionsBytes: 0, chatBytes: 0 };
    const totalUsed = b.videoBytes + b.audioBytes + b.transcriptBytes + b.captionsBytes + b.chatBytes;
    const limitBytes = company?.limits?.storageLimitBytes ?? null;

    return {
      body: {
        usedBytes: totalUsed,
        limitBytes,
        availableBytes: limitBytes !== null ? Math.max(0, limitBytes - totalUsed) : null,
        breakdown: {
          video: b.videoBytes,
          audio: b.audioBytes,
          transcripts: b.transcriptBytes,
          captions: b.captionsBytes,
          chatAndFiles: b.chatBytes,
        },
        retentionDays: company?.limits?.recordingRetentionDays ?? user.recordingPreferences?.retentionDays ?? 90,
        largestRecordings: largest.map((r: any) => ({
          id: r._id,
          name: r.name,
          recordedAt: r.recordedAt,
          organizer: r.createdBy?.fullName || 'Unknown',
          sizeBytes: r.sizeBytes,
        })),
        canManageStoragePolicy: isAdminRole(user.role),
      },
      httpStatus: 200,
    };
  } catch (error: any) {
    console.error('[Settings] Error fetching storage settings:', error.message);
    return { body: { error: 'Failed to fetch storage settings' }, httpStatus: 500 };
  }
}

/**
 * POST /settings/security/password-changed
 * Called by the client right after it successfully changes the Firebase password
 * itself (Firebase requires the client SDK for that -- reauthenticate + updatePassword).
 * This just records the date so the UI can show "last changed".
 */
export async function recordPasswordChanged(firebaseUid: string | undefined): Promise<IServiceResult> {
  try {
    const user = await resolveUser(firebaseUid);
    if (!user) {
      return { body: { error: 'User profile not found' }, httpStatus: 404 };
    }
    user.passwordChangedAt = new Date();
    await user.save();
    return { body: { passwordChangedAt: user.passwordChangedAt }, httpStatus: 200 };
  } catch (error: any) {
    console.error('[Settings] Error recording password change:', error.message);
    return { body: { error: 'Failed to record password change' }, httpStatus: 500 };
  }
}

/**
 * POST /settings/security/deactivate
 * Body: { confirmPassword: string } -- actual password verification happens on the
 * client via Firebase reauthentication before this is called; this just flips status.
 * Blocks the sole remaining Admin of a company from deactivating themselves.
 */
export async function deactivateAccount(firebaseUid: string | undefined): Promise<IServiceResult> {
  try {
    const user = await resolveUser(firebaseUid);
    if (!user) {
      return { body: { error: 'User profile not found' }, httpStatus: 404 };
    }

    if (isAdminRole(user.role) && user.companyId) {
      const otherAdminCount = await User.countDocuments({
        companyId: user.companyId,
        role: { $in: [ 'COMPANY_ADMIN', 'SUPER_ADMIN' ] },
        status: 'ACTIVE',
        _id: { $ne: user._id },
      });
      if (otherAdminCount === 0) {
        return { body: { error: 'You are the only Admin in this organization. Assign another Admin before deactivating your account.' }, httpStatus: 400 };
      }
    }

    user.status = 'INACTIVE';
    await user.save();
    return { body: { message: 'Account deactivated' }, httpStatus: 200 };
  } catch (error: any) {
    console.error('[Settings] Error deactivating account:', error.message);
    return { body: { error: 'Failed to deactivate account' }, httpStatus: 500 };
  }
}

/**
 * GET /settings/security/sessions
 * Real active-session list, sourced from Session records created at each login-gate
 * success. The caller's X-Toowix-Session header marks which row is "this device" --
 * Firebase doesn't expose that natively, so the client has to tell us.
 * IP addresses are shown in full only to the session's own owner (nobody else can query
 * another user's sessions anyway, since this always scopes to the caller's own firebaseUid).
 */
export async function listSessions(firebaseUid: string | undefined, currentToken: string | undefined): Promise<IServiceResult> {
  try {
    const user = await resolveUser(firebaseUid);
    if (!user) {
      return { body: { error: 'User profile not found' }, httpStatus: 404 };
    }

    const sessions = await Session.find({ userId: user._id, revokedAt: null })
      .sort({ lastSeenAt: -1 })
      .limit(25);

    return {
      body: {
        sessions: sessions.map((s) => ({
          id: s._id,
          browser: s.browser,
          os: s.os,
          ipAddress: s.ipAddress,
          createdAt: s.createdAt,
          lastSeenAt: s.lastSeenAt,
          isCurrent: !!currentToken && s.sessionToken === currentToken,
          // Honest limitation: no geolocation lookup is configured (would need a real
          // IP-geolocation API key), so we do not fabricate a city/country here.
          location: 'Not available',
        })),
      },
      httpStatus: 200,
    };
  } catch (error: any) {
    console.error('[Settings] Error listing sessions:', error.message);
    return { body: { error: 'Failed to fetch sessions' }, httpStatus: 500 };
  }
}

/** Revokes this user's selected application session. Middleware rejects its next request. */
export async function revokeSession(firebaseUid: string | undefined, sessionId: string): Promise<IServiceResult> {
  try {
    const user = await resolveUser(firebaseUid);
    if (!user) {
      return { body: { error: 'User profile not found' }, httpStatus: 404 };
    }
    const session = await Session.findOne({ _id: sessionId, userId: user._id });
    if (!session) {
      return { body: { error: 'Session not found' }, httpStatus: 404 };
    }
    session.revokedAt = new Date();
    await session.save();
    return { body: { message: 'Session removed' }, httpStatus: 200 };
  } catch (error: any) {
    console.error('[Settings] Error revoking session:', error.message);
    return { body: { error: 'Failed to revoke session' }, httpStatus: 500 };
  }
}

/** Revoke other application sessions while preserving the authenticated current session. */
export async function revokeOtherSessions(firebaseUid: string | undefined, currentToken: string | undefined): Promise<IServiceResult> {
  try {
    const user = await resolveUser(firebaseUid);
    if (!user) {
      return { body: { error: 'User profile not found' }, httpStatus: 404 };
    }

    await Session.updateMany(
      { userId: user._id, revokedAt: null, ...(currentToken ? { sessionToken: { $ne: currentToken } } : {}) },
      { revokedAt: new Date() }
    );

    return { body: { message: 'Other sessions signed out' }, httpStatus: 200 };
  } catch (error: any) {
    console.error('[Settings] Error revoking other sessions:', error.message);
    return { body: { error: 'Failed to sign out other sessions' }, httpStatus: 500 };
  }
}

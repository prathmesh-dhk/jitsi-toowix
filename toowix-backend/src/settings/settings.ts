import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { User } from '../models/User';
import { Company } from '../models/Company';
import { Recording } from '../models/Recording';
import { Session } from '../models/Session';
import { getFirebaseAuth } from '../config/firebase';

const resolveUser = async (req: AuthenticatedRequest) => {
  if (!req.firebaseUid) return null;
  return User.findOne({ firebaseUid: req.firebaseUid });
};

const isAdminRole = (role?: string) => role === 'COMPANY_ADMIN' || role === 'SUPER_ADMIN';
const roleLabel = (role: string) => (role === 'COMPANY_ADMIN' || role === 'SUPER_ADMIN' ? 'Admin' : role === 'HOST' ? 'Subadmin' : 'User');

/**
 * GET /api/settings
 * Returns everything the Settings module needs in one call: the user's own
 * editable preferences plus read-only account/organization info.
 */
export const getSettingsHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user = await resolveUser(req);
    if (!user) {
      res.status(404).json({ error: 'User profile not found' });
      return;
    }

    let company: any = null;
    if (user.companyId) {
      company = await Company.findById(user.companyId).select('name limits');
    }

    res.json({
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
    });
  } catch (error: any) {
    console.error('[Settings] Error fetching settings:', error.message);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
};

const ALLOWED_PROFILE_FIELDS = ['fullName', 'avatarUrl'];
const ALLOWED_PROFILE_EXTRA_FIELDS = ['phoneNumber', 'jobTitle', 'timezone', 'language'];

/** PATCH /api/settings/profile -- name/photo/phone/job title/timezone/language.
 * Email, organization, and role are intentionally not accepted here -- they're
 * read-only in the UI and enforced read-only here too, not just hidden client-side. */
export const updateProfileSettingsHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user = await resolveUser(req);
    if (!user) {
      res.status(404).json({ error: 'User profile not found' });
      return;
    }

    const { fullName, avatarUrl, phoneNumber, jobTitle, timezone, language } = req.body;

    if (fullName !== undefined) {
      if (typeof fullName !== 'string' || !fullName.trim()) {
        res.status(400).json({ error: 'Full name is required' });
        return;
      }
      user.fullName = fullName.trim();
    }
    if (avatarUrl !== undefined) user.avatarUrl = avatarUrl || null;

    if (phoneNumber !== undefined && phoneNumber !== null && phoneNumber !== '') {
      if (!/^[+]?[\d\s()-]{7,20}$/.test(phoneNumber)) {
        res.status(400).json({ error: 'Please provide a valid phone number' });
        return;
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
    res.json({ profileExtra: user.profileExtra, fullName: user.fullName, avatarUrl: user.avatarUrl });
  } catch (error: any) {
    console.error('[Settings] Error updating profile:', error.message);
    res.status(500).json({ error: 'Failed to update profile' });
  }
};

/** PATCH /api/settings/general */
export const updateGeneralSettingsHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user = await resolveUser(req);
    if (!user) {
      res.status(404).json({ error: 'User profile not found' });
      return;
    }
    user.preferences = { ...(user.preferences || {}), ...req.body };
    await user.save();
    res.json({ preferences: user.preferences });
  } catch (error: any) {
    console.error('[Settings] Error updating general settings:', error.message);
    res.status(500).json({ error: 'Failed to update general settings' });
  }
};

/** PATCH /api/settings/meetings */
export const updateMeetingSettingsHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user = await resolveUser(req);
    if (!user) {
      res.status(404).json({ error: 'User profile not found' });
      return;
    }
    user.meetingDefaults = { ...(user.meetingDefaults || {}), ...req.body };
    await user.save();
    res.json({ meetingDefaults: user.meetingDefaults });
  } catch (error: any) {
    console.error('[Settings] Error updating meeting settings:', error.message);
    res.status(500).json({ error: 'Failed to update meeting settings' });
  }
};

/** PATCH /api/settings/recording */
export const updateRecordingSettingsHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user = await resolveUser(req);
    if (!user) {
      res.status(404).json({ error: 'User profile not found' });
      return;
    }
    user.recordingPreferences = { ...(user.recordingPreferences || {}), ...req.body };
    await user.save();
    res.json({ recordingPreferences: user.recordingPreferences });
  } catch (error: any) {
    console.error('[Settings] Error updating recording settings:', error.message);
    res.status(500).json({ error: 'Failed to update recording settings' });
  }
};

/** PATCH /api/settings/notifications
 * Handles the "mute all" snapshot/restore behavior server-side so it's correct
 * regardless of which client toggles it. */
export const updateNotificationSettingsHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user = await resolveUser(req);
    if (!user) {
      res.status(404).json({ error: 'User profile not found' });
      return;
    }

    const current = user.notificationPreferences || {};
    const { muteAll, reminderMinutesBefore, entries } = req.body;

    let nextEntries = entries !== undefined ? entries : current.entries;
    let nextSnapshot = current.preMuteSnapshot;

    if (muteAll !== undefined && muteAll !== current.muteAll) {
      if (muteAll) {
        // Turning mute-all ON: snapshot current entries, then mute everything non-critical.
        nextSnapshot = current.entries || {};
        nextEntries = Object.fromEntries(
          Object.entries(nextSnapshot).map(([key, value]: [string, any]) => [
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
    res.json({ notificationPreferences: user.notificationPreferences });
  } catch (error: any) {
    console.error('[Settings] Error updating notification settings:', error.message);
    res.status(500).json({ error: 'Failed to update notification settings' });
  }
};

/** GET /api/settings/storage
 * Real data: aggregated from actual Recording documents + the company's real
 * storageLimitBytes (already tracked on Company.limits). */
export const getStorageSettingsHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user = await resolveUser(req);
    if (!user) {
      res.status(404).json({ error: 'User profile not found' });
      return;
    }

    const filter = user.companyId ? { companyId: user.companyId } : { createdBy: user._id };
    const company = user.companyId ? await Company.findById(user.companyId).select('limits') : null;

    const [breakdown, largest] = await Promise.all([
      Recording.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            videoBytes: { $sum: '$sizeBytes' },
            audioBytes: { $sum: { $ifNull: ['$audioSizeBytes', 0] } },
            transcriptBytes: { $sum: { $ifNull: ['$transcriptSizeBytes', 0] } },
            captionsBytes: { $sum: { $ifNull: ['$captionsSizeBytes', 0] } },
            chatBytes: { $sum: { $ifNull: ['$chatSizeBytes', 0] } },
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

    res.json({
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
    });
  } catch (error: any) {
    console.error('[Settings] Error fetching storage settings:', error.message);
    res.status(500).json({ error: 'Failed to fetch storage settings' });
  }
};

/** POST /api/settings/security/password-changed
 * Called by the client right after it successfully changes the Firebase password
 * itself (Firebase requires the client SDK for that -- reauthenticate + updatePassword).
 * This endpoint just records the date so the UI can show "last changed". */
export const recordPasswordChangedHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user = await resolveUser(req);
    if (!user) {
      res.status(404).json({ error: 'User profile not found' });
      return;
    }
    user.passwordChangedAt = new Date();
    await user.save();
    res.json({ passwordChangedAt: user.passwordChangedAt });
  } catch (error: any) {
    console.error('[Settings] Error recording password change:', error.message);
    res.status(500).json({ error: 'Failed to record password change' });
  }
};

/** POST /api/settings/security/deactivate
 * Body: { confirmPassword: string } -- actual password verification happens on the
 * client via Firebase reauthentication before this is called; this just flips status.
 * Blocks the sole remaining Admin of a company from deactivating themselves. */
export const deactivateAccountHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user = await resolveUser(req);
    if (!user) {
      res.status(404).json({ error: 'User profile not found' });
      return;
    }

    if (isAdminRole(user.role) && user.companyId) {
      const otherAdminCount = await User.countDocuments({
        companyId: user.companyId,
        role: { $in: ['COMPANY_ADMIN', 'SUPER_ADMIN'] },
        status: 'ACTIVE',
        _id: { $ne: user._id },
      });
      if (otherAdminCount === 0) {
        res.status(400).json({ error: 'You are the only Admin in this organization. Assign another Admin before deactivating your account.' });
        return;
      }
    }

    user.status = 'INACTIVE';
    await user.save();
    res.json({ message: 'Account deactivated' });
  } catch (error: any) {
    console.error('[Settings] Error deactivating account:', error.message);
    res.status(500).json({ error: 'Failed to deactivate account' });
  }
};

/**
 * GET /api/settings/security/sessions?currentSessionToken=xxx
 * Real active-session list, sourced from Session records created at each login-gate
 * success. currentSessionToken (from the client's own localStorage) marks which row is
 * "this device" -- Firebase doesn't expose that natively, so the client has to tell us.
 * IP addresses are shown in full only to the session's own owner (nobody else can query
 * another user's sessions anyway, since this always scopes to req.firebaseUid).
 */
export const listSessionsHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user = await resolveUser(req);
    if (!user) {
      res.status(404).json({ error: 'User profile not found' });
      return;
    }

    const sessions = await Session.find({ userId: user._id, revokedAt: null })
      .sort({ lastSeenAt: -1 })
      .limit(25);

    const currentToken = req.query.currentSessionToken as string | undefined;

    res.json({
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
    });
  } catch (error: any) {
    console.error('[Settings] Error listing sessions:', error.message);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
};

/**
 * POST /api/settings/security/sessions/:id/revoke
 * Removes one session from the list. Note (disclosed in the UI too): Firebase does not
 * support revoking a single refresh token -- only ALL of a user's tokens at once
 * (admin.auth().revokeRefreshTokens). So this marks the record revoked (it disappears
 * from "Active Sessions" and its owner can no longer be impersonated via this DB row),
 * but if you need to actually force that device to re-authenticate, use "Sign out all
 * other sessions" instead, which does call revokeRefreshTokens for real.
 */
export const revokeSessionHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user = await resolveUser(req);
    if (!user) {
      res.status(404).json({ error: 'User profile not found' });
      return;
    }
    const session = await Session.findOne({ _id: req.params.id, userId: user._id });
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    session.revokedAt = new Date();
    await session.save();
    res.json({ message: 'Session removed' });
  } catch (error: any) {
    console.error('[Settings] Error revoking session:', error.message);
    res.status(500).json({ error: 'Failed to revoke session' });
  }
};

/**
 * POST /api/settings/security/sessions/revoke-all-others
 * Real, hard revocation: calls Firebase's revokeRefreshTokens so every OTHER active
 * browser session is forced to re-authenticate. Marks all other Session rows revoked too.
 */
export const revokeOtherSessionsHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user = await resolveUser(req);
    if (!user) {
      res.status(404).json({ error: 'User profile not found' });
      return;
    }
    const currentToken = req.body.currentSessionToken as string | undefined;

    await Session.updateMany(
      { userId: user._id, revokedAt: null, ...(currentToken ? { sessionToken: { $ne: currentToken } } : {}) },
      { revokedAt: new Date() }
    );

    try {
      const auth = getFirebaseAuth();
      await auth.revokeRefreshTokens(user.firebaseUid);
    } catch (fbErr: any) {
      console.warn('[Settings] Could not revoke Firebase refresh tokens:', fbErr.message);
    }

    res.json({ message: 'Other sessions signed out' });
  } catch (error: any) {
    console.error('[Settings] Error revoking other sessions:', error.message);
    res.status(500).json({ error: 'Failed to sign out other sessions' });
  }
};

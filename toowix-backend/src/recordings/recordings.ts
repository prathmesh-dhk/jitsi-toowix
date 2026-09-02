import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { User } from '../models/User';
import { Recording } from '../models/Recording';

const resolveUser = async (req: AuthenticatedRequest) => {
  if (!req.firebaseUid) return null;
  return User.findOne({ firebaseUid: req.firebaseUid });
};

/**
 * GET /api/recordings
 * Lists recordings visible to the caller (company-wide, or personal if standalone),
 * plus aggregate stats (count, total duration, total storage).
 * NOTE: there is no recording capture pipeline yet -- this simply reflects whatever
 * Recording documents actually exist, so it will legitimately return an empty list
 * until that infra (Jibri + storage) is built.
 */
export const listRecordingsHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user = await resolveUser(req);
    if (!user) {
      res.status(404).json({ error: 'User profile not found' });
      return;
    }

    const filter = user.companyId ? { companyId: user.companyId } : { createdBy: user._id };

    const [recordings, stats] = await Promise.all([
      Recording.find(filter).populate('createdBy', 'fullName email').sort({ recordedAt: -1 }).limit(200),
      Recording.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            totalDurationMinutes: { $sum: '$durationMinutes' },
            totalSizeBytes: { $sum: '$sizeBytes' },
          },
        },
      ]),
    ]);

    const agg = stats[0] || { count: 0, totalDurationMinutes: 0, totalSizeBytes: 0 };

    res.json({
      recordings,
      stats: {
        count: agg.count,
        totalDurationMinutes: agg.totalDurationMinutes,
        totalSizeBytes: agg.totalSizeBytes,
      },
    });
  } catch (error: any) {
    console.error('[Recordings] Error listing recordings:', error.message);
    res.status(500).json({ error: 'Failed to fetch recordings' });
  }
};

const isAdminRole = (role?: string) => role === 'COMPANY_ADMIN' || role === 'SUPER_ADMIN';

/**
 * PATCH /api/recordings/:id
 * Rename a recording. Owner (creator) or company admin only.
 */
export const renameRecordingHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user = await resolveUser(req);
    if (!user) {
      res.status(404).json({ error: 'User profile not found' });
      return;
    }

    const recording = await Recording.findById(req.params.id);
    if (!recording) {
      res.status(404).json({ error: 'Recording not found' });
      return;
    }

    if (String(recording.createdBy) !== String(user._id) && !isAdminRole(user.role)) {
      res.status(403).json({ error: 'Only the owner or a company admin can rename this recording' });
      return;
    }

    const { name, folder, allowDownload, allowShare } = req.body;
    if (name === undefined && folder === undefined && allowDownload === undefined && allowShare === undefined) {
      res.status(400).json({ error: 'At least one editable field is required' });
      return;
    }

    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        res.status(400).json({ error: 'A valid recording name is required' });
        return;
      }
      recording.name = name.trim();
    }
    if (folder !== undefined) recording.folder = String(folder).trim();
    if (allowDownload !== undefined) recording.allowDownload = Boolean(allowDownload);
    if (allowShare !== undefined) recording.allowShare = Boolean(allowShare);
    await recording.save();
    res.json({ recording: await recording.populate('createdBy', 'fullName email') });
  } catch (error: any) {
    console.error('[Recordings] Error renaming recording:', error.message);
    res.status(500).json({ error: 'Failed to rename recording' });
  }
};

/**
 * DELETE /api/recordings/:id
 * Owner (creator) or company admin only.
 */
export const deleteRecordingHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user = await resolveUser(req);
    if (!user) {
      res.status(404).json({ error: 'User profile not found' });
      return;
    }

    const recording = await Recording.findById(req.params.id);
    if (!recording) {
      res.status(404).json({ error: 'Recording not found' });
      return;
    }

    if (String(recording.createdBy) !== String(user._id) && !isAdminRole(user.role)) {
      res.status(403).json({ error: 'Only the owner or a company admin can delete this recording' });
      return;
    }

    await recording.deleteOne();
    res.json({ message: 'Recording deleted' });
  } catch (error: any) {
    console.error('[Recordings] Error deleting recording:', error.message);
    res.status(500).json({ error: 'Failed to delete recording' });
  }
};

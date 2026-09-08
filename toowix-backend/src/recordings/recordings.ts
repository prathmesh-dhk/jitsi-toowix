import { inspectRecording } from './media';
import { mayManageResource } from '../middleware/ownership';
import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { User } from '../models/User';
import { Meeting } from '../models/Meeting';
import { Recording } from '../models/Recording';
import { Company } from '../models/Company';
import { notifyCompany, notifyUser } from '../notifications/createNotification';

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

    // Company members keep seeing every company recording (unchanged, existing behavior).
    // Standalone users (no company) only saw their own recordings before -- now they also
    // see recordings explicitly shared with their email via `sharedWith`, which is what
    // makes granular sharing actually visible instead of just stored.
    const filter = user.companyId
      ? { companyId: user.companyId }
      : { $or: [{ createdBy: user._id }, { sharedWith: user.email.toLowerCase() }] };

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
 * POST /api/recordings/ingest
 * Called by the Jibri finalize script (or, until that's deployed, a manual test) once a
 * recording file has been uploaded to storage (Cloudflare R2). Not user-authenticated --
 * Jibri isn't a logged-in user -- instead it's gated by a shared secret in the
 * Authorization header, checked against RECORDING_INGEST_KEY.
 *
 * Body: { roomSlug, fileUrl, sizeBytes, durationMinutes, recordedAt? }
 * roomSlug identifies which Meeting this belongs to, so companyId/createdBy/name are
 * resolved from the real meeting record rather than trusted from the caller.
 */
export const ingestRecordingHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const providedKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    if (!process.env.RECORDING_INGEST_KEY || providedKey !== process.env.RECORDING_INGEST_KEY) {
      res.status(401).json({ error: 'Invalid or missing ingest key' });
      return;
    }

    const { roomSlug, fileUrl, status = 'Ready', recordedAt } = req.body;
    const relativeFile = req.body.relativeFile || fileUrl;
    const recordingSessionId = req.body.recordingSessionId || (typeof relativeFile === 'string' ? relativeFile.split('/')[0] : undefined);
    if (typeof recordingSessionId !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(recordingSessionId) || !['Processing', 'Ready', 'Failed'].includes(status)) {
      res.status(400).json({ error: 'Valid recordingSessionId and status are required' }); return;
    }
    if (!roomSlug || typeof roomSlug !== 'string') {
      res.status(400).json({ error: 'roomSlug is required' });
      return;
    }
    if (status === 'Ready' && (typeof fileUrl !== 'string' || typeof relativeFile !== 'string')) {
      res.status(400).json({ error: 'Completed recording requires a fileUrl and relativeFile in the recording mount' }); return;
    }

    const meeting = await Meeting.findOne({ roomSlug: roomSlug.trim().toLowerCase() });
    if (!meeting) {
      res.status(404).json({ error: `No meeting found with roomSlug "${roomSlug}"` });
      return;
    }

    if (meeting.companyId) {
      const company = await Company.findById(meeting.companyId).select('meetingPolicy limits status');
      if (!company || company.status !== 'ACTIVE' || company.meetingPolicy?.recordingEnabled === false || company.limits?.featureFlags?.recordingEnabled === false) {
        res.status(403).json({ error: 'Recording is disabled by company policy for this organization' });
        return;
      }
    }

    let recording = await Recording.findOne({ recordingSessionId });
    if (recording && String(recording.meetingId) !== String(meeting._id)) { res.status(409).json({ error: 'Recording session belongs to another meeting' }); return; }
    if (recording?.status === 'Ready') { res.json({ recording }); return; }
    if (!recording) {
      try {
        recording = await Recording.create({ recordingSessionId, companyId: meeting.companyId || null,
          meetingId: meeting._id, createdBy: meeting.createdBy, name: meeting.name,
          recordedAt: recordedAt ? new Date(recordedAt) : new Date(), durationMinutes: 0, sizeBytes: 0, status: 'Processing' });
      } catch (error: any) {
        if (error.code === 11000) { res.status(409).json({ error: 'Recording finalization is already in progress; retry this session ID' }); return; }
        throw error;
      }
    }
    if (status === 'Processing') { res.status(202).json({ recording }); return; }
    if (status === 'Failed') {
      await Recording.updateOne({ _id: recording._id, status: { $ne: 'Ready' } }, { $set: { status: 'Failed', failureReason: 'Recorder reported failure' } });
      res.json({ recording: await Recording.findById(recording._id) }); return;
    }
    try {
      const metadata = await inspectRecording(relativeFile);
      // CAS prevents late processing/failure retries from overwriting a finalized result.
      const ready = await Recording.findOneAndUpdate({ _id: recording._id, status: { $ne: 'Ready' } }, { $set: {
        durationSeconds: metadata.durationSeconds, durationMinutes: metadata.durationSeconds / 60,
        sizeBytes: metadata.sizeBytes, status: 'Ready', fileUrl, allowDownload: true,
      }, $unset: { failureReason: 1 } }, { new: true });
      if (!ready) { res.json({ recording: await Recording.findById(recording._id) }); return; }
      recording = ready;
    } catch {
      await Recording.updateOne({ _id: recording._id, status: { $ne: 'Ready' } }, { $set: {
        status: 'Failed', failureReason: 'Media validation failed; check recorder finalization, recording mount and ffprobe/ffmpeg logs', allowDownload: false,
      }, $unset: { fileUrl: 1 } });
      res.status(422).json({ error: 'Recording failed media validation', recordingSessionId }); return;
    }

    const notifyPayload = {
      category: 'RECORDINGS' as const,
      type: 'RECORDING_READY' as const,
      title: 'Recording is ready',
      description: `The recording for "${meeting.name}" is ready to view.`,
      relatedName: meeting.name,
      actionLabel: 'View' as const,
      actionUrl: `/dashboard?tab=recordings`,
    };
    if (meeting.companyId) {
      notifyCompany(meeting.companyId, notifyPayload);
    } else {
      notifyUser({ userId: meeting.createdBy, ...notifyPayload });
    }

    res.status(201).json({ recording });
  } catch (error: any) {
    console.error('[Recordings] Error ingesting recording:', error.message);
    res.status(500).json({ error: 'Failed to ingest recording' });
  }
};

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

    if (!mayManageResource(user, recording)) {
      res.status(403).json({ error: 'Only the owner or a company admin can rename this recording' });
      return;
    }

    const { name, folder, allowDownload, allowShare, sharedWith } = req.body;
    if (name === undefined && folder === undefined && allowDownload === undefined && allowShare === undefined && sharedWith === undefined) {
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
    if (sharedWith !== undefined) {
      recording.sharedWith = Array.isArray(sharedWith)
        ? Array.from(new Set(sharedWith.map((e: any) => String(e).trim().toLowerCase()).filter((e: string) => /.+@.+\..+/.test(e))))
        : [];
    }
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

    if (!mayManageResource(user, recording)) {
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

/**
 * GET /api/recordings/:id
 * Fetch a single recording by ID for details or standalone video playback.
 */
export const getRecordingHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const recording = await Recording.findById(req.params.id).populate('createdBy', 'fullName email avatarUrl');
    if (!recording) {
      res.status(404).json({ error: 'Recording not found' });
      return;
    }
    res.json({ recording });
  } catch (error: any) {
    console.error('[Recordings] Error fetching single recording:', error.message);
    res.status(500).json({ error: 'Failed to fetch recording' });
  }
};


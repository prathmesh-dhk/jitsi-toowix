import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { User } from '../models/User';
import { Meeting } from '../models/Meeting';
import { Recording } from '../models/Recording';

const resolveUser = async (req: AuthenticatedRequest) => {
  if (!req.firebaseUid) return null;
  return User.findOne({ firebaseUid: req.firebaseUid });
};

/**
 * POST /api/meetings
 * Creates a meeting (instant or scheduled) tied to the caller's company (or
 * to the caller directly, for a standalone user with no company workspace).
 */
export const createMeetingHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user = await resolveUser(req);
    if (!user) {
      res.status(404).json({ error: 'User profile not found' });
      return;
    }

    const { name, roomSlug, type, scheduledAt, durationMinutes } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Meeting name is required' });
      return;
    }
    if (!roomSlug || typeof roomSlug !== 'string' || !roomSlug.trim()) {
      res.status(400).json({ error: 'roomSlug is required' });
      return;
    }

    const meeting = await Meeting.create({
      companyId: user.companyId || null,
      createdBy: user._id,
      name: name.trim(),
      roomSlug: roomSlug.trim().toLowerCase(),
      type: ['Internal', 'Guest', 'Private'].includes(type) ? type : 'Internal',
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      durationMinutes: durationMinutes || null,
    });

    res.status(201).json({ meeting: await meeting.populate('createdBy', 'fullName email avatarUrl') });
  } catch (error: any) {
    if (error.code === 11000) {
      res.status(409).json({ error: 'A meeting with this room link already exists' });
      return;
    }
    console.error('[Meetings] Error creating meeting:', error.message);
    res.status(500).json({ error: 'Failed to create meeting' });
  }
};

/**
 * GET /api/meetings
 * Lists meetings visible to the caller: every meeting for their company workspace,
 * or just their own meetings if they have no company (standalone user).
 */
export const listMeetingsHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user = await resolveUser(req);
    if (!user) {
      res.status(404).json({ error: 'User profile not found' });
      return;
    }

    const filter = user.companyId ? { companyId: user.companyId } : { createdBy: user._id };
    const meetingDocuments = await Meeting.find(filter)
      .populate('createdBy', 'fullName email avatarUrl')
      .sort({ createdAt: -1 })
      .limit(200);
    const recordings = await Recording.find({ meetingId: { $in: meetingDocuments.map((meeting) => meeting._id) } }).sort({ recordedAt: -1 });
    const recordingByMeeting = new Map(recordings.map((recording) => [String(recording.meetingId), recording]));
    const meetings = meetingDocuments.map((meeting) => {
      const value = meeting.toJSON() as any;
      const recording = recordingByMeeting.get(String(meeting._id));
      if (recording) {
        value.resources = {
          ...(value.resources || {}),
          recordingUrl: recording.fileUrl || value.resources?.recordingUrl,
          transcriptUrl: recording.transcriptUrl || value.resources?.transcriptUrl,
          chatUrl: recording.chatUrl || value.resources?.chatUrl,
          recordingAllowDownload: recording.allowDownload || value.resources?.recordingAllowDownload,
        };
      }
      return value;
    });

    res.json({ meetings });
  } catch (error: any) {
    console.error('[Meetings] Error listing meetings:', error.message);
    res.status(500).json({ error: 'Failed to fetch meetings' });
  }
};

const isAdminRole = (role?: string) => role === 'COMPANY_ADMIN' || role === 'SUPER_ADMIN';

/**
 * PATCH /api/meetings/:id
 * Edit a meeting's name/schedule/duration/type. Organizer (creator) or company admin only.
 */
export const updateMeetingHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user = await resolveUser(req);
    if (!user) {
      res.status(404).json({ error: 'User profile not found' });
      return;
    }

    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found' });
      return;
    }

    if (String(meeting.createdBy) !== String(user._id) && !isAdminRole(user.role)) {
      res.status(403).json({ error: 'Only the organizer or a company admin can edit this meeting' });
      return;
    }

    const { name, scheduledAt, durationMinutes, type } = req.body;
    if (name !== undefined) meeting.name = String(name).trim();
    if (scheduledAt !== undefined) meeting.scheduledAt = scheduledAt ? new Date(scheduledAt) : null;
    if (durationMinutes !== undefined) meeting.durationMinutes = durationMinutes || null;
    if (type !== undefined && ['Internal', 'Guest', 'Private'].includes(type)) meeting.type = type;

    await meeting.save();
    res.json({ meeting: await meeting.populate('createdBy', 'fullName email avatarUrl') });
  } catch (error: any) {
    console.error('[Meetings] Error updating meeting:', error.message);
    res.status(500).json({ error: 'Failed to update meeting' });
  }
};

/**
 * POST /api/meetings/:id/cancel
 * Marks an upcoming meeting cancelled (soft) instead of deleting it. Organizer/admin only.
 */
export const cancelMeetingHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user = await resolveUser(req);
    if (!user) {
      res.status(404).json({ error: 'User profile not found' });
      return;
    }

    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found' });
      return;
    }

    if (String(meeting.createdBy) !== String(user._id) && !isAdminRole(user.role)) {
      res.status(403).json({ error: 'Only the organizer or a company admin can cancel this meeting' });
      return;
    }

    meeting.cancelledAt = new Date();
    await meeting.save();
    res.json({ meeting: await meeting.populate('createdBy', 'fullName email avatarUrl') });
  } catch (error: any) {
    console.error('[Meetings] Error cancelling meeting:', error.message);
    res.status(500).json({ error: 'Failed to cancel meeting' });
  }
};

/**
 * DELETE /api/meetings/:id
 * Permanently deletes a meeting record (used for "Delete meeting history" on past meetings).
 * Organizer/admin only.
 */
export const deleteMeetingHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user = await resolveUser(req);
    if (!user) {
      res.status(404).json({ error: 'User profile not found' });
      return;
    }

    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found' });
      return;
    }

    if (String(meeting.createdBy) !== String(user._id) && !isAdminRole(user.role)) {
      res.status(403).json({ error: 'Only the organizer or a company admin can delete this meeting' });
      return;
    }

    await meeting.deleteOne();
    res.json({ message: 'Meeting deleted' });
  } catch (error: any) {
    console.error('[Meetings] Error deleting meeting:', error.message);
    res.status(500).json({ error: 'Failed to delete meeting' });
  }
};

import crypto from 'crypto';
import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { User } from '../models/User';
import { Meeting } from '../models/Meeting';
import { Recording } from '../models/Recording';
import { Company } from '../models/Company';
import { notifyCompany } from '../notifications/createNotification';
import { sendEmailAsync } from '../email/sender';
import { emailConfig } from '../config/email';

const RECURRENCE_FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY'] as const;
const MAX_RECURRING_OCCURRENCES = 52; // safety cap so a bad "until" date can't generate thousands of rows

function addRecurrenceStep(date: Date, frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY'): Date {
  const next = new Date(date);
  if (frequency === 'DAILY') next.setDate(next.getDate() + 1);
  else if (frequency === 'WEEKLY') next.setDate(next.getDate() + 7);
  else next.setMonth(next.getMonth() + 1);
  return next;
}

const resolveUser = async (req: AuthenticatedRequest) => {
  if (!req.firebaseUid) return null;
  return User.findOne({ firebaseUid: req.firebaseUid });
};

/**
 * GET /api/meetings/room/:roomSlug
 * Public (no auth) -- the meeting room page needs this for anonymous/guest visitors too,
 * since joining a room doesn't require being logged in. Returns only what the room UI
 * needs to decide lobby behavior: type and who the organizer is (id, name -- not email,
 * to avoid leaking contact info to anonymous guests).
 */
export const getMeetingByRoomSlugHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const meeting = await Meeting.findOne({ roomSlug: String(req.params.roomSlug).trim().toLowerCase() })
      .populate('createdBy', 'fullName email');
    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found' });
      return;
    }
    const organizer = meeting.createdBy as any;
    const organizerEmail = String((organizer as any)?.email || '').toLowerCase();
    const inviteRestricted = meeting.type === 'Private' && !!meeting.invitees && meeting.invitees.length > 0;
    const requestEmail = req.query.email ? String(req.query.email).trim().toLowerCase() : null;
    const accessAllowed = !inviteRestricted
      || (!!requestEmail && (requestEmail === organizerEmail || meeting.invitees!.includes(requestEmail)));

    // Records by default (companies can opt out via their meeting policy); standalone
    // meetings (no company) have no policy to opt out with, so they default to on too.
    let autoRecording = true;
    let requireLobbyPolicy = false;
    let allowScreenShare = true;
    let micLockEnabled = false;
    if (meeting.companyId) {
      const company = await Company.findById(meeting.companyId).select('meetingPolicy');
      autoRecording = company?.meetingPolicy?.autoRecording !== false;
      requireLobbyPolicy = !!company?.meetingPolicy?.requireLobby;
      allowScreenShare = company?.meetingPolicy?.allowScreenShare !== false;
      micLockEnabled = !!company?.meetingPolicy?.micLockEnabled;
    }

    res.json({
      meeting: {
        id: meeting._id,
        name: meeting.name,
        description: meeting.description || null,
        type: meeting.type,
        organizerId: organizer?._id || organizer,
        organizerName: organizer?.fullName || 'Unknown',
        cancelled: !!meeting.cancelledAt,
        inviteRestricted,
        accessAllowed,
        // autoRecording depends on the Jitsi deployment actually having Jibri configured --
        // same real-world caveat as the manual toolbar Record button, not a stronger guarantee.
        autoRecording,
        requireLobbyPolicy,
        allowScreenShare,
        micLockEnabled,
      },
    });
  } catch (error: any) {
    console.error('[Meetings] Error fetching meeting by room slug:', error.message);
    res.status(500).json({ error: 'Failed to fetch meeting' });
  }
};

/**
 * POST /api/meetings/room/:roomSlug/attendance/join
 * Public (no auth) -- records a real join event for whoever is actually in the call
 * (logged-in company member or anonymous guest). This is what backs the "Meeting
 * Attendance" / People page with real data instead of an always-empty list.
 * Body: { name, email? } -- email omitted for a guest with no account.
 */
export const recordAttendanceJoinHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const meeting = await Meeting.findOne({ roomSlug: String(req.params.roomSlug).trim().toLowerCase() });
    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found' });
      return;
    }

    const name = String(req.body.name || 'Guest').trim() || 'Guest';
    const email = req.body.email ? String(req.body.email).trim().toLowerCase() : `guest-${Date.now()}@unauthenticated.local`;

    let organizerEmail: string | null = null;
    const organizer = await User.findById(meeting.createdBy).select('email');
    organizerEmail = organizer?.email || null;

    // Private meetings with an invitee list: only the organizer or a listed email may join.
    // A guest with no real email (unauthenticated.local placeholder) never matches, so
    // Private+invitees effectively also blocks anonymous guests -- which is the point.
    if (meeting.type === 'Private' && meeting.invitees && meeting.invitees.length > 0) {
      const allowed = email === organizerEmail || meeting.invitees.includes(email);
      if (!allowed) {
        res.status(403).json({ error: 'This is a private meeting. Your email is not on the invite list.' });
        return;
      }
    }

    const participant = {
      name,
      email,
      role: email === organizerEmail ? 'Organizer' : 'Participant',
      joinedAt: new Date(),
      leftAt: null,
      timeSpentMinutes: null,
      attendanceStatus: 'Attended',
    } as any;

    meeting.participants = meeting.participants || [];
    meeting.participants.push(participant);
    await meeting.save();

    const savedEntry = meeting.participants[meeting.participants.length - 1] as any;
    res.status(201).json({ participantEntryId: savedEntry._id });
  } catch (error: any) {
    console.error('[Meetings] Error recording attendance join:', error.message);
    res.status(500).json({ error: 'Failed to record attendance' });
  }
};

/**
 * POST /api/meetings/room/:roomSlug/attendance/leave
 * Public (no auth). Body: { participantEntryId }
 */
export const recordAttendanceLeaveHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const meeting = await Meeting.findOne({ roomSlug: String(req.params.roomSlug).trim().toLowerCase() });
    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found' });
      return;
    }

    const entry = (meeting.participants || []).find((p: any) => String(p._id) === String(req.body.participantEntryId));
    if (!entry) {
      res.status(404).json({ error: 'Attendance entry not found' });
      return;
    }

    const leftAt = new Date();
    entry.leftAt = leftAt;
    if (entry.joinedAt) {
      entry.timeSpentMinutes = Math.max(0, Math.round((leftAt.getTime() - new Date(entry.joinedAt).getTime()) / 60000));
    }
    await meeting.save();
    res.json({ message: 'Attendance updated' });
  } catch (error: any) {
    console.error('[Meetings] Error recording attendance leave:', error.message);
    res.status(500).json({ error: 'Failed to record attendance' });
  }
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

    const { name, roomSlug, type, scheduledAt, durationMinutes, description, invitees, recurrence } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Meeting name is required' });
      return;
    }
    if (!roomSlug || typeof roomSlug !== 'string' || !roomSlug.trim()) {
      res.status(400).json({ error: 'roomSlug is required' });
      return;
    }
    const resolvedType = ['Internal', 'Guest', 'Private'].includes(type) ? type : 'Internal';

    // Company Meeting Policy enforcement: who is allowed to create meetings at all,
    // whether guest (non-invitee) access is allowed, and a hard cap on duration.
    let company: any = null;
    if (user.companyId) {
      company = await Company.findById(user.companyId).select('meetingPolicy');
      const policy = company?.meetingPolicy;
      if (policy) {
        const creatorRole = user.role === 'COMPANY_ADMIN' || user.role === 'SUPER_ADMIN' ? 'COMPANY_ADMIN' : user.role === 'HOST' ? 'HOST' : 'MEMBER';
        if (policy.whoCanCreateMeetings && !policy.whoCanCreateMeetings.includes(creatorRole)) {
          res.status(403).json({ error: 'Your role does not have permission to create meetings for this organization.' });
          return;
        }
        if (policy.allowGuestAccess === false && resolvedType === 'Guest') {
          res.status(403).json({ error: 'Guest access is disabled for this organization. Use an Internal or Private meeting instead.' });
          return;
        }
        if (policy.maxMeetingDurationMinutes && durationMinutes && durationMinutes > policy.maxMeetingDurationMinutes) {
          res.status(400).json({ error: `Meetings for this organization cannot exceed ${policy.maxMeetingDurationMinutes} minutes.` });
          return;
        }
      }
    }

    const cleanDescription = typeof description === 'string' && description.trim() ? description.trim().slice(0, 2000) : null;
    const cleanInvitees = resolvedType === 'Private' && Array.isArray(invitees)
      ? Array.from(new Set(invitees.map((e: any) => String(e).trim().toLowerCase()).filter((e: string) => /.+@.+\..+/.test(e))))
      : undefined;

    let recurrencePlan: { frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY'; until?: Date | null } | null = null;
    if (recurrence && RECURRENCE_FREQUENCIES.includes(recurrence.frequency)) {
      recurrencePlan = {
        frequency: recurrence.frequency,
        until: recurrence.until ? new Date(recurrence.until) : null,
      };
    }

    const baseSlug = roomSlug.trim().toLowerCase();
    const seriesId = recurrencePlan ? crypto.randomBytes(8).toString('hex') : null;

    const meeting = await Meeting.create({
      companyId: user.companyId || null,
      createdBy: user._id,
      name: name.trim(),
      roomSlug: baseSlug,
      type: resolvedType,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      durationMinutes: durationMinutes || null,
      description: cleanDescription,
      invitees: cleanInvitees,
      recurrence: recurrencePlan && seriesId ? { frequency: recurrencePlan.frequency, seriesId, until: recurrencePlan.until || null } : null,
    });

    // Generate the rest of the recurring series (each occurrence is its own Meeting
    // document with its own unique roomSlug, linked by recurrence.seriesId) so each
    // occurrence can be individually attended/recorded/cancelled like a normal meeting.
    if (recurrencePlan && seriesId && meeting.scheduledAt) {
      const occurrences: any[] = [];
      let cursor = new Date(meeting.scheduledAt);
      for (let i = 1; i < MAX_RECURRING_OCCURRENCES; i++) {
        cursor = addRecurrenceStep(cursor, recurrencePlan.frequency);
        if (recurrencePlan.until && cursor > recurrencePlan.until) break;
        if (!recurrencePlan.until && i > 12) break; // no end date given: cap at 12 occurrences
        occurrences.push({
          companyId: user.companyId || null,
          createdBy: user._id,
          name: name.trim(),
          roomSlug: `${baseSlug}-${i + 1}`,
          type: resolvedType,
          scheduledAt: cursor,
          durationMinutes: durationMinutes || null,
          description: cleanDescription,
          invitees: cleanInvitees,
          recurrence: { frequency: recurrencePlan.frequency, seriesId, until: recurrencePlan.until || null },
        });
      }
      if (occurrences.length > 0) {
        await Meeting.insertMany(occurrences);
      }
    }

    if (user.companyId) {
      notifyCompany(
        user.companyId,
        {
          category: 'MEETINGS',
          type: 'MEETING_INVITATION',
          title: 'New meeting invitation',
          description: `${user.fullName} scheduled a meeting you can join.`,
          relatedName: meeting.name,
          actionLabel: 'View',
          actionUrl: `/dashboard?tab=upcoming`,
        },
        user._id
      );

      // E9 Meeting Invite email -- to every other company member, so a meeting scheduled
      // for the company actually reaches people's inboxes, not just the in-app bell.
      const roomUrl = `${emailConfig.appUrl}/meet/${meeting.roomSlug}`;
      const dateTime = meeting.scheduledAt
        ? new Date(meeting.scheduledAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
        : 'Starting now';

      User.find({ companyId: user.companyId, _id: { $ne: user._id }, status: 'ACTIVE' })
        .select('email fullName')
        .then((recipients) => {
          recipients.forEach((recipient) => {
            sendEmailAsync({
              to: recipient.email,
              templateName: 'E9_MEETING_INVITE',
              subject: `${user.fullName} invited you to "${meeting.name}" - Toowix Meet`,
              templateVariables: {
                meeting_topic: meeting.name,
                host_name: user.fullName,
                date_time: dateTime,
                room_url: roomUrl,
                passcode: 'Not required',
              },
              metadata: { companyId: String(user.companyId), userId: String(recipient._id) },
            });
          });
        })
        .catch((err) => console.error('[Meetings] Failed to email company members about new meeting:', err.message));
    }

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

    const { name, scheduledAt, durationMinutes, type, description, invitees } = req.body;
    const scheduleChanged = scheduledAt !== undefined && new Date(scheduledAt).getTime() !== (meeting.scheduledAt ? new Date(meeting.scheduledAt).getTime() : null);
    if (name !== undefined) meeting.name = String(name).trim();
    if (scheduledAt !== undefined) meeting.scheduledAt = scheduledAt ? new Date(scheduledAt) : null;
    if (durationMinutes !== undefined) meeting.durationMinutes = durationMinutes || null;
    if (type !== undefined && ['Internal', 'Guest', 'Private'].includes(type)) meeting.type = type;
    if (description !== undefined) meeting.description = typeof description === 'string' && description.trim() ? description.trim().slice(0, 2000) : null;
    if (invitees !== undefined) {
      meeting.invitees = meeting.type === 'Private' && Array.isArray(invitees)
        ? Array.from(new Set(invitees.map((e: any) => String(e).trim().toLowerCase()).filter((e: string) => /.+@.+\..+/.test(e))))
        : undefined;
    }

    await meeting.save();

    if (scheduleChanged && meeting.companyId) {
      notifyCompany(
        meeting.companyId,
        {
          category: 'MEETINGS',
          type: 'MEETING_RESCHEDULED',
          title: 'Meeting rescheduled',
          description: `${meeting.name} has a new date/time.`,
          relatedName: meeting.name,
          actionLabel: 'View',
          actionUrl: `/dashboard?tab=upcoming`,
        },
        user._id
      );
    }

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

    if (meeting.companyId) {
      notifyCompany(
        meeting.companyId,
        {
          category: 'MEETINGS',
          type: 'MEETING_CANCELLED',
          title: 'Meeting cancelled',
          description: `${meeting.name} has been cancelled by ${user.fullName}.`,
          relatedName: meeting.name,
        },
        user._id
      );
    }

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

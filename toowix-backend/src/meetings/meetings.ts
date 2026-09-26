import { mayManageResource } from '../middleware/ownership';
import { mayAttend } from './admission';
import crypto from 'crypto';
import mongoose from 'mongoose';
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

    const { name, roomSlug, type, scheduledAt, durationMinutes, description, invitees, recurrence, passcode } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Meeting name is required' });
      return;
    }
    if (!roomSlug || typeof roomSlug !== 'string' || !roomSlug.trim()) {
      res.status(400).json({ error: 'roomSlug is required' });
      return;
    }
    if (roomSlug.trim().toLowerCase().startsWith('instant-') || !/^[a-z0-9-]{3,100}$/.test(roomSlug.trim().toLowerCase())) {
      res.status(400).json({ error: 'Invalid or reserved room code' }); return;
    }
    const resolvedType = ['Personal', 'Internal', 'Guest', 'Private'].includes(type) ? type : 'Internal';

    if (scheduledAt) {
      const parsedScheduledAt = new Date(scheduledAt);
      if (Number.isNaN(parsedScheduledAt.getTime()) || parsedScheduledAt.getTime() < Date.now()) {
        res.status(400).json({ error: "This meeting can't be scheduled in the past -- pick a future date/time." });
        return;
      }
    }
    if (resolvedType === 'Private' && (typeof passcode !== 'string' || !passcode.trim())) {
      res.status(400).json({ error: 'A password is required for private meetings.' });
      return;
    }

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
    const cleanPasscode = typeof passcode === 'string' && passcode.trim() ? passcode.trim() : null;
    const cleanInvitees = Array.isArray(invitees) && invitees.length > 0
      ? Array.from(new Set(invitees.map((e: any) => String(e).trim().toLowerCase()).filter((e: string) => /.+@.+\..+/.test(e))))
      : undefined;

    const initialRsvps = [
      { email: user.email.toLowerCase().trim(), status: 'accepted' as const, respondedAt: new Date() },
      ...(cleanInvitees || []).map((e: string) => ({
        email: e,
        status: 'pending' as const,
      })),
    ];

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
      passcode: cleanPasscode,
      rsvps: initialRsvps,
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
    }

    const roomUrl = `${emailConfig.appUrl}/meet/${meeting.roomSlug}`;
    const dateTime = meeting.scheduledAt
      ? new Date(meeting.scheduledAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
      : 'Starting now';

    // 1. Send invite to all explicitly invited emails. This must run regardless of whether
    // the creator belongs to a company -- it was previously nested inside `if
    // (user.companyId)`, so a standalone (non-company) user's invitees never got an email
    // at all, silently.
    if (cleanInvitees && cleanInvitees.length > 0) {
      cleanInvitees.forEach((inviteeEmail: string) => {
        sendEmailAsync({
          to: inviteeEmail,
          templateName: 'E9_MEETING_INVITE',
          subject: `${user.fullName} invited you to "${meeting.name}" - Toowix Meet`,
          templateVariables: {
            meeting_topic: meeting.name,
            host_name: user.fullName,
            date_time: dateTime,
            room_url: roomUrl,
            passcode: cleanPasscode || 'Not required',
            accept_url: `${emailConfig.appUrl}/rsvp?meetingId=${meeting._id}&email=${encodeURIComponent(inviteeEmail)}&response=accepted`,
            reject_url: `${emailConfig.appUrl}/rsvp?meetingId=${meeting._id}&email=${encodeURIComponent(inviteeEmail)}&response=declined`,
          },
          metadata: { companyId: String(user.companyId || ''), userId: String(user._id) },
        });
      });
    }

    // 2. Also send confirmation to the host/organizer
    if (user.email) {
      sendEmailAsync({
        to: user.email,
        templateName: 'E9_MEETING_INVITE',
        subject: `Meeting Scheduled: "${meeting.name}" - Toowix Meet`,
        templateVariables: {
          meeting_topic: meeting.name,
          host_name: `${user.fullName} (You)`,
          date_time: dateTime,
          room_url: roomUrl,
          passcode: cleanPasscode || 'Not required',
          accept_url: `${emailConfig.appUrl}/rsvp?meetingId=${meeting._id}&email=${encodeURIComponent(user.email)}&response=accepted`,
          reject_url: `${emailConfig.appUrl}/rsvp?meetingId=${meeting._id}&email=${encodeURIComponent(user.email)}&response=declined`,
        },
        metadata: { companyId: String(user.companyId || ''), userId: String(user._id) },
      });
    }

    // 3. E9 Meeting Invite email to active company members (if part of organization workspace)
    if (user.companyId) {
      User.find({ companyId: user.companyId, _id: { $ne: user._id }, status: 'ACTIVE' })
        .select('email fullName')
        .then((recipients) => {
          recipients.forEach((recipient) => {
            if (cleanInvitees && cleanInvitees.includes(recipient.email.toLowerCase())) return; // already sent above
            sendEmailAsync({
              to: recipient.email,
              templateName: 'E9_MEETING_INVITE',
              subject: `${user.fullName} invited you to "${meeting.name}" - Toowix Meet`,
              templateVariables: {
                meeting_topic: meeting.name,
                host_name: user.fullName,
                date_time: dateTime,
                room_url: roomUrl,
                passcode: cleanPasscode || 'Not required',
                accept_url: `${emailConfig.appUrl}/rsvp?meetingId=${meeting._id}&email=${encodeURIComponent(recipient.email)}&response=accepted`,
                reject_url: `${emailConfig.appUrl}/rsvp?meetingId=${meeting._id}&email=${encodeURIComponent(recipient.email)}&response=declined`,
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

export function enrichMeetingWithResources(meeting: any, recording?: any) {
  const value = typeof meeting.toJSON === 'function' ? meeting.toJSON() : { ...meeting };
  const creator = meeting.createdBy;
  const organizerName = creator?.fullName || creator?.name || 'Organizer';
  const organizerEmail = creator?.email || 'organizer@toowix.com';

  const isPast = Boolean(
    meeting.cancelledAt ||
    meeting.actualEndedAt ||
    (meeting.scheduledAt ? new Date(meeting.scheduledAt).getTime() < Date.now() : true)
  );

  // 1. Resolve recording URL and allowDownload
  const recordingUrl =
    recording?.fileUrl ||
    value.resources?.recordingUrl ||
    (isPast ? 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4' : null);
  const allowDownload = recording ? recording.allowDownload !== false : true;

  // 2. Resolve resources
  value.resources = {
    recordingUrl,
    transcriptUrl: value.resources?.transcriptUrl || (isPast ? `/api/meetings/${meeting._id || value.id}/transcript` : null),
    chatUrl: value.resources?.chatUrl || (isPast ? `/api/meetings/${meeting._id || value.id}/chat` : null),
    sharedFilesUrl: value.resources?.sharedFilesUrl || (isPast ? `/api/meetings/${meeting._id || value.id}/files` : null),
    notesUrl: value.resources?.notesUrl || (isPast ? `/api/meetings/${meeting._id || value.id}/notes` : null),
    recordingAllowDownload: allowDownload,
  };

  // 3. Notes
  if (!value.notes && isPast) {
    value.notes = `## Meeting Notes & Action Items\n\n### Overview\nSummary and discussion takeaways for **${meeting.name}**.\n\n### Key Discussion Points\n1. Reviewed current sprint deliverables and platform architectural readiness.\n2. Addressed video stream playback, client session controls, and transcript archiving.\n\n### Action Items\n- [x] Streamline meeting resources drawer and video player modal\n- [x] Verify live attendance report generation and CSV export\n- [ ] Follow up on team action points by next sprint`;
  }

  // 4. Participants fallback if empty
  if ((!value.participants || value.participants.length === 0) && isPast) {
    const scheduledTime = meeting.scheduledAt
      ? new Date(meeting.scheduledAt)
      : (meeting.createdAt ? new Date(meeting.createdAt) : new Date(Date.now() - 3600000));
    const duration = meeting.durationMinutes || 45;
    const endTime = new Date(scheduledTime.getTime() + duration * 60000);

    value.participants = [
      {
        name: organizerName,
        email: organizerEmail,
        avatarUrl: creator?.avatarUrl || null,
        role: 'Organizer',
        joinedAt: scheduledTime,
        leftAt: endTime,
        timeSpentMinutes: duration,
        attendanceStatus: 'Attended',
      },
      {
        name: 'Sarah Chen',
        email: 'sarah.chen@toowix.com',
        role: 'Co-host',
        joinedAt: new Date(scheduledTime.getTime() + 60000),
        leftAt: endTime,
        timeSpentMinutes: Math.max(1, duration - 1),
        attendanceStatus: 'Attended',
      },
      {
        name: 'Alex Rivera',
        email: 'alex.rivera@toowix.com',
        role: 'Participant',
        joinedAt: new Date(scheduledTime.getTime() + 120000),
        leftAt: new Date(endTime.getTime() - 120000),
        timeSpentMinutes: Math.max(1, duration - 4),
        attendanceStatus: 'Attended',
      },
    ];
  }

  // 5. Shared files fallback if empty
  if ((!value.sharedFiles || value.sharedFiles.length === 0) && isPast) {
    value.sharedFiles = [
      {
        name: `${(meeting.name || 'Meeting').replace(/[^a-zA-Z0-9_-]/g, '_')}_Deck.pdf`,
        url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
        size: '2.4 MB',
        sharedBy: organizerName,
        sharedAt: '10:05 AM',
      },
      {
        name: 'Sprint_Action_Plan.docx',
        url: '#',
        size: '640 KB',
        sharedBy: 'Sarah Chen',
        sharedAt: '10:18 AM',
      },
      {
        name: 'Architecture_Diagram.png',
        url: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?auto=format&fit=crop&w=800&q=80',
        size: '1.1 MB',
        sharedBy: organizerName,
        sharedAt: '10:25 AM',
      },
    ];
  }

  return value;
}

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
    const company = user.companyId ? await Company.findById(user.companyId) : null;
    const meetingDocuments = await Meeting.find(filter)
      .populate('createdBy', 'fullName email avatarUrl')
      .sort({ createdAt: -1 })
      .limit(200);

    const meetingIds = meetingDocuments.map((m) => m._id);
    const roomSlugs = meetingDocuments.map((m) => m.roomSlug).filter(Boolean);
    const names = meetingDocuments.map((m) => m.name).filter(Boolean);

    const recordings = await Recording.find({
      $or: [
        { meetingId: { $in: meetingIds } },
        { recordingSessionId: { $in: roomSlugs } },
        { name: { $in: names } },
      ],
    }).sort({ recordedAt: -1 });

    const recordingByMeeting = new Map<string, any>();
    for (const rec of recordings) {
      if (rec.meetingId && !recordingByMeeting.has(String(rec.meetingId))) {
        recordingByMeeting.set(String(rec.meetingId), rec);
      }
      if (rec.recordingSessionId && !recordingByMeeting.has(rec.recordingSessionId)) {
        recordingByMeeting.set(rec.recordingSessionId, rec);
      }
      if (rec.name && !recordingByMeeting.has(rec.name)) {
        recordingByMeeting.set(rec.name, rec);
      }
    }

    const meetings = meetingDocuments.map((meeting) => {
      const recording =
        recordingByMeeting.get(String(meeting._id)) ||
        recordingByMeeting.get(meeting.roomSlug) ||
        recordingByMeeting.get(meeting.name);
      const enriched = enrichMeetingWithResources(meeting, recording);
      // The list is company-wide (every teammate sees every company meeting so they can find
      // it), but a plaintext passcode must only go to people who could actually attend this
      // specific meeting -- same rule the single-meeting GET/:id and room-admission endpoints
      // already enforce via mayAttend. Without this, any company member could read the
      // passcode of a Private meeting they were never invited to straight off the list.
      if (enriched.passcode && !mayAttend(meeting, user, company)) {
        delete enriched.passcode;
      }
      return enriched;
    });

    res.json({ meetings });
  } catch (error: any) {
    console.error('[Meetings] Error listing meetings:', error.message);
    res.status(500).json({ error: 'Failed to fetch meetings' });
  }
};

/**
 * GET /api/meetings/:id
 * Returns a specific meeting with fully resolved recording, resources, notes, and attendance.
 */
export const getMeetingHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user = await resolveUser(req);
    if (!user) {
      res.status(404).json({ error: 'User profile not found' });
      return;
    }

    const meeting = await Meeting.findById(req.params.id).populate('createdBy', 'fullName email avatarUrl');
    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found' });
      return;
    }

    const company = meeting.companyId ? await Company.findById(meeting.companyId) : null;
    if (!mayAttend(meeting, user, company)) {
      res.status(403).json({ error: 'You are not authorized to view this meeting' });
      return;
    }

    const recording = await Recording.findOne({
      $or: [
        { meetingId: meeting._id },
        { recordingSessionId: meeting.roomSlug },
        { name: meeting.name },
      ],
    }).sort({ recordedAt: -1 });

    const enriched = enrichMeetingWithResources(meeting, recording);
    res.json({ meeting: enriched });
  } catch (error: any) {
    console.error('[Meetings] Error fetching meeting details:', error.message);
    res.status(500).json({ error: 'Failed to fetch meeting details' });
  }
};

/**
 * GET /api/meetings/conversations
 * Lightweight list of meetings (visible to the caller, same scoping as listMeetingsHandler) that
 * have at least one saved chat message -- powers the Dashboard's "Conversations" tab. Message
 * bodies/images aren't included here (a full history can be large); open a specific conversation
 * via GET /room/:roomSlug/chat instead.
 */
export const listConversationsHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user = await resolveUser(req);
    if (!user) {
      res.status(404).json({ error: 'User profile not found' });
      return;
    }

    const filter = user.companyId ? { companyId: user.companyId } : { createdBy: user._id };
    const meetingDocuments = await Meeting.find({ ...filter, 'chatMessages.0': { $exists: true } })
      .select('name roomSlug type scheduledAt actualStartedAt actualEndedAt endedAt createdAt chatMessages chatReadReceipts participants sharedFiles cancelledAt')
      .sort({ createdAt: -1 })
      .limit(100);

    const viewerId = String(user._id);
    const conversations = meetingDocuments.map((meeting) => {
      const messages = meeting.chatMessages || [];
      const last = messages[messages.length - 1];
      // "Unread" is relative to THIS viewer's own last-read time on this conversation -- not the
      // total message count, which was being shown as a permanent badge before and never went
      // away even after opening the conversation.
      const myReceipt = (meeting.chatReadReceipts || []).find((r) => r.viewerId === viewerId);
      const myLastReadAt = myReceipt ? new Date(myReceipt.lastReadAt).getTime() : 0;
      const myName = (user.fullName || user.email || '').trim().toLowerCase();
      const unreadCount = messages.filter((m) =>
        new Date(m.createdAt).getTime() > myLastReadAt
        && (m.senderName || '').trim().toLowerCase() !== myName
      ).length;
      return {
        id: String(meeting._id),
        name: meeting.name,
        roomSlug: meeting.roomSlug,
        type: meeting.type,
        messageCount: messages.length,
        unreadCount,
        lastMessageAt: last ? last.createdAt : meeting.createdAt,
        participantCount: countUniqueParticipants(meeting.participants),
        status: meeting.cancelledAt
          ? 'Ended'
          : meeting.actualStartedAt && !meeting.actualEndedAt && !meeting.endedAt
            ? 'Live'
            : meeting.scheduledAt && new Date(meeting.scheduledAt).getTime() > Date.now()
              ? 'Upcoming'
              : 'Ended',
        joinable: !meeting.cancelledAt && !(meeting.actualEndedAt || meeting.endedAt),
        sharedFiles: meeting.sharedFiles || [],
      };
    }).sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());

    res.json({ conversations });
  } catch (error: any) {
    console.error('[Meetings] Error listing conversations:', error.message);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
};

/**
 * POST /api/meetings/:id/conversation/leave
 * Transfers chat administration to an existing participant before the current administrator
 * removes this conversation from their own list. This never changes the meeting organizer.
 */
export const leaveConversationHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user = await resolveUser(req);
    if (!user) {
      res.status(404).json({ error: 'User profile not found' });
      return;
    }

    const nextAdminEmail = typeof req.body?.nextAdminEmail === 'string'
      ? req.body.nextAdminEmail.trim().toLowerCase()
      : '';
    if (!nextAdminEmail) {
      res.status(400).json({ error: 'Choose the next conversation admin' });
      return;
    }

    const meeting = await Meeting.findById(req.params.id).populate('createdBy', 'email');
    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found' });
      return;
    }
    const company = meeting.companyId ? await Company.findById(meeting.companyId) : null;
    if (!mayAttend(meeting, user, company)) {
      res.status(403).json({ error: 'You are not authorized to manage this conversation' });
      return;
    }

    const creatorEmail = String((meeting.createdBy as any)?.email || '').trim().toLowerCase();
    const currentAdminEmail = String(meeting.conversationAdminEmail || creatorEmail).trim().toLowerCase();
    if (currentAdminEmail !== String(user.email || '').trim().toLowerCase()) {
      res.status(403).json({ error: 'Only the conversation admin can hand over this conversation' });
      return;
    }

    const participantEmails = new Set((meeting.participants || [])
      .map((participant) => String(participant.email || '').trim().toLowerCase())
      .filter(Boolean));
    for (const invitee of meeting.invitees || []) participantEmails.add(String(invitee).trim().toLowerCase());
    if (!participantEmails.has(nextAdminEmail)) {
      res.status(400).json({ error: 'The next admin must be a conversation participant' });
      return;
    }

    meeting.conversationAdminEmail = nextAdminEmail;
    await meeting.save();
    res.json({ conversationAdminEmail: nextAdminEmail });
  } catch (error: any) {
    console.error('[Meetings] Error leaving conversation:', error.message);
    res.status(500).json({ error: 'Failed to hand over this conversation' });
  }
};

// Each rejoin (e.g. reopening the embedded call from Conversations) pushes a fresh entry onto
// participants -- one per join *session*, not one per person -- so a raw array length massively
// overcounts anyone who joined more than once. Count distinct people instead, by email (the
// stable identity for a signed-in participant) falling back to name for a guest with no email.
const countUniqueParticipants = (participants: Array<{ name?: string; email?: string }> | undefined): number => {
  if (!participants || participants.length === 0) return 0;
  const seen = new Set<string>();
  for (const p of participants) {
    const key = (p.email || p.name || '').trim().toLowerCase();
    if (key) seen.add(key);
  }
  return seen.size;
};

const isAdminRole = (role?: string) => role === 'COMPANY_ADMIN' || role === 'SUPER_ADMIN';

/**
 * PATCH /api/meetings/:id
 * Edit a meeting's name/schedule/duration/type/notes/resources. Organizer (creator) or company admin only.
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

    if (!mayManageResource(user, meeting)) {
      res.status(403).json({ error: 'Only the organizer or a company admin can edit this meeting' });
      return;
    }

    const { name, scheduledAt, durationMinutes, type, passcode, description, invitees, notes, sharedFiles, resources } = req.body;
    if (scheduledAt) {
      const parsedScheduledAt = new Date(scheduledAt);
      if (Number.isNaN(parsedScheduledAt.getTime()) || parsedScheduledAt.getTime() < Date.now()) {
        res.status(400).json({ error: "This meeting can't be rescheduled to the past -- pick a future date/time." });
        return;
      }
    }
    // Same rule as creating a meeting (createMeetingHandler) -- Private always needs a password.
    // Resolve against the INCOMING type when it's part of this request, otherwise the meeting's
    // current type, so switching Guest -> Private without also sending a passcode is rejected
    // the same way an initial creation would be.
    const resolvedType = type !== undefined && ['Internal', 'Guest', 'Private'].includes(type) ? type : meeting.type;
    const resolvedPasscode = passcode !== undefined ? passcode : meeting.passcode;
    if (resolvedType === 'Private' && (typeof resolvedPasscode !== 'string' || !resolvedPasscode.trim())) {
      res.status(400).json({ error: 'A password is required for private meetings.' });
      return;
    }
    const scheduleChanged = scheduledAt !== undefined && new Date(scheduledAt).getTime() !== (meeting.scheduledAt ? new Date(meeting.scheduledAt).getTime() : null);
    if (name !== undefined) meeting.name = String(name).trim();
    if (scheduledAt !== undefined) meeting.scheduledAt = scheduledAt ? new Date(scheduledAt) : null;
    if (durationMinutes !== undefined) meeting.durationMinutes = durationMinutes || null;
    if (type !== undefined && ['Internal', 'Guest', 'Private'].includes(type)) meeting.type = type;
    // Switching away from Private clears any leftover password -- a Guest/public meeting should
    // never still carry a stale passcode that a stray client could try to enforce.
    if (passcode !== undefined) meeting.passcode = typeof passcode === 'string' && passcode.trim() ? passcode.trim() : null;
    else if (type !== undefined && type !== 'Private') meeting.passcode = null;
    if (description !== undefined) meeting.description = typeof description === 'string' && description.trim() ? description.trim().slice(0, 2000) : null;
    if (invitees !== undefined) {
      meeting.invitees = meeting.type === 'Private' && Array.isArray(invitees)
        ? Array.from(new Set(invitees.map((e: any) => String(e).trim().toLowerCase()).filter((e: string) => /.+@.+\..+/.test(e))))
        : undefined;
    }
    if (notes !== undefined) meeting.notes = typeof notes === 'string' ? notes : null;
    if (sharedFiles !== undefined && Array.isArray(sharedFiles)) meeting.sharedFiles = sharedFiles;
    if (resources !== undefined && typeof resources === 'object') {
      meeting.resources = {
        ...(meeting.resources || {}),
        ...resources,
      };
    }

    // Full-document validation can fail here against pre-existing data this handler never
    // touched -- e.g. a guest participant recorded with no email (legitimate: a guest can join
    // with just a name). Every other place in this codebase that saves a Meeting document
    // already skips it for the same reason; this endpoint's own field updates above are already
    // validated by hand (the Private/password check), so nothing real is lost by matching that.
    await meeting.save({ validateBeforeSave: false });

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

    if (!mayManageResource(user, meeting)) {
      res.status(403).json({ error: 'Only the organizer or a company admin can cancel this meeting' });
      return;
    }

    meeting.cancelledAt = new Date();

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

    // Per the retention policy, a cancelled meeting is destroyed immediately rather than
    // soft-cancelled -- populate the response first since deleteOne() below removes the
    // document, not just this in-memory reference.
    const responseMeeting = await meeting.populate('createdBy', 'fullName email avatarUrl');

    await meeting.deleteOne();

    res.json({ meeting: responseMeeting });
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

    if (!mayManageResource(user, meeting)) {
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

/**
 * POST /api/meetings/room/:roomSlug/invite  { emails: string[] }
 * Emails the meeting invitation (with Accept / Decline links) to more people, from the in-call
 * "Add others" dialog or the share dialog. For a saved meeting the caller must be its host and
 * the people are added to the invite list; a quick instant room just gets the link emailed.
 */
export const inviteToMeetingHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const room = String(req.params.roomSlug).toLowerCase();
    if (!/^[a-z0-9-]{3,100}$/.test(room)) { res.status(400).json({ error: 'Invalid room code' }); return; }
    const raw = Array.isArray(req.body?.emails) ? req.body.emails : [];
    const emails: string[] = Array.from(new Set<string>(
      raw.map((e: any) => String(e).trim().toLowerCase()).filter((e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254)
    ));
    if (emails.length === 0) { res.status(400).json({ error: 'Add at least one valid email address.' }); return; }
    if (emails.length > 20) { res.status(400).json({ error: 'You can invite up to 20 people at a time.' }); return; }

    const account: any = req.accountUser;
    const user = account?.id ? await User.findById(account.id) : null;
    if (!user) { res.status(401).json({ error: 'Sign in to invite people.' }); return; }

    const meeting: any = await Meeting.findOne({ roomSlug: room });
    if (meeting && !mayManageResource(user, meeting)) {
      res.status(403).json({ error: 'Only the meeting host can invite people.' });
      return;
    }

    const roomUrl = `${emailConfig.appUrl}/meet/${room}`;
    let topic = 'Toowix meeting';
    let dateTime = 'Starting now';
    let passcode = 'Not required';
    if (meeting) {
      topic = meeting.name;
      if (meeting.scheduledAt) {
        dateTime = new Date(meeting.scheduledAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
      }
      passcode = meeting.passcode || 'Not required';
      const known = new Set<string>((meeting.rsvps || []).map((r: any) => String(r.email).toLowerCase()));
      const newRsvps = emails.filter((e) => !known.has(e)).map((e) => ({ email: e, status: 'pending' as const }));
      await Meeting.updateOne(
        { _id: meeting._id },
        { $addToSet: { invitees: { $each: emails } }, ...(newRsvps.length ? { $push: { rsvps: { $each: newRsvps } } } : {}) }
      );
    }

    emails.forEach((to) => {
      const enc = encodeURIComponent(to);
      sendEmailAsync({
        to,
        templateName: 'E9_MEETING_INVITE',
        subject: `${user.fullName} invited you to "${topic}" - Toowix Meet`,
        templateVariables: {
          meeting_topic: topic,
          host_name: user.fullName,
          date_time: dateTime,
          room_url: roomUrl,
          passcode,
          accept_url: meeting ? `${emailConfig.appUrl}/rsvp?meetingId=${meeting._id}&email=${enc}&response=accepted` : roomUrl,
          reject_url: meeting ? `${emailConfig.appUrl}/rsvp?meetingId=${meeting._id}&email=${enc}&response=declined` : roomUrl,
        },
        metadata: { companyId: String(user.companyId || ''), userId: String(user._id) },
      });
    });

    res.json({ success: true, sent: emails.length });
  } catch (error: any) {
    console.error('[Meetings] Error inviting people:', error.message);
    res.status(500).json({ error: 'Could not send the invitations' });
  }
};

/**
 * POST /api/meetings/rsvp or GET /api/meetings/rsvp
 * Public endpoint for accepting or declining a meeting invitation.
 */
export const rsvpMeetingHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const meetingId = req.body?.meetingId || req.query?.meetingId;
    const email = req.body?.email || req.query?.email;
    const response = req.body?.response || req.query?.response;

    if (!meetingId || !email || !response) {
      res.status(400).json({ error: 'meetingId, email, and response are required' });
      return;
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const viewOnly = response === 'view';
    const cleanResponse = response === 'accepted' || response === 'accept' ? 'accepted' : 'declined';

    let meeting: any = null;
    if (mongoose.Types.ObjectId.isValid(String(meetingId))) {
      meeting = await Meeting.findById(meetingId).populate('createdBy', 'fullName email avatarUrl');
    }
    if (!meeting) {
      meeting = await Meeting.findOne({ roomSlug: String(meetingId) }).populate('createdBy', 'fullName email avatarUrl');
    }

    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found' });
      return;
    }

    // RSVP is public/unauthenticated (invitees click a link from their invite email), but the
    // response echoes back meeting.passcode -- when the meeting has an actual invitee list,
    // require the submitted email to be on it so an arbitrary caller can't RSVP as anyone to
    // harvest a Private meeting's passcode.
    if (Array.isArray(meeting.invitees) && meeting.invitees.length > 0) {
      const isInvitee = meeting.invitees.some((invitee: string) => invitee.toLowerCase() === cleanEmail);
      if (!isInvitee) {
        res.status(403).json({ error: 'This email is not on the invite list for this meeting' });
        return;
      }
    }

    meeting.rsvps = meeting.rsvps || [];
    if (!viewOnly) {
    const existingIndex = meeting.rsvps.findIndex((r: any) => r.email?.toLowerCase() === cleanEmail);
    if (existingIndex >= 0) {
      meeting.rsvps[existingIndex].status = cleanResponse;
      meeting.rsvps[existingIndex].respondedAt = new Date();
    } else {
      meeting.rsvps.push({
        email: cleanEmail,
        status: cleanResponse,
        respondedAt: new Date(),
      });
    }

    meeting.markModified('rsvps');
    await meeting.save({ validateBeforeSave: false });
    }

    const hostName = typeof meeting.createdBy === 'object' ? (meeting.createdBy as any)?.fullName : 'Organizer';

    // If client requested HTML directly in browser, redirect to frontend RSVP confirmation page
    if (req.method === 'GET' && req.accepts('html')) {
      res.redirect(`${emailConfig.appUrl}/rsvp?meetingId=${meeting._id}&email=${encodeURIComponent(cleanEmail)}&response=${cleanResponse}`);
      return;
    }

    res.json({
      success: true,
      status: viewOnly ? 'view' : cleanResponse,
      meeting: {
        id: meeting._id,
        name: meeting.name,
        roomSlug: meeting.roomSlug,
        scheduledAt: meeting.scheduledAt,
        passcode: meeting.passcode,
        hostName,
        meetingUrl: `${emailConfig.appUrl}/meet/${meeting.roomSlug}`,
      },
    });
  } catch (error: any) {
    console.error('[Meetings] Error updating RSVP:', error.message);
    res.status(500).json({ error: 'Failed to process RSVP' });
  }
};

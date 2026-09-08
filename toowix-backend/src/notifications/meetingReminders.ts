import { Meeting } from '../models/Meeting';
import { notifyCompany, notifyUser } from './createNotification';
import { sendEmailAsync } from '../email/sender';
import { emailConfig } from '../config/email';

const CHECK_INTERVAL_MS = 60 * 1000;

/** A meeting is due for a threshold when it's scheduled to start within the next
 * `maxMinutes` (and hasn't already passed), and hasn't been notified for it yet. */
const dueMeetings = async (flagField: string, maxMinutes: number) => {
  const now = Date.now();
  const windowEnd = new Date(now + maxMinutes * 60 * 1000);
  return Meeting.find({
    cancelledAt: null,
    scheduledAt: { $gt: new Date(now - 60 * 1000), $lte: windowEnd },
    [flagField]: { $ne: true },
  });
};

const fireReminder = async (
  flagField: 'notified60' | 'notified10' | 'notifiedNow',
  maxMinutes: number,
  type: 'MEETING_STARTS_IN_60' | 'MEETING_STARTS_IN_10' | 'MEETING_STARTS_NOW',
  title: string
) => {
  const meetings = await dueMeetings(flagField, maxMinutes);
  for (const meeting of meetings) {
    const payload = {
      category: 'MEETINGS' as const,
      type,
      title,
      description: `"${meeting.name}" ${type === 'MEETING_STARTS_NOW' ? 'is starting now.' : `starts soon.`}`,
      relatedName: meeting.name,
      actionLabel: 'Join' as const,
      actionUrl: `/meet/${meeting.roomSlug}`,
    };
    if (meeting.companyId) {
      await notifyCompany(meeting.companyId, payload);
    } else {
      await notifyUser({ userId: meeting.createdBy, ...payload });
    }

    // 1-Hour Email Reminder: send email to host and all attendees who haven't declined
    if (flagField === 'notified60') {
      try {
        const populatedMeeting = await Meeting.findById(meeting._id).populate('createdBy', 'fullName email');
        if (populatedMeeting) {
          const roomUrl = `${emailConfig.appUrl}/meet/${populatedMeeting.roomSlug}`;
          const dateTime = populatedMeeting.scheduledAt
            ? new Date(populatedMeeting.scheduledAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
            : 'In 1 hour';
          const hostName = typeof populatedMeeting.createdBy === 'object' && populatedMeeting.createdBy
            ? (populatedMeeting.createdBy as any).fullName || 'Organizer'
            : 'Organizer';
          const hostEmail = typeof populatedMeeting.createdBy === 'object' && populatedMeeting.createdBy
            ? (populatedMeeting.createdBy as any).email
            : null;

          const recipients = new Set<string>();
          if (hostEmail) recipients.add(hostEmail.toLowerCase());
          (populatedMeeting.invitees || []).forEach((invEmail: string) => {
            const rsvp = (populatedMeeting.rsvps || []).find((r) => r.email?.toLowerCase() === invEmail.toLowerCase());
            if (!rsvp || rsvp.status !== 'declined') {
              recipients.add(invEmail.toLowerCase());
            }
          });

          for (const recipientEmail of recipients) {
            sendEmailAsync({
              to: recipientEmail,
              templateName: 'E9_MEETING_INVITE',
              subject: `Reminder: "${populatedMeeting.name}" starts in 1 hour - Toowix Meet`,
              templateVariables: {
                meeting_topic: populatedMeeting.name,
                host_name: hostName,
                date_time: dateTime,
                room_url: roomUrl,
                passcode: populatedMeeting.passcode || 'Not required',
                accept_url: `${emailConfig.appUrl}/rsvp?meetingId=${populatedMeeting._id}&email=${encodeURIComponent(recipientEmail)}&response=accepted`,
                reject_url: `${emailConfig.appUrl}/rsvp?meetingId=${populatedMeeting._id}&email=${encodeURIComponent(recipientEmail)}&response=declined`,
              },
            });
          }
        }
      } catch (emailErr: any) {
        console.error('[Notifications] Failed to send 1-hour email reminder:', emailErr.message);
      }
    }

    (meeting as any)[flagField] = true;
    await meeting.save();
  }
};

const runCheck = async () => {
  try {
    await fireReminder('notified60', 60, 'MEETING_STARTS_IN_60', 'Meeting starts in 1 hour');
    await fireReminder('notified10', 10, 'MEETING_STARTS_IN_10', 'Meeting starts in 10 minutes');
    await fireReminder('notifiedNow', 1, 'MEETING_STARTS_NOW', 'Meeting starts now');
  } catch (error: any) {
    console.error('[Notifications] Meeting reminder check failed:', error.message);
  }
};

/** Starts the recurring background check for upcoming-meeting reminders.
 * Runs every minute for the lifetime of the backend process. */
export const startMeetingReminderScheduler = () => {
  runCheck();
  setInterval(runCheck, CHECK_INTERVAL_MS);
  console.log('[Notifications] Meeting reminder scheduler started (60s interval)');
};

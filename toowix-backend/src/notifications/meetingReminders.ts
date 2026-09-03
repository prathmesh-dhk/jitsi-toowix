import { Meeting } from '../models/Meeting';
import { notifyCompany, notifyUser } from './createNotification';

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

import { Meeting } from '../models/Meeting';

// Immediate cases (cancelled; instant meetings ended via "End for everyone") are handled
// event-driven at the point of action -- see cancelMeetingHandler in meetings.ts and
// endMeetingForEveryoneHandler in waitingRoom.ts. This sweep covers every rule that depends on
// time passing rather than a specific user action: scheduled/company meetings (30 min after
// scheduled end), recurring series (24h after the final occurrence), abandoned/stale instant
// meetings (24h after creation), plus a safety-net cancelled-meeting cleanup in case the
// event-driven delete above ever fails to run.
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const SCHEDULED_GRACE_MS = 30 * 60 * 1000;
const RECURRING_SERIES_GRACE_MS = 24 * 60 * 60 * 1000;
const ABANDONED_INSTANT_GRACE_MS = 24 * 60 * 60 * 1000;

const scheduledEndOf = (meeting: { scheduledAt?: Date | null; durationMinutes?: number | null }) =>
  (meeting.scheduledAt?.getTime() || 0) + (meeting.durationMinutes || 0) * 60 * 1000;

const sweepCancelledMeetings = async (): Promise<number> => {
  const result = await Meeting.deleteMany({ cancelledAt: { $ne: null } });

  return result.deletedCount || 0;
};

// Covers "Scheduled one-time meeting", "Scheduled private meeting", and "Company meeting" --
// all three share the exact same rule (30 minutes after scheduled end), so one query handles
// all of them regardless of type/companyId. Recurring occurrences are excluded here; a
// recurring series is only ever deleted as a whole, 24h after its final occurrence.
const sweepScheduledMeetings = async (now: number): Promise<number> => {
  const candidates = await Meeting.find({
    scheduledAt: { $ne: null },
    recurrence: null,
    cancelledAt: null,
  });

  let deleted = 0;

  for (const meeting of candidates) {
    if (now >= scheduledEndOf(meeting) + SCHEDULED_GRACE_MS) {
      await meeting.deleteOne();
      deleted++;
    }
  }

  return deleted;
};

const sweepRecurringSeries = async (now: number): Promise<number> => {
  const seriesIds: string[] = await Meeting.distinct('recurrence.seriesId', { recurrence: { $ne: null } });
  let deleted = 0;

  for (const seriesId of seriesIds) {
    const occurrences = await Meeting.find({ 'recurrence.seriesId': seriesId });

    if (occurrences.length === 0) {
      continue;
    }

    const finalOccurrenceEnd = Math.max(...occurrences.map(scheduledEndOf));

    if (now >= finalOccurrenceEnd + RECURRING_SERIES_GRACE_MS) {
      const result = await Meeting.deleteMany({ 'recurrence.seriesId': seriesId });

      deleted += result.deletedCount || 0;
    }
  }

  return deleted;
};

// "Abandoned instant meeting: nobody joins or host never starts" plus a general safety net for
// any instant meeting the event-driven end-for-everyone delete didn't already catch (e.g. the
// call crashed, or nobody ever clicked "End for everyone").
const sweepAbandonedInstantMeetings = async (now: number): Promise<number> => {
  const cutoff = new Date(now - ABANDONED_INSTANT_GRACE_MS);
  const result = await Meeting.deleteMany({
    scheduledAt: null,
    recurrence: null,
    createdAt: { $lt: cutoff },
  });

  return result.deletedCount || 0;
};

export const runMeetingRetentionSweep = async () => {
  try {
    const now = Date.now();
    const cancelled = await sweepCancelledMeetings();
    const scheduled = await sweepScheduledMeetings(now);
    const recurring = await sweepRecurringSeries(now);
    const abandoned = await sweepAbandonedInstantMeetings(now);
    const total = cancelled + scheduled + recurring + abandoned;

    if (total > 0) {
      console.log(
        `[Meetings] Retention sweep: deleted ${total} meeting(s) `
        + `(cancelled=${cancelled}, scheduled=${scheduled}, recurring=${recurring}, abandoned=${abandoned})`
      );
    }
  } catch (error: any) {
    console.error('[Meetings] Retention sweep failed:', error.message);
  }
};

/** Starts the recurring background job that permanently deletes meetings once they're past
 * their retention window, per the meeting-type expiry policy. Immediate cases (cancelled,
 * instant-meeting-ended) are deleted at the point of action instead of waiting for this sweep --
 * see the comment at the top of this file. Runs every 5 minutes for the lifetime of the backend
 * process. */
export const startMeetingRetentionScheduler = () => {
  runMeetingRetentionSweep();
  setInterval(runMeetingRetentionSweep, CHECK_INTERVAL_MS);
  console.log('[Meetings] Retention scheduler started (5-minute interval)');
};

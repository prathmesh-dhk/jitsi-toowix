import { promises as fs } from 'fs';
import path from 'path';
import { Meeting } from '../models/Meeting';
import { getChatFileUploadRoot, parseRoomSlugFromChatFileSubdir } from '../uploads/chatFileStorage';

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

// Meetings with a recording running or still being processed are never deleted.
const notHeld = (now: number) => ({ $or: [ { recordingHoldUntil: null }, { recordingHoldUntil: { $lt: new Date(now) } } ] });

// A saved conversation (chatMessages, from the Conversations feature) lives embedded on the
// Meeting document -- any automatic, time-based sweep below must never delete a meeting that has
// one, or the "saved" conversation would quietly disappear on its own. Only an explicit user
// action (Cancel, or "Delete history" in Past Meetings) removes a meeting with saved chat.
const hasNoChatHistory = { $or: [ { chatMessages: { $exists: false } }, { chatMessages: { $size: 0 } } ] };

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
    ...notHeld(now),
    ...hasNoChatHistory,
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
      const result = await Meeting.deleteMany({ 'recurrence.seriesId': seriesId, ...notHeld(now), ...hasNoChatHistory });

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
    ...notHeld(now),
    ...hasNoChatHistory,
  });

  return result.deletedCount || 0;
};

// An ad-hoc room (instant meeting, or any link with no Meeting document) has no chat persisted
// anywhere -- the conversation itself already dies with the in-memory signal buffer once the
// meeting ends (see the chatMessages field comment on the Meeting model). A file attachment sent
// in one of those rooms is the one piece of that conversation that DOES touch disk (persistChatFile
// writes it regardless of whether a Meeting document exists), so it needs its own cleanup to match
// the same "destroyed when the meeting ends, never saved" behavior the rest of an ad-hoc
// conversation already has. 3 hours comfortably covers the 2-hour free-instant-meeting cap plus
// room for a slow upload/download right at the end, without needing to hook this into whichever
// exact signal fires "this meeting ended" for an ad-hoc room (there isn't one reliable single
// point -- people simply close the tab most of the time).
const ADHOC_CHAT_FILE_GRACE_MS = 3 * 60 * 60 * 1000;

const sweepAdHocChatFiles = async (now: number): Promise<number> => {
  const root = getChatFileUploadRoot();
  let entries: string[];

  try {
    entries = await fs.readdir(root);
  } catch {
    // Directory doesn't exist yet -- nothing has ever been uploaded.
    return 0;
  }

  let deleted = 0;

  for (const subdir of entries) {
    const dirPath = path.join(root, subdir);

    try {
      const stat = await fs.stat(dirPath);

      if (!stat.isDirectory() || now - stat.mtimeMs < ADHOC_CHAT_FILE_GRACE_MS) {
        continue;
      }

      const roomSlug = parseRoomSlugFromChatFileSubdir(subdir);

      if (!roomSlug) {
        continue;
      }

      // A real dashboard-created meeting's attachment lives as long as the meeting (and its
      // saved chat) does -- that's managed by the sweeps above, not this one. Only delete here
      // when there is genuinely no Meeting document for this room at all.
      const meetingExists = await Meeting.exists({ roomSlug });

      if (meetingExists) {
        continue;
      }

      await fs.rm(dirPath, { recursive: true, force: true });
      deleted++;
    } catch {
      // Best-effort -- a single bad entry must not abort the rest of the sweep.
    }
  }

  return deleted;
};

export const runMeetingRetentionSweep = async () => {
  try {
    const now = Date.now();
    const cancelled = await sweepCancelledMeetings();
    const scheduled = await sweepScheduledMeetings(now);
    const recurring = await sweepRecurringSeries(now);
    const abandoned = await sweepAbandonedInstantMeetings(now);
    const adHocFiles = await sweepAdHocChatFiles(now);
    const total = cancelled + scheduled + recurring + abandoned;

    if (total > 0) {
      console.log(
        `[Meetings] Retention sweep: deleted ${total} meeting(s) `
        + `(cancelled=${cancelled}, scheduled=${scheduled}, recurring=${recurring}, abandoned=${abandoned})`
      );
    }
    if (adHocFiles > 0) {
      console.log(`[Meetings] Retention sweep: deleted ${adHocFiles} ad-hoc chat file upload(s)`);
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

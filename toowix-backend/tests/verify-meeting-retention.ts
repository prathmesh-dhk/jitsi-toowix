// Verifies the meeting retention/deletion policy end-to-end against the real dev database:
//   - Cancelled meeting -> deleted immediately (via cancelMeetingHandler)
//   - Instant meeting ended via "End for everyone" -> deleted immediately (via
//     endMeetingForEveryoneHandler)
//   - Scheduled one-time / scheduled private / company meeting -> deleted by the sweep only
//     once 30 minutes past scheduled end
//   - Recurring series -> deleted as a WHOLE series by the sweep only once 24h past the final
//     occurrence, and NOT before that
//   - Abandoned/stale instant meeting -> deleted by the sweep only once 24h past creation, and
//     NOT before that
//
// Every test meeting is tagged with a unique run marker in its name so cleanup can't touch
// unrelated real data, and a final cleanup pass removes any leftovers regardless of outcome.
//
// Usage: npx ts-node tests/verify-meeting-retention.ts

import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../src/db/connection';
import { Meeting } from '../src/models/Meeting';
import { User } from '../src/models/User';
import { cancelMeetingHandler } from '../src/meetings/meetings';
import { endMeetingForEveryoneHandler } from '../src/meetings/waitingRoom';
import { runMeetingRetentionSweep } from '../src/meetings/retention';

const RUN_ID = `retention-test-${Date.now()}`;
const results: { pass: string[]; fail: string[] } = { pass: [], fail: [] };

function fakeRes() {
  const res: any = {
    statusCode: 200,
    body: null,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: any) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

async function makeUser() {
  const uid = `${RUN_ID}-uid`;
  let user = await User.findOne({ firebaseUid: uid });
  if (!user) {
    user = await User.create({
      firebaseUid: uid,
      email: `${RUN_ID}@example.com`,
      fullName: 'Retention Test User',
    });
  }
  return user;
}

async function backdateCreatedAt(meetingId: mongoose.Types.ObjectId, date: Date) {
  // timestamps: true forces createdAt on save(); only a direct collection update can override it.
  await Meeting.collection.updateOne({ _id: meetingId }, { $set: { createdAt: date } });
}

async function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    results.pass.push(label);
  } else {
    results.fail.push(`${label}${detail ? ` -- ${detail}` : ''}`);
  }
}

async function exists(id: mongoose.Types.ObjectId) {
  return !!(await Meeting.findById(id));
}

async function run() {
  await connectDatabase();
  const user = await makeUser();

  console.log(`Run marker: ${RUN_ID}`);

  // -- 1. Cancelled meeting: deleted immediately by cancelMeetingHandler -------------------
  {
    const meeting = await Meeting.create({
      createdBy: user._id,
      name: `${RUN_ID}-cancel`,
      roomSlug: `${RUN_ID}-cancel`,
      type: 'Guest',
    });
    const req: any = { firebaseUid: user.firebaseUid, params: { id: String(meeting._id) } };
    const res = fakeRes();

    await cancelMeetingHandler(req, res);
    await check('Cancelled meeting: handler responded 200', res.statusCode === 200, JSON.stringify(res.body));
    await check('Cancelled meeting: doc deleted immediately from DB', !(await exists(meeting._id)));
  }

  // -- 2. Instant meeting ended via "End for everyone": deleted immediately ----------------
  {
    const roomSlug = `${RUN_ID}-instant-end`;
    const meeting = await Meeting.create({
      createdBy: user._id,
      name: `${RUN_ID}-instant-end`,
      roomSlug,
      type: 'Guest',
      hostJoined: true,
    });
    const req: any = { params: { roomSlug } };
    const res = fakeRes();

    await endMeetingForEveryoneHandler(req, res);
    await check('Instant meeting ended: handler responded 200', res.statusCode === 200, JSON.stringify(res.body));
    await check('Instant meeting ended: doc deleted immediately from DB', !(await exists(meeting._id)));
  }

  // -- 3. Scheduled one-time meeting: NOT deleted before 30min grace, deleted after --------
  {
    const notDue = await Meeting.create({
      createdBy: user._id,
      name: `${RUN_ID}-scheduled-not-due`,
      roomSlug: `${RUN_ID}-scheduled-not-due`,
      type: 'Guest',
      scheduledAt: new Date(Date.now() - 10 * 60 * 1000), // ended 10 min ago, within 30min grace
      durationMinutes: 0,
    });
    const due = await Meeting.create({
      createdBy: user._id,
      name: `${RUN_ID}-scheduled-due`,
      roomSlug: `${RUN_ID}-scheduled-due`,
      type: 'Guest',
      scheduledAt: new Date(Date.now() - 40 * 60 * 1000), // ended 40 min ago, past the 30min grace
      durationMinutes: 0,
    });

    await runMeetingRetentionSweep();
    await check('Scheduled meeting within grace: survives sweep', await exists(notDue._id));
    await check('Scheduled meeting past grace: deleted by sweep', !(await exists(due._id)));

    await Meeting.deleteOne({ _id: notDue._id }); // cleanup the survivor
  }

  // -- 4. Scheduled private meeting: same 30min rule, deleted after grace ------------------
  {
    const due = await Meeting.create({
      createdBy: user._id,
      name: `${RUN_ID}-private-due`,
      roomSlug: `${RUN_ID}-private-due`,
      type: 'Private',
      passcode: '123456',
      scheduledAt: new Date(Date.now() - 40 * 60 * 1000),
      durationMinutes: 0,
    });

    await runMeetingRetentionSweep();
    await check('Scheduled private meeting past grace: deleted by sweep', !(await exists(due._id)));
  }

  // -- 5. Company meeting: same 30min rule, deleted after grace ----------------------------
  {
    const fakeCompanyId = new mongoose.Types.ObjectId();
    const due = await Meeting.create({
      createdBy: user._id,
      companyId: fakeCompanyId,
      name: `${RUN_ID}-company-due`,
      roomSlug: `${RUN_ID}-company-due`,
      type: 'Internal',
      scheduledAt: new Date(Date.now() - 40 * 60 * 1000),
      durationMinutes: 0,
    });

    await runMeetingRetentionSweep();
    await check('Company meeting past grace: deleted by sweep', !(await exists(due._id)));
  }

  // -- 6. Recurring series: NOT deleted before 24h-past-final-occurrence, deleted as a whole
  //       series once past it -- and an individual past occurrence within an active series
  //       must NOT be deleted early. ------------------------------------------------------
  {
    const seriesId = `${RUN_ID}-series-notdue`;
    const occ1 = await Meeting.create({
      createdBy: user._id,
      name: `${RUN_ID}-recurring-notdue-1`,
      roomSlug: `${RUN_ID}-recurring-notdue-1`,
      type: 'Guest',
      scheduledAt: new Date(Date.now() - 48 * 60 * 60 * 1000), // this occurrence long past
      durationMinutes: 0,
      recurrence: { frequency: 'WEEKLY', seriesId },
    });
    const occ2 = await Meeting.create({
      createdBy: user._id,
      name: `${RUN_ID}-recurring-notdue-2`,
      roomSlug: `${RUN_ID}-recurring-notdue-2`,
      type: 'Guest',
      scheduledAt: new Date(Date.now() + 60 * 60 * 1000), // final occurrence still upcoming
      durationMinutes: 0,
      recurrence: { frequency: 'WEEKLY', seriesId },
    });

    await runMeetingRetentionSweep();
    await check(
      'Recurring series with a future final occurrence: whole series survives (incl. past occurrence)',
      (await exists(occ1._id)) && (await exists(occ2._id))
    );

    await Meeting.deleteMany({ 'recurrence.seriesId': seriesId }); // cleanup
  }
  {
    const seriesId = `${RUN_ID}-series-due`;
    const occ1 = await Meeting.create({
      createdBy: user._id,
      name: `${RUN_ID}-recurring-due-1`,
      roomSlug: `${RUN_ID}-recurring-due-1`,
      type: 'Guest',
      scheduledAt: new Date(Date.now() - 50 * 60 * 60 * 1000),
      durationMinutes: 0,
      recurrence: { frequency: 'WEEKLY', seriesId },
    });
    const occ2 = await Meeting.create({
      createdBy: user._id,
      name: `${RUN_ID}-recurring-due-2`,
      roomSlug: `${RUN_ID}-recurring-due-2`,
      type: 'Guest',
      scheduledAt: new Date(Date.now() - 26 * 60 * 60 * 1000), // final occurrence 26h ago -> 2h past 24h grace
      durationMinutes: 0,
      recurrence: { frequency: 'WEEKLY', seriesId },
    });

    await runMeetingRetentionSweep();
    await check(
      'Recurring series 24h past final occurrence: entire series deleted together',
      !(await exists(occ1._id)) && !(await exists(occ2._id))
    );
  }

  // -- 7. Abandoned instant meeting: NOT deleted before 24h, deleted after -----------------
  {
    const notDue = await Meeting.create({
      createdBy: user._id,
      name: `${RUN_ID}-abandoned-notdue`,
      roomSlug: `${RUN_ID}-abandoned-notdue`,
      type: 'Guest',
    });
    await backdateCreatedAt(notDue._id, new Date(Date.now() - 2 * 60 * 60 * 1000)); // 2h old

    const due = await Meeting.create({
      createdBy: user._id,
      name: `${RUN_ID}-abandoned-due`,
      roomSlug: `${RUN_ID}-abandoned-due`,
      type: 'Guest',
    });
    await backdateCreatedAt(due._id, new Date(Date.now() - 25 * 60 * 60 * 1000)); // 25h old

    await runMeetingRetentionSweep();
    await check('Abandoned instant meeting within 24h: survives sweep', await exists(notDue._id));
    await check('Abandoned instant meeting past 24h: deleted by sweep', !(await exists(due._id)));

    await Meeting.deleteOne({ _id: notDue._id }); // cleanup the survivor
  }

  // -- 8. Rule-priority: cancelled always wins, even over a scheduled/company meeting still
  //       within its own grace window -------------------------------------------------------
  {
    const meeting = await Meeting.create({
      createdBy: user._id,
      name: `${RUN_ID}-cancelled-priority`,
      roomSlug: `${RUN_ID}-cancelled-priority`,
      type: 'Internal',
      companyId: new mongoose.Types.ObjectId(),
      scheduledAt: new Date(Date.now() + 60 * 60 * 1000), // scheduled in the FUTURE, would never be swept on its own
      cancelledAt: new Date(),
    });

    await runMeetingRetentionSweep();
    await check(
      'Cancelled meeting overrides an otherwise-not-due scheduled/company meeting',
      !(await exists(meeting._id))
    );
  }

  // -- Final cleanup: remove anything left over under this run's marker regardless of outcome
  const leftover = await Meeting.deleteMany({ roomSlug: { $regex: `^${RUN_ID}` } });
  await User.deleteOne({ firebaseUid: user.firebaseUid });
  if (leftover.deletedCount) {
    console.log(`(cleanup) removed ${leftover.deletedCount} leftover test document(s))`);
  }

  console.log('\n=== RESULTS ===');
  results.pass.forEach(p => console.log(`[PASS] ${p}`));
  results.fail.forEach(f => console.log(`[FAIL] ${f}`));

  await disconnectDatabase();

  if (results.fail.length > 0) {
    console.log(`\n${results.fail.length} check(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${results.pass.length} checks passed.`);
}

run().catch(async (err) => {
  console.error('Test run crashed:', err);
  await disconnectDatabase();
  process.exit(1);
});

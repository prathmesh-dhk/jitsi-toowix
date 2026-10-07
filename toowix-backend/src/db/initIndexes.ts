import { connectDatabase, disconnectDatabase } from './connection';
import { Company, User, EmailLog, Meeting, Recording, TeamInvite, Contact } from '../models';
import { Notification } from '../models/Notification';
import { Session } from '../models/Session';
import { RecordingHold } from '../models/RecordingHold';
import type { Model } from 'mongoose';

// Every model that defines its own indexes (via schema.index(...)) belongs here. autoIndex is off
// in production (src/config/database.ts), so this is the only thing that ever applies an index
// change to a production collection -- a model missing from this list silently keeps stale indexes
// in production no matter what its schema says. When adding a new model with its own indexes, add
// it here too.
const MODELS: ReadonlyArray<{ name: string; model: Model<any> }> = [
  { name: 'Company', model: Company },
  { name: 'User', model: User },
  { name: 'EmailLog', model: EmailLog },
  { name: 'Meeting', model: Meeting },
  { name: 'Recording', model: Recording },
  { name: 'TeamInvite', model: TeamInvite },
  { name: 'Contact', model: Contact },
  { name: 'Notification', model: Notification },
  { name: 'Session', model: Session },
  { name: 'RecordingHold', model: RecordingHold },
];

/**
 * Deliberately NOT called on app boot (src/index.ts does not import this file) -- syncIndexes can
 * drop/rebuild indexes on a large production collection, which is slow and can block other
 * operations on that collection while it runs. Run this explicitly as its own deploy step
 * (`npm run db:indexes`) after any commit that adds/changes/removes a `schema.index(...)` call,
 * before traffic depends on the new index existing. Safe to run with no pending index changes --
 * syncIndexes() is a no-op for a model whose indexes already match its schema.
 */
export const initIndexes = async (): Promise<void> => {
  console.log('[Indexes] Connecting to database to sync indexes...');
  await connectDatabase();

  const results: Array<{ name: string; ok: boolean; detail: string }> = [];

  for (const { name, model } of MODELS) {
    try {
      const dropped = await model.syncIndexes();

      results.push({ name, ok: true, detail: dropped.length ? `dropped stale: ${dropped.join(', ')}` : 'up to date' });
      console.log(`[Indexes] OK   ${name}: ${results[results.length - 1].detail}`);
    } catch (error: any) {
      results.push({ name, ok: false, detail: error?.message || String(error) });
      console.error(`[Indexes] FAIL ${name}: ${results[results.length - 1].detail}`);
    }
  }

  const failed = results.filter((r) => !r.ok);

  console.log(`[Indexes] ${results.length - failed.length}/${results.length} models synced successfully.`);

  if (failed.length > 0) {
    throw new Error(`Index sync failed for: ${failed.map((r) => r.name).join(', ')}`);
  }
};

// Run directly if called via CLI
if (require.main === module) {
  initIndexes()
    .then(async () => {
      await disconnectDatabase();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error(err);
      await disconnectDatabase();
      process.exit(1);
    });
}

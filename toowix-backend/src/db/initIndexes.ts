import { connectDatabase, disconnectDatabase } from './connection';
import { Company, User, EmailLog } from '../models';

export const initIndexes = async (): Promise<void> => {
  try {
    console.log('[Indexes] Connecting to database to sync indexes...');
    await connectDatabase();

    console.log('[Indexes] Syncing indexes for Company model...');
    await Company.syncIndexes();

    console.log('[Indexes] Syncing indexes for User model...');
    await User.syncIndexes();

    console.log('[Indexes] Syncing indexes for EmailLog model...');
    await EmailLog.syncIndexes();

    console.log('[Indexes] All MongoDB indexes synchronized successfully.');
  } catch (error) {
    console.error('[Indexes] Error synchronizing indexes:', error);
    throw error;
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

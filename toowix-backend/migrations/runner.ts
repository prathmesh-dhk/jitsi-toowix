import mongoose, { Schema } from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../src/db/connection';
import * as initialSchema from './001_create_initial_schema';

interface IMigrationRecord {
  name: string;
  appliedAt: Date;
}

const MigrationRecordSchema = new Schema<IMigrationRecord>({
  name: { type: String, required: true, unique: true },
  appliedAt: { type: Date, default: Date.now },
});

const MigrationRecord =
  mongoose.models._MigrationRecord ||
  mongoose.model<IMigrationRecord>('_MigrationRecord', MigrationRecordSchema, '_migrations');

const migrations = [
  {
    name: '001_create_initial_schema',
    up: initialSchema.up,
    down: initialSchema.down,
  },
];

export async function runMigrations(): Promise<void> {
  console.log('\n========================================');
  console.log('  RUNNING TOOWIX DATABASE MIGRATIONS');
  console.log('========================================\n');

  try {
    await connectDatabase();

    for (const migration of migrations) {
      const alreadyApplied = await MigrationRecord.findOne({ name: migration.name });

      if (alreadyApplied) {
        console.log(`[SKIPPED] ${migration.name} (already applied on ${alreadyApplied.appliedAt.toISOString()})`);
        continue;
      }

      console.log(`[APPLYING] ${migration.name}...`);
      await migration.up();

      await MigrationRecord.create({
        name: migration.name,
        appliedAt: new Date(),
      });

      console.log(`[SUCCESS] ${migration.name} applied successfully.`);
    }

    console.log('\n========================================');
    console.log('  ALL MIGRATIONS COMPLETED SUCCESSFULLY');
    console.log('========================================\n');
  } catch (error) {
    console.error('\n[FATAL] Migration error:', error);
    throw error;
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

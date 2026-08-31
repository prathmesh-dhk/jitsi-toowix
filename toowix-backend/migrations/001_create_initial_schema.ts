import mongoose from 'mongoose';
import { Company, User, EmailLog } from '../src/models';

/**
 * Migration 001: Initial Schema Setup
 * Ensures all collections, schemas, and indexes exist in MongoDB Atlas.
 */
export async function up(): Promise<void> {
  console.log('  -> [001] Ensuring collections exist and syncing indexes...');

  // 1. Sync Indexes for Company
  await Company.init();
  await Company.syncIndexes();
  console.log('  -> [001] Company collection and indexes ready.');

  // 2. Sync Indexes for User
  await User.init();
  await User.syncIndexes();
  console.log('  -> [001] User collection and indexes ready.');

  // 3. Sync Indexes for EmailLog
  await EmailLog.init();
  await EmailLog.syncIndexes();
  console.log('  -> [001] EmailLog collection and indexes ready.');
}

/**
 * Rollback Migration 001
 */
export async function down(): Promise<void> {
  console.log('  -> [001-rollback] Dropping indexes (preserving data)...');
  const db = mongoose.connection.db;
  if (!db) return;

  try {
    await db.collection('companies').dropIndexes();
    await db.collection('users').dropIndexes();
    await db.collection('emaillogs').dropIndexes();
    console.log('  -> [001-rollback] Indexes dropped.');
  } catch (error) {
    console.warn('  -> [001-rollback] Warning dropping indexes:', error);
  }
}

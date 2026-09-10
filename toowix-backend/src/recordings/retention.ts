import fs from 'fs';
import path from 'path';
import { Recording } from '../models/Recording';

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly is frequent enough for a day-granularity policy
const RETENTION_DAYS = 30;

const deleteFileIfPresent = async (root: string, relativePath: string) => {
  const filePath = path.resolve(root, relativePath);
  if (!filePath.startsWith(root + path.sep)) return; // refuse to touch anything outside the storage root
  await fs.promises.unlink(filePath).catch(() => {}); // already gone is fine
};

const runCleanup = async () => {
  try {
    const root = path.resolve(process.env.RECORDINGS_STORAGE_PATH || '/recordings-storage');
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const expired = await Recording.find({ recordedAt: { $lt: cutoff } });

    for (const recording of expired) {
      if (recording.fileUrl) {
        await deleteFileIfPresent(root, recording.fileUrl);
      }
      await recording.deleteOne();
    }

    if (expired.length > 0) {
      console.log(`[Recordings] Retention cleanup: deleted ${expired.length} recording(s) older than ${RETENTION_DAYS} days`);
    }
  } catch (error: any) {
    console.error('[Recordings] Retention cleanup failed:', error.message);
  }
};

/** Starts the recurring background job that permanently deletes recordings
 * (file + DB record) once they're older than the fixed 30-day retention
 * window. Runs hourly for the lifetime of the backend process. */
export const startRecordingRetentionScheduler = () => {
  runCleanup();
  setInterval(runCleanup, CHECK_INTERVAL_MS);
  console.log(`[Recordings] Retention scheduler started (${RETENTION_DAYS}-day window, hourly check)`);
};

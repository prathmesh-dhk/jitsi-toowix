import mongoose from 'mongoose';
import { databaseConfig } from '../config/database';

let isConnected = false;

export const connectDatabase = async (customUri?: string): Promise<typeof mongoose> => {
  if (isConnected && mongoose.connection.readyState === 1) {
    return mongoose;
  }

  const uri = customUri || databaseConfig.uri;

  try {
    const conn = await mongoose.connect(uri, databaseConfig.options);
    isConnected = conn.connection.readyState === 1;

    console.log(`[Database] MongoDB connected successfully to: ${conn.connection.host}/${conn.connection.name}`);

    mongoose.connection.on('error', (err) => {
      console.error('[Database] MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('[Database] MongoDB disconnected.');
      isConnected = false;
    });

    mongoose.connection.on('reconnected', () => {
      console.log('[Database] MongoDB reconnected.');
      isConnected = true;
    });

    return mongoose;
  } catch (error) {
    // One line, not the whole driver topology dump (which is huge and repeated on every retry); the
    // caller that finally gives up logs the full error.
    console.error('[Database] Failed to connect to MongoDB:', (error as Error)?.message || error);
    throw error;
  }
};

export interface IConnectRetryOptions {
  /** Total attempts before giving up (default MONGODB_CONNECT_ATTEMPTS or 6). */
  attempts?: number;
  /** First wait between attempts; doubles each time up to maxDelayMs. */
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Test hooks. */
  connect?: () => Promise<typeof mongoose>;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Connects to MongoDB, retrying with growing waits (1s, 2s, 4s, 8s, 15s...) before giving up, so a brief
 * network drop or a slow first connection at startup does not kill the whole server. Only the STARTUP
 * path uses this (src/index.ts); scripts keep the single-attempt connectDatabase. Once connected, the driver
 * itself reconnects automatically if the connection later drops.
 */
export const connectDatabaseWithRetry = async (options: IConnectRetryOptions = {}): Promise<typeof mongoose> => {
  const attempts = Math.max(1, options.attempts ?? (parseInt(process.env.MONGODB_CONNECT_ATTEMPTS || '6', 10) || 6));
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 15_000;
  const connect = options.connect ?? (() => connectDatabase());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await connect();
    } catch (error) {
      if (attempt >= attempts) throw error;
      const wait = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));

      console.warn(`[Database] Attempt ${attempt}/${attempts} failed. Retrying in ${Math.round(wait / 100) / 10}s (check your network / the Atlas IP access list if this keeps happening)...`);
      await sleep(wait);
    }
  }
};

export const disconnectDatabase = async (): Promise<void> => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    isConnected = false;
    console.log('[Database] MongoDB disconnected cleanly.');
  }
};

export const pingDatabase = async (): Promise<boolean> => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return false;
    }
    const adminDb = mongoose.connection.db?.admin();
    if (!adminDb) return false;
    const pingResult = await adminDb.ping();
    return pingResult?.ok === 1;
  } catch {
    return false;
  }
};

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
    console.error('[Database] Failed to connect to MongoDB:', error);
    throw error;
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

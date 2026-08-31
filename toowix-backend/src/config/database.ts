import dotenv from 'dotenv';
dotenv.config();

export interface IDatabaseConfig {
  uri: string;
  options: {
    maxPoolSize: number;
    minPoolSize: number;
    serverSelectionTimeoutMS: number;
    socketTimeoutMS: number;
    autoIndex: boolean;
  };
}

export const databaseConfig: IDatabaseConfig = {
  uri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/toowix_meet',
  options: {
    maxPoolSize: parseInt(process.env.MONGODB_MAX_POOL_SIZE || '20', 10),
    minPoolSize: parseInt(process.env.MONGODB_MIN_POOL_SIZE || '5', 10),
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    autoIndex: process.env.NODE_ENV !== 'production', // Use explicit syncIndexes in production
  },
};

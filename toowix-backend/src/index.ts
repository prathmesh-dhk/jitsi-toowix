import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { connectDatabase, disconnectDatabase, pingDatabase } from './db/connection';
import { getAvatarUploadRoot } from './uploads/avatarStorage';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// Behind nginx in production (talk-proxy.conf sets X-Forwarded-Proto/Host) -- without this,
// req.protocol always reports 'http' regardless of the real scheme, which would make
// persistAvatarIfDataUri build an http:// URL on an https:// site (mixed content, likely
// blocked by the browser) instead of the real https:// origin.
app.set('trust proxy', true);

// Security & Parsing Middleware
app.use(helmet());
// `origin: true` (reflect any Origin) combined with `credentials: true` is a credentialed-
// wildcard CORS hole -- any site can make an authenticated cross-origin request and read the
// response. Restrict to an explicit allowlist (CORS_ALLOWED_ORIGINS, comma-separated, falling
// back to APP_URL) in production; local/dev keeps the old permissive behavior for convenience
// since there's no real cross-tenant risk on a developer's own machine.
const corsAllowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || process.env.APP_URL || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: process.env.NODE_ENV === 'production'
      ? (origin, callback) => {
          // Non-browser/same-origin callers (curl, server health checks, nginx) send no Origin
          // header at all -- only enforce the allowlist against requests that present one.
          if (!origin || corsAllowedOrigins.includes(origin)) return callback(null, true);
          callback(new Error('Not allowed by CORS'));
        }
      : true,
    credentials: true,
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// Health Check Endpoint (Mon-BE-1)
app.get('/health', async (_req: Request, res: Response) => {
  const isDbHealthy = await pingDatabase();

  res.status(isDbHealthy ? 200 : 503).json({
    status: isDbHealthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    service: 'toowix-backend',
    database: {
      status: isDbHealthy ? 'connected' : 'disconnected',
    },
  });
});

// API Routes (Tue-BE-1 to Tue-BE-4)
import authRoutes from './routes/auth.routes';
import companyRoutes from './routes/company.routes';
import meetingRoutes from './routes/meeting.routes';
import recordingRoutes from './routes/recording.routes';
import teamRoutes from './routes/team.routes';
import notificationRoutes from './routes/notification.routes';
import { startMeetingReminderScheduler } from './notifications/meetingReminders';
import { startMeetingRetentionScheduler } from './meetings/retention';
import { startRecordingRetentionScheduler } from './recordings/retention';
import settingsRoutes from './routes/settings.routes';

app.use('/api/auth', authRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/meetings', meetingRoutes);
app.use('/api/recordings', recordingRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/settings', settingsRoutes);
// Served under /api/ so it flows through the same nginx proxy rule as the rest of the API,
// with no extra reverse-proxy config needed -- see persistAvatarIfDataUri in avatarStorage.ts.
app.use('/api/uploads/avatars', express.static(getAvatarUploadRoot()));

// API Root Placeholder
app.get('/', (_req: Request, res: Response) => {
  res.json({
    name: 'Toowix Meet SaaS Backend API',
    version: '1.0.0',
    status: 'online',
    docs: '/api/docs',
    endpoints: {
      health: '/health',
      auth: '/api/auth',
      companies: '/api/companies',
    },
  });
});

// Graceful Shutdown
const shutdown = async () => {
  console.log('[Toowix Backend] Gracefully shutting down...');
  await disconnectDatabase();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Bootstrap Function
async function bootstrap() {
  console.log('[Toowix Backend] Initializing service...');
  try {
    await connectDatabase();
    app.listen(PORT, () => {
      console.log(`[Toowix Backend] Server running on http://localhost:${PORT}`);
      console.log(`[Toowix Backend] Health check available at http://localhost:${PORT}/health`);
    });
    startMeetingReminderScheduler();
    startMeetingRetentionScheduler();
    // Was written but never wired up before -- recordings were never actually being cleaned up.
    startRecordingRetentionScheduler();
  } catch (error) {
    console.error('[Toowix Backend] Fatal initialization error:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  bootstrap();
}

export default app;

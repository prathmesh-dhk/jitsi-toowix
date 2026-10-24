import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { connectDatabase, disconnectDatabase, pingDatabase } from './db/connection';
import { getAvatarUploadRoot } from './uploads/avatarStorage';
import { getChatImageUploadRoot } from './uploads/chatImageStorage';
import { getChatAudioUploadRoot } from './uploads/chatAudioStorage';
import { getChatFileUploadRoot } from './uploads/chatFileStorage';

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
import { startMeetingReminderScheduler } from './notifications/meetingReminders.service';
import { startMeetingRetentionScheduler } from './meetings/retention.service';
import { startRecordingRetentionScheduler } from './recordings/retention.service';
import settingsRoutes from './routes/settings.routes';
import contactRoutes from './routes/contact.routes';

app.use('/api/auth', authRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/meetings', meetingRoutes);
app.use('/api/recordings', recordingRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/contacts', contactRoutes);
// Served under /api/ so it flows through the same nginx proxy rule as the rest of the API,
// with no extra reverse-proxy config needed -- see persistAvatarIfDataUri in avatarStorage.ts.
// Avatar URLs are included in Jitsi participant identity and may be rendered by the meeting
// frontend from a different local development origin (for example :5173 -> backend :4000).
// Helmet's default `Cross-Origin-Resource-Policy: same-origin` makes Chromium block that image
// with ERR_BLOCKED_BY_RESPONSE.NotSameOrigin.  This is intentionally scoped to public avatar
// files only; API responses and the other upload routes keep Helmet's default policy.
app.use('/api/uploads/avatars', express.static(getAvatarUploadRoot(), {
  setHeaders: (res) => res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'),
}));
// Same cross-origin issue as avatars above (and the same fix) -- chat images/voice notes/files
// are rendered inline in the meeting frontend exactly like avatars are, and were missed when that
// fix was first made: CONFIRMED BUG, reported as a chat image uploading successfully (server logs
// showed a clean 200 with the correct byte count) but never rendering -- the browser blocked the
// already-fetched response with ERR_BLOCKED_BY_RESPONSE.NotSameOrigin because Helmet's default
// Cross-Origin-Resource-Policy: same-origin applied to these routes too.
app.use('/api/uploads/chat-images', express.static(getChatImageUploadRoot(), {
  setHeaders: (res) => res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'),
}));
app.use('/api/uploads/chat-audios', express.static(getChatAudioUploadRoot(), {
  setHeaders: (res) => res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'),
}));
// Content-Disposition: attachment makes the browser download these rather than try to render
// them inline (a PDF or image would otherwise just open in a new tab) -- reliable regardless of
// whether the frontend's own <a download> attribute is honored for a cross-origin URL. The
// filename itself already comes from the URL path (chatFileStorage.ts stores each upload under
// its own real original filename), so this only needs to flip the disposition, not restate it.
app.use('/api/uploads/chat-files', express.static(getChatFileUploadRoot(), {
  setHeaders: (res) => {
    res.setHeader('Content-Disposition', 'attachment');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  },
}));

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

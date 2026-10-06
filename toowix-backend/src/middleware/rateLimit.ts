import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';
import type { AuthenticatedRequest } from './auth';

/**
 * Keys a limiter by the signed-in user rather than raw IP, so one user's heavy usage (or a buggy
 * client stuck in a retry loop) never throttles every other user behind the same IP/NAT (shared
 * office network, corporate VPN, etc). Every route this is used on sits behind verifyFirebaseToken
 * (which sets req.accountUser before calling next()), so the limiter must be registered AFTER that
 * middleware in each route's chain for this to see it. Falls back to IP only for the case this ever
 * runs ahead of auth or on an unauthenticated request -- that fallback goes through express-rate-
 * limit's own ipKeyGenerator helper (not a raw template string), which normalizes IPv6 addresses to
 * a /56 subnet; express-rate-limit v8 refuses to construct a limiter whose custom keyGenerator
 * touches req.ip without it (confirmed by actually running this: it throws ERR_ERL_KEY_GEN_IPV6 at
 * startup, not merely a lint warning).
 */
const keyByUserOrIp = (req: Request): string => {
  const userId = (req as AuthenticatedRequest).accountUser?.id;
  return typeof userId === 'string' && userId ? `user:${userId}` : ipKeyGenerator(req.ip ?? '');
};

/** Credential-adjacent endpoints (signup, login, forgot-password) -- where credential
 * stuffing, account enumeration, and password-reset-email spam abuse would land. Keyed by IP
 * (the default), since these are unauthenticated by definition. */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in a few minutes.' },
});

/** Meeting-passcode-adjacent endpoints (admission, lobby knock, RSVP) -- these are hit far
 * more often in ordinary use (every guest join polls/knocks), so the threshold is looser than
 * the auth limiter, but this still bounds per-IP brute-forcing of a meeting's passcode. */
export const meetingAccessRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down and try again shortly.' },
});

/** GET /api/notifications is the single most-polled endpoint in the app -- every open dashboard
 * tab polls it once every 20s by design (~3/min). 30/min per user gives a wide margin over that
 * normal rate while still bounding a runaway/looping client. Also covers the two mark-read routes,
 * which are user-click-driven and far rarer than the poll itself. */
export const notificationsRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUserOrIp,
  message: { error: 'Too many notification requests. Please slow down and try again shortly.' },
});

/** Settings tabs are explicit, user-click-driven saves (one per Save button press), not polled --
 * 20/min per user is generous for real usage and still bounds a buggy "save" loop. Applied to the
 * whole settings router (reads and writes alike) for one consistent rule across the whole surface. */
export const settingsRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUserOrIp,
  message: { error: 'Too many settings requests. Please slow down and try again shortly.' },
});

/** The user-initiated recordings routes (list, metadata, start-session, rename, delete) --
 * moderate traffic, 30/min per user. Deliberately NOT applied to /api/recordings/ingest (the
 * recorder/Jibri sidecar calls that via its own shared-secret auth, not a logged-in user, and its
 * real call frequency under load hasn't been measured here) or to /:id/stream (a browser scrubbing
 * or seeking a video issues many HTTP Range requests against that same URL in quick succession --
 * rate-limiting it the same way would break video playback, not just abuse). */
export const recordingsRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUserOrIp,
  message: { error: 'Too many recording requests. Please slow down and try again shortly.' },
});

/** Team and contacts management -- low-traffic, user-click-driven CRUD. 25/min per user covers
 * real usage (inviting/removing a few teammates or contacts in one sitting) with room to spare. */
export const teamRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 25,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUserOrIp,
  message: { error: 'Too many team requests. Please slow down and try again shortly.' },
});

export const contactsRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 25,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUserOrIp,
  message: { error: 'Too many contact requests. Please slow down and try again shortly.' },
});

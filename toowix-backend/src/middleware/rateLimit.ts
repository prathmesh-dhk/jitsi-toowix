import rateLimit from 'express-rate-limit';

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

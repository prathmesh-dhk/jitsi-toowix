// Internal service-to-service endpoint Mail's backend calls when a Mail admin logs out, so the
// SAME person's Meet session is also strictly revoked -- regardless of how either side's session
// was originally established (password or Keycloak). Authenticated by a static shared secret
// (INTERNAL_SERVICE_SECRET, see src/config/internalSso.ts), never a browser-facing credential.
import { Router, Request, Response, NextFunction } from 'express';
import { User } from '../models/User';
import { Session } from '../models/Session';
import { getFirebaseAuth } from '../config/firebase';
import { internalSsoConfig, isInternalSsoInboundConfigured } from '../config/internalSso';

export const internalSsoRouter = Router();

internalSsoRouter.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

function requireInternalSecret(req: Request, res: Response, next: NextFunction): void {
  if (!isInternalSsoInboundConfigured()) {
    res.status(503).json({ error: 'INTERNAL_SSO_NOT_CONFIGURED' });
    return;
  }
  const provided = req.get('X-Internal-Service-Key');
  if (!provided || provided !== internalSsoConfig.serviceSecret) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return;
  }
  next();
}

internalSsoRouter.post('/sessions/revoke-by-email', requireInternalSecret, async (req: Request, res: Response) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!email) {
    res.status(400).json({ error: 'INVALID_REQUEST', message: 'email is required' });
    return;
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      res.status(200).json({ revoked: false, reason: 'NO_SUCH_ACCOUNT' });
      return;
    }

    await Session.updateMany({ userId: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });

    try {
      await getFirebaseAuth().revokeRefreshTokens(user.firebaseUid);
    } catch (err: any) {
      // Session revocation above already blocks every subsequent request (verifyFirebaseToken
      // requires a matching, unrevoked Session row) -- this is defense in depth, not the only gate.
      console.warn('[Internal SSO] Could not revoke Firebase refresh tokens:', err?.message || 'unknown error');
    }

    res.status(200).json({ revoked: true });
  } catch (err: any) {
    console.error('[Internal SSO] revoke-by-email failed:', err?.message || 'unknown error');
    res.status(503).json({ error: 'REVOKE_UNAVAILABLE' });
  }
});

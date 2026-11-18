// OIDC Back-Channel Logout 1.0 receiver: Keycloak itself POSTs here whenever the SSO session for
// a user linked to the `toowix-meet` client ends -- by ANY means (this app's own logout,
// Keycloak's Account Console, an admin revoking a session, or SSO session expiry), not only when
// our own /api/auth/logout route was called. This is what makes "logout kills the session
// everywhere" true even when a user never touched either app's own logout button.
//
// Public by necessity (Keycloak is the caller, not a browser, and carries no app session or the
// shared internal-SSO secret internal-sso.routes.ts expects) -- authenticity comes entirely from
// the Logout Token's cryptographic signature (verifyKeycloakLogoutToken), never a shared secret
// or IP allow-list. Spec: https://openid.net/specs/openid-connect-backchannel-1_0.html section 2.6.
import { Router, Request, Response } from 'express';
import { User } from '../models/User';
import { Session } from '../models/Session';
import { getFirebaseAuth } from '../config/firebase';
import { verifyKeycloakLogoutToken } from '../middleware/keycloakAuth';
import { revokeMailSessionsByEmail } from '../lib/mailSsoClient';

export const keycloakBackchannelLogoutRouter = Router();

keycloakBackchannelLogoutRouter.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

keycloakBackchannelLogoutRouter.post('/', async (req: Request, res: Response) => {
  const logoutToken = typeof req.body?.logout_token === 'string' ? req.body.logout_token : '';
  if (!logoutToken) {
    res.status(400).json({ error: 'invalid_request' });
    return;
  }

  let verified: { sub?: string; sid?: string };
  try {
    verified = await verifyKeycloakLogoutToken(logoutToken);
  } catch (error: any) {
    console.warn('[Keycloak Backchannel Logout] Rejected logout token:', error?.message || 'unknown error');
    res.status(400).json({ error: 'invalid_token' });
    return;
  }

  try {
    if (verified.sub) {
      const user = await User.findOne({ keycloakSub: verified.sub });
      if (user) {
        await Session.updateMany({ userId: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
        try {
          await getFirebaseAuth().revokeRefreshTokens(user.firebaseUid);
        } catch (err: any) {
          console.warn('[Keycloak Backchannel Logout] Could not revoke Firebase refresh tokens:', err?.message || 'unknown error');
        }
        if (user.email) void revokeMailSessionsByEmail(user.email);
      }
    }
    // Per spec section 2.6: respond 200 with no body on success.
    res.status(200).end();
  } catch (error: any) {
    console.error('[Keycloak Backchannel Logout] Failed to process logout token:', error?.message || 'unknown error');
    res.status(503).json({ error: 'temporarily_unavailable' });
  }
});

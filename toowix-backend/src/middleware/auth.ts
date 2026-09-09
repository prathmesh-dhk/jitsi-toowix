import { Request, Response, NextFunction } from 'express';
import { User } from '../models/User';
import { Company } from '../models/Company';
import { Session } from '../models/Session';
import { getFirebaseAuth } from '../config/firebase';

export interface AuthenticatedRequest extends Request {
  accountUser?: Record<string, unknown>;
  firebaseUid?: string;
  firebaseEmail?: string;
  firebaseEmailVerified?: boolean;
}

/**
 * Middleware: Verifies Firebase ID token from Authorization header.
 * Attaches decoded uid, email, and email_verified to req.
 */
export const verifyIdentityToken = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;
  // A <video> tag can't attach an Authorization header, so the streaming route accepts
  // the token as ?token=... too. Every other route still requires the header.
  const queryToken = typeof req.query.token === 'string' ? req.query.token : undefined;

  if ((!authHeader || !authHeader.startsWith('Bearer ')) && !queryToken) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const idToken = queryToken || authHeader!.split('Bearer ')[1];

  try {
    const auth = getFirebaseAuth();
    const decodedToken = await auth.verifyIdToken(idToken, true);

    req.firebaseUid = decodedToken.uid;
    req.firebaseEmail = decodedToken.email;
    req.firebaseEmailVerified = decodedToken.email_verified;

    next();
  } catch (error: any) {
    console.error('[Auth Middleware] Firebase token verification failed:', error.message);
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }
};

/** Application authorization is re-evaluated on every protected request. */
export const verifyFirebaseToken = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  await verifyIdentityToken(req, res, async () => {
    try {
      const user = await User.findOne({ firebaseUid: req.firebaseUid });
      if (!user || user.status !== 'ACTIVE' || user.forcePasswordReset || !(req.firebaseEmailVerified || user.emailVerifiedAt)) {
        res.status(403).json({ error: 'Account is not authorized' }); return;
      }
      if (user.companyId && user.role !== 'SUPER_ADMIN') {
        const company = await Company.findById(user.companyId);
        if (!company || company.status !== 'ACTIVE') {
          res.status(403).json({ error: 'Workspace is not active' }); return;
        }
      }
      const sessionToken = req.get('X-Toowix-Session');
      const session = sessionToken && await Session.findOne({ userId: user._id, sessionToken, revokedAt: null, createdAt: { $gt: new Date(Date.now() - 30 * 86400000) } });
      if (!session) { res.status(401).json({ error: 'Application session expired or revoked. Sign in again.' }); return; }
      req.accountUser = { id: String(user._id), name: user.fullName, email: user.email, role: user.role, companyId: user.companyId ? String(user.companyId) : null, avatarUrl: user.avatarUrl };
      next();
    } catch {
      res.status(503).json({ error: 'Authorization temporarily unavailable' });
    }
  });
};

export const optionalAccount = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  if (req.headers.authorization) void verifyFirebaseToken(req, res, next);
  else next();
};

import { Request, Response, NextFunction } from 'express';
import { getFirebaseAuth } from '../config/firebase';

export interface AuthenticatedRequest extends Request {
  firebaseUid?: string;
  firebaseEmail?: string;
  firebaseEmailVerified?: boolean;
}

/**
 * Middleware: Verifies Firebase ID token from Authorization header.
 * Attaches decoded uid, email, and email_verified to req.
 */
export const verifyFirebaseToken = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const idToken = authHeader.split('Bearer ')[1];

  try {
    const auth = getFirebaseAuth();
    const decodedToken = await auth.verifyIdToken(idToken);

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

import * as admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

let firebaseApp: admin.app.App | null = null;

export const initializeFirebase = (): admin.app.App => {
  if (firebaseApp) {
    return firebaseApp;
  }

  if (admin.apps.length > 0) {
    firebaseApp = admin.apps[0]!;
    return firebaseApp;
  }

  const serviceAccountPath =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    path.resolve(process.cwd(), 'serviceAccountKey.json');

  if (fs.existsSync(serviceAccountPath)) {
    try {
      const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      console.log('[Firebase Admin] Initialized with service account JSON file.');
      return firebaseApp;
    } catch (err: any) {
      console.warn('[Firebase Admin] Failed reading serviceAccountKey.json:', err.message);
    }
  }

  const projectId = process.env.FIREBASE_PROJECT_ID || 'toowix-meet-ff587';
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (privateKey) {
    // Handle both escaped newlines ("\n") and literal newlines, plus wrapping quotes
    privateKey = privateKey.replace(/^["']|["']$/g, '').replace(/\\n/g, '\n');
  }

  if (clientEmail && privateKey && privateKey.includes('BEGIN PRIVATE KEY')) {
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
    console.log('[Firebase Admin] Initialized with cert credentials.');
  } else {
    // Default application credentials / mock credentials for local setup
    console.warn(
      '[Firebase Admin] Note: Valid RSA private key not found in FIREBASE_PRIVATE_KEY or serviceAccountKey.json. Falling back to default project init.'
    );
    firebaseApp = admin.initializeApp({
      projectId,
    });
  }

  return firebaseApp;
};

export const getFirebaseAuth = (): admin.auth.Auth => {
  const app = initializeFirebase();
  return app.auth();
};

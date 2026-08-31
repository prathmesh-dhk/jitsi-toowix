import * as admin from 'firebase-admin';
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

  const projectId = process.env.FIREBASE_PROJECT_ID || 'toowix-meet';
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined;

  if (clientEmail && privateKey) {
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
  } else {
    // Default application credentials / mock credentials for local setup
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

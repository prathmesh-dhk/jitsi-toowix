// Test fixture for scripts/test-website.mjs.
//   setup    -> creates a temporary session + Firebase ID token for an existing user and a few temporary
//               meetings, and prints them as JSON.
//   teardown -> removes everything the setup created (matched by the "twx-e2e-" slug prefix, the test
//               session token prefix and the "@e2e.invalid" contact domain).
// Usage: npx ts-node --transpile-only src/scripts/e2e-fixture.ts <setup|teardown> [email]
import crypto from 'crypto';
import { connectDatabase, disconnectDatabase } from '../db/connection';
import { Meeting } from '../models/Meeting';
import { User } from '../models/User';
import { Session } from '../models/Session';
import { Contact } from '../models/Contact';
import { getFirebaseAuth } from '../config/firebase';

const SLUG_PREFIX = 'twx-e2e-';
const SESSION_PREFIX = 'e2e-session-';
const out = (obj: unknown) => process.stdout.write(`__FIXTURE__${JSON.stringify(obj)}\n`);
const rand = () => crypto.randomBytes(3).toString('hex');

async function mintIdToken(uid: string): Promise<string> {
  const apiKey = process.env.E2E_FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;

  if (!apiKey) {
    throw new Error('Set E2E_FIREBASE_API_KEY (the public Firebase web API key) to run authenticated tests.');
  }
  const customToken = await getFirebaseAuth().createCustomToken(uid);
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true })
  });
  const data: any = await res.json();

  if (!res.ok || !data.idToken) {
    throw new Error(`Could not exchange custom token: ${data?.error?.message || res.status}`);
  }

  return data.idToken;
}

async function setup(email: string) {
  const user: any = await User.findOne({ email: email.toLowerCase() });

  if (!user) {
    throw new Error(`No Toowix user with email ${email}`);
  }
  const sessionToken = SESSION_PREFIX + crypto.randomBytes(12).toString('hex');

  await Session.create({ userId: user._id, sessionToken, userAgent: 'toowix-e2e', ipAddress: '127.0.0.1' });
  const idToken = await mintIdToken(user.firebaseUid);
  const soon = new Date(Date.now() + 60 * 60 * 1000);
  const base = { companyId: user.companyId || null, createdBy: user._id, scheduledAt: soon, durationMinutes: 60 };
  const publicSlug = `${SLUG_PREFIX}pub-${rand()}`;
  const privateSlug = `${SLUG_PREFIX}prv-${rand()}`;
  const rsvpSlug = `${SLUG_PREFIX}rsv-${rand()}`;
  const lockSlug = `${SLUG_PREFIX}lck-${rand()}`;
  const [ pub, prv, rsv, lck ]: any[] = await Meeting.create([
    { ...base, name: 'E2E public', roomSlug: publicSlug, type: 'Guest' },
    { ...base, name: 'E2E private', roomSlug: privateSlug, type: 'Private', passcode: 'pw-e2e' },
    { ...base, name: 'E2E rsvp', roomSlug: rsvpSlug, type: 'Guest', invitees: [ 'invitee@e2e.invalid' ], rsvps: [ { email: 'invitee@e2e.invalid', status: 'pending' } ] },
    { ...base, name: 'E2E lock', roomSlug: lockSlug, type: 'Guest', hostJoined: true }
  ]);

  out({
    email: user.email,
    userId: String(user._id),
    idToken,
    sessionToken,
    meetings: {
      public: { id: String(pub._id), slug: publicSlug },
      private: { id: String(prv._id), slug: privateSlug, password: 'pw-e2e' },
      rsvp: { id: String(rsv._id), slug: rsvpSlug, invitee: 'invitee@e2e.invalid' },
      lock: { id: String(lck._id), slug: lockSlug }
    }
  });
}

async function teardown() {
  const meetings = await Meeting.deleteMany({ roomSlug: { $regex: `^${SLUG_PREFIX}` } });
  const sessions = await Session.deleteMany({ sessionToken: { $regex: `^${SESSION_PREFIX}` } });
  const contacts = await Contact.deleteMany({ email: { $regex: '@e2e\\.invalid$' } });

  out({ meetings: meetings.deletedCount, sessions: sessions.deletedCount, contacts: contacts.deletedCount });
}

(async () => {
  const cmd = process.argv[2];

  await connectDatabase();
  try {
    if (cmd === 'setup') {
      await setup(process.argv[3] || 'jayeshchaudhary45454@gmail.com');
    } else if (cmd === 'teardown') {
      await teardown();
    } else {
      throw new Error('Usage: e2e-fixture.ts <setup|teardown> [email]');
    }
  } finally {
    await disconnectDatabase();
  }
  process.exit(0);
})().catch((err) => {
  process.stderr.write(`FIXTURE_ERROR ${err.message}\n`);
  process.exit(1);
});

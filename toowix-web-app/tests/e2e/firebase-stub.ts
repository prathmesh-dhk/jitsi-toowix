// Test-only stand-in for src/lib/firebase.ts, swapped in by vite.chat-e2e.config.mjs ONLY for the
// browser test harness. The real chat UI, hook, API client and streaming code run unmodified; only
// the identity source is faked: the "ID token" is the test's own `token-<uid>` that the test backend
// accepts. It never ships: the real app's vite.config.ts does not reference this file.
export const auth = {
  get currentUser() {
    const uid = localStorage.getItem('e2e_uid');

    return uid ? { getIdToken: async () => `token-${uid}` } : null;
  },
  authStateReady: async () => undefined,
};

export default {};

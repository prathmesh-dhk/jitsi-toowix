const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// P1-8 fix: resolvePrejoinEndedDestination and isUnavailableMeetingResponse moved verbatim from
// MeetingRoomPage.tsx into useMeetingMetadata.ts (the plan's own "refactor without changing
// behavior" bar) -- this locks in their exact behavior so a future edit to either can't silently
// drift. The React hook itself (useMeetingMetadata) isn't unit-tested here -- it's exercised live
// (same as the rest of MeetingRoomPage.tsx's hooks), this only covers the two pure functions.
const source = fs.readFileSync(path.join(__dirname, '../src/lib/useMeetingMetadata.ts'), 'utf8')
  .replace(/import\.meta/g, '__importMeta');
const code = `const __importMeta = { env: {} };\n` + ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;
const exportsObject = {};
// useMeetingMetadata.ts imports './firebase' and './jitsi/ensureLibJitsiMeetLoaded', which this
// vm context never calls into (neither pure function under test touches them) -- a lightweight
// require shim is enough to let the module evaluate without pulling in real Firebase/DOM setup.
const fakeRequire = (id) => {
  if (id === './firebase') return { auth: {} };
  if (id === './jitsi/ensureLibJitsiMeetLoaded') return { ensureLibJitsiMeetLoaded: async () => {} };
  if (id === './meeting-id') return { getMeetingUrl: (roomId) => `http://localhost/${roomId}` };
  return require(id);
};
vm.runInNewContext(code, { exports: exportsObject, require: fakeRequire, module: { exports: exportsObject } });

const { resolvePrejoinEndedDestination, isUnavailableMeetingResponse } = exportsObject;

test('resolvePrejoinEndedDestination reads the closed-enum reason/endReason field across all three real shapes', () => {
  assert.equal(resolvePrejoinEndedDestination({ reason: 'LINK_EXPIRED' }), '/meeting-link-expired');
  assert.equal(resolvePrejoinEndedDestination({ endReason: 'LINK_EXPIRED' }), '/meeting-link-expired');
  assert.equal(resolvePrejoinEndedDestination({ meeting: { endReason: 'LINK_EXPIRED' } }), '/meeting-link-expired');

  assert.equal(resolvePrejoinEndedDestination({ reason: 'HOST_ENDED' }), '/meeting-ended');
  assert.equal(resolvePrejoinEndedDestination({ reason: 'DURATION_LIMIT' }), '/meeting-ended');

  assert.equal(resolvePrejoinEndedDestination({}), null);
  assert.equal(resolvePrejoinEndedDestination(null), null);
  assert.equal(resolvePrejoinEndedDestination({ reason: 'SOMETHING_ELSE' }), null);
});

test('isUnavailableMeetingResponse matches unavailable-link statuses and the cancelled/ended/not-found 403 message pattern', () => {
  assert.equal(isUnavailableMeetingResponse(400), true);
  assert.equal(isUnavailableMeetingResponse(404), true);
  assert.equal(isUnavailableMeetingResponse(410), true);
  assert.equal(isUnavailableMeetingResponse(403, 'Meeting has already ended'), true);
  assert.equal(isUnavailableMeetingResponse(403, 'This meeting was cancelled'), true);
  assert.equal(isUnavailableMeetingResponse(403, 'Room not found'), true);

  // A real access-policy failure (e.g. sign-in required) must stay in the lobby, not redirect to
  // the expired-link page.
  assert.equal(isUnavailableMeetingResponse(403, 'Sign in to join this private meeting'), false);
  assert.equal(isUnavailableMeetingResponse(200), false);
  assert.equal(isUnavailableMeetingResponse(401), false);
});

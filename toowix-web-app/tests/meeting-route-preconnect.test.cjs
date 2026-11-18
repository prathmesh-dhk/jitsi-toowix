const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadModule(relPath) {
  // import.meta isn't valid in a CommonJS-transpiled vm script -- stand in a plain object so
  // unrelated code in the same file (getMeetingUrl's own import.meta.env.VITE_APP_URL read) can
  // still parse/transpile; nothing under test here touches it.
  const source = fs.readFileSync(path.join(__dirname, relPath), 'utf8').replace(/import\.meta/g, '__importMeta');
  const code = `const __importMeta = { env: {} };\n` + ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
  const exportsObject = {};
  vm.runInNewContext(code, { exports: exportsObject });
  return exportsObject;
}

// P1-6 fix: main.tsx only preconnects to the Jitsi host on a page load that's already a meeting
// route -- this is the one piece of that decision with real logic worth unit-testing (the actual
// <link> injection is a thin DOM call, exercised live, not here).
test('isMeetingRoutePathname recognizes every real meeting route and rejects ordinary pages', () => {
  const { isMeetingRoutePathname, generateUniqueMeetingId } = loadModule('../src/lib/meeting-id.ts');
  const autoId = generateUniqueMeetingId();

  assert.equal(isMeetingRoutePathname('/meet/some-custom-slug'), true);
  assert.equal(isMeetingRoutePathname('/instant/instant-abc-def-ghi'), true);
  assert.equal(isMeetingRoutePathname('/meet-direct/some-custom-slug'), true);
  assert.equal(isMeetingRoutePathname(`/${autoId}`), true);

  assert.equal(isMeetingRoutePathname('/'), false);
  assert.equal(isMeetingRoutePathname('/login'), false);
  assert.equal(isMeetingRoutePathname('/dashboard'), false);
  assert.equal(isMeetingRoutePathname('/settings/meetings'), false);
  // A bare top-level path that isn't our own auto-generated slug shape must NOT be treated as a
  // meeting route (that's exactly what BareRoomRoute itself re-checks server/client-side too).
  assert.equal(isMeetingRoutePathname('/not-a-real-room-id'), false);
});

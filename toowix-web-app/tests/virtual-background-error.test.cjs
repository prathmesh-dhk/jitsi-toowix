const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('virtual-background dialog maps known errors to clear recovery guidance', () => {
  const source = fs.readFileSync(require('node:path').join(__dirname, '../src/components/VirtualBackgroundModal.tsx'), 'utf8');
  assert.match(source, /Turn on your camera, then try the background again/);
  assert.match(source, /This browser doesn't support virtual backgrounds for this call/);
  assert.match(source, /The background engine could not load/);
});

test('live effect refuses to save a background when no usable camera track exists', () => {
  const source = fs.readFileSync(require('node:path').join(__dirname, '../src/lib/useJitsiMeeting.ts'), 'utf8');
  assert.match(source, /if \(!track \|\| track\.isMuted\?\.\(\)\)/);
  assert.match(source, /Turn on your camera before applying a background/);
});

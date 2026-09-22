const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('removes only the legacy Jitsi pwa worker on app startup', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/main.tsx'), 'utf8');
  assert.match(source, /navigator\.serviceWorker\.getRegistrations/);
  assert.match(source, /url\.includes\('\/pwa-worker\.js'\)/);
  assert.match(source, /registration\.unregister\(\)/);
  assert.match(source, /caches\.delete\('offline'\)/);
});

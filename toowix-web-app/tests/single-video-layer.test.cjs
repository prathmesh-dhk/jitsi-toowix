const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'useJitsiMeeting.ts'), 'utf8');

assert.match(source, /const SEND_SINGLE_VIDEO_LAYER = true;/, 'camera must be sent as one layer (no SIM group)');
assert.equal(
  (source.match(/disableSimulcast: SEND_SINGLE_VIDEO_LAYER/g) || []).length,
  2,
  'both the connection and conference options must disable simulcast'
);

console.log('PASS third participant no longer receives a SIM-group offer (single video layer)');

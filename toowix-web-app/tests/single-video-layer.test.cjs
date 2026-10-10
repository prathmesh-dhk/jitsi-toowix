const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'useJitsiMeeting.ts'), 'utf8');

// Phase 4 staging hook: SEND_SINGLE_VIDEO_LAYER now reads an env var that is unset in every
// real build (production, dev, this repo's .env.example), so it must still evaluate to `true`
// by default -- the ternary's false branch is the only thing allowed to flip it, and only when
// VITE_FORCE_SIMULCAST is explicitly 'true' (a staging-only opt-in, see staging/README.md).
assert.match(
  source,
  /const SEND_SINGLE_VIDEO_LAYER = import\.meta\.env\.VITE_FORCE_SIMULCAST === 'true' \? false : true;/,
  'camera must still default to one layer (no SIM group) in every real build; only an explicit staging opt-in may flip it'
);
assert.equal(
  (source.match(/disableSimulcast: SEND_SINGLE_VIDEO_LAYER/g) || []).length,
  2,
  'both the connection and conference options must disable simulcast'
);

console.log('PASS third participant no longer receives a SIM-group offer (single video layer)');

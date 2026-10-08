const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('dominant remote speaker clears a stale remote muted state', () => {
  // The DOMINANT_SPEAKER_CHANGED listener (along with the rest of the conference event wiring)
  // was extracted out of useJitsiMeeting.ts into its own module during the Track 3 split.
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/jitsi/useConferenceEvents.ts'), 'utf8');
  assert.match(source, /DOMINANT_SPEAKER_CHANGED[\s\S]{0,1200}id !== room\.myUserId\(\)/);
  assert.match(source, /DOMINANT_SPEAKER_CHANGED[\s\S]{0,1600}prev\[id\]\?\.muted/);
  assert.match(source, /DOMINANT_SPEAKER_CHANGED[\s\S]{0,1800}muted: false/);
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Real reported bug: reconnecting a Bluetooth mic "took time, not fast". A device that has just
// (re)connected often isn't fully handed off by the OS yet, so the very first getUserMedia
// attempt can throw a transient NotReadableError/TrackStartError -- createLocalTrackWithRetry
// exists exactly for that case, but its backoff between attempts (400ms, then 800ms) was pure
// dead time stacked on top of the devicechange settle delay, and was a real, avoidable
// contributor to a reconnect feeling slow. This is a static regression guard, same pattern as
// tests/device-change-debounce.test.cjs -- the function itself isn't unit-testable directly (it
// calls the real, globally-loaded JitsiMeetJS.createLocalTracks).
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'useJitsiMeeting.ts'), 'utf8');

assert.match(
    source,
    /async function createLocalTrackWithRetry\(JitsiMeetJS: any, options: any, attempts = 3\): Promise<any> \{/,
    'the retry helper must still exist with the same signature'
);
assert.match(
    source,
    /if \(i > 0\) \{\s*\n\s*await delay\(150 \* i\);\s*\n\s*\}/,
    'retry backoff must be the shortened 150ms/300ms, not the earlier 400ms/800ms, so a transient device-busy error on reconnect does not add unnecessary delay'
);
assert.doesNotMatch(source, /await delay\(400 \* i\);/, 'must not still use the old, slower 400ms-per-attempt backoff');

console.log('PASS device reconnect retry backoff is shortened (150ms/300ms), not the original slower 400ms/800ms');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'useJitsiMeeting.ts'), 'utf8');

assert.match(source, /lowDataMode !== 'auto' \|\| manualMaxHeightRef\.current !== null/, 'baseline only in auto mode without a manual cap');
assert.match(source, /room\.setReceiverConstraints\(\{ lastN: policy\.lastN, defaultConstraints: \{ maxHeight: height \} \}\)/, 'defaultConstraints.maxHeight must reach the bridge');
assert.match(source, /getMediaQualityPolicy\('auto', 'GOOD', remoteParticipantCount \+ 1/, 'baseline uses the auto/GOOD policy');

console.log('PASS normal mode asks the bridge for a real max video height (not the 180p default)');

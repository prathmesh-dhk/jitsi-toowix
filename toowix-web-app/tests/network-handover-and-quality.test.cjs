const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'src', 'lib');
const hook = fs.readFileSync(path.join(root, 'useJitsiMeeting.ts'), 'utf8');
const policy = fs.readFileSync(path.join(root, 'networkQuality.ts'), 'utf8');

assert.match(hook, /p2p: \{ \.\.\.\(config\.p2p \|\| \{\}\), enabled: false \}/, 'meeting transport must stay on JVB when another participant joins');
assert.match(hook, /HIGH_BANDWIDTH_VIDEO_KBPS = 2500/, 'high-quality video must require a real bandwidth estimate');
assert.match(hook, /await applyMediaQualityPolicy\(next\)/, 'stable GOOD state must still react to bandwidth changes');
assert.match(policy, /highBandwidth = false/, 'policy must support a bandwidth-aware quality tier');
assert.match(policy, /const use1080pCamera = highBandwidth && participantCount <= 4/, '1080p must be limited to healthy small calls');

console.log('PASS stable bridge transport and bandwidth-aware video policy');

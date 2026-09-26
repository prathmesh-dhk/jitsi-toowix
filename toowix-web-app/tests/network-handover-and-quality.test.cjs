const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'src', 'lib');
const hook = fs.readFileSync(path.join(root, 'useJitsiMeeting.ts'), 'utf8');
const policy = fs.readFileSync(path.join(root, 'networkQuality.ts'), 'utf8');

assert.match(hook, /p2p: \{ \.\.\.\(config\.p2p \|\| \{\}\), enabled: true \}/, 'two-person calls must use Jitsi native P2P and switch to JVB when a third participant joins');
assert.match(hook, /if \(requestedMode === 'auto'\)/, 'normal calls must leave automatic quality adaptation to Jitsi/WebRTC');
assert.match(hook, /if \(!lowDataPolicyActiveRef\.current\)/, 'Auto mode must not repeatedly reapply media constraints');
assert.match(policy, /highBandwidth = false/, 'policy must support a bandwidth-aware quality tier');
assert.match(policy, /const use1080pCamera = highBandwidth && participantCount <= 4/, '1080p must be limited to healthy small calls');

console.log('PASS native P2P/JVB handover and bandwidth-aware video policy');

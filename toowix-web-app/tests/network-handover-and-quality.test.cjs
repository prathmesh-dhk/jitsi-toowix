const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'src', 'lib');
const hook = fs.readFileSync(path.join(root, 'useJitsiMeeting.ts'), 'utf8');
const policy = fs.readFileSync(path.join(root, 'networkQuality.ts'), 'utf8');

assert.match(hook, /p2p: \{ \.\.\.\(config\.p2p \|\| \{\}\), enabled: false \}/, 'calls must stay JVB-routed to avoid P2P-to-JVB renegotiation failures');
assert.match(hook, /https:\/\/\$\{jitsiDomain\}\/libs\/lib-jitsi-meet\.min\.js/, 'meeting client must load lib-jitsi-meet from the active Jitsi server release');
assert.match(hook, /runSerializedRoomOperation\(async \(\) => \{[\s\S]*?await myRoom\.addTrack\(track\)/, 'initial audio and camera tracks must use the serialized SDP negotiation queue');
assert.match(hook, /normalizedError\.includes\('offeranswerfailed'\)/, 'offer/answer failures must receive one controlled recovery attempt');
assert.match(hook, /if \(requestedMode === 'auto'\)/, 'normal calls must leave automatic quality adaptation to Jitsi/WebRTC');
assert.match(hook, /if \(!lowDataPolicyActiveRef\.current\)/, 'Auto mode must not repeatedly reapply media constraints');
assert.match(policy, /highBandwidth = false/, 'policy must support a bandwidth-aware quality tier');
assert.match(policy, /const use1080pCamera = highBandwidth && participantCount <= 4/, '1080p must be limited to healthy small calls');

console.log('PASS stable JVB-only routing and bandwidth-aware video policy');

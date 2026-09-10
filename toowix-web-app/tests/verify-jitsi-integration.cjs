// Static verification that the production build wires custom controls to the real Jitsi
// conference (IFrame API) instead of a parallel/fake media implementation, and that the
// domain fix (meet.toowix.com -> talk.toowix.com) hasn't regressed. Runs against the built
// dist/ bundle, so it must be run after `npm run build`.
//
// Usage: npm run build && node tests/verify-jitsi-integration.cjs

const fs = require('node:fs');
const path = require('node:path');

const distAssets = path.join(__dirname, '..', 'dist', 'assets');

function readBundle() {
  if (!fs.existsSync(distAssets)) {
    throw new Error('dist/assets not found -- run `npm run build` first');
  }
  const jsFiles = fs.readdirSync(distAssets).filter((f) => f.endsWith('.js'));
  if (jsFiles.length === 0) throw new Error('No built JS bundle found in dist/assets');
  return jsFiles.map((f) => fs.readFileSync(path.join(distAssets, f), 'utf8')).join('\n');
}

const checks = [
  {
    name: 'Real Jitsi screen-share command is wired (toggleShareScreen)',
    test: (bundle) => bundle.includes('toggleShareScreen'),
  },
  {
    name: 'No leftover custom RTCPeerConnection screen-share mesh',
    test: (bundle) => !/getDisplayMedia/.test(bundle),
  },
  {
    name: 'Real Jitsi device-switching APIs are wired',
    test: (bundle) =>
      bundle.includes('setAudioInputDevice') &&
      bundle.includes('setVideoInputDevice') &&
      bundle.includes('setAudioOutputDevice') &&
      bundle.includes('getAvailableDevices'),
  },
  {
    name: 'Required Jitsi conference event listeners are present',
    test: (bundle) =>
      [
        'audioMuteStatusChanged',
        'videoMuteStatusChanged',
        'screenSharingStatusChanged',
        'participantJoined',
        'participantLeft',
        'participantMuted',
        'videoConferenceJoined',
        'videoConferenceLeft',
        'readyToClose',
        'errorOccurred',
      ].every((evt) => bundle.includes(evt)),
  },
  {
    name: 'Leave/end-for-everyone use real Jitsi commands (hangup/endConference)',
    test: (bundle) => bundle.includes('hangup') && bundle.includes('endConference'),
  },
  {
    name: 'Jitsi domain default is the production domain (talk.toowix.com), not the stale one',
    test: (bundle) => {
      const hasStale = /meet\.toowix\.com/.test(bundle);
      const hasCorrect = /talk\.toowix\.com/.test(bundle);
      return hasCorrect && !hasStale;
    },
  },
];

let failed = 0;
const bundle = readBundle();
for (const check of checks) {
  const ok = check.test(bundle);
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${check.name}`);
  if (!ok) failed++;
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll static Jitsi-integration checks passed.');

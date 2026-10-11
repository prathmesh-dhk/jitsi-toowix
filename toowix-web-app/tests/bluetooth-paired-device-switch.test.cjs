const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Requirement: AirPods (and other Bluetooth headsets exposing a paired mic + speaker) must switch
// BOTH input and output together as one coordinated operation, matched by groupId so two unrelated
// newly-appeared devices in the same burst are never mistaken for a pair. The independent per-kind
// fallback (tests/auto-switch-new-device.test.cjs) must still exist unchanged for devices that
// don't expose a shared groupId (e.g. a mic-only device, or a browser with inconsistent groupId
// support). This is a static regression guard, same pattern as the rest of this test suite --
// refresh() closes over MeetingRoomPage.tsx's component state and only runs against real browser
// device APIs inside a mounted page.
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'MeetingRoomPage.tsx'), 'utf8');

assert.match(
    source,
    /const pairedIn = newAudioInputs\.find\(\s*\n\s*\(inDev\) => inDev\.groupId && newAudioOutputs\.some\(\(outDev\) => outDev\.groupId === inDev\.groupId\)\s*\n\s*\);/,
    'must match a newly-appeared input and output device by groupId before treating them as one physical headset'
);
assert.match(
    source,
    /const pairedOut = pairedIn \? newAudioOutputs\.find\(\(outDev\) => outDev\.groupId === pairedIn\.groupId\) : undefined;/,
    'must resolve the paired output device from the same groupId as the paired input'
);
assert.match(
    source,
    /if \(pairedIn && pairedOut && !audioId && !outputId\) \{/,
    'the coordinated paired switch must never fire over an explicit user-selected device (audioId/outputId non-empty)'
);
assert.match(
    source,
    /if \(pairedIn && pairedOut && !audioId && !outputId\) \{[\s\S]{0,600}void attemptAudioInputSwitch\(pairedIn, 'paired-groupId'\);\s*\n\s*void attemptAudioOutputSwitch\(pairedOut, 'paired-groupId'\);/,
    'a genuine pair must switch both input and output together, EACH gated on its own confirmed success (see auto-switch-new-device.test.cjs for why optimistic state commit was a real bug)'
);

// The independent per-kind fallback (used when no groupId pairing is found -- a mic-only device,
// or a browser without reliable groupId support) must still exist, so devices that previously
// worked keep working unchanged.
assert.match(
    source,
    /if \(newAudioIn && !audioId\) \{\s*\n\s*void attemptAudioInputSwitch\(newAudioIn, 'independent'\);/,
    'the independent microphone auto-switch fallback must still exist for unpaired devices'
);
assert.match(
    source,
    /if \(newAudioOut && !outputId\) \{\s*\n\s*void attemptAudioOutputSwitch\(newAudioOut, 'independent'\);/,
    'the independent speaker auto-switch fallback must still exist for unpaired devices'
);

// Safari has never shipped HTMLMediaElement.setSinkId, so an automatic speaker switch silently
// does nothing there today -- requirement: never fail silently, detect by FEATURE (not browser
// name, which can't be trusted and would rot), and tell the person what to do instead.
assert.match(
    source,
    /const audioOutputSwitchSupported = typeof HTMLMediaElement !== 'undefined'\s*\n\s*&& typeof \(HTMLMediaElement\.prototype as any\)\.setSinkId === 'function';/,
    'must feature-detect setSinkId support, not sniff the browser/user-agent string'
);
assert.doesNotMatch(
    source.slice(source.indexOf('audioOutputSwitchSupported'), source.indexOf('audioOutputSwitchSupported') + 2000),
    /navigator\.userAgent/,
    'the output-support check must not fall back to user-agent sniffing'
);
assert.match(
    source,
    /if \(audioOutputSwitchSupported\) return;\s*\n\s*setParticipantToast\(.Microphone switched automatically\./,
    'must show a toast when an automatic speaker switch is attempted but unsupported, instead of failing silently'
);
assert.match(
    source,
    /support automatic speaker switching -- please select the speaker manually/,
    'the unsupported-output message must tell the person what to do instead, not just that it failed'
);
assert.match(
    source,
    /setTimeout\(\(\) => setParticipantToast\(\(t\) => \(t\?\.startsWith\('Microphone switched automatically'\) \? null : t\)\), 7000\);/,
    'the unsupported-output warning must auto-clear itself, matching the existing toast pattern, not persist forever'
);

console.log('PASS Bluetooth paired mic+speaker auto-switch: groupId-matched coordinated switch, independent fallback preserved, unsupported-output warning');

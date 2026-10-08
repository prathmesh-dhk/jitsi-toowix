const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Real reported bug: connecting a Bluetooth headset made the mic look like it was
// "disconnecting and reconnecting again and again". A Bluetooth device's OS pairing/profile
// handshake (HFP <-> A2DP) fires several `devicechange` events within a couple hundred
// milliseconds, and the device can briefly vanish from enumerateDevices() and reappear
// mid-handshake -- running the device-list `refresh()` immediately on every one of those events
// (no debounce) meant a single BT connection could be seen as "disappeared" then "new" several
// times in a row, each a real track replaceTrack(). This isn't unit-testable directly (refresh()
// closes over a large amount of component state inside MeetingRoomPage.tsx and only runs inside a
// mounted component against the real browser device APIs) -- this is a static regression guard
// for the debounce itself, same pattern as tests/background-sender-hysteresis.test.cjs.
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'MeetingRoomPage.tsx'), 'utf8');

assert.match(
    source,
    /let debounceTimer: ReturnType<typeof setTimeout> \| null = null;\s*\n\s*const debouncedRefresh = \(\) => \{/,
    'must debounce the device-list refresh triggered by devicechange events, not run it immediately on every event'
);
assert.match(
    source,
    /navigator\.mediaDevices\?\.addEventListener\('devicechange', debouncedRefresh\)/,
    'the devicechange listener must be the debounced wrapper, not the raw refresh function (a raw refresh() per event is exactly what reacted to a mid-Bluetooth-handshake blip as a real disconnect)'
);
assert.match(
    source,
    /navigator\.mediaDevices\?\.removeEventListener\('devicechange', debouncedRefresh\)/,
    'cleanup must remove the SAME debounced listener that was added, not the raw refresh (a mismatched remove would leak the listener on unmount)'
);
assert.match(
    source,
    /if \(debounceTimer\) clearTimeout\(debounceTimer\);\s*\n\s*debounceTimer = setTimeout\(\(\) => \{\s*\n\s*debounceTimer = null;\s*\n\s*void refresh\(\);\s*\n\s*\}, 500\);/,
    'each new devicechange event must cancel and reschedule the pending refresh (coalescing a burst into one call), with a delay long enough to outlast a Bluetooth handshake burst'
);

console.log('PASS devicechange-triggered device-list refresh is debounced, not run immediately on every event');

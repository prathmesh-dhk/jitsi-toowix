const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Real reported waste: PiP's canvas redraws at 10fps (startPipDraw -> setInterval(drawPipFrame,
// 100)) continuously for as long as the PiP window stays open, even while nobody can see it --
// burning CPU/GPU cycles the actual WebRTC encode/decode pipeline could use. This is a static
// regression guard, same pattern as the other recent fixes in this file -- not unit-testable
// directly (setupPipWindow only runs against a real documentPictureInPicture window).
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'MeetingRoomPage.tsx'), 'utf8');

assert.match(
    source,
    /const onPipVisibilityChange = \(\) => \{\s*\n\s*if \(pipWin\.document\.visibilityState === 'hidden'\) \{\s*\n\s*stopPipDraw\(\);\s*\n\s*\} else \{\s*\n\s*startPipDraw\(\);\s*\n\s*\}\s*\n\s*\};/,
    'must pause the draw loop when the PiP window itself reports hidden, and resume (which redraws immediately, see startPipDraw) when visible again'
);
assert.match(
    source,
    /pipWin\.document\.addEventListener\('visibilitychange', onPipVisibilityChange\);/,
    'must listen on the PiP WINDOW\'s own document, not the main page\'s document -- the main document going hidden (switching tabs) must never pause PiP, since staying visible while the person is on a different tab is the entire point of PiP'
);

// The fix must not touch the main document's visibilitychange handling (used elsewhere for
// auto-opening PiP) -- this guards against a careless find/replace wiring the pause to the wrong
// document.
assert.doesNotMatch(
    source,
    /(?<![\w.])document\.addEventListener\('visibilitychange', onPipVisibilityChange\)/,
    'must not accidentally attach the PiP pause/resume handler to the main document'
);

console.log('PASS PiP draw loop pauses only when the PiP window itself is hidden, never on the main tab losing focus');

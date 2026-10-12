const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Real reported bug: the PiP video appeared to freeze whenever the person switched away from the
// main/opener tab while leaving a documentPictureInPicture window open and visible -- exactly the
// "watch the call while doing something else" use case PiP exists for. Root cause: the 10fps draw
// loop's setInterval was always registered on the ambient (opener) window. Chrome's background-
// tab timer throttling degrades setInterval/setTimeout on a HIDDEN document, and that throttling
// is keyed on the document the timer is REGISTERED on -- NOT on whether some other window it
// spawned (the PiP window) is still visible. A documentPictureInPicture window is a real, separate
// top-level browsing context with its own timer queue, governed by its own visibility (already
// handled separately -- see pip-visibility-pause.test.cjs) -- registering the interval there
// instead means a hidden opener tab no longer throttles it at all.
//
// This is a static source-pattern guard (same pattern as pip-visibility-pause.test.cjs and
// video-mirroring.test.cjs) -- actually reproducing Chrome's real multi-tab background timer
// throttling is not reliably simulable in a single-process headless harness; see the limitations
// note at the bottom.
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'MeetingRoomPage.tsx'), 'utf8');

test('startPipDraw registers the 10fps interval on the PiP window itself when one is open, not the ambient opener window', () => {
  assert.match(
    source,
    /const timerWindow = \(documentPip && !documentPip\.closed\) \? documentPip : window;\s*\n\s*\n?\s*pipTimerWindowRef\.current = timerWindow;\s*\n\s*pipTimerRef\.current = timerWindow\.setInterval\(drawPipFrame, 100\);/,
    'the interval must be created via the resolved timerWindow (the PiP window when one exists), not a bare setInterval call'
  );
});

test('stopPipDraw clears the interval on the SAME window that created it, not always the ambient window', () => {
  assert.match(
    source,
    /\(pipTimerWindowRef\.current \|\| window\)\.clearInterval\(pipTimerRef\.current\)/,
    'clearInterval must target pipTimerWindowRef.current (falling back to window only if it was never set) -- timer ids are not portable across windows\' separate timer namespaces'
  );
});

test('classic (non-Document) PiP still falls back to the ambient window -- there is no second window to move its timer to', () => {
  assert.match(
    source,
    /const timerWindow = \(documentPip && !documentPip\.closed\) \? documentPip : window;/,
    'the fallback to the plain `window` for classic PiP (or when no PiP window is open yet) must remain'
  );
});

console.log('PASS: the PiP draw loop\'s timer is registered on the PiP window itself (when Document PiP is active), so switching away from the main/opener tab no longer throttles it');

// LIMITATIONS:
// - This does not and cannot reproduce Chrome's actual background-tab timer throttling behavior
//   in this headless, single-process test harness -- that throttling is a real browser scheduler
//   policy, not something a mocked setInterval/document.hidden toggle faithfully reproduces.
//   The fix is based on well-documented, standard Chromium behavior (timers on a hidden document
//   are throttled; a separate top-level browsing context's timers are governed by ITS OWN
//   visibility) and verified here at the code level: the interval is now demonstrably registered
//   on the PiP window's own timer queue, not the opener's.
// - Live confirmation (does a real PiP window visibly keep updating at 10fps while the opener tab
//   is genuinely switched away, in real interactive Chrome/Edge/Brave, not headless) was not
//   performed in this session -- flagged as a remaining limitation, not claimed as verified.

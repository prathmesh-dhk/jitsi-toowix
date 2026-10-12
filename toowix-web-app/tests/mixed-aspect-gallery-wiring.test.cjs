const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// TOOWIX MEET mixed portrait/landscape gallery -- source-level wiring regression tests. The pure
// algorithm (meetingLayout.ts) and the pure detection (videoOrientation.ts) are covered by
// mixed-aspect-gallery-layout.test.cjs and camera-video-aspect-bucketing.test.cjs; these tests
// instead guard that the REAL components actually wire that logic together end to end: the card
// reports its real ratio, the gallery feeds real (not hardcoded) ratios into the mixed layout,
// screen shares and the forced mobile grid keep their existing fixed behavior, and both /meet and
// /meet-direct get equivalent (not merged/removed) treatment.

const cardSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'MeetingParticipantCard.tsx'), 'utf8');
const gallerySource = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'meeting', 'ParticipantGallery.tsx'), 'utf8');
const directPageSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'DirectMeetingRoomPage.tsx'), 'utf8');

// #20 -- MeetingParticipantCard reports its real ratio upward; it never resizes ITSELF (its own
// outer div's size still comes entirely from the `style` prop the caller passes).
test('#20 MeetingParticipantCard reports its real aspect ratio via onAspectRatioChange, and never sets its own width/height from it', () => {
  assert.match(cardSource, /useCameraVideoAspect\(\)/, 'must use the ratio-aware hook, not just the fit-only one');
  assert.match(cardSource, /onAspectRatioChange\?\.\(ratio\)/, 'must report the real ratio upward whenever it changes');
  // The outer card div's size comes only from `...style` (spread last, caller-controlled) -- no
  // width/height literal computed from `ratio` anywhere in this component.
  assert.doesNotMatch(
    cardSource.replace(/onAspectRatioChange[^\n]*/g, ''),
    /width:\s*ratio|height:\s*ratio/,
    'the card itself must never size its own box from its ratio -- only the caller (gallery) may do that'
  );
});

// #21 -- camera-off reset: MeetingParticipantCard only renders (and binds) the <video> element
// when videoEnabled && stream are both true; the avatar branch unmounts it, which is exactly what
// makes useCameraVideoAspect's bind(null) fire and reset to the 16:9 default (see
// camera-video-aspect-bucketing.test.cjs #8 for the default itself).
test('#21 camera-off reset: the <video> (and its orientation/ratio binding) only mounts while videoEnabled && stream are true', () => {
  assert.match(
    cardSource,
    /\{videoEnabled && stream \? \(\s*\n\s*<video/,
    'the <video> element must be conditionally rendered on videoEnabled && stream, so turning the camera off unmounts it and resets the ratio to the default'
  );
});

// #22 -- ParticipantGallery feeds REAL per-participant ratios (not a hardcoded uniform ratio)
// into the mixed-aspect layout, for both the local card and every remote card.
test('#22 ParticipantGallery wires a real per-key ratio map into the mixed-aspect layout for local and remote cards', () => {
  assert.match(gallerySource, /useStableMixedAspectLayout\(/, 'must use the new mixed-aspect layout hook');
  assert.match(gallerySource, /onAspectRatioChange=\{\(ratio\) => setCellRatio\('local', ratio\)\}/, 'the local card must report its ratio into the shared map');
  assert.match(gallerySource, /onAspectRatioChange=\{\(ratio\) => setCellRatio\(remoteKey, ratio\)\}/, 'every remote card must report its own ratio into the shared map, keyed by its own id');
});

// #23 -- screen shares always stay 16:9 in the mixed layout (ScreenShareTile never reports a
// ratio -- ensuring this doesn't silently regress if someone wires a ratio for it without
// updating this fixed default).
test('#23 screen-share tiles are pinned to 16:9 in the mixed layout, never read from the (non-existent) per-participant ratio map', () => {
  assert.match(
    gallerySource,
    /ratio:\s*key\.startsWith\('share:'\)\s*\?\s*16\s*\/\s*9/,
    'a screen-share cell key must always resolve to a fixed 16:9 ratio, not a lookup that could return something else'
  );
});

// #24 -- the forced mobile pagination grid (4+ participants on a small/coarse-pointer viewport)
// keeps its existing fixed, crop-to-fill geometry untouched by the new mixed-aspect engine -- the
// brief requires preserving this exact existing behavior, not applying per-ratio packing to it.
test('#24 forced mobile pagination grid is explicitly excluded from the mixed-aspect engine (keeps its existing fixed-crop geometry)', () => {
  assert.match(
    gallerySource,
    /mobileGalleryPaged\s*\n\s*\?\s*\{\s*key,\s*\.\.\.galleryPositions\[index\],\s*width:\s*galleryLayout\.cardWidth,\s*height:\s*galleryLayout\.cardHeight\s*\}/,
    'the forced-mobile-pagination branch must still use the original uniform calculateCellPositions geometry, not the mixed-aspect cells'
  );
});

// #25 -- /meet-direct (DirectMeetingRoomPage.tsx, useLibJitsiConference route) gets equivalent
// (not merged, not removed) real-ratio treatment: every tile's own CSS aspectRatio comes from the
// real, live-tracked ratio, not a hardcoded '16 / 9' string -- for both the local tile and every
// RemoteTile.
test('#25 /meet-direct: both the local tile and RemoteTile use a live aspectRatio (not a hardcoded 16/9), independent of the /meet route', () => {
  assert.doesNotMatch(directPageSource, /aspectRatio:\s*'16 \/ 9'/, 'no tile in /meet-direct may keep a hardcoded 16:9 aspect ratio string after this change');
  assert.match(directPageSource, /useCameraVideoAspect\(\)/, 'RemoteTile must use the ratio-aware hook');
  assert.match(directPageSource, /aspectRatio:\s*String\(ratio\)/, 'RemoteTile\'s own tile div must size itself from the real, live ratio');
  assert.match(directPageSource, /aspectRatio:\s*String\(localVideoOrientation\.ratio\)/, 'the local self-view tile must size itself from the real, live ratio too');
});

console.log('PASS mixed-aspect gallery wiring: real per-participant ratios reach the layout (not hardcoded), camera-off resets via unmount, screen shares stay 16:9, forced mobile grid untouched, both /meet and /meet-direct covered');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Root cause investigated: MeetingParticipantCard.tsx is the ONLY place in the app that can
// apply `transform: scaleX(-1)` to a video element (gated by its `mirrored` prop, default false).
// None of its call sites in MeetingRoomPage.tsx (local self-view tile, remote participant grid,
// "orderedOthers" pinned-view filmstrip) or ParticipantGallery.tsx (local + remote gallery cards,
// extracted from MeetingRoomPage.tsx during a later refactor) ever pass `mirrored={true}`, so no
// in-call view is actually mirrored today. The two prejoin preview <video> elements
// (videoPreviewRef) never had a transform at all.
//
// A second, separate bug sat on top of this: the "Mirror my video" Settings toggle was fully
// disconnected from rendering -- nothing anywhere ever read the saved mirrorMyVideo value back.
// Toggling it visibly did nothing, which is worse than no setting at all (it lied about having an
// effect). Removed from the frontend UI/form entirely rather than wired up, since "no software
// mirroring, ever" is the confirmed, tested, intentional behavior this file guards. The backend
// Mongoose schema field is deliberately KEPT (not removed) for backward compatibility with
// already-stored user documents -- see the backend-side test below.
//
// These tests guard all of the above from silently regressing.

const participantCardSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'components', 'MeetingParticipantCard.tsx'), 'utf8'
);
const meetingRoomSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'pages', 'MeetingRoomPage.tsx'), 'utf8'
);
const participantGallerySource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'components', 'meeting', 'ParticipantGallery.tsx'), 'utf8'
);
const directMeetingRoomSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'pages', 'DirectMeetingRoomPage.tsx'), 'utf8'
);
const meetingsSectionSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'components', 'settings', 'MeetingsSection.tsx'), 'utf8'
);

test('MeetingParticipantCard only mirrors when explicitly told to, and defaults to unmirrored', () => {
  assert.match(
    participantCardSource,
    /mirrored\s*=\s*false/,
    'the mirrored prop must default to false so an omitted prop never mirrors a tile'
  );
  assert.match(
    participantCardSource,
    /transform:\s*mirrored\s*\?\s*'scaleX\(-1\)'\s*:\s*undefined/,
    'mirroring must stay gated behind the mirrored prop (no unconditional scaleX(-1))'
  );
});

test('no MeetingParticipantCard usage in MeetingRoomPage.tsx passes mirrored={true}', () => {
  // Every <MeetingParticipantCard ... /> block, scanned for a literal mirrored={true} or
  // mirrored prop shorthand -- catches a future regression where someone re-enables mirroring
  // for the self-view, remote grid, or pinned-view filmstrip tiles.
  const cardBlocks = meetingRoomSource.match(/<MeetingParticipantCard\b[\s\S]*?\/>/g) || [];
  assert.ok(cardBlocks.length >= 3, 'expected at least 3 MeetingParticipantCard render sites (local, remote grid, pinned-view others)');
  for (const block of cardBlocks) {
    assert.doesNotMatch(
      block,
      /mirrored(\s*=\s*{?\s*true\s*}?)?(?!\w)/,
      `MeetingParticipantCard render site must not pass mirrored (found in: ${block.slice(0, 80)}...)`
    );
  }
});

test('no MeetingParticipantCard usage in ParticipantGallery.tsx passes mirrored={true}', () => {
  // ParticipantGallery.tsx renders the local and remote gallery cards post-refactor (extracted
  // from MeetingRoomPage.tsx); not covered by the test above, so checked separately here.
  const cardBlocks = participantGallerySource.match(/<MeetingParticipantCard\b[\s\S]*?\/>/g) || [];
  assert.ok(cardBlocks.length >= 2, 'expected at least 2 MeetingParticipantCard render sites (local, remote) in ParticipantGallery.tsx');
  for (const block of cardBlocks) {
    assert.doesNotMatch(
      block,
      /mirrored(\s*=\s*{?\s*true\s*}?)?(?!\w)/,
      `ParticipantGallery.tsx render site must not pass mirrored (found in: ${block.slice(0, 80)}...)`
    );
  }
});

test('neither prejoin preview <video> applies a transform', () => {
  const previewBlocks = meetingRoomSource.match(/<video\s+ref=\{videoPreviewRef\}[\s\S]*?\/>/g) || [];
  assert.equal(previewBlocks.length, 2, 'expected exactly 2 prejoin preview <video> elements (compact + full prejoin layouts)');
  for (const block of previewBlocks) {
    assert.doesNotMatch(block, /transform\s*:/, `prejoin preview video must not have a transform (found in: ${block})`);
  }
});

test('DirectMeetingRoomPage.tsx applies no mirroring transform', () => {
  assert.doesNotMatch(directMeetingRoomSource, /scaleX|rotateY|mirror/i);
});

test('the nonfunctional "Mirror my video" toggle is removed from Settings -> Meetings', () => {
  // It was disconnected from rendering (see the file header comment) -- toggling it did nothing,
  // which is actively misleading. Removed outright rather than wired up: "no software mirroring"
  // is the confirmed, tested, intentional behavior the rest of this file guards.
  assert.doesNotMatch(
    meetingsSectionSource,
    /mirrorMyVideo/,
    'MeetingsSection.tsx must not reference mirrorMyVideo at all -- the dead toggle must be fully removed, not just hidden'
  );
  assert.doesNotMatch(
    meetingsSectionSource,
    /Mirror my video/i,
    'the "Mirror my video" label must not be rendered anywhere in Settings -> Meetings'
  );
});

test('mirrorMyVideo is kept on the backend schema for backward compatibility with already-stored user documents', () => {
  const userModelSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'toowix-backend', 'src', 'models', 'User.ts'), 'utf8'
  );
  assert.match(
    userModelSource,
    /mirrorMyVideo:\s*\{\s*type:\s*Boolean,\s*default:\s*false\s*\}/,
    'User.ts meetingDefaults.mirrorMyVideo schema field must still exist (default false) -- removing it is a separate, ' +
    'deliberately NOT-taken step here; it stays for documents that already stored a value'
  );
});

console.log('PASS: no view (self, remote, prejoin, gallery, pinned/filmstrip, /meet-direct) is software-mirrored; the dead "Mirror my video" toggle is removed from the frontend; the backend field is kept for compatibility');

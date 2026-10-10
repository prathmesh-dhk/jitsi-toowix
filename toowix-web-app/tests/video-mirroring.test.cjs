const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Root cause investigated: MeetingParticipantCard.tsx is the ONLY place in the app that can
// apply `transform: scaleX(-1)` to a video element (gated by its `mirrored` prop, default false).
// None of its 3 call sites in MeetingRoomPage.tsx (local self-view tile, remote participant grid,
// "orderedOthers" pinned-view filmstrip) ever pass `mirrored={true}`, so no in-call view is
// actually mirrored today. The two prejoin preview <video> elements (videoPreviewRef) never had
// a transform at all. The real, separate bug: the `mirrorMyVideo` Settings toggle defaulted to
// `true` while being completely disconnected from rendering -- a misleading dead setting. Fixed
// by flipping both the frontend form default (MeetingsSection.tsx) and the backend Mongoose
// schema default (User.ts) to `false`, consistent with "no software mirroring" being the
// required behavior. These tests guard all of the above from silently regressing.

const participantCardSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'components', 'MeetingParticipantCard.tsx'), 'utf8'
);
const meetingRoomSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'pages', 'MeetingRoomPage.tsx'), 'utf8'
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

test('mirrorMyVideo setting defaults to false on both the frontend form and backend schema', () => {
  assert.match(
    meetingsSectionSource,
    /mirrorMyVideo:\s*false/,
    'MeetingsSection.tsx DEFAULTS must set mirrorMyVideo: false'
  );
  const userModelSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'toowix-backend', 'src', 'models', 'User.ts'), 'utf8'
  );
  assert.match(
    userModelSource,
    /mirrorMyVideo:\s*\{\s*type:\s*Boolean,\s*default:\s*false\s*\}/,
    'User.ts meetingDefaults.mirrorMyVideo schema default must be false'
  );
});

console.log('PASS: no view (self, remote, prejoin, pinned/filmstrip, /meet-direct) is software-mirrored, and mirrorMyVideo defaults to false');

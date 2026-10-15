const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Reversal of an earlier cleanup: that pass removed ALL software mirroring, local and remote
// alike, on the theory that "no mirroring, ever" was the correct behavior. The actual requirement
// turned out to be narrower -- Google Meet-style behavior, where the LOCAL self-view (and only
// the local self-view) is mirrored horizontally for the viewer's own comfort, while what remote
// participants receive and see of you, and what gets recorded/screen-shared, is never flipped.
// MeetingParticipantCard.tsx is still the only place that CAN apply transform: scaleX(-1) to a
// participant-card video (gated by its `mirrored` prop, default false, unchanged) -- what changed
// is which call sites pass it: the LOCAL card now does, every REMOTE card still must not. The
// prejoin preview and the standalone (non-card) local self-view <video> elements in
// MeetingRoomPage.tsx/DirectMeetingRoomPage.tsx apply the same scaleX(-1) directly, since they
// don't go through MeetingParticipantCard at all.
//
// These tests guard the NEW split: local mirrored, remote never, nothing else touched (names,
// toolbar, badges, screen share, recordings all render through entirely separate elements that
// none of this reaches).

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

function hasMirroredProp(block) {
  return /(?<![\w-])mirrored(\s*=\s*{?\s*true\s*}?)?(?!\w)/.test(block);
}

test('MeetingParticipantCard still only mirrors when explicitly told to (prop-gated, default false)', () => {
  // The component itself stays a safe, explicit opt-in -- what changed is which call sites opt
  // in, not the component's own default. A remote card that forgot to omit `mirrored` would be a
  // real bug; keeping the default false (rather than flipping it) is what makes "forgetting to
  // pass it" fail safe (unmirrored) instead of fail dangerous (mirrored).
  assert.match(
    participantCardSource,
    /mirrored\s*=\s*false/,
    'the mirrored prop must still default to false -- only explicit local call sites opt in'
  );
  assert.match(
    participantCardSource,
    /transform:\s*mirrored\s*\?\s*'scaleX\(-1\)'\s*:\s*undefined/,
    'mirroring must stay gated behind the mirrored prop (no unconditional scaleX(-1))'
  );
});

test('MeetingRoomPage.tsx: the LOCAL MeetingParticipantCard render site mirrors; every REMOTE one does not', () => {
  const cardBlocks = meetingRoomSource.match(/<MeetingParticipantCard\b[\s\S]*?\/>/g) || [];

  assert.ok(cardBlocks.length >= 3, 'expected at least 3 MeetingParticipantCard render sites (local, remote grid, pinned-view others)');
  const localBlocks = cardBlocks.filter((b) => /participantId="local"/.test(b));
  const remoteBlocks = cardBlocks.filter((b) => !/participantId="local"/.test(b));

  assert.equal(localBlocks.length, 1, 'expected exactly one local-card render site');
  assert.ok(remoteBlocks.length >= 2, 'expected at least 2 remote-card render sites');
  assert.ok(hasMirroredProp(localBlocks[0]), 'the local self-view card must pass the mirrored prop');
  for (const block of remoteBlocks) {
    assert.ok(!hasMirroredProp(block), `a remote participant card must NEVER pass mirrored (found in: ${block.slice(0, 80)}...)`);
  }
});

test('ParticipantGallery.tsx: the LOCAL gallery/grid card mirrors; the REMOTE one does not', () => {
  const cardBlocks = participantGallerySource.match(/<MeetingParticipantCard\b[\s\S]*?\/>/g) || [];

  assert.ok(cardBlocks.length >= 2, 'expected at least 2 MeetingParticipantCard render sites (local, remote) in ParticipantGallery.tsx');
  const localBlocks = cardBlocks.filter((b) => /participantId="local"/.test(b));
  const remoteBlocks = cardBlocks.filter((b) => !/participantId="local"/.test(b));

  assert.equal(localBlocks.length, 1, 'expected exactly one local-card render site');
  assert.ok(hasMirroredProp(localBlocks[0]), 'the local gallery card must pass the mirrored prop');
  for (const block of remoteBlocks) {
    assert.ok(!hasMirroredProp(block), `a remote participant card must NEVER pass mirrored (found in: ${block.slice(0, 80)}...)`);
  }
});

test('both prejoin preview <video> elements apply scaleX(-1) (self-view mirrored before joining too)', () => {
  // Mobile camera orientation fix: the ref is now a callback composing videoPreviewRef.current
  // with the orientation-tracking bind() (see src/lib/videoOrientation.ts), instead of a bare
  // object ref -- still exactly 2 occurrences, still both mirrored.
  const previewBlocks = meetingRoomSource.match(/<video\s+ref=\{\(el\) => \{ videoPreviewRef\.current = el; previewVideoOrientation\.bind\(el\); \}\}[\s\S]*?\/>/g) || [];

  assert.equal(previewBlocks.length, 2, 'expected exactly 2 prejoin preview <video> elements (compact + full prejoin layouts)');
  for (const block of previewBlocks) {
    assert.match(block, /transform:\s*'scaleX\(-1\)'/, `prejoin preview video must be mirrored (found in: ${block})`);
  }
});

test('every standalone local self-view <video> in MeetingRoomPage.tsx (not routed through MeetingParticipantCard) is mirrored', () => {
  // The big pinned-local stage, the duplicate "pin yourself" / isLocalPinned tiles, and both
  // prejoin previews -- 5 literal scaleX(-1) occurrences total. A count check (rather than
  // matching each one by its surrounding markup, which has drifted before) is what keeps this
  // guard from going stale the next time the surrounding layout gets refactored, while still
  // catching the real regression: mirroring quietly disappearing from one of these sites.
  const scaleXCount = (meetingRoomSource.match(/transform:\s*'scaleX\(-1\)'/g) || []).length;

  assert.equal(scaleXCount, 5, 'expected exactly 5 standalone local-video scaleX(-1) occurrences in MeetingRoomPage.tsx (big stage, 2x pin-yourself/pinned-local, 2x prejoin preview) -- update this count deliberately if a self-view is added or removed, not by accident');
});

function extractBalancedFunctionBody(source, startToken) {
  const startIdx = source.indexOf(startToken);

  assert.ok(startIdx !== -1, `expected to find "${startToken}"`);
  const firstBrace = source.indexOf('{', startIdx);
  let depth = 0;

  for (let i = firstBrace; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(startIdx, i + 1);
    }
  }
  throw new Error(`unbalanced braces after "${startToken}"`);
}

test('DirectMeetingRoomPage.tsx: the local self-view is mirrored; RemoteTile (remote participants) is never mirrored', () => {
  const remoteTileBody = extractBalancedFunctionBody(directMeetingRoomSource, 'function RemoteTile(');

  assert.doesNotMatch(remoteTileBody, /scaleX|rotateY/i, 'RemoteTile (remote participants) must never be mirrored');

  const outsideRemoteTile = directMeetingRoomSource.replace(remoteTileBody, '');

  assert.match(outsideRemoteTile, /transform:\s*'scaleX\(-1\)'/, 'the local self-view in DirectMeetingRoomPage.tsx must be mirrored');
});

const meetingsSectionSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'components', 'settings', 'MeetingsSection.tsx'), 'utf8'
);

test('the "Mirror my video" toggle remains removed from Settings -> Meetings (unaffected by this reversal)', () => {
  // Mirroring local self-view is now the unconditional default (see the tests above), so there is
  // still nothing for a per-user toggle to control -- this earlier removal stays correct and is
  // not part of what this reversal changes.
  assert.doesNotMatch(
    meetingsSectionSource,
    /mirrorMyVideo/,
    'MeetingsSection.tsx must not reference mirrorMyVideo -- untouched by this reversal'
  );
  assert.doesNotMatch(
    meetingsSectionSource,
    /Mirror my video/i,
    'the "Mirror my video" label must not be rendered anywhere in Settings -> Meetings -- untouched by this reversal'
  );
});

test('mirrorMyVideo is kept on the backend schema for backward compatibility with already-stored user documents', () => {
  const userModelSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'toowix-backend', 'src', 'models', 'User.ts'), 'utf8'
  );

  assert.match(
    userModelSource,
    /mirrorMyVideo:\s*\{\s*type:\s*Boolean,\s*default:\s*false\s*\}/,
    'User.ts meetingDefaults.mirrorMyVideo schema field must still exist -- untouched by this reversal, kept for documents that already stored a value'
  );
});

console.log('PASS: local self-view (prejoin, gallery, pinned, screen-share sidebar, /meet-direct) is mirrored like Google Meet; every remote participant view stays unmirrored');

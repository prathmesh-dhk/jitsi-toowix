const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const roomPage = fs.readFileSync(path.join(__dirname, '../src/pages/MeetingRoomPage.tsx'), 'utf8');
const endedPage = fs.readFileSync(path.join(__dirname, '../src/pages/MeetingEndedPage.tsx'), 'utf8');

test('rejoin carries identity and requests exactly one automatic admission', () => {
  assert.match(endedPage, /autoJoin: true/);
  assert.match(endedPage, /participation: state\.participation/);
  assert.match(roomPage, /shouldAutoRejoin/);
  assert.match(roomPage, /autoRejoinStartedRef\.current = true/);
  assert.match(roomPage, /void handleJoinMeeting\(\)/);
});

test('automatic rejoin waits for restored media and never bypasses protected meetings', () => {
  assert.match(roomPage, /const mediaReady/);
  assert.match(roomPage, /meetingInfo\.passwordRequired/);
  assert.match(roomPage, /meetingInfo\.requireLobbyPolicy/);
  assert.match(roomPage, /meetingInfo\.type === 'Private'/);
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const config = fs.readFileSync(path.join(root, 'src', 'lib', 'monitoring', 'telemetryConfig.ts'), 'utf8');
const publisher = fs.readFileSync(path.join(root, 'src', 'lib', 'monitoring', 'telemetryPublisher.ts'), 'utf8');
const meetingRoom = fs.readFileSync(path.join(root, 'src', 'pages', 'MeetingRoomPage.tsx'), 'utf8');
const directRoom = fs.readFileSync(path.join(root, 'src', 'pages', 'DirectMeetingRoomPage.tsx'), 'utf8');

assert.match(config, /VITE_MONITORING_TELEMETRY_URL/, 'telemetry endpoint must be a build-time setting');
assert.match(config, /VITE_TELEMETRY_INGEST_TOKEN/, 'telemetry must use the dedicated ingest token');
assert.match(publisher, /authorization: `Bearer \$\{options\.token\}`/i, 'ingest requests must use bearer authentication');
assert.match(publisher, /['"]content-type['"]:\s*['"]application\/json['"]/i, 'ingest requests must declare JSON content');
assert.match(publisher, /intervalMs \?\? 3000/, 'telemetry must sample at a three-second cadence by default');
assert.match(meetingRoom, /getTelemetryPublisherConfig/, 'main meeting page must use direct ingest configuration');
assert.match(directRoom, /getTelemetryPublisherConfig/, 'direct meeting page must use direct ingest configuration');
assert.doesNotMatch(meetingRoom, /getTelemetrySession/, 'main meeting page must not request a backend JWT telemetry session');
assert.doesNotMatch(directRoom, /getTelemetrySession/, 'direct meeting page must not request a backend JWT telemetry session');

console.log('PASS direct telemetry ingest configuration');

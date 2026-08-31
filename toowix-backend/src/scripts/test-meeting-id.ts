/**
 * TOOWIX MEET: MEETING ID & JITSI ROOM RESOLUTION VERIFICATION TEST
 * 
 * Verifies:
 * 1. Automatic meeting ID generation (Req 1.3 - format, entropy, uniqueness)
 * 2. Custom meeting ID validation (Req 1.4)
 * 3. Invalid characters & symbol sanitization
 * 4. Empty/Whitespace ID resilience
 * 5. Jitsi URI parser compatibility & correct room targeting
 */

// Matching meeting-id.ts implementation from toowix-web-app
export const generateUniqueMeetingId = (): string => {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  const getRandomChunk = (len: number) => {
    let result = '';
    for (let i = 0; i < len; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  return `twx-${getRandomChunk(3)}-${getRandomChunk(3)}-${getRandomChunk(3)}`;
};

export const sanitizeCustomMeetingId = (input: string): string => {
  if (!input || typeof input !== 'string') return '';
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
};

export const getMeetingUrl = (roomId: string, domain = 'meet.toowix.com'): string => {
  let cleanId = sanitizeCustomMeetingId(roomId);
  if (!cleanId) {
    cleanId = generateUniqueMeetingId();
  }
  return `https://${domain}/${cleanId}`;
};

// Jitsi Meet's RFC 3986 / XMPP Room Parser simulation (mirroring react/features/base/util/uri.ts)
export function simulateJitsiRoomParser(url: string): { hostname: string; room?: string; protocol: string } {
  try {
    const parsed = new URL(url);
    const pathSegments = parsed.pathname.split('/').filter(Boolean);
    const rawRoom = pathSegments[pathSegments.length - 1];

    if (!rawRoom) {
      return { hostname: parsed.hostname, room: undefined, protocol: parsed.protocol };
    }

    // Jitsi normalization: strip _ROOM_EXCLUDE_PATTERN [:?#[]@!$&'()*+,;=></"], decode, lowercase
    const sanitizedRoom = decodeURIComponent(rawRoom)
      .replace(/[\:\?#\[\]@!$&'()*+,;=></"]/g, '')
      .toLowerCase()
      .trim();

    return {
      hostname: parsed.hostname,
      room: sanitizedRoom || undefined,
      protocol: parsed.protocol,
    };
  } catch (err: any) {
    throw new Error(`Jitsi parser failed on URI: ${url} (${err.message})`);
  }
}

export function runMeetingIdVerificationTests() {
  console.log('\n================================================================');
  console.log('   TOOWIX MEET: MEETING ID & JITSI ROOM RESOLUTION TEST SUITE   ');
  console.log('================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  const assert = (condition: boolean, msg: string) => {
    totalTests++;
    if (!condition) {
      console.error(`[FAIL] ${msg}`);
      throw new Error(msg);
    }
    console.log(`[PASS] ${msg}`);
    passedTests++;
  };

  // -------------------------------------------------------------
  // TEST 1: Automatic Meeting ID Generation (Req 1.3)
  // -------------------------------------------------------------
  console.log('--- TEST 1: AUTOMATIC MEETING ID GENERATION (Req 1.3) ---');
  const sampleIds: string[] = [];
  const autoIdRegex = /^twx-[a-z]{3}-[a-z]{3}-[a-z]{3}$/;

  for (let i = 0; i < 5; i++) {
    const id = generateUniqueMeetingId();
    sampleIds.push(id);
    assert(autoIdRegex.test(id), `Generated ID "${id}" matches required Google Meet style pattern (twx-xxx-xxx-xxx)`);
  }

  // Test collision resistance / uniqueness across 5,000 generated IDs
  const uniqueSet = new Set<string>();
  for (let i = 0; i < 5000; i++) {
    uniqueSet.add(generateUniqueMeetingId());
  }
  assert(uniqueSet.size === 5000, `Entropy check: 5,000 consecutive generated IDs produced 0 collisions (100% unique)`);

  // -------------------------------------------------------------
  // TEST 2: Custom Meeting IDs (Req 1.4)
  // -------------------------------------------------------------
  console.log('\n--- TEST 2: VALID CUSTOM MEETING IDS (Req 1.4) ---');
  const validCustomCases = [
    { input: 'team-daily-sync', expected: 'team-daily-sync' },
    { input: 'q3-executive-briefing-2026', expected: 'q3-executive-briefing-2026' },
    { input: 'all-hands', expected: 'all-hands' },
    { input: 'project-apollo-sprint-42', expected: 'project-apollo-sprint-42' },
  ];

  for (const tc of validCustomCases) {
    const sanitized = sanitizeCustomMeetingId(tc.input);
    assert(sanitized === tc.expected, `Custom ID "${tc.input}" accepted exactly as "${sanitized}"`);
  }

  // -------------------------------------------------------------
  // TEST 3: Invalid Characters, Symbols & Path Traversal Sanitization
  // -------------------------------------------------------------
  console.log('\n--- TEST 3: INVALID CHARACTERS & SYMBOL SANITIZATION ---');
  const dirtyCases = [
    { input: '  Team  Meeting  2026  ', expected: 'team-meeting-2026', reason: 'Spaces converted to hyphens & lowercased' },
    { input: 'Sales@Company!#$2026', expected: 'sales-company-2026', reason: 'Special characters stripped and hyphen-separated' },
    { input: '../../../admin/secret-room', expected: 'admin-secret-room', reason: 'Directory traversal slashes removed' },
    { input: '---Lead---Gen---Demo---', expected: 'lead-gen-demo', reason: 'Leading, trailing, and duplicate hyphens collapsed' },
    { input: '🚀-Marketing-Launch-🎯', expected: 'marketing-launch', reason: 'Emojis and non-ASCII stripped cleanly' },
    { input: 'UPPERCASE_WITH_UNDERSCORES', expected: 'uppercase-with-underscores', reason: 'Underscores and uppercase normalized' },
  ];

  for (const tc of dirtyCases) {
    const result = sanitizeCustomMeetingId(tc.input);
    assert(result === tc.expected, `Sanitized: "${tc.input}" -> "${result}" (${tc.reason})`);
  }

  // -------------------------------------------------------------
  // TEST 4: Empty IDs & Whitespace Handling
  // -------------------------------------------------------------
  console.log('\n--- TEST 4: EMPTY & WHITESPACE ID RESILIENCE ---');
  const emptyCases = ['', '   ', '-----', '   !@#$%   '];
  for (const emptyInput of emptyCases) {
    const sanitized = sanitizeCustomMeetingId(emptyInput);
    assert(sanitized === '', `Empty/invalid input "${emptyInput}" safely sanitized to empty string (prevents broken URLs)`);

    // Ensure getMeetingUrl automatically generates a fresh unique ID if empty
    const url = getMeetingUrl(emptyInput);
    const parsed = simulateJitsiRoomParser(url);
    assert(Boolean(parsed.room && autoIdRegex.test(parsed.room)), `getMeetingUrl("${emptyInput}") fallback: Generated safe meeting URL -> ${url}`);
  }

  // -------------------------------------------------------------
  // TEST 5: Jitsi Meet Room Resolution & Link Verification
  // -------------------------------------------------------------
  console.log('\n--- TEST 5: JITSI MEET ROOM RESOLUTION & LINK VERIFICATION ---');
  const integrationRooms = [
    'twx-abc-def-ghi',
    'product-launch-2026',
    'support-room-101',
  ];

  for (const roomName of integrationRooms) {
    const fullUrl = getMeetingUrl(roomName, 'meet.toowix.com');
    const jitsiParsed = simulateJitsiRoomParser(fullUrl);

    assert(jitsiParsed.hostname === 'meet.toowix.com', `Host resolved: ${jitsiParsed.hostname}`);
    assert(jitsiParsed.room === roomName, `Jitsi room extracted exactly: "${jitsiParsed.room}" === "${roomName}"`);
    assert(jitsiParsed.protocol === 'https:', `Protocol is secure HTTPS`);
  }

  console.log('\n================================================================');
  console.log(`   ALL ${passedTests}/${totalTests} MEETING ID & JITSI VERIFICATION TESTS PASSED!`);
  console.log('================================================================\n');
}

if (require.main === module) {
  runMeetingIdVerificationTests();
}

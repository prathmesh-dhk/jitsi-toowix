const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The periodic network-quality effect in useJitsiMeeting.ts isn't unit-testable directly (it
// closes over live room/ref state and only runs inside a mounted React hook against a real
// JitsiConference) -- this is a static regression guard for a real bug found in review: the
// effect's OWN render height must be held back by the same step-up rate limit as the sender, not
// just the sender. Applying a higher network/call-size TARGET to effect.setMaxOutputHeight
// immediately while only rate-limiting the sender constraint means the effect composites at a
// resolution nobody is actually being sent yet -- CPU spent on pixels that don't go anywhere for
// up to EFFECT_SENDER_STEP_UP_MIN_INTERVAL_MS.
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'useJitsiMeeting.ts'), 'utf8');

assert.match(source, /const EFFECT_SENDER_STEP_UP_MIN_INTERVAL_MS = 8000/, 'must define the step-up rate limit as a named constant');
assert.match(source, /const effectAppliedTargetRef = useRef<number \| null>\(null\)/, 'must track the last TARGET applied to the effect\'s render height, not only the sender');
assert.match(
    source,
    /const appliedTarget = previousTarget === null \|\| target < previousTarget \|\| canStepUp \? target : previousTarget/,
    'a higher target must be held back (to the previous, lower value) until the step-up cooldown has elapsed -- a lower target always applies immediately'
);
assert.match(
    source,
    /activeEffect\.setMaxOutputHeight\?\.\(appliedTarget\)/,
    'the effect\'s render height must be fed the RATE-LIMITED value (appliedTarget), not the raw network/call-size target -- otherwise the effect renders at a resolution the sender hasn\'t caught up to yet'
);

console.log('PASS background effect render height is rate-limited in lockstep with the sender, not just the sender');

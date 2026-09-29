const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// createVirtualBackgroundEffect.ts's engine-selection/fallback logic makes a real dynamic
// import('@mediapipe/tasks-vision') and a real ImageSegmenter.createFromOptions() call, which
// aren't practical to fully simulate in the node:vm harness the other tests here use (that would
// mean re-implementing enough of the real npm package's behaviour to be a test of the mock, not
// of the code) -- this is a static regression guard instead, same pattern as
// tests/self-participant-filter.test.cjs and tests/background-sender-hysteresis.test.cjs use
// elsewhere in this codebase for hook-internal logic that isn't otherwise unit-testable.
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'virtualBackground', 'createVirtualBackgroundEffect.ts'), 'utf8');

assert.match(
    source,
    /const requestedEngine = readSegmentationEngineOverride\(\);/,
    'engine selection must come from the dev-only flag, defaulting to v1 (see mediaPipeSegmentation.ts)'
);
assert.match(
    source,
    /const delegate = requestedEngine === 'mediapipe-gpu' \? 'GPU' : 'CPU';/,
    'the GPU delegate must only ever be reached via an explicit \'mediapipe-gpu\' flag value, never chosen automatically'
);
assert.match(
    source,
    /const mediaPipeSegmenter = await loadMediaPipeSegmenter\(delegate\);/,
    'must attempt to load the requested MediaPipe delegate when the flag asks for one'
);
assert.match(
    source,
    /catch \(err\) \{[\s\S]*?console\.warn\(`\[VirtualBackground\] MediaPipe \(\$\{delegate\}\) failed to initialize, falling back to V1:`, err\);[\s\S]*?\}/,
    'a MediaPipe creation failure must be caught and logged, then fall through to V1 below -- never left to reject the whole call'
);
assert.match(
    source,
    /const \{ tflite \} = await loadTfliteOnce\(\);\s*\n\s*const engineHandle: ISegmentationEngineHandle = \{ engine: 'v1', tflite \};/,
    'the function must end on the V1 path -- reached directly when the flag says v1, and by falling through after a MediaPipe failure'
);
assert.match(
    source,
    /return new JitsiStreamBackgroundEffect\(engineHandle, virtualBackground, loadTfliteOnce\);/,
    'loadTfliteOnce must be passed to the effect so it can load V1 on demand for a mid-call fallback, without every engine paying for it upfront'
);

console.log('PASS background engine selection: v1 default, GPU only via explicit flag, MediaPipe failure falls back to V1');

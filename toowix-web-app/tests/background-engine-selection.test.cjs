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
    'engine selection must come from readSegmentationEngineOverride() (see its own default in mediaPipeSegmentation.ts, currently v1)'
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
    /catch \(err\) \{[\s\S]*?initFallbackReason = `MediaPipe \(\$\{delegate\}\) failed to initialize: \$\{message\}`;[\s\S]*?console\.warn\(`\[VirtualBackground\] \$\{initFallbackReason\} -- falling back to V1\.`\);[\s\S]*?\}/,
    'a MediaPipe creation failure must be caught, its reason recorded (for the diagnostics overlay) and logged, then fall through to V1 below -- never left to reject the whole call'
);
assert.match(
    source,
    /const \{ tflite \} = await loadTfliteOnce\(\);\s*\n\s*const engineHandle: ISegmentationEngineHandle = \{ engine: 'v1', tflite \};/,
    'the function must end on the V1 path -- reached directly when the flag says v1, and by falling through after a MediaPipe failure'
);
assert.match(
    source,
    /return new JitsiStreamBackgroundEffect\(engineHandle, virtualBackground, loadTfliteOnce, options\.onGiveUp \?\? null, initFallbackReason, options\.onFallback \?\? null\);/,
    'loadTfliteOnce must be passed to the effect so it can load V1 on demand for a mid-call fallback, without every engine paying for it upfront; onGiveUp, the init-time fallback reason, and onFallback must all be passed through'
);

console.log('PASS background engine selection: default per mediaPipeSegmentation.ts (currently v1), MediaPipe failure falls back to V1');

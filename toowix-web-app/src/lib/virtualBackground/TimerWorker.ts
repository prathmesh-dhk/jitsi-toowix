// Ported as-is from jitsi-meet's react/features/stream-effects/virtual-background/workers/TimerWorker.ts
// -- self-contained (blob-based Worker script), no changes needed.
export const SET_TIMEOUT = 1;
export const CLEAR_TIMEOUT = 2;
export const TIMEOUT_TICK = 3;

// Runs the frame-pacing timer in a real Worker (not just setTimeout on the main thread) so it
// isn't throttled when the tab is backgrounded -- backgrounding a call shouldn't freeze your
// own outgoing blurred video for everyone else.
const code = `
    var timer;

    onmessage = function(request) {
        switch (request.data.id) {
        case ${SET_TIMEOUT}: {
            timer = setTimeout(() => {
                postMessage({ id: ${TIMEOUT_TICK} });
            }, request.data.timeMs);
            break;
        }
        case ${CLEAR_TIMEOUT}: {
            if (timer) {
                clearTimeout(timer);
            }
            break;
        }
        }
    };
`;

export const timerWorkerScript = URL.createObjectURL(new Blob([ code ], { type: 'application/javascript' }));

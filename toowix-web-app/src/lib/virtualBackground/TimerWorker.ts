// Ported as-is from jitsi-meet's react/features/stream-effects/virtual-background/workers/TimerWorker.ts
// -- self-contained (blob-based Worker script), no changes needed.
export const SET_TIMEOUT = 1;
export const CLEAR_TIMEOUT = 2;
export const TIMEOUT_TICK = 3;

// Runs frame pacing in a Worker to reduce main-thread timer contention. Mobile browsers
// can still suspend workers and camera capture when the app is backgrounded.
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

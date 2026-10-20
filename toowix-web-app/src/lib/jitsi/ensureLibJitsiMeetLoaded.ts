import { loadScript } from './mediaHelpers';

// Extracted out of useJitsiMeeting.ts (a large, meeting-room-only file lazy-loaded as its own
// chunk) so the dashboard's "Start an instant meeting" flow can kick this download off the
// moment the person clicks, without pulling that whole file -- and everything it in turn imports
// -- into the dashboard's own chunk. useJitsiMeeting.ts re-exports this same function so every
// existing import of it is unaffected.
let scriptLoadPromise: Promise<void> | null = null;

// Real reported delay: Jitsi's own JS (config.js then lib-jitsi-meet.min.js, loaded serially)
// only started downloading AFTER the join click, even though the person may have sat on the
// lobby screen for seconds doing nothing network-intensive. scriptLoadPromise is the single
// source of truth regardless of who calls this first: the dashboard's own preload on click, the
// lobby screen's preload on render, and the real connect effect that actually uses it all share
// the exact same in-flight (or already-settled) promise -- no duplicate download, no race, and
// every caller after the first just awaits the same result.
export async function ensureLibJitsiMeetLoaded(jitsiDomain: string): Promise<void> {
  if (window.JitsiMeetJS && window.config) {
    return;
  }
  if (!scriptLoadPromise) {
    // Neither script depends on the other's content to start downloading -- lib-jitsi-meet.min.js
    // only reads window.config later, when a caller actually uses it, not at parse/load time.
    // Fetching them in parallel instead of one-after-another removes a full network round trip
    // from every cold load.
    //
    // The browser library and the Jitsi deployment must still be the same release. A copied local
    // lib-jitsi-meet build had drifted from Jicofo/JVB and rejected valid simulcast SDP from a
    // third participant as duplicate SSRC lines. Always use the active server's own build.
    scriptLoadPromise = Promise.all([
      loadScript(`https://${jitsiDomain}/config.js`),
      loadScript(`https://${jitsiDomain}/libs/lib-jitsi-meet.min.js`),
    ]).then(() => undefined);
  }

  return scriptLoadPromise;
}

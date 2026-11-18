import { loadScript } from './mediaHelpers';

// A jitsiDomain on port 80 has no TLS listener there -- plain http/ws, not https/wss. Every
// other port (8443, talk.toowix.com's 443, etc.) is assumed to terminate TLS as before.
export function jitsiHttpScheme(jitsiDomain: string): 'http' | 'https' {
  return jitsiDomain.endsWith(':80') ? 'http' : 'https';
}
export function jitsiWsScheme(jitsiDomain: string): 'ws' | 'wss' {
  return jitsiDomain.endsWith(':80') ? 'ws' : 'wss';
}

// P1-6 fix (2G/3G performance plan): this used to run unconditionally from main.tsx on EVERY
// page load -- login, signup, dashboard, settings, marketing pages included -- opening a TLS
// connection to the Jitsi host that only a meeting page ever actually uses. On a weak connection
// that competed with whatever the current (non-meeting) page actually needed to load. Callers now
// decide WHEN this runs: main.tsx only calls it for a page load that's already a meeting route
// (see isMeetingRoutePathname in meeting-id.ts), and MeetingRoomPage/DirectMeetingRoomPage call it
// on mount to cover client-side SPA navigation into a meeting (e.g. the dashboard's "New
// meeting"/"Join" flow) that never re-runs main.tsx at all. Module-level guard, same reasoning as
// scriptLoadPromise below: whichever of those call sites gets there first wins, every later call
// (including a redundant one from main.tsx AND a mount effect on the exact same page load) is a
// safe no-op instead of appending a second <link> tag.
let preconnected = false;

export function preconnectJitsi(jitsiDomain: string): void {
  if (preconnected) return;
  preconnected = true;
  try {
    const preconnect = document.createElement('link');

    preconnect.rel = 'preconnect';
    preconnect.href = `${jitsiHttpScheme(jitsiDomain)}://${jitsiDomain}`;
    preconnect.crossOrigin = 'anonymous';
    document.head.appendChild(preconnect);
  } catch {
    // A blocked/unavailable DOM API here must never prevent the app from loading.
  }
}

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
    const scheme = jitsiHttpScheme(jitsiDomain);
    scriptLoadPromise = Promise.all([
      loadScript(`${scheme}://${jitsiDomain}/config.js`),
      loadScript(`${scheme}://${jitsiDomain}/libs/lib-jitsi-meet.min.js`),
    ]).then(() => undefined);
  }

  return scriptLoadPromise;
}

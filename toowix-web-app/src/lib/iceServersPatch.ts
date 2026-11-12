// Standalone STUN/TURN wiring, independent of the Jitsi/Prosody deployment's own extdisco
// mechanism (confirmed broken in production -- every client's extdisco:1/2 request gets
// "service-unavailable", so lib-jitsi-meet's jvbIceConfig.iceServers stays permanently empty; see
// lib-jitsi-meet.min.js's onReceiveStunAndTurnCredentials, the only thing that ever populates it).
// lib-jitsi-meet's own `iceServersOverride` client option can only PATCH entries a *successful*
// extdisco response already returned -- confirmed directly in that same minified source, it has
// no path to inject a brand new server into an empty list. So instead of extending Jitsi's own
// mechanism, this patches the one thing underneath it that both this app and lib-jitsi-meet
// ultimately rely on: the browser's RTCPeerConnection constructor itself. Every RTCPeerConnection
// created anywhere in the page (ours or lib-jitsi-meet's internal ones) gets our own
// backend-issued TURN/STUN servers merged into whatever iceServers it was given -- a real,
// working ICE server list on every call, regardless of what Jitsi's signaling server did or
// didn't hand out.
//
// NOTE: an earlier version of this file also tried to steer video codec selection away from AV1
// here, by reordering RTCRtpTransceiver.setCodecPreferences() on every createOffer/createAnswer.
// Confirmed via a real live test against production that this does NOT work for this deployment:
// setCodecPreferences succeeded (no exception) on every call, but encoderImplementation stayed
// "libaom" (AV1) regardless -- this client only ever calls createAnswer (JVB/Jicofo is always the
// offerer), and the offer's own codec list is what actually constrains the answer. Codec
// preference belongs in lib-jitsi-meet's own, purpose-built config instead (videoQuality.
// codecPreferenceOrder/screenshareCodec, passed into initJitsiConference in useJitsiMeeting.ts/
// useLibJitsiConference.ts) -- that routes through its real signaling path rather than fighting
// it from underneath with a raw WebRTC API call.
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000';

let cachedServers: RTCIceServer[] = [];
let patchInstalled = false;

/** Fetches this app's own TURN/STUN credentials and primes the patched constructor with them.
 * Best-effort and non-blocking by design -- a call still works over host/srflx candidates
 * without these, this only adds a relay path for networks that need one. Safe to call every
 * join; the previous credential set (if any) stays in effect until a fresh one lands. */
export async function primeIceServers(): Promise<void> {
  installIceServersPatch();
  try {
    const response = await fetch(`${BACKEND_URL}/api/meetings/turn-credentials`);
    if (!response.ok) return;
    const data = await response.json();
    if (!Array.isArray(data.urls) || !data.username || !data.credential) return;
    cachedServers = [ { urls: data.urls, username: data.username, credential: data.credential } ];
  } catch {
    // Best-effort -- see function comment.
  }
}

function installIceServersPatch(): void {
  if (patchInstalled || typeof window === 'undefined' || !window.RTCPeerConnection) return;
  patchInstalled = true;

  const NativeRTCPeerConnection = window.RTCPeerConnection;

  function PatchedRTCPeerConnection(
      this: RTCPeerConnection, config?: RTCConfiguration, ...rest: unknown[]
  ) {
    const mergedConfig: RTCConfiguration = {
      ...config,
      iceServers: [ ...(config?.iceServers || []), ...cachedServers ],
    };

    // Must be called via `new`, exactly like the native constructor -- Reflect.construct keeps
    // that semantics while still letting us hand it our own (merged) config argument.
    return Reflect.construct(NativeRTCPeerConnection, [ mergedConfig, ...rest ], PatchedRTCPeerConnection);
  }

  PatchedRTCPeerConnection.prototype = NativeRTCPeerConnection.prototype;
  Object.setPrototypeOf(PatchedRTCPeerConnection, NativeRTCPeerConnection);
  window.RTCPeerConnection = PatchedRTCPeerConnection as unknown as typeof RTCPeerConnection;
}

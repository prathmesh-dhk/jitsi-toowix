import { useCallback, useEffect, useRef, useState } from 'react';

// Type-only -- the runtime implementations (TensorFlow/MediaPipe segmentation model, RNNoise
// WASM module) are heavy and only actually needed if a participant turns these features on, so
// they're dynamically import()'d at the point of use below instead of bundled into every page
// load. This was previously a static top-level import, bundling both into the main chunk for
// every single join regardless of whether either feature was ever touched.
import type { IVirtualBackground } from './virtualBackground/JitsiStreamBackgroundEffect';
import type { NoiseSuppressionEffect } from './noiseSuppression/NoiseSuppressionEffect';
import { PLAYBACK_START, PLAYBACK_STATUSES, SHARED_VIDEO } from './sharedVideo/constants';
import { extractYoutubeId, isSharingStatus, sendShareVideoCommand } from './sharedVideo/functions';
import {
  classifyNetwork,
  getMediaQualityPolicy,
  type INetworkMetrics,
  type LowDataMode,
  NETWORK_RECOVERY_STABLE_MS,
  NETWORK_STATS_INTERVAL_MS,
  type NetworkState
} from './networkQuality';

export interface ISharedVideoState {
  muted?: boolean;
  ownerId: string;
  status: string;
  time: number;
  videoUrl: string;
  volume?: number;
}

// Direct lib-jitsi-meet integration for MeetingRoomPage's own Google-Meet-style UI -- no Jitsi
// IFrame. Unlike the IFrame API, we now own the real local/remote MediaStreamTracks directly
// (no cross-origin restriction), so this hook exposes plain MediaStreams matching the shape
// MeetingRoomPage's existing UI/PiP code already expects (inCallStream, screenStream,
// remoteScreenStream) instead of inventing a new track-based API surface.
//
// FIRST PASS scope: connect, join, local+remote audio/video, mute/unmute, screen share, device
// switching. Recording and raise-hand are intentionally NOT wrapped here -- the JitsiConference
// (`room`) is exposed directly so the page can call room.startRecording/stopRecording/
// setLocalParticipantProperty itself, since those are one-line passthroughs not worth a second
// API layer.

declare global {
  interface Window {
    JitsiMeetJS: any;
    config: any;
  }
}

export interface IRemoteParticipant {
  id: string;
  name: string;
  avatarUrl: string | null;
  isModerator: boolean;
  muted: boolean;
  video: boolean;
  raisedHand: boolean;
  stream: MediaStream | null;
  audioStream: MediaStream | null;
}

interface IUseJitsiMeetingOptions {
  jitsiDomain: string;
  roomName: string;
  jwt: string | undefined;
  displayName: string;
  enabled: boolean;
  startWithAudioMuted: boolean;
  startWithVideoMuted: boolean;
  audioDeviceId?: string;
  videoDeviceId?: string;
  onKicked?: () => void;
  // Fired when the local mic gets muted by something other than this app's own toggleAudio()
  // call -- in practice, a moderator's muteParticipant(). Never fires for a self-click.
  onForceMuted?: () => void;
  // An already-open MediaStream (e.g. from a prejoin lobby preview) whose live audio/video
  // tracks should be adopted directly instead of requesting fresh ones from the browser. Read
  // once, at the moment local track acquisition starts -- not reactive, since re-adopting on
  // every render would be wrong (see existingStreamRef below).
  existingStream?: MediaStream | null;
}

let scriptLoadPromise: Promise<void> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);

    if (existing) {
      resolve();

      return;
    }
    const el = document.createElement('script');

    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.body.appendChild(el);
  });
}

async function ensureLibJitsiMeetLoaded(jitsiDomain: string): Promise<void> {
  if (window.JitsiMeetJS && window.config) {
    return;
  }
  if (!scriptLoadPromise) {
    scriptLoadPromise = (async () => {
      await loadScript(`https://${jitsiDomain}/config.js`);
      await loadScript('/lib-jitsi-meet.min.js');
    })();
  }

  return scriptLoadPromise;
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const LOW_DATA_MODE_STORAGE_KEY = 'toowix_low_data_mode';
const EMPTY_NETWORK_METRICS: INetworkMetrics = {
  availableOutgoingBitrateKbps: null,
  candidateType: null,
  connectionState: null,
  jitterMs: null,
  packetLossPercent: null,
  rttMs: null,
  videoBitrateKbps: null
};

interface IPreviousVideoStats {
  bytesSent: number;
  timestamp: number;
}

function readLowDataMode(): LowDataMode {
  try {
    const saved = localStorage.getItem(LOW_DATA_MODE_STORAGE_KEY);

    if (saved === 'low-data' || saved === 'audio-only') {
      return saved;
    }
  } catch {
    // Storage can be unavailable in a restricted browser context. Auto is still safe.
  }

  return 'auto';
}

// Races a promise against a timeout WITHOUT abandoning the original promise -- it keeps running
// in the background (still resolving/rejecting the shared trackOperationQueueRef chain in
// runSerializedRoomOperation) so later queued operations are unaffected. This exists because
// room.removeTrack/addTrack/replaceTrack are real network+signaling calls with no timeout of
// their own; if one ever stalls (slow JVB response, a renegotiation hiccup), a bare `await`
// leaves the caller hanging forever with no way to update its own UI -- which is exactly what
// froze the screen-share tile on its last frame: stopScreenShareInternal awaited removeTrack
// before clearing isScreenSharing/localScreenStream, so a stalled removeTrack meant the tile
// never got the chance to clear.
function withTimeout<T>(promise: Promise<T>, ms: number, timeoutError: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutError)), ms);

    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      err => { clearTimeout(timer); reject(err); }
    );
  });
}

// lib-jitsi-meet wraps the native getUserMedia error into its OWN JitsiTrackError taxonomy and
// does not preserve the original DOMException name for anything it doesn't specifically
// recognize -- a real-hardware NotReadableError ("Could not start video/audio source", Chrome's
// own message text for it) comes out the other side as the generic JitsiTrackError name
// "gum.general", not "NotReadableError". Match on the message text too, since that's the only
// place the real cause survives.
function isTransientDeviceBusyError(err: any): boolean {
  const name = err?.name || '';
  const message = err?.message || '';

  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return true;
  }

  return name === 'gum.general' && /could not start (video|audio) source/i.test(message);
}

async function createLocalTrackWithRetry(JitsiMeetJS: any, options: any, attempts = 3): Promise<any> {
  let lastErr: any;

  for (let i = 0; i < attempts; i++) {
    if (i > 0) {
      await delay(400 * i);
    }
    try {
      const [ track ] = await JitsiMeetJS.createLocalTracks(options);

      return track ?? null;
    } catch (err: any) {
      lastErr = err;
      if (!isTransientDeviceBusyError(err)) {
        throw err;
      }
    }
  }

  throw lastErr;
}

export interface ILocalTrackAcquisitionResult {
  audioTrack: any | null;
  videoTrack: any | null;
  audioError: any | null;
  videoError: any | null;
}

// Requesting getUserMedia with no deviceId at all (letting the browser pick "the default") is
// what left the camera black on first join: with more than one camera-like device present (a
// virtual cam, a second webcam, etc.) the browser's own default-device resolution can silently
// return a track that never produces a frame, while asking for a SPECIFIC deviceId -- exactly
// what manually reselecting the camera from the device menu does -- works reliably. Resolve one
// explicitly up front so the very first join gets the same treatment as a manual reselect.
async function resolveExplicitDeviceId(kind: 'audioinput' | 'videoinput', preferredId: string | undefined): Promise<string | undefined> {
  if (preferredId) {
    return preferredId;
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const match = devices.find(d => d.kind === kind && d.deviceId);

    return match?.deviceId || undefined;
  } catch {
    return undefined;
  }
}

// Adopts already-live tracks from an existing MediaStream (typically the prejoin lobby's open
// camera/mic preview) as JitsiLocalTracks, with zero new getUserMedia() calls -- this is what
// actually eliminates the device-busy race, rather than just retrying around it. Falls back to
// a normal (retried) device request for whichever media type isn't available from the existing
// stream (e.g. camera permission was denied during prejoin, so only a mic track exists).
//
// Audio and video are acquired/adopted INDEPENDENTLY of each other and never throw into one
// another's path -- a camera failure must never prevent an audio-only join, and vice versa.
async function acquireLocalTracks(
    JitsiMeetJS: any,
    existingStream: MediaStream | null | undefined,
    audioDeviceId: string | undefined,
    videoDeviceId: string | undefined
): Promise<ILocalTrackAcquisitionResult> {
  const liveAudio = existingStream?.getAudioTracks().find(t => t.readyState === 'live') || null;
  const liveVideo = existingStream?.getVideoTracks().find(t => t.readyState === 'live') || null;

  const result: ILocalTrackAcquisitionResult = {
    audioTrack: null,
    videoTrack: null,
    audioError: null,
    videoError: null
  };

  if (liveAudio) {
    try {
      const [ adopted ] = await JitsiMeetJS.createLocalTracksFromMediaStreams([
        { stream: new MediaStream([ liveAudio ]), mediaType: 'audio' }
      ]);

      result.audioTrack = adopted ?? null;
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('[useJitsiMeeting] audio adoption failed, falling back to fresh acquisition:', err?.name, err?.message, err);
    }
  }
  if (liveVideo) {
    try {
      const [ adopted ] = await JitsiMeetJS.createLocalTracksFromMediaStreams([
        { stream: new MediaStream([ liveVideo ]), mediaType: 'video', videoType: 'camera' }
      ]);

      result.videoTrack = adopted ?? null;
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('[useJitsiMeeting] video adoption failed, falling back to fresh acquisition:', err?.name, err?.message, err);
    }
  }

  if (!result.audioTrack) {
    try {
      const explicitAudioId = await resolveExplicitDeviceId('audioinput', audioDeviceId);

      result.audioTrack = await createLocalTrackWithRetry(JitsiMeetJS, {
        devices: [ 'audio' ],
        micDeviceId: explicitAudioId
      });
    } catch (err) {
      result.audioError = err;
    }
  }

  if (!result.videoTrack) {
    try {
      const explicitVideoId = await resolveExplicitDeviceId('videoinput', videoDeviceId);

      result.videoTrack = await createLocalTrackWithRetry(JitsiMeetJS, {
        devices: [ 'video' ],
        cameraDeviceId: explicitVideoId
      });
    } catch (err) {
      result.videoError = err;
    }
  }

  return result;
}

function trackToStream(track: any): MediaStream | null {
  if (!track) {
    return null;
  }
  if (track.stream) {
    return track.stream;
  }
  const nativeTrack = typeof track.getTrack === 'function' ? track.getTrack() : null;

  return nativeTrack ? new MediaStream([ nativeTrack ]) : null;
}

// Classifies a getUserMedia-style failure (native DOMException name, or lib-jitsi-meet's own
// JitsiTrackError name/message) into an exact, user-facing message -- never collapsed down to a
// generic "gum.general" catch-all so the real cause stays visible.
function describeMediaError(kind: 'microphone' | 'camera', err: any): string {
  if (!window.isSecureContext) {
    return `Camera/microphone access requires HTTPS (or localhost). This page was loaded over an insecure connection.`;
  }

  const name = err?.name || '';
  const message = err?.message || '';

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'gum.permission_denied') {
    return `${kind === 'microphone' ? 'Microphone' : 'Camera'} permission denied. Please allow access in your browser settings.`;
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'gum.not_found') {
    return `No ${kind} found. Please connect a ${kind}.`;
  }
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
    return `The selected ${kind} does not support the requested settings. Falling back to the system default.`;
  }
  if (isTransientDeviceBusyError(err)) {
    return `${kind === 'microphone' ? 'Microphone' : 'Camera'} is currently in use by another application or tab.`;
  }

  return `Could not access ${kind} (${name || message || 'unknown error'}).`;
}

export function useJitsiMeeting({
  jitsiDomain,
  roomName,
  jwt,
  displayName,
  enabled,
  startWithAudioMuted,
  startWithVideoMuted,
  audioDeviceId,
  videoDeviceId,
  onKicked,
  onForceMuted,
  existingStream
}: IUseJitsiMeetingOptions) {
  const [ connected, setConnected ] = useState(false);
  const [ joined, setJoined ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);
  const [ cameraError, setCameraError ] = useState<string | null>(null);
  const [ localAudioMuted, setLocalAudioMuted ] = useState(startWithAudioMuted);
  // Confirmed via direct Jicofo/JVB log inspection: neither room.removeTrack() nor
  // room.replaceTrack(track, null) actually notifies the server once the browser's native
  // "Stop sharing" bar has already ended the underlying track -- the bridge keeps believing the
  // desktop source is live until this participant's whole session ends. Bumping this forces the
  // main connect effect (keyed on it below) to fully leave and rejoin the conference, which DOES
  // reliably give the server an accurate, current source list (verified: every fresh
  // session-initiate in the JVB logs correctly reflects only the joining client's real tracks).
  const [ reconnectEpoch, setReconnectEpoch ] = useState(0);
  // Debounced so a quick re-share right after stopping isn't torn down by a reconnect meant for
  // the PREVIOUS stop -- cleared whenever a new share starts, scheduled fresh on every stop.
  const pendingReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ localVideoMuted, setLocalVideoMuted ] = useState(startWithVideoMuted);
  const [ hasVideoTrack, setHasVideoTrack ] = useState(false);
  const [ localCameraStream, setLocalCameraStream ] = useState<MediaStream | null>(null);
  const [ localScreenStream, setLocalScreenStream ] = useState<MediaStream | null>(null);
  const [ isScreenSharing, setIsScreenSharing ] = useState(false);
  const [ remoteParticipants, setRemoteParticipants ] = useState<Record<string, IRemoteParticipant>>({});
  const [ networkState, setNetworkState ] = useState<NetworkState>('GOOD');
  const [ lowDataMode, setLowDataModeState ] = useState<LowDataMode>(readLowDataMode);
  // This is sourced from the live conference role, rather than from the token that admitted
  // the user. It lets someone who is promoted during a meeting receive moderator controls
  // without having to leave and rejoin.
  const [ isModerator, setIsModerator ] = useState(false);
  const [ remoteScreenShare, setRemoteScreenShare ] = useState<{ stream: MediaStream; presenterName: string } | null>(null);
  // Native Jitsi/JVB-computed dominant speaker (real audio-level based detection, not a
  // client-side guess) -- 'local' when the local user is currently the loudest, a remote
  // participant id otherwise, or null before anyone has spoken. Drives speaker-view auto-follow.
  const [ dominantSpeakerId, setDominantSpeakerId ] = useState<string | null>(null);
  const [ localParticipantId, setLocalParticipantId ] = useState<string | null>(null);
  // Real, JVB/Jibri-confirmed recording state -- driven by RECORDER_STATE_CHANGED, which fires
  // for EVERY participant (it rides XMPP presence broadcast to the whole room, not just the
  // person who clicked start), unlike a locally-optimistic flag that only the initiator would
  // ever see. recordingSessionId is required by stopRecording(sessionID) -- calling stop
  // without it silently fails to send a clean stop signal to Jibri, which is what was producing
  // unplayable/corrupt recordings (Jibri needs a real stop to finalize the file).
  const [ recording, setRecording ] = useState(false);
  const recordingSessionIdRef = useRef<string | null>(null);
  // Shared-video (YouTube) state -- ported from jitsi-meet's react/features/shared-video
  // (SHARED_VIDEO XMPP command protocol, same command name/attribute shape, so this is wire
  // compatible with stock Jitsi). null when nobody is sharing. Mirrored into a ref because the
  // room-level command listener (registered once, at room setup) closes over stale state
  // otherwise -- same reasoning as the other refs in this hook.
  const [ sharedVideo, setSharedVideo ] = useState<ISharedVideoState | null>(null);
  const sharedVideoRef = useRef<ISharedVideoState | null>(null);

  // Shared refs: always point at the CURRENT (latest, non-stale) generation's live objects, once
  // one exists. Read by toggleAudio/toggleVideo/switchDevice/toggleScreenShare, which are
  // triggered by explicit user actions, not by this effect's own lifecycle.
  const connectionRef = useRef<any>(null);
  const roomRef = useRef<any>(null);
  const localAudioTrackRef = useRef<any>(null);
  const localVideoTrackRef = useRef<any>(null);
  const localDesktopTrackRef = useRef<any>(null);
  const networkStateRef = useRef<NetworkState>('GOOD');
  const lowDataModeRef = useRef<LowDataMode>(lowDataMode);
  const networkMetricsRef = useRef<INetworkMetrics>(EMPTY_NETWORK_METRICS);
  const previousVideoStatsRef = useRef<IPreviousVideoStats | null>(null);
  const poorSampleCountRef = useRef(0);
  const degradedSampleCountRef = useRef(0);
  const goodSinceRef = useRef<number | null>(null);
  const lastAppliedQualityKeyRef = useRef<string | null>(null);
  // Only this mode is allowed to mute/unmute the camera automatically. A manual user mute must
  // never be undone when the network recovers or Low Data Mode changes.
  const audioOnlyMutedVideoRef = useRef(false);
  // Guards stopScreenShareInternal against running twice concurrently -- disposing the desktop
  // track can itself fire the browser's native 'ended' event a second time (surfaced by
  // lib-jitsi-meet as another LOCAL_TRACK_STOPPED), which would otherwise re-enter the stop path
  // while the first call is still in flight.
  const desktopStopInFlightRef = useRef(false);
  // Guards the START path the same way desktopStopInFlightRef guards the stop path.
  // createLocalTracks({ devices: ['desktop'] }) awaits the OS share picker before resolving, and
  // localDesktopTrackRef.current isn't set until AFTER that resolves -- so a rapid double
  // click/tap on the toggle button (or two independent callers) used to run the picker twice
  // and call room.addTrack twice. The first addTrack succeeds; the second then hits
  // lib-jitsi-meet's "only one local track per videoType" check in JitsiConference.addTrack
  // (rtc.getLocalTracks(VIDEO) already contains the first desktop track) and rejects with
  // "Cannot add second video track to the conference" -- this is the exact failure confirmed in
  // production ("screen share track failed after picker succeeded"), not a server-timing issue.
  const desktopStartInFlightRef = useRef(false);
  // room.addTrack/removeTrack/replaceTrack each trigger a real WebRTC SDP renegotiation with the
  // JVB. Screen-share start/stop, camera device switching, and the camera-retry-after-busy-error
  // path (toggleVideo) can each independently call one of these -- with no coordination between
  // them, two such calls firing close together (e.g. a screen-share stop landing at the same
  // moment a camera retry succeeds and re-adds the camera track) can race each other's
  // offer/answer cycles. Confirmed in production: a remote participant's console showed
  // "No SSRC lines found in remote SDP ... track creation failed" for the OTHER participant's
  // camera track right as a screen-share stop was also negotiating, which corrupted that peer
  // connection's state badly enough that the connection eventually broke down entirely. Routing
  // every one of these calls through this single promise chain guarantees only one such
  // negotiation is ever in flight against this room at a time.
  const trackOperationQueueRef = useRef<Promise<any>>(Promise.resolve());
  const remoteDesktopTracksRef = useRef<Record<string, any>>({});
  const remoteNamesRef = useRef<Record<string, string>>({});
  const remoteAvatarsRef = useRef<Record<string, string | null>>({});
  const onKickedRef = useRef(onKicked);
  const onForceMutedRef = useRef(onForceMuted);
  const selfInitiatedMuteRef = useRef(false);
  const existingStreamRef = useRef(existingStream);
  const cameraRetryInFlightRef = useRef(false);
  const deviceIdsRef = useRef({ audioDeviceId, videoDeviceId });
  // Currently-active virtual background (blur/image), if any -- re-applied to a freshly acquired
  // video track (device switch, or re-acquiring after the track was fully disposed) since a new
  // JitsiLocalTrack instance doesn't inherit the previous instance's effect. Mute/unmute of the
  // SAME track instance re-applies the effect automatically inside lib-jitsi-meet itself, so that
  // path needs no extra handling here.
  const virtualBackgroundRef = useRef<{ config: IVirtualBackground; effect: any } | null>(null);

  const applyVirtualBackgroundToTrack = useCallback(async (track: any) => {
    if (!virtualBackgroundRef.current || !track) {
      return;
    }
    try {
      await track.setEffect(virtualBackgroundRef.current.effect);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[useJitsiMeeting] failed to re-apply virtual background to new track:', err);
    }
  }, []);

  // Same idea as virtualBackgroundRef, for the mic noise-suppression effect -- re-applied to a
  // freshly acquired audio track (mic device switch) since a new JitsiLocalTrack instance
  // doesn't inherit the previous instance's effect. Mute/unmute of the SAME track re-applies
  // automatically inside lib-jitsi-meet itself.
  const noiseSuppressionRef = useRef<{ effect: NoiseSuppressionEffect } | null>(null);
  const [ noiseSuppressionEnabled, setNoiseSuppressionEnabled ] = useState(false);

  const applyNoiseSuppressionToTrack = useCallback(async (track: any) => {
    if (!noiseSuppressionRef.current || !track) {
      return;
    }
    try {
      await track.setEffect(noiseSuppressionRef.current.effect);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[useJitsiMeeting] failed to re-apply noise suppression to new track:', err);
    }
  }, []);

  // Plain synchronous assignments during render (NOT inside useEffect) -- these values are read
  // later from inside an async continuation (acquireLocalTracks, the KICKED handler, switchDevice)
  // that needs the LATEST value at the moment it actually runs, not whatever was captured when
  // some earlier effect last fired. A useEffect-based sync (`useEffect(() => { ref.current = x }, [x])`)
  // is NOT equivalent to this: proved unreliable here in practice (existingStream's sync effect
  // fired only twice total, both during the initial mount, and never again despite the prop
  // demonstrably changing value across many subsequent renders -- the direct assignment below
  // fixes that by construction, since it runs on every render with no dependency array to miss).
  onKickedRef.current = onKicked;
  onForceMutedRef.current = onForceMuted;
  existingStreamRef.current = existingStream;
  deviceIdsRef.current = { audioDeviceId, videoDeviceId };

  // Runs `fn` only after every previously-queued room operation has settled (see
  // trackOperationQueueRef above for why). `.then(fn, fn)` -- not `.then(fn).catch(...)` -- so a
  // PRIOR failed operation still lets this one run instead of leaving the queue stuck forever;
  // the queue's own stored promise is separately caught so one failure can't reject the chain
  // for whichever operation queues next.
  const runSerializedRoomOperation = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const result = trackOperationQueueRef.current.then(fn, fn);

    trackOperationQueueRef.current = result.catch(() => undefined);

    return result;
  }, []);

  const patchParticipant = useCallback((id: string, patch: Partial<IRemoteParticipant>) => {
    setRemoteParticipants(prev => ({
      ...prev,
      [id]: {
        id,
        name: prev[id]?.name ?? remoteNamesRef.current[id] ?? 'Participant',
        avatarUrl: prev[id]?.avatarUrl ?? remoteAvatarsRef.current[id] ?? null,
        isModerator: prev[id]?.isModerator ?? false,
        muted: prev[id]?.muted ?? true,
        video: prev[id]?.video ?? false,
        raisedHand: prev[id]?.raisedHand ?? false,
        stream: prev[id]?.stream ?? null,
        audioStream: prev[id]?.audioStream ?? null,
        ...patch
      }
    }));
  }, []);

  // Applies only public lib-jitsi-meet receiver/sender controls. This does not acquire a new
  // camera/microphone stream and does not manipulate individual video frames.
  const applyMediaQualityPolicy = useCallback(async (
    requestedState = networkStateRef.current,
    requestedMode = lowDataModeRef.current
  ) => {
    const room = roomRef.current;

    if (!room) {
      return;
    }
    const participantCount = room.getParticipants?.().length || 0;
    const policy = getMediaQualityPolicy(requestedMode, requestedState, participantCount);
    const key = [ requestedMode, requestedState, participantCount >= 8 ? 'large' : 'normal' ].join(':');

    if (lastAppliedQualityKeyRef.current === key) {
      return;
    }
    try {
      room.setLastN?.(policy.lastN);
      room.setReceiverVideoConstraint?.(policy.receiveMaxHeight);
      room.setDesktopSharingFrameRate?.(policy.desktopFps);
      await Promise.resolve(room.setSenderVideoConstraint?.(policy.sendMaxHeight));

      const cameraTrack = localVideoTrackRef.current;
      if (policy.audioOnly && cameraTrack && !cameraTrack.isMuted?.()) {
        await cameraTrack.mute();
        audioOnlyMutedVideoRef.current = true;
        setLocalVideoMuted(true);
      } else if (!policy.audioOnly && audioOnlyMutedVideoRef.current && cameraTrack?.isMuted?.()) {
        await cameraTrack.unmute();
        audioOnlyMutedVideoRef.current = false;
        setLocalVideoMuted(false);
        // Same reason toggleVideo() does this on its own unmute path: the underlying track
        // resumes producing frames immediately, but nothing tells the already-mounted self-view/
        // PiP <video> elements to actually rebind to it -- without a fresh MediaStream wrapper,
        // they can sit stalled on whatever they last had (black, or a frozen old frame) until
        // some unrelated re-render happens to touch them. This is what showed up as switching
        // off Audio-only mode not turning the camera back on "directly."
        setLocalCameraStream(trackToStream(cameraTrack));
      }
      lastAppliedQualityKeyRef.current = key;
      if (import.meta.env.DEV || import.meta.env.VITE_JITSI_DIAGNOSTICS === 'true') {
        // Do not include meeting, token, or participant data in diagnostics.
        console.info('[Toowix network] media quality applied', { mode: requestedMode, state: requestedState, policy });
      }
    } catch (err) {
      // A particular older bridge/browser can reject a quality preference. Media must keep
      // flowing with Jitsi defaults rather than treating this as a call failure.
      if (import.meta.env.DEV || import.meta.env.VITE_JITSI_DIAGNOSTICS === 'true') {
        console.warn('[Toowix network] could not apply media quality preference', err);
      }
    }
  }, []);

  const setLowDataMode = useCallback(async (mode: LowDataMode) => {
    lowDataModeRef.current = mode;
    setLowDataModeState(mode);
    lastAppliedQualityKeyRef.current = null;
    try {
      localStorage.setItem(LOW_DATA_MODE_STORAGE_KEY, mode);
    } catch {
      // A storage failure must not block a temporary in-call preference.
    }

    // Segmentation effects are intentionally disabled for data-saving modes. They consume
    // local CPU/GPU and can worsen encode stability on weak devices.
    if (mode !== 'auto' && virtualBackgroundRef.current) {
      virtualBackgroundRef.current = null;
      try {
        await localVideoTrackRef.current?.setEffect(undefined);
      } catch {
        // Quality controls remain useful even if a browser refuses to remove an effect.
      }
    }
    await applyMediaQualityPolicy(networkStateRef.current, mode);
  }, [ applyMediaQualityPolicy ]);

  const updateNetworkStateFromMetrics = useCallback(async (metrics: INetworkMetrics) => {
    networkMetricsRef.current = metrics;
    const observed = classifyNetwork(metrics);
    const now = Date.now();
    const current = networkStateRef.current;
    let next = current;

    if (observed === 'POOR') {
      poorSampleCountRef.current += 1;
      degradedSampleCountRef.current = 0;
      goodSinceRef.current = null;
      // A disconnected/failed connection is acted on immediately. Otherwise two consecutive
      // samples avoid lowering video for a short stats spike.
      if ([ 'disconnected', 'failed', 'closed' ].includes(metrics.connectionState || '') || poorSampleCountRef.current >= 2) {
        next = 'POOR';
      }
    } else if (observed === 'DEGRADED') {
      poorSampleCountRef.current = 0;
      degradedSampleCountRef.current += 1;
      goodSinceRef.current = null;
      if (degradedSampleCountRef.current >= 2 && current !== 'POOR') {
        next = 'DEGRADED';
      }
    } else {
      poorSampleCountRef.current = 0;
      degradedSampleCountRef.current = 0;
      if (current === 'GOOD') {
        next = 'GOOD';
      } else {
        goodSinceRef.current ||= now;
        const stableFor = now - goodSinceRef.current;

        if (stableFor >= NETWORK_RECOVERY_STABLE_MS && current !== 'RECOVERING') {
          next = 'RECOVERING';
        } else if (stableFor >= NETWORK_RECOVERY_STABLE_MS * 2 && current === 'RECOVERING') {
          next = 'GOOD';
          goodSinceRef.current = null;
        }
      }
    }

    if (next !== current) {
      networkStateRef.current = next;
      setNetworkState(next);
      lastAppliedQualityKeyRef.current = null;
      await applyMediaQualityPolicy(next);
      if (import.meta.env.DEV || import.meta.env.VITE_JITSI_DIAGNOSTICS === 'true') {
        console.info('[Toowix network] state changed', { state: next, metrics });
      }
    }
  }, [ applyMediaQualityPolicy ]);

  // Poll the active Jitsi peer connection at a deliberately low rate. Raw samples stay in refs;
  // the page only re-renders when the small GOOD/DEGRADED/POOR/RECOVERING state changes.
  useEffect(() => {
    if (!joined) {
      return;
    }
    let disposed = false;

    const collectNetworkMetrics = async () => {
      const room = roomRef.current;
      const connectionState = room?.getConnectionState?.() || null;
      const jitsiPeerConnection = room?.getActivePeerConnection?.();
      const peerConnection = jitsiPeerConnection?.peerconnection;

      if (!room || !peerConnection?.getStats) {
        await updateNetworkStateFromMetrics({ ...EMPTY_NETWORK_METRICS, connectionState });

        return;
      }
      try {
        const stats: RTCStatsReport = await peerConnection.getStats();
        if (disposed) {
          return;
        }
        const localCandidates = new Map<string, any>();
        let selectedPair: any = null;
        let packetsLost = 0;
        let packetsReceived = 0;
        let jitterSeconds: number | null = null;
        let videoBytesSent = 0;

        stats.forEach((report: any) => {
          if (report.type === 'local-candidate') {
            localCandidates.set(report.id, report);
          }
          if (report.type === 'candidate-pair' && (report.selected || (report.nominated && report.state === 'succeeded'))) {
            selectedPair = report;
          }
          const mediaKind = report.kind || report.mediaType;
          if ((report.type === 'inbound-rtp' || report.type === 'remote-inbound-rtp') && (mediaKind === 'audio' || mediaKind === 'video')) {
            packetsLost += Number(report.packetsLost) || 0;
            packetsReceived += Number(report.packetsReceived) || 0;
            if (mediaKind === 'audio' && Number.isFinite(report.jitter)) {
              jitterSeconds = Math.max(jitterSeconds || 0, Number(report.jitter));
            }
          }
          if (report.type === 'outbound-rtp' && mediaKind === 'video') {
            videoBytesSent += Number(report.bytesSent) || 0;
          }
        });

        const now = performance.now();
        const previous = previousVideoStatsRef.current;
        let videoBitrateKbps: number | null = null;
        if (previous && now > previous.timestamp && videoBytesSent >= previous.bytesSent) {
          videoBitrateKbps = ((videoBytesSent - previous.bytesSent) * 8) / (now - previous.timestamp);
        }
        previousVideoStatsRef.current = { bytesSent: videoBytesSent, timestamp: now };
        const localCandidate = selectedPair?.localCandidateId ? localCandidates.get(selectedPair.localCandidateId) : null;
        const availableOutgoingBitrate = Number(selectedPair?.availableOutgoingBitrate);
        const currentRoundTripTime = Number(selectedPair?.currentRoundTripTime);
        const packetTotal = packetsLost + packetsReceived;

        await updateNetworkStateFromMetrics({
          availableOutgoingBitrateKbps: Number.isFinite(availableOutgoingBitrate) ? availableOutgoingBitrate / 1000 : null,
          candidateType: localCandidate?.candidateType || null,
          connectionState,
          jitterMs: jitterSeconds === null ? null : jitterSeconds * 1000,
          packetLossPercent: packetTotal > 0 ? (packetsLost / packetTotal) * 100 : null,
          rttMs: Number.isFinite(currentRoundTripTime) ? currentRoundTripTime * 1000 : null,
          videoBitrateKbps
        });
      } catch (err) {
        if (import.meta.env.DEV || import.meta.env.VITE_JITSI_DIAGNOSTICS === 'true') {
          console.warn('[Toowix network] WebRTC stats collection failed', err);
        }
      }
    };

    void applyMediaQualityPolicy();
    void collectNetworkMetrics();
    const timer = window.setInterval(() => void collectNetworkMetrics(), NETWORK_STATS_INTERVAL_MS);

    return () => {
      disposed = true;
      window.clearInterval(timer);
      previousVideoStatsRef.current = null;
    };
  }, [ applyMediaQualityPolicy, joined, updateNetworkStateFromMetrics ]);

  // When presenter A stops and presenter B starts right after, A's TRACK_REMOVED fires (which
  // would clear remoteScreenShare to null) before B's TRACK_ADDED arrives moments later -- that
  // brief null forces the whole presentation stage to unmount back to tile view and then
  // immediately remount for B, which is what showed up as a laggy/stuck handoff between
  // presenters. Debounce the "nobody is sharing" clear slightly so a same-beat handoff never
  // produces that flicker; a real "everyone stopped sharing" still clears, just ~600ms later.
  const screenShareClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // True only while the track's underlying native MediaStreamTrack can still produce frames.
  // A JitsiTrack whose native track already has readyState 'ended' will never emit another
  // frame -- treating it as "active" is exactly what shows a permanently frozen last frame.
  const isDesktopTrackUsable = (track: any): boolean => {
    const nativeTrack = typeof track.getTrack === 'function' ? track.getTrack() : null;

    return !nativeTrack || nativeTrack.readyState !== 'ended';
  };

  const recomputeRemoteScreenShare = useCallback(() => {
    if (screenShareClearTimerRef.current) {
      clearTimeout(screenShareClearTimerRef.current);
      screenShareClearTimerRef.current = null;
    }

    // Defensive purge: the native browser "Stop sharing" bar can make lib-jitsi-meet emit
    // TRACK_MUTE_CHANGED (unmuted) and TRACK_REMOVED for the same track slightly out of order.
    // If a stray "unmuted" event lands AFTER the track has actually ended, the old code would
    // re-insert a dead track here with nothing left to ever clear it -- a permanent frozen
    // frame on the viewer's side. Strip any already-ended entries before deciding what's active,
    // regardless of which event path let them in.
    for (const [ participantId, track ] of Object.entries(remoteDesktopTracksRef.current)) {
      if (!isDesktopTrackUsable(track)) {
        // eslint-disable-next-line no-console
        console.log('[SCREEN-SHARE-DEBUG] purging dead desktop track, participantId:', participantId);
        delete remoteDesktopTracksRef.current[participantId];
      }
    }

    const entries = Object.entries(remoteDesktopTracksRef.current);
    // TEMP diagnostic for the "viewer's screen-share freezes after presenter stops" investigation
    // -- remove once confirmed fixed. Unconditional (not DEV-gated) so it shows up on the
    // production build being tested against.
    // eslint-disable-next-line no-console
    console.log('[SCREEN-SHARE-DEBUG] recomputeRemoteScreenShare, entryCount:', entries.length, 'ids:', entries.map(([ pid ]) => pid));

    if (entries.length === 0) {
      screenShareClearTimerRef.current = setTimeout(() => {
        screenShareClearTimerRef.current = null;
        // eslint-disable-next-line no-console
        console.log('[SCREEN-SHARE-DEBUG] clear timer fired, setting remoteScreenShare to null');
        setRemoteScreenShare(null);
      }, 600);

      return;
    }
    const [ id, track ] = entries[entries.length - 1];
    const stream = trackToStream(track);
    // eslint-disable-next-line no-console
    console.log('[SCREEN-SHARE-DEBUG] keeping remoteScreenShare active, presenterId:', id, 'trackMuted:', track.isMuted(), 'streamActive:', stream?.active, 'streamTracks:', stream?.getTracks().map(t => ({ readyState: t.readyState, muted: t.muted })));

    setRemoteScreenShare(stream ? { stream, presenterName: remoteNamesRef.current[id] || 'Participant' } : null);
  }, []);

  // Monotonic generation counter -- this is what actually makes initialization idempotent under
  // React 18 StrictMode's dev-only mount -> cleanup -> mount double-invoke (or any other
  // duplicate-effect scenario). A single shared boolean ("disposedRef") is NOT sufficient here:
  // cleanup1 sets it true, but setup2 immediately resets it back to false as its first line, so
  // when invocation 1's async work resumes later it reads a flag that's already been reset by a
  // NEWER invocation and wrongly believes it's still current -- resulting in two fully separate,
  // real, concurrent connection+room+getUserMedia attempts. A generation number captured in a
  // `const` at the top of each invocation's closure is immune to this: it can only ever be
  // compared, never silently reset out from under a stale invocation by a newer one.
  const generationRef = useRef(0);

  useEffect(() => {
    if (!enabled || !jwt || !roomName) {
      return;
    }

    const myGeneration = ++generationRef.current;
    const isStale = () => generationRef.current !== myGeneration;

    // Local (per-invocation) handles -- deliberately NOT the shared refs above. The cleanup
    // below disposes exactly what THIS invocation created, even if a newer invocation has
    // already overwritten the shared refs with its own objects by the time this cleanup runs.
    let myConnection: any = null;
    let myRoom: any = null;
    let myAudioTrack: any = null;
    let myVideoTrack: any = null;
    let myAddTrackInterval: any = null;

    (async () => {
      try {
        await ensureLibJitsiMeetLoaded(jitsiDomain);
        if (isStale()) {
          return;
        }

        if (!window.isSecureContext) {
          setError('Camera/microphone access requires HTTPS (or localhost). This page was loaded over an insecure connection.');

          return;
        }

        const JitsiMeetJS = window.JitsiMeetJS;
        const config = window.config;

        JitsiMeetJS.setLogLevel(JitsiMeetJS.logLevels.ERROR);
        JitsiMeetJS.init({ disableAudioLevels: false });

        const connection = new JitsiMeetJS.JitsiConnection(null, jwt, {
          ...config,
          hosts: config.hosts,
          serviceUrl: config.websocket || config.bosh
        });

        myConnection = connection;

        connection.addEventListener(
          JitsiMeetJS.events.connection.CONNECTION_ESTABLISHED,
          () => {
            if (isStale()) {
              try {
                connection.disconnect();
              } catch {
                // best-effort
              }

              return;
            }
            connectionRef.current = connection;
            setConnected(true);

            const room = connection.initJitsiConference(roomName.toLowerCase(), {
              ...config,
              openBridgeChannel: true
            });

            myRoom = room;
            roomRef.current = room;

            room.on(JitsiMeetJS.events.conference.TRACK_ADDED, (track: any) => {
              if (track.isLocal()) {
                return;
              }
              const participantId = track.getParticipantId();
              const trackParticipant = room.getParticipantById(participantId);

              // Same hidden-Jibri guard as USER_JOINED -- a recorder track slipping through here
              // would still create a fake participant tile via patchParticipant's upsert.
              if (trackParticipant?.isHidden?.() || trackParticipant?.getBotType?.()) {
                return;
              }

              const type = track.getType();
              const videoType = typeof track.getVideoType === 'function' ? track.getVideoType() : 'camera';

              if (type === 'audio') {
                // eslint-disable-next-line no-console
                console.log('[TILE-DEBUG] remote AUDIO TRACK_ADDED, participantId:', participantId, 'isMuted:', track.isMuted());
                patchParticipant(participantId, { audioStream: trackToStream(track), muted: track.isMuted() });
              } else if (videoType === 'desktop') {
                // A desktop track that arrives already muted must not be shown as an active
                // presentation -- Jitsi can deliver a track in a muted state before the first
                // real frame, and registering it here would present a black/frozen tile until
                // (if ever) it unmutes.
                // eslint-disable-next-line no-console
                console.log('[SCREEN-SHARE-DEBUG] remote desktop TRACK_ADDED, participantId:', participantId, 'isMuted:', track.isMuted());
                if (!track.isMuted() && isDesktopTrackUsable(track)) {
                  remoteDesktopTracksRef.current[participantId] = track;
                }
                recomputeRemoteScreenShare();
              } else {
                // eslint-disable-next-line no-console
                console.log('[TILE-DEBUG] remote CAMERA TRACK_ADDED, participantId:', participantId, 'isMuted:', track.isMuted(), 'nativeReadyState:', track.getTrack?.()?.readyState);
                patchParticipant(participantId, { stream: trackToStream(track), video: !track.isMuted() });
              }

              track.addEventListener(JitsiMeetJS.events.track.TRACK_MUTE_CHANGED, () => {
                if (type === 'audio') {
                  patchParticipant(participantId, { muted: track.isMuted() });
                } else if (videoType === 'desktop') {
                  // This is the real signal Jitsi uses to stop a screen share in many cases --
                  // muting the existing desktop track rather than immediately removing it. This
                  // listener used to ignore desktop entirely, which is why a stopped share left
                  // remoteDesktopTracksRef (and therefore the remote presentation view) pointing
                  // at a track that had stopped producing frames: the last frame froze on
                  // screen and never cleared.
                  // eslint-disable-next-line no-console
                  console.log('[SCREEN-SHARE-DEBUG] remote desktop TRACK_MUTE_CHANGED, participantId:', participantId, 'isMuted:', track.isMuted(), 'isSameTrackInRef:', remoteDesktopTracksRef.current[participantId] === track);
                  if (track.isMuted() || !isDesktopTrackUsable(track)) {
                    if (remoteDesktopTracksRef.current[participantId] === track) {
                      delete remoteDesktopTracksRef.current[participantId];
                    }
                  } else {
                    remoteDesktopTracksRef.current[participantId] = track;
                  }
                  recomputeRemoteScreenShare();
                } else {
                  // eslint-disable-next-line no-console
                  console.log('[TILE-DEBUG] remote CAMERA TRACK_MUTE_CHANGED, participantId:', participantId, 'isMuted:', track.isMuted());
                  patchParticipant(participantId, { video: !track.isMuted() });
                }
              });
            });

            room.on(JitsiMeetJS.events.conference.TRACK_REMOVED, (track: any) => {
              if (track.isLocal()) {
                return;
              }
              const participantId = track.getParticipantId();
              const type = track.getType();
              const videoType = typeof track.getVideoType === 'function' ? track.getVideoType() : 'camera';

              if (type === 'audio') {
                // eslint-disable-next-line no-console
                console.log('[TILE-DEBUG] remote AUDIO TRACK_REMOVED, participantId:', participantId);
                patchParticipant(participantId, { audioStream: null });
              } else if (videoType === 'desktop') {
                // Only delete if this is still the SAME track instance stored for this
                // participant. A late/stale TRACK_REMOVED for an old share (already superseded
                // by a newer desktop track added since) must not clear the current one out from
                // under it.
                // eslint-disable-next-line no-console
                console.log('[SCREEN-SHARE-DEBUG] remote desktop TRACK_REMOVED, participantId:', participantId, 'isSameTrackInRef:', remoteDesktopTracksRef.current[participantId] === track);
                if (remoteDesktopTracksRef.current[participantId] === track) {
                  delete remoteDesktopTracksRef.current[participantId];
                  recomputeRemoteScreenShare();
                }
              } else {
                // eslint-disable-next-line no-console
                console.log('[TILE-DEBUG] remote CAMERA TRACK_REMOVED, participantId:', participantId);
                patchParticipant(participantId, { stream: null, video: false });
              }
            });

            room.on(JitsiMeetJS.events.conference.USER_JOINED, (id: string, participant: any) => {
              // Jibri (the recording bot) joins the room as a real XMPP participant on the
              // server's hidden domain -- lib-jitsi-meet already flags it via isHidden()/
              // getBotType(), so skip it here or it shows up as a fake extra participant
              // the moment recording starts.
              if (participant?.isHidden?.() || participant?.getBotType?.()) {
                return;
              }

              const name = participant.getDisplayName() || 'Participant';
              // The JWT's context.user.avatar (see generateJitsiToken on the backend) is
              // propagated to every other participant as this "identity" -- it's the real
              // mechanism for remote avatars, not something lib-jitsi-meet exposes as a plain
              // getter. Only ever a short http(s) URL now (never a base64 blob -- see the JWT
              // fix), so no size concerns reading it back out here.
              const avatarUrl = participant.getIdentity?.()?.user?.avatar || null;

              remoteNamesRef.current[id] = name;
              remoteAvatarsRef.current[id] = avatarUrl;
              // TEMP diagnostic for the "join/leave freezes other tiles" investigation -- remove
              // once root-caused. Unconditional so it shows up on the production build.
              // eslint-disable-next-line no-console
              console.log('[TILE-DEBUG] USER_JOINED', id, name, 'at', new Date().toISOString());
              patchParticipant(id, {
                name,
                avatarUrl,
                isModerator: participant.getRole?.() === 'moderator'
              });
            });

            // A moderator promotion is applied by Jicofo/MUC and broadcast to every client.
            // Keep the roster and the local moderator controls in sync with that authoritative
            // conference event; do not optimistically mark a participant as a moderator.
            room.on(JitsiMeetJS.events.conference.USER_ROLE_CHANGED, (id: string, role: string) => {
              if (isStale()) {
                return;
              }
              const moderator = role === 'moderator';

              if (id === room.myUserId()) {
                setIsModerator(moderator);

                return;
              }
              patchParticipant(id, { isModerator: moderator });
            });

            room.on(JitsiMeetJS.events.conference.USER_LEFT, (id: string) => {
              // eslint-disable-next-line no-console
              console.log('[TILE-DEBUG] USER_LEFT', id, 'at', new Date().toISOString(), 'remainingIds:', Object.keys(remoteNamesRef.current).filter(x => x !== id));
              delete remoteNamesRef.current[id];
              delete remoteAvatarsRef.current[id];
              delete remoteDesktopTracksRef.current[id];
              recomputeRemoteScreenShare();
              setRemoteParticipants(prev => {
                const next = { ...prev };

                delete next[id];

                return next;
              });
            });

            room.on(JitsiMeetJS.events.conference.CONFERENCE_JOINED, () => {
              if (isStale()) {
                return;
              }
              setLocalParticipantId(room.myUserId());
              setIsModerator(Boolean(room.isModerator?.()));
              setJoined(true);
            });

            // Native, JVB-computed dominant speaker -- fires with the local user's own id when
            // they're the loudest, matching localParticipantIdRef.current, so the caller can
            // tell "local" and "a specific remote participant" apart with a single id.
            room.on(JitsiMeetJS.events.conference.DOMINANT_SPEAKER_CHANGED, (id: string) => {
              if (isStale()) {
                return;
              }
              setDominantSpeakerId(id);
            });

            // Real Jibri recording status -- rides XMPP presence, so every participant (not
            // just whoever clicked start) receives it, and it reflects Jibri's actual
            // confirmed state (on/off/pending/error), not an optimistic guess.
            room.on(JitsiMeetJS.events.conference.RECORDER_STATE_CHANGED, (session: any) => {
              if (isStale()) {
                return;
              }
              const status = session?.getStatus?.();

              if (status === 'on') {
                recordingSessionIdRef.current = session.getID();
                setRecording(true);
              } else if (status === 'off' || status === '') {
                recordingSessionIdRef.current = null;
                setRecording(false);
              }
              // 'pending' and other transitional statuses: leave `recording` as-is: not yet
              // confirmed on, and stopping too is more useful as "still recording until told
              // otherwise" than flickering the UI on every intermediate state.
            });

            // Real SHARED_VIDEO XMPP command, ported from jitsi-meet's shared-video middleware --
            // fires for every participant INCLUDING the sender (MUC presence commands echo back
            // to their own sender), so both "someone shared a video" and "I just shared one"
            // flow through this single listener, same as upstream.
            room.addCommandListener(SHARED_VIDEO, (data: { attributes: any; value: string }, from: string) => {
              if (isStale()) {
                return;
              }
              const { value, attributes } = data;
              const state = attributes?.state;
              const current = sharedVideoRef.current;

              // Someone else already owns an active share -- ignore a conflicting command from a
              // third party, matching upstream's ownerId guard.
              if (current?.ownerId && current.ownerId !== from) {
                return;
              }

              if (isSharingStatus(state)) {
                if (current?.videoUrl && current.videoUrl !== value) {
                  return;
                }
                const next: ISharedVideoState = {
                  videoUrl: value,
                  status: state,
                  time: Number(attributes.time) || 0,
                  ownerId: from,
                  muted: attributes.muted === 'true' || attributes.muted === true,
                  volume: attributes.volume !== undefined ? Number(attributes.volume) : undefined
                };

                sharedVideoRef.current = next;
                setSharedVideo(next);

                return;
              }

              if (state === PLAYBACK_STATUSES.STOPPED) {
                sharedVideoRef.current = null;
                setSharedVideo(null);
              }
            });

            room.on(JitsiMeetJS.events.conference.CONFERENCE_FAILED, (errorType: string) => {
              if (isStale()) {
                return;
              }
              setError(`Conference failed: ${errorType}`);
            });

            room.on(JitsiMeetJS.events.conference.CONNECTION_INTERRUPTED, () => {
              if (isStale()) {
                return;
              }
              setError('Connection interrupted -- attempting to reconnect.');
            });
            room.on(JitsiMeetJS.events.conference.CONNECTION_RESTORED, () => {
              if (isStale()) {
                return;
              }
              setError(null);
            });

            // Fires with no participant argument when the LOCAL user is the one force-removed
            // by a moderator -- the moderator-kick admin feature this replaces relied on.
            room.on(JitsiMeetJS.events.conference.KICKED, (participant: any) => {
              if (!participant) {
                onKickedRef.current?.();
              }
            });

            room.setDisplayName(displayName || 'Participant');
            room.join();
          }
        );

        connection.addEventListener(
          JitsiMeetJS.events.connection.CONNECTION_FAILED,
          () => {
            if (isStale()) {
              return;
            }
            setError('Failed to connect to the conference server.');
          }
        );
        connection.addEventListener(
          JitsiMeetJS.events.connection.CONNECTION_DISCONNECTED,
          () => {
            if (isStale()) {
              return;
            }
            setConnected(false);
          }
        );

        connection.connect();

        const { audioTrack, videoTrack, audioError, videoError } = await acquireLocalTracks(
            JitsiMeetJS, existingStreamRef.current, audioDeviceId, videoDeviceId
        );

        if (isStale()) {
          audioTrack?.dispose();
          videoTrack?.dispose();

          return;
        }

        if (audioTrack) {
          myAudioTrack = audioTrack;
          localAudioTrackRef.current = audioTrack;
          if (startWithAudioMuted) {
            audioTrack.mute();
            setLocalAudioMuted(true);
          }
          // The ONLY place localAudioMuted used to update was this hook's own toggleAudio() --
          // purely optimistic local state, never synced back from the track's real mute status.
          // That's correct for a self-click, but a moderator's muteParticipant() call mutes this
          // track from OUTSIDE this app entirely (lib-jitsi-meet applies it internally on
          // receiving the server-relayed request) -- the actual audio goes silent immediately,
          // but nothing ever told React, so the toolbar mic button kept showing "unmuted"
          // indefinitely. Listening to the track's own event is the single source of truth
          // regardless of who/what caused the change; selfInitiatedMuteRef (set in toggleAudio)
          // is only used to decide whether to also fire onForceMuted for a toast.
          audioTrack.addEventListener(JitsiMeetJS.events.track.TRACK_MUTE_CHANGED, () => {
            const muted = audioTrack.isMuted();

            setLocalAudioMuted(muted);
            if (muted && !selfInitiatedMuteRef.current) {
              onForceMutedRef.current?.();
            }
            selfInitiatedMuteRef.current = false;
          });
        }
        if (videoTrack) {
          myVideoTrack = videoTrack;
          localVideoTrackRef.current = videoTrack;
          setHasVideoTrack(true);
          setLocalCameraStream(trackToStream(videoTrack));
          if (startWithVideoMuted) {
            videoTrack.mute();
            setLocalVideoMuted(true);
          }
        }

        if (audioError && !audioTrack) {
          // eslint-disable-next-line no-console
          console.error('[useJitsiMeeting] microphone acquisition failed:', audioError?.name, audioError?.message, audioError);
        }
        if (videoError && !videoTrack) {
          // eslint-disable-next-line no-console
          console.error('[useJitsiMeeting] camera acquisition failed:', videoError?.name, videoError?.message, videoError);
          setCameraError(describeMediaError('camera', videoError));
        }
        if (audioError && !audioTrack) {
          setError(describeMediaError('microphone', audioError));
        }

        const tryAddTrack = (track: any) => {
          if (roomRef.current === myRoom && myRoom && !isStale()) {
            myRoom.addTrack(track).catch(() => {});

            return true;
          }

          return false;
        };

        [ audioTrack, videoTrack ].filter(Boolean).forEach(track => {
          if (!tryAddTrack(track)) {
            const interval = setInterval(() => {
              if (tryAddTrack(track) || isStale()) {
                clearInterval(interval);
              }
            }, 200);

            myAddTrackInterval = interval;
          }
        });
      } catch (err: any) {
        if (isStale()) {
          return;
        }
        setError(err?.message || 'Failed to load conference library.');
      }
    })();

    return () => {
      // Invalidate this generation immediately (before any disposal work) so any of its
      // in-flight async continuations abort as soon as they next check isStale(), instead of
      // racing a newer invocation's setup.
      generationRef.current++;

      if (myAddTrackInterval) {
        clearInterval(myAddTrackInterval);
      }
      try {
        myAudioTrack?.dispose();
        myVideoTrack?.dispose();
        myRoom?.leave();
        myConnection?.disconnect();
      } catch {
        // best-effort cleanup
      }

      // Only clear the shared refs if they still point at THIS generation's objects -- a newer
      // generation may already have overwritten them with its own, and this cleanup must not
      // clobber live state that belongs to it.
      if (localAudioTrackRef.current === myAudioTrack) {
        localAudioTrackRef.current = null;
      }
      if (localVideoTrackRef.current === myVideoTrack) {
        localVideoTrackRef.current = null;
        setHasVideoTrack(false);
      }
      if (roomRef.current === myRoom) {
        roomRef.current = null;
      }
      if (connectionRef.current === myConnection) {
        connectionRef.current = null;
      }
      if (pendingReconnectTimerRef.current) {
        clearTimeout(pendingReconnectTimerRef.current);
        pendingReconnectTimerRef.current = null;
      }
      if (localDesktopTrackRef.current) {
        try {
          localDesktopTrackRef.current.dispose();
        } catch {
          // best-effort
        }
        localDesktopTrackRef.current = null;
      }
      remoteDesktopTracksRef.current = {};
      if (screenShareClearTimerRef.current) {
        clearTimeout(screenShareClearTimerRef.current);
        screenShareClearTimerRef.current = null;
      }
      remoteNamesRef.current = {};
      remoteAvatarsRef.current = {};
      setConnected(false);
      setJoined(false);
      setRemoteParticipants({});
      setIsModerator(false);
      networkStateRef.current = 'GOOD';
      setNetworkState('GOOD');
      networkMetricsRef.current = EMPTY_NETWORK_METRICS;
      poorSampleCountRef.current = 0;
      degradedSampleCountRef.current = 0;
      goodSinceRef.current = null;
      lastAppliedQualityKeyRef.current = null;
      audioOnlyMutedVideoRef.current = false;
      setLocalCameraStream(null);
      setLocalScreenStream(null);
      setRemoteScreenShare(null);
      setIsScreenSharing(false);
      setError(null);
      setCameraError(null);
      setDominantSpeakerId(null);
      setLocalParticipantId(null);
      setRecording(false);
      recordingSessionIdRef.current = null;
      virtualBackgroundRef.current = null;
      noiseSuppressionRef.current = null;
      setNoiseSuppressionEnabled(false);
      sharedVideoRef.current = null;
      setSharedVideo(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ enabled, jwt, roomName, jitsiDomain, reconnectEpoch ]);

  const toggleAudio = useCallback(() => {
    const track = localAudioTrackRef.current;

    if (!track) {
      return;
    }
    if (track.isMuted()) {
      track.unmute();
      setLocalAudioMuted(false);
    } else {
      // Marks this specific mute as self-initiated so the TRACK_MUTE_CHANGED listener (set up
      // where the track was created) doesn't fire onForceMuted for a click the user made
      // themselves -- that toast/sound is only for a moderator muting them from outside.
      selfInitiatedMuteRef.current = true;
      track.mute();
      setLocalAudioMuted(true);
    }
  }, []);

  // Doubles as the manual "retry camera" action when no video track exists yet (e.g. the
  // initial join failed to get the camera) -- retrying only ever happens in response to this
  // explicit user click on the existing camera button, never automatically in the background,
  // and cameraRetryInFlightRef guards against a second click starting a parallel capture
  // request while one is already in progress.
  const toggleVideo = useCallback(async () => {
    if (lowDataModeRef.current === 'audio-only') {
      return;
    }
    const track = localVideoTrackRef.current;
    const nativeTrack = track?.getTrack?.();

    // A browser can leave a JitsiLocalTrack object behind after the underlying camera track
    // has ended (common after another app briefly takes the camera). Unmuting that stale object
    // succeeds without producing frames, which is the black self-view bug. Treat it as absent
    // and acquire a fresh camera track below instead.
    if (track && nativeTrack?.readyState !== 'ended') {
      if (track.isMuted()) {
        await Promise.resolve(track.unmute());
        // Use a new MediaStream wrapper to force every mounted self-view/PiP video element to
        // rebind and resume playback as soon as the browser emits frames again.
        setLocalCameraStream(trackToStream(track));
        setLocalVideoMuted(false);
      } else {
        await Promise.resolve(track.mute());
        setLocalVideoMuted(true);
      }

      return;
    }

    if (cameraRetryInFlightRef.current) {
      return;
    }
    cameraRetryInFlightRef.current = true;
    try {
      if (track) {
        const room = roomRef.current;
        try {
          if (room) {
            await runSerializedRoomOperation(() => room.removeTrack(track));
          }
        } catch {
          // The stale track may already have been removed by lib-jitsi-meet.
        }
        track.dispose?.();
        localVideoTrackRef.current = null;
        setHasVideoTrack(false);
        setLocalCameraStream(null);
      }

      const JitsiMeetJS = window.JitsiMeetJS;

      if (!JitsiMeetJS) {
        return;
      }
      const newTrack = await createLocalTrackWithRetry(JitsiMeetJS, {
        devices: [ 'video' ],
        cameraDeviceId: deviceIdsRef.current.videoDeviceId || undefined
      });

      if (!newTrack) {
        return;
      }
      localVideoTrackRef.current = newTrack;
      setHasVideoTrack(true);
      setLocalCameraStream(trackToStream(newTrack));
      setLocalVideoMuted(false);
      setCameraError(null);
      void applyVirtualBackgroundToTrack(newTrack);

      const room = roomRef.current;

      if (room) {
        try {
          await runSerializedRoomOperation(() => room.addTrack(newTrack));
        } catch {
          // best-effort
        }
      }
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('[useJitsiMeeting] camera retry failed:', err?.name, err?.message, err);
      setCameraError(describeMediaError('camera', err));
    } finally {
      cameraRetryInFlightRef.current = false;
    }
  }, []);

  // Dedicated stop path, used by BOTH the Toowix "Stop presenting" button (via toggleScreenShare
  // below) and the browser's own native "Stop sharing" bar (LOCAL_TRACK_STOPPED, wired at track
  // creation time). Screen and camera are separate simultaneous JVB sources in this app (see the
  // start path's addTrack-only comment below) -- stopping the share must never touch the camera
  // track at all.
  //
  // Desktop and camera are different Jitsi video types and are never replaced with one another.
  // Stopping a share removes only its separate desktop source; this is the conference lifecycle
  // expected by remote TRACK_MUTE_CHANGED/TRACK_REMOVED listeners below.
  const stopScreenShareInternal = useCallback(async (desktopTrack: any) => {
    if (!desktopTrack || desktopStopInFlightRef.current) {
      return;
    }
    desktopStopInFlightRef.current = true;
    try {
      const room = roomRef.current;

      if (room) {
        try {
          // A bounded remove prevents a signaling stall from trapping the UI on the old
          // presentation. The underlying operation is still allowed to settle in its serialized
          // queue after the visual state has been cleared.
          await withTimeout(runSerializedRoomOperation(() => room.removeTrack(desktopTrack)), 6000, 'Timed out removing desktop track');
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[useJitsiMeeting] Failed to remove desktop track from the conference:', err);
          setError('Could not stop screen sharing cleanly -- please try again.');
        }
      }

      // Only clear the ref if it still points at THIS track -- a newer share (started while this
      // stop was in flight) must not have its own track ripped out from under it.
      if (localDesktopTrackRef.current === desktopTrack) {
        localDesktopTrackRef.current = null;
      }
      setIsScreenSharing(false);
      setLocalScreenStream(null);

      // Dispose only after the conference-level removal has been attempted (success or not --
      // the local capture is ending either way), never before, so a slow removeTrack can't race
      // a disposed-track error out of _doReplaceTrack/_doRemoveTrack.
      try {
        desktopTrack.dispose();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[useJitsiMeeting] Failed to dispose desktop track:', err);
      }

      // Neither of the calls above is trustworthy at actually telling the server the share
      // ended (see the comment on them) -- force a full leave+rejoin shortly after so Jicofo
      // rebuilds this participant's source list from scratch, which IS reliable. Delayed and
      // debounced so a fast re-share isn't caught mid-reconnect and killed (toggleScreenShare's
      // start path clears this same timer).
      if (pendingReconnectTimerRef.current) {
        clearTimeout(pendingReconnectTimerRef.current);
      }
      pendingReconnectTimerRef.current = setTimeout(() => {
        pendingReconnectTimerRef.current = null;
        setReconnectEpoch(epoch => epoch + 1);
      }, 1500);
    } finally {
      desktopStopInFlightRef.current = false;
    }
  }, []);

  const toggleScreenShare = useCallback(async () => {
    const JitsiMeetJS = window.JitsiMeetJS;
    const room = roomRef.current;

    if (!JitsiMeetJS || !room) {
      return;
    }

    if (localDesktopTrackRef.current) {
      await stopScreenShareInternal(localDesktopTrackRef.current);

      return;
    }

    // See desktopStartInFlightRef's comment above: without this, a second call landing while the
    // OS share picker from a first call is still open runs the whole start sequence twice.
    if (desktopStartInFlightRef.current) {
      return;
    }
    desktopStartInFlightRef.current = true;

    // A fresh share is starting -- cancel any reconnect still pending from a PREVIOUS stop, or
    // it would tear down (and never restart) the new share moments after this.
    if (pendingReconnectTimerRef.current) {
      clearTimeout(pendingReconnectTimerRef.current);
      pendingReconnectTimerRef.current = null;
    }

    let desktopTrack: any;
    // Resolution applies when the browser creates the desktop source. We intentionally do not
    // tear down and re-prompt an already active share merely to change its resolution.
    const desktopPolicy = getMediaQualityPolicy(
      lowDataModeRef.current,
      networkStateRef.current,
      room.getParticipants?.().length || 0
    );

    try {
      // Without desktopSharingResolution, lib-jitsi-meet captures at window.screen.width/height
      // -- i.e. the sender's FULL native display resolution (1440p/4K on a lot of laptops now),
      // which is expensive to encode every frame regardless of the already-conservative 5fps
      // default frame rate. Capping it to 1080p is what actually reduces the CPU/GPU cost on
      // constrained hardware (e.g. two full browser call instances competing for one machine's
      // CPU during same-device testing) -- screen content is legible at 1080p either way.
      [ desktopTrack ] = await JitsiMeetJS.createLocalTracks({
        devices: [ 'desktop' ],
        desktopSharingResolution: {
          width: { max: desktopPolicy.desktopMaxWidth },
          height: { max: desktopPolicy.desktopMaxHeight }
        }
      });
    } catch {
      // User cancelled the OS share picker, or permission was denied -- silently no-op,
      // matches the previous toggleShareScreen behavior. Nothing was acquired yet, so there's
      // nothing to clean up.
      desktopStartInFlightRef.current = false;

      return;
    }

    if (!desktopTrack) {
      desktopStartInFlightRef.current = false;

      return;
    }

    // Everything past this point is a REAL failure if it throws -- the picker already
    // succeeded, the user has a live desktop track, and something in wiring it into the
    // conference went wrong (track negotiation, JVB rejecting the track, etc.). This used to
    // be swallowed by the same bare catch as the picker-cancel case above, which is why a
    // real failure here looked identical to "nothing happened" with zero feedback. Surface it
    // instead (thrown to the caller, which shows the "Could not start screen sharing" banner)
    // and make sure the half-acquired track doesn't leak.
    try {
      localDesktopTrackRef.current = desktopTrack;
      desktopTrack.addEventListener(JitsiMeetJS.events.track.LOCAL_TRACK_STOPPED, () => {
        // Fires when the user clicks the browser's own "Stop sharing" bar instead of our
        // button -- goes straight to the dedicated stop path (not back through
        // toggleScreenShare's start/stop branching) so there's no ambiguity about which track
        // is being stopped, and the in-flight guard inside stopScreenShareInternal absorbs a
        // second native 'ended' event if dispose() below triggers one.
        if (localDesktopTrackRef.current === desktopTrack) {
          void stopScreenShareInternal(desktopTrack);
        }
      });

      // Desktop is published as its own separate JVB source, alongside (never instead of) the
      // camera track -- this is how real Jitsi is designed to work (camera and desktop have
      // distinct videoTypes/source-names at the JVB level), and it's what makes the dedicated
      // stop path above valid: removeTrack only ever has to undo exactly this addTrack, with the
      // camera never touched on either side.
      await runSerializedRoomOperation(() => room.addTrack(desktopTrack));
      room.setDesktopSharingFrameRate?.(desktopPolicy.desktopFps);
      setIsScreenSharing(true);
      setLocalScreenStream(trackToStream(desktopTrack));
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error(
        '[useJitsiMeeting] screen share track failed after picker succeeded:',
        err?.message || err?.name || (() => {
          try {
            return JSON.stringify(err);
          } catch {
            return String(err);
          }
        })()
      );
      if (localDesktopTrackRef.current === desktopTrack) {
        localDesktopTrackRef.current = null;
      }
      try {
        desktopTrack.dispose();
      } catch {
        // best-effort
      }
      throw err;
    } finally {
      desktopStartInFlightRef.current = false;
    }
  }, [ stopScreenShareInternal ]);

  // startRecording/stopRecording wrap the raw JitsiConference API correctly: stopRecording
  // REQUIRES the session id returned by startRecording (calling it with no id, as the previous
  // direct room.stopRecording() call at the page level did, never sends Jibri a proper stop --
  // Jibri only cleanly finalizes the file on a real stop, which is why recordings looked like
  // they captured but wouldn't play back). `recording` itself is the real RECORDER_STATE_CHANGED-
  // driven state above, not set optimistically here.
  const startRecording = useCallback(async () => {
    const room = roomRef.current;

    if (!room) {
      throw new Error('Not connected to the conference yet.');
    }
    const session = await room.startRecording({ mode: 'file' });

    if (session?.getID) {
      recordingSessionIdRef.current = session.getID();
    }
  }, []);

  const stopRecording = useCallback(async () => {
    const room = roomRef.current;

    if (!room || !recordingSessionIdRef.current) {
      return;
    }
    await room.stopRecording(recordingSessionIdRef.current);
  }, []);

  const switchDeviceInFlightRef = useRef<Record<string, boolean>>({});

  const switchDevice = useCallback(async (kind: 'audioInput' | 'videoInput' | 'audioOutput', deviceId: string) => {
    const JitsiMeetJS = window.JitsiMeetJS;
    const room = roomRef.current;

    if (!JitsiMeetJS) {
      return;
    }

    if (kind === 'audioOutput') {
      try {
        await JitsiMeetJS.mediaDevices.setAudioOutputDevice(deviceId);
      } catch {
        // not supported on every browser; ignore
      }

      return;
    }

    // Guard against parallel capture requests for the same media type (e.g. rapid double-click
    // on a device menu entry).
    if (switchDeviceInFlightRef.current[kind]) {
      return;
    }
    switchDeviceInFlightRef.current[kind] = true;

    const isAudio = kind === 'audioInput';
    const oldTrack = isAudio ? localAudioTrackRef.current : localVideoTrackRef.current;

    try {
      const newTrack = await createLocalTrackWithRetry(JitsiMeetJS, {
        devices: [ isAudio ? 'audio' : 'video' ],
        micDeviceId: isAudio ? deviceId : undefined,
        cameraDeviceId: isAudio ? undefined : deviceId
      });

      if (!newTrack) {
        return;
      }

      if (room && oldTrack) {
        await runSerializedRoomOperation(() => room.replaceTrack(oldTrack, newTrack));
      } else if (room) {
        await runSerializedRoomOperation(() => room.addTrack(newTrack));
      }

      if (oldTrack) {
        const wasMuted = oldTrack.isMuted();

        if (wasMuted) {
          newTrack.mute();
        }
        oldTrack.dispose();
      }

      if (isAudio) {
        localAudioTrackRef.current = newTrack;
        void applyNoiseSuppressionToTrack(newTrack);
      } else {
        localVideoTrackRef.current = newTrack;
        setHasVideoTrack(true);
        setLocalCameraStream(trackToStream(newTrack));
        void applyVirtualBackgroundToTrack(newTrack);
      }
    } catch (err: any) {
      throw new Error(describeMediaError(isAudio ? 'microphone' : 'camera', err));
    } finally {
      switchDeviceInFlightRef.current[kind] = false;
    }
  }, []);

  // Applies (blur/image) or clears (null) a virtual background on the local camera track.
  // Re-thrown to the caller on failure (model download failed, WebAssembly unsupported, etc.) so
  // the UI can show an error instead of silently doing nothing.
  const setVirtualBackground = useCallback(async (config: IVirtualBackground | null) => {
    const track = localVideoTrackRef.current;

    if (config && config.backgroundType !== 'none' && lowDataModeRef.current !== 'auto') {
      throw new Error('Background effects are disabled while Low Data Mode is active.');
    }

    if (!config || config.backgroundType === 'none') {
      virtualBackgroundRef.current = null;
      if (track) {
        await track.setEffect(undefined);
      }

      return;
    }

    const { createVirtualBackgroundEffect } = await import('./virtualBackground/createVirtualBackgroundEffect');
    const effect = await createVirtualBackgroundEffect(config);

    if (track) {
      await track.setEffect(effect);
    }
    virtualBackgroundRef.current = { config, effect };
  }, []);

  // Toggles mic noise suppression (RNNoise) on/off. Re-thrown to the caller on failure (e.g.
  // AudioWorklet unsupported) so the UI can show an error instead of silently doing nothing.
  const toggleNoiseSuppression = useCallback(async () => {
    const track = localAudioTrackRef.current;

    if (noiseSuppressionRef.current) {
      noiseSuppressionRef.current = null;
      setNoiseSuppressionEnabled(false);
      if (track) {
        await track.setEffect(undefined);
      }

      return;
    }

    const { NoiseSuppressionEffect } = await import('./noiseSuppression/NoiseSuppressionEffect');
    const effect = new NoiseSuppressionEffect();

    if (track) {
      await track.setEffect(effect);
    }
    noiseSuppressionRef.current = { effect };
    setNoiseSuppressionEnabled(true);
  }, []);

  // Ported from jitsi-meet's playSharedVideo action: sends the "start" command and nothing else
  // -- local state (for the sender too) is set once the command echoes back through the
  // addCommandListener above, exactly like upstream ("we will create local video fake participant
  // and start playing once we receive ourselves the command").
  const shareVideo = useCallback((urlOrId: string) => {
    const room = roomRef.current;
    const id = extractYoutubeId(urlOrId);

    if (!room || !id) {
      return false;
    }
    sendShareVideoCommand({
      room,
      id,
      localParticipantId: room.myUserId(),
      status: PLAYBACK_START,
      time: 0
    });

    return true;
  }, []);

  // Ported from AbstractVideoManager's fireUpdateSharedVideoEvent + the SET_SHARED_VIDEO_STATUS
  // middleware case combined: only the owner's real player calls this (on its own play/pause/seek/
  // mute events), it updates local state immediately (no round trip needed for your own player),
  // then broadcasts the real command so every other participant's player converges to match.
  const updateSharedVideoStatus = useCallback((status: string, time: number, muted?: boolean) => {
    const room = roomRef.current;
    const current = sharedVideoRef.current;
    const localId = room?.myUserId();

    if (!room || !current || current.ownerId !== localId) {
      return;
    }
    const next: ISharedVideoState = { ...current, status, time, muted };

    sharedVideoRef.current = next;
    setSharedVideo(next);
    sendShareVideoCommand({ room, id: current.videoUrl, localParticipantId: localId, status, time, muted });
  }, []);

  // Ported from jitsi-meet's stopSharedVideo action -- only the owner can stop (matches upstream:
  // "if (ownerId === localParticipant?.id)"), broadcasting the real "stop" command so everyone's
  // player tears down together.
  const stopSharedVideo = useCallback(() => {
    const room = roomRef.current;
    const current = sharedVideoRef.current;
    const localId = room?.myUserId();

    if (!room || !current || current.ownerId !== localId) {
      return;
    }
    sharedVideoRef.current = null;
    setSharedVideo(null);
    sendShareVideoCommand({
      room, id: current.videoUrl, localParticipantId: localId,
      status: PLAYBACK_STATUSES.STOPPED, time: 0, muted: true, volume: 0
    });
  }, []);

  // Mirrors jitsi-meet's GRANT_MODERATOR middleware, which calls
  // JitsiConference.grantOwner(participantId). The server authorizes this against the local
  // participant's current conference role and emits USER_ROLE_CHANGED after it succeeds.
  const grantModerator = useCallback(async (participantId: string) => {
    const room = roomRef.current;

    if (!room || !room.isModerator?.()) {
      throw new Error('Only a conference moderator can grant moderator rights.');
    }
    const participant = room.getParticipantById?.(participantId);

    if (!participant) {
      throw new Error('That participant is no longer in the meeting.');
    }
    if (participant.getRole?.() === 'moderator') {
      return;
    }
    if (typeof room.grantOwner !== 'function') {
      throw new Error('This Jitsi server does not support moderator promotion.');
    }
    await Promise.resolve(room.grantOwner(participantId));
  }, []);

  return {
    connected,
    joined,
    error,
    cameraError,
    localAudioMuted,
    localVideoMuted,
    hasVideoTrack,
    localCameraStream,
    localScreenStream,
    isScreenSharing,
    remoteParticipants,
    isModerator,
    networkState,
    lowDataMode,
    remoteScreenShare,
    dominantSpeakerId,
    localParticipantId,
    recording,
    toggleAudio,
    toggleVideo,
    toggleScreenShare,
    startRecording,
    stopRecording,
    switchDevice,
    setVirtualBackground,
    setLowDataMode,
    noiseSuppressionEnabled,
    toggleNoiseSuppression,
    sharedVideo,
    shareVideo,
    updateSharedVideoStatus,
    stopSharedVideo,
    grantModerator,
    room: roomRef
  };
}

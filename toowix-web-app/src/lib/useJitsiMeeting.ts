import { useCallback, useEffect, useRef, useState } from 'react';

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
      result.audioTrack = await createLocalTrackWithRetry(JitsiMeetJS, {
        devices: [ 'audio' ],
        micDeviceId: audioDeviceId || undefined
      });
    } catch (err) {
      result.audioError = err;
    }
  }

  if (!result.videoTrack) {
    try {
      result.videoTrack = await createLocalTrackWithRetry(JitsiMeetJS, {
        devices: [ 'video' ],
        cameraDeviceId: videoDeviceId || undefined
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
  existingStream
}: IUseJitsiMeetingOptions) {
  const [ connected, setConnected ] = useState(false);
  const [ joined, setJoined ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);
  const [ cameraError, setCameraError ] = useState<string | null>(null);
  const [ localAudioMuted, setLocalAudioMuted ] = useState(startWithAudioMuted);
  const [ localVideoMuted, setLocalVideoMuted ] = useState(startWithVideoMuted);
  const [ hasVideoTrack, setHasVideoTrack ] = useState(false);
  const [ localCameraStream, setLocalCameraStream ] = useState<MediaStream | null>(null);
  const [ localScreenStream, setLocalScreenStream ] = useState<MediaStream | null>(null);
  const [ isScreenSharing, setIsScreenSharing ] = useState(false);
  const [ remoteParticipants, setRemoteParticipants ] = useState<Record<string, IRemoteParticipant>>({});
  const [ remoteScreenShare, setRemoteScreenShare ] = useState<{ stream: MediaStream; presenterName: string } | null>(null);

  // Shared refs: always point at the CURRENT (latest, non-stale) generation's live objects, once
  // one exists. Read by toggleAudio/toggleVideo/switchDevice/toggleScreenShare, which are
  // triggered by explicit user actions, not by this effect's own lifecycle.
  const connectionRef = useRef<any>(null);
  const roomRef = useRef<any>(null);
  const localAudioTrackRef = useRef<any>(null);
  const localVideoTrackRef = useRef<any>(null);
  const localDesktopTrackRef = useRef<any>(null);
  const remoteDesktopTracksRef = useRef<Record<string, any>>({});
  const remoteNamesRef = useRef<Record<string, string>>({});
  const toggleScreenShareRef = useRef<() => void>(() => {});
  const onKickedRef = useRef(onKicked);
  const existingStreamRef = useRef(existingStream);
  const cameraRetryInFlightRef = useRef(false);
  const deviceIdsRef = useRef({ audioDeviceId, videoDeviceId });

  // Plain synchronous assignments during render (NOT inside useEffect) -- these values are read
  // later from inside an async continuation (acquireLocalTracks, the KICKED handler, switchDevice)
  // that needs the LATEST value at the moment it actually runs, not whatever was captured when
  // some earlier effect last fired. A useEffect-based sync (`useEffect(() => { ref.current = x }, [x])`)
  // is NOT equivalent to this: proved unreliable here in practice (existingStream's sync effect
  // fired only twice total, both during the initial mount, and never again despite the prop
  // demonstrably changing value across many subsequent renders -- the direct assignment below
  // fixes that by construction, since it runs on every render with no dependency array to miss).
  onKickedRef.current = onKicked;
  existingStreamRef.current = existingStream;
  deviceIdsRef.current = { audioDeviceId, videoDeviceId };

  const patchParticipant = useCallback((id: string, patch: Partial<IRemoteParticipant>) => {
    setRemoteParticipants(prev => ({
      ...prev,
      [id]: {
        id,
        name: prev[id]?.name ?? remoteNamesRef.current[id] ?? 'Participant',
        muted: prev[id]?.muted ?? true,
        video: prev[id]?.video ?? false,
        raisedHand: prev[id]?.raisedHand ?? false,
        stream: prev[id]?.stream ?? null,
        audioStream: prev[id]?.audioStream ?? null,
        ...patch
      }
    }));
  }, []);

  const recomputeRemoteScreenShare = useCallback(() => {
    const entries = Object.entries(remoteDesktopTracksRef.current);

    if (entries.length === 0) {
      setRemoteScreenShare(null);

      return;
    }
    const [ id, track ] = entries[entries.length - 1];
    const stream = trackToStream(track);

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
              const type = track.getType();
              const videoType = typeof track.getVideoType === 'function' ? track.getVideoType() : 'camera';

              if (type === 'audio') {
                patchParticipant(participantId, { audioStream: trackToStream(track), muted: track.isMuted() });
              } else if (videoType === 'desktop') {
                remoteDesktopTracksRef.current[participantId] = track;
                recomputeRemoteScreenShare();
              } else {
                patchParticipant(participantId, { stream: trackToStream(track), video: !track.isMuted() });
              }

              track.addEventListener(JitsiMeetJS.events.track.TRACK_MUTE_CHANGED, () => {
                if (type === 'audio') {
                  patchParticipant(participantId, { muted: track.isMuted() });
                } else if (videoType !== 'desktop') {
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
                patchParticipant(participantId, { audioStream: null });
              } else if (videoType === 'desktop') {
                delete remoteDesktopTracksRef.current[participantId];
                recomputeRemoteScreenShare();
              } else {
                patchParticipant(participantId, { stream: null, video: false });
              }
            });

            room.on(JitsiMeetJS.events.conference.USER_JOINED, (id: string, participant: any) => {
              const name = participant.getDisplayName() || 'Participant';

              remoteNamesRef.current[id] = name;
              patchParticipant(id, { name });
            });

            room.on(JitsiMeetJS.events.conference.USER_LEFT, (id: string) => {
              delete remoteNamesRef.current[id];
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
              setJoined(true);
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
      if (localDesktopTrackRef.current) {
        try {
          localDesktopTrackRef.current.dispose();
        } catch {
          // best-effort
        }
        localDesktopTrackRef.current = null;
      }
      remoteDesktopTracksRef.current = {};
      remoteNamesRef.current = {};
      setConnected(false);
      setJoined(false);
      setRemoteParticipants({});
      setLocalCameraStream(null);
      setLocalScreenStream(null);
      setRemoteScreenShare(null);
      setIsScreenSharing(false);
      setError(null);
      setCameraError(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ enabled, jwt, roomName, jitsiDomain ]);

  const toggleAudio = useCallback(() => {
    const track = localAudioTrackRef.current;

    if (!track) {
      return;
    }
    if (track.isMuted()) {
      track.unmute();
      setLocalAudioMuted(false);
    } else {
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
    const track = localVideoTrackRef.current;

    if (track) {
      if (track.isMuted()) {
        track.unmute();
        setLocalVideoMuted(false);
      } else {
        track.mute();
        setLocalVideoMuted(true);
      }

      return;
    }

    if (cameraRetryInFlightRef.current) {
      return;
    }
    cameraRetryInFlightRef.current = true;
    try {
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

      const room = roomRef.current;

      if (room) {
        try {
          await room.addTrack(newTrack);
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

  const toggleScreenShare = useCallback(async () => {
    const JitsiMeetJS = window.JitsiMeetJS;
    const room = roomRef.current;

    if (!JitsiMeetJS || !room) {
      return;
    }

    if (localDesktopTrackRef.current) {
      const desktopTrack = localDesktopTrackRef.current;

      localDesktopTrackRef.current = null;
      setIsScreenSharing(false);
      setLocalScreenStream(null);
      try {
        if (localVideoTrackRef.current) {
          await room.replaceTrack(desktopTrack, localVideoTrackRef.current);
        } else {
          await room.removeTrack(desktopTrack);
        }
      } catch {
        // best-effort
      }
      desktopTrack.dispose();

      return;
    }

    try {
      const [ desktopTrack ] = await JitsiMeetJS.createLocalTracks({ devices: [ 'desktop' ] });

      if (!desktopTrack) {
        return;
      }
      localDesktopTrackRef.current = desktopTrack;
      desktopTrack.addEventListener(JitsiMeetJS.events.track.LOCAL_TRACK_STOPPED, () => {
        // Fires when the user clicks the browser's own "Stop sharing" bar instead of our button.
        if (localDesktopTrackRef.current === desktopTrack) {
          toggleScreenShareRef.current();
        }
      });

      if (localVideoTrackRef.current) {
        await room.replaceTrack(localVideoTrackRef.current, desktopTrack);
      } else {
        await room.addTrack(desktopTrack);
      }
      setIsScreenSharing(true);
      setLocalScreenStream(trackToStream(desktopTrack));
    } catch {
      // user cancelled the OS share picker, or permission was denied -- no error surfaced,
      // matches the previous toggleShareScreen behavior of silently no-op'ing on cancel.
    }
  }, []);

  useEffect(() => {
    toggleScreenShareRef.current = () => { void toggleScreenShare(); };
  }, [ toggleScreenShare ]);

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
        await room.replaceTrack(oldTrack, newTrack);
      } else if (room) {
        await room.addTrack(newTrack);
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
      } else {
        localVideoTrackRef.current = newTrack;
        setHasVideoTrack(true);
        setLocalCameraStream(trackToStream(newTrack));
      }
    } catch (err: any) {
      throw new Error(describeMediaError(isAudio ? 'microphone' : 'camera', err));
    } finally {
      switchDeviceInFlightRef.current[kind] = false;
    }
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
    remoteScreenShare,
    toggleAudio,
    toggleVideo,
    toggleScreenShare,
    switchDevice,
    room: roomRef
  };
}

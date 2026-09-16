import { useCallback, useEffect, useRef, useState } from 'react';

// Direct lib-jitsi-meet integration -- no Jitsi IFrame, no external_api.js. This is the
// low-level library Jitsi's own web app is built on, used directly so real MediaStreamTracks
// can be attached to our own <video>/<audio> elements inside MeetingRoomPage's existing
// cards, instead of an embedded iframe rendering its own UI.
//
// FIRST PASS scope (deliberately, to ship something real fast rather than nothing correct
// slowly): connect, join, publish local audio+video, receive remote tracks, basic
// mute/unmute, leave. NOT yet implemented: screen share via this path, device switching via
// this path, ICE-restart/reconnect robustness, dominant-speaker detection. Those need
// follow-up passes, the same way the iframe styling work took many rounds -- flagged here
// rather than silently left out.

declare global {
  interface Window {
    JitsiMeetJS: any;
    config: any;
  }
}

export interface IRemoteParticipant {
  id: string;
  name: string;
  audioTrack: any | null;
  videoTrack: any | null;
  muted: boolean;
  videoMuted: boolean;
}

interface IUseLibJitsiConferenceOptions {
  jitsiDomain: string;
  roomName: string;
  jwt: string | undefined;
  displayName: string;
  enabled: boolean;
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
      // config.js is Jitsi's own runtime config (XMPP/BOSH/WebSocket hosts, etc.) -- fetched
      // from the real deployment rather than hardcoded here, so it can never drift from what
      // the server actually has configured.
      await loadScript(`https://${jitsiDomain}/config.js`);
      await loadScript('/lib-jitsi-meet.min.js');
    })();
  }

  return scriptLoadPromise;
}

export function useLibJitsiConference({
  jitsiDomain,
  roomName,
  jwt,
  displayName,
  enabled
}: IUseLibJitsiConferenceOptions) {
  const [connected, setConnected] = useState(false);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localAudioMuted, setLocalAudioMuted] = useState(false);
  const [localVideoMuted, setLocalVideoMuted] = useState(false);
  const [remoteParticipants, setRemoteParticipants] = useState<Record<string, IRemoteParticipant>>({});

  const connectionRef = useRef<any>(null);
  const roomRef = useRef<any>(null);
  const localAudioTrackRef = useRef<any>(null);
  const localVideoTrackRef = useRef<any>(null);
  const localVideoElRef = useRef<HTMLVideoElement | null>(null);
  const disposedRef = useRef(false);

  const attachRemoteParticipant = useCallback((id: string, patch: Partial<IRemoteParticipant>) => {
    setRemoteParticipants(prev => ({
      ...prev,
      [id]: {
        id,
        name: prev[id]?.name ?? 'Participant',
        audioTrack: prev[id]?.audioTrack ?? null,
        videoTrack: prev[id]?.videoTrack ?? null,
        muted: prev[id]?.muted ?? true,
        videoMuted: prev[id]?.videoMuted ?? true,
        ...patch
      }
    }));
  }, []);

  useEffect(() => {
    if (!enabled || !jwt || !roomName) {
      return;
    }

    disposedRef.current = false;

    (async () => {
      try {
        await ensureLibJitsiMeetLoaded(jitsiDomain);
        if (disposedRef.current) {
          return;
        }

        const JitsiMeetJS = window.JitsiMeetJS;
        const config = window.config;

        JitsiMeetJS.setLogLevel(JitsiMeetJS.logLevels.ERROR);
        JitsiMeetJS.init({ disableAudioLevels: false });

        const connection = new JitsiMeetJS.JitsiConnection(null, jwt, {
          ...config,
          hosts: config.hosts,
          // This build of lib-jitsi-meet expects the modern unified serviceUrl (prefers
          // WebSocket, falls back to BOSH) -- passing separate bosh/websocket fields (what
          // Jitsi's own config.js exposes) only produces a deprecation warning and a
          // connection that never actually establishes.
          serviceUrl: config.websocket || config.bosh
        });

        connectionRef.current = connection;

        connection.addEventListener(
          JitsiMeetJS.events.connection.CONNECTION_ESTABLISHED,
          () => {
            if (disposedRef.current) {
              return;
            }
            setConnected(true);

            const room = connection.initJitsiConference(roomName.toLowerCase(), {
              ...config,
              openBridgeChannel: true
            });

            roomRef.current = room;

            room.on(JitsiMeetJS.events.conference.TRACK_ADDED, (track: any) => {
              if (track.isLocal()) {
                return;
              }
              const participantId = track.getParticipantId();
              const patch: Partial<IRemoteParticipant> = {};

              if (track.getType() === 'audio') {
                patch.audioTrack = track;
                patch.muted = track.isMuted();
              } else {
                patch.videoTrack = track;
                patch.videoMuted = track.isMuted();
              }
              attachRemoteParticipant(participantId, patch);

              track.addEventListener(JitsiMeetJS.events.track.TRACK_MUTE_CHANGED, () => {
                attachRemoteParticipant(participantId,
                    track.getType() === 'audio'
                        ? { muted: track.isMuted() }
                        : { videoMuted: track.isMuted() });
              });
            });

            room.on(JitsiMeetJS.events.conference.TRACK_REMOVED, (track: any) => {
              if (track.isLocal()) {
                return;
              }
              const participantId = track.getParticipantId();

              attachRemoteParticipant(participantId,
                  track.getType() === 'audio'
                      ? { audioTrack: null }
                      : { videoTrack: null });
            });

            room.on(JitsiMeetJS.events.conference.USER_JOINED, (id: string, participant: any) => {
              attachRemoteParticipant(id, { name: participant.getDisplayName() || 'Participant' });
            });

            room.on(JitsiMeetJS.events.conference.USER_LEFT, (id: string) => {
              setRemoteParticipants(prev => {
                const next = { ...prev };

                delete next[id];

                return next;
              });
            });

            room.on(JitsiMeetJS.events.conference.CONFERENCE_JOINED, () => {
              if (disposedRef.current) {
                return;
              }
              setJoined(true);
            });

            room.on(JitsiMeetJS.events.conference.CONFERENCE_FAILED, (errorType: string) => {
              setError(`Conference failed: ${errorType}`);
            });

            room.on(JitsiMeetJS.events.conference.CONNECTION_INTERRUPTED, () => {
              setError('Connection interrupted -- attempting to reconnect.');
            });
            room.on(JitsiMeetJS.events.conference.CONNECTION_RESTORED, () => {
              setError(null);
            });

            room.setDisplayName(displayName || 'Participant');
            room.join();
          }
        );

        connection.addEventListener(
          JitsiMeetJS.events.connection.CONNECTION_FAILED,
          () => setError('Failed to connect to the conference server.')
        );
        connection.addEventListener(
          JitsiMeetJS.events.connection.CONNECTION_DISCONNECTED,
          () => setConnected(false)
        );

        connection.connect();

        // Publish local audio/video as soon as the devices are available -- independent of
        // connection timing, so a slow signaling connection doesn't block camera/mic
        // permission prompts from appearing.
        try {
          const tracks = await JitsiMeetJS.createLocalTracks({ devices: [ 'audio', 'video' ] });

          if (disposedRef.current) {
            tracks.forEach((t: any) => t.dispose());

            return;
          }
          tracks.forEach((track: any) => {
            if (track.getType() === 'audio') {
              localAudioTrackRef.current = track;
            } else {
              localVideoTrackRef.current = track;
              if (localVideoElRef.current) {
                track.attach(localVideoElRef.current);
              }
            }

            // If the room already exists (connection was fast), publish immediately;
            // otherwise it gets published once CONFERENCE_JOINED-adjacent room.join() runs
            // and the room object exists -- we retry the add on a short interval below.
            const tryAddTrack = () => {
              if (roomRef.current && !disposedRef.current) {
                roomRef.current.addTrack(track).catch(() => {});

                return true;
              }

              return false;
            };

            if (!tryAddTrack()) {
              const interval = setInterval(() => {
                if (tryAddTrack() || disposedRef.current) {
                  clearInterval(interval);
                }
              }, 200);
            }
          });
        } catch (mediaErr: any) {
          setError(
              mediaErr?.name === 'NotAllowedError'
                  ? 'Microphone/camera permission denied.'
                  : mediaErr?.name === 'NotFoundError'
                      ? 'No microphone or camera found.'
                      : 'Could not access microphone/camera.'
          );
        }
      } catch (err: any) {
        setError(err?.message || 'Failed to load conference library.');
      }
    })();

    return () => {
      disposedRef.current = true;
      try {
        localAudioTrackRef.current?.dispose();
        localVideoTrackRef.current?.dispose();
        roomRef.current?.leave();
        connectionRef.current?.disconnect();
      } catch {
        // best-effort cleanup
      }
      roomRef.current = null;
      connectionRef.current = null;
      localAudioTrackRef.current = null;
      localVideoTrackRef.current = null;
      setConnected(false);
      setJoined(false);
      setRemoteParticipants({});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, jwt, roomName, jitsiDomain]);

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

  const toggleVideo = useCallback(() => {
    const track = localVideoTrackRef.current;

    if (!track) {
      return;
    }
    if (track.isMuted()) {
      track.unmute();
      setLocalVideoMuted(false);
    } else {
      track.mute();
      setLocalVideoMuted(true);
    }
  }, []);

  const setLocalVideoElement = useCallback((el: HTMLVideoElement | null) => {
    localVideoElRef.current = el;
    if (el && localVideoTrackRef.current) {
      localVideoTrackRef.current.attach(el);
    }
  }, []);

  return {
    connected,
    joined,
    error,
    localAudioMuted,
    localVideoMuted,
    remoteParticipants,
    toggleAudio,
    toggleVideo,
    setLocalVideoElement
  };
}

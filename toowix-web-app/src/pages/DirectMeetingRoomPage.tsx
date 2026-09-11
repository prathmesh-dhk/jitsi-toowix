import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

import { useLibJitsiConference } from '../lib/useLibJitsiConference';

// Direct lib-jitsi-meet meeting room -- no Jitsi IFrame. Real MediaStreamTracks attached
// directly to our own <video> elements. New route (/meet-direct/:roomId), completely separate
// from the existing working iframe-based /meet/:roomId -- zero risk to production while this
// is verified.
const BACKEND_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const JITSI_DOMAIN = import.meta.env.VITE_JITSI_DOMAIN || 'talk.toowix.com';

function RemoteTile({ participant }: { participant: { id: string; name: string; audioTrack: any; videoTrack: any; muted: boolean; videoMuted: boolean } }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (videoRef.current && participant.videoTrack) {
      participant.videoTrack.attach(videoRef.current);
    }

    return () => {
      if (videoRef.current && participant.videoTrack) {
        participant.videoTrack.detach(videoRef.current);
      }
    };
    // The <video> element only mounts once videoMuted is false (see JSX below), which often
    // happens on a LATER render than the one that first set videoTrack (Jitsi commonly fires
    // the track as pre-muted, then unmutes moments later). Depending only on videoTrack means
    // this effect would never re-run for that unmute render, leaving videoRef.current pointing
    // at a freshly-mounted element that attach() was never called on. videoMuted is added so
    // the effect re-fires exactly when the element actually appears.
  }, [ participant.videoTrack, participant.videoMuted ]);

  useEffect(() => {
    if (audioRef.current && participant.audioTrack) {
      participant.audioTrack.attach(audioRef.current);
    }

    return () => {
      if (audioRef.current && participant.audioTrack) {
        participant.audioTrack.detach(audioRef.current);
      }
    };
  }, [ participant.audioTrack ]);

  return (
    <div style={{
      position: 'relative',
      borderRadius: '24px',
      overflow: 'hidden',
      backgroundColor: '#3c3020',
      aspectRatio: '16 / 9',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}
    >
      {!participant.videoMuted && participant.videoTrack ? (
        <video
          autoPlay
          playsInline
          ref={videoRef}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <div style={{
          width: '96px',
          height: '96px',
          borderRadius: '50%',
          backgroundColor: '#8B5CF6',
          color: '#fff',
          fontSize: '36px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
        >
          {(participant.name || '?').charAt(0).toUpperCase()}
        </div>
      )}
      <audio autoPlay ref={audioRef} />
      <div style={{
        position: 'absolute',
        bottom: '16px',
        left: '16px',
        color: '#fff',
        fontSize: '14px',
        fontWeight: 500,
        background: 'rgba(0,0,0,0.5)',
        padding: '4px 10px',
        borderRadius: '8px'
      }}
      >
        {participant.name}
      </div>
      {participant.muted && (
        <div style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          width: '24px',
          height: '24px',
          borderRadius: '50%',
          background: 'rgba(0,0,0,0.6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#F87171',
          fontSize: '12px'
        }}
        >
          🔇
        </div>
      )}
    </div>
  );
}

export function DirectMeetingRoomPage() {
  const { roomId = '' } = useParams();
  const [ displayName, setDisplayName ] = useState('Participant');
  const [ jwt, setJwt ] = useState<string | undefined>();
  const [ hasJoined, setHasJoined ] = useState(false);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!hasJoined) {
      return;
    }
    (async () => {
      try {
        // Same endpoint the existing iframe-based MeetingRoomPage uses (admission.ts on the
        // backend) -- reused as-is, no backend changes. Lobby/waiting-room handling is
        // intentionally out of scope for this first direct-media test page.
        const res = await fetch(`${BACKEND_URL}/api/meetings/room/${encodeURIComponent(roomId)}/admission`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: displayName.trim() || 'Guest' })
        });
        const data = await res.json();

        if (data.jitsiToken) {
          setJwt(data.jitsiToken);
        }
      } catch {
        // token fetch failed -- error state below will show "conference failed" once
        // useLibJitsiConference tries and fails without a jwt
      }
    })();
  }, [ hasJoined, roomId, displayName ]);

  const {
    connected,
    joined,
    error,
    localAudioMuted,
    localVideoMuted,
    remoteParticipants,
    toggleAudio,
    toggleVideo,
    setLocalVideoElement
  } = useLibJitsiConference({
    jitsiDomain: JITSI_DOMAIN,
    roomName: roomId,
    jwt,
    displayName,
    enabled: hasJoined && Boolean(jwt)
  });

  if (!hasJoined) {
    return (
      <div style={{
        height: '100vh',
        width: '100vw',
        background: '#131314',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '16px',
        fontFamily: 'sans-serif'
      }}
      >
        <h2 style={{ color: '#fff' }}>Direct lib-jitsi-meet test -- {roomId}</h2>
        <input
          onChange={e => setDisplayName(e.target.value)}
          placeholder="Your name"
          style={{ padding: '10px 16px', borderRadius: '8px', border: 'none', width: '260px' }}
          value={displayName}
        />
        <button
          onClick={() => setHasJoined(true)}
          style={{
            padding: '10px 24px',
            borderRadius: '24px',
            border: 'none',
            background: '#4F46E5',
            color: '#fff',
            cursor: 'pointer'
          }}
        >
          Join
        </button>
      </div>
    );
  }

  const remoteList = Object.values(remoteParticipants);

  return (
    <div style={{
      height: '100vh',
      width: '100vw',
      background: '#131314',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'sans-serif'
    }}
    >
      <div style={{ padding: '12px 24px', color: '#fff', display: 'flex', justifyContent: 'space-between' }}>
        <span>{roomId} -- {connected ? (joined ? 'Joined' : 'Connecting to conference...') : 'Connecting...'}</span>
        {error && <span style={{ color: '#F87171' }}>{error}</span>}
      </div>
      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: `repeat(${Math.min(remoteList.length + 1, 4) || 1}, 1fr)`,
        gap: '16px',
        padding: '16px',
        alignContent: 'center'
      }}
      >
        <div style={{
          position: 'relative',
          borderRadius: '24px',
          overflow: 'hidden',
          backgroundColor: '#2A1F3D',
          aspectRatio: '16 / 9',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
        >
          {!localVideoMuted ? (
            <video
              autoPlay
              muted
              playsInline
              ref={el => {
                localVideoRef.current = el;
                setLocalVideoElement(el);
              }}
              style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}
            />
          ) : (
            <div style={{
              width: '96px',
              height: '96px',
              borderRadius: '50%',
              backgroundColor: '#4F46E5',
              color: '#fff',
              fontSize: '36px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            >
              {(displayName || '?').charAt(0).toUpperCase()}
            </div>
          )}
          <div style={{
            position: 'absolute',
            bottom: '16px',
            left: '16px',
            color: '#fff',
            fontSize: '14px',
            fontWeight: 500,
            background: 'rgba(0,0,0,0.5)',
            padding: '4px 10px',
            borderRadius: '8px'
          }}
          >
            {displayName} (You)
          </div>
        </div>
        {remoteList.map(p => (
          <RemoteTile key={p.id} participant={p} />
        ))}
      </div>
      <div style={{ padding: '20px', display: 'flex', justifyContent: 'center', gap: '16px' }}>
        <button
          onClick={toggleAudio}
          style={{
            width: '52px',
            height: '52px',
            borderRadius: '50%',
            border: 'none',
            background: localAudioMuted ? '#EA4335' : '#3C4043',
            color: '#fff',
            cursor: 'pointer'
          }}
        >
          {localAudioMuted ? '🔇' : '🎤'}
        </button>
        <button
          onClick={toggleVideo}
          style={{
            width: '52px',
            height: '52px',
            borderRadius: '50%',
            border: 'none',
            background: localVideoMuted ? '#EA4335' : '#3C4043',
            color: '#fff',
            cursor: 'pointer'
          }}
        >
          {localVideoMuted ? '📷' : '📹'}
        </button>
      </div>
    </div>
  );
}

export default DirectMeetingRoomPage;

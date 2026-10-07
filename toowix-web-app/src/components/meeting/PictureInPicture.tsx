// Extracted from MeetingRoomPage.tsx (Track 3, Phase 2, item 2). Both pieces are pure/presentational
// -- everything they need comes in as props, no closures over the page's own state -- which is what
// made this the second-lowest-risk extraction in the plan. Moved verbatim; no behavior change.
import { useCallback, useEffect, useRef, memo } from 'react';
import { ArrowLeft, Hand, Mic, MicOff, Phone, Video, VideoOff } from 'lucide-react';
import { getParticipantColorTheme } from '../../lib/participantColorTheme';

// Live remote camera inside the Picture-in-Picture window.
export function PipRemoteVideo({ stream }: { stream: MediaStream }) {
  const nodeRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const node = nodeRef.current;

    if (node) {
      node.srcObject = stream;
      node.play().catch(() => { });
    }
  }, [stream]);

  return (
    <video
      ref={nodeRef}
      autoPlay
      playsInline
      muted
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
    />
  );
}

// Interactive Document Picture-in-Picture window content (Google Meet experience)
export const DocumentPipContent = memo(function DocumentPipContent({
  isScreenSharing,
  screenStream,
  remoteScreenStream,
  remotePresenterName,
  inCallVideo,
  inCallStream,
  inCallMuted,
  displayName,
  isHandRaised,
  remoteParticipants,
  roomTitle,
  avatarUrl,
  onToggleMic,
  onToggleVideo,
  onToggleHand,
  onReturnToMeeting,
  onLeaveMeeting,
}: {
  isScreenSharing: boolean;
  screenStream: MediaStream | null;
  remoteScreenStream: MediaStream | null;
  remotePresenterName: string | null;
  inCallVideo: boolean;
  inCallStream: MediaStream | null;
  inCallMuted: boolean | null;
  displayName: string;
  isHandRaised: boolean;
  remoteParticipants: Array<{ id: string; name: string; muted: boolean; video: boolean; raisedHand?: boolean; stream?: MediaStream | null }>;
  roomTitle: string;
  avatarUrl?: string | null;
  onToggleMic: () => void;
  onToggleVideo: () => void;
  onToggleHand: () => void;
  onReturnToMeeting: () => void;
  onLeaveMeeting: () => void;
}) {
  const activeScreenStream = isScreenSharing ? screenStream : remoteScreenStream;
  const isPresenting = Boolean(activeScreenStream);

  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);

  const setScreenVideoNode = useCallback((node: HTMLVideoElement | null) => {
    screenVideoRef.current = node;
    if (node) {
      node.srcObject = activeScreenStream;
      if (activeScreenStream) {
        node.play().catch(() => { });
      }
    }
  }, [activeScreenStream]);

  const setLocalVideoNode = useCallback((node: HTMLVideoElement | null) => {
    localVideoRef.current = node;
    if (node) {
      if (inCallVideo && inCallStream) {
        node.srcObject = inCallStream;
        node.play().catch(() => { });
      } else {
        node.srcObject = null;
      }
    }
  }, [inCallVideo, inCallStream]);

  // Reactive binding for screen presentation stream
  useEffect(() => {
    if (screenVideoRef.current) {
      screenVideoRef.current.srcObject = activeScreenStream;
      if (activeScreenStream) {
        screenVideoRef.current.play().catch(() => { });
      }
    }
  }, [activeScreenStream]);

  // Reactive binding for live camera stream
  useEffect(() => {
    if (localVideoRef.current) {
      if (inCallVideo && inCallStream) {
        localVideoRef.current.srcObject = inCallStream;
        localVideoRef.current.play().catch(() => { });
      } else {
        localVideoRef.current.srcObject = null;
      }
    }
  }, [inCallVideo, inCallStream]);

  const userInitial = (displayName || 'You').trim().charAt(0).toUpperCase() || 'U';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        backgroundColor: '#1E1F21',
        color: '#FFFFFF',
        boxSizing: 'border-box',
        overflow: 'hidden',
        userSelect: 'none',
        fontFamily: "'Google Sans', Roboto, sans-serif",
      }}
    >
      {/* Top Header with Meeting Title and Return to Tab */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          backgroundColor: 'rgba(0, 0, 0, 0.45)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          zIndex: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
          <span style={{ fontSize: '12px' }}>🟢</span>
          <span
            style={{
              fontSize: '12px',
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: '220px',
              color: '#E8EAED',
            }}
          >
            {roomTitle}
          </span>
        </div>
        <button
          onClick={onReturnToMeeting}
          title="Return to meeting tab"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            background: 'rgba(138, 180, 248, 0.15)',
            border: '1px solid rgba(138, 180, 248, 0.3)',
            borderRadius: '12px',
            padding: '4px 10px',
            color: '#8AB4F8',
            fontSize: '11px',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'background-color 0.15s ease',
          }}
        >
          Back to tab
        </button>
      </div>

      {/* Main Video Stage */}
      <div
        style={{
          flex: 1,
          position: 'relative',
          backgroundColor: '#000000',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {isPresenting ? (
          /* PRESENTATION MODE: Shared screen prominent + floating self-view thumbnail */
          <div
            style={{
              width: '100%',
              height: '100%',
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#000000',
            }}
          >
            <video
              ref={setScreenVideoNode}
              autoPlay
              playsInline
              muted
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />

            {/* Floating Presenter Pill Badge */}
            <div
              style={{
                position: 'absolute',
                top: '8px',
                left: '8px',
                backgroundColor: 'rgba(0, 0, 0, 0.72)',
                backdropFilter: 'blur(4px)',
                padding: '4px 10px',
                borderRadius: '8px',
                fontSize: '11px',
                fontWeight: 500,
                color: '#8AB4F8',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                zIndex: 10,
              }}
            >
              <span>🖥 {isScreenSharing ? 'You are presenting' : `${remotePresenterName || 'Participant'} is presenting`}</span>
            </div>

            {/* Corner floating self-view participant tile */}
            <div
              style={{
                position: 'absolute',
                bottom: '10px',
                right: '10px',
                width: '110px',
                height: '70px',
                borderRadius: '10px',
                backgroundColor: '#202124',
                overflow: 'hidden',
                boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                zIndex: 15,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {inCallVideo && inCallStream ? (
                <video
                  ref={setLocalVideoNode}
                  autoPlay
                  playsInline
                  muted
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    backgroundColor: '#1A73E8',
                    color: '#FFFFFF',
                    fontSize: '13px',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                  }}
                >
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                  ) : (
                    userInitial
                  )}
                </div>
              )}
              <div
                style={{
                  position: 'absolute',
                  bottom: '3px',
                  left: '4px',
                  fontSize: '9px',
                  color: '#FFFFFF',
                  backgroundColor: 'rgba(0,0,0,0.6)',
                  padding: '1px 4px',
                  borderRadius: '3px',
                  maxWidth: '90px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                You {inCallMuted ? '(Muted)' : ''}
              </div>
            </div>
          </div>
        ) : remoteParticipants.length === 0 ? (
          /* SOLO PARTICIPANT STAGE */
          <div
            style={{
              width: '100%',
              height: '100%',
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#202124',
            }}
          >
            {inCallVideo && inCallStream ? (
              <video
                ref={setLocalVideoNode}
                autoPlay
                playsInline
                muted
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <div
                  style={{
                    width: '68px',
                    height: '68px',
                    borderRadius: '50%',
                    backgroundColor: '#1A73E8',
                    color: '#FFFFFF',
                    fontSize: '26px',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                    overflow: 'hidden',
                  }}
                >
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                  ) : (
                    userInitial
                  )}
                </div>
              </div>
            )}
            <div
              style={{
                position: 'absolute',
                bottom: '8px',
                left: '8px',
                fontSize: '11px',
                color: '#FFFFFF',
                backgroundColor: 'rgba(0,0,0,0.6)',
                padding: '3px 8px',
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <span>{displayName || 'You'} (You)</span>
              {inCallMuted && <span style={{ color: '#F87171' }}>● Muted</span>}
            </div>
            {isHandRaised && (
              <div
                style={{
                  position: 'absolute',
                  top: '8px',
                  right: '8px',
                  backgroundColor: '#1A73E8',
                  borderRadius: '50%',
                  padding: '4px 6px',
                  fontSize: '13px',
                }}
              >
                ✋
              </div>
            )}
          </div>
        ) : (
          /* MULTI PARTICIPANT GRID */
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'grid',
              gridTemplateColumns: remoteParticipants.length === 1 ? 'minmax(0, 1fr)' : 'repeat(2, minmax(0, 1fr))',
              gridTemplateRows: 'repeat(2, minmax(0, 1fr))',
              gap: '6px',
              padding: '6px',
              boxSizing: 'border-box',
            }}
          >
            {/* Local Participant Tile */}
            <div
              style={{
                position: 'relative',
                borderRadius: '10px',
                backgroundColor: '#2D2E30',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
              }}
            >
              {inCallVideo && inCallStream ? (
                <video
                  ref={setLocalVideoNode}
                  autoPlay
                  playsInline
                  muted
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <div
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '50%',
                    backgroundColor: '#1A73E8',
                    color: '#FFFFFF',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '17px',
                    fontWeight: 600,
                    overflow: 'hidden',
                  }}
                >
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                  ) : (
                    userInitial
                  )}
                </div>
              )}
              <span
                style={{
                  position: 'absolute',
                  bottom: '4px',
                  left: '6px',
                  fontSize: '10px',
                  color: '#FFFFFF',
                  backgroundColor: 'rgba(0,0,0,0.55)',
                  padding: '2px 5px',
                  borderRadius: '4px',
                }}
              >
                You {inCallMuted ? '(Muted)' : ''}
              </span>
              {isHandRaised && (
                <span
                  style={{
                    position: 'absolute',
                    top: '4px',
                    right: '4px',
                    backgroundColor: '#1A73E8',
                    borderRadius: '50%',
                    padding: '2px 4px',
                    fontSize: '11px',
                  }}
                >
                  ✋
                </span>
              )}
            </div>

            {/* Remote Participants (up to 3) */}
            {remoteParticipants.slice(0, 3).map((p, idx) => {
              const theme = getParticipantColorTheme(p.name, idx + 1);
              const initial = (p.name.trim() || 'P').charAt(0).toUpperCase();
              return (
                <div
                  key={p.id || idx}
                  style={{
                    position: 'relative',
                    borderRadius: '10px',
                    backgroundColor: theme.tileBg,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                  }}
                >
                  {p.video && p.stream ? (
                    <PipRemoteVideo stream={p.stream} />
                  ) : (
                  <div
                    style={{
                      width: '38px',
                      height: '38px',
                      borderRadius: '50%',
                      backgroundColor: theme.avatarBg,
                      color: '#FFFFFF',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '16px',
                      fontWeight: 600,
                      overflow: 'hidden',
                    }}
                  >
                    {(p as any).avatarUrl ? (
                      <img src={(p as any).avatarUrl} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                    ) : (
                      initial
                    )}
                  </div>
                  )}
                  <span
                    style={{
                      position: 'absolute',
                      bottom: '4px',
                      left: '6px',
                      fontSize: '10px',
                      color: '#FFFFFF',
                      backgroundColor: 'rgba(0,0,0,0.55)',
                      padding: '2px 5px',
                      borderRadius: '4px',
                      zIndex: 2,
                      maxWidth: '120px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {p.name.length > 12 ? p.name.slice(0, 11) + '…' : p.name}
                  </span>
                  {p.raisedHand && (
                    <span
                      style={{
                        position: 'absolute',
                        top: '4px',
                        right: '4px',
                        backgroundColor: '#1A73E8',
                        borderRadius: '50%',
                        padding: '2px 4px',
                        fontSize: '11px',
                      }}
                    >
                      ✋
                    </span>
                  )}
                  {p.muted && (
                    <span
                      style={{
                        position: 'absolute',
                        top: '4px',
                        left: '4px',
                        backgroundColor: 'rgba(0,0,0,0.6)',
                        borderRadius: '50%',
                        width: '18px',
                        height: '18px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '10px',
                        color: '#F87171',
                      }}
                    >
                      ✕
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Interactive Bottom Controls Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '10px',
          padding: '10px 12px',
          backgroundColor: '#1E1F21',
          borderTop: '1px solid rgba(255, 255, 255, 0.1)',
          zIndex: 20,
        }}
      >
        {/* Mic Toggle */}
        <button
          onClick={onToggleMic}
          title={inCallMuted ? 'Turn on microphone' : 'Turn off microphone'}
          style={{
            width: '38px',
            height: '38px',
            borderRadius: '50%',
            backgroundColor: inCallMuted ? '#EA4335' : '#3C4043',
            color: '#FFFFFF',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 2px 6px rgba(0, 0, 0, 0.3)',
            transition: 'background-color 0.15s ease',
          }}
        >
          {inCallMuted ? <MicOff size={16} /> : <Mic size={16} />}
        </button>

        {/* Camera Toggle */}
        <button
          onClick={onToggleVideo}
          title={inCallVideo ? 'Turn off camera' : 'Turn on camera'}
          style={{
            width: '38px',
            height: '38px',
            borderRadius: '50%',
            backgroundColor: inCallVideo ? '#3C4043' : '#EA4335',
            color: '#FFFFFF',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 2px 6px rgba(0, 0, 0, 0.3)',
            transition: 'background-color 0.15s ease',
          }}
        >
          {inCallVideo ? <Video size={16} /> : <VideoOff size={16} />}
        </button>

        {/* Raise Hand Toggle */}
        <button
          onClick={onToggleHand}
          title={isHandRaised ? 'Lower hand' : 'Raise hand'}
          style={{
            width: '38px',
            height: '38px',
            borderRadius: '50%',
            backgroundColor: isHandRaised ? '#1A73E8' : '#3C4043',
            color: '#FFFFFF',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 2px 6px rgba(0, 0, 0, 0.3)',
            transition: 'background-color 0.15s ease',
          }}
        >
          <Hand size={16} />
        </button>

        {/* Return to Meeting Tab */}
        <button
          onClick={onReturnToMeeting}
          title="Return to meeting tab"
          style={{
            width: '38px',
            height: '38px',
            borderRadius: '50%',
            backgroundColor: '#3C4043',
            color: '#8AB4F8',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 2px 6px rgba(0, 0, 0, 0.3)',
            transition: 'background-color 0.15s ease',
          }}
        >
          <ArrowLeft size={16} />
        </button>

        {/* Leave Meeting Button */}
        <button
          onClick={onLeaveMeeting}
          title="Leave meeting"
          style={{
            width: '44px',
            height: '38px',
            borderRadius: '19px',
            backgroundColor: '#EA4335',
            color: '#FFFFFF',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 2px 6px rgba(234, 67, 53, 0.4)',
            transition: 'background-color 0.15s ease',
          }}
        >
          <Phone size={16} style={{ transform: 'rotate(135deg)' }} />
        </button>
      </div>
    </div>
  );
});

import { auth } from '../lib/firebase';
import { useMediaPreview } from '../lib/useMediaPreview';
import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams, useLocation, Link } from 'react-router-dom';
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  Settings,
  Sparkles,
  Lock,
  Users,
  ArrowRight,
  ArrowLeft,
  Copy,
  Check,
  X,
  Phone,
  Sun,
  Moon,
  Share2,
  Shield,
  UserCheck,
  UserX,
  Megaphone,
  AlertCircle,
  Clock,
  MessageSquare,
  LayoutGrid,
  ShieldCheck,
  Info,
  Pin,
  ChevronUp,
  ScreenShare,
  Smile,
  Subtitles,
  Hand,
  MoreVertical,
  Radio,
  Send,
  UserPlus,
} from 'lucide-react';
import { useTheme } from '../lib/theme';
import { ShareMeetingModal } from '../components/ShareMeetingModal';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000';

interface IWaitingParticipant {
  id: string;
  name: string;
  email?: string;
  requestedAt: string;
  status: 'WAITING' | 'ADMITTED' | 'DENIED';
}

export interface IParticipantColorTheme {
  name: string;
  avatarBg: string;
  tileBg: string;
  badgeBg: string;
  ringColor: string;
}

export const PARTICIPANT_COLOR_THEMES: IParticipantColorTheme[] = [
  // 0: Blue Theme
  {
    name: 'blue',
    avatarBg: '#1A73E8',
    tileBg: '#162842',
    badgeBg: 'rgba(15, 28, 46, 0.85)',
    ringColor: '#4285F4',
  },
  // 1: Pink / Rose Theme
  {
    name: 'pink',
    avatarBg: '#D81B60',
    tileBg: '#3B1828',
    badgeBg: 'rgba(43, 17, 29, 0.85)',
    ringColor: '#F06292',
  },
  // 2: Purple / Violet Theme
  {
    name: 'purple',
    avatarBg: '#8E24AA',
    tileBg: '#30183B',
    badgeBg: 'rgba(34, 17, 42, 0.85)',
    ringColor: '#BA68C8',
  },
  // 3: Teal / Cyan Theme
  {
    name: 'teal',
    avatarBg: '#00897B',
    tileBg: '#142E2B',
    badgeBg: 'rgba(14, 32, 30, 0.85)',
    ringColor: '#4DB6AC',
  },
  // 4: Amber / Orange Theme
  {
    name: 'orange',
    avatarBg: '#FB8C00',
    tileBg: '#3D2510',
    badgeBg: 'rgba(43, 26, 11, 0.85)',
    ringColor: '#FFB74D',
  },
  // 5: Olive Green Theme
  {
    name: 'green',
    avatarBg: '#558B2F',
    tileBg: '#284414',
    badgeBg: 'rgba(30, 51, 15, 0.85)',
    ringColor: '#81C995',
  },
  // 6: Crimson Red Theme
  {
    name: 'red',
    avatarBg: '#E53935',
    tileBg: '#3B1818',
    badgeBg: 'rgba(42, 17, 17, 0.85)',
    ringColor: '#EF5350',
  },
  // 7: Indigo Theme
  {
    name: 'indigo',
    avatarBg: '#3949AB',
    tileBg: '#1A1E3D',
    badgeBg: 'rgba(18, 21, 43, 0.85)',
    ringColor: '#7986CB',
  },
];

export function getParticipantColorTheme(identifier: string, forceIndex?: number): IParticipantColorTheme {
  if (typeof forceIndex === 'number') {
    return PARTICIPANT_COLOR_THEMES[Math.abs(forceIndex) % PARTICIPANT_COLOR_THEMES.length];
  }
  let hash = 0;
  const str = (identifier || '').trim().toLowerCase();
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return PARTICIPANT_COLOR_THEMES[Math.abs(hash) % PARTICIPANT_COLOR_THEMES.length];
}

// Interactive Document Picture-in-Picture window content (Google Meet experience)
const DocumentPipContent = memo(function DocumentPipContent({
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
  remoteParticipants: Array<{ id: string; name: string; muted: boolean; video: boolean; raisedHand?: boolean }>;
  roomTitle: string;
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
        node.play().catch(() => {});
      }
    }
  }, [activeScreenStream]);

  const setLocalVideoNode = useCallback((node: HTMLVideoElement | null) => {
    localVideoRef.current = node;
    if (node) {
      if (inCallVideo && inCallStream) {
        node.srcObject = inCallStream;
        node.play().catch(() => {});
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
        screenVideoRef.current.play().catch(() => {});
      }
    }
  }, [activeScreenStream]);

  // Reactive binding for live camera stream
  useEffect(() => {
    if (localVideoRef.current) {
      if (inCallVideo && inCallStream) {
        localVideoRef.current.srcObject = inCallStream;
        localVideoRef.current.play().catch(() => {});
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
                  }}
                >
                  {userInitial}
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
                  }}
                >
                  {userInitial}
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
              gridTemplateColumns: remoteParticipants.length === 1 ? '1fr 1fr' : 'repeat(2, 1fr)',
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
                  }}
                >
                  {userInitial}
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
                    }}
                  >
                    {initial}
                  </div>
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

export function MeetingRoomPage() {
  const { isDark, toggleTheme } = useTheme();
  const { roomId = 'lounge' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const [participation, setParticipation] = useState<'guest' | 'account'>(
    location.state?.participation === 'account' ? 'account' : 'guest'
  );
  const [jwtToken, setJwtToken] = useState<string>();
  const [admissionError, setAdmissionError] = useState('');
  const [joining, setJoining] = useState(false);
  const attendanceTokenRef = useRef('');
  const attendanceEntryIdRef = useRef<string | null>(null);
  const leavingRef = useRef(false);

  // Device IDs
  const [audioId, setAudioId] = useState('');
  const [videoId, setVideoId] = useState('');
  const [outputId, setOutputId] = useState('');

  // Meeting Stages & States
  const [hasJoined, setHasJoined] = useState(false);
  const [inWaitingRoom, setInWaitingRoom] = useState(false);
  const [waitingRequestId, setWaitingRequestId] = useState('');
  const [waitingDenied, setWaitingDenied] = useState(false);
  const [hostAnnouncement, setHostAnnouncement] = useState<string | null>(null);
  const [isModerator, setIsModerator] = useState(false);
  const [inCallMuted, setInCallMuted] = useState<boolean | null>(null);
  const [recording, setRecording] = useState(false);
  const [callError, setCallError] = useState('');

  // Pre-join user inputs — restore name from rejoin state or localStorage
  const [displayName, setDisplayName] = useState<string>(() => {
    if (location.state?.displayName) return location.state.displayName;
    if (!auth.currentUser) return localStorage.getItem('toowix_guest_displayName') || '';
    return '';
  });
  const [micEnabled, setMicEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [blurEnabled, setBlurEnabled] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showEndMeetingModal, setShowEndMeetingModal] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [announcementText, setAnnouncementText] = useState('');
  const [showAnnounceDialog, setShowAnnounceDialog] = useState(false);

  // Host Waiting Queue
  const [pendingQueue, setPendingQueue] = useState<IWaitingParticipant[]>([]);

  // Duration Timer in meeting
  const [meetingSeconds, setMeetingSeconds] = useState(0);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const recordingStartTimeRef = useRef<number | null>(null);
  const [inCallVideo, setInCallVideo] = useState(true);
  const [remoteParticipants, setRemoteParticipants] = useState<
    Array<{ id: string; name: string; muted: boolean; video: boolean; raisedHand?: boolean }>
  >([]);
  const [currentTime, setCurrentTime] = useState(() =>
    new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  );
  const [activePanel, setActivePanel] = useState<'chat' | 'people' | 'info' | 'host' | 'activities' | null>(null);
  const [showAudioMenu, setShowAudioMenu] = useState(false);
  const [showVideoMenu, setShowVideoMenu] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  const [floatingEmojis, setFloatingEmojis] = useState<Array<{ id: number; emoji: string; left: number }>>([]);
  const [captionsEnabled, setCaptionsEnabled] = useState(false);
  const [captionText, setCaptionText] = useState('');
  const [captionInterim, setCaptionInterim] = useState('');
  const speechRecognitionRef = useRef<any>(null);
  const [isHandRaised, setIsHandRaised] = useState(false);
  const [handRaisedToast, setHandRaisedToast] = useState<string | null>(null);
  const [pipHintToast, setPipHintToast] = useState<string | null>(null);
  // One-time "Enable Auto Picture-in-Picture" onboarding banner. Browsers reject a
  // script's PiP request that isn't backed by a real click (confirmed: NotAllowedError on
  // every tab-switch auto-attempt) -- there is no way to fake that click from code. This
  // banner exists to GET that one real click out of the way proactively, framed as an
  // opt-in, instead of leaving auto-PiP silently broken until the user happens to discover
  // and click the PiP button on their own. Persisted in localStorage so it only ever asks
  // once per browser, not once per meeting.
  const [showPipEnableCTA, setShowPipEnableCTA] = useState(false);
  const [isPiPActive, setIsPiPActive] = useState(false);
  const [documentPipActive, setDocumentPipActive] = useState(false);
  const documentPipWindowRef = useRef<any>(null);
  // Single source of truth for PiP state -- replaces the previously scattered
  // pipOpeningRef/pipTriggerTypeRef booleans, which could disagree with each other under
  // rapid tab switching. phase moves idle -> opening -> open -> closing -> idle; only the
  // operation holding the current requestId may act as the owner at any given moment
  // (enforced by openPip/closePip and every native/browser event handler below).
  const pipLifecycleRef = useRef<{
    phase: 'idle' | 'opening' | 'open' | 'closing';
    kind: 'document' | 'video' | null;
    origin: 'manual' | 'auto' | null;
    requestId: number;
  }>({ phase: 'idle', kind: null, origin: null, requestId: 0 });
  const pipCanvasStreamRef = useRef<MediaStream | null>(null);
  const pipUserEnabledRef = useRef(false);
  // Separate from pipUserEnabledRef: this one only ever flips true->stays true for the
  // life of the tab, purely to gate the "only once" permission hint toast. Reusing
  // pipUserEnabledRef for this was the actual bug -- it gets read/written for gesture
  // provenance too, so the hint kept reappearing on every failed auto-trigger.
  const pipHintShownRef = useRef(false);
  // Shown at most once per tab session, right after the FIRST successful manual PiP open
  // (real click). That's the exact moment Chromium browsers surface their own native
  // "Always allow Picture-in-Picture for this site" icon in the address bar -- most people
  // never notice it on their own, so this points at it. There is no JS API to trigger that
  // permission ourselves; this is the closest thing to it.
  const pipAutoAllowNudgeShownRef = useRef(false);
  // Bumped by every open/close attempt AND by the visibility-return handler (to invalidate
  // whatever open attempt might still be in flight). Each async attempt captures its own id
  // before awaiting; if a newer operation started (or the meeting ended) before an older
  // awaited step resolves, the older attempt sees its id is stale and bails instead of
  // publishing state or opening a second PiP window.
  const pipRequestIdRef = useRef(0);
  // Sole automatic-opening entry point: registered as the Media Session
  // 'enterpictureinpicture' action handler, which the BROWSER itself invokes when its
  // Automatic Picture-in-Picture conditions are met
  // (see https://developer.chrome.com/blog/automatic-picture-in-picture). Because the
  // browser calls this handler -- not our own script off a visibilitychange listener --
  // the PiP request made inside it is authorized/gesture-exempt in eligible, permitted
  // browsers, unlike a script-initiated call from an arbitrary event handler (confirmed via
  // direct testing: the latter always throws NotAllowedError).
  const triggerAutoPiPRef = useRef<(() => Promise<void>) | null>(null);
  const handleTogglePiPRef = useRef<(() => Promise<void>) | null>(null);
  const closePipRef = useRef<(() => Promise<void>) | null>(null);
  // Stable indirection so effects that just want to "poke" the PiP stream after doing
  // their own work (e.g. re-acquiring the camera) don't need initPipStream itself in
  // their dependency array -- its identity changes with isScreenSharing/remoteScreenStream,
  // and depending on it directly was re-running unrelated effects (item 3: camera
  // reacquisition) every time anyone started/stopped screen sharing.
  const initPipStreamRef = useRef<() => void>(() => {});
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showOtherWaysModal, setShowOtherWaysModal] = useState(false);
  const localParticipantIdRef = useRef<string>('local');
  const handleIncomingSignalRef = useRef<((sig: any) => void) | null>(null);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [quickAccessEnabled, setQuickAccessEnabled] = useState(true);
  const [chatMessages, setChatMessages] = useState<Array<{ id: string; sender: string; time: string; text: string }>>([
    { id: '1', sender: 'Toowix System', time: 'Just now', text: 'Welcome to the meeting! Messages sent here are visible to all participants.' }
  ]);
  const [chatInput, setChatInput] = useState('');
  const screenStreamRef = useRef<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const inCallStreamRef = useRef<MediaStream | null>(null);
  const [inCallStream, setInCallStream] = useState<MediaStream | null>(null);
  const inCallVideoRef = useRef<HTMLVideoElement | null>(null);
  const presentationVideoRef = useRef<HTMLVideoElement | null>(null);
  const [recordingToast, setRecordingToast] = useState<string | null>(null);
  const [remoteScreenStream, setRemoteScreenStream] = useState<MediaStream | null>(null);
  const [remotePresenterName, setRemotePresenterName] = useState<string | null>(null);
  const remotePresentationVideoRef = useRef<HTMLVideoElement | null>(null);
  const sessionIdRef = useRef<string>(
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).substring(2, 11) + '-' + Date.now().toString(36)
  );
  const processedSignalIdsRef = useRef<Set<string>>(new Set());
  // Signal dedup cache is unbounded time and never cleared for the life of the call,
  // so a long meeting with active screen-share signaling would otherwise grow it forever.
  // Cap it and evict oldest entries (Set preserves insertion order) once it's exceeded.
  const PROCESSED_SIGNAL_ID_CAP = 500;
  const addProcessedSignalId = (id: string) => {
    const set = processedSignalIdsRef.current;
    set.add(id);
    while (set.size > PROCESSED_SIGNAL_ID_CAP) {
      const oldest = set.values().next().value;
      if (oldest === undefined) break;
      set.delete(oldest);
    }
  };
  const presenterPeerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const viewerPeerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const presenterIceQueuesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const iceCandidateQueueRef = useRef<RTCIceCandidateInit[]>([]);
  const lastSignalTimestampRef = useRef<number>(Date.now() - 5000);
  const pipVideoRef = useRef<HTMLVideoElement | null>(null);
  const pipCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pipRafRef = useRef<number>(0);
  const pipTimerRef = useRef<any>(null);
  // Live refs so the PiP draw loop always reads current state
  const pipRemoteParticipantsRef = useRef<typeof remoteParticipants>([]);
  const pipIsScreenSharingRef = useRef(false);
  const pipRemoteScreenStreamRef = useRef<MediaStream | null>(null);
  const pipRemotePresenterNameRef = useRef('');
  const pipDisplayNameRef = useRef('');
  const pipAutoTriggeredRef = useRef(false);
  const pipInCallVideoRef = useRef(inCallVideo);
  const toggleInCallMicRef = useRef<() => void>(() => {});
  const toggleInCallVideoRef = useRef<() => void>(() => {});
  const toggleRaiseHandRef = useRef<() => void>(() => {});
  const leaveMeetingRef = useRef<() => void>(() => {});
  const pipInCallMutedRef = useRef<boolean | null>(null);
  const pipIsHandRaisedRef = useRef(false);
  const hasJoinedRef = useRef(hasJoined);
  useEffect(() => { hasJoinedRef.current = hasJoined; }, [hasJoined]);
  useEffect(() => { pipInCallMutedRef.current = inCallMuted; }, [inCallMuted]);
  useEffect(() => { pipIsHandRaisedRef.current = isHandRaised; }, [isHandRaised]);
  useEffect(() => { pipInCallVideoRef.current = inCallVideo; }, [inCallVideo]);

  // ── Web Speech API live captions ─────────────────────────────────────────
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!captionsEnabled) {
      // Stop any active recognition session
      if (speechRecognitionRef.current) {
        try { speechRecognitionRef.current.stop(); } catch {}
        speechRecognitionRef.current = null;
      }
      setCaptionText('');
      setCaptionInterim('');
      return;
    }

    if (!SpeechRecognition) {
      setCaptionText('⚠️ Live captions are not supported in this browser. Please use Chrome or Edge.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      let interim = '';
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript + ' ';
        } else {
          interim += transcript;
        }
      }
      if (final) {
        setCaptionText((prev) => {
          const combined = (prev + ' ' + final).trim();
          // Keep only last ~200 chars so box stays concise
          return combined.length > 200 ? combined.slice(combined.length - 200) : combined;
        });
      }
      setCaptionInterim(interim);
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'no-speech') return; // ignore silence
      if (event.error === 'not-allowed') {
        setCaptionText('⚠️ Microphone access denied. Allow mic permission to use captions.');
      }
    };

    recognition.onend = () => {
      // Auto-restart so captions stay active as long as enabled
      if (captionsEnabled && speechRecognitionRef.current === recognition) {
        try { recognition.start(); } catch {}
      }
    };

    try {
      recognition.start();
      speechRecognitionRef.current = recognition;
    } catch {}

    return () => {
      try { recognition.stop(); } catch {}
      speechRecognitionRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captionsEnabled]);

  // Dev-only PiP diagnostics -- trigger source, lifecycle phase/kind/origin/requestId,
  // document visibility, active window/video identity, video readiness/track state, and
  // (when relevant) the exact API error name/message. Never logs credentials, tokens, or
  // meeting content -- only PiP plumbing state.
  const logPipDiagnostic = (event: string, details: Record<string, unknown> = {}) => {
    if (!(import.meta as any).env?.DEV) return;
    const lc = pipLifecycleRef.current;
    try {
      const vid = pipVideoRef.current;
      const track = pipCanvasStreamRef.current?.getVideoTracks?.()[0];
      // eslint-disable-next-line no-console
      console.debug('[PiP]', event, {
        phase: lc.phase,
        kind: lc.kind,
        origin: lc.origin,
        requestId: lc.requestId,
        visibility: document.visibilityState,
        docPipWindowClosed: documentPipWindowRef.current ? Boolean(documentPipWindowRef.current.closed) : null,
        videoPipElementActive: Boolean((document as any).pictureInPictureElement),
        videoReadyState: vid?.readyState ?? null,
        videoTrackState: track?.readyState ?? null,
        ...details,
      });
    } catch {}
  };

  // ── Keep PiP refs in sync with live state ────────────────────────────────
  useEffect(() => { pipRemoteParticipantsRef.current = remoteParticipants; }, [remoteParticipants]);
  useEffect(() => { pipIsScreenSharingRef.current = isScreenSharing; }, [isScreenSharing]);
  useEffect(() => { pipRemoteScreenStreamRef.current = remoteScreenStream; }, [remoteScreenStream]);
  useEffect(() => { pipRemotePresenterNameRef.current = remotePresenterName || ''; }, [remotePresenterName]);
  useEffect(() => { pipDisplayNameRef.current = displayName; }, [displayName]);

  // ── Picture-in-Picture ───────────────────────────────────────────────────
  const ensurePipElements = () => {
    if (!pipCanvasRef.current) {
      const canvas = document.createElement('canvas');
      // Portrait 9:16 — matches Google Meet PiP aspect ratio
      canvas.width = 320;
      canvas.height = 568;
      pipCanvasRef.current = canvas;
    }
    if (!pipVideoRef.current) {
      const vid = document.createElement('video');
      vid.muted = true;
      vid.autoplay = true;
      vid.playsInline = true;
      vid.setAttribute('playsinline', 'true');
      vid.setAttribute('webkit-playsinline', 'true');
      (vid as any).autoPictureInPicture = true;
      vid.setAttribute('autopictureinpicture', 'true');
      // Real layout size and in-viewport coordinates so Chromium never throttles or drops video frames
      Object.assign(vid.style, {
        position: 'fixed',
        bottom: '0',
        right: '0',
        width: '320px',
        height: '180px',
        opacity: '0.001',
        pointerEvents: 'none',
        zIndex: '-10',
      });
      document.body.appendChild(vid);
      pipVideoRef.current = vid;

      vid.addEventListener('enterpictureinpicture', () => {
        // Fires whenever video-element PiP actually starts showing, regardless of what
        // caused it -- our own openPip() call succeeding, OR the browser re-entering it on
        // its own after a prior close. Keeps React/lifecycle state correct either way
        // instead of only trusting our own call's promise.
        setIsPiPActive(true);
        const lc = pipLifecycleRef.current;
        if (lc.phase !== 'open' || lc.kind !== 'video') {
          lc.phase = 'open';
          lc.kind = 'video';
          if (!lc.origin) lc.origin = 'auto';
        }
        // The leave handler below always stops the canvas draw loop, but nothing was
        // restarting it on the NEXT entry -- reopening PiP after a close showed a frozen
        // last frame instead of live content. Restart it here whenever the video's source
        // is still the synthetic canvas stream.
        if (pipCanvasStreamRef.current && vid.srcObject === pipCanvasStreamRef.current) {
          startPipDraw();
        }
        logPipDiagnostic('enter', { type: 'video' });
      });

      vid.addEventListener('leavepictureinpicture', () => {
        // Native browser close (window X, OS gesture, or programmatic exit) — this fires
        // regardless of how PiP was closed, so it's the single source of truth for
        // "video-element PiP is no longer showing." Canvas drawing must stop here too,
        // otherwise it keeps running 24/7 against a PiP that's no longer visible.
        stopPipDraw();
        setIsPiPActive(false);
        pipAutoTriggeredRef.current = false;
        const lc = pipLifecycleRef.current;
        if (lc.kind === 'video') {
          lc.phase = 'idle';
          lc.kind = null;
          lc.origin = null;
        }
        // NOTE: intentionally NOT resetting pipUserEnabledRef here. That flag records
        // "has the user ever manually used the PiP button" (gesture provenance, used to
        // decide whether the auto-PiP permission hint should show) — it must survive
        // across PiP close/reopen cycles, or the hint would reappear every single time
        // auto-PiP fails after the very first manual use.
        logPipDiagnostic('native-close', { type: 'video' });
      });
    }
  };

  const drawRoundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  };

  // Draw a single participant card with EXACT colors matching the meeting tiles
  const drawParticipantCard = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    name: string,
    theme: IParticipantColorTheme,
    videoEl: HTMLVideoElement | null,
    muted: boolean,
    raisedHand: boolean
  ) => {
    // 1. Tile Background — matches EXACT main stage tile background
    ctx.fillStyle = theme.tileBg;
    drawRoundRect(ctx, x, y, w, h, 14);
    ctx.fill();

    // 2. Video feed OR Avatar circle
    if (videoEl && videoEl.readyState >= 2 && !videoEl.paused) {
      ctx.save();
      drawRoundRect(ctx, x, y, w, h, 14);
      ctx.clip();
      ctx.drawImage(videoEl, x, y, w, h);
      ctx.restore();
    } else {
      // Avatar circle — matches EXACT avatarBg from participant theme
      const cx = x + w / 2;
      const cy = y + h / 2 - 8;
      const r = Math.min(w, h) * 0.22;
      ctx.fillStyle = theme.avatarBg;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#FFFFFF';
      ctx.font = `500 ${Math.round(r * 0.9)}px 'Google Sans', Roboto, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const cleanName = name.replace(/\(You\)/i, '').trim();
      const initial = (cleanName || '?').charAt(0).toUpperCase();
      ctx.fillText(initial, cx, cy);
    }

    // 3. Name pill / gradient at bottom
    const grad = ctx.createLinearGradient(x, y + h - 36, x, y + h);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.72)');
    ctx.fillStyle = grad;
    drawRoundRect(ctx, x, y + h - 36, w, 36, 0);
    ctx.fill();

    // Name label
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `500 12px 'Google Sans', Roboto, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    const label = name.length > 20 ? name.slice(0, 18) + '…' : name;
    ctx.fillText(label, x + 8, y + h - 6);

    // 4. Muted mic indicator (top-right)
    if (muted) {
      ctx.fillStyle = theme.badgeBg || 'rgba(0,0,0,0.6)';
      ctx.beginPath();
      ctx.arc(x + w - 16, y + 16, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#F87171';
      ctx.beginPath();
      ctx.arc(x + w - 16, y + 16, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // 5. Raised hand badge (top-left)
    if (raisedHand) {
      ctx.fillStyle = '#1A73E8';
      ctx.beginPath();
      ctx.arc(x + 16, y + 16, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✋', x + 16, y + 16);
    }
  };

  // Bottom toolbar rendered directly onto PiP canvas (Google Meet PiP style)
  const drawPipToolbar = (
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    isMuted: boolean,
    isVideoOn: boolean,
    isHandRaised: boolean
  ) => {
    const TOOLBAR_H = 48;
    const ty = H - TOOLBAR_H;

    // Dark sleek background for toolbar
    ctx.fillStyle = '#18191C';
    ctx.fillRect(0, ty, W, TOOLBAR_H);

    // Subtle divider line
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(0, ty, W, 1);

    const btnSize = 30;
    const btnRadius = btnSize / 2;
    const cy = ty + TOOLBAR_H / 2;
    const gap = 10;
    const hangW = 44;
    const totalW = btnSize * 3 + hangW + gap * 3; // ~164px
    let startX = Math.round((W - totalW) / 2);

    // 1. Microphone Toggle Button
    const micX = startX + btnRadius;
    ctx.fillStyle = isMuted ? '#EA4335' : '#3C4043';
    ctx.beginPath();
    ctx.arc(micX, cy, btnRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isMuted ? '✕' : '🎤', micX, cy);

    // 2. Camera Toggle Button
    const camX = micX + btnRadius + gap + btnRadius;
    ctx.fillStyle = !isVideoOn ? '#EA4335' : '#3C4043';
    ctx.beginPath();
    ctx.arc(camX, cy, btnRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isVideoOn ? '📹' : '✕', camX, cy);

    // 3. Raise Hand Button
    const handX = camX + btnRadius + gap + btnRadius;
    ctx.fillStyle = isHandRaised ? '#8AB4F8' : '#3C4043';
    ctx.beginPath();
    ctx.arc(handX, cy, btnRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = isHandRaised ? '#202124' : '#FFFFFF';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✋', handX, cy);

    // 4. Hangup / End Call Button (Red pill)
    const hangX = handX + btnRadius + gap;
    ctx.fillStyle = '#EA4335';
    drawRoundRect(ctx, hangX, cy - btnRadius, hangW, btnSize, btnRadius);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('📞', hangX + hangW / 2, cy);
  };

  // Synchronously draw a single PiP frame to canvas immediately
  const drawPipFrame = () => {
    const canvas = pipCanvasRef.current;
    if (!canvas) return;
    const W = canvas.width;
    const H = canvas.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Background
    ctx.fillStyle = '#202124';
    ctx.fillRect(0, 0, W, H);

    const remotes = pipRemoteParticipantsRef.current;
    const localName = pipDisplayNameRef.current || 'You';
    const isLocalScreenSharing = pipIsScreenSharingRef.current;
    const hasScreen = isLocalScreenSharing || Boolean(pipRemoteScreenStreamRef.current);
    const screenVid = isLocalScreenSharing ? presentationVideoRef.current : remotePresentationVideoRef.current;
    const localVid = inCallVideoRef.current;
    const localMuted = pipInCallMutedRef.current ?? false;
    const localHandRaised = pipIsHandRaisedRef.current;

    const GAP = 8;
    const PADDING = 8;
    const HEADER_H = 28;
    const TOOLBAR_H = 48;

    if (hasScreen) {
      // ── Screen-sharing layout (Google Meet style): the shared screen fills the frame,
      // with a small floating circular self-view bubble overlapping its bottom-right
      // corner -- matches Meet's PiP treatment of screen share, where the screen always
      // gets priority over any participant tile. ──
      const screenY = HEADER_H + PADDING;
      const screenH = H - HEADER_H - TOOLBAR_H - PADDING * 2;
      const screenW = W - PADDING * 2;

      ctx.save();
      drawRoundRect(ctx, PADDING, screenY, screenW, screenH, 12);
      ctx.clip();
      if (screenVid && screenVid.readyState >= 2 && !screenVid.paused) {
        ctx.fillStyle = '#000000';
        ctx.fillRect(PADDING, screenY, screenW, screenH);
        // Letterbox the shared screen to preserve its aspect ratio, matching Meet's fit-contain behavior
        const vw = screenVid.videoWidth || screenW;
        const vh = screenVid.videoHeight || screenH;
        const scale = Math.min(screenW / vw, screenH / vh);
        const dw = vw * scale;
        const dh = vh * scale;
        const dx = PADDING + (screenW - dw) / 2;
        const dy = screenY + (screenH - dh) / 2;
        ctx.drawImage(screenVid, dx, dy, dw, dh);
      } else {
        ctx.fillStyle = '#18191C';
        ctx.fillRect(PADDING, screenY, screenW, screenH);
        ctx.fillStyle = '#8AB4F8';
        ctx.font = '500 13px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          isLocalScreenSharing ? '🖥 You are presenting' : `${pipRemotePresenterNameRef.current || 'Participant'} is presenting`,
          W / 2,
          screenY + screenH / 2
        );
      }
      ctx.restore();

      // Presenter label, top-left of the screen tile
      const presenterLabel = isLocalScreenSharing
        ? 'You are presenting'
        : `${pipRemotePresenterNameRef.current || 'Participant'} is presenting`;
      ctx.font = '500 11px sans-serif';
      const labelW = Math.min(screenW - 16, ctx.measureText('🖥 ' + presenterLabel).width + 16);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      drawRoundRect(ctx, PADDING + 8, screenY + 8, labelW, 22, 11);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.save();
      drawRoundRect(ctx, PADDING + 8, screenY + 8, labelW, 22, 11);
      ctx.clip();
      ctx.fillText('🖥 ' + presenterLabel, PADDING + 14, screenY + 19);
      ctx.restore();

      // Floating circular self-view bubble, bottom-right of the screen tile
      const bubbleR = 30;
      const bubbleCx = PADDING + screenW - bubbleR - 10;
      const bubbleCy = screenY + screenH - bubbleR - 10;
      ctx.save();
      ctx.beginPath();
      ctx.arc(bubbleCx, bubbleCy, bubbleR + 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(bubbleCx, bubbleCy, bubbleR, 0, Math.PI * 2);
      ctx.clip();
      const localTheme = getParticipantColorTheme(localName, 0);
      if (localVid && localVid.readyState >= 2 && !localVid.paused) {
        ctx.drawImage(localVid, bubbleCx - bubbleR, bubbleCy - bubbleR, bubbleR * 2, bubbleR * 2);
      } else {
        ctx.fillStyle = localTheme.avatarBg;
        ctx.fillRect(bubbleCx - bubbleR, bubbleCy - bubbleR, bubbleR * 2, bubbleR * 2);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = `500 ${Math.round(bubbleR * 0.8)}px 'Google Sans', Roboto, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const cleanName = localName.replace(/\(You\)/i, '').trim();
        ctx.fillText((cleanName || '?').charAt(0).toUpperCase(), bubbleCx, bubbleCy);
      }
      ctx.restore();

      // Muted-mic badge on the self-view bubble (top-right of the circle)
      if (localMuted) {
        ctx.fillStyle = '#EA4335';
        ctx.beginPath();
        ctx.arc(bubbleCx + bubbleR * 0.62, bubbleCy - bubbleR * 0.62, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('✕', bubbleCx + bubbleR * 0.62, bubbleCy - bubbleR * 0.62);
      }

      // Remote-participant count badge, if there are others in the call besides the presenter
      if (remotes.length > 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        drawRoundRect(ctx, PADDING + 8, screenY + screenH - 30, 64, 22, 11);
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '500 11px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`+${remotes.length}`, PADDING + 16, screenY + screenH - 19);
      }
    } else {
      // ── Normal vertical stack layout (Google Meet PiP style) ──
      const allParticipants = [
        {
          name: localName + ' (You)',
          theme: getParticipantColorTheme(localName || 'You', 0),
          isLocal: true,
          muted: localMuted,
          raisedHand: localHandRaised,
        },
        ...remotes.map((r, idx) => ({
          name: r.name,
          theme: getParticipantColorTheme(r.name, idx + 1),
          isLocal: false,
          muted: r.muted,
          raisedHand: !!r.raisedHand,
        })),
      ];
      const count = allParticipants.length;
      const availH = H - HEADER_H - TOOLBAR_H - PADDING * 2 - GAP * (count - 1);
      const cardH = Math.floor(availH / Math.max(count, 1));

      allParticipants.forEach((p, i) => {
        const cy = HEADER_H + PADDING + i * (cardH + GAP);
        const videoEl = p.isLocal ? localVid : null;
        drawParticipantCard(ctx, PADDING, cy, W - PADDING * 2, cardH, p.name, p.theme, videoEl, p.muted, p.raisedHand);
      });
    }

    // Header bar: meeting name + count overlay
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(0, 0, W, HEADER_H);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `500 11px 'Google Sans', Roboto, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('🟢 Toowix Meet', 8, 14);
    ctx.textAlign = 'right';
    ctx.fillText(`${remotes.length + 1} in call`, W - 8, 14);

    // Bottom navigation toolbar (Google Meet PiP style)
    const isVideoOn = pipInCallVideoRef.current ?? true;
    drawPipToolbar(ctx, W, H, localMuted, isVideoOn, localHandRaised);
  };

  // Continuous draw loop using rock-solid setInterval so browser backgrounding never freezes stream
  const startPipDraw = () => {
    if (pipTimerRef.current) return;
    drawPipFrame();
    pipTimerRef.current = setInterval(drawPipFrame, 66); // ~15fps
  };

  const stopPipDraw = () => {
    if (pipTimerRef.current) {
      clearInterval(pipTimerRef.current);
      pipTimerRef.current = null;
    }
    cancelAnimationFrame(pipRafRef.current);
  };

  // Helper to check if Document PiP window is truly open and detect unexpected closures
  const isDocPipWindowOpen = () => {
    const win = documentPipWindowRef.current;
    if (!win) return false;
    if (win.closed) {
      // Detected closed window whose pagehide may have been missed or delayed
      documentPipWindowRef.current = null;
      setDocumentPipActive(false);
      setIsPiPActive(false);
      const lc = pipLifecycleRef.current;
      if (lc.kind === 'document') {
        lc.phase = 'idle';
        lc.kind = null;
        lc.origin = null;
      }
      logPipDiagnostic('native-close', { type: 'document', detectedVia: 'poll' });
      return false;
    }
    return true;
  };

  // Helper to check if HTMLVideoElement PiP is active
  const isVideoPipActive = () => {
    return Boolean((document as any).pictureInPictureElement);
  };

  // Helper to check if synthetic canvas stream is healthy and usable
  const isSyntheticStreamHealthy = (stream: MediaStream | null): boolean => {
    if (!stream || !stream.active) return false;
    const tracks = stream.getVideoTracks();
    if (tracks.length === 0) return false;
    return tracks.every((t) => t.readyState === 'live');
  };

  // Helper to ensure video element is ready to enter Picture-in-Picture without InvalidStateError
  const ensureVideoReady = (vid: HTMLVideoElement, maxWaitMs = 1200): Promise<boolean> => {
    return new Promise((resolve) => {
      if (vid.readyState >= 2 && vid.videoWidth > 0) {
        return resolve(true);
      }
      let timer: any = null;
      const onReady = () => {
        cleanup();
        resolve(true);
      };
      const cleanup = () => {
        vid.removeEventListener('loadeddata', onReady);
        vid.removeEventListener('canplay', onReady);
        if (timer) clearTimeout(timer);
      };
      vid.addEventListener('loadeddata', onReady, { once: true });
      vid.addEventListener('canplay', onReady, { once: true });
      timer = setTimeout(() => {
        cleanup();
        resolve(vid.readyState >= 2);
      }, maxWaitMs);
    });
  };

  // Helper to configure a native Document Picture-in-Picture window
  const setupPipWindow = (pipWin: any, isManual: boolean) => {
    // If call was left while request was pending, immediately close window
    if (!hasJoinedRef.current) {
      try { pipWin.close(); } catch {}
      return;
    }

    // Copy stylesheets from document.head once (clean, fast, no duplicate stylesheets)
    [...document.head.querySelectorAll('style, link[rel="stylesheet"]')].forEach((el) => {
      try {
        pipWin.document.head.appendChild(el.cloneNode(true));
      } catch {}
    });
    pipWin.document.body.style.margin = '0';
    pipWin.document.body.style.backgroundColor = '#1E1F21';
    pipWin.document.body.style.color = '#FFFFFF';
    pipWin.document.body.style.fontFamily = "'Google Sans', Roboto, sans-serif";
    pipWin.document.body.style.overflow = 'hidden';

    const onPageHide = () => {
      // Race protection: only clear state if this closing window is the current active
      // window -- an older window's pagehide firing late must never clear a NEWER window's
      // state (e.g. rapid close+reopen), which is exactly what this identity check prevents.
      if (documentPipWindowRef.current === pipWin) {
        documentPipWindowRef.current = null;
        setDocumentPipActive(false);
        setIsPiPActive(false);
        const lc = pipLifecycleRef.current;
        if (lc.kind === 'document') {
          lc.phase = 'idle';
          lc.kind = null;
          lc.origin = null;
        }
        logPipDiagnostic('native-close', { type: 'document' });
      }
    };

    pipWin.addEventListener('pagehide', onPageHide);

    documentPipWindowRef.current = pipWin;
    const lc = pipLifecycleRef.current;
    lc.phase = 'open';
    lc.kind = 'document';
    lc.origin = isManual ? 'manual' : 'auto';
    setDocumentPipActive(true);
    setIsPiPActive(true);
    logPipDiagnostic('open', { type: 'document', origin: lc.origin });
  };

  const initPipStream = useCallback(() => {
    ensurePipElements();
    const canvas = pipCanvasRef.current;
    const vid = pipVideoRef.current;
    if (!canvas || !vid) return;

    // Always render through the composited canvas (drawPipFrame), including while screen
    // sharing -- that's what produces the Google Meet-style layout (screen tile + header +
    // participant thumbnails + toolbar). Attaching the raw screen MediaStream directly used
    // to bypass all of that and show it as a bare, uncomposited video ("square box" with no
    // chrome around it) -- never do that; the canvas path already handles screen share.
    if (!isSyntheticStreamHealthy(pipCanvasStreamRef.current)) {
      if (pipCanvasStreamRef.current) {
        try { pipCanvasStreamRef.current.getTracks().forEach((t) => t.stop()); } catch {}
        pipCanvasStreamRef.current = null;
      }
    }
    drawPipFrame();
    startPipDraw();
    if (!pipCanvasStreamRef.current || vid.srcObject !== pipCanvasStreamRef.current) {
      const synthStream = canvas.captureStream(15);
      pipCanvasStreamRef.current = synthStream;
      vid.srcObject = synthStream;
    }
    (vid as any).autoPictureInPicture = true;
    vid.setAttribute('autopictureinpicture', 'true');
    if (vid.paused) {
      vid.play().catch(() => {});
    }
  }, []);

  useEffect(() => {
    initPipStreamRef.current = initPipStream;
  }, [initPipStream]);

  // Keep the fallback PiP <video> primed with a live (cheap, uncomposited) stream at all
  // times while in the call, so its readyState is already >= 2 the instant a tab-hide
  // fires. Without this, every auto-trigger has to wait for the stream to attach before
  // it can call requestPictureInPicture() -- and that wait can push the call outside the
  // window Chrome grants an activation-free "auto PiP" allowance for, causing it to fail
  // silently on repeated switches even though the very first one (attached moments after
  // a real click) still worked. Deliberately does NOT touch the heavier composited canvas
  // draw loop (started in initPipStream/startPipDraw) -- that stays gated to only run once
  // PiP is actually visible.
  useEffect(() => {
    if (!hasJoined) return;
    if (isDocPipWindowOpen() || isVideoPipActive()) return;
    ensurePipElements();
    const vid = pipVideoRef.current;
    const primingStream = inCallStreamRef.current;
    if (!vid || !primingStream) return;
    if (vid.srcObject !== primingStream) {
      vid.srcObject = primingStream;
      vid.play().catch(() => {});
    }
  }, [hasJoined, inCallStream]);

  // Keep the Video-PiP fallback's stream in sync with screen-share changes -- but ONLY
  // while that fallback is actually the open PiP (item 2: this used to run unconditionally
  // on every join/screen-share change, which kept the ~15fps canvas draw loop running for
  // the entire meeting even when no PiP window was ever opened). Document PiP renders real
  // React content via its own portal and never touches this canvas/video element at all,
  // so it's deliberately excluded here.
  useEffect(() => {
    if (!hasJoined) return;
    if (!isVideoPipActive()) return;
    initPipStream();
  }, [hasJoined, isScreenSharing, remoteScreenStream, initPipStream]);

  // If screen sharing ends while an auto-triggered PiP is being kept open (the "stay
  // constant during screen share" case above) and the user is already back on the meeting
  // tab, there's no more reason for it to stay open -- close it now instead of leaving it
  // stranded open until the next tab switch.
  useEffect(() => {
    if (!hasJoined) return;
    if (isScreenSharing || remoteScreenStream) return;
    if (document.visibilityState !== 'visible') return;
    const lc = pipLifecycleRef.current;
    if (lc.phase !== 'open' || lc.origin !== 'auto') return;
    closePipRef.current?.();
  }, [hasJoined, isScreenSharing, remoteScreenStream]);

  // Close whichever PiP type is currently open. Single consolidated close path used by the
  // manual toggle, the "Return to meeting" button inside Document PiP, the visibility-return
  // handler, and the screen-share-ended effect above -- one place decides how a close
  // completes instead of several places each duplicating slightly different logic (which is
  // how "closing" state used to end up inconsistent between them).
  const closePip = useCallback(async () => {
    const lc = pipLifecycleRef.current;
    if (lc.phase !== 'open') return; // nothing open, or an open/close is already in flight
    const myRequestId = ++pipRequestIdRef.current;
    const closingKind = lc.kind;
    lc.phase = 'closing';
    lc.requestId = myRequestId;
    const isCurrent = () => pipLifecycleRef.current.requestId === myRequestId;
    logPipDiagnostic('close-start', { type: closingKind });

    try {
      if (closingKind === 'video') {
        try {
          await (document as any).exitPictureInPicture();
        } catch (err: any) {
          logPipDiagnostic('close-error', { type: 'video', errorName: err?.name, errorMessage: err?.message });
        }
        stopPipDraw();
      } else if (closingKind === 'document') {
        try { documentPipWindowRef.current?.close(); } catch {}
      }
    } finally {
      // Only finalize to idle if this operation still owns the lifecycle -- a native close
      // event (leavepictureinpicture / pagehide) may have already raced ahead and reset
      // state itself, in which case there's nothing left for us to do here.
      if (isCurrent()) {
        documentPipWindowRef.current = null;
        setDocumentPipActive(false);
        setIsPiPActive(false);
        lc.phase = 'idle';
        lc.kind = null;
        lc.origin = null;
      }
      logPipDiagnostic('close-end', { type: closingKind });
    }
  }, []);

  useEffect(() => {
    closePipRef.current = closePip;
  }, [closePip]);

  // Single consolidated PiP-opening routine, used for BOTH origins:
  //  - 'manual': invoked directly from a real click (handleTogglePiP) -- always
  //    gesture-backed, guaranteed eligible.
  //  - 'auto': invoked ONLY from the browser-authorized Media Session
  //    'enterpictureinpicture' action handler (registered in the effect below) -- NOT from
  //    our own visibilitychange listener. Per
  //    https://developer.chrome.com/blog/automatic-picture-in-picture, that Media Session
  //    handler is the officially supported automatic-entry point: the BROWSER decides when
  //    to invoke it (tab hidden, eligibility/permission conditions met), and because the
  //    call originates from that browser-invoked context rather than an ordinary page
  //    script event, it is authorized/exempt where a plain visibilitychange-triggered call
  //    is not. Confirmed via direct testing: a script call made from our own
  //    visibilitychange handler reliably throws NotAllowedError; it is not "impossible" for
  //    the API to auto-open, it was simply the wrong (unauthorized) call site. Only one
  //    opening/closing operation may own the lifecycle at a time -- phase !== 'idle' refuses
  //    a second concurrent attempt outright, so rapid tab flips can't produce duplicates.
  const openPip = useCallback(async (origin: 'manual' | 'auto') => {
    if (!hasJoinedRef.current) return;
    const lc = pipLifecycleRef.current;
    if (lc.phase !== 'idle') return;
    const myRequestId = ++pipRequestIdRef.current;
    lc.phase = 'opening';
    lc.origin = origin;
    lc.requestId = myRequestId;
    // "Current" requires holding the latest id, the meeting still being joined, and -- for
    // auto-origin opens specifically -- the tab still being hidden (returning to the tab
    // means the user wants the main page, not a freshly-opened PiP window competing for
    // attention). A manual open has no visibility requirement since it's a direct request.
    const isCurrent = () =>
      pipLifecycleRef.current.requestId === myRequestId &&
      hasJoinedRef.current &&
      (origin !== 'auto' || document.visibilityState === 'hidden');
    let opened = false;
    logPipDiagnostic('open-start', { trigger: origin === 'manual' ? 'manual' : 'media-session' });

    try {
      // 1. Prefer Document PiP for interactive meeting content where supported -- it
      // renders the real in-meeting React portal (live tiles, controls) rather than the
      // synthetic canvas dub Video PiP is limited to. Both a manual click and the
      // browser-authorized Media Session callback are legitimate, permission-satisfied
      // contexts to call requestWindow() from.
      if ('documentPictureInPicture' in window) {
        try {
          const pipWin = await (window as any).documentPictureInPicture.requestWindow({
            width: 380,
            height: 500,
          });
          if (!isCurrent()) {
            try { pipWin.close(); } catch {}
            return;
          }
          setupPipWindow(pipWin, origin === 'manual');
          opened = true;
          if (origin === 'manual') maybeShowAutoPipAllowNudge();
          return;
        } catch (docPipErr: any) {
          logPipDiagnostic('open-error', {
            type: 'document', origin, errorName: docPipErr?.name, errorMessage: docPipErr?.message,
          });
          if (docPipErr?.name === 'NotAllowedError' && origin === 'auto' && !pipHintShownRef.current) {
            // This browser/session doesn't currently grant Automatic Picture-in-Picture
            // for this site, or eligibility conditions (active media session playback,
            // installed-app state, etc.) aren't met right now. Falls through to the Video
            // PiP fallback below rather than giving up.
            pipHintShownRef.current = true;
            setPipHintToast('Automatic Picture-in-Picture isn\'t enabled for this browser/site yet. Use the PiP button, or check your browser\'s Automatic Picture-in-Picture site permission.');
            setTimeout(() => setPipHintToast(null), 7000);
          }
        }
      }

      if (!isCurrent()) return;

      // 2. Video PiP fallback.
      if (!(document as any).pictureInPictureEnabled) return;
      ensurePipElements();
      const vid = pipVideoRef.current;
      if (!vid) return;
      initPipStream();
      if (vid.paused) {
        try { await vid.play(); } catch {}
      }
      if (!isCurrent()) return;

      // The priming effect keeps this video fed with a live stream at all times while in a
      // call, so readyState is almost always already >= 2 here -- this only actually waits
      // right after joining, before priming has had a chance to run. Kept short and skipped
      // entirely when already ready, since a permission-sensitive request should not be
      // delayed by a readiness wait when it can be avoided.
      const ready = vid.readyState >= 2 && vid.videoWidth > 0 ? true : await ensureVideoReady(vid, 500);
      if (!ready) {
        logPipDiagnostic('open-error', { type: 'video', origin, reason: 'not-ready', readyState: vid.readyState });
        return;
      }
      if (!isCurrent()) return;

      try {
        await (vid as any).requestPictureInPicture();
        if (!isCurrent()) {
          try { await (document as any).exitPictureInPicture(); } catch {}
          return;
        }
        lc.phase = 'open';
        lc.kind = 'video';
        setIsPiPActive(true);
        opened = true;
        if (origin === 'manual') maybeShowAutoPipAllowNudge();
        logPipDiagnostic('open-success', { type: 'video', origin });
      } catch (videoPipErr: any) {
        logPipDiagnostic('open-error', {
          type: 'video', origin, errorName: videoPipErr?.name, errorMessage: videoPipErr?.message,
        });
        if (videoPipErr?.name === 'NotAllowedError' && origin === 'auto' && !pipHintShownRef.current) {
          pipHintShownRef.current = true;
          setPipHintToast('Automatic Picture-in-Picture isn\'t enabled for this browser/site yet. Use the PiP button, or check your browser\'s Automatic Picture-in-Picture site permission.');
          setTimeout(() => setPipHintToast(null), 7000);
        }
        stopPipDraw();
      }
    } finally {
      if (!opened && isCurrent()) {
        lc.phase = 'idle';
        lc.origin = null;
        lc.kind = null;
      }
      logPipDiagnostic('open-end', { opened });
    }
  }, [initPipStream]);

  // Nudge the user toward the browser's own native "Always allow Picture-in-Picture" icon
  // in the address bar, right after their first manual (real-click) PiP open -- that's the
  // moment Chromium surfaces it. Skips the nudge entirely if the Permissions API reports
  // it's already granted (nothing to point at); does not treat an unsupported/erroring
  // query as proof of either denial or approval -- it just falls through to showing the
  // nudge, since that's the safe default either way. Never asks twice in one tab session.
  // NOTE: this points the user at a SEPARATE browser permission step ("Always allow") --
  // it does not claim the manual click itself grants any lasting automatic-PiP permission.
  const maybeShowAutoPipAllowNudge = () => {
    if (pipAutoAllowNudgeShownRef.current) return;
    pipAutoAllowNudgeShownRef.current = true;
    (async () => {
      try {
        const status = await (navigator as any).permissions?.query?.({ name: 'picture-in-picture' as any });
        if (status?.state === 'granted') return;
      } catch {
        // Permission name unsupported in this browser -- still worth showing the nudge,
        // since we can't otherwise tell whether it's already granted.
      }
      setPipHintToast('Tip: click the Picture-in-Picture icon in your browser\'s address bar and choose "Always allow" so PiP can open automatically on future tab switches.');
      setTimeout(() => setPipHintToast(null), 8000);
    })();
  };

  // Toggle PiP — called from button click (guaranteed user gesture). Delegates the actual
  // mechanics to the shared openPip/closePip so the manual and automatic paths run through
  // exactly one lifecycle implementation instead of two divergent copies of similar logic.
  const handleTogglePiP = useCallback(async () => {
    pipUserEnabledRef.current = true;
    setShowPipEnableCTA(false);
    try { localStorage.setItem('toowix_pip_cta_seen', '1'); } catch {}
    const lc = pipLifecycleRef.current;
    if (lc.phase === 'open') {
      await closePip();
    } else if (lc.phase === 'idle') {
      await openPip('manual');
    }
    // If phase is 'opening' or 'closing', another operation already owns the lifecycle for
    // this click -- ignore it rather than fighting that operation (covers rapid double-clicks).
  }, [openPip, closePip]);

  // Keep references to current callbacks so listeners never suffer stale closures
  useEffect(() => {
    triggerAutoPiPRef.current = () => openPip('auto');
    handleTogglePiPRef.current = handleTogglePiP;
  }, [openPip, handleTogglePiP]);

  // Tab switch listener: cleanup and cancellation ONLY. Automatic OPENING is handled solely
  // by the Media Session 'enterpictureinpicture' handler registered below -- see the comment
  // above openPip for why calling the same open routine directly from visibilitychange used
  // to compete with (and could block) that browser-authorized callback.
  useEffect(() => {
    if (!hasJoined) return;

    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.setActionHandler('enterpictureinpicture' as any, () => {
          logPipDiagnostic('trigger', { source: 'media-session' });
          triggerAutoPiPRef.current?.();
        });
      } catch {}
      try {
        navigator.mediaSession.setActionHandler('togglemicrophone' as any, () => {
          toggleInCallMicRef.current();
        });
      } catch {}
      try {
        navigator.mediaSession.setActionHandler('togglecamera' as any, () => {
          toggleInCallVideoRef.current();
        });
      } catch {}
      try {
        navigator.mediaSession.setActionHandler('hangup' as any, () => {
          leaveMeetingRef.current();
        });
      } catch {}
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        logPipDiagnostic('visibility-hidden', {});
        // No auto-open call here -- see the comment above this effect and above openPip.
      } else if (document.visibilityState === 'visible') {
        logPipDiagnostic('visibility-visible', {});
        const lc = pipLifecycleRef.current;
        // Invalidate any in-flight opening so it can't publish itself as active a moment
        // later and pop a window right back open after we've already decided the user
        // wants the main page. Reset phase directly rather than waiting for the stale
        // async attempt to notice -- once superseded, that attempt deliberately leaves
        // lifecycle state alone (see isCurrent() in openPip), so someone has to do it here.
        if (lc.phase === 'opening') {
          pipRequestIdRef.current++;
          lc.phase = 'idle';
          lc.origin = null;
          lc.kind = null;
        }
        // While screen sharing (local or remote) is active, PiP stays open across a return
        // to the tab -- it's the priority view for the shared screen and should stay
        // constant until the user closes it themselves or sharing ends (handled by the
        // dedicated effect above), not vanish the moment they glance back at the tab.
        const screenSharePriority = pipIsScreenSharingRef.current || Boolean(pipRemoteScreenStreamRef.current);
        if (lc.phase === 'open' && lc.origin === 'auto' && !screenSharePriority) {
          closePipRef.current?.();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      if ('mediaSession' in navigator) {
        try {
          navigator.mediaSession.setActionHandler('enterpictureinpicture' as any, null);
          navigator.mediaSession.setActionHandler('togglemicrophone' as any, null);
          navigator.mediaSession.setActionHandler('togglecamera' as any, null);
          navigator.mediaSession.setActionHandler('hangup' as any, null);
        } catch {}
      }
      stopPipDraw();
      if (pipCanvasStreamRef.current) {
        pipCanvasStreamRef.current.getTracks().forEach((t) => t.stop());
        pipCanvasStreamRef.current = null;
      }
      if (documentPipWindowRef.current) {
        try { documentPipWindowRef.current.close(); } catch {}
        documentPipWindowRef.current = null;
        setDocumentPipActive(false);
      }
      if ((document as any).pictureInPictureElement) {
        (document as any).exitPictureInPicture().catch(() => {});
      }
      if (pipVideoRef.current) {
        pipVideoRef.current.srcObject = null;
        pipVideoRef.current.parentNode?.removeChild(pipVideoRef.current);
        pipVideoRef.current = null;
      }
      pipCanvasRef.current = null;
      // Meeting ended/left -- any open or in-flight PiP was already force-closed above (and
      // any still-in-flight openPip()/closePip() promise will see hasJoinedRef.current is
      // now false via isCurrent() and close whatever it produces once it resolves), so the
      // lifecycle unconditionally resets to idle here.
      pipLifecycleRef.current = { phase: 'idle', kind: null, origin: null, requestId: pipLifecycleRef.current.requestId };
    };
  }, [hasJoined]);

  // Show the one-time "Enable Auto Picture-in-Picture" onboarding banner shortly after
  // joining -- gets the required real click out of the way proactively instead of leaving
  // auto-PiP silently broken until the user happens to find and click the PiP button
  // themselves. Skipped entirely if they've already enabled/dismissed it before (any past
  // meeting, this browser), or if this browser has no PiP support at all.
  useEffect(() => {
    if (!hasJoined) return;
    const pipSupported = Boolean((document as any).pictureInPictureEnabled) || 'documentPictureInPicture' in window;
    if (!pipSupported) return;
    if (pipUserEnabledRef.current) return;
    let dismissed = false;
    try { dismissed = localStorage.getItem('toowix_pip_cta_seen') === '1'; } catch {}
    if (dismissed) return;
    const timer = setTimeout(() => setShowPipEnableCTA(true), 4000);
    return () => clearTimeout(timer);
  }, [hasJoined]);

  const handleEnablePipCTA = () => {
    try { localStorage.setItem('toowix_pip_cta_seen', '1'); } catch {}
    setShowPipEnableCTA(false);
    handleTogglePiPRef.current?.();
  };

  const handleDismissPipCTA = () => {
    try { localStorage.setItem('toowix_pip_cta_seen', '1'); } catch {}
    setShowPipEnableCTA(false);
  };

  // Update real-time clock every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!displayName && auth.currentUser) {
      setDisplayName(auth.currentUser.displayName || auth.currentUser.email?.split('@')[0] || '');
    } else if (!displayName) {
      // Restore guest name saved from previous session (for seamless rejoin)
      const savedName = localStorage.getItem('toowix_guest_displayName');
      if (savedName) setDisplayName(savedName);
    }
  }, [displayName]);

  // Real-time media preview hook (cleaned up cleanly on joining)
  const media = useMediaPreview(hasJoined, micEnabled, videoEnabled, audioId, videoId);
  const videoPreviewRef = media.preview;
  const mediaStreamRef = media.stream;
  const cameraPermissionError = !!media.cameraError;
  const micPermissionError = !!media.micError;

  useEffect(() => {
    if (cameraPermissionError) {
      setVideoEnabled(false);
    }
  }, [cameraPermissionError]);

  const currentUserIdRef = useRef<string | null>(null);
  const [meetingInfo, setMeetingInfo] = useState<{
    type: string;
    organizerId: string;
    organizerName: string;
    description: string | null;
    inviteRestricted: boolean;
    accessAllowed: boolean;
    autoRecording: boolean;
    recordingEnabled: boolean;
    cancelled: boolean;
    requireLobbyPolicy: boolean;
    allowScreenShare: boolean;
    micLockEnabled: boolean;
  } | null>(null);

  const meetingInfoRef = useRef(meetingInfo);

  const accountHeaders = useCallback(async (): Promise<Record<string, string>> => {
    if (participation === 'guest') return {};
    await auth.authStateReady();
    if (!auth.currentUser) throw new Error('Sign in before choosing account joining.');
    return {
      Authorization: `Bearer ${await auth.currentUser.getIdToken()}`,
      'X-Toowix-Session': localStorage.getItem('toowix_session_token') || '',
    };
  }, [participation]);

  // Fetch meeting metadata
  useEffect(() => {
    if (window.location.search) window.history.replaceState(window.history.state, '', window.location.pathname);
    let active = true;
    setMeetingInfo(null);
    setAdmissionError('');
    (async () => {
      try {
        const response = await fetch(`${BACKEND_URL}/api/meetings/room/${encodeURIComponent(roomId)}`, {
          headers: await accountHeaders(),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Meeting lookup failed');
        if (active) {
          setMeetingInfo(data.meeting);
          meetingInfoRef.current = data.meeting;
        }
      } catch (error) {
        if (active) setAdmissionError(error instanceof Error ? error.message : 'Meeting lookup failed');
      }
    })();
    return () => {
      active = false;
    };
  }, [roomId, accountHeaders]);

  // Toggle video track
  const handleToggleVideo = () => {
    const next = !videoEnabled;
    setVideoEnabled(next);
    if (mediaStreamRef.current) {
      const track = mediaStreamRef.current.getVideoTracks()[0];
      if (track) track.enabled = next;
    }
  };

  // Toggle mic track
  const handleToggleMic = () => {
    const next = !micEnabled;
    setMicEnabled(next);
    if (mediaStreamRef.current) {
      const track = mediaStreamRef.current.getAudioTracks()[0];
      if (track) track.enabled = next;
    }
  };

  const handleCopyMeetingLink = () => {
    const url = `${window.location.origin}/meet/${encodeURIComponent(roomId)}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  // ---------------------------------------------------------------------------
  // Join Flow: Knocks on lobby or joins directly
  // ---------------------------------------------------------------------------
  const handleJoinMeeting = async (audioOnly: boolean = false) => {
    if (!meetingInfo || meetingInfo.cancelled || joining || leavingRef.current) return;
    try { initPipStream(); } catch {}
    setJoining(true);
    setAdmissionError('');

    if (audioOnly) {
      setVideoEnabled(false);
      if (mediaStreamRef.current) {
        const track = mediaStreamRef.current.getVideoTracks()[0];
        if (track) track.enabled = false;
      }
    }

    try {
      const headers = await accountHeaders();
      const endpoint = meetingInfo?.requireLobbyPolicy
        ? `${BACKEND_URL}/api/meetings/room/${encodeURIComponent(roomId)}/lobby/knock`
        : `${BACKEND_URL}/api/meetings/room/${encodeURIComponent(roomId)}/admission`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          name: displayName.trim() || 'Guest',
          requestId: waitingRequestId || undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Join request failed');

      if ((data.status === 'ADMITTED' || !data.status) && data.jitsiToken) {
        // Admitted directly
        setJwtToken(data.jitsiToken);
        setIsModerator(!!data.isHost || !!data.moderator);
        attendanceTokenRef.current = data.attendanceToken;
        attendanceEntryIdRef.current = data.participantEntryId;
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        setInWaitingRoom(false);
        setHasJoined(true);
      } else if (data.status === 'WAITING') {
        // Placed into waiting lobby
        setWaitingRequestId(data.requestId);
        setHostAnnouncement(data.hostAnnouncement || null);
        setInWaitingRoom(true);
      }
    } catch (error) {
      setAdmissionError(error instanceof Error ? error.message : 'Join failed');
    } finally {
      setJoining(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Waiting Room Polling (when attendee is waiting for admission)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!inWaitingRoom || !waitingRequestId || hasJoined) return;

    let active = true;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(
          `${BACKEND_URL}/api/meetings/room/${encodeURIComponent(roomId)}/lobby/status?requestId=${encodeURIComponent(
            waitingRequestId
          )}`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (!active) return;

        if (data.status === 'ADMITTED' && data.jitsiToken) {
          clearInterval(interval);
          setJwtToken(data.jitsiToken);
          attendanceTokenRef.current = data.attendanceToken;
          attendanceEntryIdRef.current = data.participantEntryId;
          mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
          setInWaitingRoom(false);
          setHasJoined(true);
        } else if (data.status === 'DENIED') {
          clearInterval(interval);
          setWaitingDenied(true);
        } else if (data.status === 'ENDED') {
          clearInterval(interval);
          navigate('/meeting-ended', {
            replace: true,
            state: { roomId, reason: 'This meeting has ended.' },
          });
        }

        if (data.hostAnnouncement !== undefined) {
          setHostAnnouncement(data.hostAnnouncement);
        }
      } catch {}
    }, 2000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [inWaitingRoom, waitingRequestId, hasJoined, roomId, navigate]);

  // Cancel waiting room request
  const handleCancelWaiting = async () => {
    try {
      await fetch(`${BACKEND_URL}/api/meetings/room/${encodeURIComponent(roomId)}/lobby/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: waitingRequestId }),
      });
    } catch {}
    setInWaitingRoom(false);
    navigate('/', { replace: true });
  };

  // ---------------------------------------------------------------------------
  // Moderator Polling (fetch waiting queue when in call)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!hasJoined || !isModerator) return;
    let active = true;

    const pollQueue = async () => {
      try {
        const headers = await accountHeaders();
        const res = await fetch(`${BACKEND_URL}/api/meetings/room/${encodeURIComponent(roomId)}/lobby/pending`, {
          headers,
        });
        if (!res.ok) return;
        const data = await res.json();
        if (active && Array.isArray(data.waiting)) {
          setPendingQueue(data.waiting);
        }
      } catch {}
    };

    pollQueue();
    const interval = setInterval(pollQueue, 3000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [hasJoined, isModerator, roomId, accountHeaders]);

  // Moderator actions: Admit / Deny
  const handleAdmitParticipant = async (id?: string, admitAll: boolean = false) => {
    try {
      const headers = await accountHeaders();
      await fetch(`${BACKEND_URL}/api/meetings/room/${encodeURIComponent(roomId)}/lobby/admit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ requestId: id, admitAll }),
      });
      setPendingQueue((prev) => (admitAll ? [] : prev.filter((p) => p.id !== id)));
    } catch {}
  };

  const handleDenyParticipant = async (id: string) => {
    try {
      const headers = await accountHeaders();
      await fetch(`${BACKEND_URL}/api/meetings/room/${encodeURIComponent(roomId)}/lobby/deny`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ requestId: id }),
      });
      setPendingQueue((prev) => prev.filter((p) => p.id !== id));
    } catch {}
  };

  const handleBroadcastAnnouncement = async () => {
    if (!announcementText.trim()) return;
    try {
      const headers = await accountHeaders();
      await fetch(`${BACKEND_URL}/api/meetings/room/${encodeURIComponent(roomId)}/lobby/announce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ message: announcementText.trim() }),
      });
      setShowAnnounceDialog(false);
      setAnnouncementText('');
    } catch {}
  };

  // Meeting duration timer
  useEffect(() => {
    if (!hasJoined) return;
    const timer = setInterval(() => setMeetingSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [hasJoined]);

  // Recording timer. Timestamp-based (not a naive per-tick increment) so background-tab
  // throttling or missed ticks can't make the displayed duration drift from wall-clock time.
  useEffect(() => {
    if (!recording) {
      recordingStartTimeRef.current = null;
      setRecordingSeconds(0);
      return;
    }
    recordingStartTimeRef.current = Date.now();
    const timer = setInterval(() => {
      if (recordingStartTimeRef.current == null) return;
      setRecordingSeconds(Math.floor((Date.now() - recordingStartTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [recording]);

  const formatDuration = (totalSec: number) => {
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    if (hrs > 0) {
      return `${hrs}:${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }
    return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  // ---------------------------------------------------------------------------
  // Jitsi External API Integration
  // ---------------------------------------------------------------------------
  const jitsiContainerRef = useRef<HTMLDivElement | null>(null);
  const jitsiApiRef = useRef<any>(null);
  const [remoteParticipantCount, setRemoteParticipantCount] = useState(0);

  const recordAttendanceJoin = useCallback(() => {
    if (!attendanceTokenRef.current || leavingRef.current) return;
    fetch(`${BACKEND_URL}/api/meetings/room/${encodeURIComponent(roomId)}/attendance/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attendanceToken: attendanceTokenRef.current }),
    }).catch(() => {});
  }, [roomId]);

  const recordAttendanceLeave = useCallback(() => {
    if (!attendanceEntryIdRef.current || !attendanceTokenRef.current) return;
    const token = attendanceTokenRef.current;
    attendanceEntryIdRef.current = null;
    fetch(`${BACKEND_URL}/api/meetings/room/${encodeURIComponent(roomId)}/attendance/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({ attendanceToken: token }),
    }).catch(() => {});
  }, [roomId]);

  const leaveMeeting = useCallback(
    (reason: string = 'You have left the meeting.') => {
      if (leavingRef.current) return;
      leavingRef.current = true;
      recordAttendanceLeave();
      // Persist guest display name so rejoin works without re-asking
      if (!auth.currentUser && displayName) {
        localStorage.setItem('toowix_guest_displayName', displayName);
      }
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      const api = jitsiApiRef.current;
      jitsiApiRef.current = null;
      try {
        api?.executeCommand('hangup');
      } catch {}
      try {
        api?.dispose();
      } catch {}
      navigate('/meeting-ended', {
        replace: true,
        state: { roomId, reason, wasModerator: isModerator, durationMinutes: Math.round(meetingSeconds / 60), displayName },
      });
    },
    [navigate, recordAttendanceLeave, roomId, isModerator, meetingSeconds, displayName]
  );

  const handleEndMeetingForEveryone = async () => {
    setShowEndMeetingModal(false);
    // HTTP-reliable broadcast (see postRoomSignal) instead of sendEndpointTextMessage
    // directly -- same BridgeChannel-not-ready problem chat had. This is a courtesy for a
    // specific "ended by host" message; the native endConference command below is what
    // actually terminates the conference for everyone regardless of whether this arrives.
    try {
      postRoomSignal('MEETING_ENDED_FOR_EVERYONE', {});
    } catch {}
    try {
      jitsiApiRef.current?.executeCommand('endConference');
    } catch {}
    try {
      const headers = await accountHeaders();
      await fetch(`${BACKEND_URL}/api/meetings/room/${encodeURIComponent(roomId)}/end-for-everyone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
      });
    } catch {}
    leaveMeeting('You ended the meeting for everyone.');
  };

  const jitsiDomain = import.meta.env.VITE_JITSI_DOMAIN || 'meet.toowix.com';

  const loadJitsiScript = useCallback((): Promise<void> => {
    return new Promise((resolve, reject) => {
      if ((window as any).JitsiMeetExternalAPI) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = `https://${jitsiDomain}/external_api.js`;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Jitsi external API script'));
      document.body.appendChild(script);
    });
  }, [jitsiDomain]);

  useEffect(() => {
    if (!hasJoined || !jwtToken) return;
    let disposed = false;
    const listeners: Array<[string, (...args: any[]) => void]> = [];

    loadJitsiScript()
      .then(() => {
        if (disposed || !jitsiContainerRef.current) return;
        const JitsiMeetExternalAPI = (window as any).JitsiMeetExternalAPI;

        const api = new JitsiMeetExternalAPI(jitsiDomain, {
          roomName: roomId,
          parentNode: jitsiContainerRef.current,
          jwt: jwtToken,
          devices: {
            audioInput: media.devices.find((d) => d.deviceId === audioId)?.label,
            videoInput: media.devices.find((d) => d.deviceId === videoId)?.label,
            audioOutput: media.devices.find((d) => d.deviceId === outputId)?.label,
          },
          width: '100%',
          height: '100%',
          userInfo: { displayName: displayName.trim() || 'Participant' },
          configOverwrite: {
            prejoinPageEnabled: false,
            prejoinConfig: { enabled: false, hideDisplayName: true },
            requireDisplayName: false,
            startWithAudioMuted: !micEnabled,
            startWithVideoMuted: !videoEnabled || cameraPermissionError,
            disableDeepLinking: true,
            disableInviteFunctions: true,
            doNotStoreRoom: true,
            hideConferenceSubject: true,
            hideConferenceTimer: true,
            hideRecordingLabel: true,
            hideParticipantsStats: true,
            toolbarButtons: [],
            toolbarConfig: { alwaysVisible: false, initialTimeout: 0 },
            disableScreensharing: false,
            p2p: { enabled: false },
            enableEndConference: false,
          },
          interfaceConfigOverwrite: {
            SHOW_JITSI_WATERMARK: false,
            SHOW_WATERMARK_FOR_GUESTS: false,
            JITSI_WATERMARK_LINK: '',
            SHOW_BRAND_WATERMARK: false,
            BRAND_WATERMARK_LINK: '',
            SHOW_POWERED_BY: false,
            DEFAULT_LOGO_URL: '',
            DEFAULT_WELCOME_PAGE_LOGO_URL: '',
            APP_NAME: 'Toowix Meet',
            NATIVE_APP_NAME: 'Toowix Meet',
            PROVIDER_NAME: 'Toowix',
            MOBILE_APP_PROMO: false,
            HIDE_DEEP_LINKING_LOGO: true,
            DISPLAY_WELCOME_PAGE_CONTENT: false,
            SHOW_CHROME_EXTENSION_BANNER: false,
            TOOLBAR_BUTTONS: [],
            SETTINGS_SECTIONS: [],
          },
        });

        jitsiApiRef.current = api;
        const on = (name: string, listener: (...args: any[]) => void) => {
          api.addListener(name, listener);
          listeners.push([name, listener]);
        };

        on('participantJoined', (data: any) => {
          const pName = (data?.displayName || 'Participant').trim();
          setRemoteParticipants((prev) => {
            // Deduplicate: remove any existing entry with same id OR same name
            const filtered = prev.filter(
              (p) => p.id !== data?.id && p.name.trim().toLowerCase() !== pName.toLowerCase()
            );
            // Never add the local user as a remote participant (prevents ghost self-card on rejoin)
            const localName = (displayName || '').trim().toLowerCase();
            if (localName && pName.toLowerCase() === localName) {
              setRemoteParticipantCount(filtered.length);
              return filtered;
            }
            const next = [...filtered, { id: data?.id || String(Date.now()), name: pName, muted: true, video: false }];
            setRemoteParticipantCount(next.length);
            return next;
          });
        });
        on('participantLeft', (data: any) => {
          setRemoteParticipants((prev) => {
            const next = prev.filter((p) => p.id !== data?.id);
            setRemoteParticipantCount(next.length);
            return next;
          });
        });
        on('videoConferenceLeft', () => leaveMeeting('You left the meeting.'));
        on('readyToClose', () => leaveMeeting('You left the meeting.'));
        on('participantKickedOut', (data: any) => {
          const kickedId = data?.kicked?.id || data?.id;
          const isLocal = data?.kicked?.local || kickedId === localParticipantIdRef.current || kickedId === 'local';
          if (isLocal) {
            leaveMeeting('You were removed from the meeting by a moderator.');
          } else if (kickedId) {
            setRemoteParticipants((prev) => {
              const next = prev.filter((p) => p.id !== kickedId);
              setRemoteParticipantCount(next.length);
              return next;
            });
          }
        });
        on('endpointTextMessageReceived', (event: any) => {
          try {
            const raw = event?.data?.eventData?.text || event?.text || '';
            if (raw.includes('MEETING_ENDED_FOR_EVERYONE')) {
              leaveMeeting('The host has ended the meeting for everyone.');
              return;
            }
            if (raw.startsWith('{') && handleIncomingSignalRef.current) {
              const sig = JSON.parse(raw);
              handleIncomingSignalRef.current(sig);
            }
          } catch {}
        });
        on('audioMuteStatusChanged', ({ muted }: any) => setInCallMuted(muted));
        on('recordingStatusChanged', ({ on: enabled }: any) => {
          setRecording(!!enabled);
          if (enabled) {
            setRecordingToast('Recording: on');
          } else {
            setRecordingToast(null);
          }
        });
        on('screenSharingStatusChanged', ({ on: enabled }: any) => setIsScreenSharing(!!enabled));
        on('raiseHandUpdated', (data: any) => {
          if (data && data.id) {
            setRemoteParticipants((prev) =>
              prev.map((p) => (p.id === data.id ? { ...p, raisedHand: !!data.handRaised } : p))
            );
          }
        });
        // Remote participants are inserted with muted: true as a placeholder (see
        // participantJoined above); without this, that placeholder is never corrected and every
        // remote tile shows the mic-off badge permanently regardless of their real audio state.
        on('participantMuted', ({ id, isMuted, mediaType }: any) => {
          if (id && mediaType === 'audio') {
            setRemoteParticipants((prev) =>
              prev.map((p) => (p.id === id ? { ...p, muted: !!isMuted } : p))
            );
          }
        });

        on('videoConferenceJoined', (data: any) => {
          localParticipantIdRef.current = data?.id || 'local';
          recordAttendanceJoin();
        });
      })
      .catch(() => setCallError('Conference could not load. Exit and try joining again.'));

    return () => {
      disposed = true;
      recordAttendanceLeave();
      if (jitsiApiRef.current) {
        listeners.forEach(([name, listener]) => jitsiApiRef.current.removeListener(name, listener));
        jitsiApiRef.current.dispose();
        jitsiApiRef.current = null;
      }
    };
  }, [hasJoined]);

  // Periodic check if meeting was ended for everyone by host (fast 1-second interval)
  useEffect(() => {
    if (!hasJoined) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/meetings/room/${encodeURIComponent(roomId)}/live-status`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.ended || data.cancelled) {
          leaveMeeting('The host has ended the meeting for everyone.');
        }
      } catch {}
    }, 1000);
    return () => clearInterval(interval);
  }, [hasJoined, roomId, leaveMeeting]);

  const formattedRoomTitle = roomId.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  // ===========================================================================
  // STAGE 2: IN-MEETING VIEW (Google Meet Fullscreen Canvas)
  // ===========================================================================
  // Synchronize media when meeting is joined
  useEffect(() => {
    if (hasJoined) {
      setInCallVideo(videoEnabled);
      setInCallMuted(!micEnabled);
    }
  }, [hasJoined]);

  // In-call camera stream acquisition (independent of preview cleanup)
  useEffect(() => {
    if (!hasJoined) {
      if (inCallStreamRef.current) {
        inCallStreamRef.current.getTracks().forEach((t) => t.stop());
        inCallStreamRef.current = null;
        setInCallStream(null);
      }
      return;
    }

    if (!inCallVideo || cameraPermissionError) {
      if (inCallStreamRef.current) {
        inCallStreamRef.current.getTracks().forEach((t) => t.stop());
        inCallStreamRef.current = null;
        setInCallStream(null);
      }
      if (inCallVideoRef.current) {
        inCallVideoRef.current.srcObject = null;
      }
      return;
    }

    let active = true;
    const acquireInCallVideo = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: videoId ? { deviceId: { exact: videoId } } : true,
          audio: false,
        });
        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (inCallStreamRef.current) {
          inCallStreamRef.current.getTracks().forEach((t) => t.stop());
        }
        inCallStreamRef.current = stream;
        setInCallStream(stream);
        if (inCallVideoRef.current) {
          inCallVideoRef.current.srcObject = stream;
          inCallVideoRef.current.play().catch(() => {});
        }
        initPipStreamRef.current();
      } catch (err) {
        console.warn('In-call camera stream error:', err);
      }
    };

    acquireInCallVideo();

    return () => {
      active = false;
    };
    // initPipStream intentionally omitted: called via initPipStreamRef so PiP re-inits
    // (e.g. from screen-share toggles) never re-trigger camera reacquisition (item 3).
  }, [hasJoined, inCallVideo, videoId, cameraPermissionError]);

  // Synchronize screen share video stream to presentation video element
  useEffect(() => {
    if (presentationVideoRef.current) {
      if (isScreenSharing && screenStreamRef.current) {
        presentationVideoRef.current.srcObject = screenStreamRef.current;
        presentationVideoRef.current.play().catch(() => {});
      } else {
        presentationVideoRef.current.srcObject = null;
      }
    }
  }, [isScreenSharing]);

  // Synchronize remote presentation stream to remote presentation video element
  useEffect(() => {
    if (remotePresentationVideoRef.current) {
      remotePresentationVideoRef.current.srcObject = remoteScreenStream;
      if (remoteScreenStream) {
        remotePresentationVideoRef.current.play().catch(() => {});
      }
    }
  }, [remoteScreenStream]);

  const handleToggleInCallMic = () => {
    const nextMuted = inCallMuted === null ? false : !inCallMuted;
    setInCallMuted(nextMuted);
    try {
      jitsiApiRef.current?.executeCommand('toggleAudio');
    } catch {}
  };

  const handleToggleInCallVideo = () => {
    const nextVideo = !inCallVideo;
    setInCallVideo(nextVideo);
    try {
      jitsiApiRef.current?.executeCommand('toggleVideo');
    } catch {}
  };

  useEffect(() => {
    toggleInCallMicRef.current = handleToggleInCallMic;
    toggleInCallVideoRef.current = handleToggleInCallVideo;
    leaveMeetingRef.current = leaveMeeting;
  });

  useEffect(() => {
    if ('mediaSession' in navigator && 'setMicrophoneActive' in navigator.mediaSession) {
      try {
        (navigator.mediaSession as any).setMicrophoneActive(!inCallMuted);
      } catch {}
    }
  }, [inCallMuted]);

  useEffect(() => {
    if ('mediaSession' in navigator && 'setCameraActive' in navigator.mediaSession) {
      try {
        (navigator.mediaSession as any).setCameraActive(inCallVideo);
      } catch {}
    }
  }, [inCallVideo]);

  // Recording state is NOT set optimistically here. `recording` and `recordingToast` are
  // driven solely by the real `recordingStatusChanged` External API event (see the `on(...)`
  // handler above), which reflects actual Jibri on/off status. This only requests the
  // start/stop and shows a transient "requesting" message distinct from that real confirmation.
  const handleToggleRecording = () => {
    if (recording) {
      setRecordingToast('Stopping recording…');
      setTimeout(() => setRecordingToast((t) => (t === 'Stopping recording…' ? null : t)), 3500);
      try {
        jitsiApiRef.current?.executeCommand('stopRecording', 'file');
      } catch {}
    } else {
      setRecordingToast('Requesting recording…');
      setTimeout(() => setRecordingToast((t) => (t === 'Requesting recording…' ? null : t)), 3500);
      try {
        jitsiApiRef.current?.executeCommand('startRecording', { mode: 'file' });
      } catch {}
    }
  };

  const handleSendReaction = (emoji: string) => {
    const id = Date.now() + Math.random();
    setFloatingEmojis((prev) => [...prev, { id, emoji, left: 45 + (Math.random() * 10 - 5) }]);
    setTimeout(() => {
      setFloatingEmojis((prev) => prev.filter((e) => e.id !== id));
    }, 2400);
    setShowReactions(false);
    try {
      jitsiApiRef.current?.executeCommand('sendReaction', emoji);
    } catch {}
  };

  const handleSendChatMessage = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!chatInput.trim()) return;
    const text = chatInput.trim();
    const msg = {
      id: String(Date.now()),
      sender: displayName || 'You',
      time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
      text,
    };
    setChatMessages((prev) => [...prev, msg]);
    setChatInput('');
    // Routed through postRoomSignal (HTTP to our backend + Jitsi datachannel as a latency
    // accelerant) instead of only sendEndpointTextMessage directly -- that datachannel relies
    // on Jitsi's BridgeChannel, which can be unready or unavailable, and had no fallback, so
    // messages could silently never reach other participants. HTTP always works.
    postRoomSignal('CHAT_MESSAGE', { text });
  };

  const postRoomSignal = useCallback(
    async (type: string, payload: any, targetSessionId?: string) => {
      const msgId = `${sessionIdRef.current}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      addProcessedSignalId(msgId);
      const signalData = {
        msgId,
        sender: displayName || 'Participant',
        senderSessionId: sessionIdRef.current,
        targetSessionId: targetSessionId || null,
        type,
        payload,
      };

      // HTTP to our own backend is the sole, reliable transport -- this used to ALSO send
      // via Jitsi's sendEndpointTextMessage (BridgeChannel datachannel) as a latency
      // accelerant, but that channel isn't always initialized by the time signaling starts
      // (or may never be, depending on JVB connectivity), and lib-jitsi-meet logs a
      // "BridgeChannel has not been initialized yet" error internally every time it's
      // attempted while unready -- that error isn't catchable from here (it's logged deep
      // inside the library, not thrown back to this call), so it can't be silenced short of
      // not calling it. HTTP already delivers every signal type reliably (confirmed via
      // server logs), so the datachannel attempt was pure redundant risk for no real benefit.
      try {
        await fetch(`${BACKEND_URL}/api/meetings/room/${encodeURIComponent(roomId)}/signal`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(signalData),
        });
      } catch {}
    },
    [roomId, displayName]
  );

  const handleToggleRaiseHand = () => {
    const nextRaised = !isHandRaised;
    setIsHandRaised(nextRaised);
    setHandRaisedToast(nextRaised ? 'You raised your hand' : 'You lowered your hand');
    setTimeout(() => setHandRaisedToast(null), 3000);
    postRoomSignal('HAND_TOGGLED', { raised: nextRaised, name: displayName || 'Participant' });
    try {
      jitsiApiRef.current?.executeCommand('toggleRaiseHand');
    } catch {}
  };

  const handleToggleScreenShare = async () => {
    if (isScreenSharing) {
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop());
        screenStreamRef.current = null;
        setScreenStream(null);
      }
      setIsScreenSharing(false);
      presenterPeerConnectionsRef.current.forEach((pc) => pc.close());
      presenterPeerConnectionsRef.current.clear();
      presenterIceQueuesRef.current.clear();
      postRoomSignal('SCREEN_SHARE_STOPPED', { presenterSessionId: sessionIdRef.current });
    } else {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: 30 },
          audio: false,
        });
        screenStreamRef.current = stream;
        setScreenStream(stream);
        setIsScreenSharing(true);

        // Notify room that presenter started sharing
        postRoomSignal('SCREEN_SHARE_STARTED', {
          presenter: displayName || 'Participant',
          presenterSessionId: sessionIdRef.current,
        });

        stream.getVideoTracks()[0].onended = () => {
          setIsScreenSharing(false);
          if (screenStreamRef.current) {
            screenStreamRef.current.getTracks().forEach((t) => t.stop());
            screenStreamRef.current = null;
            setScreenStream(null);
          }
          presenterPeerConnectionsRef.current.forEach((pc) => pc.close());
          presenterPeerConnectionsRef.current.clear();
          presenterIceQueuesRef.current.clear();
          postRoomSignal('SCREEN_SHARE_STOPPED', { presenterSessionId: sessionIdRef.current });
        };
      } catch (err: any) {
        console.warn('Screen share cancelled or not allowed:', err);
      }
    }
  };

  // Real-time WebRTC Signaling Listener for incoming presentation & peer stream
  useEffect(() => {
    if (!hasJoined) return;

    const handleIncomingSignal = async (sig: any) => {
      if (!sig || !sig.type) return;
      const { type, sender, senderSessionId, targetSessionId, payload, msgId } = sig;

      // Ignore signals originated by this client
      if (senderSessionId === sessionIdRef.current) return;
      // If signal is targeted to a specific viewer/client, verify match
      if (targetSessionId && targetSessionId !== sessionIdRef.current) return;
      // Deduplicate signal across HTTP polling and Jitsi datachannels
      if (msgId && processedSignalIdsRef.current.has(msgId)) return;
      if (msgId) addProcessedSignalId(msgId);

      if (type === 'MEETING_ENDED_FOR_EVERYONE') {
        leaveMeeting('The host has ended the meeting for everyone.');
      } else if (type === 'SCREEN_SHARE_STARTED') {
        setRemotePresenterName(payload?.presenter || sender);
        // Viewer sends join request to presenter for per-peer connection
        postRoomSignal('WEBRTC_JOIN_PRESENTATION', {}, payload?.presenterSessionId || senderSessionId);
      } else if (type === 'SCREEN_SHARE_STOPPED') {
        setRemoteScreenStream(null);
        setRemotePresenterName(null);
        if (viewerPeerConnectionRef.current) {
          viewerPeerConnectionRef.current.close();
          viewerPeerConnectionRef.current = null;
        }
        iceCandidateQueueRef.current = [];
      } else if (type === 'WEBRTC_JOIN_PRESENTATION') {
        // We are the presenter: a viewer wants to receive our stream
        if (!screenStreamRef.current) return;
        try {
          const pc = new RTCPeerConnection({
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' },
            ],
          });
          presenterPeerConnectionsRef.current.set(senderSessionId, pc);
          screenStreamRef.current.getTracks().forEach((track) => {
            pc.addTrack(track, screenStreamRef.current!);
          });

          pc.onicecandidate = (event) => {
            if (event.candidate) {
              postRoomSignal('WEBRTC_ICE', { candidate: event.candidate }, senderSessionId);
            }
          };

          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          postRoomSignal('WEBRTC_OFFER', { sdp: offer }, senderSessionId);
        } catch (e) {
          console.warn('Presenter peer connection error:', e);
        }
      } else if (type === 'WEBRTC_OFFER') {
        // Viewer receives offer from presenter
        if (isScreenSharing) return;
        setRemotePresenterName(sender);

        try {
          if (viewerPeerConnectionRef.current) {
            viewerPeerConnectionRef.current.close();
          }
          const pc = new RTCPeerConnection({
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' },
            ],
          });
          viewerPeerConnectionRef.current = pc;

          pc.ontrack = (event) => {
            if (event.streams && event.streams[0]) {
              setRemoteScreenStream(event.streams[0]);
            }
          };

          pc.onicecandidate = (event) => {
            if (event.candidate) {
              postRoomSignal('WEBRTC_ICE', { candidate: event.candidate }, senderSessionId);
            }
          };

          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));

          // Flush any buffered candidates
          for (const cand of iceCandidateQueueRef.current) {
            await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
          }
          iceCandidateQueueRef.current = [];

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          postRoomSignal('WEBRTC_ANSWER', { sdp: answer }, senderSessionId);
        } catch (e) {
          console.warn('Viewer peer connection error:', e);
        }
      } else if (type === 'WEBRTC_ANSWER') {
        // Presenter receives answer from viewer
        const pc = presenterPeerConnectionsRef.current.get(senderSessionId);
        if (pc && payload?.sdp) {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
            const queue = presenterIceQueuesRef.current.get(senderSessionId) || [];
            for (const cand of queue) {
              await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
            }
            presenterIceQueuesRef.current.delete(senderSessionId);
          } catch (e) {
            console.warn('Set remote desc error on presenter:', e);
          }
        }
      } else if (type === 'WEBRTC_ICE') {
        if (payload?.candidate) {
          if (presenterPeerConnectionsRef.current.has(senderSessionId)) {
            const pc = presenterPeerConnectionsRef.current.get(senderSessionId)!;
            if (pc.remoteDescription) {
              await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(() => {});
            } else {
              if (!presenterIceQueuesRef.current.has(senderSessionId)) {
                presenterIceQueuesRef.current.set(senderSessionId, []);
              }
              presenterIceQueuesRef.current.get(senderSessionId)!.push(payload.candidate);
            }
          } else if (viewerPeerConnectionRef.current) {
            const pc = viewerPeerConnectionRef.current;
            if (pc.remoteDescription) {
              await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(() => {});
            } else {
              iceCandidateQueueRef.current.push(payload.candidate);
            }
          }
        }
      } else if (type === 'HAND_TOGGLED') {
        const isRaised = Boolean(payload?.raised);
        const personName = payload?.name || sender || 'Participant';
        setRemoteParticipants((prev) => {
          const exists = prev.some((p) => p.name === personName || p.id === senderSessionId);
          if (exists) {
            return prev.map((p) => (p.name === personName || p.id === senderSessionId ? { ...p, raisedHand: isRaised } : p));
          } else {
            return [...prev, { id: senderSessionId, name: personName, muted: true, video: false, raisedHand: isRaised }];
          }
        });
        if (isRaised) {
          setHandRaisedToast(`${personName} raised their hand`);
          setTimeout(() => setHandRaisedToast(null), 4000);
        }
      } else if (type === 'CHAT_MESSAGE') {
        // HTTP-delivered fallback for chat -- sendEndpointTextMessage (Jitsi's BridgeChannel
        // datachannel) has no delivery guarantee if the channel isn't initialized yet, and
        // was the only transport chat had, so messages could silently never reach other
        // participants. This path always works, since it rides the same signal endpoint
        // screen-share already relies on. msgId dedup above prevents a double-add on the
        // rare chance both this and a working datachannel send arrive.
        const text = typeof payload?.text === 'string' ? payload.text : '';
        if (!text) return;
        setChatMessages((prev) => [
          ...prev,
          {
            id: msgId || String(Date.now()),
            sender: sender || 'Participant',
            time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
            text,
          },
        ]);
      }
    };

    handleIncomingSignalRef.current = handleIncomingSignal;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(
          `${BACKEND_URL}/api/meetings/room/${encodeURIComponent(roomId)}/signal?since=${lastSignalTimestampRef.current}`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (data.timestamp) {
          lastSignalTimestampRef.current = data.timestamp;
        }
        if (Array.isArray(data.signals)) {
          for (const sig of data.signals) {
            handleIncomingSignal(sig);
          }
        }
      } catch {}
    }, 600);

    return () => {
      clearInterval(interval);
      handleIncomingSignalRef.current = null;
    };
  }, [hasJoined, roomId, isScreenSharing, postRoomSignal]);

  const handleSelectAudioDevice = (devId: string) => {
    setAudioId(devId);
    setShowAudioMenu(false);
  };

  const handleSelectVideoDevice = (devId: string) => {
    setVideoId(devId);
    setShowVideoMenu(false);
  };

  // ===========================================================================
  // STAGE 2: IN-MEETING VIEW (Google Meet Visual Truth Matching Image 1)
  // ===========================================================================
  if (hasJoined) {
    const participantInitial = (displayName.trim() || 'Guest').charAt(0).toUpperCase();
    const isSpeaking = media.level > 0.05 && !inCallMuted;
    const localTheme = getParticipantColorTheme(displayName || 'You', 0);

    return (
      <div
        style={{
          height: '100vh',
          width: '100vw',
          backgroundColor: '#121212',
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: "'Google Sans', Roboto, -apple-system, BlinkMacSystemFont, sans-serif",
          userSelect: 'none',
        }}
        onClick={() => {
          if (showAudioMenu) setShowAudioMenu(false);
          if (showVideoMenu) setShowVideoMenu(false);
          if (showReactions) setShowReactions(false);
          if (showMoreMenu) setShowMoreMenu(false);
        }}
      >
        <style>{`
          @keyframes floatUp {
            0% { transform: translateY(0) scale(0.8); opacity: 1; }
            100% { transform: translateY(-240px) scale(1.4); opacity: 0; }
          }
          @keyframes slideInRight {
            from { transform: translateX(30px); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
          }
          @keyframes fadeIn {
            from { opacity: 0; transform: translateX(-50%) translateY(8px); }
            to { opacity: 1; transform: translateX(-50%) translateY(0); }
          }
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
          }
        `}</style>

        {/* Active Recording Toast Notification */}
        {recordingToast && (
          <div
            style={{
              position: 'fixed',
              top: '56px',
              left: '50%',
              transform: 'translateX(-50%)',
              backgroundColor: '#202124',
              border: recording ? '1px solid #EA4335' : '1px solid #34A853',
              borderRadius: '24px',
              padding: '8px 18px',
              color: '#FFFFFF',
              fontSize: '13px',
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.6)',
              zIndex: 400,
              pointerEvents: 'none',
              animation: 'slideInRight 0.2s ease',
            }}
          >
            {recording ? (
              <div
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: '#EA4335',
                  animation: 'pulse 1.2s infinite',
                }}
              />
            ) : (
              <Check size={16} color="#34A853" />
            )}
            <span>{recordingToast}</span>
          </div>
        )}

        {/* 1. SLIM TOP INFORMATION AREA (Left: Logo + Time + Room Code + Info / Right: Participant Pill) */}
        <div
          style={{
            height: '48px',
            padding: '10px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            zIndex: 10,
            boxSizing: 'border-box',
          }}
        >
          {/* Top-Left: Toowix Logo, Time, Divider, Meeting Code, Info Action */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <img
              src="/assets/toowix-logo.png"
              alt="Toowix"
              style={{ height: '22px', width: 'auto', display: 'block' }}
            />
            <span style={{ fontSize: '14px', fontWeight: 500, color: '#E8EAED', letterSpacing: '0.2px' }}>
              {currentTime}
            </span>

            {/* Subtle Vertical Divider */}
            <span style={{ color: '#3C4043', fontSize: '14px' }}>|</span>

            {/* Meeting Code */}
            <span
              style={{
                fontSize: '14px',
                fontWeight: 500,
                color: '#9AA0A6',
                fontFamily: 'monospace',
                letterSpacing: '0.5px',
              }}
            >
              {roomId}
            </span>

            {/* Quick Info Modal Toggle Icon */}
            <button
              onClick={() => setActivePanel(activePanel === 'info' ? null : 'info')}
              title="Meeting details"
              style={{
                background: 'transparent',
                border: 'none',
                color: activePanel === 'info' ? '#8AB4F8' : '#9AA0A6',
                cursor: 'pointer',
                padding: '4px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Info size={16} />
            </button>

            {/* Active Recording Pill Badge (Strictly decoupled from clock time) */}
            {recording && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  backgroundColor: 'rgba(234, 67, 53, 0.15)',
                  border: '1px solid rgba(234, 67, 53, 0.4)',
                  padding: '3px 8px',
                  borderRadius: '12px',
                }}
              >
                <div
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor: '#EA4335',
                    animation: 'pulse 1.5s infinite',
                  }}
                />
                <span style={{ fontSize: '11px', fontWeight: 600, color: '#EA4335', letterSpacing: '0.4px' }}>
                  REC {formatDuration(recordingSeconds)} • Recording: on
                </span>
              </div>
            )}
          </div>

          {/* Top-Right: Participant Indicator Pill with Pin */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setActivePanel(activePanel === 'people' ? null : 'people');
              }}
              title={`People (${1 + remoteParticipantCount})`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                backgroundColor: activePanel === 'people' ? '#3C4043' : '#202124',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '20px',
                padding: '4px 10px 4px 4px',
                cursor: 'pointer',
                transition: 'background 0.15s ease',
              }}
            >
              <div
                style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  backgroundColor: localTheme.avatarBg,
                  color: '#FFFFFF',
                  fontSize: '12px',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {participantInitial}
              </div>
              <span style={{ fontSize: '13px', fontWeight: 500, color: '#E8EAED' }}>
                {1 + remoteParticipantCount}
              </span>
              <Pin size={14} color="#9AA0A6" />
            </button>
          </div>
        </div>

        {/* 2. MAIN PARTICIPANT STAGE CONTAINER (Clear margins, 24px radius, 16:9 ratio, responsive) */}
        <div
          style={{
            flex: 1,
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            padding: '4px 16px 88px',
            boxSizing: 'border-box',
            overflow: 'hidden',
          }}
        >
          {/* Main Participant Stage: Presentation Mode (Local OR Remote Presenter) OR Single Card OR Multi-Participant Grid */}
          {isScreenSharing || remoteScreenStream ? (
            /* Presentation Mode: Main Stage Screen Share + Filmstrip of Attendees (Google Meet style) */
            <div
              style={{
                width: '100%',
                maxWidth: activePanel ? 'calc(100% - 380px)' : '100%',
                height: '100%',
                maxHeight: 'calc(100vh - 170px)',
                display: 'flex',
                gap: '16px',
                alignItems: 'stretch',
                justifyContent: 'center',
                transition: 'max-width 0.25s ease',
              }}
            >
              {/* Primary Presentation Stage (Screen Share): Captures large screen space on the LEFT */}
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  height: '100%',
                  borderRadius: '24px',
                  overflow: 'hidden',
                  position: 'relative',
                  backgroundColor: '#000000',
                  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {isScreenSharing ? (
                  <video
                    ref={presentationVideoRef}
                    autoPlay
                    playsInline
                    muted
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  />
                ) : (
                  <video
                    ref={remotePresentationVideoRef}
                    autoPlay
                    playsInline
                    muted
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  />
                )}

                {/* Floating Top Banner: Presentation Status */}
                <div
                  style={{
                    position: 'absolute',
                    top: '16px',
                    left: '16px',
                    backgroundColor: 'rgba(32, 33, 36, 0.88)',
                    backdropFilter: 'blur(8px)',
                    padding: '8px 16px',
                    borderRadius: '16px',
                    color: '#FFFFFF',
                    fontSize: '13px',
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <ScreenShare size={16} color="#8AB4F8" />
                    <span>
                      {isScreenSharing
                        ? 'You are presenting your screen'
                        : `${remotePresenterName || 'Participant'} is presenting their screen`}
                    </span>
                  </div>
                  {isScreenSharing && (
                    <button
                      onClick={handleToggleScreenShare}
                      style={{
                        backgroundColor: '#EA4335',
                        color: '#FFFFFF',
                        border: 'none',
                        borderRadius: '8px',
                        padding: '4px 12px',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'background-color 0.15s ease',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#D93025')}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#EA4335')}
                    >
                      Stop presenting
                    </button>
                  )}
                </div>
              </div>

              {/* Side People Box: ALWAYS placed on the RIGHT (Google Meet Layout) */}
              <div
                style={{
                  width: '240px',
                  minWidth: '240px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  overflowY: 'auto',
                  maxHeight: '100%',
                  paddingRight: '2px',
                }}
              >
                {/* Local user card */}
                <div
                  style={{
                    width: '100%',
                    aspectRatio: '16 / 9',
                    borderRadius: '16px',
                    overflow: 'hidden',
                    position: 'relative',
                    backgroundColor: localTheme.tileBg,
                    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {inCallVideo ? (
                    <video
                      ref={inCallVideoRef}
                      autoPlay
                      playsInline
                      muted
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <div
                      style={{
                        width: '44px',
                        height: '44px',
                        borderRadius: '50%',
                        backgroundColor: localTheme.avatarBg,
                        color: '#FFFFFF',
                        fontSize: '20px',
                        fontWeight: 500,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {participantInitial}
                    </div>
                  )}
                  {/* Name tag */}
                  <div
                    style={{
                      position: 'absolute',
                      bottom: '8px',
                      left: '8px',
                      fontSize: '11px',
                      color: '#FFFFFF',
                      fontWeight: 500,
                      backgroundColor: 'rgba(0,0,0,0.5)',
                      padding: '2px 6px',
                      borderRadius: '4px',
                    }}
                  >
                    {displayName || 'You'} (You)
                  </div>
                  {/* Hand raised indicator */}
                  {isHandRaised && (
                    <div
                      title="You raised your hand"
                      style={{
                        position: 'absolute',
                        top: '8px',
                        left: '8px',
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        backgroundColor: '#1A73E8',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                      }}
                    >
                      <Hand size={14} color="#FFFFFF" />
                    </div>
                  )}
                  {/* Mute indicator */}
                  {inCallMuted && (
                    <div
                      style={{
                        position: 'absolute',
                        top: '8px',
                        right: '8px',
                        width: '22px',
                        height: '22px',
                        borderRadius: '50%',
                        backgroundColor: 'rgba(0,0,0,0.6)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <MicOff size={13} color="#F87171" />
                    </div>
                  )}
                </div>

                {/* Remote participant cards */}
                {remoteParticipants.map((remote, idx) => {
                  const rTheme = getParticipantColorTheme(remote.name, idx + 1);
                  const rInitial = (remote.name.trim() || 'P').charAt(0).toUpperCase();
                  return (
                    <div
                      key={remote.id || idx}
                      style={{
                        width: '100%',
                        aspectRatio: '16 / 9',
                        borderRadius: '16px',
                        overflow: 'hidden',
                        position: 'relative',
                        backgroundColor: rTheme.tileBg,
                        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <div
                        style={{
                          width: '44px',
                          height: '44px',
                          borderRadius: '50%',
                          backgroundColor: rTheme.avatarBg,
                          color: '#FFFFFF',
                          fontSize: '20px',
                          fontWeight: 500,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {rInitial}
                      </div>
                      <div
                        style={{
                          position: 'absolute',
                          bottom: '8px',
                          left: '8px',
                          fontSize: '11px',
                          color: '#FFFFFF',
                          fontWeight: 500,
                          backgroundColor: 'rgba(0,0,0,0.5)',
                          padding: '2px 6px',
                          borderRadius: '4px',
                        }}
                      >
                        {remote.name}
                      </div>
                      {/* Remote Hand raised indicator */}
                      {remote.raisedHand && (
                        <div
                          title={`${remote.name} raised hand`}
                          style={{
                            position: 'absolute',
                            top: '8px',
                            left: '8px',
                            width: '24px',
                            height: '24px',
                            borderRadius: '50%',
                            backgroundColor: '#1A73E8',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                          }}
                        >
                          <Hand size={14} color="#FFFFFF" />
                        </div>
                      )}
                      {/* Remote Mute indicator */}
                      {remote.muted && (
                        <div
                          style={{
                            position: 'absolute',
                            top: '8px',
                            right: '8px',
                            width: '22px',
                            height: '22px',
                            borderRadius: '50%',
                            backgroundColor: 'rgba(0,0,0,0.6)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <MicOff size={13} color="#F87171" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : remoteParticipants.length === 0 ? (
            /* Single Participant Stage Card (24px radius, 16:9 ratio, matched to avatar icon color) */
            <div
              style={{
                flex: 1,
                maxWidth: activePanel ? 'calc(100% - 380px)' : '1368px',
                height: '100%',
                maxHeight: 'calc(100vh - 170px)',
                aspectRatio: '16 / 9',
                borderRadius: '24px',
                overflow: 'hidden',
                position: 'relative',
                backgroundColor: localTheme.tileBg,
                boxShadow: isSpeaking
                  ? `0 0 0 3px ${localTheme.ringColor}, 0 8px 32px rgba(0, 0, 0, 0.6)`
                  : '0 8px 32px rgba(0, 0, 0, 0.4)',
                transition: 'max-width 0.25s ease, box-shadow 0.2s ease, background-color 0.25s ease',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {/* Camera-ON State */}
              {inCallVideo ? (
                <video
                  ref={inCallVideoRef}
                  autoPlay
                  playsInline
                  muted
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    borderRadius: '24px',
                  }}
                />
              ) : (
                /* Camera-OFF State: Background matched to Avatar Icon Color */
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    backgroundColor: localTheme.tileBg,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                  }}
                >
                  <div
                    style={{
                      width: '96px',
                      height: '96px',
                      borderRadius: '50%',
                      backgroundColor: localTheme.avatarBg,
                      color: '#FFFFFF',
                      fontSize: '44px',
                      fontWeight: 500,
                      fontFamily: "'Google Sans', Roboto, -apple-system, sans-serif",
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
                    }}
                  >
                    {participantInitial}
                  </div>
                </div>
              )}

              {/* Bottom-Left Participant Name (~16px padding) */}
              <div
                style={{
                  position: 'absolute',
                  bottom: '16px',
                  left: '16px',
                  color: '#FFFFFF',
                  fontSize: '14px',
                  fontWeight: 500,
                  fontFamily: "'Google Sans', Roboto, -apple-system, sans-serif",
                  textShadow: '0 1px 3px rgba(0, 0, 0, 0.8)',
                  backgroundColor: inCallVideo ? 'rgba(32, 33, 36, 0.75)' : 'transparent',
                  backdropFilter: inCallVideo ? 'blur(6px)' : 'none',
                  padding: inCallVideo ? '4px 10px' : '0',
                  borderRadius: '8px',
                }}
              >
                {displayName || 'You'}
              </div>

              {/* Top-Right Muted-Microphone Indicator */}
              {inCallMuted && (
                <div
                  style={{
                    position: 'absolute',
                    top: '16px',
                    right: '16px',
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    backgroundColor: localTheme.badgeBg,
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <MicOff size={16} color="#F87171" />
                </div>
              )}

              {/* Raised Hand Indicator Badge */}
              {isHandRaised && (
                <div
                  style={{
                    position: 'absolute',
                    top: '16px',
                    left: '16px',
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    backgroundColor: '#8AB4F8',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                  }}
                >
                  <Hand size={18} color="#202124" />
                </div>
              )}

            </div>
          ) : (
            /* Multi-Participant Responsive Grid: Every participant has card background matching their avatar icon color */
            <div
              style={{
                width: '100%',
                flex: 1,
                maxWidth: activePanel ? 'calc(100% - 380px)' : '100%',
                height: '100%',
                maxHeight: 'calc(100vh - 170px)',
                display: 'grid',
                gridTemplateColumns:
                  remoteParticipants.length === 1
                    ? 'repeat(2, 1fr)'
                    : remoteParticipants.length <= 3
                    ? 'repeat(2, 1fr)'
                    : 'repeat(3, 1fr)',
                gridTemplateRows:
                  remoteParticipants.length === 1
                    ? '1fr'
                    : remoteParticipants.length <= 3
                    ? 'repeat(2, 1fr)'
                    : 'repeat(2, 1fr)',
                gap: '16px',
                alignItems: 'stretch',
                justifyItems: 'stretch',
                transition: 'max-width 0.25s ease',
              }}
            >
              {/* 1. Local Participant Card */}
              <div
                key="local-participant"
                style={{
                  width: '100%',
                  height: '100%',
                  minHeight: 0,
                  borderRadius: '24px',
                  overflow: 'hidden',
                  position: 'relative',
                  backgroundColor: localTheme.tileBg,
                  boxShadow: isSpeaking
                    ? `0 0 0 3px ${localTheme.ringColor}, 0 8px 32px rgba(0, 0, 0, 0.6)`
                    : '0 8px 32px rgba(0, 0, 0, 0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {inCallVideo ? (
                  <video
                    ref={inCallVideoRef}
                    autoPlay
                    playsInline
                    muted
                    style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '24px' }}
                  />
                ) : (
                  <div
                    style={{
                      width: '100%',
                      height: '100%',
                      backgroundColor: localTheme.tileBg,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <div
                      style={{
                        width: remoteParticipants.length <= 1 ? '96px' : '72px',
                        height: remoteParticipants.length <= 1 ? '96px' : '72px',
                        borderRadius: '50%',
                        backgroundColor: localTheme.avatarBg,
                        color: '#FFFFFF',
                        fontSize: remoteParticipants.length <= 1 ? '44px' : '32px',
                        fontWeight: 500,
                        fontFamily: "'Google Sans', Roboto, -apple-system, sans-serif",
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
                      }}
                    >
                      {participantInitial}
                    </div>
                  </div>
                )}
                <div
                  style={{
                    position: 'absolute',
                    bottom: '16px',
                    left: '16px',
                    color: '#FFFFFF',
                    fontSize: '14px',
                    fontWeight: 500,
                    fontFamily: "'Google Sans', Roboto, -apple-system, sans-serif",
                    textShadow: '0 1px 3px rgba(0, 0, 0, 0.8)',
                    backgroundColor: inCallVideo ? 'rgba(32, 33, 36, 0.75)' : 'transparent',
                    backdropFilter: inCallVideo ? 'blur(6px)' : 'none',
                    padding: inCallVideo ? '4px 10px' : '0',
                    borderRadius: '8px',
                  }}
                >
                  {displayName || 'You'} (You)
                </div>
                {inCallMuted && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '16px',
                      right: '16px',
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      backgroundColor: localTheme.badgeBg,
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <MicOff size={16} color="#F87171" />
                  </div>
                )}
                {isHandRaised && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '16px',
                      left: '16px',
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      backgroundColor: '#8AB4F8',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                    }}
                  >
                    <Hand size={18} color="#202124" />
                  </div>
                )}
              </div>

              {/* 2. Remote Participants Cards: Card background matches their avatar icon color! */}
              {remoteParticipants.map((remote, idx) => {
                const remoteTheme = getParticipantColorTheme(remote.name, idx + 1);
                const initial = (remote.name.trim() || 'P').charAt(0).toUpperCase();
                return (
                  <div
                    key={remote.id || idx}
                    style={{
                      width: '100%',
                      height: '100%',
                      minHeight: 0,
                      borderRadius: '24px',
                      overflow: 'hidden',
                      position: 'relative',
                      backgroundColor: remoteTheme.tileBg,
                      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <div
                      style={{
                        width: '100%',
                        height: '100%',
                        backgroundColor: remoteTheme.tileBg,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <div
                        style={{
                          width: remoteParticipants.length <= 1 ? '96px' : '72px',
                          height: remoteParticipants.length <= 1 ? '96px' : '72px',
                          borderRadius: '50%',
                          backgroundColor: remoteTheme.avatarBg,
                          color: '#FFFFFF',
                          fontSize: remoteParticipants.length <= 1 ? '44px' : '32px',
                          fontWeight: 500,
                          fontFamily: "'Google Sans', Roboto, -apple-system, sans-serif",
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
                        }}
                      >
                        {initial}
                      </div>
                    </div>
                    {/* Remote Participant Name in Bottom-Left */}
                    <div
                      style={{
                        position: 'absolute',
                        bottom: '16px',
                        left: '16px',
                        color: '#FFFFFF',
                        fontSize: '14px',
                        fontWeight: 500,
                        fontFamily: "'Google Sans', Roboto, -apple-system, sans-serif",
                        textShadow: '0 1px 3px rgba(0, 0, 0, 0.8)',
                      }}
                    >
                      {remote.name}
                    </div>
                    {/* Remote Mute Indicator in Top-Right */}
                    {remote.muted && (
                      <div
                        style={{
                          position: 'absolute',
                          top: '16px',
                          right: '16px',
                          width: '28px',
                          height: '28px',
                          borderRadius: '50%',
                          backgroundColor: remoteTheme.badgeBg,
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <MicOff size={16} color="#F87171" />
                      </div>
                    )}
                    {/* Remote Raised-Hand Indicator in Top-Left */}
                    {remote.raisedHand && (
                      <div
                        style={{
                          position: 'absolute',
                          top: '16px',
                          left: '16px',
                          width: '32px',
                          height: '32px',
                          borderRadius: '50%',
                          backgroundColor: '#1A73E8',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                          zIndex: 10,
                        }}
                        title={`${remote.name} raised hand`}
                      >
                        <Hand size={18} color="#FFFFFF" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Global Live Captions Overlay (works in ALL layouts) ── */}
          {captionsEnabled && (
            <div
              style={{
                position: 'fixed',
                bottom: '108px',
                left: '50%',
                transform: 'translateX(-50%)',
                backgroundColor: 'rgba(10, 10, 12, 0.90)',
                backdropFilter: 'blur(12px)',
                padding: '10px 24px',
                borderRadius: '14px',
                color: '#FFFFFF',
                fontSize: '15px',
                lineHeight: 1.6,
                maxWidth: '70vw',
                minWidth: '260px',
                textAlign: 'center',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
                zIndex: 300,
                pointerEvents: 'none',
                minHeight: '42px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {(captionText || captionInterim) ? (
                <span>
                  <span style={{ color: '#FFFFFF', fontWeight: 400 }}>{captionText}</span>
                  {captionInterim && (
                    <span style={{ color: 'rgba(255,255,255,0.45)', fontStyle: 'italic' }}>
                      {' '}{captionInterim}
                    </span>
                  )}
                </span>
              ) : (
                <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '13px' }}>
                  🎤 Listening… start speaking to see live captions
                </span>
              )}
            </div>
          )}

          {/* Smooth Side Panels (Resizes main participant stage without covering controls) */}
          {activePanel && (
            <div
              style={{
                width: '360px',
                height: '100%',
                maxHeight: 'calc(100vh - 170px)',
                backgroundColor: '#202124',
                borderRadius: '24px',
                marginLeft: '16px',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                overflow: 'hidden',
                animation: 'slideInRight 0.2s ease',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Panel Header */}
              <div
                style={{
                  padding: '16px 20px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                }}
              >
                <span style={{ fontSize: '16px', fontWeight: 600, color: '#FFFFFF' }}>
                  {activePanel === 'info' && 'Meeting details'}
                  {activePanel === 'chat' && 'In-call messages'}
                  {activePanel === 'people' && `People (${1 + remoteParticipantCount})`}
                  {activePanel === 'host' && 'Host controls'}
                  {activePanel === 'activities' && 'Activities'}
                </span>
                <button
                  onClick={() => setActivePanel(null)}
                  style={{ background: 'none', border: 'none', color: '#9AA0A6', cursor: 'pointer', padding: '4px' }}
                >
                  <X size={18} />
                </button>
              </div>

              {/* Panel Content */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* 1. Meeting Info Panel */}
                {activePanel === 'info' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 500, color: '#9AA0A6', marginBottom: '4px' }}>
                        Joining info
                      </div>
                      <div
                        style={{
                          fontSize: '13px',
                          color: '#E8EAED',
                          wordBreak: 'break-all',
                          backgroundColor: 'rgba(255, 255, 255, 0.04)',
                          padding: '10px 12px',
                          borderRadius: '10px',
                        }}
                      >
                        {window.location.origin}/meet/{roomId}
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(`${window.location.origin}/meet/${roomId}`);
                        setCopiedLink(true);
                        setTimeout(() => setCopiedLink(false), 2000);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        padding: '10px 16px',
                        borderRadius: '20px',
                        backgroundColor: '#1A73E8',
                        color: '#FFFFFF',
                        border: 'none',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {copiedLink ? <Check size={16} /> : <Copy size={16} />}
                      {copiedLink ? 'Joining info copied' : 'Copy joining info'}
                    </button>

                    <button
                      onClick={() => setShowShareModal(true)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        padding: '10px 16px',
                        borderRadius: '20px',
                        backgroundColor: 'rgba(255, 255, 255, 0.08)',
                        color: '#E8EAED',
                        border: '1px solid rgba(255, 255, 255, 0.12)',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      <Share2 size={16} /> Share invite via email
                    </button>

                    {isModerator && (
                      <div style={{ marginTop: '8px', paddingTop: '16px', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: '#FFFFFF', marginBottom: '8px' }}>
                          Lobby Broadcast
                        </div>
                        <button
                          onClick={() => setShowAnnounceDialog(true)}
                          style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px',
                            padding: '10px',
                            borderRadius: '16px',
                            backgroundColor: 'rgba(255, 255, 255, 0.06)',
                            color: '#E8EAED',
                            border: '1px solid rgba(255, 255, 255, 0.12)',
                            fontSize: '13px',
                            cursor: 'pointer',
                          }}
                        >
                          <Megaphone size={16} /> Broadcast to waiting lobby
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* 2. In-Call Messages Panel */}
                {activePanel === 'chat' && (
                  <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto', flex: 1, paddingBottom: '12px' }}>
                      {chatMessages.map((msg) => (
                        <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontSize: '12px', fontWeight: 600, color: '#8AB4F8' }}>{msg.sender}</span>
                            <span style={{ fontSize: '11px', color: '#9AA0A6' }}>{msg.time}</span>
                          </div>
                          <div style={{ fontSize: '13px', color: '#E8EAED', lineHeight: 1.4, wordBreak: 'break-word' }}>
                            {msg.text}
                          </div>
                        </div>
                      ))}
                    </div>
                    <form onSubmit={handleSendChatMessage} style={{ display: 'flex', gap: '8px', paddingTop: '10px', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
                      <input
                        type="text"
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        placeholder="Send a message..."
                        style={{
                          flex: 1,
                          backgroundColor: '#2D2E30',
                          border: '1px solid rgba(255, 255, 255, 0.12)',
                          borderRadius: '20px',
                          padding: '8px 14px',
                          color: '#FFFFFF',
                          fontSize: '13px',
                          outline: 'none',
                        }}
                      />
                      <button
                        type="submit"
                        style={{
                          backgroundColor: '#1A73E8',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '50%',
                          width: '36px',
                          height: '36px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                        }}
                      >
                        <Send size={16} />
                      </button>
                    </form>
                  </div>
                )}

                {/* 3. People Panel */}
                {activePanel === 'people' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: '#9AA0A6', textTransform: 'uppercase' }}>
                      In Call ({1 + remoteParticipantCount})
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 10px',
                        backgroundColor: 'rgba(255, 255, 255, 0.04)',
                        borderRadius: '12px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div
                          style={{
                            width: '30px',
                            height: '30px',
                            borderRadius: '50%',
                            backgroundColor: '#2563EB',
                            color: '#fff',
                            fontSize: '13px',
                            fontWeight: 600,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {participantInitial}
                        </div>
                        <div>
                          <div style={{ fontSize: '13px', color: '#E8EAED', fontWeight: 500 }}>
                            {displayName || 'You'} (You)
                          </div>
                          <div style={{ fontSize: '11px', color: '#9AA0A6' }}>
                            {isModerator ? 'Meeting Host' : 'Participant'}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {isHandRaised && (
                          <div
                            title="You raised your hand"
                            style={{
                              width: '24px',
                              height: '24px',
                              borderRadius: '50%',
                              backgroundColor: '#1A73E8',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <Hand size={14} color="#FFFFFF" />
                          </div>
                        )}
                        {inCallMuted ? <MicOff size={15} color="#EA4335" /> : <Mic size={15} color="#8AB4F8" />}
                      </div>
                    </div>

                    {/* Remote participants list in People Panel */}
                    {remoteParticipants.map((p, idx) => {
                      const pTheme = getParticipantColorTheme(p.name, idx + 1);
                      const pInitial = (p.name.trim() || 'P').charAt(0).toUpperCase();
                      return (
                        <div
                          key={p.id || idx}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '8px 10px',
                            backgroundColor: 'rgba(255, 255, 255, 0.04)',
                            borderRadius: '12px',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <div
                              style={{
                                width: '30px',
                                height: '30px',
                                borderRadius: '50%',
                                backgroundColor: pTheme.avatarBg,
                                color: '#fff',
                                fontSize: '13px',
                                fontWeight: 600,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              {pInitial}
                            </div>
                            <div>
                              <div style={{ fontSize: '13px', color: '#E8EAED', fontWeight: 500 }}>
                                {p.name}
                              </div>
                              <div style={{ fontSize: '11px', color: '#9AA0A6' }}>
                                Participant
                              </div>
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {p.raisedHand && (
                              <div
                                title={`${p.name} raised hand`}
                                style={{
                                  width: '24px',
                                  height: '24px',
                                  borderRadius: '50%',
                                  backgroundColor: '#1A73E8',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                }}
                              >
                                <Hand size={14} color="#FFFFFF" />
                              </div>
                            )}
                            {p.muted ? <MicOff size={15} color="#EA4335" /> : <Mic size={15} color="#8AB4F8" />}
                          </div>
                        </div>
                      );
                    })}

                    {/* Waiting Room Queue for Host inside People Panel */}
                    {isModerator && pendingQueue.length > 0 && (
                      <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                          <span style={{ fontSize: '12px', fontWeight: 600, color: '#8AB4F8' }}>
                            Waiting Room ({pendingQueue.length})
                          </span>
                          {pendingQueue.length > 1 && (
                            <button
                              onClick={() => handleAdmitParticipant(undefined, true)}
                              style={{
                                backgroundColor: '#1A73E8',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '10px',
                                padding: '3px 8px',
                                fontSize: '11px',
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                            >
                              Admit All
                            </button>
                          )}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {pendingQueue.map((item) => (
                            <div
                              key={item.id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '6px 8px',
                                backgroundColor: 'rgba(255, 255, 255, 0.03)',
                                borderRadius: '8px',
                              }}
                            >
                              <span style={{ fontSize: '12px', color: '#E8EAED', fontWeight: 500 }}>{item.name}</span>
                              <div style={{ display: 'flex', gap: '4px' }}>
                                <button
                                  onClick={() => handleAdmitParticipant(item.id)}
                                  style={{
                                    backgroundColor: '#1A73E8',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '6px',
                                    padding: '3px 6px',
                                    fontSize: '10px',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                  }}
                                >
                                  Admit
                                </button>
                                <button
                                  onClick={() => handleDenyParticipant(item.id)}
                                  style={{
                                    backgroundColor: 'rgba(255,255,255,0.1)',
                                    color: '#E8EAED',
                                    border: 'none',
                                    borderRadius: '6px',
                                    padding: '3px 6px',
                                    fontSize: '10px',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                  }}
                                >
                                  Deny
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 4. Host Controls Panel */}
                {activePanel === 'host' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: '12px', padding: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                        <span style={{ fontSize: '14px', fontWeight: 600, color: '#E8EAED' }}>Quick access</span>
                        <input
                          type="checkbox"
                          checked={quickAccessEnabled}
                          onChange={(e) => setQuickAccessEnabled(e.target.checked)}
                          style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                        />
                      </div>
                      <p style={{ fontSize: '12px', color: '#9AA0A6', margin: 0, lineHeight: 1.4 }}>
                        When turned on, people can join without asking. When turned off, everyone must be admitted from the waiting room.
                      </p>
                    </div>

                    {/* Waiting Room Queue */}
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: '#FFFFFF' }}>
                          Waiting Room Queue ({pendingQueue.length})
                        </span>
                        {pendingQueue.length > 1 && (
                          <button
                            onClick={() => handleAdmitParticipant(undefined, true)}
                            style={{
                              backgroundColor: '#1A73E8',
                              color: '#fff',
                              border: 'none',
                              borderRadius: '12px',
                              padding: '4px 10px',
                              fontSize: '11px',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            Admit All
                          </button>
                        )}
                      </div>
                      {pendingQueue.length === 0 ? (
                        <p style={{ fontSize: '13px', color: '#9AA0A6', fontStyle: 'italic', margin: '4px 0' }}>
                          No participants currently waiting in the lobby.
                        </p>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {pendingQueue.map((item) => (
                            <div
                              key={item.id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '8px 10px',
                                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                borderRadius: '10px',
                              }}
                            >
                              <span style={{ fontSize: '13px', color: '#E8EAED', fontWeight: 500 }}>{item.name}</span>
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <button
                                  onClick={() => handleAdmitParticipant(item.id)}
                                  style={{
                                    backgroundColor: '#1A73E8',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '8px',
                                    padding: '4px 8px',
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                  }}
                                >
                                  Admit
                                </button>
                                <button
                                  onClick={() => handleDenyParticipant(item.id)}
                                  style={{
                                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                                    color: '#E8EAED',
                                    border: 'none',
                                    borderRadius: '8px',
                                    padding: '4px 8px',
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                  }}
                                >
                                  Deny
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Broadcast Form */}
                    <div style={{ paddingTop: '12px', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#FFFFFF', marginBottom: '8px' }}>
                        Broadcast announcement
                      </div>
                      <textarea
                        value={announcementText}
                        onChange={(e) => setAnnouncementText(e.target.value)}
                        placeholder="Message to waiting guests..."
                        rows={2}
                        style={{
                          width: '100%',
                          boxSizing: 'border-box',
                          backgroundColor: '#2D2E30',
                          border: '1px solid rgba(255, 255, 255, 0.12)',
                          borderRadius: '10px',
                          padding: '8px 10px',
                          color: '#fff',
                          fontSize: '13px',
                          resize: 'none',
                          outline: 'none',
                          marginBottom: '8px',
                        }}
                      />
                      <button
                        onClick={handleBroadcastAnnouncement}
                        style={{
                          width: '100%',
                          padding: '8px',
                          borderRadius: '14px',
                          backgroundColor: '#1A73E8',
                          color: '#fff',
                          border: 'none',
                          fontSize: '13px',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Send to Lobby
                      </button>
                    </div>
                  </div>
                )}

                {/* 5. Activities Panel */}
                {activePanel === 'activities' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div
                      onClick={handleToggleRecording}
                      style={{
                        padding: '14px',
                        backgroundColor: 'rgba(255,255,255,0.04)',
                        borderRadius: '14px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        border: recording ? '1px solid #EA4335' : '1px solid rgba(255,255,255,0.08)',
                      }}
                    >
                      <Radio size={20} color={recording ? '#EA4335' : '#E8EAED'} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '14px', fontWeight: 600, color: '#E8EAED' }}>
                          {recording ? 'Recording in progress' : 'Record meeting'}
                        </div>
                        <div style={{ fontSize: '12px', color: '#9AA0A6' }}>
                          {recording ? `Recording: ${formatDuration(recordingSeconds)}` : 'Save session to your workspace cloud'}
                        </div>
                      </div>
                    </div>

                    <div
                      onClick={() => setShowSettingsModal(true)}
                      style={{
                        padding: '14px',
                        backgroundColor: 'rgba(255,255,255,0.04)',
                        borderRadius: '14px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        border: '1px solid rgba(255,255,255,0.08)',
                      }}
                    >
                      <Settings size={20} color="#E8EAED" />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '14px', fontWeight: 600, color: '#E8EAED' }}>Audio & Video Settings</div>
                        <div style={{ fontSize: '12px', color: '#9AA0A6' }}>Choose microphone, camera, and speakers</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 3. CENTERED FLOATING BOTTOM TOOLBAR (72px height, pill container near #202124) */}
        <div
          style={{
            position: 'absolute',
            bottom: '16px',
            left: '50%',
            transform: 'translateX(-50%)',
            height: '72px',
            backgroundColor: '#202124',
            borderRadius: '36px',
            padding: '0 16px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            zIndex: 100,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Button 1: Microphone with Device Menu (Image 1 order) */}
          <div style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
            <button
              onClick={() => {
                setShowAudioMenu(!showAudioMenu);
                setShowVideoMenu(false);
              }}
              title="Select microphone"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#E8EAED',
                cursor: 'pointer',
                padding: '4px 2px',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <ChevronUp size={16} />
            </button>
            <button
              onClick={handleToggleInCallMic}
              title={inCallMuted ? 'Turn on microphone' : 'Turn off microphone'}
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                backgroundColor: inCallMuted ? '#3C4043' : '#3C4043',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                transition: 'background-color 0.15s ease',
              }}
            >
              {inCallMuted ? <MicOff size={20} color="#EA4335" /> : <Mic size={20} color="#E8EAED" />}
              {inCallMuted && (
                <div
                  style={{
                    position: 'absolute',
                    top: '2px',
                    right: '2px',
                    width: '14px',
                    height: '14px',
                    borderRadius: '50%',
                    backgroundColor: '#FBBC04',
                    color: '#202124',
                    fontSize: '10px',
                    fontWeight: 800,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  !
                </div>
              )}
            </button>

            {/* Audio Device Dropdown Menu */}
            {showAudioMenu && (
              <div
                style={{
                  position: 'absolute',
                  bottom: '56px',
                  left: 0,
                  backgroundColor: '#2D2E30',
                  borderRadius: '16px',
                  padding: '8px',
                  minWidth: '220px',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  zIndex: 150,
                }}
              >
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#9AA0A6', padding: '6px 10px', textTransform: 'uppercase' }}>
                  Microphone
                </div>
                {media.devices.filter((d) => d.kind === 'audioinput').map((d) => (
                  <button
                    key={d.deviceId}
                    onClick={() => handleSelectAudioDevice(d.deviceId)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 10px',
                      background: audioId === d.deviceId ? 'rgba(255,255,255,0.08)' : 'transparent',
                      color: '#E8EAED',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '13px',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {d.label || `Microphone (${d.deviceId.slice(0, 5)})`}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Button 2: Camera with Device Menu */}
          <div style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
            <button
              onClick={() => {
                setShowVideoMenu(!showVideoMenu);
                setShowAudioMenu(false);
              }}
              title="Select camera"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#E8EAED',
                cursor: 'pointer',
                padding: '4px 2px',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <ChevronUp size={16} />
            </button>
            <button
              onClick={handleToggleInCallVideo}
              title={inCallVideo ? 'Turn off camera' : 'Turn on camera'}
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                backgroundColor: '#3C4043',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                transition: 'background-color 0.15s ease',
              }}
            >
              {inCallVideo ? <Video size={20} color="#E8EAED" /> : <VideoOff size={20} color="#EA4335" />}
              {!inCallVideo && (
                <div
                  style={{
                    position: 'absolute',
                    top: '2px',
                    right: '2px',
                    width: '14px',
                    height: '14px',
                    borderRadius: '50%',
                    backgroundColor: '#FBBC04',
                    color: '#202124',
                    fontSize: '10px',
                    fontWeight: 800,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  !
                </div>
              )}
            </button>

            {/* Video Device Dropdown Menu */}
            {showVideoMenu && (
              <div
                style={{
                  position: 'absolute',
                  bottom: '56px',
                  left: 0,
                  backgroundColor: '#2D2E30',
                  borderRadius: '16px',
                  padding: '8px',
                  minWidth: '220px',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  zIndex: 150,
                }}
              >
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#9AA0A6', padding: '6px 10px', textTransform: 'uppercase' }}>
                  Camera
                </div>
                {media.devices.filter((d) => d.kind === 'videoinput').map((d) => (
                  <button
                    key={d.deviceId}
                    onClick={() => handleSelectVideoDevice(d.deviceId)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 10px',
                      background: videoId === d.deviceId ? 'rgba(255,255,255,0.08)' : 'transparent',
                      color: '#E8EAED',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '13px',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {d.label || `Camera (${d.deviceId.slice(0, 5)})`}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Button 3: Present / Screen Share */}
          <button
            onClick={handleToggleScreenShare}
            title={isScreenSharing ? 'Stop presenting' : 'Present now'}
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              backgroundColor: isScreenSharing ? '#8AB4F8' : '#3C4043',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background-color 0.15s ease',
            }}
          >
            <ScreenShare size={20} color={isScreenSharing ? '#202124' : '#E8EAED'} />
          </button>

          {/* Button 4: Reactions */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowReactions(!showReactions)}
              title="Send a reaction"
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                backgroundColor: showReactions ? '#8AB4F8' : '#3C4043',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background-color 0.15s ease',
              }}
            >
              <Smile size={20} color={showReactions ? '#202124' : '#E8EAED'} />
            </button>
            {/* Reactions Floating Tray */}
            {showReactions && (
              <div
                style={{
                  position: 'absolute',
                  bottom: '56px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  backgroundColor: '#2D2E30',
                  borderRadius: '24px',
                  padding: '6px 12px',
                  display: 'flex',
                  gap: '8px',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  zIndex: 150,
                }}
              >
                {['💖', '👍', '🎉', '👏', '😂', '😮'].map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => handleSendReaction(emoji)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      fontSize: '22px',
                      cursor: 'pointer',
                      padding: '4px',
                      borderRadius: '50%',
                      transition: 'transform 0.15s ease',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.25)')}
                    onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Button 5: Captions */}
          <button
            onClick={() => setCaptionsEnabled(!captionsEnabled)}
            title={captionsEnabled ? 'Turn off captions' : 'Turn on captions'}
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              backgroundColor: captionsEnabled ? '#8AB4F8' : '#3C4043',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background-color 0.15s ease',
            }}
          >
            <Subtitles size={20} color={captionsEnabled ? '#202124' : '#E8EAED'} />
          </button>

          {/* Button 6: Raise Hand */}
          <button
            onClick={handleToggleRaiseHand}
            title={isHandRaised ? 'Lower hand' : 'Raise hand'}
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              backgroundColor: isHandRaised ? '#8AB4F8' : '#3C4043',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background-color 0.15s ease',
            }}
          >
            <Hand size={20} color={isHandRaised ? '#202124' : '#E8EAED'} />
          </button>

          {/* Button 7: More Options */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowMoreMenu(!showMoreMenu)}
              title="More options"
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                backgroundColor: showMoreMenu ? '#8AB4F8' : '#3C4043',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background-color 0.15s ease',
              }}
            >
              <MoreVertical size={20} color={showMoreMenu ? '#202124' : '#E8EAED'} />
            </button>
            {/* More Menu Dropdown */}
            {showMoreMenu && (
              <div
                style={{
                  position: 'absolute',
                  bottom: '56px',
                  right: 0,
                  backgroundColor: '#2D2E30',
                  borderRadius: '16px',
                  padding: '8px',
                  minWidth: '220px',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  zIndex: 150,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                }}
              >
                <button
                  onClick={() => {
                    handleToggleRecording();
                    setShowMoreMenu(false);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '8px 12px',
                    background: 'transparent',
                    border: 'none',
                    borderRadius: '8px',
                    color: recording ? '#EA4335' : '#E8EAED',
                    fontSize: '13px',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <Radio size={16} />
                  {recording ? 'Stop recording' : 'Record meeting'}
                </button>
                <button
                  onClick={() => {
                    setShowSettingsModal(true);
                    setShowMoreMenu(false);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '8px 12px',
                    background: 'transparent',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#E8EAED',
                    fontSize: '13px',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <Settings size={16} />
                  Settings
                </button>
                {isModerator && (
                  <button
                    onClick={() => {
                      setShowAnnounceDialog(true);
                      setShowMoreMenu(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '8px 12px',
                      background: 'transparent',
                      border: 'none',
                      borderRadius: '8px',
                      color: '#E8EAED',
                      fontSize: '13px',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <Megaphone size={16} />
                    Broadcast announcement
                  </button>
                )}
                {('documentPictureInPicture' in window || (document as any).pictureInPictureEnabled) && (
                  <button
                    onClick={() => {
                      setShowMoreMenu(false);
                      handleTogglePiP();
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '8px 12px',
                      background: isPiPActive ? 'rgba(138, 180, 248, 0.15)' : 'transparent',
                      border: 'none',
                      borderRadius: '8px',
                      color: isPiPActive ? '#8AB4F8' : '#E8EAED',
                      fontSize: '13px',
                      cursor: 'pointer',
                      textAlign: 'left',
                      width: '100%',
                    }}
                  >
                    <LayoutGrid size={16} />
                    {isPiPActive ? 'Exit Picture-in-Picture' : 'Picture-in-Picture'}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Button: Picture-in-Picture Quick Toggle */}
          {('documentPictureInPicture' in window || (document as any).pictureInPictureEnabled) && (
            <button
              onClick={handleTogglePiP}
              title={isPiPActive ? 'Exit Picture-in-Picture' : 'Open Picture-in-Picture'}
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                backgroundColor: isPiPActive ? '#8AB4F8' : '#3C4043',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background-color 0.15s ease',
              }}
            >
              <LayoutGrid size={20} color={isPiPActive ? '#202124' : '#E8EAED'} />
              <span style={{ display: 'none' }}>Picture in picture</span>
            </button>
          )}

          {/* Button: Invite People (Directly opens Share / Invite Modal) */}
          <button
            onClick={() => setShowShareModal(true)}
            title="Invite people to meeting"
            style={{
              height: '48px',
              padding: '0 16px',
              borderRadius: '24px',
              backgroundColor: '#3C4043',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              color: '#E8EAED',
              fontSize: '13px',
              fontWeight: 600,
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#4A4E51')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#3C4043')}
          >
            <UserPlus size={18} color="#8AB4F8" />
            <span>Invite</span>
          </button>

          {/* Button 8: Hang Up / Leave (Wider Red Pill Button #EA4335, matching Image 1) */}
          <button
            onClick={() => {
              if (isModerator) {
                setShowEndMeetingModal(true);
              } else {
                leaveMeeting();
              }
            }}
            title="Leave call"
            style={{
              width: '68px',
              height: '48px',
              borderRadius: '24px',
              backgroundColor: '#EA4335',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background-color 0.15s ease',
            }}
          >
            <Phone size={20} color="#FFFFFF" style={{ transform: 'rotate(135deg)' }} />
            <span style={{ display: 'none' }}>Exit Meeting</span>
          </button>
        </div>

        {/* 4. SEPARATE ROUNDED BOTTOM-RIGHT CONTROLS GROUP (Chat + Activities + Host Controls) */}
        <div
          style={{
            position: 'absolute',
            bottom: '16px',
            right: '24px',
            height: '48px',
            backgroundColor: '#202124',
            borderRadius: '24px',
            padding: '0 8px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            zIndex: 100,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Chat Button */}
          <button
            onClick={() => setActivePanel(activePanel === 'chat' ? null : 'chat')}
            title="Chat with everyone"
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '50%',
              backgroundColor: activePanel === 'chat' ? '#8AB4F8' : 'transparent',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background-color 0.15s ease',
            }}
          >
            <MessageSquare size={18} color={activePanel === 'chat' ? '#202124' : '#E8EAED'} />
          </button>

          {/* Activities Button */}
          <button
            onClick={() => setActivePanel(activePanel === 'activities' ? null : 'activities')}
            title="Activities"
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '50%',
              backgroundColor: activePanel === 'activities' ? '#8AB4F8' : 'transparent',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background-color 0.15s ease',
            }}
          >
            <LayoutGrid size={18} color={activePanel === 'activities' ? '#202124' : '#E8EAED'} />
          </button>

          {/* Host Controls Button */}
          <button
            onClick={() => setActivePanel(activePanel === 'host' ? null : 'host')}
            title="Host controls"
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '50%',
              backgroundColor: activePanel === 'host' ? '#8AB4F8' : 'transparent',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
              transition: 'background-color 0.15s ease',
            }}
          >
            <ShieldCheck size={18} color={activePanel === 'host' ? '#202124' : '#E8EAED'} />
            {pendingQueue.length > 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: '4px',
                  right: '4px',
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: '#EA4335',
                }}
              />
            )}
          </button>
        </div>

        {/* Floating Animated Reaction Emojis */}
        {floatingEmojis.map((item) => (
          <div
            key={item.id}
            style={{
              position: 'absolute',
              bottom: '90px',
              left: `${item.left}%`,
              fontSize: '32px',
              pointerEvents: 'none',
              zIndex: 200,
              animation: 'floatUp 2.2s forwards ease-out',
            }}
          >
            {item.emoji}
          </div>
        ))}

        {/* Headless Jitsi WebRTC Container (kept alive for audio/video signaling with NO visible watermark or default toolbar) */}
        <div
          ref={jitsiContainerRef}
          style={{
            position: 'absolute',
            width: '1px',
            height: '1px',
            opacity: 0,
            pointerEvents: 'none',
            overflow: 'hidden',
            bottom: 0,
            right: 0,
          }}
        />

        {/* Share Modal */}
        <ShareMeetingModal
          isOpen={showShareModal}
          onClose={() => setShowShareModal(false)}
          meeting={{
            name: formattedRoomTitle,
            meetingUrl: `${window.location.origin}/meet/${encodeURIComponent(roomId)}`,
            roomSlug: roomId,
            hostName: meetingInfo?.organizerName || displayName || 'Organizer',
            description: meetingInfo?.description || undefined,
          }}
        />

        {/* Moderator Broadcast Announcement Dialog */}
        {showAnnounceDialog && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.65)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 200,
              padding: '20px',
            }}
          >
            <div
              style={{
                backgroundColor: '#2D2E30',
                borderRadius: '20px',
                padding: '24px',
                maxWidth: '420px',
                width: '100%',
                boxShadow: '0 12px 32px rgba(0, 0, 0, 0.5)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <h3 style={{ margin: 0, color: '#fff', fontSize: '18px', fontWeight: 600 }}>Announce to Waiting Room</h3>
                <button onClick={() => setShowAnnounceDialog(false)} style={{ background: 'none', border: 'none', color: '#9AA0A6', cursor: 'pointer' }}>
                  <X size={18} />
                </button>
              </div>
              <p style={{ color: '#9AA0A6', fontSize: '13px', margin: '0 0 14px' }}>
                Broadcast a one-way message visible to everyone currently waiting in the lobby.
              </p>
              <textarea
                value={announcementText}
                onChange={(e) => setAnnouncementText(e.target.value)}
                placeholder="e.g. We will start in 5 minutes, please hold on..."
                rows={3}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  backgroundColor: '#202124',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: '10px',
                  padding: '10px 12px',
                  color: '#fff',
                  fontSize: '14px',
                  resize: 'none',
                  outline: 'none',
                  marginBottom: '16px',
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  onClick={() => setShowAnnounceDialog(false)}
                  style={{ padding: '8px 16px', borderRadius: '16px', backgroundColor: 'transparent', color: '#E8EAED', border: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleBroadcastAnnouncement}
                  style={{ padding: '8px 20px', borderRadius: '16px', backgroundColor: '#1A73E8', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' }}
                >
                  Broadcast
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Host End Meeting Confirmation Modal */}
        {showEndMeetingModal && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.65)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 200,
              padding: '20px',
            }}
          >
            <div
              style={{
                backgroundColor: '#2D2E30',
                borderRadius: '24px',
                padding: '28px',
                maxWidth: '440px',
                width: '100%',
                boxShadow: '0 12px 36px rgba(0, 0, 0, 0.6)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                textAlign: 'center',
              }}
            >
              <h3 style={{ margin: '0 0 10px', color: '#fff', fontSize: '20px', fontWeight: 600 }}>Leave the Call?</h3>
              <p style={{ color: '#9AA0A6', fontSize: '14px', margin: '0 0 24px', lineHeight: 1.5 }}>
                As the meeting host, you can choose to leave the call on your own or end it for all participants.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <button
                  onClick={handleEndMeetingForEveryone}
                  style={{
                    width: '100%',
                    padding: '12px',
                    borderRadius: '24px',
                    backgroundColor: '#EA4335',
                    color: '#fff',
                    border: 'none',
                    fontWeight: 600,
                    fontSize: '15px',
                    cursor: 'pointer',
                  }}
                >
                  End call for everyone
                </button>
                <button
                  onClick={() => {
                    setShowEndMeetingModal(false);
                    leaveMeeting();
                  }}
                  style={{
                    width: '100%',
                    padding: '12px',
                    borderRadius: '24px',
                    backgroundColor: 'rgba(255, 255, 255, 0.08)',
                    color: '#E8EAED',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    fontWeight: 600,
                    fontSize: '15px',
                    cursor: 'pointer',
                  }}
                >
                  Just leave call
                </button>
                <button
                  onClick={() => setShowEndMeetingModal(false)}
                  style={{
                    backgroundColor: 'transparent',
                    color: '#9AA0A6',
                    border: 'none',
                    padding: '8px',
                    fontSize: '14px',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* One-time Auto Picture-in-Picture opt-in banner */}
        {showPipEnableCTA && (
          <div
            style={{
              position: 'fixed',
              top: '16px',
              left: '50%',
              transform: 'translateX(-50%)',
              backgroundColor: '#202124',
              color: '#FFFFFF',
              padding: '10px 12px 10px 16px',
              borderRadius: '12px',
              boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              zIndex: 260,
              fontSize: '13px',
              maxWidth: '92vw',
              animation: 'fadeIn 0.2s ease',
            }}
          >
            <LayoutGrid size={18} color="#8AB4F8" style={{ flexShrink: 0 }} />
            <span style={{ lineHeight: 1.4 }}>
              Keep this meeting visible when you switch tabs — enable automatic Picture-in-Picture?
            </span>
            <button
              onClick={handleEnablePipCTA}
              style={{
                backgroundColor: '#8AB4F8',
                color: '#202124',
                border: 'none',
                borderRadius: '18px',
                padding: '7px 14px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              Enable
            </button>
            <button
              onClick={handleDismissPipCTA}
              aria-label="Dismiss"
              style={{
                background: 'none',
                border: 'none',
                color: '#9AA0A6',
                cursor: 'pointer',
                padding: '4px',
                flexShrink: 0,
                display: 'flex',
              }}
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Floating Toast Notification (Raise Hand, Recording, PiP Hint) */}
        {(handRaisedToast || recordingToast || pipHintToast) && (
          <div
            style={{
              position: 'fixed',
              bottom: '88px',
              left: '50%',
              transform: 'translateX(-50%)',
              backgroundColor: '#202124',
              color: '#FFFFFF',
              padding: '10px 20px',
              borderRadius: '24px',
              boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              zIndex: 250,
              fontSize: '13px',
              fontWeight: 500,
              pointerEvents: 'none',
              animation: 'fadeIn 0.2s ease',
            }}
          >
            {handRaisedToast ? (
              <>
                <div
                  style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    backgroundColor: '#1A73E8',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Hand size={14} color="#FFFFFF" />
                </div>
                <span>{handRaisedToast}</span>
              </>
            ) : recordingToast ? (
              <>
                <div
                  style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    backgroundColor: '#EA4335',
                    animation: 'pulse 1.5s infinite',
                  }}
                />
                <span>{recordingToast}</span>
              </>
            ) : (
              <>
                <div
                  style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    backgroundColor: '#34A853',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <LayoutGrid size={14} color="#FFFFFF" />
                </div>
                <span>{pipHintToast}</span>
              </>
            )}
          </div>
        )}

        {/* Document Picture-in-Picture Portal (Rendered into detached native window) */}
        {documentPipActive && documentPipWindowRef.current && createPortal(
          <DocumentPipContent
            isScreenSharing={isScreenSharing}
            screenStream={screenStream || screenStreamRef.current}
            remoteScreenStream={remoteScreenStream}
            remotePresenterName={remotePresenterName}
            inCallVideo={inCallVideo}
            inCallStream={inCallStream || inCallStreamRef.current}
            inCallMuted={inCallMuted}
            displayName={displayName}
            isHandRaised={isHandRaised}
            remoteParticipants={remoteParticipants}
            roomTitle={meetingInfo?.description || roomId}
            onToggleMic={handleToggleInCallMic}
            onToggleVideo={handleToggleInCallVideo}
            onToggleHand={handleToggleRaiseHand}
            onReturnToMeeting={() => {
              window.focus();
              closePipRef.current?.();
            }}
            onLeaveMeeting={() => leaveMeeting()}
          />,
          documentPipWindowRef.current.document.body
        )}
      </div>
    );
  }

  // ===========================================================================
  // STAGE 1: DEDICATED WAITING LOBBY (Waiting for Host to Admit)
  // ===========================================================================
  if (inWaitingRoom) {
    return (
      <div
        style={{
          minHeight: '100vh',
          width: '100vw',
          backgroundColor: '#202124',
          color: '#E8EAED',
          fontFamily: "'Google Sans', Roboto, -apple-system, sans-serif",
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          boxSizing: 'border-box',
        }}
      >
        {/* Top Header */}
        <header
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            padding: '20px 32px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <img src="/assets/toowix-logo.png" alt="Toowix" style={{ width: '32px', height: '32px' }} />
          <span style={{ fontSize: '18px', fontWeight: 600, color: '#fff' }}>
            Toowix <span style={{ color: '#4F46E5' }}>Meet</span>
          </span>
        </header>

        {/* Center Waiting Card */}
        <div
          style={{
            maxWidth: '540px',
            width: '100%',
            backgroundColor: '#2D2E30',
            borderRadius: '24px',
            padding: '36px 32px',
            boxShadow: '0 12px 36px rgba(0, 0, 0, 0.5)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
          }}
        >
          {/* Mini Self-Preview with toggles */}
          <div
            style={{
              width: '280px',
              height: '160px',
              borderRadius: '16px',
              backgroundColor: '#1E1F21',
              overflow: 'hidden',
              position: 'relative',
              marginBottom: '24px',
              border: '1px solid rgba(255, 255, 255, 0.1)',
            }}
          >
            {videoEnabled && !cameraPermissionError ? (
              <video
                ref={videoPreviewRef}
                autoPlay
                playsInline
                muted
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  transform: 'scaleX(-1)',
                }}
              />
            ) : (
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#9AA0A6',
                }}
              >
                <div
                  style={{
                    width: '56px',
                    height: '56px',
                    borderRadius: '50%',
                    backgroundColor: '#4F46E5',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '22px',
                    fontWeight: 600,
                  }}
                >
                  {(displayName || 'G').charAt(0).toUpperCase()}
                </div>
              </div>
            )}

            {/* In-preview toggles */}
            <div
              style={{
                position: 'absolute',
                bottom: '10px',
                left: 0,
                right: 0,
                display: 'flex',
                justifyContent: 'center',
                gap: '8px',
              }}
            >
              <button
                onClick={handleToggleMic}
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  backgroundColor: micEnabled ? 'rgba(255, 255, 255, 0.9)' : '#EA4335',
                  color: micEnabled ? '#202124' : '#FFFFFF',
                  border: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                {micEnabled ? <Mic size={15} /> : <MicOff size={15} />}
              </button>
              <button
                onClick={handleToggleVideo}
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  backgroundColor: videoEnabled ? 'rgba(255, 255, 255, 0.9)' : '#EA4335',
                  color: videoEnabled ? '#202124' : '#FFFFFF',
                  border: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                {videoEnabled ? <Video size={15} /> : <VideoOff size={15} />}
              </button>
            </div>
          </div>

          <h2 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 8px', color: '#fff' }}>
            {waitingDenied ? 'Entry Denied' : 'Waiting for the host to let you in...'}
          </h2>

          <p style={{ fontSize: '14px', color: '#9AA0A6', margin: '0 0 20px', maxWidth: '360px', lineHeight: 1.5 }}>
            {waitingDenied
              ? 'The meeting host has denied your request to enter this meeting.'
              : `You'll join ${formattedRoomTitle} as soon as the host admits you.`}
          </p>

          {/* Pulsing Status Bar */}
          {!waitingDenied && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '10px',
                padding: '8px 18px',
                borderRadius: '20px',
                backgroundColor: 'rgba(26, 115, 232, 0.12)',
                color: '#8AB4F8',
                fontSize: '13px',
                fontWeight: 500,
                marginBottom: '24px',
              }}
            >
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: '#1A73E8',
                  animation: 'pulse 1.5s infinite',
                }}
              />
              Asking to join as {displayName || 'Guest'}
            </div>
          )}

          {/* Host Announcement Alert */}
          {hostAnnouncement && (
            <div
              style={{
                width: '100%',
                padding: '14px 16px',
                borderRadius: '12px',
                backgroundColor: 'rgba(251, 188, 4, 0.12)',
                border: '1px solid rgba(251, 188, 4, 0.3)',
                color: '#FDD663',
                fontSize: '13px',
                textAlign: 'left',
                display: 'flex',
                gap: '10px',
                marginBottom: '24px',
                boxSizing: 'border-box',
              }}
            >
              <Megaphone size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong style={{ display: 'block', marginBottom: '2px' }}>Message from Host:</strong>
                {hostAnnouncement}
              </div>
            </div>
          )}

          {/* Action Button */}
          <button
            onClick={handleCancelWaiting}
            style={{
              padding: '10px 28px',
              borderRadius: '20px',
              backgroundColor: 'transparent',
              color: '#E8EAED',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            {waitingDenied ? 'Return to Home' : 'Cancel Request'}
          </button>
        </div>
      </div>
    );
  }

  // ===========================================================================
  // STAGE 0: PRE-JOIN LOBBY (Google Meet 2-Column Desktop Experience)
  // ===========================================================================
  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100vw',
        backgroundColor: isDark ? '#202124' : '#F8F9FA',
        color: isDark ? '#E8EAED' : '#202124',
        fontFamily: "'Google Sans', Roboto, -apple-system, sans-serif",
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 24px',
        boxSizing: 'border-box',
        position: 'relative',
      }}
    >
      {/* Top Header */}
      <header
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: '64px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 32px',
          zIndex: 50,
        }}
      >
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none' }}>
          <img src="/assets/toowix-logo.png" alt="Toowix Logo" style={{ width: '32px', height: '32px', objectFit: 'contain' }} />
          <span style={{ fontSize: '20px', fontWeight: 600, color: isDark ? '#FFFFFF' : '#202124', letterSpacing: '-0.3px' }}>
            Toowix <span style={{ color: '#4F46E5' }}>Meet</span>
          </span>
        </Link>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={toggleTheme}
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '50%',
              backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : '#FFFFFF',
              border: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.12)' : '#DADCE0'}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: isDark ? '#FDD663' : '#5F6368',
              cursor: 'pointer',
            }}
            title={isDark ? 'Light mode' : 'Dark mode'}
          >
            {isDark ? <Sun size={17} /> : <Moon size={17} />}
          </button>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: isDark ? 'rgba(255, 255, 255, 0.06)' : '#FFFFFF',
              padding: '6px 14px',
              borderRadius: '20px',
              border: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.1)' : '#DADCE0'}`,
              fontSize: '12px',
              fontWeight: 500,
              color: isDark ? '#9AA0A6' : '#5F6368',
            }}
          >
            <Lock size={13} color="#34A853" /> Encrypted
          </div>
        </div>
      </header>

      {/* Main 2-Column Pre-Join Container */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '48px',
          maxWidth: '1080px',
          width: '100%',
          marginTop: '40px',
          flexWrap: 'wrap',
        }}
      >
        {/* ===================================================================
            Left Column: 16:9 Rounded Camera Preview & Mic Level Visualizer
            =================================================================== */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', flex: '1 1 540px', maxWidth: '620px' }}>
          <div
            style={{
              width: '100%',
              aspectRatio: '16/9',
              borderRadius: '24px',
              backgroundColor: '#202124',
              overflow: 'hidden',
              position: 'relative',
              boxShadow: isDark
                ? '0 12px 32px rgba(0, 0, 0, 0.5)'
                : '0 12px 32px rgba(0, 0, 0, 0.12)',
              border: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.1)' : '#E5E7EB'}`,
            }}
          >
            {videoEnabled && !cameraPermissionError ? (
              <video
                ref={videoPreviewRef}
                autoPlay
                playsInline
                muted
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  transform: 'scaleX(-1)',
                }}
              />
            ) : (
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: '#202124',
                }}
              >
                <div
                  style={{
                    width: '96px',
                    height: '96px',
                    borderRadius: '50%',
                    backgroundColor: '#4F46E5',
                    color: '#FFFFFF',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '36px',
                    fontWeight: 600,
                    boxShadow: '0 4px 16px rgba(79, 70, 229, 0.4)',
                  }}
                >
                  {(displayName || 'U').charAt(0).toUpperCase()}
                </div>
                <span style={{ fontSize: '13px', color: '#9AA0A6', marginTop: '14px', textAlign: 'center', padding: '0 16px' }}>
                  {cameraPermissionError ? (media.cameraError || 'Camera permission denied. You can join with audio only.') : 'Camera is off'}
                </span>
              </div>
            )}

            {/* Bottom Floating Control Bar on Video Preview */}
            <div
              style={{
                position: 'absolute',
                bottom: '16px',
                left: 0,
                right: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '12px',
                zIndex: 10,
              }}
            >
              {/* Mic Toggle with Dynamic Level Visualizer */}
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <button
                  onClick={handleToggleMic}
                  style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '50%',
                    backgroundColor: micEnabled ? '#FFFFFF' : '#EA4335',
                    color: micEnabled ? '#202124' : '#FFFFFF',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
                    transition: 'all 0.15s ease',
                  }}
                  title={micEnabled ? 'Turn microphone off' : 'Turn microphone on'}
                >
                  {micEnabled ? <Mic size={20} /> : <MicOff size={20} />}
                </button>

                {/* Animated 3-Bar Audio Volume Visualizer */}
                {micEnabled && !micPermissionError && (
                  <div
                    style={{
                      position: 'absolute',
                      right: '-18px',
                      display: 'flex',
                      alignItems: 'flex-end',
                      gap: '2px',
                      height: '16px',
                      padding: '2px',
                    }}
                  >
                    {[0.6, 1.0, 0.8].map((mult, idx) => {
                      const h = Math.max(3, Math.min(16, Math.round(media.level * 24 * mult)));
                      return (
                        <span
                          key={idx}
                          style={{
                            width: '3px',
                            height: `${h}px`,
                            backgroundColor: '#34A853',
                            borderRadius: '2px',
                            transition: 'height 0.08s ease',
                          }}
                        />
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Camera Toggle */}
              <button
                onClick={handleToggleVideo}
                style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '50%',
                  backgroundColor: videoEnabled ? '#FFFFFF' : '#EA4335',
                  color: videoEnabled ? '#202124' : '#FFFFFF',
                  border: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
                  transition: 'all 0.15s ease',
                }}
                title={videoEnabled ? 'Turn camera off' : 'Turn camera on'}
              >
                {videoEnabled ? <Video size={20} /> : <VideoOff size={20} />}
              </button>

              {/* Visual Effects (Blur toggle) */}
              <button
                onClick={() => setBlurEnabled((b) => !b)}
                style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '50%',
                  backgroundColor: blurEnabled ? '#4F46E5' : 'rgba(32, 33, 36, 0.75)',
                  color: '#FFFFFF',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  backdropFilter: 'blur(8px)',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
                }}
                title={blurEnabled ? 'Visual effects active' : 'Apply visual effects'}
              >
                <Sparkles size={18} />
              </button>

              {/* Device Settings Dialog Button */}
              <button
                onClick={() => setShowSettingsModal(true)}
                style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '50%',
                  backgroundColor: 'rgba(32, 33, 36, 0.75)',
                  color: '#FFFFFF',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  backdropFilter: 'blur(8px)',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
                }}
                title="Audio and video settings"
              >
                <Settings size={18} />
              </button>
            </div>
          </div>

          {/* Active device label chip */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              fontSize: '12px',
              color: isDark ? '#9AA0A6' : '#5F6368',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Mic size={13} color="#34A853" /> {media.devices.find((d) => d.deviceId === audioId)?.label || 'Default Microphone'}
            </span>
            <span>•</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Video size={13} color="#1A73E8" /> {media.devices.find((d) => d.deviceId === videoId)?.label || 'Default Camera'}
            </span>
          </div>
        </div>

        {/* ===================================================================
            Right Column: Meeting Name, Join Actions & Safe Link Share
            =================================================================== */}
        <div
          style={{
            flex: '1 1 380px',
            maxWidth: '420px',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
          }}
        >
          <div>
            <h1
              style={{
                fontSize: '28px',
                fontWeight: 600,
                color: isDark ? '#FFFFFF' : '#202124',
                margin: '0 0 8px',
                letterSpacing: '-0.5px',
              }}
            >
              {formattedRoomTitle}
            </h1>
            <p style={{ fontSize: '15px', color: isDark ? '#9AA0A6' : '#5F6368', margin: 0 }}>
              Ready to join?
            </p>
          </div>

          {/* Identity Chip or Guest Name Input */}
          {auth.currentUser ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '10px 14px',
                borderRadius: '12px',
                backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : '#F1F3F4',
                border: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.08)' : '#E5E7EB'}`,
              }}
            >
              <div
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '50%',
                  backgroundColor: '#4F46E5',
                  color: '#FFFFFF',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 600,
                  fontSize: '15px',
                }}
              >
                {(auth.currentUser.displayName || auth.currentUser.email || 'U').charAt(0).toUpperCase()}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <span style={{ fontSize: '14px', fontWeight: 600, color: isDark ? '#FFFFFF' : '#202124' }}>
                  {auth.currentUser.displayName || 'Verified User'}
                </span>
                <span style={{ fontSize: '12px', color: isDark ? '#9AA0A6' : '#5F6368', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                  {auth.currentUser.email}
                </span>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: isDark ? '#BDC1C6' : '#3C4043' }}>
                Your Name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Enter your name to join"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '12px 14px',
                  borderRadius: '10px',
                  backgroundColor: isDark ? '#2D2E30' : '#FFFFFF',
                  border: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.15)' : '#DADCE0'}`,
                  color: isDark ? '#FFFFFF' : '#202124',
                  fontSize: '14px',
                  outline: 'none',
                }}
              />
            </div>
          )}

          {/* Error Notice */}
          {admissionError && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: '10px',
                backgroundColor: 'rgba(234, 67, 53, 0.1)',
                border: '1px solid rgba(234, 67, 53, 0.3)',
                color: '#EA4335',
                fontSize: '13px',
              }}
            >
              {admissionError}
            </div>
          )}

          {/* Primary Join Buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <button
              onClick={() => handleJoinMeeting(false)}
              disabled={joining}
              style={{
                width: '100%',
                padding: '14px',
                borderRadius: '24px',
                backgroundColor: joining ? '#80868B' : '#4F46E5',
                color: '#FFFFFF',
                border: 'none',
                fontSize: '16px',
                fontWeight: 600,
                cursor: joining ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                boxShadow: '0 2px 8px rgba(79, 70, 229, 0.4)',
                transition: 'background-color 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (!joining) e.currentTarget.style.backgroundColor = '#4338CA';
              }}
              onMouseLeave={(e) => {
                if (!joining) e.currentTarget.style.backgroundColor = '#4F46E5';
              }}
            >
              {joining ? 'Connecting...' : 'Join Meeting'}
            </button>

            <button
              onClick={() => setShowOtherWaysModal(true)}
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '24px',
                backgroundColor: 'transparent',
                color: isDark ? '#8AB4F8' : '#1A73E8',
                border: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.15)' : '#DADCE0'}`,
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = isDark ? 'rgba(255, 255, 255, 0.05)' : '#F1F3F4')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              Other ways to join
            </button>
          </div>

          {/* Safe Share Meeting Link Box */}
          <div
            style={{
              padding: '12px 16px',
              borderRadius: '12px',
              backgroundColor: isDark ? 'rgba(255, 255, 255, 0.04)' : '#F1F3F4',
              border: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.08)' : '#E5E7EB'}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
            }}
          >
            <div style={{ overflow: 'hidden' }}>
              <span style={{ fontSize: '11px', color: isDark ? '#9AA0A6' : '#5F6368', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Joining Info
              </span>
              <div style={{ fontSize: '13px', color: isDark ? '#E8EAED' : '#202124', fontFamily: 'monospace', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                {window.location.origin}/meet/{roomId}
              </div>
            </div>

            <button
              onClick={handleCopyMeetingLink}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                backgroundColor: copiedLink ? '#34A853' : '#4F46E5',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                flexShrink: 0,
                transition: 'background-color 0.15s ease',
              }}
            >
              {copiedLink ? <Check size={14} /> : <Copy size={14} />}
              {copiedLink ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      </div>

      {/* Audio / Video Settings Dialog */}
      {showSettingsModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 200,
            padding: '20px',
          }}
        >
          <div
            style={{
              backgroundColor: isDark ? '#2D2E30' : '#FFFFFF',
              borderRadius: '24px',
              padding: '28px',
              maxWidth: '480px',
              width: '100%',
              boxShadow: '0 12px 36px rgba(0, 0, 0, 0.5)',
              border: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.1)' : '#E5E7EB'}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: isDark ? '#FFFFFF' : '#202124' }}>
                Audio & Video Settings
              </h3>
              <button
                onClick={() => setShowSettingsModal(false)}
                style={{ background: 'none', border: 'none', color: isDark ? '#9AA0A6' : '#5F6368', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Microphone Picker */}
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px', color: isDark ? '#BDC1C6' : '#3C4043' }}>
                  Microphone
                </label>
                <select
                  value={audioId}
                  onChange={(e) => setAudioId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px',
                    borderRadius: '8px',
                    backgroundColor: isDark ? '#202124' : '#F1F3F4',
                    border: `1px solid ${isDark ? 'rgba(255,255,255,0.15)' : '#DADCE0'}`,
                    color: isDark ? '#fff' : '#202124',
                    outline: 'none',
                  }}
                >
                  <option value="">Default System Microphone</option>
                  {media.devices
                    .filter((d) => d.kind === 'audioinput')
                    .map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `Microphone ${d.deviceId.slice(0, 5)}`}
                      </option>
                    ))}
                </select>
              </div>

              {/* Camera Picker */}
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px', color: isDark ? '#BDC1C6' : '#3C4043' }}>
                  Camera
                </label>
                <select
                  value={videoId}
                  onChange={(e) => setVideoId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px',
                    borderRadius: '8px',
                    backgroundColor: isDark ? '#202124' : '#F1F3F4',
                    border: `1px solid ${isDark ? 'rgba(255,255,255,0.15)' : '#DADCE0'}`,
                    color: isDark ? '#fff' : '#202124',
                    outline: 'none',
                  }}
                >
                  <option value="">Default System Camera</option>
                  {media.devices
                    .filter((d) => d.kind === 'videoinput')
                    .map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `Camera ${d.deviceId.slice(0, 5)}`}
                      </option>
                    ))}
                </select>
              </div>

              {/* Speaker Picker */}
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px', color: isDark ? '#BDC1C6' : '#3C4043' }}>
                  Speakers
                </label>
                <select
                  value={outputId}
                  onChange={(e) => setOutputId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px',
                    borderRadius: '8px',
                    backgroundColor: isDark ? '#202124' : '#F1F3F4',
                    border: `1px solid ${isDark ? 'rgba(255,255,255,0.15)' : '#DADCE0'}`,
                    color: isDark ? '#fff' : '#202124',
                    outline: 'none',
                  }}
                >
                  <option value="">Default System Speaker</option>
                  {media.devices
                    .filter((d) => d.kind === 'audiooutput')
                    .map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `Speaker ${d.deviceId.slice(0, 5)}`}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowSettingsModal(false)}
                style={{
                  padding: '10px 24px',
                  borderRadius: '20px',
                  backgroundColor: '#4F46E5',
                  color: '#FFFFFF',
                  border: 'none',
                  fontWeight: 600,
                  fontSize: '14px',
                  cursor: 'pointer',
                }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Other Ways to Join Dialog */}
      {showOtherWaysModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 200,
            padding: '20px',
          }}
        >
          <div
            style={{
              backgroundColor: isDark ? '#2D2E30' : '#FFFFFF',
              borderRadius: '24px',
              padding: '28px',
              maxWidth: '480px',
              width: '100%',
              boxShadow: '0 12px 36px rgba(0, 0, 0, 0.5)',
              border: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.1)' : '#E5E7EB'}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: isDark ? '#FFFFFF' : '#202124' }}>
                Other ways to join
              </h3>
              <button
                onClick={() => setShowOtherWaysModal(false)}
                style={{ background: 'none', border: 'none', color: isDark ? '#9AA0A6' : '#5F6368', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px', color: isDark ? '#BDC1C6' : '#3C4043' }}>
                  Shareable Room URL
                </label>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 14px',
                    borderRadius: '10px',
                    backgroundColor: isDark ? '#202124' : '#F1F3F4',
                    border: `1px solid ${isDark ? 'rgba(255,255,255,0.15)' : '#DADCE0'}`,
                    gap: '10px',
                  }}
                >
                  <span
                    style={{
                      fontSize: '13px',
                      color: isDark ? '#E8EAED' : '#202124',
                      fontFamily: 'monospace',
                      textOverflow: 'ellipsis',
                      overflow: 'hidden',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {`${window.location.origin}/meet/${roomId}`}
                  </span>
                  <button
                    onClick={handleCopyMeetingLink}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      backgroundColor: copiedLink ? '#34A853' : '#4F46E5',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '6px 12px',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      flexShrink: 0,
                      transition: 'background-color 0.15s ease',
                    }}
                  >
                    {copiedLink ? <Check size={14} /> : <Copy size={14} />}
                    {copiedLink ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            </div>

            <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowOtherWaysModal(false)}
                style={{
                  padding: '10px 24px',
                  borderRadius: '20px',
                  backgroundColor: '#4F46E5',
                  color: '#FFFFFF',
                  border: 'none',
                  fontWeight: 600,
                  fontSize: '14px',
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
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
} from 'lucide-react';
import { useTheme } from '../lib/theme';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000';

export function MeetingRoomPage() {
  const { isDark, toggleTheme } = useTheme();
  const { roomId = 'lounge' } = useParams();
  const [searchParams] = useSearchParams();
  const jwtToken = searchParams.get('jwt');
  const navigate = useNavigate();

  // Pre-join state
  const [hasJoined, setHasJoined] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [micEnabled, setMicEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [blurEnabled, setBlurEnabled] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showOtherWaysModal, setShowOtherWaysModal] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [cameraPermissionError, setCameraPermissionError] = useState(false);

  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  // Parse JWT token user info if available
  const [tokenUser, setTokenUser] = useState<{ name?: string; email?: string; avatar?: string } | null>(null);
  const [isModerator, setIsModerator] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Real meeting info (type + organizer), used to decide lobby behavior -- fetched
  // publicly by roomSlug since a guest joining a link isn't necessarily logged in.
  const [meetingInfo, setMeetingInfo] = useState<{
    type: string;
    organizerId: string;
    organizerName: string;
    description: string | null;
    inviteRestricted: boolean;
    accessAllowed: boolean;
    autoRecording: boolean;
    requireLobbyPolicy: boolean;
    allowScreenShare: boolean;
    micLockEnabled: boolean;
  } | null>(null);
  // Refs mirroring the state above, read inside the Jitsi event listener closure so it
  // always sees the latest value even though the listener is attached only once.
  const meetingInfoRef = useRef(meetingInfo);
  const currentUserIdRef = useRef<string | null>(null);
  useEffect(() => { meetingInfoRef.current = meetingInfo; }, [meetingInfo]);
  useEffect(() => { currentUserIdRef.current = currentUserId; }, [currentUserId]);

  useEffect(() => {
    const emailParam = tokenUser?.email ? `?email=${encodeURIComponent(tokenUser.email)}` : '';
    fetch(`${BACKEND_URL}/api/meetings/room/${roomId}${emailParam}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.meeting) {
          setMeetingInfo({
            type: data.meeting.type,
            organizerId: String(data.meeting.organizerId),
            organizerName: data.meeting.organizerName,
            description: data.meeting.description || null,
            inviteRestricted: !!data.meeting.inviteRestricted,
            accessAllowed: data.meeting.accessAllowed !== false,
            autoRecording: !!data.meeting.autoRecording,
            requireLobbyPolicy: !!data.meeting.requireLobbyPolicy,
            allowScreenShare: data.meeting.allowScreenShare !== false,
            micLockEnabled: !!data.meeting.micLockEnabled,
          });
        }
      })
      .catch((err) => console.warn('[MeetingRoomPage] Could not fetch meeting info:', err));
    // Re-checked once the visitor's email is known (cached user or JWT), since the
    // invite-list check server-side needs an email to evaluate against.
  }, [roomId, tokenUser?.email]);

  useEffect(() => {
    // 1. Check local session storage user
    const cachedUser = localStorage.getItem('toowix_user');
    if (cachedUser) {
      try {
        const u = JSON.parse(cachedUser);
        setDisplayName(u.name || u.email?.split('@')[0] || 'User');
        setTokenUser(u);
        if (u.id) setCurrentUserId(String(u.id));
      } catch (e) {
        console.error('Error reading cached user in lobby:', e);
      }
    }

    // 2. Read JWT token if provided
    if (jwtToken) {
      try {
        const payloadPart = jwtToken.split('.')[1];
        if (payloadPart) {
          const decodedStr = atob(payloadPart.replace(/-/g, '+').replace(/_/g, '/'));
          const decoded = JSON.parse(decodedStr);
          if (decoded.context?.user) {
            setTokenUser(decoded.context.user);
            if (decoded.context.user.name) {
              setDisplayName(decoded.context.user.name);
            }
          }
          if (decoded.context?.features?.moderator) {
            setIsModerator(true);
          }
        }
      } catch (err) {
        console.warn('[MeetingRoomPage] Failed to parse JWT payload client-side:', err);
      }
    }
  }, [jwtToken]);

  // Handle webcam & microphone preview in the Light Stage Pod
  useEffect(() => {
    if (hasJoined) {
      // Stop local preview stream when transitioning to Jitsi iframe
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }
      return;
    }

    let isMounted = true;

    async function startCameraPreview() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });

        if (!isMounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        mediaStreamRef.current = stream;
        if (videoPreviewRef.current) {
          videoPreviewRef.current.srcObject = stream;
        }
        setCameraPermissionError(false);
      } catch (err) {
        console.warn('Camera preview not permitted or unavailable:', err);
        setCameraPermissionError(true);
      }
    }

    startCameraPreview();

    return () => {
      isMounted = false;
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, [hasJoined]);

  // Toggle video track on/off
  const handleToggleVideo = () => {
    const nextState = !videoEnabled;
    setVideoEnabled(nextState);
    if (mediaStreamRef.current) {
      const videoTrack = mediaStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = nextState;
      }
    }
  };

  // Toggle mic track on/off
  const handleToggleMic = () => {
    const nextState = !micEnabled;
    setMicEnabled(nextState);
    if (mediaStreamRef.current) {
      const audioTrack = mediaStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = nextState;
      }
    }
  };

  const handleCopyMeetingLink = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const handleJoinMeeting = () => {
    // Release local preview streams immediately so Jitsi gets exclusive hardware access
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    setHasJoined(true);
  };

  // Private meeting with an invite list: block the client from ever constructing the
  // Jitsi call for a non-invited visitor. The server also independently rejects the
  // attendance/join call for defense in depth, but this is what actually stops someone
  // uninvited from entering the room UI at all.
  const isAccessBlocked = !!meetingInfo && meetingInfo.inviteRestricted && !meetingInfo.accessAllowed;

  // Clean formatted title for room
  const formattedRoomTitle = roomId
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  const jitsiDomain = import.meta.env.VITE_JITSI_DOMAIN || 'meet.toowix.com';

  // Jitsi External API integration -- this replaces a raw <iframe src=...#hash-params>
  // embed. Modern Jitsi deployments largely ignore config overrides passed as URL hash
  // fragments (only a small whitelist survives), which is why the watermark/branding
  // kept showing through. The official JitsiMeetExternalAPI script accepts
  // configOverwrite/interfaceConfigOverwrite as real constructor options, which is the
  // supported, reliable way to strip Jitsi's own branding and apply ours instead.
  const jitsiContainerRef = useRef<HTMLDivElement | null>(null);
  const jitsiApiRef = useRef<any>(null);
  const [remoteParticipantCount, setRemoteParticipantCount] = useState(0);
  // Tracks our own real attendance record for this session, so the People/Attendance
  // page reflects who actually joined/left instead of always being empty.
  const attendanceEntryIdRef = useRef<string | null>(null);

  const recordAttendanceJoin = useCallback(async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/meetings/room/${roomId}/attendance/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: displayName || 'Guest',
          email: tokenUser?.email || undefined,
        }),
      });
      const data = await response.json();
      if (response.ok) attendanceEntryIdRef.current = data.participantEntryId;
    } catch (err) {
      console.warn('[MeetingRoomPage] Could not record attendance join:', err);
    }
  }, [roomId, displayName, tokenUser]);

  const recordAttendanceLeave = useCallback(() => {
    if (!attendanceEntryIdRef.current) return;
    const payload = JSON.stringify({ participantEntryId: attendanceEntryIdRef.current });
    // sendBeacon so this reliably fires even on tab close, when a normal fetch would be cancelled.
    const url = `${BACKEND_URL}/api/meetings/room/${roomId}/attendance/leave`;
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
    } else {
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(() => {});
    }
    attendanceEntryIdRef.current = null;
  }, [roomId]);

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
    if (!hasJoined) return;
    let disposed = false;

    loadJitsiScript()
      .then(() => {
        if (disposed || !jitsiContainerRef.current) return;
        const JitsiMeetExternalAPI = (window as any).JitsiMeetExternalAPI;

        const api = new JitsiMeetExternalAPI(jitsiDomain, {
          roomName: roomId,
          parentNode: jitsiContainerRef.current,
          jwt: jwtToken || undefined,
          width: '100%',
          height: '100%',
          userInfo: { displayName: displayName || 'Participant' },
          configOverwrite: {
            prejoinPageEnabled: false,
            prejoinConfig: { enabled: false },
            requireDisplayName: false,
            // Company Meeting Policy: force-mute participants on join when the org has
            // locked the mic by default (they can still unmute themselves -- Jitsi has no
            // "moderator-only unmute" toggle exposed here, so this sets the starting state).
            startWithAudioMuted: meetingInfoRef.current?.micLockEnabled ? true : !micEnabled,
            startWithVideoMuted: !videoEnabled,
            disableDeepLinking: true,
            disableInviteFunctions: true,
            hideConferenceSubject: false,
            disableScreensharing: meetingInfoRef.current ? !meetingInfoRef.current.allowScreenShare : false,
          },
          interfaceConfigOverwrite: {
            // Strip every Jitsi-branded watermark/link -- this is the actual fix for
            // "don't want to see Jitsi": these are the real, respected overrides.
            SHOW_JITSI_WATERMARK: false,
            SHOW_WATERMARK_FOR_GUESTS: false,
            JITSI_WATERMARK_LINK: '',
            SHOW_BRAND_WATERMARK: false,
            BRAND_WATERMARK_LINK: '',
            DEFAULT_LOGO_URL: `${window.location.origin}/assets/toowix-logo.png`,
            DEFAULT_WELCOME_PAGE_LOGO_URL: `${window.location.origin}/assets/toowix-logo.png`,
            APP_NAME: 'Toowix Meet',
            NATIVE_APP_NAME: 'Toowix Meet',
            PROVIDER_NAME: 'Toowix',
            MOBILE_APP_PROMO: false,
            HIDE_DEEP_LINKING_LOGO: true,
            DISPLAY_WELCOME_PAGE_CONTENT: false,
            SHOW_CHROME_EXTENSION_BANNER: false,
            // Google Meet-style: clean pill toolbar, no clutter
            TOOLBAR_BUTTONS: [
              'microphone', 'camera',
              ...(meetingInfoRef.current?.allowScreenShare === false ? [] : ['desktop']),
              'chat', 'raisehand', 'reactions',
              'closedcaptions', 'select-background', 'recording',
              'participants-pane', 'tileview', 'invite', 'settings', 'hangup',
            ],
          },
        });

        jitsiApiRef.current = api;

        api.addListener('participantJoined', () => setRemoteParticipantCount((n) => n + 1));
        api.addListener('participantLeft', () => setRemoteParticipantCount((n) => Math.max(0, n - 1)));
        api.addListener('videoConferenceLeft', () => recordAttendanceLeave());
        api.addListener('readyToClose', () => navigate('/dashboard'));

        // Google Meet-style lobby: for Internal/Private meetings, the organizer joining
        // turns on Jitsi's native Lobby feature for the room. Anyone else who joins after
        // that automatically gets Jitsi's own "knock / ask to join" screen and waits until
        // the organizer admits them from the participants panel -- this is Jitsi's built-in
        // Lobby, not a custom-built waiting room, so it works exactly like Meet's out of the box.
        api.addListener('videoConferenceJoined', () => {
          recordAttendanceJoin();

          const info = meetingInfoRef.current;
          const isRealOrganizer = !!info && !!currentUserIdRef.current && info.organizerId === currentUserIdRef.current;
          if (isRealOrganizer) {
            if (info!.type === 'Internal' || info!.type === 'Private' || info!.requireLobbyPolicy) {
              api.executeCommand('toggleLobby', true);
            }
            // Auto-recording by company policy -- only takes effect for real if this Jitsi
            // deployment has Jibri configured; otherwise Jitsi will just show its own
            // "recording could not start" notice, same as clicking the toolbar button would.
            if (info!.autoRecording) {
              api.executeCommand('startRecording', { mode: 'file' });
            }
          }
        });
      })
      .catch((err) => console.error('[MeetingRoomPage] Jitsi failed to load:', err));

    return () => {
      disposed = true;
      recordAttendanceLeave();
      if (jitsiApiRef.current) {
        jitsiApiRef.current.dispose();
        jitsiApiRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasJoined]);

  // Best-effort: also record leave if the tab/window is closed outright rather than
  // navigated away from within the app (React's own cleanup won't run in that case).
  useEffect(() => {
    if (!hasJoined) return;
    window.addEventListener('beforeunload', recordAttendanceLeave);
    return () => window.removeEventListener('beforeunload', recordAttendanceLeave);
  }, [hasJoined, recordAttendanceLeave]);

  // ===========================================================================
  // 1. IN-MEETING VIEW (When User Clicks Join)
  // ===========================================================================
  if (hasJoined) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#141B2B' }}>
        {/* Top Meeting Header */}
        <div
          style={{
            height: '56px',
            backgroundColor: '#0E131F',
            color: '#FFFFFF',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 24px',
            borderBottom: '1px solid #232B3E',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <img src="/assets/toowix-logo.png" alt="Toowix" style={{ width: '26px', height: '26px' }} />
            <span style={{ fontWeight: 600, fontSize: '15px' }}>
              Toowix Meet: <span style={{ color: '#4F46E5' }}>{roomId}</span>
            </span>

            {isModerator && (
              <span
                style={{
                  backgroundColor: '#4F46E5',
                  color: '#FFFFFF',
                  fontSize: '11px',
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: '12px',
                  letterSpacing: '0.5px',
                  textTransform: 'uppercase',
                }}
              >
                Host / Moderator
              </span>
            )}

            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#9CA3AF', backgroundColor: 'rgba(255,255,255,0.06)', padding: '3px 10px', borderRadius: '12px' }}>
              <Users size={13} />
              {remoteParticipantCount + 1} in call
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            {tokenUser && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div
                  style={{
                    width: '30px',
                    height: '30px',
                    borderRadius: '50%',
                    backgroundColor: '#4F46E5',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '13px',
                    fontWeight: 600,
                  }}
                >
                  {(displayName || 'U').charAt(0).toUpperCase()}
                </div>
                <span style={{ fontSize: '13px', fontWeight: 600 }}>{displayName}</span>
              </div>
            )}

            <button
              onClick={() => navigate('/dashboard')}
              style={{
                color: '#C7D2FE',
                fontSize: '13px',
                fontWeight: 500,
                padding: '6px 12px',
                borderRadius: '6px',
                backgroundColor: 'rgba(255,255,255,0.08)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <ArrowLeft size={14} /> Exit Meeting
            </button>
          </div>
        </div>

        {/* Jitsi External API mounts the call UI into this container */}
        <div ref={jitsiContainerRef} style={{ width: '100%', flex: 1 }} />
      </div>
    );
  }

  // ===========================================================================
  // 2. MEETING LOBBY — LIGHT STAGE VARIANT (Google Stitch Design)
  // ===========================================================================
  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100vw',
        backgroundColor: isDark ? '#0B0F19' : '#F7F8FA',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        color: isDark ? '#F9FAFB' : '#111827',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      {/* Ambient Glowing Orb Background */}
      <div
        style={{
          position: 'absolute',
          bottom: '-20vh',
          left: '-10vw',
          width: '80vw',
          height: '80vw',
          background: isDark
            ? 'radial-gradient(circle, rgba(99, 102, 241, 0.12) 0%, rgba(99, 102, 241, 0) 70%)'
            : 'radial-gradient(circle, rgba(79, 70, 229, 0.15) 0%, rgba(79, 70, 229, 0) 70%)',
          filter: 'blur(100px)',
          zIndex: 0,
          pointerEvents: 'none',
        }}
      />

      {/* Top Translucent Header */}
      <header
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '70px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '0 36px',
          zIndex: 50,
          boxSizing: 'border-box',
        }}
      >
        <Link to="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: '12px', textDecoration: 'none' }}>
          <img
            src="/assets/toowix-logo.png"
            alt="Toowix Logo"
            style={{ width: '36px', height: '36px', objectFit: 'contain' }}
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
          <span style={{ fontSize: '20px', fontWeight: 800, color: isDark ? '#F9FAFB' : '#111827', letterSpacing: '-0.3px' }}>
            Toowix <span style={{ color: isDark ? '#818CF8' : '#4F46E5' }}>Meet</span>
          </span>
        </Link>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Theme Toggle Button */}
          <button
            onClick={toggleTheme}
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '50%',
              backgroundColor: isDark ? 'rgba(19, 27, 46, 0.8)' : 'rgba(255, 255, 255, 0.8)',
              border: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.12)' : '#E5E7EB'}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: isDark ? '#FBBF24' : '#4B5563',
              cursor: 'pointer',
              backdropFilter: 'blur(16px)',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.05)',
            }}
            title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {isDark ? <Sun size={17} /> : <Moon size={17} />}
          </button>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              backgroundColor: isDark ? 'rgba(19, 27, 46, 0.75)' : 'rgba(255, 255, 255, 0.75)',
              padding: '6px 16px',
              borderRadius: '24px',
              border: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.1)' : '#E5E7EB'}`,
              backdropFilter: 'blur(16px)',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
            }}
          >
            <Lock size={15} style={{ color: isDark ? '#9CA3AF' : '#6B7280' }} />
            <span style={{ fontSize: '13px', fontWeight: 600, color: isDark ? '#9CA3AF' : '#4B5563' }}>
              End-to-End Encrypted
            </span>
          </div>
        </div>
      </header>

      {/* Main Light Stage Content Container */}
      <main className="lobby-stage-container">
        {/* =====================================================================
            Left Area: Floating Glass Pod (Video Preview - Hero Size)
            ===================================================================== */}
        <div
          className="lobby-video-pod"
          style={{
            backgroundColor: isDark ? 'rgba(19, 27, 46, 0.75)' : 'rgba(255, 255, 255, 0.75)',
            border: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.8)'}`,
            boxShadow: isDark
              ? '0 25px 50px -12px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.05)'
              : '0 25px 50px -12px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 1)',
          }}
        >
          {/* Live Camera Feed or Sleek Placeholder */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundColor: isDark ? '#0F172A' : '#E5E7EB',
              zIndex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {/* Minimal Grid Overlay */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                backgroundImage: isDark
                  ? 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)'
                  : 'linear-gradient(rgba(0,0,0,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.04) 1px, transparent 1px)',
                backgroundSize: '24px 24px',
                pointerEvents: 'none',
                zIndex: 2,
              }}
            />

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
                  filter: blurEnabled ? 'blur(12px)' : 'none',
                  transform: 'scaleX(-1)', // Mirror webcam view
                }}
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', zIndex: 3 }}>
                <div
                  style={{
                    width: '96px',
                    height: '96px',
                    borderRadius: '50%',
                    backgroundColor: isDark ? 'rgba(99, 102, 241, 0.2)' : '#EEF2FF',
                    color: isDark ? '#818CF8' : '#4F46E5',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '40px',
                    fontWeight: 700,
                    border: `3px solid ${isDark ? '#1E293B' : '#FFFFFF'}`,
                    boxShadow: '0 8px 20px rgba(79, 70, 229, 0.2)',
                  }}
                >
                  {(displayName || 'P').charAt(0).toUpperCase()}
                </div>
                <span style={{ fontSize: '15px', fontWeight: 600, color: isDark ? '#9CA3AF' : '#6B7280' }}>
                  {cameraPermissionError ? 'Camera access needed' : 'Camera is off'}
                </span>
              </div>
            )}
          </div>

          {/* User Info Overlay Pill (Top Left Inside Pod) */}
          <div style={{ position: 'absolute', top: '18px', left: '18px', zIndex: 10 }}>
            <div
              style={{
                backgroundColor: isDark ? 'rgba(15, 23, 42, 0.85)' : 'rgba(255, 255, 255, 0.85)',
                backdropFilter: 'blur(12px)',
                borderRadius: '20px',
                padding: '6px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                border: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.6)'}`,
                boxShadow: '0 2px 6px rgba(0, 0, 0, 0.05)',
              }}
            >
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: videoEnabled ? '#10B981' : '#F59E0B',
                }}
              />
              <span style={{ fontSize: '13px', fontWeight: 600, color: isDark ? '#F9FAFB' : '#111827' }}>
                {videoEnabled ? 'Camera Ready' : 'Audio Only'}
              </span>
            </div>
          </div>          {/* Floating Glass Dock Controls (Bottom Center Inside Pod) */}
          <div style={{ width: '100%', paddingBottom: '24px', display: 'flex', justifyContent: 'center', zIndex: 20 }}>
            <div
              style={{
                backgroundColor: isDark ? 'rgba(15, 23, 42, 0.85)' : 'rgba(255, 255, 255, 0.85)',
                backdropFilter: 'blur(32px)',
                borderRadius: '24px',
                padding: '10px 20px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                border: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.8)'}`,
                boxShadow: isDark ? '0 10px 25px -5px rgba(0, 0, 0, 0.5)' : '0 10px 25px -5px rgba(0, 0, 0, 0.1)',
              }}
            >
              {/* Mic Toggle */}
              <button
                onClick={handleToggleMic}
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '50%',
                  backgroundColor: micEnabled ? (isDark ? '#1E293B' : '#FFFFFF') : (isDark ? 'rgba(239, 68, 68, 0.2)' : '#FEE2E2'),
                  border: `1px solid ${micEnabled ? (isDark ? '#334155' : '#E5E7EB') : (isDark ? 'rgba(239, 68, 68, 0.4)' : '#FECACA')}`,
                  color: micEnabled ? (isDark ? '#F9FAFB' : '#111827') : '#EF4444',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.04)',
                }}
                title={micEnabled ? 'Mute Microphone' : 'Unmute Microphone'}
              >
                {micEnabled ? <Mic size={21} /> : <MicOff size={21} />}
              </button>

              {/* Camera Toggle */}
              <button
                onClick={handleToggleVideo}
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '50%',
                  backgroundColor: videoEnabled ? (isDark ? '#1E293B' : '#FFFFFF') : (isDark ? 'rgba(239, 68, 68, 0.2)' : '#FEE2E2'),
                  border: `1px solid ${videoEnabled ? (isDark ? '#334155' : '#E5E7EB') : (isDark ? 'rgba(239, 68, 68, 0.4)' : '#FECACA')}`,
                  color: videoEnabled ? (isDark ? '#F9FAFB' : '#111827') : '#EF4444',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.04)',
                }}
                title={videoEnabled ? 'Turn Off Camera' : 'Turn On Camera'}
              >
                {videoEnabled ? <Video size={21} /> : <VideoOff size={21} />}
              </button>

              {/* Divider */}
              <div style={{ width: '1px', height: '30px', backgroundColor: isDark ? '#334155' : '#E5E7EB' }} />

              {/* Background Blur Toggle */}
              <button
                onClick={() => setBlurEnabled(!blurEnabled)}
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '50%',
                  backgroundColor: blurEnabled ? (isDark ? 'rgba(99, 102, 241, 0.25)' : '#EEF2FF') : (isDark ? '#1E293B' : '#FFFFFF'),
                  border: `1px solid ${blurEnabled ? (isDark ? 'rgba(99, 102, 241, 0.5)' : '#C7D2FE') : (isDark ? '#334155' : '#E5E7EB')}`,
                  color: blurEnabled ? (isDark ? '#818CF8' : '#4F46E5') : (isDark ? '#9CA3AF' : '#4B5563'),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.04)',
                }}
                title="Toggle Background Blur"
              >
                <Sparkles size={21} />
              </button>

              {/* Settings Toggle */}
              <button
                onClick={() => setShowSettingsModal(true)}
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '50%',
                  backgroundColor: isDark ? '#1E293B' : '#FFFFFF',
                  border: `1px solid ${isDark ? '#334155' : '#E5E7EB'}`,
                  color: isDark ? '#9CA3AF' : '#4B5563',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.04)',
                }}
                title="Audio & Video Settings"
              >
                <Settings size={21} />
              </button>
            </div>
          </div>
        </div>

        {/* =====================================================================
            Right Area: Meeting Info & Join Action
            ===================================================================== */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center' }}>
          <h2 style={{ fontSize: '32px', fontWeight: 800, color: isDark ? '#F9FAFB' : '#111827', margin: '0 0 6px 0', letterSpacing: '-0.5px' }}>
            Ready to join?
          </h2>
          <p style={{ fontSize: '15px', color: isDark ? '#9CA3AF' : '#6B7280', margin: '0 0 24px 0' }}>
            Review your audio and video before entering the room.
          </p>

          {/* Meeting Info Glass Panel */}
          <div
            style={{
              width: '100%',
              backgroundColor: isDark ? 'rgba(19, 27, 46, 0.75)' : 'rgba(255, 255, 255, 0.75)',
              backdropFilter: 'blur(24px)',
              border: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.9)'}`,
              borderRadius: '20px',
              padding: '24px',
              marginBottom: '24px',
              boxShadow: isDark ? '0 10px 25px -5px rgba(0, 0, 0, 0.4)' : '0 10px 25px -5px rgba(0, 0, 0, 0.05)',
              boxSizing: 'border-box',
            }}
          >
            <h1 style={{ fontSize: '22px', fontWeight: 700, color: isDark ? '#F9FAFB' : '#111827', margin: '0 0 6px 0' }}>
              {formattedRoomTitle}
            </h1>
            {meetingInfo?.description && (
              <p style={{ fontSize: '13px', color: isDark ? '#9CA3AF' : '#6B7280', margin: '0 0 12px 0', lineHeight: 1.5 }}>
                {meetingInfo.description}
              </p>
            )}
            <p style={{ fontSize: '14px', color: isDark ? '#9CA3AF' : '#6B7280', margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Users size={16} /> {remoteParticipantCount > 0 ? `${remoteParticipantCount} in the meeting` : 'Waiting for others to join'}
            </p>

            {isAccessBlocked && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', background: isDark ? 'rgba(220,38,38,0.12)' : '#FEF2F2', border: '1px solid #FECACA', borderRadius: '10px', padding: '12px 14px', marginBottom: '16px', fontSize: '13px', color: '#DC2626' }}>
                This is a private meeting. Your email isn't on the organizer's invite list, so you can't join.
              </div>
            )}

            {/* Display Name Input */}
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: isDark ? '#9CA3AF' : '#4B5563', marginBottom: '6px' }}>
                Your Display Name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Enter your name"
                style={{
                  width: '100%',
                  height: '42px',
                  padding: '0 14px',
                  borderRadius: '10px',
                  border: `1px solid ${isDark ? '#334155' : '#D1D5DB'}`,
                  backgroundColor: isDark ? '#0F172A' : '#FFFFFF',
                  fontSize: '14px',
                  color: isDark ? '#F9FAFB' : '#111827',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          {/* Join Meeting CTA Button */}
          <button
            onClick={handleJoinMeeting}
            disabled={isAccessBlocked}
            style={{
              width: '100%',
              height: '52px',
              backgroundColor: isAccessBlocked ? '#D1D5DB' : '#4F46E5',
              color: '#FFFFFF',
              borderRadius: '14px',
              border: 'none',
              fontSize: '16px',
              fontWeight: 700,
              cursor: isAccessBlocked ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              boxShadow: isAccessBlocked ? 'none' : '0 8px 24px rgba(79, 70, 229, 0.35)',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => { if (!isAccessBlocked) e.currentTarget.style.backgroundColor = '#4338CA'; }}
            onMouseLeave={(e) => { if (!isAccessBlocked) e.currentTarget.style.backgroundColor = '#4F46E5'; }}
          >
            <span>{isAccessBlocked ? 'Not Invited' : 'Join Meeting'}</span>
            {!isAccessBlocked && <ArrowRight size={18} />}
          </button>

          {/* Other Ways to Join Button */}
          <button
            onClick={() => setShowOtherWaysModal(true)}
            style={{
              width: '100%',
              marginTop: '12px',
              height: '44px',
              backgroundColor: 'transparent',
              border: `1px solid ${isDark ? '#334155' : '#D1D5DB'}`,
              borderRadius: '12px',
              color: isDark ? '#9CA3AF' : '#4B5563',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              transition: 'background-color 0.15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = isDark ? '#131B2E' : 'rgba(0, 0, 0, 0.03)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            <span>Other ways to join</span>
          </button>
        </div>
      </main>

      {/* =========================================================================
          Modal: Other Ways to Join (Shareable link / Dial-in)
          ========================================================================= */}
      {showOtherWaysModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.65)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            backdropFilter: 'blur(4px)',
          }}
        >
          <div
            style={{
              backgroundColor: isDark ? '#131B2E' : '#FFFFFF',
              borderRadius: '20px',
              maxWidth: '460px',
              width: '100%',
              padding: '24px',
              boxShadow: isDark ? '0 20px 25px -5px rgba(0, 0, 0, 0.6)' : '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
              border: `1px solid ${isDark ? '#1E293B' : 'transparent'}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: isDark ? '#F9FAFB' : '#111827' }}>Other Ways to Join</h3>
              <button onClick={() => setShowOtherWaysModal(false)} style={{ background: 'transparent', color: isDark ? '#9CA3AF' : '#6B7280', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Shareable Link */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: isDark ? '#9CA3AF' : '#6B7280', marginBottom: '6px' }}>
                  Shareable Room URL
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: isDark ? '#0F172A' : '#F3F4F6', border: `1px solid ${isDark ? '#1E293B' : 'transparent'}`, padding: '10px 14px', borderRadius: '10px' }}>
                  <span style={{ fontSize: '13px', color: isDark ? '#F9FAFB' : '#111827', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {window.location.href}
                  </span>
                  <button
                    onClick={handleCopyMeetingLink}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '6px 12px',
                      backgroundColor: copiedLink ? '#059669' : '#4F46E5',
                      color: '#FFFFFF',
                      borderRadius: '6px',
                      border: 'none',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {copiedLink ? <Check size={14} /> : <Copy size={14} />}
                    {copiedLink ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>

              {/* Phone Dial-in */}
              <div style={{ padding: '14px', borderRadius: '10px', border: `1px solid ${isDark ? '#1E293B' : '#E5E7EB'}`, backgroundColor: isDark ? '#0F172A' : '#FAFAFA' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <Phone size={16} style={{ color: isDark ? '#818CF8' : '#4F46E5' }} />
                  <span style={{ fontSize: '14px', fontWeight: 600, color: isDark ? '#F9FAFB' : '#111827' }}>Dial-in by Phone</span>
                </div>
                <p style={{ margin: 0, fontSize: '13px', color: isDark ? '#9CA3AF' : '#6B7280' }}>
                  +1 (800) 555-0199 &bull; PIN: 482 910#
                </p>
              </div>
            </div>

            <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowOtherWaysModal(false)}
                style={{
                  padding: '8px 18px',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: '#4F46E5',
                  color: '#FFFFFF',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          Modal: Device Settings (Mic & Camera diagnostics)
          ========================================================================= */}
      {showSettingsModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.65)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            backdropFilter: 'blur(4px)',
          }}
        >
          <div
            style={{
              backgroundColor: isDark ? '#131B2E' : '#FFFFFF',
              borderRadius: '20px',
              maxWidth: '440px',
              width: '100%',
              padding: '24px',
              boxShadow: isDark ? '0 20px 25px -5px rgba(0, 0, 0, 0.6)' : '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
              border: `1px solid ${isDark ? '#1E293B' : 'transparent'}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: isDark ? '#F9FAFB' : '#111827' }}>Audio & Video Settings</h3>
              <button onClick={() => setShowSettingsModal(false)} style={{ background: 'transparent', color: isDark ? '#9CA3AF' : '#6B7280', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: isDark ? '#9CA3AF' : '#374151', marginBottom: '6px' }}>
                  Camera
                </label>
                <select
                  style={{
                    width: '100%',
                    height: '40px',
                    borderRadius: '8px',
                    border: `1px solid ${isDark ? '#334155' : '#D1D5DB'}`,
                    backgroundColor: isDark ? '#0F172A' : '#FFFFFF',
                    padding: '0 10px',
                    fontSize: '13px',
                    color: isDark ? '#F9FAFB' : '#111827',
                    outline: 'none',
                  }}
                >
                  <option>Default Camera (FaceTime HD / Integrated)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: isDark ? '#9CA3AF' : '#374151', marginBottom: '6px' }}>
                  Microphone
                </label>
                <select
                  style={{
                    width: '100%',
                    height: '40px',
                    borderRadius: '8px',
                    border: `1px solid ${isDark ? '#334155' : '#D1D5DB'}`,
                    backgroundColor: isDark ? '#0F172A' : '#FFFFFF',
                    padding: '0 10px',
                    fontSize: '13px',
                    color: isDark ? '#F9FAFB' : '#111827',
                    outline: 'none',
                  }}
                >
                  <option>Default Microphone (Built-in Audio)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: isDark ? '#9CA3AF' : '#374151', marginBottom: '6px' }}>
                  Speakers / Output
                </label>
                <select
                  style={{
                    width: '100%',
                    height: '40px',
                    borderRadius: '8px',
                    border: `1px solid ${isDark ? '#334155' : '#D1D5DB'}`,
                    backgroundColor: isDark ? '#0F172A' : '#FFFFFF',
                    padding: '0 10px',
                    fontSize: '13px',
                    color: isDark ? '#F9FAFB' : '#111827',
                    outline: 'none',
                  }}
                >
                  <option>Default Speakers (Headphones / System Output)</option>
                </select>
              </div>
            </div>

            <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowSettingsModal(false)}
                style={{
                  padding: '8px 20px',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: '#4F46E5',
                  color: '#FFFFFF',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Save & Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { auth } from '../lib/firebase';
import { useMediaPreview } from '../lib/useMediaPreview';
import { useState, useEffect, useRef, useCallback } from 'react';
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
  const [isPiPActive, setIsPiPActive] = useState(false);
  const pipUserEnabledRef = useRef(false); // true after user clicks PiP button (satisfies gesture requirement)
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [quickAccessEnabled, setQuickAccessEnabled] = useState(true);
  const [chatMessages, setChatMessages] = useState<Array<{ id: string; sender: string; time: string; text: string }>>([
    { id: '1', sender: 'Toowix System', time: 'Just now', text: 'Welcome to the meeting! Messages sent here are visible to all participants.' }
  ]);
  const [chatInput, setChatInput] = useState('');
  const screenStreamRef = useRef<MediaStream | null>(null);
  const inCallVideoRef = useRef<HTMLVideoElement | null>(null);
  const presentationVideoRef = useRef<HTMLVideoElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const [recordingToast, setRecordingToast] = useState<string | null>(null);
  const [remoteScreenStream, setRemoteScreenStream] = useState<MediaStream | null>(null);
  const [remotePresenterName, setRemotePresenterName] = useState<string | null>(null);
  const remotePresentationVideoRef = useRef<HTMLVideoElement | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const lastSignalTimestampRef = useRef<number>(Date.now() - 5000);
  const pipVideoRef = useRef<HTMLVideoElement | null>(null);
  const pipCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pipRafRef = useRef<number>(0);
  const pipTimerRef = useRef<any>(null);
  // Live refs so the PiP draw loop always reads current state
  const pipRemoteParticipantsRef = useRef<typeof remoteParticipants>([]);
  const pipIsScreenSharingRef = useRef(false);
  const pipDisplayNameRef = useRef('');
  const pipAutoTriggeredRef = useRef(false);
  const pipInCallVideoRef = useRef(inCallVideo);
  const toggleInCallMicRef = useRef<() => void>(() => {});
  const toggleInCallVideoRef = useRef<() => void>(() => {});
  const leaveMeetingRef = useRef<() => void>(() => {});
  const pipInCallMutedRef = useRef<boolean | null>(null);
  const pipIsHandRaisedRef = useRef(false);
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

  // ── Keep PiP refs in sync with live state ────────────────────────────────
  useEffect(() => { pipRemoteParticipantsRef.current = remoteParticipants; }, [remoteParticipants]);
  useEffect(() => { pipIsScreenSharingRef.current = isScreenSharing; }, [isScreenSharing]);
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

      vid.addEventListener('leavepictureinpicture', () => {
        if (pipTimerRef.current) {
          clearInterval(pipTimerRef.current);
          pipTimerRef.current = null;
        }
        setIsPiPActive(false);
        pipAutoTriggeredRef.current = false;
        pipUserEnabledRef.current = false;
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
    const screenSharing = pipIsScreenSharingRef.current;
    const screenVid = remotePresentationVideoRef.current;
    const localVid = inCallVideoRef.current;
    const localMuted = pipInCallMutedRef.current ?? false;
    const localHandRaised = pipIsHandRaisedRef.current;

    const GAP = 8;
    const PADDING = 8;
    const HEADER_H = 28;
    const TOOLBAR_H = 48;

    if (screenSharing && screenVid && screenVid.readyState >= 2) {
      // ── Screen-sharing layout: big screen on top, participants below ──
      const availH = H - HEADER_H - TOOLBAR_H - PADDING * 2 - GAP;
      const screenH = Math.round(availH * 0.62);
      const thumbH = availH - screenH;
      const thumbCount = remotes.length + 1;
      const thumbW = Math.max(80, Math.floor((W - PADDING * 2 - GAP * (thumbCount - 1)) / Math.min(thumbCount, 3)));

      // Screen share tile
      ctx.save();
      drawRoundRect(ctx, PADDING, HEADER_H + PADDING, W - PADDING * 2, screenH, 12);
      ctx.clip();
      ctx.drawImage(screenVid, PADDING, HEADER_H + PADDING, W - PADDING * 2, screenH);
      ctx.restore();

      // "📺 Screen" label
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(PADDING, HEADER_H + PADDING, 90, 22);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '500 11px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('🖥 Screen share', PADDING + 6, HEADER_H + PADDING + 11);

      // Participant thumbnails in a row
      let tx = PADDING;
      const ty = HEADER_H + PADDING + screenH + GAP;
      const localTheme = getParticipantColorTheme(localName, 0);
      drawParticipantCard(ctx, tx, ty, thumbW, thumbH, localName + ' (You)', localTheme, localVid, localMuted, localHandRaised);
      tx += thumbW + GAP;
      remotes.slice(0, 2).forEach((r, idx) => {
        const rTheme = getParticipantColorTheme(r.name, idx + 1);
        drawParticipantCard(ctx, tx, ty, thumbW, thumbH, r.name, rTheme, null, r.muted, !!r.raisedHand);
        tx += thumbW + GAP;
      });
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

  const initPipStream = () => {
    ensurePipElements();
    const canvas = pipCanvasRef.current;
    const vid = pipVideoRef.current;
    if (!canvas || !vid) return;

    // Immediately draw fresh frame so video track starts with valid pixels
    drawPipFrame();

    if (!vid.srcObject) {
      vid.srcObject = canvas.captureStream(15);
      (vid as any).autoPictureInPicture = true;
      vid.setAttribute('autopictureinpicture', 'true');
    }
    if (vid.paused) {
      vid.play().catch(() => {});
    }
    // Note: Do NOT start continuous loop until PiP is actually open (saves CPU)
  };

  // Immediate synchronous Auto-PiP invocation for zero-latency tab switching
  const triggerAutoPiP = () => {
    if (!hasJoined) return;
    if ((document as any).pictureInPictureElement) return;

    ensurePipElements();
    const vid = pipVideoRef.current;
    const canvas = pipCanvasRef.current;
    if (!vid || !canvas) return;

    drawPipFrame();
    startPipDraw(); // Start active draw loop now that PiP is entering

    if (!vid.srcObject) {
      vid.srcObject = canvas.captureStream(15);
    }
    (vid as any).autoPictureInPicture = true;
    vid.setAttribute('autopictureinpicture', 'true');
    if (vid.paused) {
      vid.play().catch(() => {});
    }

    try {
      const p = (vid as any).requestPictureInPicture();
      if (p && typeof p.then === 'function') {
        p.then(() => {
          setIsPiPActive(true);
          pipAutoTriggeredRef.current = true;
        }).catch((err: any) => {
          stopPipDraw();
          console.warn('Auto-PiP enter caught:', err);
        });
      }
    } catch (err) {
      stopPipDraw();
      console.warn('Auto-PiP sync enter caught:', err);
    }
  };

  // Toggle PiP — called from button click (user gesture)
  const handleTogglePiP = async () => {
    if (!(document as any).pictureInPictureEnabled) return;

    if ((document as any).pictureInPictureElement) {
      // Exit PiP
      try {
        await (document as any).exitPictureInPicture();
        stopPipDraw();
        setIsPiPActive(false);
        pipAutoTriggeredRef.current = false;
        pipUserEnabledRef.current = false;
      } catch {}
      return;
    }

    // Enter PiP manually
    try {
      initPipStream();
      drawPipFrame();
      startPipDraw();
      const vid = pipVideoRef.current!;
      await (vid as any).requestPictureInPicture();
      setIsPiPActive(true);
      pipUserEnabledRef.current = true;
      pipAutoTriggeredRef.current = false;
    } catch {
      stopPipDraw();
      setIsPiPActive(false);
    }
  };

  // Auto-enter PiP on tab switch (Google Meet style) & auto-exit when switching back
  useEffect(() => {
    if (!hasJoined) return;

    // Immediately pre-warm PiP stream
    initPipStream();

    // Pre-warm / maintain stream on any user interaction in meeting window
    const onUserInteract = () => {
      initPipStream();
    };
    window.addEventListener('click', onUserInteract, { passive: true });
    window.addEventListener('keydown', onUserInteract, { passive: true });
    window.addEventListener('pointerdown', onUserInteract, { passive: true });

    // Chrome MediaSession action handlers for interactive native PiP buttons (Mic, Cam, Hangup)
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.setActionHandler('enterpictureinpicture' as any, () => {
          triggerAutoPiP();
        });
      } catch {}
      try {
        navigator.mediaSession.setActionHandler('togglemicrophone' as any, () => {
          toggleInCallMicRef.current();
          drawPipFrame();
        });
      } catch {}
      try {
        navigator.mediaSession.setActionHandler('togglecamera' as any, () => {
          toggleInCallVideoRef.current();
          drawPipFrame();
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
        // User switched to another tab: trigger immediately and fast!
        triggerAutoPiP();
      } else if (document.visibilityState === 'visible') {
        // User switched back: close PiP if it was auto-triggered (Google Meet behavior)
        if (pipAutoTriggeredRef.current && (document as any).pictureInPictureElement) {
          try {
            (document as any).exitPictureInPicture();
          } catch {}
          pipAutoTriggeredRef.current = false;
          setIsPiPActive(false);
        }
      }
    };

    const handleBlur = () => {
      if (document.visibilityState === 'hidden') {
        triggerAutoPiP();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('pagehide', handleBlur);

    return () => {
      window.removeEventListener('click', onUserInteract);
      window.removeEventListener('keydown', onUserInteract);
      window.removeEventListener('pointerdown', onUserInteract);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('pagehide', handleBlur);
      if ('mediaSession' in navigator) {
        try {
          navigator.mediaSession.setActionHandler('enterpictureinpicture' as any, null);
          navigator.mediaSession.setActionHandler('togglemicrophone' as any, null);
          navigator.mediaSession.setActionHandler('togglecamera' as any, null);
          navigator.mediaSession.setActionHandler('hangup' as any, null);
        } catch {}
      }
      stopPipDraw();
      if ((document as any).pictureInPictureElement) {
        (document as any).exitPictureInPicture().catch(() => {});
      }
      if (pipVideoRef.current) {
        pipVideoRef.current.srcObject = null;
        pipVideoRef.current.parentNode?.removeChild(pipVideoRef.current);
        pipVideoRef.current = null;
      }
      pipCanvasRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasJoined]);

  // Update real-time clock every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Separate Recording Timer
  useEffect(() => {
    if (!recording) {
      setRecordingSeconds(0);
      return;
    }
    const timer = setInterval(() => {
      setRecordingSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    if (!displayName && auth.currentUser) {
      setDisplayName(auth.currentUser.displayName || auth.currentUser.email?.split('@')[0] || '');
    } else if (!displayName) {
      // Restore guest name saved from previous session (for seamless rejoin)
      const savedName = localStorage.getItem('toowix_guest_displayName');
      if (savedName) setDisplayName(savedName);
    }
  }, [displayName]);

  // Real-time media preview hook (kept active for in-call preview & level meter)
  const media = useMediaPreview(false, micEnabled, videoEnabled, audioId, videoId);
  const videoPreviewRef = media.preview;
  const mediaStreamRef = media.stream;
  const cameraPermissionError = !!media.cameraError;
  const micPermissionError = !!media.micError;

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
      const response = await fetch(`${BACKEND_URL}/api/meetings/room/${encodeURIComponent(roomId)}/lobby/knock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          name: displayName.trim() || 'Guest',
          requestId: waitingRequestId || undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Join request failed');

      if (data.status === 'ADMITTED' && data.jitsiToken) {
        // Admitted directly
        setJwtToken(data.jitsiToken);
        setIsModerator(!!data.isHost);
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

  // Active recording timer
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
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
    try {
      jitsiApiRef.current?.executeCommand('sendEndpointTextMessage', '', JSON.stringify({ type: 'MEETING_ENDED_FOR_EVERYONE' }));
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
            startWithVideoMuted: !videoEnabled,
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
        on('participantKickedOut', () => leaveMeeting('You were removed from the meeting by a moderator.'));
        on('endpointTextMessageReceived', (event: any) => {
          try {
            const raw = event?.data?.eventData?.text || event?.text || '';
            if (raw.includes('MEETING_ENDED_FOR_EVERYONE')) {
              leaveMeeting('The host has ended the meeting for everyone.');
            }
          } catch {}
        });
        on('audioMuteStatusChanged', ({ muted }: any) => setInCallMuted(muted));
        on('recordingStatusChanged', ({ on: enabled }: any) => setRecording(!!enabled));
        on('screenSharingStatusChanged', ({ on: enabled }: any) => setIsScreenSharing(!!enabled));
        on('raiseHandUpdated', (data: any) => {
          if (data && data.id) {
            setRemoteParticipants((prev) =>
              prev.map((p) => (p.id === data.id ? { ...p, raisedHand: !!data.handRaised } : p))
            );
          }
        });

        on('videoConferenceJoined', () => {
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

  useEffect(() => {
    if (hasJoined && inCallVideo && inCallVideoRef.current && media.stream.current) {
      inCallVideoRef.current.srcObject = media.stream.current;
    }
  }, [hasJoined, inCallVideo, media.stream]);

  // Synchronize screen share video stream to presentation video element
  useEffect(() => {
    if (isScreenSharing && presentationVideoRef.current && screenStreamRef.current) {
      presentationVideoRef.current.srcObject = screenStreamRef.current;
      presentationVideoRef.current.play().catch(() => {});
    }
  }, [isScreenSharing]);

  const handleToggleInCallMic = () => {
    const nextMuted = inCallMuted === null ? false : !inCallMuted;
    setInCallMuted(nextMuted);
    if (media.stream.current) {
      media.stream.current.getAudioTracks().forEach((t) => (t.enabled = !nextMuted));
    }
    try {
      jitsiApiRef.current?.executeCommand('toggleAudio');
    } catch {}
  };

  const handleToggleInCallVideo = () => {
    const nextVideo = !inCallVideo;
    setInCallVideo(nextVideo);
    if (media.stream.current) {
      media.stream.current.getVideoTracks().forEach((t) => (t.enabled = nextVideo));
    }
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

  const handleToggleRecording = async () => {
    if (recording) {
      // Stop recording
      setRecording(false);
      setRecordingToast('Recording completed & saved!');
      setTimeout(() => setRecordingToast(null), 4000);

      try {
        jitsiApiRef.current?.executeCommand('stopRecording', 'file');
      } catch {}

      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stop();
        } catch {}
      }
    } else {
      // Start recording
      setRecording(true);
      setRecordingSeconds(0);
      setRecordingToast('Recording started - Capturing meeting session');
      setTimeout(() => setRecordingToast(null), 3500);

      try {
        jitsiApiRef.current?.executeCommand('startRecording', { mode: 'file' });
      } catch {}

      try {
        const tracks: MediaStreamTrack[] = [];

        // 1. Video track: Screen share -> Webcam -> Dynamic Meeting Canvas
        if (isScreenSharing && screenStreamRef.current && screenStreamRef.current.getVideoTracks().length > 0) {
          tracks.push(screenStreamRef.current.getVideoTracks()[0]);
        } else if (inCallVideo && media.stream.current && media.stream.current.getVideoTracks().length > 0) {
          tracks.push(media.stream.current.getVideoTracks()[0]);
        } else {
          // Canvas stream fallback so MediaRecorder always has a valid video track
          const canvas = document.createElement('canvas');
          canvas.width = 1280;
          canvas.height = 720;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = '#162842';
            ctx.fillRect(0, 0, 1280, 720);
            ctx.fillStyle = '#1A73E8';
            ctx.beginPath();
            ctx.arc(640, 320, 90, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#FFFFFF';
            ctx.font = 'bold 72px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText((displayName || 'You').charAt(0).toUpperCase(), 640, 320);
            ctx.font = '28px sans-serif';
            ctx.fillText(displayName || 'You', 640, 460);
            ctx.font = '20px sans-serif';
            ctx.fillStyle = '#9AA0A6';
            ctx.fillText(`Toowix Meet — Room: ${roomId}`, 640, 500);
          }
          const canvasStream = canvas.captureStream(15);
          if (canvasStream.getVideoTracks().length > 0) {
            tracks.push(canvasStream.getVideoTracks()[0]);
          }
        }

        // 2. Audio track: Microphone -> Silent audio node fallback
        if (media.stream.current && media.stream.current.getAudioTracks().length > 0) {
          tracks.push(media.stream.current.getAudioTracks()[0]);
        } else {
          try {
            const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
            if (AudioCtxClass) {
              const audioCtx = new AudioCtxClass();
              const dest = audioCtx.createMediaStreamDestination();
              const osc = audioCtx.createOscillator();
              const gain = audioCtx.createGain();
              gain.gain.value = 0; // silent
              osc.connect(gain);
              gain.connect(dest);
              osc.start();
              if (dest.stream.getAudioTracks().length > 0) {
                tracks.push(dest.stream.getAudioTracks()[0]);
              }
            }
          } catch {}
        }

        if (tracks.length > 0) {
          const combinedStream = new MediaStream(tracks);
          recordedChunksRef.current = [];

          let options: MediaRecorderOptions = {};
          if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')) {
            options = { mimeType: 'video/webm;codecs=vp9,opus' };
          } else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')) {
            options = { mimeType: 'video/webm;codecs=vp8,opus' };
          } else if (MediaRecorder.isTypeSupported('video/webm')) {
            options = { mimeType: 'video/webm' };
          }

          const recorder = new MediaRecorder(combinedStream, options);

          recorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
              recordedChunksRef.current.push(event.data);
            }
          };

          recorder.onstop = () => {
            if (recordedChunksRef.current.length > 0) {
              const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              const dateStr = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
              a.download = `Toowix-Meeting-${roomId}-${dateStr}.webm`;
              document.body.appendChild(a);
              a.click();
              setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
              }, 1000);
            }
          };

          recorder.start(1000);
          mediaRecorderRef.current = recorder;
        }
      } catch (recErr) {
        console.warn('Browser MediaRecorder init error:', recErr);
      }
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
    const msg = {
      id: String(Date.now()),
      sender: displayName || 'You',
      time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
      text: chatInput.trim(),
    };
    setChatMessages((prev) => [...prev, msg]);
    setChatInput('');
    try {
      jitsiApiRef.current?.executeCommand('sendEndpointTextMessage', '', msg.text);
    } catch {}
  };

  const postRoomSignal = useCallback(
    async (type: string, payload: any) => {
      try {
        await fetch(`${BACKEND_URL}/api/meetings/room/${encodeURIComponent(roomId)}/signal`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sender: displayName || 'Participant', type, payload }),
        });
      } catch {}
      try {
        jitsiApiRef.current?.executeCommand(
          'sendEndpointTextMessage',
          '',
          JSON.stringify({ type, sender: displayName || 'Participant', payload })
        );
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
      }
      setIsScreenSharing(false);
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
      postRoomSignal('SCREEN_SHARE_STOPPED', {});
    } else {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false,
        });
        screenStreamRef.current = stream;
        setIsScreenSharing(true);

        // Notify room that presenter started sharing
        postRoomSignal('SCREEN_SHARE_STARTED', { presenter: displayName || 'Participant' });

        // Initialize WebRTC PeerConnection to broadcast stream to remote attendees
        try {
          const pc = new RTCPeerConnection({
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' },
            ],
          });
          peerConnectionRef.current = pc;

          stream.getTracks().forEach((track) => pc.addTrack(track, stream));

          pc.onicecandidate = (event) => {
            if (event.candidate) {
              postRoomSignal('WEBRTC_ICE', { candidate: event.candidate });
            }
          };

          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          postRoomSignal('WEBRTC_OFFER', { sdp: offer });
        } catch (webrtcErr) {
          console.warn('WebRTC broadcast init error:', webrtcErr);
        }

        stream.getVideoTracks()[0].onended = () => {
          setIsScreenSharing(false);
          if (screenStreamRef.current) {
            screenStreamRef.current.getTracks().forEach((t) => t.stop());
            screenStreamRef.current = null;
          }
          if (peerConnectionRef.current) {
            peerConnectionRef.current.close();
            peerConnectionRef.current = null;
          }
          postRoomSignal('SCREEN_SHARE_STOPPED', {});
        };

        setTimeout(() => {
          if (presentationVideoRef.current) {
            presentationVideoRef.current.srcObject = stream;
            presentationVideoRef.current.play().catch(() => {});
          }
        }, 50);
      } catch (err: any) {
        console.warn('Screen share cancelled or not allowed:', err);
      }
    }
  };

  // Real-time WebRTC Signaling Listener for incoming presentation & peer stream
  useEffect(() => {
    if (!hasJoined) return;

    const handleIncomingSignal = async (sig: any) => {
      const { type, sender, payload } = sig;
      if (sender === (displayName || 'Participant')) return; // Ignore own signals

      if (type === 'SCREEN_SHARE_STARTED') {
        setRemotePresenterName(payload?.presenter || sender);
      } else if (type === 'SCREEN_SHARE_STOPPED') {
        setRemoteScreenStream(null);
        setRemotePresenterName(null);
        if (peerConnectionRef.current) {
          peerConnectionRef.current.close();
          peerConnectionRef.current = null;
        }
      } else if (type === 'WEBRTC_OFFER') {
        if (isScreenSharing) return; // Ignore if we are the presenter
        setRemotePresenterName(sender);

        try {
          const pc = new RTCPeerConnection({
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' },
            ],
          });
          peerConnectionRef.current = pc;

          pc.ontrack = (event) => {
            if (event.streams && event.streams[0]) {
              setRemoteScreenStream(event.streams[0]);
              if (remotePresentationVideoRef.current) {
                remotePresentationVideoRef.current.srcObject = event.streams[0];
                remotePresentationVideoRef.current.play().catch(() => {});
              }
            }
          };

          pc.onicecandidate = (event) => {
            if (event.candidate) {
              postRoomSignal('WEBRTC_ICE', { candidate: event.candidate });
            }
          };

          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          postRoomSignal('WEBRTC_ANSWER', { sdp: answer });
        } catch (e) {
          console.warn('WebRTC receiver error:', e);
        }
      } else if (type === 'WEBRTC_ANSWER') {
        if (peerConnectionRef.current && payload?.sdp) {
          try {
            await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          } catch (e) {
            console.warn('Set remote desc error:', e);
          }
        }
      } else if (type === 'WEBRTC_ICE') {
        if (peerConnectionRef.current && payload?.candidate) {
          try {
            await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(payload.candidate));
          } catch {}
        }
      } else if (type === 'HAND_TOGGLED') {
        const isRaised = Boolean(payload?.raised);
        const personName = payload?.name || sender || 'Participant';
        setRemoteParticipants((prev) => {
          const exists = prev.some((p) => p.name === personName || p.id === sender);
          if (exists) {
            return prev.map((p) => (p.name === personName || p.id === sender ? { ...p, raisedHand: isRaised } : p));
          } else {
            return [...prev, { id: sender, name: personName, muted: true, video: false, raisedHand: isRaised }];
          }
        });
        if (isRaised) {
          setHandRaisedToast(`${personName} raised their hand`);
          setTimeout(() => setHandRaisedToast(null), 4000);
        }
      }
    };

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
    };
  }, [hasJoined, roomId, displayName, isScreenSharing, postRoomSignal]);

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
                  REC {formatDuration(recordingSeconds)}
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
                    ref={(el) => {
                      presentationVideoRef.current = el;
                      if (el && screenStreamRef.current && el.srcObject !== screenStreamRef.current) {
                        el.srcObject = screenStreamRef.current;
                        el.play().catch(() => {});
                      }
                    }}
                    autoPlay
                    playsInline
                    muted
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  />
                ) : (
                  <video
                    ref={(el) => {
                      remotePresentationVideoRef.current = el;
                      if (el && remoteScreenStream && el.srcObject !== remoteScreenStream) {
                        el.srcObject = remoteScreenStream;
                        el.play().catch(() => {});
                      }
                    }}
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
                {(document as any).pictureInPictureEnabled && (
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

        {/* Floating Toast Notification (Raise Hand & Recording) */}
        {(handRaisedToast || recordingToast) && (
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
            ) : (
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
            )}
          </div>
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
                <span style={{ fontSize: '13px', color: '#9AA0A6', marginTop: '14px' }}>
                  Camera is off
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
              disabled={joining || !displayName.trim()}
              style={{
                width: '100%',
                padding: '14px',
                borderRadius: '24px',
                backgroundColor: !displayName.trim() ? '#80868B' : '#4F46E5',
                color: '#FFFFFF',
                border: 'none',
                fontSize: '16px',
                fontWeight: 600,
                cursor: !displayName.trim() || joining ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                boxShadow: '0 2px 8px rgba(79, 70, 229, 0.4)',
                transition: 'background-color 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (displayName.trim() && !joining) e.currentTarget.style.backgroundColor = '#4338CA';
              }}
              onMouseLeave={(e) => {
                if (displayName.trim() && !joining) e.currentTarget.style.backgroundColor = '#4F46E5';
              }}
            >
              {joining ? 'Connecting...' : 'Join now'}
            </button>

            <button
              onClick={() => handleJoinMeeting(true)}
              disabled={joining || !displayName.trim()}
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '24px',
                backgroundColor: 'transparent',
                color: isDark ? '#8AB4F8' : '#1A73E8',
                border: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.15)' : '#DADCE0'}`,
                fontSize: '14px',
                fontWeight: 600,
                cursor: !displayName.trim() || joining ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = isDark ? 'rgba(255, 255, 255, 0.05)' : '#F1F3F4')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              Other ways to join • Audio only
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
    </div>
  );
}

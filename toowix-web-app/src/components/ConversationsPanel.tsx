import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Archive,
  AtSign,
  Bell,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FileText,
  ImageIcon,
  Info,
  Loader2,
  LogOut,
  Maximize,
  MessageSquare,
  Mic,
  MicOff,
  MoreHorizontal,
  Paperclip,
  Pause,
  Play,
  Search,
  Send,
  Shield,
  Smile,
  Star,
  Tag,
  Trash2,
  UserPlus,
  Users,
  Video,
  Volume2,
  X,
} from 'lucide-react';
import {
  fetchChatHistory,
  fetchConversationMembers,
  fetchConversations,
  fetchRoomConversationMembers,
  IChatReadReceipt,
  IConversationMember,
  IConversationSummary,
  inviteConversationMember,
  ISavedChatMessage,
  leaveConversation,
  markChatRead,
  persistChatMessage,
  resolveChatAudioUrl,
  resolveChatImageUrl,
  updateMeetingPrivacy,
  uploadChatAudio,
  uploadChatImage,
} from '../lib/chatApi';
import { auth } from '../lib/firebase';

interface IConversationsPanelProps {
  isDark: boolean;
  initialConversationId?: string;
  initialMessageId?: string;
  // Set when arriving here right after leaving/ending a meeting that was started from
  // Conversations (see leaveMeeting in MeetingRoomPage.tsx) -- the room slug is all that page
  // knows at that point (not this conversation's Mongo id), so it's matched by roomSlug instead.
  initialRoomSlug?: string;
}

const AVATAR_COLORS = [
  '#4F46E5', // Indigo
  '#0284C7', // Sky Blue
  '#10B981', // Emerald Green
  '#EA580C', // Orange
  '#EC4899', // Pink
  '#8B5CF6', // Purple
  '#F59E0B', // Amber
  '#06B6D4', // Cyan
];

const EMOJI_LIST = ['👍', '🙏', '❤️', '🔥', '😊', '🚀', '🎉', '👏', '✅', '💡', '🙌', '💯'];

function getColorForString(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = input.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index];
}

function initialsOf(name: string): string {
  const clean = (name || '').trim();
  if (!clean) return '?';
  const parts = clean.split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() || '').join('') || '?';
}

function formatConversationTime(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  const now = new Date();

  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday';
  }

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatMessageTime(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatAudioDuration(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function getDayLabel(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return 'Today';
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// WhatsApp-style Voice Note Audio Player Component
function VoiceNotePlayer({
  audioUrl,
  duration = 0,
  isMine = false,
}: {
  audioUrl: string;
  duration?: number | null;
  isMine?: boolean;
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackRate, setPlaybackRate] = useState<1 | 1.5 | 2>(1);
  const [totalDuration, setTotalDuration] = useState(duration || 0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const resolvedUrl = useMemo(() => resolveChatAudioUrl(audioUrl), [audioUrl]);

  // Deterministic heights for 24 waveform bars
  const waveBars = useMemo(() => {
    const bars: number[] = [];
    let hash = 0;
    for (let i = 0; i < audioUrl.length; i++) hash = (hash * 31 + audioUrl.charCodeAt(i)) & 0xffffffff;
    for (let i = 0; i < 24; i++) {
      const pseudo = Math.abs(Math.sin((hash + i * 17) / 5));
      bars.push(Math.max(4, Math.round(pseudo * 18) + 4));
    }
    return bars;
  }, [audioUrl]);

  useEffect(() => {
    const audio = new Audio(resolvedUrl);
    audioRef.current = audio;

    audio.onloadedmetadata = () => {
      if (audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
        setTotalDuration(Math.round(audio.duration));
      }
    };

    audio.ontimeupdate = () => {
      setCurrentTime(audio.currentTime);
    };

    audio.onended = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    return () => {
      audio.pause();
      audio.src = '';
    };
  }, [resolvedUrl]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.playbackRate = playbackRate;
      audioRef.current.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !totalDuration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const newTime = ratio * totalDuration;
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const toggleSpeed = () => {
    const nextRate: 1 | 1.5 | 2 = playbackRate === 1 ? 1.5 : playbackRate === 1.5 ? 2 : 1;
    setPlaybackRate(nextRate);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextRate;
    }
  };

  const playedRatio = totalDuration > 0 ? currentTime / totalDuration : 0;
  const playedBarIndex = Math.floor(playedRatio * waveBars.length);

  return (
    <div className={`tm-voice-note-bubble ${isMine ? 'outgoing' : 'incoming'}`}>
      <button
        type="button"
        className="tm-voice-play-btn"
        onClick={togglePlay}
        title={isPlaying ? 'Pause' : 'Play voice message'}
      >
        {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" style={{ marginLeft: 2 }} />}
      </button>

      <div className="tm-voice-track-wrap">
        <div className="tm-voice-waveform-container" onClick={handleSeek}>
          {waveBars.map((height, idx) => (
            <div
              key={idx}
              className={`tm-voice-bar ${idx <= playedBarIndex ? 'played' : 'unplayed'}`}
              style={{ height }}
            />
          ))}
        </div>

        <div className="tm-voice-meta-row">
          <span>{isPlaying ? formatAudioDuration(currentTime) : formatAudioDuration(totalDuration)}</span>
          <button type="button" className="tm-voice-speed-btn" onClick={toggleSpeed} title="Playback speed">
            {playbackRate}x
          </button>
        </div>
      </div>
    </div>
  );
}

// Highlight @mentions in text messages
function renderMessageTextWithMentions(text: string) {
  if (!text) return null;
  // Splits and matches @Name or @word
  const parts = text.split(/(@[A-Za-z0-9_\s.-]+?)(?=[,;.!?\s]|$)/g);

  return parts.map((part, index) => {
    if (part.startsWith('@') && part.length > 1) {
      return (
        <span key={index} className="tm-chat-mention-tag">
          {part}
        </span>
      );
    }
    return part;
  });
}

type ConversationMenuPage = 'main' | 'notifications' | 'tags';
type ConversationNotification = 'all' | 'mentions' | 'off';

interface IConversationPreferences {
  favorite?: boolean;
  archived?: boolean;
  removed?: boolean;
  manuallyUnread?: boolean;
  notification?: ConversationNotification;
  notifyCalls?: boolean;
  important?: boolean;
  sensitive?: boolean;
  tags?: string[];
}

const CONVERSATION_PREFERENCES_KEY = 'toowix_conversation_preferences_v1';

function readConversationPreferences(): Record<string, IConversationPreferences> {
  try {
    return JSON.parse(localStorage.getItem(CONVERSATION_PREFERENCES_KEY) || '{}');
  } catch {
    return {};
  }
}

function uniqueConversationMembers(members: IConversationMember[]): IConversationMember[] {
  const seen = new Set<string>();
  return members.filter((member) => {
    const key = (member.email || member.name || '').trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function ConversationsPanel({ isDark, initialConversationId, initialMessageId, initialRoomSlug }: IConversationsPanelProps) {
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<IConversationSummary[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<IConversationSummary | null>(null);
  const [messages, setMessages] = useState<ISavedChatMessage[]>([]);
  const [readReceipts, setReadReceipts] = useState<IChatReadReceipt[]>([]);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [inputText, setInputText] = useState('');
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingImagePreview, setUploadingImagePreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [messagesError, setMessagesError] = useState<string | null>(null);

  const [callOpen, setCallOpen] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showSearchInChat, setShowSearchInChat] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [showInfoDrawer, setShowInfoDrawer] = useState(false);
  const [privacyChoice, setPrivacyChoice] = useState<'Guest' | 'Private'>('Guest');
  const [privacyPassword, setPrivacyPassword] = useState('');
  const [savingPrivacy, setSavingPrivacy] = useState(false);
  const [privacyError, setPrivacyError] = useState<string | null>(null);
  const [showMembersDrawer, setShowMembersDrawer] = useState(false);
  const [conversationMembers, setConversationMembers] = useState<IConversationMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [showConversationMenu, setShowConversationMenu] = useState(false);
  const [conversationMenuPage, setConversationMenuPage] = useState<ConversationMenuPage>('main');
  const [showLeaveDialog, setShowLeaveDialog] = useState(false);
  const [showTagDialog, setShowTagDialog] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [collapsedTagGroups, setCollapsedTagGroups] = useState<Set<string>>(new Set());
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [inviteEmailInput, setInviteEmailInput] = useState('');
  const [inviteNameInput, setInviteNameInput] = useState('');
  const [invitingMembers, setInvitingMembers] = useState(false);
  const [inviteFeedback, setInviteFeedback] = useState<string | null>(null);
  const [nextAdminEmail, setNextAdminEmail] = useState('');
  const [isLeavingConversation, setIsLeavingConversation] = useState(false);
  const [preferences, setPreferences] = useState<Record<string, IConversationPreferences>>(readConversationPreferences);
  const [focusedMessageId, setFocusedMessageId] = useState<string | null>(initialMessageId || null);

  // @ Mentions state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionCursorPos, setMentionCursorPos] = useState<number>(0);
  const [selectedMentionIdx, setSelectedMentionIdx] = useState<number>(0);

  // Voice recording state
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<any>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const conversationMenuRef = useRef<HTMLDivElement>(null);

  const currentUserName = useMemo(() => {
    if (auth.currentUser?.displayName) return auth.currentUser.displayName;
    try {
      const user = JSON.parse(localStorage.getItem('toowix_user') || '{}');
      return user.fullName || user.name || user.email || auth.currentUser?.email || '';
    } catch {
      return auth.currentUser?.email || '';
    }
  }, []);

  const myViewerId = useMemo(() => {
    try {
      const user = JSON.parse(localStorage.getItem('toowix_user') || '{}');
      return user.id || user._id || '';
    } catch {
      return '';
    }
  }, []);

  const isReadByOther = (msg: ISavedChatMessage) =>
    readReceipts.some(
      (r) => r.viewerId !== myViewerId && new Date(r.lastReadAt).getTime() >= new Date(msg.createdAt).getTime()
    );

  const selectedPreferences = selectedConversation ? preferences[selectedConversation.id] || {} : {};
  const updateSelectedPreferences = (change: Partial<IConversationPreferences>) => {
    if (!selectedConversation) return;
    setPreferences((previous) => {
      const next = { ...previous, [selectedConversation.id]: { ...previous[selectedConversation.id], ...change } };
      localStorage.setItem(CONVERSATION_PREFERENCES_KEY, JSON.stringify(next));
      return next;
    });
  };

  const closeConversationMenu = () => {
    setShowConversationMenu(false);
    setConversationMenuPage('main');
  };

  const copyConversationLink = async () => {
    if (!selectedConversation) return;
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/meet/${encodeURIComponent(selectedConversation.roomSlug)}?fromConversation=1`
      );
    } catch {
      // Best-effort
    }
    closeConversationMenu();
  };

  const loadMembers = async (roomSlug: string) => {
    setLoadingMembers(true);
    try {
      const members = await fetchRoomConversationMembers(roomSlug);
      setConversationMembers(uniqueConversationMembers(members));
    } catch {
      setConversationMembers([]);
    } finally {
      setLoadingMembers(false);
    }
  };

  const openMembers = async () => {
    if (!selectedConversation) return;
    closeConversationMenu();
    setShowMembersDrawer(true);
    await loadMembers(selectedConversation.roomSlug);
  };

  // Collapse sidebar when call is active
  useEffect(() => {
    document.body.classList.toggle('conversations-call-active', callOpen);
    return () => {
      document.body.classList.remove('conversations-call-active');
    };
  }, [callOpen]);

  useEffect(() => {
    if (!showConversationMenu) return;
    const closeOnOutside = (event: MouseEvent) => {
      if (conversationMenuRef.current && !conversationMenuRef.current.contains(event.target as Node)) {
        closeConversationMenu();
      }
    };
    document.addEventListener('mousedown', closeOnOutside);
    return () => document.removeEventListener('mousedown', closeOnOutside);
  }, [showConversationMenu]);

  // Fetch all conversations from backend
  useEffect(() => {
    let isMounted = true;
    setLoadingConversations(true);
    setError(null);

    fetchConversations()
      .then((items) => {
        if (!isMounted) return;
        setConversations(items || []);
        if (items && items.length > 0 && !selectedConversation) {
          setSelectedConversation(
            items.find((item) => item.id === initialConversationId)
            || items.find((item) => item.roomSlug === initialRoomSlug)
            || items[0]
          );
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : 'Failed to load conversations');
      })
      .finally(() => {
        if (isMounted) setLoadingConversations(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  // Fetch messages and members whenever selected conversation changes
  useEffect(() => {
    if (!selectedConversation?.roomSlug) {
      setMessages([]);
      setConversationMembers([]);
      return;
    }

    let isMounted = true;
    setLoadingMessages(true);
    setMessagesError(null);

    fetchChatHistory(selectedConversation.roomSlug)
      .then((history) => {
        if (!isMounted) return;
        setMessages(history.messages || []);
        setReadReceipts(history.readReceipts || []);
        void markChatRead(selectedConversation.roomSlug);
      })
      .catch((err) => {
        if (!isMounted) return;
        setMessagesError(err instanceof Error ? err.message : 'Failed to load conversation history');
      })
      .finally(() => {
        if (isMounted) setLoadingMessages(false);
      });

    // Load members for @ mentions
    fetchRoomConversationMembers(selectedConversation.roomSlug).then((members) => {
      if (isMounted) setConversationMembers(uniqueConversationMembers(members));
    });

    return () => {
      isMounted = false;
    };
  }, [selectedConversation?.roomSlug]);

  useEffect(() => {
    if (!initialMessageId || !messages.some((message) => message.id === initialMessageId)) return;
    setFocusedMessageId(initialMessageId);
    const timer = window.setTimeout(() => {
      document
        .getElementById(`conversation-message-${initialMessageId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
    const clearTimer = window.setTimeout(() => setFocusedMessageId(null), 2800);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(clearTimer);
    };
  }, [initialMessageId, messages]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (!callOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loadingMessages, callOpen]);

  const filteredConversations = useMemo(() => {
    return conversations.filter((c) => {
      if (preferences[c.id]?.archived || preferences[c.id]?.removed) return false;
      const matchesSearch =
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.roomSlug.toLowerCase().includes(searchQuery.toLowerCase());
      if (filter === 'unread') {
        return matchesSearch && c.unreadCount > 0;
      }
      return matchesSearch;
    });
  }, [conversations, searchQuery, filter, preferences]);

  const conversationGroups = useMemo(() => {
    const tags = [...new Set(filteredConversations.flatMap((conversation) => preferences[conversation.id]?.tags || []))];
    const groups = tags.map((tag) => ({
      label: tag,
      conversations: filteredConversations.filter((conversation) =>
        preferences[conversation.id]?.tags?.includes(tag)
      ),
    }));
    const untagged = filteredConversations.filter(
      (conversation) => !(preferences[conversation.id]?.tags || []).length
    );
    if (untagged.length) groups.push({ label: 'Other', conversations: untagged });
    return groups;
  }, [filteredConversations, preferences]);

  const handleSelectConversation = (conv: IConversationSummary) => {
    setSelectedConversation(conv);
    setCallOpen(false);
    setShowSearchInChat(false);
    setChatSearchQuery('');
    setShowInfoDrawer(false);
    setShowMembersDrawer(false);
    closeConversationMenu();
    setMentionQuery(null);

    setConversations((prev) => prev.map((c) => (c.id === conv.id ? { ...c, unreadCount: 0 } : c)));
    if (preferences[conv.id]?.manuallyUnread) {
      setPreferences((previous) => {
        const next = { ...previous, [conv.id]: { ...previous[conv.id], manuallyUnread: false } };
        localStorage.setItem(CONVERSATION_PREFERENCES_KEY, JSON.stringify(next));
        return next;
      });
    }
  };

  // A conversation used to mount the meeting in an iframe (setCallOpen(true)) and then, if you
  // clicked "Full screen", ALSO navigate the whole tab into the same room -- both Jitsi clients
  // joined under the same account, briefly showing a second participant tile named after the
  // local user (the duplicate-participant bug). Route directly into the full-screen meeting
  // instead: one click now creates exactly one conference connection, in this same tab, with the
  // chat panel opened and this conversation's history preloaded (see the isFromConversation
  // effect in MeetingRoomPage.tsx).
  const handleStartConversationCall = () => {
    if (!selectedConversation?.roomSlug) return;
    navigate(`/meet/${encodeURIComponent(selectedConversation.roomSlug)}?fromConversation=1`);
  };

  // Reset the privacy form to match the conversation's actual current state whenever the info
  // drawer is (re)opened -- the existing password itself is never sent to the client, so this
  // only pre-selects Public/Private, never pre-fills a password field.
  useEffect(() => {
    if (!showInfoDrawer || !selectedConversation) return;
    setPrivacyChoice(selectedConversation.type === 'Private' ? 'Private' : 'Guest');
    setPrivacyPassword('');
    setPrivacyError(null);
  }, [showInfoDrawer, selectedConversation?.id, selectedConversation?.type]);

  const saveMeetingPrivacy = async () => {
    if (!selectedConversation) return;
    if (privacyChoice === 'Private' && !privacyPassword.trim()) {
      setPrivacyError('Enter a password to make this meeting private.');
      return;
    }
    setSavingPrivacy(true);
    setPrivacyError(null);
    try {
      await updateMeetingPrivacy(selectedConversation.id, privacyChoice, privacyPassword.trim());
      setSelectedConversation((prev) => (prev ? { ...prev, type: privacyChoice } : prev));
      setConversations((prev) => prev.map((c) => (c.id === selectedConversation.id ? { ...c, type: privacyChoice } : c)));
      setPrivacyPassword('');
    } catch (err) {
      setPrivacyError(err instanceof Error ? err.message : 'Failed to update meeting privacy');
    } finally {
      setSavingPrivacy(false);
    }
  };

  const beginLeaveConversation = async () => {
    if (!selectedConversation) return;
    closeConversationMenu();
    setShowLeaveDialog(true);
    setNextAdminEmail('');
    await loadMembers(selectedConversation.roomSlug);
  };

  const confirmLeaveConversation = async () => {
    if (!selectedConversation || !nextAdminEmail) return;
    setIsLeavingConversation(true);
    try {
      await leaveConversation(selectedConversation.id, nextAdminEmail);
      updateSelectedPreferences({ removed: true });
      setShowLeaveDialog(false);
      setSelectedConversation(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not leave this conversation');
    } finally {
      setIsLeavingConversation(false);
    }
  };

  const createTag = () => {
    const tag = newTagName.trim();
    if (!tag) return;
    updateSelectedPreferences({ tags: [...new Set([...(selectedPreferences.tags || []), tag])] });
    setNewTagName('');
    setShowTagDialog(false);
  };

  // Invite member by email using template E11_CONVERSATION_INVITE
  const handleInviteMemberSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedConversation) return;
    const email = inviteEmailInput.trim().toLowerCase();
    const name = inviteNameInput.trim();

    if (!email || !email.includes('@')) {
      alert('Please enter a valid email address');
      return;
    }

    setInvitingMembers(true);
    setInviteFeedback(null);
    try {
      const res = await inviteConversationMember(selectedConversation.roomSlug, email, name);
      setInviteFeedback(res.message || `Invitation sent to ${email}`);
      setConversationMembers((prev) =>
        uniqueConversationMembers([
          ...prev,
          { email, name: name || email.split('@')[0], role: 'Participant' },
        ])
      );
      setInviteEmailInput('');
      setInviteNameInput('');
      setTimeout(() => {
        setShowInviteDialog(false);
        setInviteFeedback(null);
      }, 1500);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not send the invitation');
    } finally {
      setInvitingMembers(false);
    }
  };

  // ---------------------------------------------------------------------------
  // @ Mentions Handling
  // ---------------------------------------------------------------------------
  const filteredMentionMembers = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase().trim();
    if (!q) return conversationMembers.slice(0, 8);
    return conversationMembers
      .filter((m) => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q))
      .slice(0, 8);
  }, [mentionQuery, conversationMembers]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    const pos = e.target.selectionStart || 0;
    setInputText(val);

    // Look for @ before cursor
    const textBeforeCursor = val.slice(0, pos);
    const lastAtIdx = textBeforeCursor.lastIndexOf('@');

    if (lastAtIdx !== -1 && (lastAtIdx === 0 || /\s/.test(textBeforeCursor[lastAtIdx - 1]))) {
      const query = textBeforeCursor.slice(lastAtIdx + 1);
      if (!/\s/.test(query) && query.length <= 30) {
        setMentionQuery(query);
        setMentionCursorPos(lastAtIdx);
        setSelectedMentionIdx(0);
        return;
      }
    }

    setMentionQuery(null);
  };

  const handleSelectMention = (member: IConversationMember) => {
    const memberName = member.name.replace(/\s+/g, '_');
    const before = inputText.slice(0, mentionCursorPos);
    const after = inputText.slice(
      mentionCursorPos + 1 + (mentionQuery ? mentionQuery.length : 0)
    );
    const nextVal = `${before}@${memberName} ${after}`;
    setInputText(nextVal);
    setMentionQuery(null);

    setTimeout(() => {
      chatInputRef.current?.focus();
      const newPos = before.length + memberName.length + 2;
      chatInputRef.current?.setSelectionRange(newPos, newPos);
    }, 20);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (mentionQuery !== null && filteredMentionMembers.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedMentionIdx((prev) => (prev + 1) % filteredMentionMembers.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedMentionIdx(
          (prev) => (prev - 1 + filteredMentionMembers.length) % filteredMentionMembers.length
        );
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        handleSelectMention(filteredMentionMembers[selectedMentionIdx]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Voice Recording (WhatsApp style)
  // ---------------------------------------------------------------------------
  const startVoiceRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
        ? 'audio/ogg;codecs=opus'
        : 'audio/webm';

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.start(100);
      setIsRecordingAudio(true);
      setRecordingSeconds(0);

      recordTimerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      alert('Could not access microphone for voice recording.');
    }
  };

  const cancelVoiceRecording = () => {
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((t) => t.stop());
      audioStreamRef.current = null;
    }
    setIsRecordingAudio(false);
    setRecordingSeconds(0);
    audioChunksRef.current = [];
  };

  const sendVoiceRecording = async () => {
    if (!selectedConversation || !mediaRecorderRef.current) return;
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);

    const finalDuration = recordingSeconds || 1;
    const recorder = mediaRecorderRef.current;

    recorder.onstop = async () => {
      const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach((t) => t.stop());
        audioStreamRef.current = null;
      }
      setIsRecordingAudio(false);
      setRecordingSeconds(0);

      const localBlobUrl = URL.createObjectURL(blob);
      const optimisticMessage: ISavedChatMessage = {
        id: `msg-${Date.now()}`,
        senderName: currentUserName || 'You',
        senderId: auth.currentUser?.uid || null,
        audioUrl: localBlobUrl,
        audioDuration: finalDuration,
        createdAt: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, optimisticMessage]);

      try {
        const uploadedUrl = await uploadChatAudio(selectedConversation.roomSlug, blob);
        await persistChatMessage(selectedConversation.roomSlug, {
          senderName: currentUserName || 'You',
          senderId: auth.currentUser?.uid,
          audioUrl: uploadedUrl,
          audioDuration: finalDuration,
        });
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Failed to send voice message');
      }
    };

    if (recorder.state !== 'inactive') {
      recorder.stop();
    }
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = inputText.trim();
    if (!text || !selectedConversation) return;

    // Extract mentions
    const mentionMatches = text.match(/@([A-Za-z0-9_\s.-]+?)(?=[,;.!?\s]|$)/g) || [];
    const mentions = mentionMatches.map((m) => m.replace('@', '').trim()).filter(Boolean);

    const optimisticId = `msg-${Date.now()}`;
    const optimisticMessage: ISavedChatMessage = {
      id: optimisticId,
      senderName: currentUserName || 'You',
      senderId: auth.currentUser?.uid || null,
      text,
      mentions,
      createdAt: new Date().toISOString(),
    };

    // Optimistically update message stream
    setMessages((prev) => [...prev, optimisticMessage]);
    setInputText('');
    setMentionQuery(null);
    setShowEmojiPicker(false);
    setShowAttachMenu(false);

    // Update conversation snippet in sidebar
    setConversations((prev) =>
      prev.map((c) =>
        c.id === selectedConversation.id
          ? {
              ...c,
              messageCount: (c.messageCount || 0) + 1,
              lastMessageAt: optimisticMessage.createdAt,
            }
          : c
      )
    );

    try {
      await persistChatMessage(selectedConversation.roomSlug, {
        senderName: currentUserName || 'You',
        senderId: auth.currentUser?.uid,
        text,
        mentions,
      });
    } catch {
      // Best-effort error tolerance
    }

    setTimeout(() => {
      chatInputRef.current?.focus();
    }, 50);
  };

  const handleInsertEmoji = (emoji: string) => {
    setInputText((prev) => prev + emoji);
    setShowEmojiPicker(false);
    chatInputRef.current?.focus();
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedConversation) return;

    // Show the actual picture being sent immediately via a local blob URL, rather than a bare
    // spinner, while the upload round-trip (and the real hosted URL) is still in flight.
    const localPreviewUrl = URL.createObjectURL(file);
    setUploadingImagePreview(localPreviewUrl);
    setUploadingImage(true);
    setShowAttachMenu(false);

    try {
      const uploadedUrl = await uploadChatImage(selectedConversation.roomSlug, file);
      const optimisticMessage: ISavedChatMessage = {
        id: `msg-${Date.now()}`,
        senderName: currentUserName || 'You',
        senderId: auth.currentUser?.uid || null,
        imageUrl: uploadedUrl,
        createdAt: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, optimisticMessage]);

      setConversations((prev) =>
        prev.map((c) =>
          c.id === selectedConversation.id
            ? {
                ...c,
                messageCount: (c.messageCount || 0) + 1,
                lastMessageAt: optimisticMessage.createdAt,
              }
            : c
        )
      );

      await persistChatMessage(selectedConversation.roomSlug, {
        senderName: currentUserName || 'You',
        senderId: auth.currentUser?.uid,
        imageUrl: uploadedUrl,
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to upload image');
    } finally {
      setUploadingImage(false);
      URL.revokeObjectURL(localPreviewUrl);
      setUploadingImagePreview(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const displayedMessages = useMemo(() => {
    if (!chatSearchQuery.trim()) return messages;
    return messages.filter(
      (m) =>
        (m.text || '').toLowerCase().includes(chatSearchQuery.toLowerCase()) ||
        (m.senderName || '').toLowerCase().includes(chatSearchQuery.toLowerCase())
    );
  }, [messages, chatSearchQuery]);

  return (
    <div className="tm-conversations-container">
      {/* Hidden file input for uploading images/attachments */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleImageUpload}
        accept="image/*"
        style={{ display: 'none' }}
      />

      {/* =========================================================================
          LEFT PANEL: Conversations List & Search
          ========================================================================= */}
      <aside className={`tm-conversations-sidebar ${selectedConversation ? 'has-selected' : ''}`}>
        {/* Header Title */}
        <div className="tm-conversations-sidebar-header">
          <h1 className="tm-conversations-title">Conversations</h1>
          <p className="tm-conversations-subtitle">Chats from your meetings.</p>

          {/* Search Box */}
          <div className="tm-conversations-search-box">
            <Search size={16} className="tm-conversations-search-icon" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search conversations..."
              className="tm-conversations-search-input"
            />
          </div>

          {/* Filter Pills */}
          <div className="tm-conversations-filter-pills">
            <button
              type="button"
              className={`tm-filter-pill ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
            >
              All
            </button>
            <button
              type="button"
              className={`tm-filter-pill ${filter === 'unread' ? 'active' : ''}`}
              onClick={() => setFilter('unread')}
            >
              Unread
            </button>
          </div>
        </div>

        {/* Conversation List Items */}
        <div className="tm-conversations-items-list">
          {loadingConversations ? (
            <div
              className="tm-conversations-empty-list"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              <Loader2 size={16} className="animate-spin" /> Loading conversations...
            </div>
          ) : error ? (
            <div className="tm-conversations-empty-list" style={{ color: '#EF4444' }}>
              {error}
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="tm-conversations-empty-list">No conversations found.</div>
          ) : (
            conversationGroups.map((group) => (
              <section className="tm-conversation-group" key={group.label}>
                <button
                  type="button"
                  className="tm-conversation-group-title"
                  onClick={() =>
                    setCollapsedTagGroups((previous) => {
                      const next = new Set(previous);
                      if (next.has(group.label)) next.delete(group.label);
                      else next.add(group.label);
                      return next;
                    })
                  }
                >
                  <span>{group.label}</span>
                  <ChevronDown
                    size={14}
                    className={collapsedTagGroups.has(group.label) ? 'is-collapsed' : ''}
                  />
                </button>
                {!collapsedTagGroups.has(group.label) &&
                  group.conversations.map((conv) => {
                    const isSelected = selectedConversation?.id === conv.id;
                    const convBg = getColorForString(conv.name || conv.id);

                    return (
                      <div
                        key={conv.id}
                        className={`tm-conversation-row ${isSelected ? 'is-selected' : ''}`}
                        onClick={() => handleSelectConversation(conv)}
                        role="button"
                        tabIndex={0}
                      >
                        <div className="tm-conv-icon-box" style={{ backgroundColor: convBg }}>
                          <MessageSquare size={18} color="#FFFFFF" />
                        </div>

                        <div className="tm-conv-info">
                          <div className="tm-conv-title-row">
                            <span className="tm-conv-name">{conv.name}</span>
                          </div>
                          <div className="tm-conv-preview-row">
                            <span className="tm-conv-preview">
                              {conv.messageCount > 0
                                ? `${conv.messageCount} message${conv.messageCount === 1 ? '' : 's'}`
                                : 'No messages yet'}
                            </span>
                            {preferences[conv.id]?.favorite && (
                              <Star size={13} className="tm-conv-favorite" fill="currentColor" />
                            )}
                            {(conv.unreadCount > 0 || preferences[conv.id]?.manuallyUnread) && (
                              <span className="tm-conv-badge">{conv.unreadCount || '•'}</span>
                            )}
                          </div>
                        </div>
                        <div className="tm-conv-row-actions" onClick={(event) => event.stopPropagation()}>
                          <div
                            className="tm-conversation-menu-wrap"
                            ref={
                              showConversationMenu && selectedConversation?.id === conv.id
                                ? conversationMenuRef
                                : undefined
                            }
                          >
                            <button
                              type="button"
                              className={`tm-conv-more-button ${
                                showConversationMenu && selectedConversation?.id === conv.id ? 'active' : ''
                              }`}
                              onClick={() => {
                                handleSelectConversation(conv);
                                setConversationMenuPage('main');
                                setShowConversationMenu(true);
                              }}
                              title={`Actions for ${conv.name}`}
                              aria-label={`Actions for ${conv.name}`}
                            >
                              <MoreHorizontal size={18} />
                            </button>
                            {showConversationMenu &&
                              selectedConversation?.id === conv.id &&
                              renderConversationMenu()}
                          </div>
                          <span className="tm-conv-time">{formatConversationTime(conv.lastMessageAt)}</span>
                        </div>
                      </div>
                    );
                  })}
              </section>
            ))
          )}
        </div>
      </aside>

      {/* =========================================================================
          RIGHT PANEL: Active Conversation Detail & Chat Stream / Call View
          ========================================================================= */}
      <main className="tm-chat-main">
        {selectedConversation ? (
          <>
            {/* Top Chat Header - Shown only in chat mode */}
            {!callOpen && (
              <header className="tm-chat-header">
                <div className="tm-chat-header-left">
                  <button
                    type="button"
                    className="tm-chat-mobile-back"
                    onClick={() => setSelectedConversation(null)}
                    title="Back to conversations"
                  >
                    <ArrowLeft size={18} />
                  </button>

                  <div
                    className="tm-conv-icon-box header-icon"
                    style={{
                      backgroundColor: getColorForString(
                        selectedConversation.name || selectedConversation.id
                      ),
                    }}
                  >
                    <MessageSquare size={20} color="#FFFFFF" />
                  </div>

                  <div className="tm-chat-header-titles">
                    <h2 className="tm-chat-header-name">{selectedConversation.name}</h2>
                    <p className="tm-chat-header-sub">
                      {`${conversationMembers.length || selectedConversation.participantCount || 1} participant${
                        (conversationMembers.length || selectedConversation.participantCount || 1) === 1
                          ? ''
                          : 's'
                      } • Meeting ${selectedConversation.status?.toLowerCase() || 'ended'}`}
                    </p>
                  </div>
                </div>

                {/* Header Right Action Buttons */}
                <div className="tm-chat-header-actions">
                  {/* Call Button beside Search */}
                  <button
                    type="button"
                    className="tm-chat-action-btn"
                    onClick={handleStartConversationCall}
                    title="Start / Join video call"
                  >
                    <Video size={16} />
                  </button>
                  <button
                    type="button"
                    className={`tm-chat-action-btn ${showSearchInChat ? 'active' : ''}`}
                    onClick={() => {
                      setShowSearchInChat((prev) => !prev);
                      setShowMembersDrawer(false);
                      closeConversationMenu();
                    }}
                    title="Search in conversation"
                  >
                    <Search size={16} />
                  </button>
                  <button
                    type="button"
                    className="tm-chat-action-btn"
                    onClick={() => {
                      setInviteEmailInput('');
                      setInviteNameInput('');
                      setInviteFeedback(null);
                      setShowInviteDialog(true);
                    }}
                    title="Add member (send invitation email)"
                  >
                    <UserPlus size={16} />
                  </button>
                  <button
                    type="button"
                    className={`tm-chat-action-btn ${showMembersDrawer ? 'active' : ''}`}
                    onClick={() => void openMembers()}
                    title="Conversation members"
                  >
                    <Users size={17} />
                  </button>
                  <button
                    type="button"
                    className={`tm-chat-action-btn ${showInfoDrawer ? 'active' : ''}`}
                    onClick={() => setShowInfoDrawer((prev) => !prev)}
                    title="Conversation information"
                  >
                    <Info size={16} />
                  </button>
                  <div className="tm-conversation-menu-wrap tm-header-conversation-menu-wrap">
                    <button
                      type="button"
                      className={`tm-chat-action-btn ${showConversationMenu ? 'active' : ''}`}
                      onClick={() => {
                        setShowConversationMenu((open) => !open);
                        setConversationMenuPage('main');
                        setShowMembersDrawer(false);
                      }}
                      title="Conversation actions"
                    >
                      <MoreHorizontal size={18} />
                    </button>
                    {showConversationMenu && renderConversationMenu()}
                  </div>
                </div>
              </header>
            )}

            {/* In-Chat Search Bar */}
            {!callOpen && showSearchInChat && (
              <div className="tm-chat-search-bar tm-chat-search-bar-enter">
                <Search size={15} color="#94A3B8" />
                <input
                  type="text"
                  value={chatSearchQuery}
                  onChange={(e) => setChatSearchQuery(e.target.value)}
                  placeholder="Search messages in this conversation..."
                  autoFocus
                />
                {chatSearchQuery && (
                  <button type="button" onClick={() => setChatSearchQuery('')}>
                    <X size={14} />
                  </button>
                )}
              </div>
            )}

            {/* Embedded Call View OR Message Stream */}
            {callOpen ? (
              <div className="tm-call-view-container">
                <div className="tm-call-status-bar">
                  <div className="tm-call-status-left">
                    <span className="tm-call-live-dot" />
                    <span className="tm-call-status-title">{selectedConversation.name}</span>
                  </div>
                  <div className="tm-call-status-actions">
                    <button
                      type="button"
                      onClick={() => navigate(`/meet/${encodeURIComponent(selectedConversation.roomSlug)}?fromConversation=1`)}
                      className="tm-open-tab-btn"
                      title="Go full screen"
                    >
                      <Maximize size={14} /> Full screen
                    </button>
                    <button
                      type="button"
                      onClick={() => setCallOpen(false)}
                      className="tm-return-chat-btn"
                      title="Return to chat"
                    >
                      <MessageSquare size={14} /> Return to chat
                    </button>
                  </div>
                </div>
                <iframe
                  title={`${selectedConversation.name} meeting`}
                  src={`/meet/${encodeURIComponent(selectedConversation.roomSlug)}?fromConversation=1`}
                  allow="camera; microphone; fullscreen; display-capture; autoplay"
                  className="tm-call-iframe"
                />
              </div>
            ) : (
              <>
                {/* Main Chat Messages Stream */}
                <div className="tm-chat-stream">
                  {loadingMessages ? (
                    <div className="tm-chat-empty-view">
                      <Loader2 size={24} className="animate-spin" color="#4F46E5" />
                      <p>Loading messages...</p>
                    </div>
                  ) : messagesError ? (
                    <div className="tm-chat-empty-view">
                      <p style={{ color: '#EF4444' }}>{messagesError}</p>
                    </div>
                  ) : displayedMessages.length === 0 ? (
                    <div className="tm-chat-empty-view">
                      <MessageSquare size={36} color="#4F46E5" />
                      <p>No messages in this conversation yet. Send a message to get started.</p>
                    </div>
                  ) : (
                    displayedMessages.map((msg, index) => {
                      const isMine =
                        Boolean(currentUserName) &&
                        msg.senderName?.trim().toLowerCase() === currentUserName.trim().toLowerCase();

                      const previous = displayedMessages[index - 1];
                      const showDate =
                        !previous || getDayLabel(previous.createdAt) !== getDayLabel(msg.createdAt);

                      const avatarBg = getColorForString(msg.senderName || 'User');

                      return (
                        <React.Fragment key={msg.id || index}>
                          {/* Date Separator */}
                          {showDate && (
                            <div className="tm-date-divider">
                              <div className="tm-date-divider-line" />
                              <span className="tm-date-divider-label">{getDayLabel(msg.createdAt)}</span>
                              <div className="tm-date-divider-line" />
                            </div>
                          )}

                          {isMine ? (
                            /* Outgoing Message (Me) */
                            <div
                              id={`conversation-message-${msg.id}`}
                              className={`tm-msg-row outgoing ${
                                focusedMessageId === msg.id ? 'tm-message-focused' : ''
                              }`}
                            >
                              {/* Voice Message */}
                              {msg.audioUrl && (
                                <div className="tm-outgoing-bubble-wrap">
                                  <span className="tm-msg-time-outer">
                                    {formatMessageTime(msg.createdAt)}
                                    <CheckCheck
                                      size={13}
                                      className={isReadByOther(msg) ? 'tm-check-read' : 'tm-check-sent'}
                                      style={{ marginLeft: 4, verticalAlign: 'middle' }}
                                    />
                                  </span>
                                  <VoiceNotePlayer
                                    audioUrl={msg.audioUrl}
                                    duration={msg.audioDuration}
                                    isMine={true}
                                  />
                                </div>
                              )}

                              {/* Text Message */}
                              {msg.text && (
                                <div className="tm-outgoing-bubble-wrap">
                                  <span className="tm-msg-time-outer">
                                    {formatMessageTime(msg.createdAt)}
                                    <CheckCheck
                                      size={13}
                                      className={isReadByOther(msg) ? 'tm-check-read' : 'tm-check-sent'}
                                      style={{ marginLeft: 4, verticalAlign: 'middle' }}
                                    />
                                  </span>
                                  <div className="tm-bubble-outgoing">
                                    {renderMessageTextWithMentions(msg.text)}
                                  </div>
                                </div>
                              )}

                              {/* Image Message */}
                              {msg.imageUrl && (
                                <div className="tm-outgoing-attachment-wrap">
                                  <div className="tm-image-bubble">
                                    <img
                                      src={resolveChatImageUrl(msg.imageUrl)}
                                      alt="Attachment"
                                      style={{ cursor: 'pointer' }}
                                      onClick={() => setLightboxImage(resolveChatImageUrl(msg.imageUrl!))}
                                    />
                                    <a
                                      href={resolveChatImageUrl(msg.imageUrl)}
                                      download
                                      className="tm-image-download-btn"
                                      title="Download image"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <Download size={14} />
                                    </a>
                                  </div>
                                  <div className="tm-msg-status-time">
                                    <span>{formatMessageTime(msg.createdAt)}</span>
                                    <CheckCheck
                                      size={14}
                                      className={isReadByOther(msg) ? 'tm-check-read' : 'tm-check-sent'}
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : (
                            /* Incoming Message */
                            <div
                              id={`conversation-message-${msg.id}`}
                              className={`tm-msg-row incoming ${
                                focusedMessageId === msg.id ? 'tm-message-focused' : ''
                              }`}
                            >
                              <div className="tm-msg-avatar" style={{ backgroundColor: avatarBg }}>
                                {initialsOf(msg.senderName)}
                              </div>

                              <div className="tm-msg-body">
                                <div className="tm-msg-sender-meta">
                                  <span className="tm-msg-sender-name">{msg.senderName}</span>
                                  <span className="tm-msg-sender-time">
                                    {formatMessageTime(msg.createdAt)}
                                  </span>
                                </div>

                                {/* Voice Message */}
                                {msg.audioUrl && (
                                  <VoiceNotePlayer
                                    audioUrl={msg.audioUrl}
                                    duration={msg.audioDuration}
                                    isMine={false}
                                  />
                                )}

                                {/* Text Message */}
                                {msg.text && (
                                  <div className="tm-bubble-incoming">
                                    {renderMessageTextWithMentions(msg.text)}
                                  </div>
                                )}

                                {/* Image Message */}
                                {msg.imageUrl && (
                                  <div className="tm-image-bubble">
                                    <img
                                      src={resolveChatImageUrl(msg.imageUrl)}
                                      alt="Attachment"
                                      style={{ cursor: 'pointer' }}
                                      onClick={() => setLightboxImage(resolveChatImageUrl(msg.imageUrl!))}
                                    />
                                    <a
                                      href={resolveChatImageUrl(msg.imageUrl)}
                                      download
                                      className="tm-image-download-btn"
                                      title="Download image"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <Download size={14} />
                                    </a>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}

                  {uploadingImage && (
                    <div className="tm-msg-row outgoing">
                      <div className="tm-outgoing-attachment-wrap">
                        <span className="tm-msg-time-outer">Sending...</span>
                        {uploadingImagePreview ? (
                          <div className="tm-image-bubble" style={{ opacity: 0.7 }}>
                            <img src={uploadingImagePreview} alt="Sending" />
                            <div className="tm-image-uploading-spinner">
                              <Loader2 size={22} className="animate-spin" color="#FFFFFF" />
                            </div>
                          </div>
                        ) : (
                          <div className="tm-bubble-outgoing" style={{ opacity: 0.8 }}>
                            <Loader2 size={16} className="animate-spin" />
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>

                {/* Bottom Chat Input Bar */}
                <footer className="tm-chat-input-bar" style={{ position: 'relative' }}>
                  {/* Floating @ Mentions Dropdown Popup */}
                  {mentionQuery !== null && filteredMentionMembers.length > 0 && (
                    <div className="tm-mention-popup" role="listbox">
                      <div className="tm-mention-popup-header">Mention Member (@)</div>
                      {filteredMentionMembers.map((member, idx) => (
                        <button
                          key={`${member.email}-${idx}`}
                          type="button"
                          className={`tm-mention-item ${idx === selectedMentionIdx ? 'active' : ''}`}
                          onClick={() => handleSelectMention(member)}
                        >
                          <div
                            className="tm-mention-avatar"
                            style={{
                              backgroundColor: getColorForString(member.email || member.name),
                            }}
                          >
                            {initialsOf(member.name)}
                          </div>
                          <div className="tm-mention-info">
                            <span className="tm-mention-name">{member.name}</span>
                            <span className="tm-mention-email">{member.email || 'Participant'}</span>
                          </div>
                          {member.role && <span className="tm-mention-role">{member.role}</span>}
                        </button>
                      ))}
                    </div>
                  )}

                  {isRecordingAudio ? (
                    /* Active Voice Recorder Bar (WhatsApp style) */
                    <div className="tm-voice-recorder-bar">
                      <div className="tm-voice-record-pulse" />
                      <span className="tm-voice-record-timer">
                        {formatAudioDuration(recordingSeconds)}
                      </span>
                      <div className="tm-voice-wave-anim">
                        <div className="tm-voice-wave-bar" />
                        <div className="tm-voice-wave-bar" />
                        <div className="tm-voice-wave-bar" />
                        <div className="tm-voice-wave-bar" />
                        <div className="tm-voice-wave-bar" />
                        <div className="tm-voice-wave-bar" />
                        <div className="tm-voice-wave-bar" />
                        <div className="tm-voice-wave-bar" />
                        <div className="tm-voice-wave-bar" />
                        <div className="tm-voice-wave-bar" />
                      </div>
                      <button
                        type="button"
                        className="tm-voice-cancel-btn"
                        onClick={cancelVoiceRecording}
                        title="Cancel voice message"
                      >
                        <Trash2 size={14} /> Cancel
                      </button>
                      <button
                        type="button"
                        className="tm-voice-send-btn"
                        onClick={sendVoiceRecording}
                        title="Send voice message"
                      >
                        <Send size={16} />
                      </button>
                    </div>
                  ) : (
                    /* Normal Chat Input Controls */
                    <>
                      {/* Plus / Attach Button */}
                      <div className="tm-attach-btn-wrap">
                        <button
                          type="button"
                          className="tm-chat-icon-btn"
                          onClick={() => setShowAttachMenu((prev) => !prev)}
                          title="Attach file"
                        >
                          <Paperclip size={18} />
                        </button>

                        {/* Attach Popup Menu */}
                        {showAttachMenu && (
                          <div className="tm-attach-popup">
                            <button
                              type="button"
                              onClick={() => {
                                fileInputRef.current?.click();
                                setShowAttachMenu(false);
                              }}
                            >
                              <Paperclip size={15} /> Upload Image (max 3MB)
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Emoji Button */}
                      <div className="tm-emoji-btn-wrap">
                        <button
                          type="button"
                          className="tm-chat-icon-btn"
                          onClick={() => setShowEmojiPicker((prev) => !prev)}
                          title="Add emoji"
                        >
                          <Smile size={18} />
                        </button>

                        {/* Emoji Picker Popup */}
                        {showEmojiPicker && (
                          <div className="tm-emoji-popup">
                            <div className="tm-emoji-grid">
                              {EMOJI_LIST.map((emoji) => (
                                <button
                                  key={emoji}
                                  type="button"
                                  className="tm-emoji-item"
                                  onClick={() => handleInsertEmoji(emoji)}
                                >
                                  {emoji}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Message Input Box */}
                      <form className="tm-chat-form" onSubmit={handleSendMessage}>
                        <input
                          ref={chatInputRef}
                          type="text"
                          value={inputText}
                          onChange={handleInputChange}
                          onKeyDown={handleInputKeyDown}
                          placeholder="Write a message... (type @ to mention)"
                          className="tm-chat-text-input"
                        />
                        <button
                          type="submit"
                          className="tm-chat-send-btn"
                          title="Send message"
                          disabled={!inputText.trim()}
                        >
                          <Send size={16} />
                        </button>
                      </form>

                      {/* Voice Note Record Button */}
                      <button
                        type="button"
                        className="tm-chat-mic-btn"
                        onClick={startVoiceRecording}
                        title="Record voice message"
                      >
                        <Mic size={19} />
                      </button>
                    </>
                  )}
                </footer>
              </>
            )}
          </>
        ) : (
          <div className="tm-chat-empty-view">
            <MessageSquare size={48} color="#4F46E5" />
            <h3>Select a conversation</h3>
            <p>Choose a meeting chat from the left to view messages.</p>
          </div>
        )}

        {/* Info Drawer */}
        {showInfoDrawer && selectedConversation && (
          <div className="tm-info-drawer">
            <div className="tm-info-drawer-header">
              <h3>Meeting Information</h3>
              <button type="button" onClick={() => setShowInfoDrawer(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="tm-info-drawer-content">
              <div className="tm-info-item">
                <label>Meeting Title</label>
                <span>{selectedConversation.name}</span>
              </div>
              <div className="tm-info-item">
                <label>Room Slug</label>
                <span style={{ fontSize: 12, color: '#94A3B8' }}>{selectedConversation.roomSlug}</span>
              </div>
              <div className="tm-info-item">
                <label>Participants</label>
                <span>
                  {conversationMembers.length || selectedConversation.participantCount || 1} participant(s)
                </span>
              </div>
              <div className="tm-info-item">
                <label>Status</label>
                <span className="tm-info-status-pill">{selectedConversation.status || 'Ended'}</span>
              </div>
              <div className="tm-info-item">
                <label>Meeting privacy</label>
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <button
                    type="button"
                    onClick={() => { setPrivacyChoice('Guest'); setPrivacyError(null); }}
                    style={{
                      flex: 1,
                      padding: '8px 10px',
                      borderRadius: 8,
                      border: privacyChoice === 'Guest' ? '1px solid #6366F1' : '1px solid #334155',
                      background: privacyChoice === 'Guest' ? 'rgba(99, 102, 241, .16)' : 'transparent',
                      color: privacyChoice === 'Guest' ? '#A5B4FC' : '#94A3B8',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Public
                  </button>
                  <button
                    type="button"
                    onClick={() => { setPrivacyChoice('Private'); setPrivacyError(null); }}
                    style={{
                      flex: 1,
                      padding: '8px 10px',
                      borderRadius: 8,
                      border: privacyChoice === 'Private' ? '1px solid #6366F1' : '1px solid #334155',
                      background: privacyChoice === 'Private' ? 'rgba(99, 102, 241, .16)' : 'transparent',
                      color: privacyChoice === 'Private' ? '#A5B4FC' : '#94A3B8',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Private
                  </button>
                </div>
                <p style={{ margin: '6px 0 0', fontSize: 11, color: '#64748B' }}>
                  {privacyChoice === 'Guest'
                    ? 'Anyone with the link can join.'
                    : 'A password is required to join -- set one below.'}
                </p>
                {privacyChoice === 'Private' && (
                  <input
                    type="password"
                    value={privacyPassword}
                    onChange={(e) => setPrivacyPassword(e.target.value)}
                    placeholder={selectedConversation.type === 'Private' ? 'Enter a new password to change it' : 'Set a meeting password'}
                    style={{
                      width: '100%',
                      marginTop: 8,
                      padding: '8px 10px',
                      borderRadius: 8,
                      border: '1px solid #334155',
                      background: '#0F172A',
                      color: '#E2E8F0',
                      fontSize: 12,
                      boxSizing: 'border-box',
                    }}
                  />
                )}
                {privacyError && (
                  <p style={{ margin: '6px 0 0', fontSize: 11, color: '#F87171' }}>{privacyError}</p>
                )}
                <button
                  type="button"
                  onClick={() => void saveMeetingPrivacy()}
                  disabled={savingPrivacy || (privacyChoice === selectedConversation.type && privacyChoice === 'Guest')}
                  style={{
                    marginTop: 8,
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: 'none',
                    background: savingPrivacy ? '#334155' : '#4F46E5',
                    color: '#FFFFFF',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: savingPrivacy ? 'wait' : 'pointer',
                  }}
                >
                  {savingPrivacy ? 'Saving…' : 'Save privacy setting'}
                </button>
              </div>
              {selectedConversation.sharedFiles && selectedConversation.sharedFiles.length > 0 && (
                <div className="tm-info-item">
                  <label>Shared Files</label>
                  <div className="tm-info-file-list">
                    {selectedConversation.sharedFiles.map((file, idx) => (
                      <div key={file.url || idx} className="tm-info-file">
                        <FileText size={15} color="#EF4444" />
                        <a
                          href={file.url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: 'inherit', textDecoration: 'none' }}
                        >
                          {file.name} {file.size ? `(${file.size})` : ''}
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Members Drawer */}
        {showMembersDrawer && selectedConversation && (
          <div className="tm-info-drawer tm-members-drawer">
            <div className="tm-info-drawer-header">
              <h3>Conversation members</h3>
              <div className="tm-members-drawer-actions">
                <button
                  type="button"
                  onClick={() => {
                    setInviteEmailInput('');
                    setInviteNameInput('');
                    setInviteFeedback(null);
                    setShowInviteDialog(true);
                  }}
                  title="Add member"
                >
                  <UserPlus size={17} />
                </button>
                <button type="button" onClick={() => setShowMembersDrawer(false)} title="Close members">
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="tm-info-drawer-content">
              {loadingMembers ? (
                <div className="tm-members-loading">
                  <Loader2 size={18} className="animate-spin" /> Loading members...
                </div>
              ) : conversationMembers.length === 0 ? (
                <p className="tm-members-empty">No participant details are available yet.</p>
              ) : (
                conversationMembers.map((member, index) => (
                  <div className="tm-member-row" key={`${member.email}-${index}`}>
                    <div
                      className="tm-member-avatar"
                      style={{
                        backgroundColor: getColorForString(member.email || member.name),
                      }}
                    >
                      {initialsOf(member.name)}
                    </div>
                    <div className="tm-member-copy">
                      <strong>{member.name}</strong>
                      <span>{member.email || 'Meeting participant'}</span>
                    </div>
                    {member.role && <span className="tm-member-role">{member.role}</span>}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </main>

      {/* Leave Conversation Dialog */}
      {showLeaveDialog && selectedConversation && (
        <div
          className="tm-conversation-dialog-backdrop"
          role="presentation"
          onMouseDown={() => !isLeavingConversation && setShowLeaveDialog(false)}
        >
          <section
            className="tm-conversation-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="leave-conversation-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="tm-conversation-dialog-heading">
              <div>
                <h3 id="leave-conversation-title">Leave conversation</h3>
                <p>Choose the person who will manage this conversation after you leave.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowLeaveDialog(false)}
                disabled={isLeavingConversation}
              >
                <X size={18} />
              </button>
            </div>
            {loadingMembers ? (
              <div className="tm-members-loading">
                <Loader2 size={18} className="animate-spin" /> Loading members...
              </div>
            ) : (
              <div className="tm-admin-options">
                {conversationMembers
                  .filter(
                    (member) =>
                      member.email &&
                      member.email.toLowerCase() !== auth.currentUser?.email?.toLowerCase()
                  )
                  .map((member, index) => (
                    <label
                      key={`${member.email}-${index}`}
                      className={`tm-admin-option ${nextAdminEmail === member.email ? 'selected' : ''}`}
                    >
                      <input
                        type="radio"
                        name="nextAdmin"
                        value={member.email}
                        checked={nextAdminEmail === member.email}
                        onChange={() => setNextAdminEmail(member.email)}
                      />
                      <span
                        className="tm-member-avatar"
                        style={{
                          backgroundColor: getColorForString(member.email || member.name),
                        }}
                      >
                        {initialsOf(member.name)}
                      </span>
                      <span>
                        <strong>{member.name}</strong>
                        <small>{member.email}</small>
                      </span>
                    </label>
                  ))}
                {conversationMembers.filter(
                  (member) =>
                    member.email &&
                    member.email.toLowerCase() !== auth.currentUser?.email?.toLowerCase()
                ).length === 0 && (
                  <p className="tm-members-empty">
                    Another participant must join this meeting before you can hand over the conversation.
                  </p>
                )}
              </div>
            )}
            <div className="tm-conversation-dialog-actions">
              <button
                type="button"
                className="tm-dialog-cancel"
                onClick={() => setShowLeaveDialog(false)}
                disabled={isLeavingConversation}
              >
                Cancel
              </button>
              <button
                type="button"
                className="tm-dialog-leave"
                onClick={() => void confirmLeaveConversation()}
                disabled={!nextAdminEmail || isLeavingConversation}
              >
                {isLeavingConversation ? 'Leaving...' : 'Hand over & leave'}
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Tag Dialog */}
      {showTagDialog && selectedConversation && (
        <div
          className="tm-conversation-dialog-backdrop"
          role="presentation"
          onMouseDown={() => setShowTagDialog(false)}
        >
          <form
            className="tm-conversation-dialog tm-tag-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              createTag();
            }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="tm-conversation-dialog-heading">
              <div>
                <h3>Create a tag</h3>
                <p>Use a short name to organise this conversation.</p>
              </div>
              <button type="button" onClick={() => setShowTagDialog(false)}>
                <X size={18} />
              </button>
            </div>
            <label className="tm-tag-dialog-label" htmlFor="conversation-tag-name">
              Tag name
            </label>
            <input
              id="conversation-tag-name"
              autoFocus
              value={newTagName}
              onChange={(event) => setNewTagName(event.target.value)}
              maxLength={40}
              placeholder="For example, Test"
            />
            <div className="tm-conversation-dialog-actions">
              <button type="button" className="tm-dialog-cancel" onClick={() => setShowTagDialog(false)}>
                Cancel
              </button>
              <button type="submit" className="tm-dialog-leave" disabled={!newTagName.trim()}>
                Create tag
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Invite Member Dialog (Sends E11_CONVERSATION_INVITE email template) */}
      {showInviteDialog && selectedConversation && (
        <div
          className="tm-conversation-dialog-backdrop"
          role="presentation"
          onMouseDown={() => !invitingMembers && setShowInviteDialog(false)}
        >
          <form
            className="tm-conversation-dialog tm-tag-dialog"
            onSubmit={handleInviteMemberSubmit}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="tm-conversation-dialog-heading">
              <div>
                <h3>Add member to conversation</h3>
                <p>An official invitation email will be sent to them with a direct access link.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowInviteDialog(false)}
                disabled={invitingMembers}
              >
                <X size={18} />
              </button>
            </div>

            {inviteFeedback && (
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(16, 185, 129, 0.15)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  color: '#34D399',
                  fontSize: '13px',
                  margin: '12px 0',
                }}
              >
                ✓ {inviteFeedback}
              </div>
            )}

            <label className="tm-tag-dialog-label" htmlFor="conversation-member-email">
              Email address *
            </label>
            <input
              id="conversation-member-email"
              type="email"
              autoFocus
              required
              value={inviteEmailInput}
              onChange={(event) => setInviteEmailInput(event.target.value)}
              placeholder="colleague@company.com"
            />

            <label className="tm-tag-dialog-label" htmlFor="conversation-member-name" style={{ marginTop: 12 }}>
              Full Name (optional)
            </label>
            <input
              id="conversation-member-name"
              type="text"
              value={inviteNameInput}
              onChange={(event) => setInviteNameInput(event.target.value)}
              placeholder="e.g. Alex Johnson"
            />

            <div className="tm-conversation-dialog-actions" style={{ marginTop: 20 }}>
              <button
                type="button"
                className="tm-dialog-cancel"
                onClick={() => setShowInviteDialog(false)}
                disabled={invitingMembers}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="tm-dialog-leave"
                disabled={!inviteEmailInput.trim() || invitingMembers}
              >
                {invitingMembers ? 'Sending Invite…' : 'Send invitation email'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Image Lightbox */}
      {lightboxImage && (
        <div className="tm-image-lightbox-overlay" onClick={() => setLightboxImage(null)}>
          <button
            type="button"
            className="tm-image-lightbox-close"
            onClick={() => setLightboxImage(null)}
            title="Close"
          >
            <X size={20} />
          </button>
          <a
            href={lightboxImage}
            download
            className="tm-image-lightbox-download"
            title="Download image"
            onClick={(e) => e.stopPropagation()}
          >
            <Download size={18} />
          </a>
          <img
            src={lightboxImage}
            alt="Attachment"
            className="tm-image-lightbox-img"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );

  function renderConversationMenu() {
    return (
      <div className="tm-conversation-menu" role="menu">
        {conversationMenuPage === 'main' ? (
          <>
            <button
              type="button"
              className="tm-conversation-menu-item"
              onClick={() => {
                updateSelectedPreferences({ favorite: !selectedPreferences.favorite });
                closeConversationMenu();
              }}
            >
              <Star size={17} fill={selectedPreferences.favorite ? 'currentColor' : 'none'} />
              {selectedPreferences.favorite ? 'Remove from favorites' : 'Add to favorites'}
            </button>
            <button
              type="button"
              className="tm-conversation-menu-item"
              onClick={() => void copyConversationLink()}
            >
              <Copy size={17} /> Copy link
            </button>
            <button
              type="button"
              className="tm-conversation-menu-item"
              onClick={() => {
                updateSelectedPreferences({ manuallyUnread: true });
                closeConversationMenu();
              }}
            >
              <MessageSquare size={17} /> Mark as unread
            </button>
            <button
              type="button"
              className="tm-conversation-menu-item"
              onClick={() => setConversationMenuPage('notifications')}
            >
              <Bell size={17} /> Notifications <ChevronRight size={16} className="tm-menu-chevron" />
            </button>
            <button
              type="button"
              className="tm-conversation-menu-item"
              onClick={() => {
                closeConversationMenu();
                setShowInfoDrawer(true);
              }}
            >
              <Info size={17} /> Conversation settings
            </button>
            <button
              type="button"
              className="tm-conversation-menu-item"
              onClick={() => {
                updateSelectedPreferences({ archived: true });
                closeConversationMenu();
                setSelectedConversation(null);
              }}
            >
              <Archive size={17} /> Archive conversation
            </button>
            <button
              type="button"
              className="tm-conversation-menu-item"
              onClick={() => setConversationMenuPage('tags')}
            >
              <Tag size={17} /> Tags <ChevronRight size={16} className="tm-menu-chevron" />
            </button>
            <button
              type="button"
              className="tm-conversation-menu-item"
              onClick={() => void beginLeaveConversation()}
            >
              <LogOut size={17} /> Leave conversation
            </button>
            <button
              type="button"
              className="tm-conversation-menu-item danger"
              onClick={() => {
                if (
                  window.confirm(
                    'Remove this conversation from your list? The meeting and its messages will not be deleted.'
                  )
                ) {
                  updateSelectedPreferences({ removed: true });
                  closeConversationMenu();
                  setSelectedConversation(null);
                }
              }}
            >
              <Trash2 size={17} /> Delete conversation
            </button>
          </>
        ) : conversationMenuPage === 'notifications' ? (
          <>
            <button
              type="button"
              className="tm-conversation-menu-back"
              onClick={() => setConversationMenuPage('main')}
            >
              <ArrowLeft size={17} /> Back
            </button>
            {(
              [
                ['all', 'All messages', Bell],
                ['mentions', '@-mentions only', AtSign],
                ['off', 'Off', Bell],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                className="tm-conversation-menu-item"
                onClick={() => updateSelectedPreferences({ notification: value })}
              >
                <Icon size={17} /> {label}
                {(selectedPreferences.notification || 'all') === value && (
                  <CheckCheck size={16} className="tm-menu-check" />
                )}
              </button>
            ))}
            <div className="tm-conversation-menu-divider" />
            <button
              type="button"
              className="tm-conversation-menu-item"
              onClick={() => updateSelectedPreferences({ notifyCalls: !selectedPreferences.notifyCalls })}
            >
              <Video size={17} /> Notify about calls
              {selectedPreferences.notifyCalls !== false && (
                <CheckCheck size={16} className="tm-menu-check" />
              )}
            </button>
            <button
              type="button"
              className="tm-conversation-menu-item"
              onClick={() => updateSelectedPreferences({ important: !selectedPreferences.important })}
            >
              <MessageSquare size={17} /> Important conversation
              {selectedPreferences.important && <CheckCheck size={16} className="tm-menu-check" />}
            </button>
            <small className="tm-conversation-menu-note">
              Important conversations can notify you during Do not disturb.
            </small>
            <button
              type="button"
              className="tm-conversation-menu-item"
              onClick={() => updateSelectedPreferences({ sensitive: !selectedPreferences.sensitive })}
            >
              <Shield size={17} /> Sensitive conversation
              {selectedPreferences.sensitive && <CheckCheck size={16} className="tm-menu-check" />}
            </button>
            <small className="tm-conversation-menu-note">Hide message text in notifications.</small>
          </>
        ) : (
          <>
            <button
              type="button"
              className="tm-conversation-menu-back"
              onClick={() => setConversationMenuPage('main')}
            >
              <ArrowLeft size={17} /> Back
            </button>
            <button
              type="button"
              className="tm-conversation-menu-item"
              onClick={() => updateSelectedPreferences({ tags: [] })}
            >
              <X size={17} /> Remove all tags
            </button>
            {(selectedPreferences.tags || []).map((tag) => (
              <button
                key={tag}
                type="button"
                className="tm-conversation-menu-item"
                onClick={() =>
                  updateSelectedPreferences({
                    tags: (selectedPreferences.tags || []).filter((item) => item !== tag),
                  })
                }
              >
                <Tag size={17} /> {tag}
                <CheckCheck size={16} className="tm-menu-check" />
              </button>
            ))}
            <button
              type="button"
              className="tm-conversation-menu-item"
              onClick={() => {
                closeConversationMenu();
                setNewTagName('');
                setShowTagDialog(true);
              }}
            >
              <span className="tm-menu-plus">+</span> New tag
            </button>
          </>
        )}
      </div>
    );
  }
}

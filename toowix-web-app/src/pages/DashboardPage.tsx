import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Video,
  Home,
  Calendar,
  Clock,
  History,
  Users,
  Building2,
  Settings,
  LogOut,
  Search,
  Bell,
  HelpCircle,
  Plus,
  ArrowRight,
  Menu,
  X,
  ChevronDown,
  Copy,
  Check,
  CalendarPlus,
  Link as LinkIcon,
  Sun,
  Moon,
} from 'lucide-react';
import { auth } from '../lib/firebase';
import { signOut } from 'firebase/auth';
import { generateUniqueMeetingId, sanitizeCustomMeetingId } from '../lib/meeting-id';
import { useTheme } from '../lib/theme';
import { ScheduleCalendar } from '../components/ScheduleCalendar';
import { RecordingsPanel } from '../components/RecordingsPanel';
import { PastMeetingsPanel } from '../components/PastMeetingsPanel';
import { UpcomingMeetingsPanel } from '../components/UpcomingMeetingsPanel';
import { PeoplePanel } from '../components/PeoplePanel';
import { TeamsPanel } from '../components/TeamsPanel';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000';

interface IMeeting {
  id: string;
  name: string;
  organizer: string;
  dateTime: string;
  duration: string;
  type: 'Internal' | 'Guest' | 'Private';
  roomSlug: string;
  isFuture: boolean;
  scheduledAtIso: string | null;
  refDateIso: string;
  durationMinutes: number | null;
  organizerInitials: string;
  organizerId?: string;
  organizerEmail?: string;
  organizerAvatarUrl?: string;
  organizerTeam?: string;
  status: 'Scheduled' | 'Completed' | 'Cancelled' | 'Ended';
  actualStartTime?: string;
  actualEndTime?: string;
  participants?: any[];
  resources?: {
    recordingUrl?: string;
    transcriptUrl?: string;
    chatUrl?: string;
    sharedFilesUrl?: string;
    notesUrl?: string;
    recordingAllowDownload?: boolean;
  };
}

interface IApiMeeting {
  id: string;
  name: string;
  roomSlug: string;
  type: 'Internal' | 'Guest' | 'Private';
  scheduledAt: string | null;
  durationMinutes: number | null;
  createdAt: string;
  createdBy?: { _id?: string; id?: string; fullName?: string; email?: string; avatarUrl?: string; team?: string; department?: string } | string;
  cancelledAt?: string | null;
  actualStartedAt?: string | null;
  actualEndedAt?: string | null;
  participants?: any[];
  resources?: IMeeting['resources'];
}

const formatMeetingDateTime = (iso: string) => {
  const date = new Date(iso);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (date.toDateString() === now.toDateString()) return `Today, ${time}`;
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
};

const initialsOf = (name: string) => name.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?';

const mapApiMeeting = (meeting: IApiMeeting): IMeeting => {
  const organizer = typeof meeting.createdBy === 'object' ? meeting.createdBy?.fullName || meeting.createdBy?.email || 'Unknown' : 'Unknown';
  const referenceDate = meeting.scheduledAt || meeting.createdAt;
  const isFuture = !meeting.cancelledAt && !!meeting.scheduledAt && new Date(meeting.scheduledAt).getTime() > Date.now();
  return {
    id: meeting.id,
    name: meeting.name,
    organizer,
    organizerInitials: initialsOf(organizer),
    dateTime: formatMeetingDateTime(referenceDate),
    duration: meeting.durationMinutes ? `${meeting.durationMinutes} min` : 'Instant',
    durationMinutes: meeting.durationMinutes,
    type: meeting.type,
    roomSlug: meeting.roomSlug,
    isFuture,
    scheduledAtIso: meeting.scheduledAt,
    refDateIso: referenceDate,
    organizerId: typeof meeting.createdBy === 'object' ? meeting.createdBy?._id || meeting.createdBy?.id : meeting.createdBy,
    organizerEmail: typeof meeting.createdBy === 'object' ? meeting.createdBy?.email : undefined,
    organizerAvatarUrl: typeof meeting.createdBy === 'object' ? meeting.createdBy?.avatarUrl : undefined,
    organizerTeam: typeof meeting.createdBy === 'object' ? meeting.createdBy?.team || meeting.createdBy?.department : undefined,
    status: meeting.cancelledAt ? 'Cancelled' : isFuture ? 'Scheduled' : meeting.actualEndedAt ? 'Ended' : 'Completed',
    actualStartTime: meeting.actualStartedAt ? formatMeetingDateTime(meeting.actualStartedAt) : undefined,
    actualEndTime: meeting.actualEndedAt ? formatMeetingDateTime(meeting.actualEndedAt) : undefined,
    participants: meeting.participants?.map((participant: any) => ({
      name: participant.name,
      email: participant.email,
      avatarUrl: participant.avatarUrl,
      role: participant.role || 'Participant',
      joinedAt: participant.joinedAt ? formatMeetingDateTime(participant.joinedAt) : undefined,
      leftAt: participant.leftAt ? formatMeetingDateTime(participant.leftAt) : undefined,
      timeSpent: participant.timeSpentMinutes != null ? `${participant.timeSpentMinutes} min` : undefined,
      attendanceStatus: participant.attendanceStatus,
    })),
    resources: meeting.resources,
  };
};

export function DashboardPage() {
  const navigate = useNavigate();
  const { isDark, toggleTheme } = useTheme();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [showNewMeetingModal, setShowNewMeetingModal] = useState(false);
  const [showMobileSearch, setShowMobileSearch] = useState(false);
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [activeTab, setActiveTab] = useState<'home' | 'schedule' | 'upcoming' | 'past' | 'recordings' | 'people' | 'teams'>('home');
  const [copiedLink, setCopiedLink] = useState(false);
  const [createdRoomLink, setCreatedRoomLink] = useState<string | null>(null);

  const [allMeetings, setAllMeetings] = useState<IMeeting[]>([]);
  const [meetingsLoading, setMeetingsLoading] = useState(true);

  const fetchMeetings = async () => {
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      const response = await fetch(`${BACKEND_URL}/api/meetings`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json();
      if (response.ok && Array.isArray(data.meetings)) setAllMeetings(data.meetings.map(mapApiMeeting));
    } catch (error) {
      console.error('[Dashboard] Failed to fetch meetings:', error);
    } finally {
      setMeetingsLoading(false);
    }
  };

  const persistMeeting = async (name: string, roomSlug: string, type: IMeeting['type'] = 'Internal', scheduledAt?: string, durationMinutes?: number) => {
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      const response = await fetch(`${BACKEND_URL}/api/meetings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name, roomSlug, type, scheduledAt, durationMinutes }),
      });
      if (response.ok) fetchMeetings();
    } catch (error) {
      console.error('[Dashboard] Failed to save meeting:', error);
    }
  };

  const handleScheduleMeeting = async (data: { name: string; scheduledAt: string; durationMinutes: number; type: IMeeting['type'] }) => {
    await persistMeeting(data.name, generateUniqueMeetingId(), data.type, data.scheduledAt, data.durationMinutes);
  };

  useEffect(() => {
    // 1. Check local session cache
    const cachedUser = localStorage.getItem('toowix_user');
    if (cachedUser) {
      try {
        setCurrentUser(JSON.parse(cachedUser));
      } catch (e) {
        console.error('Failed to parse cached user:', e);
      }
    }

    // 2. Sync with Firebase auth state
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (user) {
        setCurrentUser((prev: any) => ({
          ...prev,
          name: user.displayName || prev?.name || user.email?.split('@')[0] || 'User',
          email: user.email,
          avatarUrl: user.photoURL || prev?.avatarUrl,
        }));
        fetchMeetings();
      }
    });

    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (e) {
      console.warn('Firebase signout warning:', e);
    }
    localStorage.removeItem('toowix_user');
    localStorage.removeItem('toowix_jitsi_jwt');
    localStorage.removeItem('toowix_company');
    navigate('/login');
  };

  const handleStartInstantMeeting = () => {
    const roomId = generateUniqueMeetingId();
    persistMeeting(`${displayName}'s Meeting`, roomId, 'Internal');
    navigate(`/meet/${roomId}`);
  };

  const handleCreateMeetingForLater = () => {
    const roomId = generateUniqueMeetingId();
    const url = `${window.location.origin}/meet/${roomId}`;
    persistMeeting(`${displayName}'s Meeting`, roomId, 'Internal');
    setCreatedRoomLink(url);
  };

  const handleCopyCreatedLink = () => {
    if (createdRoomLink) {
      navigator.clipboard.writeText(createdRoomLink);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    }
  };

  const handleJoinWithCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCodeInput.trim()) return;

    let input = joinCodeInput.trim();
    // Support full URLs like https://meet.toowix.com/meet/my-room
    if (input.includes('/meet/')) {
      input = input.substring(input.lastIndexOf('/meet/') + 6);
    }
    const cleanRoom = sanitizeCustomMeetingId(input);
    navigate(`/meet/${cleanRoom}`);
  };

  // Determine greeting based on current hour
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const displayName = currentUser?.name?.split(' ')[0] || 'User';
  const currentUserId = String(currentUser?.id || currentUser?._id || '');
  const currentUserEmail = String(currentUser?.email || '').toLowerCase();
  const isWorkspaceAdmin = currentUser?.role === 'COMPANY_ADMIN' || currentUser?.role === 'SUPER_ADMIN';
  const canManageMeeting = (meeting: IMeeting) => isWorkspaceAdmin
    || (!!currentUserId && meeting.organizerId === currentUserId)
    || (!!currentUserEmail && meeting.organizerEmail?.toLowerCase() === currentUserEmail);

  // Filter meetings by tab and search
  const filteredMeetings = allMeetings.filter((m) => {
    const matchesSearch =
      m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.organizer.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.roomSlug.toLowerCase().includes(searchQuery.toLowerCase());

    if (activeTab === 'upcoming') {
      return matchesSearch && m.isFuture;
    }
    if (activeTab === 'past') {
      return matchesSearch && !m.isFuture;
    }
    return matchesSearch;
  });

  return (
    <div className="dashboard-layout">
      {/* Mobile Sidebar Backdrop Overlay */}
      <div
        className={`dashboard-sidebar-backdrop ${sidebarOpen ? 'backdrop-active' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* =========================================================================
          SideNavBar (from Google Stitch)
          ========================================================================= */}
      <aside
        className={`dashboard-sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}
        style={{
          backgroundColor: isDark ? '#0E1526' : '#FFFFFF',
          borderRight: `1px solid ${isDark ? '#1E293B' : '#E5E7EB'}`,
        }}
      >
        {/* Header / Logo Area */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px 16px 8px', borderBottom: `1px solid ${isDark ? '#1E293B' : '#F3F4F6'}`, marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <img
              src="/public/assets/toowix-logo.png"
              alt="Toowix Logo"
              style={{ width: '32px', height: '32px', objectFit: 'contain' }}
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                const parent = e.currentTarget.parentElement;
                if (parent) {
                  const fallback = parent.querySelector('.logo-fallback') as HTMLElement;
                  if (fallback) fallback.style.display = 'flex';
                }
              }}
            />
            <div
              className="logo-fallback"
              style={{
                display: 'none',
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, #2E72B2 0%, #4799E3 100%)',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#FFFFFF',
                fontWeight: 700,
                fontSize: '16px',
              }}
            >
              T
            </div>
            <span style={{ fontSize: '18px', fontWeight: 700, color: isDark ? '#F9FAFB' : '#141B2B', letterSpacing: '-0.3px' }}>
              Toowix <span style={{ color: isDark ? '#818CF8' : '#4F46E5' }}>Meet</span>
            </span>
          </div>

          {/* Close button (Mobile Only) */}
          <button
            onClick={() => setSidebarOpen(false)}
            className="dashboard-sidebar-close-btn"
            title="Close menu"
            style={{ color: isDark ? '#9CA3AF' : '#6B7280' }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Navigation Items */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
          {[
            { key: 'home', label: 'Home', icon: <Home size={18} />, action: () => { setActiveTab('home'); setSidebarOpen(false); } },
            { key: 'schedule', label: 'Schedule', icon: <Calendar size={18} />, action: () => { setActiveTab('schedule'); setSidebarOpen(false); } },
            { key: 'upcoming', label: 'Upcoming', icon: <Clock size={18} />, action: () => { setActiveTab('upcoming'); setSidebarOpen(false); } },
            { key: 'past', label: 'Past Meetings', icon: <History size={18} />, action: () => { setActiveTab('past'); setSidebarOpen(false); } },
            { key: 'recordings', label: 'Recordings', icon: <Video size={18} />, action: () => { setActiveTab('recordings'); setSidebarOpen(false); } },
          ].map((item) => (
            <button
              key={item.key}
              onClick={item.action}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '10px 14px',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: activeTab === item.key ? 600 : 500,
                color: activeTab === item.key ? (isDark ? '#818CF8' : '#4F46E5') : (isDark ? '#9CA3AF' : '#4B5563'),
                backgroundColor: activeTab === item.key ? (isDark ? 'rgba(99, 102, 241, 0.15)' : '#EEF2FF') : 'transparent',
                borderLeft: activeTab === item.key ? `4px solid ${isDark ? '#818CF8' : '#4F46E5'}` : '4px solid transparent',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.15s ease',
              }}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}

          <div style={{ height: '1px', backgroundColor: isDark ? '#1E293B' : '#F3F4F6', margin: '8px 0' }} />

          {[
            { key: 'people', label: 'People', icon: <Users size={18} />, action: () => { setActiveTab('people'); setSidebarOpen(false); } },
            { key: 'teams', label: 'Teams', icon: <Building2 size={18} />, action: () => { setActiveTab('teams'); setSidebarOpen(false); } },
          ].map((item) => (
            <button
              key={item.key}
              onClick={item.action}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '10px 14px',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: activeTab === item.key ? 600 : 500,
                color: activeTab === item.key ? (isDark ? '#818CF8' : '#4F46E5') : (isDark ? '#9CA3AF' : '#4B5563'),
                backgroundColor: activeTab === item.key ? (isDark ? 'rgba(99, 102, 241, 0.15)' : '#EEF2FF') : 'transparent',
                borderLeft: activeTab === item.key ? `4px solid ${isDark ? '#818CF8' : '#4F46E5'}` : '4px solid transparent',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.15s ease',
              }}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        {/* Sidebar Bottom Footer */}
        <div style={{ borderTop: `1px solid ${isDark ? '#1E293B' : '#F3F4F6'}`, paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <button
            onClick={() => {
              navigate('/login');
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '10px 14px',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 500,
              color: isDark ? '#9CA3AF' : '#4B5563',
              backgroundColor: 'transparent',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <Settings size={18} />
            <span>Settings</span>
          </button>

          <button
            onClick={handleSignOut}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '10px 14px',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 500,
              color: '#EF4444',
              backgroundColor: 'transparent',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <LogOut size={18} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* =========================================================================
          Main Content Wrapper
          ========================================================================= */}
      <main className="dashboard-main">
        {/* TopNavBar */}
        <header className="dashboard-topbar">
          {/* Left: Mobile Menu Trigger & Mobile Brand */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              onClick={() => setSidebarOpen(true)}
              className="dashboard-mobile-menu-btn"
              title="Open Navigation Menu"
            >
              <Menu size={20} />
            </button>

            {/* Mobile Brand Title */}
            <div className="dashboard-mobile-brand">
              <span style={{ fontSize: '16px', fontWeight: 700, color: '#141B2B' }}>
                Toowix <span style={{ color: '#4F46E5' }}>Meet</span>
              </span>
            </div>
          </div>

          {/* Center: Search Bar (Centered on Desktop) */}
          <div className="dashboard-search-container">
            <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#9CA3AF' }} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search meetings by name or host..."
              className="dashboard-search-input"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', color: '#9CA3AF', cursor: 'pointer' }}
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Right: Actions (Search Mobile, Theme Toggle, Notifications, Help, User Profile) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* Mobile Search Toggle Button */}
            <button
              onClick={() => setShowMobileSearch(!showMobileSearch)}
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                backgroundColor: isDark ? '#1E293B' : '#F9FAFB',
                border: `1px solid ${isDark ? '#334155' : '#E5E7EB'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: isDark ? '#9CA3AF' : '#4B5563',
                cursor: 'pointer',
              }}
              className="block sm:hidden"
              title="Search"
            >
              <Search size={16} />
            </button>

            {/* Theme Toggle Button (Beside Notification Bell on Left Side) */}
            <button
              onClick={toggleTheme}
              style={{
                position: 'relative',
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                backgroundColor: isDark ? '#1E293B' : '#F9FAFB',
                border: `1px solid ${isDark ? '#334155' : '#E5E7EB'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: isDark ? '#FBBF24' : '#4B5563',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
              title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              aria-label="Toggle dark/light mode"
            >
              {isDark ? <Sun size={17} /> : <Moon size={17} />}
            </button>

            {/* Notification Bell */}
            <button
              style={{
                position: 'relative',
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                backgroundColor: isDark ? '#1E293B' : '#F9FAFB',
                border: `1px solid ${isDark ? '#334155' : '#E5E7EB'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: isDark ? '#9CA3AF' : '#4B5563',
                cursor: 'pointer',
              }}
              title="Notifications"
            >
              <Bell size={17} />
              <span style={{ position: 'absolute', top: '6px', right: '6px', width: '7px', height: '7px', backgroundColor: '#EF4444', borderRadius: '50%', border: `2px solid ${isDark ? '#0E1526' : '#FFFFFF'}` }} />
            </button>

            {/* Help / Docs */}
            <button
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                backgroundColor: isDark ? '#1E293B' : '#F9FAFB',
                border: `1px solid ${isDark ? '#334155' : '#E5E7EB'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: isDark ? '#9CA3AF' : '#4B5563',
                cursor: 'pointer',
              }}
              className="hidden sm:flex"
              title="Help & Support"
            >
              <HelpCircle size={17} />
            </button>

            <div style={{ width: '1px', height: '22px', backgroundColor: isDark ? '#1E293B' : '#E5E7EB', margin: '0 2px' }} className="hidden sm:block" />

            {/* User Profile Avatar with Dropdown */}
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShowProfileMenu(!showProfileMenu)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: 'transparent',
                  cursor: 'pointer',
                  padding: '2px',
                  borderRadius: '20px',
                }}
              >
                <div
                  style={{
                    width: '34px',
                    height: '34px',
                    borderRadius: '50%',
                    backgroundColor: isDark ? 'rgba(99, 102, 241, 0.2)' : '#EEF2FF',
                    color: isDark ? '#818CF8' : '#4F46E5',
                    fontWeight: 700,
                    fontSize: '13px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: `1px solid ${isDark ? 'rgba(99, 102, 241, 0.4)' : '#C7D2FE'}`,
                  }}
                >
                  {displayName.charAt(0).toUpperCase()}
                </div>
                <ChevronDown size={14} style={{ color: isDark ? '#9CA3AF' : '#6B7280' }} className="hidden sm:block" />
              </button>

              {/* Profile Menu Popup */}
              {showProfileMenu && (
                <div
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: '44px',
                    width: '220px',
                    backgroundColor: isDark ? '#131B2E' : '#FFFFFF',
                    borderRadius: '12px',
                    boxShadow: isDark ? '0 10px 25px -5px rgba(0, 0, 0, 0.5)' : '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
                    border: `1px solid ${isDark ? '#1E293B' : '#E5E7EB'}`,
                    padding: '8px',
                    zIndex: 100,
                  }}
                >
                  <div style={{ padding: '8px 12px', borderBottom: `1px solid ${isDark ? '#1E293B' : '#F3F4F6'}`, marginBottom: '4px' }}>
                    <p style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: isDark ? '#F9FAFB' : '#141B2B' }}>{currentUser?.name || 'User'}</p>
                    <p style={{ margin: 0, fontSize: '12px', color: isDark ? '#9CA3AF' : '#6B7280', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentUser?.email || 'user@toowix.com'}</p>
                  </div>
                  <button
                    onClick={toggleTheme}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '8px 12px',
                      borderRadius: '6px',
                      fontSize: '13px',
                      color: isDark ? '#F9FAFB' : '#4B5563',
                      background: 'transparent',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    {isDark ? <Sun size={16} color="#FBBF24" /> : <Moon size={16} />}
                    <span>{isDark ? 'Light Mode' : 'Dark Mode'}</span>
                  </button>
                  <button
                    onClick={handleSignOut}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '8px 12px',
                      borderRadius: '6px',
                      fontSize: '13px',
                      color: '#DC2626',
                      background: 'transparent',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <LogOut size={16} />
                    <span>Sign Out</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Mobile Expandable Search Bar */}
        {showMobileSearch && (
          <div style={{ padding: '10px 16px', backgroundColor: isDark ? '#0E1526' : '#FFFFFF', borderBottom: `1px solid ${isDark ? '#1E293B' : '#E5E7EB'}`, display: 'flex', gap: '8px', alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: isDark ? '#6B7280' : '#9CA3AF' }} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search meetings..."
                autoFocus
                style={{
                  width: '100%',
                  height: '36px',
                  paddingLeft: '36px',
                  paddingRight: '12px',
                  backgroundColor: isDark ? '#131B2E' : '#F3F4F6',
                  border: `1px solid ${isDark ? '#1E293B' : 'transparent'}`,
                  color: isDark ? '#F9FAFB' : '#141B2B',
                  borderRadius: '18px',
                  fontSize: '13px',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <button
              onClick={() => {
                setShowMobileSearch(false);
                setSearchQuery('');
              }}
              style={{ background: 'transparent', color: isDark ? '#9CA3AF' : '#6B7280', fontSize: '13px', fontWeight: 500, cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        )}

        {/* =========================================================================
            Dashboard Content Canvas
            ========================================================================= */}
        <div className={`dashboard-canvas${activeTab === 'home' ? '' : ' dashboard-tab-panel'}`}>
          {activeTab === 'schedule' ? (
            <ScheduleCalendar
              meetings={allMeetings.map((meeting) => ({ id: meeting.id, name: meeting.name, scheduledAt: meeting.scheduledAtIso, roomSlug: meeting.roomSlug, type: meeting.type }))}
              onSchedule={handleScheduleMeeting}
            />
          ) : activeTab === 'recordings' ? (
            <RecordingsPanel />
          ) : activeTab === 'past' ? (
            <PastMeetingsPanel
              meetings={allMeetings.filter((meeting) => !meeting.isFuture).map((meeting) => ({
                id: meeting.id,
                name: meeting.name,
                type: meeting.type,
                organizer: meeting.organizer,
                organizerInitials: meeting.organizerInitials,
                dateTime: meeting.dateTime,
                duration: meeting.duration,
                refDateIso: meeting.refDateIso,
                roomSlug: meeting.roomSlug,
                meetingUrl: `${window.location.origin}/meet/${meeting.roomSlug}`,
                status: meeting.status === 'Scheduled' ? 'Completed' : meeting.status,
                actualStartTime: meeting.actualStartTime,
                actualEndTime: meeting.actualEndTime,
                organizerEmail: meeting.organizerEmail,
                organizerAvatarUrl: meeting.organizerAvatarUrl,
                organizerTeam: meeting.organizerTeam,
                participants: meeting.participants,
                resources: meeting.resources,
                canManage: canManageMeeting(meeting),
                canDownloadRecording: canManageMeeting(meeting) || meeting.resources?.recordingAllowDownload === true,
              }))}
              onScheduleAgain={() => setActiveTab('schedule')}
              onMeetingsChanged={fetchMeetings}
            />
          ) : activeTab === 'upcoming' ? (
            <UpcomingMeetingsPanel
              meetings={allMeetings.filter((meeting) => meeting.isFuture && meeting.scheduledAtIso).map((meeting) => ({
                id: meeting.id,
                name: meeting.name,
                type: meeting.type,
                organizer: meeting.organizer,
                organizerInitials: meeting.organizerInitials,
                scheduledAtIso: meeting.scheduledAtIso as string,
                durationMinutes: meeting.durationMinutes,
                roomSlug: meeting.roomSlug,
                organizerEmail: meeting.organizerEmail,
                canManage: canManageMeeting(meeting),
                isInvitedParticipant: !canManageMeeting(meeting),
              }))}
              onJoinWithCode={() => setShowJoinModal(true)}
              onNewMeeting={() => setShowNewMeetingModal(true)}
              onMeetingsChanged={fetchMeetings}
            />
          ) : activeTab === 'teams' ? (
            <TeamsPanel currentUserId={currentUserId} canManage={isWorkspaceAdmin} />
          ) : activeTab === 'people' ? (
            <PeoplePanel meetings={allMeetings.map((meeting) => ({
              id: meeting.id,
              name: meeting.name,
              organizer: meeting.organizer,
              organizerEmail: meeting.organizerEmail,
              dateTime: meeting.dateTime,
              refDateIso: meeting.refDateIso,
              participants: meeting.participants,
            }))} />
          ) : (
          <>
          {/* Greeting Section */}
          <div className="dashboard-greeting-row">
            <div>
              <h1 style={{ fontSize: '26px', fontWeight: 800, color: isDark ? '#F9FAFB' : '#141B2B', letterSpacing: '-0.5px', margin: '0 0 6px 0' }}>
                {getGreeting()}, {displayName}
              </h1>
              <p style={{ fontSize: '14px', color: isDark ? '#9CA3AF' : '#6B7280', margin: 0 }}>
                You have {allMeetings.length} active rooms and meetings scheduled today
              </p>
            </div>

            {/* Action Buttons: Join With Code & New Meeting */}
            <div className="dashboard-greeting-actions">
              <button
                onClick={() => setShowJoinModal(true)}
                style={{
                  height: '42px',
                  padding: '0 18px',
                  backgroundColor: isDark ? '#131B2E' : '#FFFFFF',
                  border: `1px solid ${isDark ? '#6366F1' : '#4F46E5'}`,
                  color: isDark ? '#818CF8' : '#4F46E5',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  transition: 'background-color 0.15s ease',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = isDark ? 'rgba(99, 102, 241, 0.2)' : '#EEF2FF')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = isDark ? '#131B2E' : '#FFFFFF')}
              >
                Join with code
              </button>

              <button
                onClick={() => setShowNewMeetingModal(true)}
                style={{
                  height: '42px',
                  padding: '0 20px',
                  backgroundColor: '#4F46E5',
                  border: '1px solid #4338CA',
                  color: '#FFFFFF',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  boxShadow: '0 2px 4px rgba(79, 70, 229, 0.25)',
                  transition: 'background-color 0.15s ease',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#4338CA')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#4F46E5')}
              >
                <Plus size={18} />
                New Meeting
              </button>
            </div>
          </div>

          {/* Search notice when filtering */}
          {searchQuery && (
            <div style={{ marginBottom: '20px', padding: '10px 16px', backgroundColor: isDark ? 'rgba(99, 102, 241, 0.15)' : '#EEF2FF', borderRadius: '8px', color: isDark ? '#818CF8' : '#4338CA', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: `1px solid ${isDark ? 'rgba(99, 102, 241, 0.3)' : '#C7D2FE'}` }}>
              <span>Filtering meetings for: <strong>"{searchQuery}"</strong> ({filteredMeetings.length} results)</span>
              <button onClick={() => setSearchQuery('')} style={{ background: 'transparent', color: isDark ? '#818CF8' : '#4F46E5', fontWeight: 600, cursor: 'pointer' }}>Clear</button>
            </div>
          )}

          {/* =======================================================================
              Upcoming Meetings Section
              ======================================================================= */}
          {(!searchQuery || 'Weekly Standup'.toLowerCase().includes(searchQuery.toLowerCase())) && (
            <section style={{ marginBottom: '36px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <h2 style={{ fontSize: '18px', fontWeight: 700, color: isDark ? '#F9FAFB' : '#141B2B', margin: 0 }}>
                  Upcoming Meetings
                </h2>
                <button
                  onClick={() => setActiveTab('upcoming')}
                  style={{ background: 'transparent', color: isDark ? '#818CF8' : '#4F46E5', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}
                >
                  View all <ArrowRight size={14} />
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* LIVE Spotlight Hero Card (from Stitch) */}
                <div
                  style={{
                    backgroundColor: isDark ? '#131B2E' : '#FFFFFF',
                    borderRadius: '16px',
                    border: `2px solid ${isDark ? '#6366F1' : '#4F46E5'}`,
                    boxShadow: isDark ? '0 10px 25px -5px rgba(0, 0, 0, 0.5)' : '0 10px 25px -5px rgba(79, 70, 229, 0.08), 0 8px 10px -6px rgba(79, 70, 229, 0.04)',
                    overflow: 'hidden',
                  }}
                >
                  {/* Top Accent Gradient */}
                  <div style={{ height: '6px', background: 'linear-gradient(90deg, #2E72B2 0%, #4F46E5 100%)' }} />

                  <div className="dashboard-spotlight-card-content">
                    <div className="dashboard-spotlight-left">
                      {/* Live Badge */}
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontSize: '12px',
                          fontWeight: 700,
                          color: '#EF4444',
                          backgroundColor: isDark ? 'rgba(239, 68, 68, 0.15)' : '#FEE2E2',
                          border: `1px solid ${isDark ? 'rgba(239, 68, 68, 0.3)' : '#FECACA'}`,
                          padding: '4px 10px',
                          borderRadius: '20px',
                          marginBottom: '12px',
                        }}
                      >
                        <span style={{ width: '8px', height: '8px', backgroundColor: '#EF4444', borderRadius: '50%' }} />
                        LIVE NOW
                      </span>

                      <h3 style={{ fontSize: '22px', fontWeight: 700, color: isDark ? '#F9FAFB' : '#141B2B', margin: '0 0 6px 0', letterSpacing: '-0.3px' }}>
                        Weekly Standup
                      </h3>
                      <p style={{ fontSize: '14px', color: isDark ? '#9CA3AF' : '#6B7280', margin: '0 0 14px 0', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Clock size={16} /> 10:00 AM - 10:30 AM &bull; Room: weekly-standup
                      </p>

                      {/* Participant Bubble Stack */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <div style={{ width: '30px', height: '30px', borderRadius: '50%', backgroundColor: isDark ? '#1E3A8A' : '#DBEAFE', color: isDark ? '#93C5FD' : '#1D4ED8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, border: `2px solid ${isDark ? '#131B2E' : '#FFFFFF'}` }}>
                            SJ
                          </div>
                          <div style={{ width: '30px', height: '30px', borderRadius: '50%', backgroundColor: isDark ? '#312E81' : '#E0E7FF', color: isDark ? '#A5B4FC' : '#4338CA', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, border: `2px solid ${isDark ? '#131B2E' : '#FFFFFF'}`, marginLeft: '-8px' }}>
                            JD
                          </div>
                          <div style={{ width: '30px', height: '30px', borderRadius: '50%', backgroundColor: isDark ? '#78350F' : '#FEF3C7', color: isDark ? '#FDE68A' : '#B45309', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, border: `2px solid ${isDark ? '#131B2E' : '#FFFFFF'}`, marginLeft: '-8px' }}>
                            AK
                          </div>
                          <div style={{ width: '30px', height: '30px', borderRadius: '50%', backgroundColor: isDark ? '#1E293B' : '#F3F4F6', color: isDark ? '#9CA3AF' : '#4B5563', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 600, border: `2px solid ${isDark ? '#131B2E' : '#FFFFFF'}`, marginLeft: '-8px' }}>
                            +4
                          </div>
                        </div>
                        <span style={{ fontSize: '13px', color: isDark ? '#9CA3AF' : '#4B5563' }}>
                          Sarah, John, and 5 others in call
                        </span>
                      </div>
                    </div>

                    {/* Join Action CTA */}
                    <div>
                      <button
                        onClick={() => navigate('/meet/weekly-standup')}
                        className="dashboard-spotlight-btn"
                        style={{
                          padding: '12px 32px',
                          backgroundColor: '#4F46E5',
                          border: 'none',
                          borderRadius: '10px',
                          color: '#FFFFFF',
                          fontSize: '15px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          boxShadow: '0 4px 12px rgba(79, 70, 229, 0.3)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          transition: 'background-color 0.15s ease',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#4338CA')}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#4F46E5')}
                      >
                        <Video size={18} />
                        Join Meeting
                      </button>
                    </div>
                  </div>
                </div>

                {/* Secondary Upcoming Row */}
                <div className="dashboard-upcoming-grid">
                  <div
                    style={{
                      backgroundColor: isDark ? '#131B2E' : '#FFFFFF',
                      borderRadius: '12px',
                      border: `1px solid ${isDark ? '#1E293B' : '#E5E7EB'}`,
                      padding: '16px 20px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{ width: '4px', height: '40px', borderRadius: '4px', backgroundColor: '#3B82F6' }} />
                      <div>
                        <h4 style={{ margin: '0 0 2px 0', fontSize: '14px', fontWeight: 700, color: isDark ? '#F9FAFB' : '#141B2B' }}>
                          Product Sync: Q3 Roadmap
                        </h4>
                        <p style={{ margin: 0, fontSize: '12px', color: isDark ? '#9CA3AF' : '#6B7280', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Clock size={13} /> 1:30 PM - 2:30 PM
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => navigate('/meet/product-sync-q3')}
                      style={{
                        padding: '6px 14px',
                        backgroundColor: isDark ? '#1E293B' : '#FFFFFF',
                        border: `1px solid ${isDark ? '#334155' : '#E5E7EB'}`,
                        borderRadius: '6px',
                        fontSize: '13px',
                        fontWeight: 600,
                        color: isDark ? '#F9FAFB' : '#141B2B',
                        cursor: 'pointer',
                      }}
                    >
                      Join
                    </button>
                  </div>

                  <div
                    style={{
                      backgroundColor: isDark ? '#131B2E' : '#FFFFFF',
                      borderRadius: '12px',
                      border: `1px solid ${isDark ? '#1E293B' : '#E5E7EB'}`,
                      padding: '16px 20px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{ width: '4px', height: '40px', borderRadius: '4px', backgroundColor: '#10B981' }} />
                      <div>
                        <h4 style={{ margin: '0 0 2px 0', fontSize: '14px', fontWeight: 700, color: isDark ? '#F9FAFB' : '#141B2B' }}>
                          Design Review
                        </h4>
                        <p style={{ margin: 0, fontSize: '12px', color: isDark ? '#9CA3AF' : '#6B7280', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Clock size={13} /> 4:00 PM - 5:00 PM
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => navigate('/meet/design-review')}
                      style={{
                        padding: '6px 14px',
                        backgroundColor: isDark ? '#1E293B' : '#FFFFFF',
                        border: `1px solid ${isDark ? '#334155' : '#E5E7EB'}`,
                        borderRadius: '6px',
                        fontSize: '13px',
                        fontWeight: 600,
                        color: isDark ? '#F9FAFB' : '#141B2B',
                        cursor: 'pointer',
                      }}
                    >
                      Join
                    </button>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* =======================================================================
              Recent Meetings Table Card
              ======================================================================= */}
          <section>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 700, color: isDark ? '#F9FAFB' : '#141B2B', margin: 0 }}>
                Recent Meetings
              </h2>
              <button
                onClick={() => setActiveTab('home')}
                style={{ background: 'transparent', color: isDark ? '#818CF8' : '#4F46E5', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}
              >
                View all <ArrowRight size={14} />
              </button>
            </div>

            <div
              style={{
                backgroundColor: isDark ? '#131B2E' : '#FFFFFF',
                borderRadius: '12px',
                border: `1px solid ${isDark ? '#1E293B' : '#E5E7EB'}`,
                boxShadow: isDark ? '0 1px 3px rgba(0,0,0,0.3)' : '0 1px 3px rgba(0,0,0,0.05)',
                overflow: 'hidden',
              }}
            >
              {filteredMeetings.length === 0 ? (
                <div style={{ padding: '40px 20px', textAlign: 'center', color: isDark ? '#9CA3AF' : '#6B7280' }}>
                  <p style={{ margin: '0 0 8px 0', fontSize: '16px', fontWeight: 600, color: isDark ? '#F9FAFB' : '#141B2B' }}>No meetings found</p>
                  <p style={{ margin: 0, fontSize: '13px' }}>Try searching with a different keyword or start a new meeting.</p>
                </div>
              ) : (
                <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '600px' }}>
                    <thead>
                      <tr style={{ backgroundColor: isDark ? '#0F172A' : '#F9FAFB', borderBottom: `1px solid ${isDark ? '#1E293B' : '#E5E7EB'}` }}>
                        <th style={{ padding: '12px 18px', fontSize: '11px', fontWeight: 600, color: isDark ? '#9CA3AF' : '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Meeting Name</th>
                        <th style={{ padding: '12px 18px', fontSize: '11px', fontWeight: 600, color: isDark ? '#9CA3AF' : '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Date & Time</th>
                        <th style={{ padding: '12px 18px', fontSize: '11px', fontWeight: 600, color: isDark ? '#9CA3AF' : '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Duration</th>
                        <th style={{ padding: '12px 18px', fontSize: '11px', fontWeight: 600, color: isDark ? '#9CA3AF' : '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Type</th>
                        <th style={{ padding: '12px 18px', fontSize: '11px', fontWeight: 600, color: isDark ? '#9CA3AF' : '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredMeetings.map((meeting) => (
                        <tr
                          key={meeting.id}
                          style={{ borderBottom: `1px solid ${isDark ? '#1E293B' : '#F3F4F6'}`, transition: 'background-color 0.15s ease' }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = isDark ? '#1E293B' : '#F9FAFB')}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                        >
                          <td style={{ padding: '14px 18px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <div style={{ width: '34px', height: '34px', borderRadius: '8px', backgroundColor: isDark ? 'rgba(99, 102, 241, 0.2)' : '#EEF2FF', color: isDark ? '#818CF8' : '#4F46E5', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                <Video size={16} />
                              </div>
                              <div>
                                <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: isDark ? '#F9FAFB' : '#141B2B' }}>{meeting.name}</p>
                                <p style={{ margin: 0, fontSize: '11px', color: isDark ? '#9CA3AF' : '#6B7280' }}>Organized by {meeting.organizer}</p>
                              </div>
                            </div>
                          </td>
                          <td style={{ padding: '14px 18px', fontSize: '13px', color: isDark ? '#9CA3AF' : '#4B5563', whiteSpace: 'nowrap' }}>{meeting.dateTime}</td>
                          <td style={{ padding: '14px 18px', fontSize: '13px', color: isDark ? '#9CA3AF' : '#4B5563' }}>{meeting.duration}</td>
                          <td style={{ padding: '14px 18px' }}>
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '3px 8px',
                                borderRadius: '20px',
                                fontSize: '11px',
                                fontWeight: 600,
                                backgroundColor: meeting.type === 'Internal' ? (isDark ? 'rgba(99, 102, 241, 0.2)' : '#EEF2FF') : meeting.type === 'Private' ? (isDark ? 'rgba(245, 158, 11, 0.2)' : '#FEF3C7') : (isDark ? '#1E293B' : '#F3F4F6'),
                                color: meeting.type === 'Internal' ? (isDark ? '#818CF8' : '#4F46E5') : meeting.type === 'Private' ? (isDark ? '#FBBF24' : '#D97706') : (isDark ? '#9CA3AF' : '#4B5563'),
                                border: `1px solid ${meeting.type === 'Internal' ? (isDark ? 'rgba(99, 102, 241, 0.4)' : '#C7D2FE') : meeting.type === 'Private' ? (isDark ? 'rgba(245, 158, 11, 0.4)' : '#FDE68A') : (isDark ? '#334155' : '#E5E7EB')}`,
                              }}
                            >
                              {meeting.type}
                            </span>
                          </td>
                          <td style={{ padding: '14px 18px', textAlign: 'right' }}>
                            <button
                              onClick={() => navigate(`/meet/${meeting.roomSlug}`)}
                              style={{
                                padding: '5px 12px',
                                backgroundColor: isDark ? 'rgba(99, 102, 241, 0.2)' : '#EEF2FF',
                                border: `1px solid ${isDark ? 'rgba(99, 102, 241, 0.4)' : '#C7D2FE'}`,
                                borderRadius: '6px',
                                fontSize: '12px',
                                fontWeight: 600,
                                color: isDark ? '#818CF8' : '#4F46E5',
                                cursor: 'pointer',
                              }}
                            >
                              Rejoin
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
          </>
          )}
        </div>
      </main>

      {/* =========================================================================
          Modal: Join with Code / URL
          ========================================================================= */}
      {showJoinModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
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
              borderRadius: '16px',
              maxWidth: '440px',
              width: '100%',
              padding: '24px',
              boxShadow: isDark ? '0 20px 25px -5px rgba(0, 0, 0, 0.6)' : '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
              border: `1px solid ${isDark ? '#1E293B' : 'transparent'}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: isDark ? '#F9FAFB' : '#141B2B' }}>Join a Meeting</h3>
              <button onClick={() => setShowJoinModal(false)} style={{ background: 'transparent', color: isDark ? '#9CA3AF' : '#6B7280', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>
            <p style={{ fontSize: '13px', color: isDark ? '#9CA3AF' : '#6B7280', margin: '0 0 16px 0' }}>
              Enter the room ID, meeting code, or paste the meeting invite link.
            </p>
            <form onSubmit={handleJoinWithCode}>
              <input
                type="text"
                value={joinCodeInput}
                onChange={(e) => setJoinCodeInput(e.target.value)}
                placeholder="e.g. weekly-standup or toowix-room-123"
                autoFocus
                style={{
                  width: '100%',
                  height: '42px',
                  padding: '0 14px',
                  borderRadius: '8px',
                  border: `1px solid ${isDark ? '#334155' : '#D1D5DB'}`,
                  backgroundColor: isDark ? '#0F172A' : '#FFFFFF',
                  color: isDark ? '#F9FAFB' : '#141B2B',
                  fontSize: '14px',
                  marginBottom: '20px',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setShowJoinModal(false)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    border: `1px solid ${isDark ? '#334155' : '#E5E7EB'}`,
                    backgroundColor: isDark ? '#1E293B' : '#FFFFFF',
                    color: isDark ? '#F9FAFB' : '#4B5563',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
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
                  Join Meeting
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          Modal: New Meeting Options
          ========================================================================= */}
      {showNewMeetingModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
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
              borderRadius: '16px',
              maxWidth: '460px',
              width: '100%',
              padding: '24px',
              boxShadow: isDark ? '0 20px 25px -5px rgba(0, 0, 0, 0.6)' : '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
              border: `1px solid ${isDark ? '#1E293B' : 'transparent'}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: isDark ? '#F9FAFB' : '#141B2B' }}>New Meeting</h3>
              <button
                onClick={() => {
                  setShowNewMeetingModal(false);
                  setCreatedRoomLink(null);
                }}
                style={{ background: 'transparent', color: isDark ? '#9CA3AF' : '#6B7280', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            {!createdRoomLink ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {/* Option 1: Instant Meeting */}
                <button
                  onClick={handleStartInstantMeeting}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '14px',
                    padding: '14px',
                    borderRadius: '10px',
                    border: `1px solid ${isDark ? '#1E293B' : '#E5E7EB'}`,
                    backgroundColor: isDark ? '#0F172A' : '#FFFFFF',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = isDark ? '#1E293B' : '#EEF2FF')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = isDark ? '#0F172A' : '#FFFFFF')}
                >
                  <div style={{ width: '40px', height: '40px', borderRadius: '8px', backgroundColor: isDark ? 'rgba(99, 102, 241, 0.2)' : '#EEF2FF', color: isDark ? '#818CF8' : '#4F46E5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Video size={20} />
                  </div>
                  <div>
                    <h4 style={{ margin: '0 0 2px 0', fontSize: '14px', fontWeight: 700, color: isDark ? '#F9FAFB' : '#141B2B' }}>Start an instant meeting</h4>
                    <p style={{ margin: 0, fontSize: '12px', color: isDark ? '#9CA3AF' : '#6B7280' }}>Launch an immediate video meeting in your browser</p>
                  </div>
                </button>

                {/* Option 2: Create link for later */}
                <button
                  onClick={handleCreateMeetingForLater}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '14px',
                    padding: '14px',
                    borderRadius: '10px',
                    border: `1px solid ${isDark ? '#1E293B' : '#E5E7EB'}`,
                    backgroundColor: isDark ? '#0F172A' : '#FFFFFF',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = isDark ? '#1E293B' : '#EEF2FF')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = isDark ? '#0F172A' : '#FFFFFF')}
                >
                  <div style={{ width: '40px', height: '40px', borderRadius: '8px', backgroundColor: isDark ? 'rgba(16, 185, 129, 0.2)' : '#ECFDF5', color: isDark ? '#34D399' : '#059669', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <LinkIcon size={20} />
                  </div>
                  <div>
                    <h4 style={{ margin: '0 0 2px 0', fontSize: '14px', fontWeight: 700, color: isDark ? '#F9FAFB' : '#141B2B' }}>Create a meeting for later</h4>
                    <p style={{ margin: 0, fontSize: '12px', color: isDark ? '#9CA3AF' : '#6B7280' }}>Get a shareable link that you can send to people</p>
                  </div>
                </button>

                {/* Option 3: Schedule in Calendar */}
                <button
                  onClick={() => {
                    handleStartInstantMeeting();
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '14px',
                    padding: '14px',
                    borderRadius: '10px',
                    border: `1px solid ${isDark ? '#1E293B' : '#E5E7EB'}`,
                    backgroundColor: isDark ? '#0F172A' : '#FFFFFF',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = isDark ? '#1E293B' : '#EEF2FF')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = isDark ? '#0F172A' : '#FFFFFF')}
                >
                  <div style={{ width: '40px', height: '40px', borderRadius: '8px', backgroundColor: isDark ? 'rgba(245, 158, 11, 0.2)' : '#FEF3C7', color: isDark ? '#FBBF24' : '#D97706', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <CalendarPlus size={20} />
                  </div>
                  <div>
                    <h4 style={{ margin: '0 0 2px 0', fontSize: '14px', fontWeight: 700, color: isDark ? '#F9FAFB' : '#141B2B' }}>Schedule in calendar</h4>
                    <p style={{ margin: 0, fontSize: '12px', color: isDark ? '#9CA3AF' : '#6B7280' }}>Plan a recurring or upcoming scheduled meeting</p>
                  </div>
                </button>
              </div>
            ) : (
              <div>
                <p style={{ fontSize: '13px', color: isDark ? '#9CA3AF' : '#6B7280', margin: '0 0 14px 0' }}>
                  Here is your meeting link. Copy and send it to people you want to meet with:
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: isDark ? '#0F172A' : '#F3F4F6', border: `1px solid ${isDark ? '#1E293B' : 'transparent'}`, padding: '10px 14px', borderRadius: '8px', marginBottom: '20px' }}>
                  <span style={{ fontSize: '13px', color: isDark ? '#F9FAFB' : '#141B2B', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {createdRoomLink}
                  </span>
                  <button
                    onClick={handleCopyCreatedLink}
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
                    {copiedLink ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                  <button
                    onClick={() => {
                      setShowNewMeetingModal(false);
                      setCreatedRoomLink(null);
                    }}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '8px',
                      border: `1px solid ${isDark ? '#334155' : '#E5E7EB'}`,
                      backgroundColor: isDark ? '#1E293B' : '#FFFFFF',
                      color: isDark ? '#F9FAFB' : '#4B5563',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Done
                  </button>
                  <button
                    onClick={() => {
                      if (createdRoomLink) {
                        window.location.href = createdRoomLink;
                      }
                    }}
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
                    Join now
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

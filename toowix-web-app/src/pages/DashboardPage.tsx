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
} from 'lucide-react';
import { auth } from '../lib/firebase';
import { signOut } from 'firebase/auth';
import { generateUniqueMeetingId, sanitizeCustomMeetingId } from '../lib/meeting-id';

interface IMeeting {
  id: string;
  name: string;
  organizer: string;
  dateTime: string;
  duration: string;
  type: 'Internal' | 'Guest' | 'Private';
  roomSlug: string;
}

export function DashboardPage() {
  const navigate = useNavigate();
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

  // Sample meetings for the user's workspace
  const [allMeetings] = useState<IMeeting[]>([
    {
      id: '1',
      name: 'Marketing All Hands',
      organizer: 'Sarah J.',
      dateTime: 'Today, 9:00 AM',
      duration: '45 min',
      type: 'Internal',
      roomSlug: 'marketing-all-hands',
    },
    {
      id: '2',
      name: 'Vendor Sync: Acme Corp',
      organizer: 'You',
      dateTime: 'Yesterday, 2:30 PM',
      duration: '30 min',
      type: 'Guest',
      roomSlug: 'vendor-sync-acme',
    },
    {
      id: '3',
      name: '1:1 with Manager',
      organizer: 'David M.',
      dateTime: 'Mon, 11:00 AM',
      duration: '60 min',
      type: 'Private',
      roomSlug: 'one-on-one-manager',
    },
    {
      id: '4',
      name: 'Engineering Sprint Planning',
      organizer: 'Alex K.',
      dateTime: 'Tomorrow, 10:00 AM',
      duration: '60 min',
      type: 'Internal',
      roomSlug: 'eng-sprint-planning',
    },
    {
      id: '5',
      name: 'Client Demo: Cloud Integration',
      organizer: 'You',
      dateTime: 'Fri, 3:00 PM',
      duration: '45 min',
      type: 'Guest',
      roomSlug: 'client-demo-cloud',
    },
  ]);

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
      }
    });

    return () => unsubscribe();
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
    navigate(`/meet/${roomId}`);
  };

  const handleCreateMeetingForLater = () => {
    const roomId = generateUniqueMeetingId();
    const url = `${window.location.origin}/meet/${roomId}`;
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

  // Filter meetings by tab and search
  const filteredMeetings = allMeetings.filter((m) => {
    const matchesSearch =
      m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.organizer.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.roomSlug.toLowerCase().includes(searchQuery.toLowerCase());

    if (activeTab === 'upcoming') {
      return matchesSearch && (m.dateTime.includes('Today') || m.dateTime.includes('Tomorrow') || m.dateTime.includes('Fri'));
    }
    if (activeTab === 'past') {
      return matchesSearch && (m.dateTime.includes('Yesterday') || m.dateTime.includes('Mon'));
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
      <aside className={`dashboard-sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        {/* Header / Logo Area */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px 16px 8px', borderBottom: '1px solid #F3F4F6', marginBottom: '16px' }}>
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
            <span style={{ fontSize: '18px', fontWeight: 700, color: '#141B2B', letterSpacing: '-0.3px' }}>
              Toowix <span style={{ color: '#4F46E5' }}>Meet</span>
            </span>
          </div>

          {/* Close button (Mobile Only) */}
          <button
            onClick={() => setSidebarOpen(false)}
            className="dashboard-sidebar-close-btn"
            title="Close menu"
          >
            <X size={20} />
          </button>
        </div>

        {/* Navigation Items */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
          <button
            onClick={() => {
              setActiveTab('home');
              setSidebarOpen(false);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '10px 14px',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: activeTab === 'home' ? 600 : 500,
              color: activeTab === 'home' ? '#4F46E5' : '#4B5563',
              backgroundColor: activeTab === 'home' ? '#EEF2FF' : 'transparent',
              borderLeft: activeTab === 'home' ? '4px solid #4F46E5' : '4px solid transparent',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.15s ease',
            }}
          >
            <Home size={18} />
            <span>Home</span>
          </button>

          <button
            onClick={() => {
              setActiveTab('schedule');
              setShowNewMeetingModal(true);
              setSidebarOpen(false);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '10px 14px',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: activeTab === 'schedule' ? 600 : 500,
              color: activeTab === 'schedule' ? '#4F46E5' : '#4B5563',
              backgroundColor: activeTab === 'schedule' ? '#EEF2FF' : 'transparent',
              borderLeft: activeTab === 'schedule' ? '4px solid #4F46E5' : '4px solid transparent',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.15s ease',
            }}
          >
            <Calendar size={18} />
            <span>Schedule</span>
          </button>

          <button
            onClick={() => {
              setActiveTab('upcoming');
              setSidebarOpen(false);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '10px 14px',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: activeTab === 'upcoming' ? 600 : 500,
              color: activeTab === 'upcoming' ? '#4F46E5' : '#4B5563',
              backgroundColor: activeTab === 'upcoming' ? '#EEF2FF' : 'transparent',
              borderLeft: activeTab === 'upcoming' ? '4px solid #4F46E5' : '4px solid transparent',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.15s ease',
            }}
          >
            <Clock size={18} />
            <span>Upcoming</span>
          </button>

          <button
            onClick={() => {
              setActiveTab('past');
              setSidebarOpen(false);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '10px 14px',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: activeTab === 'past' ? 600 : 500,
              color: activeTab === 'past' ? '#4F46E5' : '#4B5563',
              backgroundColor: activeTab === 'past' ? '#EEF2FF' : 'transparent',
              borderLeft: activeTab === 'past' ? '4px solid #4F46E5' : '4px solid transparent',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.15s ease',
            }}
          >
            <History size={18} />
            <span>Past Meetings</span>
          </button>

          <button
            onClick={() => {
              setActiveTab('recordings');
              setSidebarOpen(false);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '10px 14px',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: activeTab === 'recordings' ? 600 : 500,
              color: activeTab === 'recordings' ? '#4F46E5' : '#4B5563',
              backgroundColor: activeTab === 'recordings' ? '#EEF2FF' : 'transparent',
              borderLeft: activeTab === 'recordings' ? '4px solid #4F46E5' : '4px solid transparent',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.15s ease',
            }}
          >
            <Video size={18} />
            <span>Recordings</span>
          </button>

          <div style={{ height: '1px', backgroundColor: '#F3F4F6', margin: '8px 0' }} />

          <button
            onClick={() => {
              setActiveTab('people');
              setSidebarOpen(false);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '10px 14px',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: activeTab === 'people' ? 600 : 500,
              color: activeTab === 'people' ? '#4F46E5' : '#4B5563',
              backgroundColor: activeTab === 'people' ? '#EEF2FF' : 'transparent',
              borderLeft: activeTab === 'people' ? '4px solid #4F46E5' : '4px solid transparent',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.15s ease',
            }}
          >
            <Users size={18} />
            <span>People</span>
          </button>

          <button
            onClick={() => {
              setActiveTab('teams');
              setSidebarOpen(false);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '10px 14px',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: activeTab === 'teams' ? 600 : 500,
              color: activeTab === 'teams' ? '#4F46E5' : '#4B5563',
              backgroundColor: activeTab === 'teams' ? '#EEF2FF' : 'transparent',
              borderLeft: activeTab === 'teams' ? '4px solid #4F46E5' : '4px solid transparent',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.15s ease',
            }}
          >
            <Building2 size={18} />
            <span>Teams</span>
          </button>
        </nav>

        {/* Sidebar Bottom Footer */}
        <div style={{ borderTop: '1px solid #F3F4F6', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
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
              color: '#4B5563',
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
              color: '#DC2626',
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

          {/* Right: Actions (Search Mobile, Notifications, User Profile) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {/* Mobile Search Toggle Button */}
            <button
              onClick={() => setShowMobileSearch(!showMobileSearch)}
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                backgroundColor: '#F9FAFB',
                border: '1px solid #E5E7EB',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#4B5563',
                cursor: 'pointer',
              }}
              className="block sm:hidden"
              title="Search"
            >
              <Search size={16} />
            </button>

            {/* Notification Bell */}
            <button
              style={{
                position: 'relative',
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                backgroundColor: '#F9FAFB',
                border: '1px solid #E5E7EB',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#4B5563',
                cursor: 'pointer',
              }}
              title="Notifications"
            >
              <Bell size={17} />
              <span style={{ position: 'absolute', top: '6px', right: '6px', width: '7px', height: '7px', backgroundColor: '#EF4444', borderRadius: '50%', border: '2px solid #FFFFFF' }} />
            </button>

            {/* Help / Docs */}
            <button
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                backgroundColor: '#F9FAFB',
                border: '1px solid #E5E7EB',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#4B5563',
                cursor: 'pointer',
              }}
              className="hidden sm:flex"
              title="Help & Support"
            >
              <HelpCircle size={17} />
            </button>

            <div style={{ width: '1px', height: '22px', backgroundColor: '#E5E7EB', margin: '0 2px' }} className="hidden sm:block" />

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
                    backgroundColor: '#EEF2FF',
                    color: '#4F46E5',
                    fontWeight: 700,
                    fontSize: '13px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1px solid #C7D2FE',
                  }}
                >
                  {displayName.charAt(0).toUpperCase()}
                </div>
                <ChevronDown size={14} style={{ color: '#6B7280' }} className="hidden sm:block" />
              </button>

              {/* Profile Menu Popup */}
              {showProfileMenu && (
                <div
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: '44px',
                    width: '220px',
                    backgroundColor: '#FFFFFF',
                    borderRadius: '12px',
                    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
                    border: '1px solid #E5E7EB',
                    padding: '8px',
                    zIndex: 100,
                  }}
                >
                  <div style={{ padding: '8px 12px', borderBottom: '1px solid #F3F4F6', marginBottom: '4px' }}>
                    <p style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#141B2B' }}>{currentUser?.name || 'User'}</p>
                    <p style={{ margin: 0, fontSize: '12px', color: '#6B7280', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentUser?.email || 'user@toowix.com'}</p>
                  </div>
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
          <div style={{ padding: '10px 16px', backgroundColor: '#FFFFFF', borderBottom: '1px solid #E5E7EB', display: 'flex', gap: '8px', alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#9CA3AF' }} />
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
                  backgroundColor: '#F3F4F6',
                  border: '1px solid transparent',
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
              style={{ background: 'transparent', color: '#6B7280', fontSize: '13px', fontWeight: 500, cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        )}

        {/* =========================================================================
            Dashboard Content Canvas
            ========================================================================= */}
        <div className="dashboard-canvas">
          {/* Greeting Section */}
          <div className="dashboard-greeting-row">
            <div>
              <h1 style={{ fontSize: '26px', fontWeight: 800, color: '#141B2B', letterSpacing: '-0.5px', margin: '0 0 6px 0' }}>
                {getGreeting()}, {displayName}
              </h1>
              <p style={{ fontSize: '14px', color: '#6B7280', margin: 0 }}>
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
                  backgroundColor: '#FFFFFF',
                  border: '1px solid #4F46E5',
                  color: '#4F46E5',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  transition: 'background-color 0.15s ease',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#EEF2FF')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#FFFFFF')}
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
            <div style={{ marginBottom: '20px', padding: '10px 16px', backgroundColor: '#EEF2FF', borderRadius: '8px', color: '#4338CA', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Filtering meetings for: <strong>"{searchQuery}"</strong> ({filteredMeetings.length} results)</span>
              <button onClick={() => setSearchQuery('')} style={{ background: 'transparent', color: '#4F46E5', fontWeight: 600, cursor: 'pointer' }}>Clear</button>
            </div>
          )}

          {/* =======================================================================
              Upcoming Meetings Section
              ======================================================================= */}
          {(!searchQuery || 'Weekly Standup'.toLowerCase().includes(searchQuery.toLowerCase())) && (
            <section style={{ marginBottom: '36px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#141B2B', margin: 0 }}>
                  Upcoming Meetings
                </h2>
                <button
                  onClick={() => setActiveTab('upcoming')}
                  style={{ background: 'transparent', color: '#4F46E5', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}
                >
                  View all <ArrowRight size={14} />
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* LIVE Spotlight Hero Card (from Stitch) */}
                <div
                  style={{
                    backgroundColor: '#FFFFFF',
                    borderRadius: '16px',
                    border: '2px solid #4F46E5',
                    boxShadow: '0 10px 25px -5px rgba(79, 70, 229, 0.08), 0 8px 10px -6px rgba(79, 70, 229, 0.04)',
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
                          color: '#DC2626',
                          backgroundColor: '#FEE2E2',
                          border: '1px solid #FECACA',
                          padding: '4px 10px',
                          borderRadius: '20px',
                          marginBottom: '12px',
                        }}
                      >
                        <span style={{ width: '8px', height: '8px', backgroundColor: '#DC2626', borderRadius: '50%' }} />
                        LIVE NOW
                      </span>

                      <h3 style={{ fontSize: '22px', fontWeight: 700, color: '#141B2B', margin: '0 0 6px 0', letterSpacing: '-0.3px' }}>
                        Weekly Standup
                      </h3>
                      <p style={{ fontSize: '14px', color: '#6B7280', margin: '0 0 14px 0', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Clock size={16} /> 10:00 AM - 10:30 AM &bull; Room: weekly-standup
                      </p>

                      {/* Participant Bubble Stack */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <div style={{ width: '30px', height: '30px', borderRadius: '50%', backgroundColor: '#DBEAFE', color: '#1D4ED8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, border: '2px solid #FFFFFF' }}>
                            SJ
                          </div>
                          <div style={{ width: '30px', height: '30px', borderRadius: '50%', backgroundColor: '#E0E7FF', color: '#4338CA', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, border: '2px solid #FFFFFF', marginLeft: '-8px' }}>
                            JD
                          </div>
                          <div style={{ width: '30px', height: '30px', borderRadius: '50%', backgroundColor: '#FEF3C7', color: '#B45309', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, border: '2px solid #FFFFFF', marginLeft: '-8px' }}>
                            AK
                          </div>
                          <div style={{ width: '30px', height: '30px', borderRadius: '50%', backgroundColor: '#F3F4F6', color: '#4B5563', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 600, border: '2px solid #FFFFFF', marginLeft: '-8px' }}>
                            +4
                          </div>
                        </div>
                        <span style={{ fontSize: '13px', color: '#4B5563' }}>
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
                      backgroundColor: '#FFFFFF',
                      borderRadius: '12px',
                      border: '1px solid #E5E7EB',
                      padding: '16px 20px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{ width: '4px', height: '40px', borderRadius: '4px', backgroundColor: '#3B82F6' }} />
                      <div>
                        <h4 style={{ margin: '0 0 2px 0', fontSize: '14px', fontWeight: 700, color: '#141B2B' }}>
                          Product Sync: Q3 Roadmap
                        </h4>
                        <p style={{ margin: 0, fontSize: '12px', color: '#6B7280', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Clock size={13} /> 1:30 PM - 2:30 PM
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => navigate('/meet/product-sync-q3')}
                      style={{
                        padding: '6px 14px',
                        backgroundColor: '#FFFFFF',
                        border: '1px solid #E5E7EB',
                        borderRadius: '6px',
                        fontSize: '13px',
                        fontWeight: 600,
                        color: '#141B2B',
                        cursor: 'pointer',
                      }}
                    >
                      Join
                    </button>
                  </div>

                  <div
                    style={{
                      backgroundColor: '#FFFFFF',
                      borderRadius: '12px',
                      border: '1px solid #E5E7EB',
                      padding: '16px 20px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{ width: '4px', height: '40px', borderRadius: '4px', backgroundColor: '#10B981' }} />
                      <div>
                        <h4 style={{ margin: '0 0 2px 0', fontSize: '14px', fontWeight: 700, color: '#141B2B' }}>
                          Design Review
                        </h4>
                        <p style={{ margin: 0, fontSize: '12px', color: '#6B7280', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Clock size={13} /> 4:00 PM - 5:00 PM
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => navigate('/meet/design-review')}
                      style={{
                        padding: '6px 14px',
                        backgroundColor: '#FFFFFF',
                        border: '1px solid #E5E7EB',
                        borderRadius: '6px',
                        fontSize: '13px',
                        fontWeight: 600,
                        color: '#141B2B',
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
              <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#141B2B', margin: 0 }}>
                {activeTab === 'upcoming' ? 'Upcoming Schedule' : activeTab === 'past' ? 'Past Meeting History' : 'Recent Meetings'}
              </h2>
              <button
                onClick={() => setActiveTab('home')}
                style={{ background: 'transparent', color: '#4F46E5', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}
              >
                {activeTab === 'home' ? 'View all' : 'Back to all'} <ArrowRight size={14} />
              </button>
            </div>

            <div
              style={{
                backgroundColor: '#FFFFFF',
                borderRadius: '12px',
                border: '1px solid #E5E7EB',
                boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                overflow: 'hidden',
              }}
            >
              {filteredMeetings.length === 0 ? (
                <div style={{ padding: '40px 20px', textAlign: 'center', color: '#6B7280' }}>
                  <p style={{ margin: '0 0 8px 0', fontSize: '16px', fontWeight: 600, color: '#141B2B' }}>No meetings found</p>
                  <p style={{ margin: 0, fontSize: '13px' }}>Try searching with a different keyword or start a new meeting.</p>
                </div>
              ) : (
                <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '600px' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#F9FAFB', borderBottom: '1px solid #E5E7EB' }}>
                        <th style={{ padding: '12px 18px', fontSize: '11px', fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Meeting Name</th>
                        <th style={{ padding: '12px 18px', fontSize: '11px', fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Date & Time</th>
                        <th style={{ padding: '12px 18px', fontSize: '11px', fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Duration</th>
                        <th style={{ padding: '12px 18px', fontSize: '11px', fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Type</th>
                        <th style={{ padding: '12px 18px', fontSize: '11px', fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredMeetings.map((meeting) => (
                        <tr
                          key={meeting.id}
                          style={{ borderBottom: '1px solid #F3F4F6', transition: 'background-color 0.15s ease' }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#F9FAFB')}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                        >
                          <td style={{ padding: '14px 18px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <div style={{ width: '34px', height: '34px', borderRadius: '8px', backgroundColor: '#EEF2FF', color: '#4F46E5', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                <Video size={16} />
                              </div>
                              <div>
                                <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: '#141B2B' }}>{meeting.name}</p>
                                <p style={{ margin: 0, fontSize: '11px', color: '#6B7280' }}>Organized by {meeting.organizer}</p>
                              </div>
                            </div>
                          </td>
                          <td style={{ padding: '14px 18px', fontSize: '13px', color: '#4B5563', whiteSpace: 'nowrap' }}>{meeting.dateTime}</td>
                          <td style={{ padding: '14px 18px', fontSize: '13px', color: '#4B5563' }}>{meeting.duration}</td>
                          <td style={{ padding: '14px 18px' }}>
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '3px 8px',
                                borderRadius: '20px',
                                fontSize: '11px',
                                fontWeight: 600,
                                backgroundColor: meeting.type === 'Internal' ? '#EEF2FF' : meeting.type === 'Private' ? '#FEF3C7' : '#F3F4F6',
                                color: meeting.type === 'Internal' ? '#4F46E5' : meeting.type === 'Private' ? '#D97706' : '#4B5563',
                                border: `1px solid ${meeting.type === 'Internal' ? '#C7D2FE' : meeting.type === 'Private' ? '#FDE68A' : '#E5E7EB'}`,
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
                                backgroundColor: '#EEF2FF',
                                border: '1px solid #C7D2FE',
                                borderRadius: '6px',
                                fontSize: '12px',
                                fontWeight: 600,
                                color: '#4F46E5',
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
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            backdropFilter: 'blur(2px)',
          }}
        >
          <div
            style={{
              backgroundColor: '#FFFFFF',
              borderRadius: '16px',
              maxWidth: '440px',
              width: '100%',
              padding: '24px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#141B2B' }}>Join a Meeting</h3>
              <button onClick={() => setShowJoinModal(false)} style={{ background: 'transparent', color: '#9CA3AF', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>
            <p style={{ fontSize: '13px', color: '#6B7280', margin: '0 0 16px 0' }}>
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
                  border: '1px solid #D1D5DB',
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
                    border: '1px solid #E5E7EB',
                    backgroundColor: '#FFFFFF',
                    color: '#4B5563',
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
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            backdropFilter: 'blur(2px)',
          }}
        >
          <div
            style={{
              backgroundColor: '#FFFFFF',
              borderRadius: '16px',
              maxWidth: '460px',
              width: '100%',
              padding: '24px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#141B2B' }}>New Meeting</h3>
              <button
                onClick={() => {
                  setShowNewMeetingModal(false);
                  setCreatedRoomLink(null);
                }}
                style={{ background: 'transparent', color: '#9CA3AF', cursor: 'pointer' }}
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
                    border: '1px solid #E5E7EB',
                    backgroundColor: '#FFFFFF',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#EEF2FF')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#FFFFFF')}
                >
                  <div style={{ width: '40px', height: '40px', borderRadius: '8px', backgroundColor: '#EEF2FF', color: '#4F46E5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Video size={20} />
                  </div>
                  <div>
                    <h4 style={{ margin: '0 0 2px 0', fontSize: '14px', fontWeight: 700, color: '#141B2B' }}>Start an instant meeting</h4>
                    <p style={{ margin: 0, fontSize: '12px', color: '#6B7280' }}>Launch an immediate video meeting in your browser</p>
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
                    border: '1px solid #E5E7EB',
                    backgroundColor: '#FFFFFF',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#EEF2FF')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#FFFFFF')}
                >
                  <div style={{ width: '40px', height: '40px', borderRadius: '8px', backgroundColor: '#ECFDF5', color: '#059669', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <LinkIcon size={20} />
                  </div>
                  <div>
                    <h4 style={{ margin: '0 0 2px 0', fontSize: '14px', fontWeight: 700, color: '#141B2B' }}>Create a meeting for later</h4>
                    <p style={{ margin: 0, fontSize: '12px', color: '#6B7280' }}>Get a shareable link that you can send to people</p>
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
                    border: '1px solid #E5E7EB',
                    backgroundColor: '#FFFFFF',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#EEF2FF')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#FFFFFF')}
                >
                  <div style={{ width: '40px', height: '40px', borderRadius: '8px', backgroundColor: '#FEF3C7', color: '#D97706', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <CalendarPlus size={20} />
                  </div>
                  <div>
                    <h4 style={{ margin: '0 0 2px 0', fontSize: '14px', fontWeight: 700, color: '#141B2B' }}>Schedule in calendar</h4>
                    <p style={{ margin: 0, fontSize: '12px', color: '#6B7280' }}>Plan a recurring or upcoming scheduled meeting</p>
                  </div>
                </button>
              </div>
            ) : (
              <div>
                <p style={{ fontSize: '13px', color: '#6B7280', margin: '0 0 14px 0' }}>
                  Here is your meeting link. Copy and send it to people you want to meet with:
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#F3F4F6', padding: '10px 14px', borderRadius: '8px', marginBottom: '20px' }}>
                  <span style={{ fontSize: '13px', color: '#141B2B', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                      border: '1px solid #E5E7EB',
                      backgroundColor: '#FFFFFF',
                      color: '#4B5563',
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

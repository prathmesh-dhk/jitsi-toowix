import React, { useEffect, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../lib/firebase';
import {
  Home, Calendar, Clock, History, Video, Users, Building2, Settings as SettingsIcon,
  ChevronLeft, ChevronRight, User as UserIcon, Bell, ShieldCheck, HardDrive, Sliders, LogOut,
} from 'lucide-react';
import { SettingsDirtyProvider, useSettingsDirty } from '../components/settings/SettingsShared';

const RAIL_STORAGE_KEY = 'toowix_settings_rail_collapsed';

const MAIN_NAV = [
  { icon: Home, label: 'Home', path: '/dashboard' },
  { icon: Calendar, label: 'Schedule', path: '/dashboard?tab=schedule' },
  { icon: Clock, label: 'Upcoming', path: '/dashboard?tab=upcoming' },
  { icon: History, label: 'Past Meetings', path: '/dashboard?tab=past' },
  { icon: Video, label: 'Recordings', path: '/dashboard?tab=recordings' },
  { icon: Users, label: 'People', path: '/dashboard?tab=people' },
  { icon: Building2, label: 'Teams', path: '/dashboard?tab=teams' },
];

const SETTINGS_NAV = [
  { icon: UserIcon, label: 'Profile', path: '/settings/profile' },
  { icon: Sliders, label: 'General', path: '/settings/general' },
  { icon: Video, label: 'Meetings', path: '/settings/meetings' },
  { icon: History, label: 'Recording', path: '/settings/recording' },
  { icon: Bell, label: 'Notifications', path: '/settings/notifications' },
  { icon: ShieldCheck, label: 'Security', path: '/settings/security' },
  { icon: HardDrive, label: 'Storage', path: '/settings/storage' },
];

function RailIcon({
  icon: Icon, label, active, expanded, danger, onClick,
}: { icon: any; label: string; active?: boolean; expanded: boolean; danger?: boolean; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  const color = danger ? '#DC2626' : active ? '#4F46E5' : '#6B7280';

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <button
        onClick={onClick}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        aria-label={label}
        style={{
          width: expanded ? '100%' : '40px',
          height: '40px',
          borderRadius: '10px',
          border: 'none',
          background: active ? '#EEF2FF' : 'transparent',
          color,
          borderLeft: active ? '3px solid #4F46E5' : '3px solid transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: expanded ? 'flex-start' : 'center',
          gap: '10px',
          padding: expanded ? '0 10px' : 0,
          cursor: 'pointer',
          fontSize: '13px',
          fontWeight: active ? 700 : 500,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
        }}
      >
        <Icon size={19} style={{ flexShrink: 0 }} />
        {expanded && <span>{label}</span>}
      </button>
      {!expanded && hover && (
        <div
          role="tooltip"
          style={{
            position: 'absolute',
            left: '52px',
            top: '50%',
            transform: 'translateY(-50%)',
            background: '#141B2B',
            color: '#FFFFFF',
            fontSize: '12px',
            fontWeight: 600,
            padding: '5px 10px',
            borderRadius: '6px',
            whiteSpace: 'nowrap',
            zIndex: 100,
            pointerEvents: 'none',
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
}

function SettingsShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { requestNavigation } = useSettingsDirty();

  // Settings opens with the rail collapsed to icon-only by default. The chevron lets the
  // user expand it back to full width with labels; that manual choice is remembered for
  // the rest of the session (sessionStorage), so it doesn't silently re-collapse on every
  // navigation within Settings.
  const [manuallyCollapsed, setManuallyCollapsed] = useState(() => sessionStorage.getItem(RAIL_STORAGE_KEY) !== 'false');

  useEffect(() => {
    sessionStorage.setItem(RAIL_STORAGE_KEY, String(manuallyCollapsed));
  }, [manuallyCollapsed]);

  const activeSettingsPath = SETTINGS_NAV.find((n) => location.pathname.startsWith(n.path))?.path;
  const expanded = !manuallyCollapsed;

  const handleSignOut = async () => {
    try { await signOut(auth); } catch (e) { console.warn('Sign out warning:', e); }
    localStorage.removeItem('toowix_user');
    localStorage.removeItem('toowix_jitsi_jwt');
    localStorage.removeItem('toowix_company');
    navigate('/login');
  };

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#F7F8FA', fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      {/* Main app rail -- collapses to 68px icon-only, or expands to ~220px with labels
          via the chevron toggle at the bottom. */}
      <aside
        style={{
          width: expanded ? '220px' : '68px',
          flexShrink: 0,
          background: '#FFFFFF',
          borderRight: '1px solid #E5E7EB',
          display: 'flex',
          flexDirection: 'column',
          alignItems: expanded ? 'stretch' : 'center',
          padding: '16px 12px',
          transition: 'width 0.2s ease',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px', paddingLeft: expanded ? '2px' : 0 }}>
          <img
            src="/assets/toowix-logo.png"
            alt="Toowix"
            style={{ width: '28px', height: '28px', objectFit: 'contain', flexShrink: 0 }}
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
          {expanded && <span style={{ fontSize: '15px', fontWeight: 800, color: '#141B2B', whiteSpace: 'nowrap' }}>Toowix <span style={{ color: '#4F46E5' }}>Meet</span></span>}
        </div>

        {/* Scrollable nav groups */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {MAIN_NAV.slice(0, 5).map((item) => (
            <RailIcon key={item.label} icon={item.icon} label={item.label} expanded={expanded} onClick={() => requestNavigation(() => navigate(item.path))} />
          ))}
          <div style={{ height: '1px', background: '#F3F4F6', margin: '8px 4px' }} />
          {MAIN_NAV.slice(5).map((item) => (
            <RailIcon key={item.label} icon={item.icon} label={item.label} expanded={expanded} onClick={() => requestNavigation(() => navigate(item.path))} />
          ))}
        </nav>

        {/* Settings + Sign Out, pinned to the bottom -- matches the dashboard's own sidebar layout */}
        <div style={{ borderTop: '1px solid #F3F4F6', paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <RailIcon icon={SettingsIcon} label="Settings" active expanded={expanded} onClick={() => {}} />
          <RailIcon icon={LogOut} label="Sign Out" danger expanded={expanded} onClick={handleSignOut} />
        </div>

        <div style={{ display: 'flex', justifyContent: expanded ? 'flex-end' : 'center', marginTop: '10px' }}>
          <button
            onClick={() => setManuallyCollapsed((c) => !c)}
            title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
            style={{ width: '30px', height: '30px', borderRadius: '8px', border: '1px solid #E5E7EB', background: '#FFFFFF', color: '#6B7280', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
          >
            {expanded ? <ChevronLeft size={15} /> : <ChevronRight size={15} />}
          </button>
        </div>
      </aside>

      {/* Settings sub-navigation, 230px */}
      <aside style={{ width: '230px', flexShrink: 0, background: '#FFFFFF', borderRight: '1px solid #E5E7EB', padding: '24px 12px', overflowY: 'auto' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#141B2B', margin: '0 0 20px 12px' }}>Settings</h2>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {SETTINGS_NAV.map((item) => {
            const active = activeSettingsPath === item.path;
            return (
              <button
                key={item.path}
                onClick={() => requestNavigation(() => navigate(item.path))}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '9px 12px',
                  borderRadius: '8px',
                  border: 'none',
                  borderLeft: active ? '3px solid #4F46E5' : '3px solid transparent',
                  background: active ? '#EEF2FF' : 'transparent',
                  color: active ? '#4F46E5' : '#374151',
                  fontSize: '13px',
                  fontWeight: active ? 700 : 500,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <item.icon size={16} />
                {item.label}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Content */}
      <main style={{ flex: 1, overflowY: 'auto', padding: '32px' }}>
        <div style={{ maxWidth: '760px', margin: '0 auto' }}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export function SettingsPage() {
  return (
    <SettingsDirtyProvider>
      <SettingsShell />
    </SettingsDirtyProvider>
  );
}

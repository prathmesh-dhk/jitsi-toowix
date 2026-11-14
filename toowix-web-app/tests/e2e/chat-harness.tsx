// Browser-test harness: mounts the REAL chat screen exactly the way DashboardPage does (same hook,
// same panel, same toasts, same menu badge), minus the rest of the dashboard.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DirectChatPanel } from '../../src/components/directChat/DirectChatPanel';
import { DirectChatToasts } from '../../src/components/directChat/DirectChatToasts';
import { DirectChatCallOverlay } from '../../src/components/directChat/DirectChatCallOverlay';
import { useDirectChat } from '../../src/lib/directChat/useDirectChat';
import { badgeLabel } from '../../src/lib/directChat/format';
// The app's own global stylesheet, so the dashboard's global input/textarea rules (the ones that once painted a
// stray box inside the chat's search and message fields) are present exactly as in the real dashboard.
import '../../src/index.css';

const params = new URLSearchParams(window.location.search);
const meId = params.get('me') || '';
const isDark = params.get('theme') !== 'light';
document.documentElement.classList.toggle('dark', isDark);
document.documentElement.classList.toggle('light', !isDark);

function Harness() {
  const [tab, setTab] = useState<'chats' | 'other'>('chats');
  // The dashboard navigates to the meeting room when a call is answered; the harness has no router, so it records where it would go.
  const chat = useDirectChat({
    enabled: Boolean(meId),
    meId,
    panelVisible: tab === 'chats',
    onJoinCall: (slug, mode) => { ((window as any).__joined ||= []).push({ slug, mode }); },
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <nav style={{ display: 'flex', gap: 8, padding: 8, height: 48, boxSizing: 'border-box', background: '#111827', color: '#e5e7eb' }}>
        <button data-testid="tab-chats" onClick={() => setTab('chats')}>
          Chats {chat.state.totalUnread > 0 && <span data-testid="menu-badge" className="dc-nav-badge">{badgeLabel(chat.state.totalUnread)}</span>}
        </button>
        <button data-testid="tab-other" onClick={() => setTab('other')}>Home</button>
      </nav>
      <div className="dashboard-tab-panel" style={{ flex: 1, minHeight: 0 }}>
        {tab === 'chats' ? <DirectChatPanel chat={chat} isDark={isDark} meId={meId} initialChatId={params.get('chat') || undefined} /> : <div style={{ color: '#fff', padding: 24 }}>Other dashboard tab</div>}
      </div>
      <DirectChatCallOverlay chat={chat} isDark={isDark} />
      <DirectChatToasts
        toasts={chat.toasts}
        isDark={isDark}
        onOpen={(id) => { chat.selectConversation(id); setTab('chats'); }}
        onDismiss={chat.dismissToast}
      />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);

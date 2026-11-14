// Direct chat -- source-level wiring and safety guards (same static-pattern convention as the other
// *-wiring tests here). The behaviour itself is covered by direct-chat-logic.test.cjs (client logic),
// the backend's direct-chat.test.cjs (real DB + real streaming) and the browser test.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const dashboard = read('src', 'pages', 'DashboardPage.tsx');
const dirFiles = (dir) => fs.readdirSync(path.join(root, dir)).map((f) => path.join(dir, f)).filter((f) => /\.(ts|tsx)$/.test(f));
const chatSources = [...dirFiles('src/lib/directChat'), ...dirFiles('src/components/directChat')].map((f) => ({ f, text: fs.readFileSync(path.join(root, f), 'utf8') }));

test('Chats is a real dashboard tab: in the type, the allowed-tab list (so ?tab=chats and refresh work) and the sidebar', () => {
  assert.match(dashboard, /type DashboardTab = [^;]*'chats'/);
  assert.match(dashboard, /VALID_DASHBOARD_TABS: DashboardTab\[\] = \[[^\]]*'chats'/);
  assert.match(dashboard, /key: 'chats', label: 'Chats', icon: <MessageCircle size=\{18\} \/>, badge: chat\.state\.totalUnread/);
});

test('the sidebar shows the unread count as a badge on the Chats entry, announced to screen readers', () => {
  assert.match(dashboard, /item\.badge \? <span className="dc-nav-badge"[^>]*aria-label=\{`\$\{item\.badge\} unread chat messages`\}>\{badgeLabel\(item\.badge\)\}<\/span> : null/);
});

test('the live chat connection is owned by the Dashboard (so badges and toasts work on every tab) and starts only for a signed-in user', () => {
  assert.match(dashboard, /const chat = useDirectChat\(\{\s*enabled: Boolean\(currentUser\?\.id\),\s*meId: String\(currentUser\?\.id \|\| ''\),\s*panelVisible: activeTab === 'chats',\s*(?:\/\/[^\r\n]*\s*)?onJoinCall: \(roomSlug, mode\) => navigate\(`\/meet\/\$\{encodeURIComponent\(roomSlug\)\}\?direct=1&call=\$\{mode\}`\),\s*\}\)/);
});

test('the Chats screen is rendered for the tab, fed from the same hook, and understands a ?chat=<id> deep link', () => {
  assert.match(dashboard, /activeTab === 'chats' \? \(\s*<DirectChatPanel\s+chat=\{chat\}\s+isDark=\{isDark\}\s+meId=\{String\(currentUser\?\.id \|\| ''\)\}\s+initialChatId=\{searchParams\.get\('chat'\) \|\| undefined\}/);
});

test('the Chats screen gets the same full-height, no-outer-scroll layout as Conversations', () => {
  assert.match(dashboard, /dashboard-layout \$\{activeTab === 'conversations' \|\| activeTab === 'chats' \? 'conversations-active-layout' : ''\}/);
  assert.match(dashboard, /\$\{activeTab === 'conversations' \|\| activeTab === 'chats' \? ' conversations-canvas' : ''\}/);
});

test('new-message toasts are mounted and clicking one opens that chat on the Chats tab', () => {
  assert.match(dashboard, /<DirectChatToasts\s+toasts=\{chat\.toasts\}[\s\S]{0,200}chat\.selectConversation\(conversationId\); setActiveTab\('chats'\);[\s\S]{0,120}onDismiss=\{chat\.dismissToast\}/);
});

test('the existing Conversations (meeting chat) and Notifications features are untouched', () => {
  assert.match(dashboard, /activeTab === 'conversations' \? \(\s*<ConversationsPanel/);
  assert.match(dashboard, /<NotificationToasts \/>/);
  assert.match(dashboard, /<NotificationBell isDark=\{isDark\} \/>/);
});

test('SAFETY: message text is rendered as text, never as HTML', () => {
  for (const { f, text } of chatSources) {
    assert.doesNotMatch(text, /dangerouslySetInnerHTML|\.innerHTML\s*=|insertAdjacentHTML|document\.write/, `${f} must not inject HTML`);
  }
});

test('SAFETY: auth tokens never go in a URL and message contents / tokens are never logged', () => {
  for (const { f, text } of chatSources) {
    assert.doesNotMatch(text, /[?&]token=/, `${f} must not put a token in a URL`);
    assert.doesNotMatch(text, /console\.(log|info|debug)\(/, `${f} must not log`);
  }
  const api = chatSources.find((s) => s.f.endsWith('api.ts')).text;
  assert.match(api, /Authorization: `Bearer \$\{await auth\.currentUser\.getIdToken\(\)\}`/);
  assert.match(api, /'X-Toowix-Session'/);
});

test('the live stream uses fetch streaming with the auth headers (EventSource cannot send them) and refreshes them on every reconnect', () => {
  const sse = chatSources.find((s) => s.f.endsWith('sse.ts')).text;
  assert.doesNotMatch(sse, /new EventSource/);
  assert.match(sse, /headers: await options\.getHeaders\(\)/);
});

test('sending is idempotent: every send carries a client id and a retry re-uses it', () => {
  const hook = chatSources.find((s) => s.f.endsWith('useDirectChat.ts')).text;
  assert.match(hook, /const clientId = newClientId\(\)/);
  assert.match(hook, /void deliver\(conversationId, message\.text, clientId\)/);
});

test('the composer sends on Enter, adds a line on Shift+Enter, and never sends mid-IME-composition', () => {
  const panel = chatSources.find((s) => s.f.endsWith('DirectChatPanel.tsx')).text;
  assert.match(panel, /e\.key === 'Enter' && !e\.shiftKey && !e\.nativeEvent\.isComposing/);
});

// ---------------- calls and the three-dot menu ----------------

const src = (name) => chatSources.find((s) => s.f.endsWith(name)).text;
const meetingRoom = read('src', 'pages', 'MeetingRoomPage.tsx');

test('the incoming/outgoing call card is mounted at dashboard level so a call rings on every tab', () => {
  assert.match(dashboard, /<DirectChatCallOverlay chat=\{chat\} isDark=\{isDark\} \/>/);
});

test('an answered call goes to the meeting room as a direct join, carrying the call mode', () => {
  assert.match(dashboard, /navigate\(`\/meet\/\$\{encodeURIComponent\(roomSlug\)\}\?direct=1&call=\$\{mode\}`\)/);
});

test('the chat header has a video (Toowix meeting) call, a voice call and a three-dot menu', () => {
  const header = src('ChatHeaderActions.tsx');
  assert.match(header, /data-testid="dc-video-call"[\s\S]{0,400}chat\.startCall\('video'\)/);
  assert.match(header, /data-testid="dc-voice-call"[\s\S]{0,400}chat\.startCall\('voice'\)/);
  assert.match(header, /data-testid="dc-menu-button"/);
  assert.match(src('DirectChatPanel.tsx'), /<ChatHeaderActions chat=\{chat\} active=\{active\}/);
});

test('the menu offers contact info, search, mute (8h / 1 week / always, and unmute), clear, delete, block/unblock and close', () => {
  const header = src('ChatHeaderActions.tsx');
  for (const label of ['Contact info', 'Search in chat', 'Mute notifications', 'Unmute notifications', 'Clear chat', 'Delete chat', 'Unblock', 'Block', 'Close chat']) {
    assert.ok(header.includes(label), `menu entry "${label}"`);
  }
  for (const id of ["'8h'", "'1w'", "'always'"]) assert.ok(header.includes(id), `mute choice ${id}`);
});

test('destructive menu actions (clear, delete, block) ask for confirmation first', () => {
  const header = src('ChatHeaderActions.tsx');
  assert.match(header, /setConfirm\('clear'\)/);
  assert.match(header, /setConfirm\('delete'\)/);
  assert.match(header, /setConfirm\('block'\)/);
  assert.match(header, /role="alertdialog"/);
});

test('a blocked chat swaps the message box for an Unblock bar and disables both call buttons', () => {
  const panel = src('DirectChatPanel.tsx');
  assert.match(panel, /active\.blockedByMe \? \(\s*<div className="dc-blocked"/);
  assert.match(src('ChatHeaderActions.tsx'), /const callDisabled = blocked \|\| calling/);
});

test('muted chats raise no toast or sound, and calls ring instead of toasting', () => {
  const hook = src('useDirectChat.ts');
  assert.match(hook, /event\.message\.kind !== 'call' && !isChatMuted\(/);
});

test('a voice call joins audio-only: camera off from the start, auto-join without video, audio-only quality once connected', () => {
  assert.match(meetingRoom, /\.get\('call'\) === 'voice'/);
  assert.match(meetingRoom, /useState\(!isVoiceCall\)/);
  assert.match(meetingRoom, /void handleJoinMeeting\(isVoiceCall\)/);
  assert.match(meetingRoom, /jitsiMeeting\.setLowDataMode\('audio-only'\)/);
});

test('the call room is never created through the meeting-creation path that e-mails the whole company', () => {
  for (const { f, text } of chatSources) {
    assert.doesNotMatch(text, /\/api\/meetings(?!\/room)/, `${f} must not call the meeting-creation API`);
  }
});

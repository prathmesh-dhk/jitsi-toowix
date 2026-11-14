// Direct chat -- client-side logic tests. Loads the REAL TypeScript sources (state reducer, formatting,
// streaming client) through ts.transpileModule + vm, exactly like the other pure-logic tests here; no
// React rendering and no network except a fake in-memory fetch for the stream client.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const LIB = path.join(__dirname, '..', 'src', 'lib', 'directChat');
const cache = new Map();

function load(name) {
  if (cache.has(name)) return cache.get(name);
  const source = fs.readFileSync(path.join(LIB, `${name}.ts`), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  const context = {
    exports,
    require: (id) => {
      const local = id.match(/^\.\/(\w+)$/);
      if (local) return load(local[1]);
      throw new Error(`unexpected require in ${name}: ${id}`);
    },
    console, setTimeout, clearTimeout, TextDecoder, AbortController, Promise, Date, Math, JSON, Error, Array, Map, Set, Number, String, Object, globalThis: {},
    fetch: undefined,
  };
  context.globalThis = context;
  vm.runInNewContext(code, context);
  cache.set(name, exports);
  return exports;
}

const { chatReducer, initialChatState, advanceStatus, mergeMessages } = load('state');
const fmt = load('format');
const sse = load('sse');

// Values built inside the vm sandbox carry that realm's Array/Object prototypes, which strict deepEqual rejects even
// when the data is identical -- compare plain JSON copies instead.
const plain = (value) => JSON.parse(JSON.stringify(value));
const same = (actual, expected, message) => assert.deepEqual(plain(actual), plain(expected), message);

const ME = 'u-me';
const PEER = { id: 'u-peer', name: 'Bob Stone', avatarUrl: null };

const msg = (over = {}) => ({
  id: 'm1', clientId: null, conversationId: 'c1', senderId: PEER.id, recipientId: ME, text: 'hi',
  createdAt: '2026-03-10T10:00:00.000Z', status: 'sent', ...over,
});
const conv = (over = {}) => ({ id: 'c1', peer: PEER, lastMessage: null, unreadCount: 0, updatedAt: '2026-03-10T09:00:00.000Z', ...over });
const reduce = (state, ...actions) => actions.reduce((s, a) => chatReducer(s, a), state);
const stream = (event) => ({ type: 'stream', meId: ME, event });
const ids = (list) => list.map((m) => m.id);

// ================= state: statuses and merging =================

test('a message status only ever moves forward (sent -> delivered -> read), never back', () => {
  assert.equal(advanceStatus('sent', 'delivered'), 'delivered');
  assert.equal(advanceStatus('delivered', 'read'), 'read');
  assert.equal(advanceStatus('read', 'delivered'), 'read');
  assert.equal(advanceStatus('read', 'sent'), 'read');
  assert.equal(advanceStatus('pending', 'sent'), 'sent');
  assert.equal(advanceStatus('delivered', 'sent'), 'delivered');
});

test('mergeMessages: same id twice is one message, result is ordered by time then id', () => {
  const merged = mergeMessages([msg({ id: 'b', createdAt: '2026-03-10T10:00:02.000Z' })], [
    msg({ id: 'a', createdAt: '2026-03-10T10:00:01.000Z' }), msg({ id: 'b', createdAt: '2026-03-10T10:00:02.000Z' }),
    msg({ id: 'c0', createdAt: '2026-03-10T10:00:03.000Z' }), msg({ id: 'c1', createdAt: '2026-03-10T10:00:03.000Z' }),
  ]);
  same(ids(merged), ['a', 'b', 'c0', 'c1']);
});

test('mergeMessages: a local pending bubble and the server copy (same clientId) become ONE message, and a late "sent" cannot undo "read"', () => {
  const pending = msg({ id: 'local-x', clientId: 'x', senderId: ME, status: 'pending' });
  const server = msg({ id: 'srv-1', clientId: 'x', senderId: ME, status: 'sent' });
  const merged = mergeMessages([pending], [server]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'srv-1');
  assert.equal(merged[0].status, 'sent');
  const readAlready = mergeMessages([{ ...server, status: 'read' }], [server]);
  assert.equal(readAlready[0].status, 'read');
  const wasFailed = mergeMessages([msg({ id: 'local-y', clientId: 'y', status: 'failed' })], [msg({ id: 'srv-2', clientId: 'y', status: 'sent' })]);
  assert.equal(wasFailed[0].status, 'sent');
});

// ================= state: conversation list =================

test('conversationsLoaded: newest first, unread total set, and a just-opened empty chat is kept until it has a message', () => {
  const draft = conv({ id: 'draft', lastMessage: null });
  const s1 = reduce({ ...initialChatState, conversations: [draft] }, {
    type: 'conversationsLoaded', totalUnread: 3,
    conversations: [
      conv({ id: 'old', updatedAt: '2026-03-09T10:00:00.000Z', lastMessage: { id: 'x', text: 'a', senderId: PEER.id, at: '2026-03-09T10:00:00.000Z' } }),
      conv({ id: 'new', updatedAt: '2026-03-10T10:00:00.000Z', lastMessage: { id: 'y', text: 'b', senderId: PEER.id, at: '2026-03-10T10:00:00.000Z' } }),
    ],
  });
  same(s1.conversations.map((c) => c.id), ['new', 'old', 'draft']);
  assert.equal(s1.totalUnread, 3);
  const s2 = reduce(s1, { type: 'conversationsLoaded', totalUnread: 0, conversations: [conv({ id: 'draft', lastMessage: { id: 'z', text: 'now real', senderId: ME, at: '2026-03-10T11:00:00.000Z' }, updatedAt: '2026-03-10T11:00:00.000Z' })] });
  same(s2.conversations.map((c) => c.id), ['draft'], 'once the server lists it, no duplicate remains');
});

test('conversationOpened adds a new chat on top once, and never duplicates an existing one', () => {
  const s1 = reduce(initialChatState, { type: 'conversationOpened', conversation: conv() });
  const s2 = reduce(s1, { type: 'conversationOpened', conversation: conv({ peer: { ...PEER, name: 'Robert Stone' } }) });
  assert.equal(s2.conversations.length, 1);
  assert.equal(s2.conversations[0].peer.name, 'Robert Stone');
});

// ================= state: sending =================

test('optimistic send shows a pending bubble at once, updates the chat preview and moves the chat to the top', () => {
  const start = { ...initialChatState, conversations: [conv({ id: 'a', updatedAt: '2026-03-10T09:00:00.000Z' }), conv({ id: 'c1', updatedAt: '2026-03-01T09:00:00.000Z' })] };
  const s = reduce(start, { type: 'optimisticSend', message: msg({ id: 'local-k', clientId: 'k', senderId: ME, recipientId: PEER.id, text: 'hello', status: 'pending', createdAt: '2026-03-10T12:00:00.000Z' }) });
  assert.equal(s.messages.c1.length, 1);
  assert.equal(s.messages.c1[0].status, 'pending');
  assert.equal(s.conversations[0].id, 'c1');
  assert.equal(s.conversations[0].lastMessage.text, 'hello');
});

test('send success replaces the pending bubble in place (no duplicate), even if the live echo arrived first', () => {
  const pending = msg({ id: 'local-k', clientId: 'k', senderId: ME, recipientId: PEER.id, status: 'pending' });
  const server = { ...pending, id: 'srv-9', status: 'sent', createdAt: '2026-03-10T10:00:01.000Z' };
  const base = reduce({ ...initialChatState, conversations: [conv()] }, { type: 'optimisticSend', message: pending });
  const normal = reduce(base, { type: 'sendSucceeded', clientId: 'k', message: server });
  same(ids(normal.messages.c1), ['srv-9']);
  assert.equal(normal.messages.c1[0].status, 'sent');
  const echoFirst = reduce(base, stream({ type: 'message', conversationId: 'c1', message: server, peer: PEER, unreadCount: 0, totalUnread: 0 }), { type: 'sendSucceeded', clientId: 'k', message: server });
  same(ids(echoFirst.messages.c1), ['srv-9']);
});

test('a failed send is marked failed, retry makes it pending again, and only the matching message is touched', () => {
  const a = msg({ id: 'local-a', clientId: 'a', senderId: ME, status: 'pending' });
  const b = msg({ id: 'local-b', clientId: 'b', senderId: ME, status: 'pending', createdAt: '2026-03-10T10:00:05.000Z' });
  const sent = msg({ id: 'm-done', clientId: 'done', senderId: ME, status: 'sent', createdAt: '2026-03-10T09:59:00.000Z' });
  const s0 = { ...initialChatState, conversations: [conv()], messages: { c1: [sent, a, b] } };
  const failed = reduce(s0, { type: 'sendFailed', conversationId: 'c1', clientId: 'a' });
  same(failed.messages.c1.map((m) => m.status), ['sent', 'failed', 'pending']);
  const retrying = reduce(failed, { type: 'sendRetrying', conversationId: 'c1', clientId: 'a' });
  assert.equal(retrying.messages.c1[1].status, 'pending');
  const untouched = reduce(s0, { type: 'sendFailed', conversationId: 'c1', clientId: 'done' });
  assert.equal(untouched.messages.c1[0].status, 'sent', 'an already-sent message can never become failed');
});

// ================= state: live events =================

test('an incoming message appears at the bottom, the chat jumps to the top with the right unread count and total', () => {
  const start = { ...initialChatState, conversations: [conv({ id: 'other', updatedAt: '2026-03-10T09:30:00.000Z' }), conv()] };
  const s = reduce(start, stream({ type: 'message', conversationId: 'c1', message: msg({ text: 'are you there?' }), peer: PEER, unreadCount: 2, totalUnread: 5 }));
  assert.equal(s.messages.c1[0].text, 'are you there?');
  assert.equal(s.conversations[0].id, 'c1');
  assert.equal(s.conversations[0].unreadCount, 2);
  assert.equal(s.conversations[0].lastMessage.text, 'are you there?');
  assert.equal(s.totalUnread, 5);
});

test('a message from someone never chatted with before creates their chat on the spot, using the peer sent with the event', () => {
  const s = reduce(initialChatState, stream({ type: 'message', conversationId: 'brand-new', message: msg({ conversationId: 'brand-new', text: 'hi!' }), peer: PEER, unreadCount: 1, totalUnread: 1 }));
  assert.equal(s.conversations.length, 1);
  assert.equal(s.conversations[0].id, 'brand-new');
  assert.equal(s.conversations[0].peer.name, 'Bob Stone');
  assert.equal(s.conversations[0].unreadCount, 1);
});

test('the same live event delivered twice (reconnect replay) never creates a second bubble', () => {
  const event = stream({ type: 'message', conversationId: 'c1', message: msg(), peer: PEER, unreadCount: 1, totalUnread: 1 });
  const s = reduce({ ...initialChatState, conversations: [conv()] }, event, event, event);
  assert.equal(s.messages.c1.length, 1);
});

test('my own message echoed from another tab is shown but does not count as unread', () => {
  const mine = msg({ id: 'm-mine', senderId: ME, recipientId: PEER.id, text: 'sent elsewhere' });
  const s = reduce({ ...initialChatState, conversations: [conv()] }, stream({ type: 'message', conversationId: 'c1', message: mine, peer: PEER, unreadCount: 0, totalUnread: 0 }));
  assert.equal(s.messages.c1.length, 1);
  assert.equal(s.conversations[0].unreadCount, 0);
});

test('delivered receipts tick only the listed messages and the chat preview, and never downgrade a read message', () => {
  const m1 = msg({ id: 'a', senderId: ME, status: 'sent' });
  const m2 = msg({ id: 'b', senderId: ME, status: 'sent', createdAt: '2026-03-10T10:00:01.000Z' });
  const m3 = msg({ id: 'c', senderId: ME, status: 'read', createdAt: '2026-03-10T10:00:02.000Z' });
  const start = { ...initialChatState, messages: { c1: [m1, m2, m3] }, conversations: [conv({ lastMessage: { id: 'c', text: 'x', senderId: ME, at: m3.createdAt, status: 'read' } })] };
  const s = reduce(start, stream({ type: 'delivered', conversationId: 'c1', messageIds: ['a', 'c'], at: 'x' }));
  same(s.messages.c1.map((m) => m.status), ['delivered', 'sent', 'read']);
  assert.equal(s.conversations[0].lastMessage.status, 'read');
});

test('a read receipt turns every message I sent in that chat blue, but leaves their messages and other chats alone', () => {
  const mine = msg({ id: 'a', senderId: ME, status: 'delivered' });
  const theirs = msg({ id: 'b', senderId: PEER.id, status: 'sent', createdAt: '2026-03-10T10:00:01.000Z' });
  const otherChatMine = msg({ id: 'z', conversationId: 'c2', senderId: ME, status: 'delivered' });
  const start = { ...initialChatState, messages: { c1: [mine, theirs], c2: [otherChatMine] }, conversations: [conv({ lastMessage: { id: 'a', text: 'x', senderId: ME, at: mine.createdAt, status: 'delivered' } })] };
  const s = reduce(start, stream({ type: 'read', conversationId: 'c1', readerId: PEER.id, at: 'x' }));
  assert.equal(s.messages.c1[0].status, 'read');
  assert.equal(s.messages.c1[1].status, 'sent');
  assert.equal(s.messages.c2[0].status, 'delivered');
  assert.equal(s.conversations[0].lastMessage.status, 'read');
});

test('out-of-order receipts: "read" followed by a late "delivered" stays read', () => {
  const start = { ...initialChatState, messages: { c1: [msg({ id: 'a', senderId: ME, status: 'sent' })] }, conversations: [conv()] };
  const s = reduce(start, stream({ type: 'read', conversationId: 'c1', readerId: PEER.id, at: 'x' }), stream({ type: 'delivered', conversationId: 'c1', messageIds: ['a'], at: 'y' }));
  assert.equal(s.messages.c1[0].status, 'read');
});

test('unread / ready / markedRead keep the per-chat badge and the menu total correct', () => {
  const start = { ...initialChatState, conversations: [conv({ unreadCount: 4 })], totalUnread: 4 };
  assert.equal(reduce(start, stream({ type: 'ready', totalUnread: 9 })).totalUnread, 9);
  const cleared = reduce(start, stream({ type: 'unread', conversationId: 'c1', unreadCount: 0, totalUnread: 0 }));
  assert.equal(cleared.conversations[0].unreadCount, 0);
  assert.equal(cleared.totalUnread, 0);
  const marked = reduce(start, { type: 'markedRead', conversationId: 'c1', totalUnread: 1 });
  assert.equal(marked.conversations[0].unreadCount, 0);
  assert.equal(marked.totalUnread, 1);
});

test('messagesLoaded merges history in order without losing a pending local message, and remembers hasMore', () => {
  const pending = msg({ id: 'local-p', clientId: 'p', senderId: ME, status: 'pending', createdAt: '2026-03-10T12:00:00.000Z' });
  const start = { ...initialChatState, messages: { c1: [pending] } };
  const s = reduce(start, { type: 'messagesLoaded', conversationId: 'c1', hasMore: true, messages: [msg({ id: 'h1', createdAt: '2026-03-10T08:00:00.000Z' }), msg({ id: 'h2', createdAt: '2026-03-10T09:00:00.000Z' })] });
  same(ids(s.messages.c1), ['h1', 'h2', 'local-p']);
  assert.equal(s.hasMore.c1, true);
});

test('reducer purity: it never mutates the state it was given', () => {
  const start = { ...initialChatState, conversations: [conv()], messages: { c1: [msg()] } };
  const snapshot = JSON.stringify(start);
  reduce(start, stream({ type: 'message', conversationId: 'c1', message: msg({ id: 'm2' }), peer: PEER, unreadCount: 1, totalUnread: 1 }), { type: 'markedRead', conversationId: 'c1', totalUnread: 0 });
  assert.equal(JSON.stringify(start), snapshot);
});

// ================= formatting =================

const NOW = new Date(2026, 2, 10, 15, 30); // 10 Mar 2026, local time

test('time formatting: bubble time, list time (today / yesterday / weekday / date) and day labels', () => {
  const at = (y, mo, d, h, mi) => new Date(y, mo, d, h, mi).toISOString();
  assert.equal(fmt.formatBubbleTime(at(2026, 2, 10, 9, 5)), '09:05');
  assert.equal(fmt.formatBubbleTime('garbage'), '');
  assert.equal(fmt.formatListTime(at(2026, 2, 10, 14, 7), NOW), '14:07');
  assert.equal(fmt.formatListTime(at(2026, 2, 9, 23, 59), NOW), 'Yesterday');
  assert.match(fmt.formatListTime(at(2026, 2, 6, 10, 0), NOW), /^[A-Za-z]+$/, 'a weekday name within the week');
  assert.equal(fmt.formatListTime(at(2026, 0, 2, 10, 0), NOW), '02/01/2026');
  assert.equal(fmt.formatDayLabel(at(2026, 2, 10, 1, 0), NOW), 'Today');
  assert.equal(fmt.formatDayLabel(at(2026, 2, 9, 1, 0), NOW), 'Yesterday');
  assert.match(fmt.formatDayLabel(at(2025, 11, 25, 1, 0), NOW), /2025/);
});

test('message rows: a day separator wherever the date changes; the first bubble of each run gets the tail', () => {
  const at = (d, h, mi) => new Date(2026, 2, d, h, mi).toISOString();
  const rows = fmt.buildMessageRows([
    msg({ id: '1', senderId: 'a', createdAt: at(9, 10, 0) }), msg({ id: '2', senderId: 'a', createdAt: at(9, 10, 1) }),
    msg({ id: '3', senderId: 'b', createdAt: at(9, 10, 2) }), msg({ id: '4', senderId: 'b', clientId: 'cid', createdAt: at(10, 9, 0) }),
  ], NOW);
  same(rows.map((r) => (r.kind === 'day' ? `day:${r.label}` : `m${r.message.id}${r.groupStart ? '*' : ''}`)), ['day:Yesterday', 'm1*', 'm2', 'm3*', 'day:Today', 'm4*']);
  assert.equal(rows[rows.length - 1].key, 'c-cid', 'a message keeps its row key when its id changes from local to server');
});

test('avatars: initials and a stable colour per person', () => {
  assert.equal(fmt.initialsOf('Bob Stone'), 'BS');
  assert.equal(fmt.initialsOf('  alice  '), 'A');
  assert.equal(fmt.initialsOf('Mary Jane Watson'), 'MW');
  assert.equal(fmt.initialsOf(''), '?');
  assert.equal(fmt.avatarColor('Bob Stone'), fmt.avatarColor('Bob Stone'));
  assert.match(fmt.avatarColor('x'), /^#[0-9a-f]{6}$/);
});

test('chat list preview and badge', () => {
  const c = conv({ lastMessage: { id: 'x', text: 'see you', senderId: ME, at: 'x' } });
  assert.equal(fmt.previewText(c, ME), 'You: see you');
  assert.equal(fmt.previewText({ ...c, lastMessage: { ...c.lastMessage, senderId: PEER.id } }, ME), 'see you');
  assert.equal(fmt.previewText(conv(), ME), '');
  assert.equal(fmt.badgeLabel(7), '7');
  assert.equal(fmt.badgeLabel(99), '99');
  assert.equal(fmt.badgeLabel(100), '99+');
});

test('client ids are unique (they are what makes a retried send safe)', () => {
  assert.equal(new Set(Array.from({ length: 2000 }, () => fmt.newClientId())).size, 2000);
});

// ================= streaming client =================

const frame = (event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

test('sse parser: complete frames, partial tail kept, CRLF, comments / retry ignored, multi-line data joined', () => {
  const a = { type: 'ready', totalUnread: 2 };
  const b = { type: 'unread', conversationId: 'c1', unreadCount: 0, totalUnread: 0 };
  const one = sse.parseSseBuffer(`retry: 3000\n\n: ping\n\n${frame(a)}${frame(b)}event: mes`);
  same(one.events, [a, b]);
  assert.equal(one.rest, 'event: mes');
  same(sse.parseSseBuffer(frame(a).replace(/\n/g, '\r\n')).events, [a]);
  same(sse.parseSseBuffer('data: {"type":\ndata: "ready","totalUnread":1}\n\n').events, [{ type: 'ready', totalUnread: 1 }]);
});

test('sse parser: a broken or type-less frame is skipped, the next good one still arrives, and chunks split anywhere reassemble', () => {
  const good = { type: 'ready', totalUnread: 7 };
  same(sse.parseSseBuffer(`data: {not json}\n\ndata: {"x":1}\n\n${frame(good)}`).events, [good]);
  const whole = frame(good);
  for (let cut = 1; cut < whole.length; cut += 1) {
    const first = sse.parseSseBuffer(whole.slice(0, cut));
    const second = sse.parseSseBuffer(first.rest + whole.slice(cut));
    same([...first.events, ...second.events], [good], `split at ${cut}`);
  }
});

test('reconnect backoff grows 1s, 2s, 4s ... and is capped at 30s', () => {
  same([0, 1, 2, 3, 4, 5, 6, 20].map(sse.nextBackoff), [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
});

function fakeStreamResponse(chunks, { hold = false } = {}) {
  const encoder = new TextEncoder();
  let controllerRef;
  const body = new ReadableStream({
    start(controller) { controllerRef = controller; chunks.forEach((c) => controller.enqueue(encoder.encode(c))); if (!hold) controller.close(); },
  });
  return { ok: true, status: 200, body, close: () => controllerRef.close() };
}

test('stream client: connects with fresh headers, reports open, delivers events (even split across chunks), then reconnects after the server closes it', async () => {
  const events = []; const statuses = []; let opens = 0; let headerCalls = 0;
  const responses = [
    fakeStreamResponse([frame({ type: 'ready', totalUnread: 1 }).slice(0, 12), frame({ type: 'ready', totalUnread: 1 }).slice(12), frame({ type: 'unread', conversationId: 'c', unreadCount: 3, totalUnread: 3 })]),
    fakeStreamResponse([frame({ type: 'ready', totalUnread: 3 })], { hold: true }),
  ];
  const calls = [];
  const stop = sse.startChatStream({
    url: 'http://x/stream',
    getHeaders: async () => { headerCalls += 1; return { Authorization: `Bearer t${headerCalls}` }; },
    onEvent: (e) => events.push(e),
    onStatus: (s) => statuses.push(s),
    onOpen: () => { opens += 1; },
    fetchImpl: async (url, init) => { calls.push({ url, headers: init.headers }); return responses.shift(); },
  });
  const deadline = Date.now() + 5000;
  while (events.length < 3 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  stop();
  same(events.map((e) => e.type), ['ready', 'unread', 'ready']);
  assert.equal(opens, 2, 'onOpen fires on every (re)connection so the screen can re-sync');
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0].headers.Authorization, calls[1].headers.Authorization, 'auth headers are re-read on every attempt');
  assert.ok(statuses.includes('open') && statuses.includes('reconnecting'));
  assert.equal(statuses[statuses.length - 1], 'stopped');
});

test('stream client: a rejected connection (401) or network error keeps retrying with backoff; stop() ends it for good', async () => {
  let attempts = 0;
  const statuses = [];
  const stop = sse.startChatStream({
    url: 'http://x/stream', getHeaders: async () => ({}), onEvent: () => {}, onStatus: (s) => statuses.push(s),
    fetchImpl: async () => { attempts += 1; if (attempts === 1) return { ok: false, status: 401, body: null }; throw new Error('offline'); },
  });
  await new Promise((r) => setTimeout(r, 1300));
  assert.equal(attempts, 2, 'first retry after ~1s');
  stop();
  const afterStop = attempts;
  await new Promise((r) => setTimeout(r, 2300));
  assert.equal(attempts, afterStop, 'no attempts after stop()');
  assert.equal(statuses[statuses.length - 1], 'stopped');
});

// ================= calls and the three-dot menu: state =================

const callMsg = (over = {}) => msg({ id: 'call1', senderId: ME, recipientId: PEER.id, text: 'Voice call', kind: 'call', call: { mode: 'voice', status: 'ringing' }, ...over });

test('a call entry changes in place when the call is answered / declined / missed (no second bubble)', () => {
  let state = reduce(initialChatState,
    { type: 'conversationOpened', conversation: conv() },
    stream({ type: 'message', conversationId: 'c1', message: callMsg(), peer: PEER, unreadCount: 0, totalUnread: 0 }));
  same(state.messages.c1.map((m) => m.call.status), ['ringing']);
  state = reduce(state, stream({ type: 'callUpdate', conversationId: 'c1', message: callMsg({ call: { mode: 'voice', status: 'answered' } }) }));
  same(state.messages.c1.map((m) => m.call.status), ['answered']);
  assert.equal(state.messages.c1.length, 1);
});

test('settings event: mute and block flags land on the right chat only', () => {
  const state = reduce(initialChatState,
    { type: 'conversationsLoaded', conversations: [ conv(), conv({ id: 'c2' }) ], totalUnread: 0 },
    stream({ type: 'settings', conversationId: 'c1', mutedUntil: '2999-01-01T00:00:00.000Z', blockedByMe: true }));
  const c1 = state.conversations.find((c) => c.id === 'c1');
  const c2 = state.conversations.find((c) => c.id === 'c2');
  assert.equal(c1.mutedUntil, '2999-01-01T00:00:00.000Z');
  assert.equal(c1.blockedByMe, true);
  assert.equal(c2.mutedUntil, undefined);
});

test('cleared empties the open chat, its preview and its unread; other chats keep theirs', () => {
  const withMsgs = reduce(initialChatState,
    { type: 'conversationsLoaded', conversations: [ conv({ lastMessage: { id: 'm1', text: 'hi', senderId: PEER.id, at: '2026-03-10T10:00:00.000Z' }, unreadCount: 2 }), conv({ id: 'c2', unreadCount: 1 }) ], totalUnread: 3 },
    { type: 'messagesLoaded', conversationId: 'c1', messages: [ msg() ], hasMore: true },
    { type: 'messagesLoaded', conversationId: 'c2', messages: [ msg({ id: 'x', conversationId: 'c2' }) ], hasMore: false });
  const state = reduce(withMsgs, stream({ type: 'cleared', conversationId: 'c1' }));
  same(state.messages.c1, []);
  assert.equal(state.hasMore.c1, false);
  const c1 = state.conversations.find((c) => c.id === 'c1');
  assert.equal(c1.lastMessage, null);
  assert.equal(c1.unreadCount, 0);
  assert.equal(state.messages.c2.length, 1);
  assert.equal(state.conversations.find((c) => c.id === 'c2').unreadCount, 1);
});

test('removed drops the chat and its messages; a later message brings the chat back', () => {
  let state = reduce(initialChatState,
    { type: 'conversationsLoaded', conversations: [ conv({ lastMessage: { id: 'm1', text: 'hi', senderId: PEER.id, at: '2026-03-10T10:00:00.000Z' } }) ], totalUnread: 0 },
    { type: 'messagesLoaded', conversationId: 'c1', messages: [ msg() ], hasMore: false });
  state = reduce(state, stream({ type: 'removed', conversationId: 'c1' }));
  assert.equal(state.conversations.length, 0);
  assert.equal(state.messages.c1, undefined);
  state = reduce(state, stream({ type: 'message', conversationId: 'c1', message: msg({ id: 'm9', text: 'back' }), peer: PEER, unreadCount: 1, totalUnread: 1 }));
  assert.equal(state.conversations.length, 1);
  same(ids(state.messages.c1), ['m9']);
});

test('isChatMuted: true only while the mute end time is in the future ("always" is the year 9999)', () => {
  const { isChatMuted } = loadHook();
  const now = Date.parse('2026-03-10T10:00:00.000Z');
  assert.equal(isChatMuted({ mutedUntil: '2026-03-10T18:00:00.000Z' }, now), true);
  assert.equal(isChatMuted({ mutedUntil: '2026-03-10T09:59:59.000Z' }, now), false, 'expired mute');
  assert.equal(isChatMuted({ mutedUntil: '9999-12-31T00:00:00.000Z' }, now), true);
  assert.equal(isChatMuted({ mutedUntil: null }, now), false);
  assert.equal(isChatMuted({}, now), false);
  assert.equal(isChatMuted(null, now), false);
});

// Only the exported isChatMuted helper is needed from the hook file; its React / API imports are stubbed out.
function loadHook() {
  const source = fs.readFileSync(path.join(LIB, 'useDirectChat.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React } }).outputText;
  const exports = {};
  const noop = new Proxy({}, { get: () => () => undefined });
  vm.runInNewContext(code, { exports, require: () => noop, console, Date, Boolean, Math, JSON, Set, Promise, document: undefined, window: undefined, Notification: undefined });
  return exports;
}

/* Direct chat -- full-stack browser test. Real everything except the identity provider:
 *   - a THROWAWAY local mongod (never Atlas; every write is guarded by a localhost assertion),
 *   - the REAL Express backend (toowix-backend/dist) in this process,
 *   - the REAL chat UI served by Vite (tests/e2e harness mounts DirectChatPanel + useDirectChat exactly like
 *     DashboardPage does; only src/lib/firebase.ts is swapped for a stub that hands out `token-<uid>`),
 *   - TWO real headless Chrome windows (Alice and Bob) driven over CDP, with real typing, clicks and keys.
 * Requires: `npm run build` in toowix-backend first. Usage: node tests/e2e/direct-chat-browser.cjs
 * Screenshots are written to tests/e2e/screenshots/. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const WebSocket = require('../../../node_modules/ws');

const BACKEND = path.resolve(__dirname, '..', '..', '..', 'toowix-backend');
const SHOTS = path.join(__dirname, 'screenshots');
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
process.env.DIRECT_CALL_RING_MS = '1500'; // an unanswered call becomes "missed" after 1.5s here instead of 45s
fs.mkdirSync(SHOTS, { recursive: true });

function findMongod() {
  if (process.env.MONGOD_BIN && fs.existsSync(process.env.MONGOD_BIN)) return process.env.MONGOD_BIN;
  const dir = path.join(os.homedir(), '.cache', 'mongodb-binaries');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith('mongod-')).sort().reverse() : [];
  const pick = files.find((f) => f.includes('7.0')) || files[0];
  return pick ? path.join(dir, pick) : null;
}
const freePort = () => new Promise((resolve) => { const s = require('node:net').createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

// ---------------- results ----------------
const results = [];
async function check(name, fn) {
  const started = Date.now();
  try { await fn(); results.push({ name, ok: true }); console.log(`  \u2714 ${name} (${Date.now() - started}ms)`); }
  catch (error) { results.push({ name, ok: false, error }); console.log(`  \u2716 ${name}\n      ${String(error && error.message || error).split('\n').join('\n      ')}`); }
}

// ---------------- minimal CDP browser ----------------
async function launchBrowser(label, width, height) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `chat-e2e-${label}-`));
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, `--window-size=${width},${height}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  let port;
  for (let i = 0; i < 150 && !port; i += 1) { try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch { await delay(100); } }
  assert.ok(port, `${label}: Chrome did not start`);
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.once('open', r));
  const pending = new Map(); let id = 0; const problems = [];
  ws.on('message', (raw) => {
    const data = JSON.parse(raw);
    if (data.id && pending.has(data.id)) { const p = pending.get(data.id); pending.delete(data.id); data.error ? p.reject(new Error(data.error.message)) : p.resolve(data.result); return; }
    if (data.method === 'Runtime.exceptionThrown') problems.push(`exception: ${data.params.exceptionDetails.exception?.description || data.params.exceptionDetails.text}`);
    if (data.method === 'Runtime.consoleAPICalled' && data.params.type === 'error') problems.push(`console.error: ${data.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const i = ++id; pending.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`${label}: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  };
  const until = async (expression, what, ms = 8000) => {
    const deadline = Date.now() + ms; let last;
    while (Date.now() < deadline) { try { last = await evaluate(expression); if (last) return last; } catch (e) { last = e.message; } await delay(60); }
    const body = await evaluate('document.body ? document.body.innerText.slice(0, 500) : "(no body)"').catch(() => '?');
    throw new Error(`${label}: timed out waiting for ${what}\n  expression: ${expression}\n  last: ${JSON.stringify(last)}\n  page text: ${JSON.stringify(body)}`);
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const api = {
    label, send, evaluate, until, problems,
    async open(url, uid) {
      await send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('e2e_uid', ${JSON.stringify(uid)}); localStorage.setItem('toowix_session_token', 'sess-${uid}');` });
      await send('Page.navigate', { url });
    },
    async viewport(w, h, mobile = false) { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile }); await delay(150); },
    click: (sel) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error('no element: ${sel.replace(/'/g, '')}'); el.click(); return true; })()`),
    clickText: (sel, text) => evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.innerText.includes(${JSON.stringify(text)})); if (!el) throw new Error('no ${sel.replace(/'/g, '')} containing ${text.replace(/'/g, '')}'); el.click(); return true; })()`),
    async type(sel, text) { await evaluate(`document.querySelector(${JSON.stringify(sel)}).focus()`); await send('Input.insertText', { text }); },
    async key(key, modifiers = 0) {
      const code = key === 'Enter' ? 13 : 0;
      // type 'keyDown' + text '\r' is what makes Chrome perform Enter's default action (a new line in a textarea) like a
      // real keyboard does; the app's handler cancels that default for a plain Enter, and leaves it for Shift+Enter.
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers, text: key === 'Enter' ? '\r' : undefined });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers });
    },
    async shot(name) { const { data } = await send('Page.captureScreenshot', { format: 'png' }); const file = path.join(SHOTS, `${name}.png`); fs.writeFileSync(file, Buffer.from(data, 'base64')); return file; },
    async close() { try { ws.close(); } catch { /* */ } proc.kill(); await delay(300); try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* chrome may still hold it */ } },
  };
  return api;
}

const texts = (sel) => `[...document.querySelectorAll(${JSON.stringify(sel)})].map((e) => e.innerText)`;
const has = (sel, text) => `[...document.querySelectorAll(${JSON.stringify(sel)})].some((e) => e.innerText.includes(${JSON.stringify(text)}))`;

async function main() {
  const mongodBin = findMongod();
  assert.ok(mongodBin, 'no mongod binary found (set MONGOD_BIN)');
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-e2e-mongo-'));
  const dbPort = await freePort();
  const mongod = spawn(mongodBin, ['--dbpath', dbDir, '--port', String(dbPort), '--bind_ip', '127.0.0.1'], { stdio: 'ignore', windowsHide: true });
  process.env.MONGODB_URI = `mongodb://127.0.0.1:${dbPort}/chat_e2e`; // BEFORE any backend module loads
  const mongoose = require(path.join(BACKEND, 'node_modules', 'mongoose'));
  let connected = false;
  for (let i = 0; i < 60 && !connected; i += 1) { try { await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 1000 }); connected = true; } catch { await delay(250); } }
  assert.ok(connected, 'could not connect to throwaway mongod');
  assert.equal(mongoose.connection.host, '127.0.0.1', 'SAFETY: only the local throwaway database may be written');

  const load = (p) => require(path.join(BACKEND, 'dist', 'src', p));
  const { User } = load('models/User'); const { Session } = load('models/Session'); const { Notification } = load('models/Notification');
  const { DirectConversation } = load('models/DirectConversation'); const { DirectMessage } = load('models/DirectMessage'); const { DirectChatSettings } = load('models/DirectChatSettings'); const { Meeting } = load('models/Meeting');
  const firebase = load('config/firebase');
  await Promise.all([User, Session, Notification, DirectConversation, DirectMessage, DirectChatSettings, Meeting].map((m) => m.init()));
  try { await User.collection.dropIndex('keycloakSub_1'); } catch { /* not built */ } // known unrelated defect, see backend direct-chat.test.cjs
  firebase.getFirebaseAuth = () => ({ verifyIdToken: async (token) => { if (!String(token).startsWith('token-')) throw new Error('bad token'); const uid = String(token).slice(6); return { uid, email: `${uid.replace('fb-', '')}@example.com`, email_verified: true }; } });

  const mk = async (key, fullName, extra = {}) => {
    const doc = await User.create({ firebaseUid: `fb-${key}`, email: `${key}@example.com`, fullName, status: 'ACTIVE', role: 'MEMBER', emailVerifiedAt: new Date(), ...extra });
    await Session.create({ userId: doc._id, sessionToken: `sess-fb-${key}`, userAgent: 't', browser: 'x', os: 'y', ipAddress: '127.0.0.1' });
    return { key, id: String(doc._id), uid: `fb-${key}`, fullName };
  };
  const alice = await mk('alice', 'Alice Anderson'); const bob = await mk('bob', 'Bob Stone'); const carol = await mk('carol', 'Carol Stonehouse');
  await mk('dave', 'Dave Suspended', { status: 'SUSPENDED' }); await mk('erin', 'Erin Unverified', { emailVerifiedAt: null });

  const app = load('index').default;
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const backendUrl = `http://127.0.0.1:${server.address().port}`;
  const authFor = (u) => ({ 'Content-Type': 'application/json', Authorization: `Bearer token-${u.uid}`, 'X-Toowix-Session': `sess-${u.uid}` });
  const rest = async (u, method, p, body) => (await fetch(`${backendUrl}/api/direct-chat${p}`, { method, headers: authFor(u), body: body && JSON.stringify(body) })).json();

  const { createServer } = await import('vite');
  const makeConfig = (await import('./vite.chat-e2e.config.mjs')).default;
  const vite = await createServer(makeConfig(backendUrl));
  await vite.listen();
  const base = vite.resolvedUrls.local[0].replace(/\/$/, '');
  const pageUrl = (who, extra = '') => `${base}/chat-harness.html?me=${who.id}${extra}`;
  console.log(`backend ${backendUrl}  |  ui ${base}  |  throwaway db 127.0.0.1:${dbPort}\n`);

  const A = await launchBrowser('alice', 1180, 760);
  const B = await launchBrowser('bob', 1180, 760);
  const cleanup = async () => { await A.close(); await B.close(); await vite.close(); await new Promise((r) => { server.closeAllConnections?.(); server.close(r); }); await mongoose.disconnect(); mongod.kill(); await delay(500); try { fs.rmSync(dbDir, { recursive: true, force: true }); } catch { /* */ } };

  try {
    await A.open(pageUrl(alice), alice.uid);
    await B.open(pageUrl(bob), bob.uid);

    console.log('Opening the app');
    await check('both people see the Chats screen: search box, empty state, and a live connection', async () => {
      for (const who of [A, B]) {
        await who.until(`!!document.querySelector('.dc-root')`, 'the chat screen to render', 40000);
        await who.until(`document.querySelector('input[type=search]')?.placeholder === 'Search or start a new chat'`, 'search box');
        await who.until(`document.querySelector('.dc-empty h3')?.innerText === 'Toowix Chats'`, 'empty state');
        await who.until(`document.querySelector('.dc-conn')?.innerText.includes('Live')`, 'live connection', 15000);
        await who.until(`${has('.dc-hint', 'No chats yet')}`, 'no-chats hint');
      }
    });

    console.log('Finding someone');
    await check('search finds a registered user by name and shows only a masked email', async () => {
      await A.type('input[type=search]', 'bo');
      await A.until(has('.dc-item', 'Bob Stone'), 'Bob in the results', 8000);
      const rows = await A.evaluate(texts('.dc-item'));
      assert.ok(rows.some((r) => r.includes('b***@example.com')), `masked email missing: ${JSON.stringify(rows)}`);
      assert.ok(!rows.join().includes('bob@example.com'), 'full email must never be shown');
      assert.ok(!rows.join().match(/Carol|Dave|Erin|Alice/), `unexpected people listed: ${JSON.stringify(rows)}`);
    });
    await check('search hides suspended and unverified people, shows "no one found", and asks for 2+ characters', async () => {
      await A.evaluate(`(() => { const i = document.querySelector('input[type=search]'); i.focus(); i.select(); })()`);
      await A.type('input[type=search]', 'zzzz');
      await A.until(has('.dc-hint', 'No one found'), 'no-one-found hint');
      await A.evaluate(`(() => { const i = document.querySelector('input[type=search]'); i.focus(); i.select(); })()`);
      await A.type('input[type=search]', 'erin');
      await A.until(has('.dc-hint', 'No one found'), 'unverified user hidden');
      await A.evaluate(`(() => { const i = document.querySelector('input[type=search]'); i.focus(); i.select(); })()`);
      await A.type('input[type=search]', 'd');
      await A.until(has('.dc-hint', 'at least 2 characters'), 'min length hint');
    });

    console.log('Starting a chat and saying hi');
    await check('clicking a search result opens the chat with a message box, and clears the search', async () => {
      await A.evaluate(`(() => { const i = document.querySelector('input[type=search]'); i.focus(); i.select(); })()`);
      await A.type('input[type=search]', 'bob');
      await A.until(has('.dc-item', 'Bob Stone'), 'Bob in the results');
      await A.clickText('.dc-item', 'Bob Stone');
      await A.until(`document.querySelector('.dc-chat-header strong')?.innerText === 'Bob Stone'`, 'chat header');
      await A.until(`document.querySelector('.dc-composer textarea') && document.querySelector('input[type=search]').value === ''`, 'composer shown, search cleared');
      await A.until(has('.dc-older', 'Say hi'), 'empty chat hint');
    });
    await check('typing "hi" and pressing Enter shows the bubble with delivery ticks (Bob is online)', async () => {
      await A.type('.dc-composer textarea', 'hi');
      await A.key('Enter');
      await A.until(`${has('.dc-out .dc-text', 'hi')}`, 'Alice bubble');
      await A.until(`!!document.querySelector('.dc-out [aria-label="Delivered"], .dc-out .dc-tick-read')`, 'delivered tick');
      assert.equal(await A.evaluate(`document.querySelector('.dc-composer textarea').value`), '', 'composer is cleared after sending');
    });

    console.log('The other person is notified');
    await check('Bob gets it instantly: unread badge on the chat, menu badge, tab title and a toast', async () => {
      await B.until(`${has('.dc-item', 'Alice Anderson')}`, 'Alice chat in Bob list', 6000);
      assert.equal(await B.evaluate(`document.querySelector('.dc-item .dc-badge')?.innerText`), '1');
      assert.match(await B.evaluate(`document.querySelector('.dc-item .dc-preview')?.innerText`), /^hi$/);
      assert.equal(await B.evaluate(`document.querySelector('[data-testid=menu-badge]')?.innerText`), '1');
      assert.match(await B.evaluate(`document.title`), /^\(1\) /);
      await B.until(`${has('.dc-toast', 'Alice Anderson')} && ${has('.dc-toast', 'hi')}`, 'toast');
      await B.shot('bob-1-new-message-badge-and-toast');
    });
    await check('opening the chat clears the badge and title, and Alice\'s ticks turn blue ("read")', async () => {
      await B.clickText('.dc-item', 'Alice Anderson');
      await B.until(`document.querySelector('.dc-chat-header strong')?.innerText === 'Alice Anderson'`, 'chat open');
      await B.until(`${has('.dc-in .dc-text', 'hi')}`, 'the message in the chat');
      await B.until(`!document.querySelector('.dc-badge') && !document.querySelector('[data-testid=menu-badge]') && !/^\\(/.test(document.title)`, 'unread cleared', 6000);
      await A.until(`!!document.querySelector('.dc-out .dc-tick-read')`, 'blue ticks on Alice', 6000);
      await A.shot('alice-2-read-ticks');
    });

    console.log('Chatting back and forth');
    await check('Bob\'s reply reaches Alice at once; she is looking at the chat so it is read immediately (no badge, no toast)', async () => {
      await B.type('.dc-composer textarea', 'hello Alice \u{1F44B}');
      await B.key('Enter');
      await A.until(`${has('.dc-in .dc-text', 'hello Alice \u{1F44B}')}`, 'reply on Alice');
      await delay(500);
      assert.equal(await A.evaluate(`!!document.querySelector('.dc-badge')`), false, 'no unread badge for the open chat');
      assert.equal(await A.evaluate(`!!document.querySelector('.dc-toast')`), false, 'no toast for the open chat');
      await B.until(`!!document.querySelector('.dc-out .dc-tick-read')`, 'Bob blue ticks', 6000);
    });
    await check('Shift+Enter adds a new line, Enter sends it as one multi-line message', async () => {
      await A.type('.dc-composer textarea', 'line one');
      await A.key('Enter', 8);
      await A.type('.dc-composer textarea', 'line two');
      await A.key('Enter');
      await B.until(`[...document.querySelectorAll('.dc-in .dc-text')].some((e) => e.innerText.includes('line one\\nline two'))`, 'multi-line message on Bob');
    });
    await check('message text is shown as plain text: HTML in a message never runs or renders', async () => {
      const evil = '<img src=x onerror="window.__xss=1"><b>bold</b>';
      await A.type('.dc-composer textarea', evil);
      await A.key('Enter');
      await B.until(`${has('.dc-in .dc-text', evil)}`, 'literal markup on Bob');
      await delay(400);
      assert.equal(await B.evaluate(`typeof window.__xss`), 'undefined', 'script must not have run');
      assert.equal(await B.evaluate(`document.querySelectorAll('.dc-text img, .dc-text b').length`), 0, 'no elements created from message text');
    });

    console.log('When the network misbehaves');
    await check('a send that fails shows "Not sent · Retry"; retrying delivers it exactly once', async () => {
      await A.evaluate(`(() => { const real = window.fetch.bind(window); window.__failNext = true; window.fetch = (u, i) => { if (window.__failNext && String(u).endsWith('/messages') && i && i.method === 'POST') { window.__failNext = false; return Promise.reject(new TypeError('Failed to fetch')); } return real(u, i); }; })()`);
      await A.type('.dc-composer textarea', 'retry me');
      await A.key('Enter');
      await A.until(`!!document.querySelector('.dc-failed') && ${has('.dc-retry', 'Retry')}`, 'failed bubble with Retry');
      await A.until(`${has('.dc-send-error', 'offline')}`, 'friendly offline message');
      await A.shot('alice-3-failed-send');
      await A.click('.dc-retry');
      await A.until(`!document.querySelector('.dc-failed')`, 'bubble recovers');
      await B.until(`${has('.dc-in .dc-text', 'retry me')}`, 'delivered to Bob');
      await delay(400);
      assert.equal(await A.evaluate(`${texts('.dc-out .dc-text')}.filter((t) => t === 'retry me').length`), 1, 'exactly one bubble on Alice');
      assert.equal(await B.evaluate(`${texts('.dc-in .dc-text')}.filter((t) => t === 'retry me').length`), 1, 'exactly one bubble on Bob');
      assert.equal(await DirectMessage.countDocuments({ text: 'retry me' }), 1, 'exactly one row in the database');
    });
    await check('if the server connection drops, both screens reconnect by themselves and catch up on what they missed', async () => {
      server.closeAllConnections();
      await rest(alice, 'POST', `/conversations/${(await DirectConversation.findOne({}).lean())._id}/messages`, { text: 'sent while you were away', clientId: 'away-1' });
      await B.until(`${has('.dc-in .dc-text', 'sent while you were away')}`, 'missed message to appear after reconnect', 15000);
      await B.until(`document.querySelector('.dc-conn')?.innerText.includes('Live')`, 'Bob live again', 15000);
      await A.until(`document.querySelector('.dc-conn')?.innerText.includes('Live')`, 'Alice live again', 15000);
    });

    console.log('Notifications away from the Chats screen');
    await check('on another dashboard tab, a new message still lights the menu badge and shows a toast; clicking it opens that chat', async () => {
      await B.click('[data-testid=tab-other]');
      await B.until(`!!document.querySelector('.other, body') && !document.querySelector('.dc-root')`, 'Bob on another tab');
      await A.type('.dc-composer textarea', 'ping from alice');
      await A.key('Enter');
      await B.until(`document.querySelector('[data-testid=menu-badge]')?.innerText === '1'`, 'menu badge');
      await B.until(`${has('.dc-toast', 'ping from alice')}`, 'toast on another tab');
      await B.shot('bob-4-toast-on-other-tab');
      await B.clickText('.dc-toast-body', 'Alice Anderson');
      await B.until(`!!document.querySelector('.dc-root') && ${has('.dc-in .dc-text', 'ping from alice')}`, 'chat opened from the toast');
      await B.until(`!document.querySelector('[data-testid=menu-badge]')`, 'badge cleared after opening', 6000);
    });

    console.log('Long history');
    await check('a long chat opens at the latest message, then loads earlier ones on scroll without jumping', async () => {
      const convo = await rest(alice, 'POST', '/conversations', { userId: carol.id });
      const cid = convo.conversation.id; const start = Date.now() - 400 * 60_000;
      await DirectMessage.insertMany(Array.from({ length: 120 }, (_, i) => ({ conversationId: cid, senderId: i % 2 ? carol.id : alice.id, recipientId: i % 2 ? alice.id : carol.id, text: `history ${i}`, readAt: new Date(), deliveredAt: new Date(), createdAt: new Date(start + i * 60_000), updatedAt: new Date(start + i * 60_000) })));
      const last = await DirectMessage.findOne({ conversationId: cid }).sort({ createdAt: -1 }).lean();
      await DirectConversation.updateOne({ _id: cid }, { $set: { lastMessageAt: last.createdAt, lastMessage: { messageId: last._id, senderId: last.senderId, text: last.text, at: last.createdAt } } });
      await A.evaluate(`window.location.reload()`);
      await A.until(`${has('.dc-item', 'Carol Stonehouse')}`, 'Carol in the list after reload', 20000);
      await A.clickText('.dc-item', 'Carol Stonehouse');
      await A.until(`${has('.dc-text', 'history 119')}`, 'latest message');
      await A.until(`(() => { const s = document.querySelector('.dc-scroll'); return s.scrollHeight - s.scrollTop - s.clientHeight < 8; })()`, 'scrolled to the bottom');
      assert.equal(await A.evaluate(`document.querySelectorAll('.dc-row').length`), 50, 'first page is 50 messages');
      // Scroll to the very top and, in the same instant (before the network answers), note where the oldest loaded message sits.
      const before = await A.evaluate(`(() => { const s = document.querySelector('.dc-scroll'); s.scrollTop = 0; const el = [...document.querySelectorAll('.dc-text')].find((e) => e.innerText === 'history 70'); return el.getBoundingClientRect().top - s.getBoundingClientRect().top; })()`);
      await A.until(`${has('.dc-text', 'history 20')}`, 'earlier messages loaded', 10000);
      await delay(300);
      const after = await A.evaluate(`(() => { const s = document.querySelector('.dc-scroll'); const el = [...document.querySelectorAll('.dc-text')].find((e) => e.innerText === 'history 70'); return el.getBoundingClientRect().top - s.getBoundingClientRect().top; })()`);
      assert.ok(Math.abs(after - before) < 60, `reading position jumped: ${before} -> ${after}`);
      await A.shot('alice-5-long-history');
    });

    console.log('Looks');
    await check('desktop layout: two columns, outgoing bubbles on the right, tails on the first bubble of a run, blue ticks, green accents', async () => {
      await A.clickText('.dc-item', 'Bob Stone');
      await A.until(`document.querySelector('.dc-chat-header strong')?.innerText === 'Bob Stone'`, 'Bob chat');
      await A.until(`!!document.querySelector('.dc-out.dc-tail') && !!document.querySelector('.dc-in.dc-tail')`, 'bubbles with tails');
      const m = await A.evaluate(`(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); const root = r('.dc-root'); const out = [...document.querySelectorAll('.dc-out .dc-bubble')].pop().getBoundingClientRect(); const inb = [...document.querySelectorAll('.dc-in .dc-bubble')].pop().getBoundingClientRect(); const side = r('.dc-sidebar'); const main = r('.dc-main'); return { rootW: root.width, sideW: side.width, mainW: main.width, outRight: out.right, inLeft: inb.left, mainLeft: main.left, mainRight: main.right, outW: out.width, accent: getComputedStyle(document.querySelector('.dc-send')).backgroundColor, outBg: getComputedStyle(document.querySelector('.dc-out .dc-bubble')).backgroundColor, inBg: getComputedStyle(document.querySelector('.dc-in .dc-bubble')).backgroundColor }; })()`);
      assert.ok(m.sideW >= 300 && m.sideW <= 400, `list column width ${m.sideW}`);
      assert.ok(m.outRight > m.mainRight - m.mainW * 0.12, `outgoing bubbles should hug the right edge (${m.outRight} vs ${m.mainRight})`);
      assert.ok(m.inLeft < m.mainLeft + m.mainW * 0.12, `incoming bubbles should hug the left edge`);
      assert.ok(m.outW <= m.mainW * 0.66, `bubble too wide: ${m.outW} of ${m.mainW}`);
      assert.equal(m.accent, 'rgb(79, 70, 229)', 'Toowix indigo send button');
      assert.equal(m.outBg, 'rgb(79, 70, 229)', 'dark-theme outgoing bubble is Toowix indigo');
      assert.equal(m.inBg, 'rgb(30, 41, 59)', 'dark-theme incoming bubble colour');
      await A.shot('alice-6-desktop-dark');
    });
    await check('time and ticks sit in the bottom-right corner of every bubble (short, multi-line and received), never above the text', async () => {
      const geometry = await A.evaluate(`(() => {
        const out = [];
        for (const bubble of document.querySelectorAll('.dc-bubble')) {
          const text = bubble.querySelector('.dc-text'); const meta = bubble.querySelector('.dc-meta');
          if (!text || !meta) continue;
          const b = bubble.getBoundingClientRect(); const t = text.getBoundingClientRect(); const m = meta.getBoundingClientRect();
          out.push({ text: text.innerText.slice(0, 24), lines: Math.round(t.height / 19), fromBottom: Math.round(b.bottom - m.bottom), fromRight: Math.round(b.right - m.right), metaTopVsTextTop: Math.round(m.top - t.top), metaCentreInLowerHalf: (m.top + m.height / 2) > (b.top + b.height / 2) });
        }
        return out;
      })()`);
      assert.ok(geometry.length >= 5, 'bubbles measured');
      for (const g of geometry) {
        assert.ok(g.fromBottom >= 0 && g.fromBottom <= 9, `"${g.text}": time/ticks must be at the bubble bottom, but are ${g.fromBottom}px above it`);
        assert.ok(g.fromRight >= 0 && g.fromRight <= 12, `"${g.text}": time/ticks must be at the right edge (${g.fromRight}px from it)`);
        assert.ok(g.metaCentreInLowerHalf, `"${g.text}": time/ticks must be in the lower half of the bubble`);
        assert.ok(g.metaTopVsTextTop >= 3, `"${g.text}": time/ticks must not be level with or above the top of the text (${g.metaTopVsTextTop}px)`);
      }
      assert.ok(geometry.some((g) => g.lines >= 2), 'a multi-line bubble was included');
      await A.shot('alice-6b-time-and-ticks-bottom-right');
    });
    await check('Toowix theme: no green anywhere on the chat screen, and no stray boxes inside the search / message fields', async () => {
      const report = await A.evaluate(`(() => {
        const greenish = (c) => { const m = c.match(/rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/); if (!m) return false; const [r, g, b] = [+m[1], +m[2], +m[3]]; const a = m[4] === undefined ? 1 : +m[4]; return a > 0.2 && g > r + 40 && g > b + 25; };
        const bad = [];
        for (const el of document.querySelectorAll('.dc-root *')) {
          const cs = getComputedStyle(el);
          for (const prop of ['backgroundColor', 'color', 'borderTopColor', 'borderBottomColor']) if (greenish(cs[prop])) bad.push(el.className + ' ' + prop + ' ' + cs[prop]);
          if (el.tagName === 'svg' && greenish(cs.stroke)) bad.push('svg stroke ' + cs.stroke);
        }
        const s = getComputedStyle(document.querySelector('.dc-search input')); const t = getComputedStyle(document.querySelector('.dc-composer textarea'));
        return { bad: bad.slice(0, 5), searchBg: s.backgroundColor, searchBorder: s.borderTopWidth, textBg: t.backgroundColor, textBorder: t.borderTopWidth };
      })()`);
      assert.deepEqual(report.bad, [], 'green colours found: ' + report.bad.join(' | '));
      assert.equal(report.searchBg, 'rgba(0, 0, 0, 0)', 'search input must be transparent');
      assert.equal(report.searchBorder, '0px', 'search input must have no border');
      assert.equal(report.textBg, 'rgba(0, 0, 0, 0)', 'message box must be transparent');
      assert.equal(report.textBorder, '0px', 'message box must have no border');
    });
    await check('light theme', async () => {
      await A.open(pageUrl(alice, '&theme=light'), alice.uid);
      await A.until(`${has('.dc-item', 'Bob Stone')}`, 'list after reload', 30000);
      await A.clickText('.dc-item', 'Bob Stone');
      await A.until(`${has('.dc-text', 'ping from alice')}`, 'chat');
      assert.equal(await A.evaluate(`getComputedStyle(document.querySelector('.dc-out .dc-bubble')).backgroundColor`), 'rgb(79, 70, 229)', 'light-theme outgoing bubble is Toowix indigo');
      await A.shot('alice-7-desktop-light');
    });
    await check('phone layout: the list and the chat take turns, with a back button', async () => {
      await A.viewport(390, 800, true);
      await A.evaluate(`document.querySelector('.dc-back').click()`);
      await A.until(`getComputedStyle(document.querySelector('.dc-sidebar')).display !== 'none' && getComputedStyle(document.querySelector('.dc-main')).display === 'none'`, 'list only');
      await A.shot('alice-8-phone-list');
      await A.clickText('.dc-item', 'Bob Stone');
      await A.until(`getComputedStyle(document.querySelector('.dc-sidebar')).display === 'none' && getComputedStyle(document.querySelector('.dc-main')).display !== 'none' && getComputedStyle(document.querySelector('.dc-back')).display !== 'none'`, 'chat only with back button');
      const fits = await A.evaluate(`document.documentElement.scrollWidth <= window.innerWidth + 1`);
      assert.ok(fits, 'no horizontal scrolling on a phone');
      await A.shot('alice-9-phone-chat');
      await A.viewport(1180, 760, false);
    });

    console.log('Calls and the three-dot menu');
    const convOf = async (u) => (await rest(u, 'GET', '/conversations')).conversations.find((c) => c.peer.name === (u === bob ? 'Alice Anderson' : 'Bob Stone'));
    const joined = (who) => who.evaluate('JSON.stringify(window.__joined || [])').then(JSON.parse);
    await check('the chat header has video (Toowix meeting) call, voice call and three-dot buttons', async () => {
      await A.until(`!!document.querySelector('[data-testid=dc-video-call]') && !!document.querySelector('[data-testid=dc-voice-call]') && !!document.querySelector('[data-testid=dc-menu-button]')`, 'header buttons');
      await A.shot('alice-10-header-buttons');
    });
    await check('voice call: Alice sees "Calling", Bob gets an incoming card, and declining tells Alice and marks the chat', async () => {
      await A.click('[data-testid=dc-voice-call]');
      await A.until(`!!document.querySelector('[data-testid=dc-outgoing-call]') && document.querySelector('[data-testid=dc-outgoing-call]').innerText.includes('Calling Bob Stone')`, 'Alice calling card');
      await B.until(`!!document.querySelector('[data-testid=dc-incoming-call]') && document.querySelector('[data-testid=dc-incoming-call]').innerText.includes('Incoming voice call')`, 'Bob incoming card');
      await B.shot('bob-11-incoming-call');
      await B.click('[data-testid=dc-decline-call]');
      await B.until(`!document.querySelector('[data-testid=dc-incoming-call]')`, 'Bob card gone');
      await A.until(`!document.querySelector('[data-testid=dc-outgoing-call]') && document.querySelector('[data-testid=dc-call-notice]')?.innerText.includes('declined')`, 'Alice sees declined notice');
      await A.until(`${has('[data-testid=dc-callline]', 'Declined')}`, 'call line says Declined');
      assert.deepEqual(await joined(A), [], 'a declined call joins no room');
    });
    await check('voice call accepted: both people are sent to the SAME meeting room as a voice call', async () => {
      await A.click('[data-testid=dc-voice-call]');
      await B.until(`!!document.querySelector('[data-testid=dc-incoming-call]')`, 'Bob incoming card');
      await B.click('[data-testid=dc-accept-call]');
      await A.until(`(window.__joined || []).length === 1`, 'Alice navigation');
      await B.until(`(window.__joined || []).length === 1`, 'Bob navigation');
      const [ja, jb] = [(await joined(A))[0], (await joined(B))[0]];
      assert.match(ja.slug, /^twx-[a-z]{3}-[a-z]{3}-[a-z]{3}$/);
      assert.equal(ja.slug, jb.slug, 'same room');
      assert.equal(ja.mode, 'voice'); assert.equal(jb.mode, 'voice');
      await A.until(`${has('[data-testid=dc-callline]', 'Answered')}`, 'Answered line');
      await A.evaluate('window.__joined = []'); await B.evaluate('window.__joined = []');
    });
    await check('video call: unanswered becomes Missed for both, with a Call back button for the person who missed it', async () => {
      await A.click('[data-testid=dc-video-call]');
      await B.until(`document.querySelector('[data-testid=dc-incoming-call]')?.innerText.includes('Incoming video call')`, 'Bob incoming video');
      await A.until(`!document.querySelector('[data-testid=dc-outgoing-call]') && document.querySelector('[data-testid=dc-call-notice]')?.innerText.includes('did not answer')`, 'Alice sees no-answer', 9000);
      await B.until(`!document.querySelector('[data-testid=dc-incoming-call]')`, 'Bob ring stops');
      await B.clickText('.dc-item', 'Alice Anderson');
      await B.until(`${has('[data-testid=dc-callline]', 'Missed video call')}`, 'Bob sees Missed video call');
      await B.until(`${has('.dc-callback', 'Call back')}`, 'Call back button');
      await B.shot('bob-12-missed-call');
    });
    await check('"Call back" rings the other person again', async () => {
      await B.evaluate(`[...document.querySelectorAll('.dc-callback')].filter((b) => !b.disabled).pop().click()`);
      await A.until(`!!document.querySelector('[data-testid=dc-incoming-call]')`, 'Alice is called back');
      await A.click('[data-testid=dc-decline-call]');
      await B.until(`!document.querySelector('[data-testid=dc-outgoing-call]')`, 'Bob card gone');
    });

    await check('three-dot menu lists every option', async () => {
      await A.click('[data-testid=dc-menu-button]');
      await A.until(`!!document.querySelector('.dc-menu')`, 'menu');
      const items = await A.evaluate(texts('.dc-menu [role=menuitem]'));
      for (const label of ['Contact info', 'Search in chat', 'Mute notifications', 'Clear chat', 'Delete chat', 'Block', 'Close chat']) assert.ok(items.some((i) => i.includes(label)), `missing "${label}": ${JSON.stringify(items)}`);
      await A.shot('alice-13-menu');
      await A.key('Escape');
      await A.until(`!document.querySelector('.dc-menu')`, 'menu closes on Escape');
    });
    await check('contact info shows the person', async () => {
      await A.click('[data-testid=dc-menu-button]'); await A.clickText('.dc-menu button', 'Contact info');
      await A.until(`document.querySelector('[data-testid=dc-contact-info]')?.innerText.includes('Bob Stone')`, 'info sheet');
      await A.shot('alice-14-contact-info');
      await A.click('[data-testid=dc-contact-info] header button');
      await A.until(`!document.querySelector('[data-testid=dc-contact-info]')`, 'closed');
    });
    await check('search in chat: counts matches, highlights them, steps between them and reports no results', async () => {
      await rest(bob, 'POST', `/conversations/${(await convOf(bob)).id}/messages`, { text: 'meet at the Harbour cafe' });
      await rest(bob, 'POST', `/conversations/${(await convOf(bob)).id}/messages`, { text: 'harbour is closed, sorry' });
      await A.until(`${has('.dc-text', 'harbour is closed')}`, 'messages arrive');
      await A.click('[data-testid=dc-menu-button]'); await A.clickText('.dc-menu button', 'Search in chat');
      await A.type('[data-testid=dc-find-input]', 'harbour');
      await A.until(`document.querySelector('[data-testid=dc-find-count]').innerText === '2 of 2'`, 'two matches');
      assert.equal(await A.evaluate(`document.querySelectorAll('.dc-text mark').length`), 2, 'both occurrences highlighted');
      await A.key('Enter');
      await A.until(`document.querySelector('[data-testid=dc-find-count]').innerText === '1 of 2'`, 'stepped to first');
      await A.evaluate(`(() => { const i = document.querySelector('[data-testid=dc-find-input]'); i.focus(); i.select(); })()`);
      await A.type('[data-testid=dc-find-input]', 'qqqq');
      await A.until(`document.querySelector('[data-testid=dc-find-count]').innerText === 'No results'`, 'no results');
      await A.key('Escape');
      await A.until(`!document.querySelector('[data-testid=dc-find-input]') && document.querySelectorAll('.dc-text mark').length === 0`, 'search closed, highlights gone');
    });
    await check('mute 8 hours: header says muted, a new message makes no toast and no menu badge, and unmute restores both', async () => {
      await A.click('[data-testid=dc-menu-button]'); await A.clickText('.dc-menu button', 'Mute notifications');
      await A.clickText('.dc-menu [role=menuitemradio]', '8 hours');
      await A.until(`document.querySelector('.dc-chat-header small')?.innerText.includes('muted')`, 'muted subtitle');
      await A.click('[data-testid=dc-menu-button]'); await A.clickText('.dc-menu button', 'Close chat');
      await A.until(`!!document.querySelector('.dc-empty')`, 'chat closed');
      await rest(bob, 'POST', `/conversations/${(await convOf(bob)).id}/messages`, { text: 'quiet please' });
      await A.until(`${has('.dc-item', 'quiet please')}`, 'row updated');
      await delay(700);
      assert.equal(await A.evaluate(`document.querySelectorAll('.dc-toast').length`), 0, 'no toast while muted');
      assert.equal(await A.evaluate(`!!document.querySelector('[data-testid=menu-badge]')`), false, 'no menu badge for a muted chat');
      assert.equal(await A.evaluate(`!!document.querySelector('.dc-item .dc-muted-icon')`), true, 'muted icon in the list');
      await A.clickText('.dc-item', 'Bob Stone');
      await A.click('[data-testid=dc-menu-button]'); await A.clickText('.dc-menu button', 'Unmute notifications');
      await A.until(`!document.querySelector('.dc-chat-header small')`, 'unmuted');
    });
    await check('block: needs confirmation, swaps the message box for an Unblock bar, disables calls, and stops the other person', async () => {
      await A.click('[data-testid=dc-menu-button]'); await A.clickText('.dc-menu button', 'Block');
      await A.until(`!!document.querySelector('[role=alertdialog]')`, 'confirm dialog');
      await A.clickText('.dc-btn', 'Cancel');
      assert.equal(await A.evaluate(`!!document.querySelector('[data-testid=dc-blocked-bar]')`), false, 'cancel changes nothing');
      await A.click('[data-testid=dc-menu-button]'); await A.clickText('.dc-menu button', 'Block');
      await A.click('[data-testid=dc-confirm-action]');
      await A.until(`!!document.querySelector('[data-testid=dc-blocked-bar]') && !document.querySelector('.dc-composer')`, 'blocked bar');
      assert.equal(await A.evaluate(`document.querySelector('[data-testid=dc-voice-call]').disabled && document.querySelector('[data-testid=dc-video-call]').disabled`), true, 'call buttons disabled');
      const refused = await rest(bob, 'POST', `/conversations/${(await convOf(bob)).id}/messages`, { text: 'hello?' });
      assert.equal(refused.code, 'BLOCKED');
      await A.shot('alice-15-blocked');
      await A.click('[data-testid=dc-blocked-bar] button');
      await A.until(`!document.querySelector('[data-testid=dc-blocked-bar]') && !!document.querySelector('.dc-composer textarea')`, 'unblocked');
    });
    await check('clear chat: confirmation, then it is empty for Alice while Bob keeps his copy', async () => {
      await A.click('[data-testid=dc-menu-button]'); await A.clickText('.dc-menu button', 'Clear chat');
      await A.until(`document.querySelector('[role=alertdialog]')?.innerText.includes('Clear this chat')`, 'confirm');
      await A.click('[data-testid=dc-confirm-action]');
      await A.until(`!document.querySelector('[role=alertdialog]') && document.querySelectorAll('.dc-row').length === 0`, 'chat emptied');
      assert.ok((await rest(bob, 'GET', `/conversations/${(await convOf(bob)).id}/messages`)).messages.length > 3, 'Bob still has the history');
    });
    await check('delete chat: confirmation, then it leaves the list and the screen shows the empty state', async () => {
      await A.click('[data-testid=dc-menu-button]'); await A.clickText('.dc-menu button', 'Delete chat');
      await A.until(`document.querySelector('[role=alertdialog]')?.innerText.includes('Delete this chat')`, 'confirm');
      await A.click('[data-testid=dc-confirm-action]');
      await A.until(`!!document.querySelector('.dc-empty') && !${has('.dc-item', 'Bob Stone')}`, 'chat gone from list');
      assert.equal((await rest(alice, 'GET', '/conversations')).conversations.filter((c) => c.peer.name === 'Bob Stone').length, 0);
    });

    console.log('Clean run');
    await check('no uncaught errors or React warnings in either browser', async () => {
      const issues = [...A.problems.map((p) => `alice ${p}`), ...B.problems.map((p) => `bob ${p}`)];
      assert.deepEqual(issues, [], issues.join('\n'));
    });
  } finally {
    await cleanup();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} browser checks passed. Screenshots: ${SHOTS}`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((error) => { console.error('FATAL', error); process.exitCode = 1; setTimeout(() => process.exit(1), 1500); });

#!/usr/bin/env node
// Local verification runner. No deployment, account creation, email, or database writes.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const web = path.join(root, 'toowix-web-app');
const backend = path.join(root, 'toowix-backend');
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('node scripts/test-website.cjs [--web URL] [--api URL] [--browser] [--strict]\nBuilds both apps and runs isolated backend security tests. Optional live checks are read-only.\n--browser requires an installed playwright package and Chromium. --strict fails on skips.');
  process.exit(0);
}
for (let i = 0; i < args.length; i++) {
  if (['--web', '--api'].includes(args[i])) {
    if (!args[++i] || !/^https?:\/\//.test(args[i])) throw Error('Expected an HTTP(S) URL');
  } else if (!['--browser', '--strict'].includes(args[i])) throw Error(`Unknown option: ${args[i]}`);
}
const option = name => args.includes(name) ? args[args.indexOf(name) + 1].replace(/\/$/, '') : null;
const results = [];
const reportDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'toowix-website-test-'));
function skip(name, detail) { results.push({ name, status: 'SKIP', detail }); console.log(`SKIP ${name}: ${detail}`); }
async function check(name, fn) {
  const start = Date.now();
  try { await fn(); results.push({ name, status: 'PASS', durationMs: Date.now() - start }); console.log(`PASS ${name}`); return true; }
  catch (error) { results.push({ name, status: 'FAIL', detail: error.message, durationMs: Date.now() - start }); console.error(`FAIL ${name}: ${error.message}`); return false; }
}
function command(name, executable, argv, cwd, env = {}) {
  return check(name, () => new Promise((resolve, reject) => {
    const log = path.join(reportDir, name.replace(/[^a-z0-9]/gi, '-') + '.log');
    const output = fs.openSync(log, 'w');
    const child = spawn(executable, argv, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', output, output], windowsHide: true });
    fs.closeSync(output);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      else child.kill('SIGKILL');
    }, 180000);
    child.on('error', err => { clearTimeout(timer); reject(err); });
    child.on('close', code => { clearTimeout(timer); code === 0 && !timedOut ? resolve() : reject(Error(`${timedOut ? 'Timed out' : `Exit ${code}`}; see ${log}`)); });
  }));
}
const node = (name, argv, cwd, env) => command(name, process.execPath, argv, cwd, env);
async function request(base, route) {
  return fetch(base + route, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
}
async function main() {
  console.log(`Reports: ${reportDir}`);
  await check('Source conflict markers', () => {
    function walk(dir) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.(tsx?|jsx?|css|json)$/.test(file)) assert(!/^(<<<<<<< |>>>>>>> |=======$)/m.test(fs.readFileSync(file, 'utf8')), file);
    } }
    walk(path.join(web, 'src')); walk(path.join(backend, 'src'));
  });
  const typedWeb = await node('Frontend types', ['node_modules/typescript/bin/tsc', '--noEmit'], web);
  if (typedWeb) await node('Frontend production build', ['node_modules/vite/bin/vite.js', 'build'], web);
  else skip('Frontend production build', 'Fix type errors first');
  const builtBackend = await node('Backend compilation', ['node_modules/typescript/bin/tsc'], backend);
  if (builtBackend) await node('Backend security regressions', ['--test', 'tests/meeting-security.test.cjs'], backend, { NODE_ENV: 'test', JITSI_APP_SECRET: 'website-test-only-secret-not-for-production' });
  else skip('Backend security regressions', 'Backend compilation failed');

  const api = option('--api');
  if (api) {
    await check('API and database health', async () => { const r = await request(api, '/health'); assert.equal(r.status, 200); assert.equal((await r.json()).status, 'healthy'); });
    for (const route of ['/api/meetings', '/api/recordings', '/api/companies/admin', '/api/companies/meeting-policy']) {
      await check(`Anonymous access denied: ${route}`, async () => { const r = await request(api, route); assert([401, 403].includes(r.status), `Expected 401/403, got ${r.status}`); });
    }
    await check('Missing meeting rejected', async () => { const r = await request(api, `/api/meetings/room/website-test-missing-${Date.now()}`); assert.equal(r.status, 404); });
  } else skip('Live API checks', 'Supply --api http://localhost:4000 for a running backend');

  const base = option('--web');
  if (base) {
    for (const route of ['/', '/login', '/signup', '/rsvp', '/meeting-link-expired', '/meeting-ended']) {
      await check(`HTTP page shell: ${route}`, async () => { const r = await request(base, route); assert.equal(r.status, 200); assert.match(r.headers.get('content-type') || '', /text\/html/); assert.match(await r.text(), /id=["']root["']/); });
    }
  } else skip('Live web checks', 'Supply --web http://localhost:3000');
  if (args.includes('--browser') && base) {
    let playwright;
    try { playwright = require(require.resolve('playwright', { paths: [web, root] })); }
    catch { skip('Browser checks', 'Install playwright and its Chromium browser to enable this suite'); }
    if (playwright) await check('Browser routes and theme rendering', async () => {
      const browser = await playwright.chromium.launch({ headless: true });
      try {
        for (const theme of ['light', 'dark']) {
          const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
          await context.addInitScript(value => localStorage.setItem('toowix_theme', value), theme);
          const page = await context.newPage();
          const errors = []; page.on('pageerror', error => errors.push(error.message));
          for (const route of ['/', '/login', '/signup', '/meeting-link-expired', '/meeting-ended']) {
            await page.goto(base + route, { waitUntil: 'domcontentloaded', timeout: 20000 });
            await page.waitForFunction(() => document.querySelector('#root')?.textContent.trim().length > 10);
            assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
            if (route === '/meeting-link-expired') await page.getByRole('heading', { name: 'This link has expired.' }).waitFor();
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Horizontal overflow: ${route}`);
          }
          assert.deepEqual(errors, []);
          await context.close();
        }
      } finally { await browser.close(); }
    });
  } else skip('Browser checks', 'Supply --web URL --browser');
  skip('Authenticated workflows and real calls', 'Requires dedicated test accounts, running Jitsi/Jibri and two browsers: meeting creation, lobby, moderator controls, camera/mic, PiP, chat, recording playback, RSVP email and sharing permissions are not verified by this runner');
}
main().catch(error => { results.push({ name: 'Runner', status: 'FAIL', detail: error.stack }); }).finally(() => {
  const counts = Object.fromEntries(['PASS', 'FAIL', 'SKIP'].map(status => [status, results.filter(r => r.status === status).length]));
  fs.writeFileSync(path.join(reportDir, 'report.json'), JSON.stringify({ timestamp: new Date().toISOString(), counts, results }, null, 2));
  console.log(`\n${counts.PASS} passed, ${counts.FAIL} failed, ${counts.SKIP} skipped.\nReport: ${path.join(reportDir, 'report.json')}`);
  process.exitCode = counts.FAIL || (args.includes('--strict') && counts.SKIP) ? 1 : 0;
});

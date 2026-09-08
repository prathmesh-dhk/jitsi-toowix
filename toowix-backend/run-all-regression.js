/**
 * Master regression runner -- runs every test-*.js suite in this directory and prints
 * one aggregated pass/fail summary. This is the "test everything" entry point covering:
 *   - test-settings.js          Settings module (Profile/General/Meetings/Recording/
 *                                Notifications/Security/Storage) -- 42 checks
 *   - test-new-features.js      Custom meeting ID, description, recurrence, private
 *                                invite lists, company meeting policy, recording
 *                                sharing, active sessions -- 48 checks
 *   - test-superadmin-regression.js  Superadmin panel: approvals, suspend/reactivate,
 *                                limits, users, recordings, audit log, mail log,
 *                                system health, overview -- 43 checks
 *   - test-e2e.js               Full signup -> approval -> login -> meeting ->
 *                                attendance -> recording -> live scheduler wait
 *                                (~65s, the slowest one) -- 25 checks
 *
 * Runs them concurrently (each uses its own Date.now()-stamped test data, so they don't
 * collide) so the wall-clock time is close to the slowest single suite (~70-90s) instead
 * of the sum of all four. Requires: toowix-backend (4000), toowix-web-app isn't needed,
 * Superadmin-jitsi-Backend (4100) both running, and serviceAccountKey.json present.
 */
const { spawn } = require('child_process');
const path = require('path');

const SUITES = [
  'test-settings.js',
  'test-new-features.js',
  'test-superadmin-regression.js',
  'test-e2e.js',
];

function runSuite(file) {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn(process.execPath, [path.join(__dirname, file)], { cwd: __dirname });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => {
      const durationSec = ((Date.now() - start) / 1000).toFixed(1);
      const summaryMatch = stdout.match(/(\d+) passed, (\d+) failed/);
      resolve({
        file,
        code,
        durationSec,
        passed: summaryMatch ? Number(summaryMatch[1]) : null,
        failed: summaryMatch ? Number(summaryMatch[2]) : null,
        stdout,
        stderr,
      });
    });
  });
}

async function main() {
  console.log(`\x1b[36mRunning ${SUITES.length} regression suites in parallel: ${SUITES.join(', ')}\x1b[0m\n`);
  const results = await Promise.all(SUITES.map(runSuite));

  let totalPassed = 0;
  let totalFailed = 0;
  let anyCrashed = false;

  for (const r of results) {
    console.log(`\n\x1b[1m${'='.repeat(70)}\x1b[0m`);
    console.log(`\x1b[1m${r.file}\x1b[0m  (${r.durationSec}s, exit code ${r.code})`);
    console.log(`${'='.repeat(70)}`);
    console.log(r.stdout.trim());
    if (r.stderr.trim()) {
      console.log(`\x1b[31m--- stderr ---\x1b[0m\n${r.stderr.trim()}`);
    }

    if (r.passed === null) {
      anyCrashed = true;
      console.log(`\x1b[31mCould not parse a pass/fail summary from ${r.file} -- treating as crashed.\x1b[0m`);
    } else {
      totalPassed += r.passed;
      totalFailed += r.failed;
    }
  }

  console.log(`\n${'#'.repeat(70)}`);
  console.log('\x1b[1mFINAL REGRESSION SUMMARY\x1b[0m');
  console.log('#'.repeat(70));
  for (const r of results) {
    const status = r.code === 0 ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
    console.log(`  ${status}  ${r.file.padEnd(32)} ${r.passed ?? '?'} passed, ${r.failed ?? '?'} failed  (${r.durationSec}s)`);
  }
  console.log(`\nTOTAL: ${totalPassed} passed, ${totalFailed} failed across ${SUITES.length} suites\n`);

  const overallFail = anyCrashed || totalFailed > 0 || results.some((r) => r.code !== 0);
  process.exit(overallFail ? 1 : 0);
}

main();

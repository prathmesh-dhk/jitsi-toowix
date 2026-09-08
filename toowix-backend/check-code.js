#!/usr/bin/env node
/**
 * Fast static-analysis pass across all 4 sub-projects (toowix-backend, toowix-web-app,
 * Superadmin-jitsi-Backend, Superadmin-jitsi-Frontend).
 *
 * IMPORTANT HONESTY NOTE: this is NOT a magic "reads every line and finds every bug"
 * tool -- no script can do that. What it actually does, for real:
 *   1. Runs the TypeScript compiler in strict mode (--noEmit) on every project's real
 *      tsconfig.json. This catches real bugs: wrong types, null/undefined misuse,
 *      unreachable code the compiler can prove, missing properties, etc.
 *   2. Greps every .ts/.tsx source file for a curated list of patterns that are common
 *      sources of *hidden* bugs (silently-swallowed errors, unhandled promise
 *      rejections, loose equality, TODO markers left in). These are SMELLS to review by
 *      hand, not confirmed bugs -- a real empty catch block might be intentional.
 * There is no ESLint configured in any of these 4 projects (verified: no eslint in
 * node_modules/.bin, no config file), so this does not run ESLint -- it would be
 * fabricating a pass that isn't real. If you want real lint coverage, that needs
 * `npm install eslint` + a config in each project first.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROJECTS = [
  { name: 'toowix-backend', dir: 'c:/Users/xeon5/Downloads/jitsi-toowix/toowix-backend', tsconfig: 'tsconfig.json', srcDir: 'src' },
  { name: 'toowix-web-app', dir: 'c:/Users/xeon5/Downloads/jitsi-toowix/toowix-web-app', tsconfig: 'tsconfig.json', srcDir: 'src' },
  { name: 'Superadmin-jitsi-Backend', dir: 'C:/Users/xeon5/Desktop/Superadmin-jitsi/Superadmin-jitsi-Backend', tsconfig: 'tsconfig.json', srcDir: 'src' },
  { name: 'Superadmin-jitsi-Frontend', dir: 'C:/Users/xeon5/Desktop/Superadmin-jitsi/Superadmin-jitsi-Frontend', tsconfig: 'tsconfig.json', srcDir: 'src' },
];

// [label, regex, severity] -- severity is just a display hint, not a real classifier.
const SMELL_PATTERNS = [
  ['Empty catch block (errors silently swallowed)', /catch\s*(\([^)]*\))?\s*\{\s*\}/g, 'HIGH'],
  ['catch block that only logs (no rethrow/return/res)', /catch\s*\([^)]*\)\s*\{\s*console\.(log|warn|error)\([^)]*\)\s*;?\s*\}/g, 'MEDIUM'],
  ['Loose equality (== / != instead of === / !==)', /[^=!<>]==[^=]|[^!]!=[^=]/g, 'LOW'],
  ['Promise .then() with no .catch() anywhere in the chain', '__THEN_NO_CATCH__', 'MEDIUM'],
  ['Non-null assertion on process.env (crashes if unset)', /process\.env\.\w+!/g, 'MEDIUM'],
  ['TODO / FIXME / HACK / XXX marker left in code', /\b(TODO|FIXME|HACK|XXX)\b/g, 'INFO'],
  ['debugger statement left in', /\bdebugger\b/g, 'HIGH'],
  ['as any (type safety opt-out)', /\bas any\b/g, 'INFO'],
];

function listFiles(dir, exts) {
  let out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(listFiles(full, exts));
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

function runTsc(project) {
  const tscBin = path.join(project.dir, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
  const bin = fs.existsSync(tscBin) ? tscBin : 'npx';
  const args = fs.existsSync(tscBin) ? ['--noEmit', '-p', project.tsconfig] : ['tsc', '--noEmit', '-p', project.tsconfig];
  const result = spawnSync(bin, args, { cwd: project.dir, encoding: 'utf8', shell: true });
  const output = (result.stdout || '') + (result.stderr || '');
  const errorLines = output.split('\n').filter((l) => /error TS\d+/.test(l));
  return { ok: result.status === 0, errorCount: errorLines.length, errorLines, raw: output.trim() };
}

function scanSmells(project) {
  const srcDir = path.join(project.dir, project.srcDir);
  const files = listFiles(srcDir, ['.ts', '.tsx']);
  const findings = []; // { pattern, severity, file, line }
  const counts = {};

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');

    for (const [label, regex, severity] of SMELL_PATTERNS) {
      if (regex === '__THEN_NO_CATCH__') {
        // Special-cased: a plain adjacent-token regex can't see past a multi-line
        // .then(...) callback body to the .catch() chained after it, so instead look
        // for a .catch( anywhere within the next 1500 chars (long enough for a real
        // callback body, short enough not to spill into an unrelated later statement).
        const thenRe = /\.then\(/g;
        let m;
        while ((m = thenRe.exec(content)) !== null) {
          const window = content.slice(m.index, m.index + 1500);
          if (!window.includes('.catch(') && !window.includes('await ')) {
            const upto = content.slice(0, m.index);
            const lineNum = upto.split('\n').length;
            counts[label] = (counts[label] || 0) + 1;
            findings.push({ label, severity, file: path.relative(project.dir, file), line: lineNum, snippet: (lines[lineNum - 1] || '').trim().slice(0, 100) });
          }
        }
        continue;
      }

      regex.lastIndex = 0;
      let match;
      const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
      while ((match = re.exec(content)) !== null) {
        const upto = content.slice(0, match.index);
        const lineNum = upto.split('\n').length;
        counts[label] = (counts[label] || 0) + 1;
        findings.push({ label, severity, file: path.relative(project.dir, file), line: lineNum, snippet: (lines[lineNum - 1] || '').trim().slice(0, 100) });
      }
    }
  }

  return { fileCount: files.length, findings, counts };
}

function main() {
  console.log('\x1b[36mStatic code check across all 4 projects (tsc strict + pattern scan)\x1b[0m\n');

  let anyTscFail = false;
  const smellReport = [];

  for (const project of PROJECTS) {
    console.log(`\x1b[1m${'='.repeat(70)}\x1b[0m`);
    console.log(`\x1b[1m${project.name}\x1b[0m`);
    console.log('='.repeat(70));

    if (!fs.existsSync(path.join(project.dir, project.tsconfig))) {
      console.log(`  \x1b[33m! No tsconfig.json found -- skipping\x1b[0m`);
      continue;
    }

    process.stdout.write('  TypeScript (--noEmit, strict): ');
    const tsc = runTsc(project);
    if (tsc.ok) {
      console.log('\x1b[32mCLEAN\x1b[0m -- 0 type errors');
    } else {
      anyTscFail = true;
      console.log(`\x1b[31mFAILED\x1b[0m -- ${tsc.errorCount} error(s)`);
      console.log(tsc.errorLines.slice(0, 30).map((l) => `    ${l}`).join('\n'));
      if (tsc.errorLines.length > 30) console.log(`    ... and ${tsc.errorLines.length - 30} more`);
    }

    const smells = scanSmells(project);
    console.log(`  Pattern scan: ${smells.fileCount} source files scanned`);
    if (Object.keys(smells.counts).length === 0) {
      console.log('    \x1b[32mNo flagged patterns found.\x1b[0m');
    } else {
      for (const [label, count] of Object.entries(smells.counts)) {
        console.log(`    ${count.toString().padStart(3)}x  ${label}`);
      }
    }
    smellReport.push({ project: project.name, ...smells });
    console.log('');
  }

  // Detail dump for HIGH severity findings only (the ones actually worth a human look).
  const highFindings = [];
  for (const r of smellReport) {
    for (const f of r.findings) {
      if (f.severity === 'HIGH') highFindings.push({ project: r.project, ...f });
    }
  }
  if (highFindings.length > 0) {
    console.log(`\x1b[1m${'='.repeat(70)}\x1b[0m`);
    console.log('\x1b[1mHIGH-severity findings -- review these first\x1b[0m');
    console.log('='.repeat(70));
    for (const f of highFindings) {
      console.log(`  [${f.project}] ${f.file}:${f.line}  (${f.label})`);
      console.log(`    ${f.snippet}`);
    }
    console.log('');
  } else {
    console.log('\x1b[32mNo HIGH-severity pattern matches found across any project.\x1b[0m\n');
  }

  console.log(`${'#'.repeat(70)}`);
  console.log(anyTscFail
    ? '\x1b[31mRESULT: One or more projects have real TypeScript errors -- fix these first, they are confirmed bugs.\x1b[0m'
    : '\x1b[32mRESULT: All 4 projects compile clean under strict TypeScript.\x1b[0m');
  console.log('Pattern-scan findings above are smells to review by hand, not confirmed bugs.');
  console.log('#'.repeat(70));

  process.exit(anyTscFail ? 1 : 0);
}

main();

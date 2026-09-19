#!/usr/bin/env node
// Real-audio test of the "Extra noise suppression" effect in headless Chrome.
// It feeds recorded audio into Chrome as the microphone, runs the app's NoiseSuppressionEffect on it,
// and measures how loud the result is:
//   speech-only     -> the voice must stay (not vanish) and stay loud
//   noise-only      -> background noise must be strongly reduced
//   speech + noise  -> noise part is removed, voice kept
//   loud then quiet -> a quiet "background voice" after your loud voice is reduced, your voice is kept
//   off then on     -> switching it off and on again still passes your voice (no silence)
// Needs the web dev server (default http://localhost:3000) and Chrome. Speech is generated with Windows
// text-to-speech (or pass --speech file.wav, 16-bit mono PCM).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const WebSocket = require(join(ROOT, 'node_modules', 'ws'));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const WEB = opt('--web', 'http://localhost:3000');
const OUT = join(ROOT, 'scripts', 'test-results');
mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME_PATH || [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].find((p) => existsSync(p));
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const RATE = 48000;

// ------------------------------------------------------------------ audio fixtures
function readWavPcm(file) {
  const b = readFileSync(file);
  let p = 12; let fmt = null; let data = null;
  while (p < b.length - 8) {
    const id = b.toString('ascii', p, p + 4); const size = b.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(p + 10), rate: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) };
    if (id === 'data') { data = b.subarray(p + 8, p + 8 + size); break; }
    p += 8 + size + (size % 2);
  }
  if (!fmt || !data || fmt.bits !== 16 || fmt.ch !== 1) throw new Error('need 16-bit mono PCM wav');
  const out = new Float32Array(data.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = data.readInt16LE(i * 2) / 32768;
  return { samples: out, rate: fmt.rate };
}
function writeWav(file, samples) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  writeFileSync(file, buf);
}
const rmsOf = (a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
const scaleTo = (a, target) => { const g = target / (rmsOf(a) || 1); return a.map((x) => x * g); };
const whiteNoise = (n, amp) => Float32Array.from({ length: n }, () => (Math.random() * 2 - 1) * amp);
const concat = (...parts) => { const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

function makeSpeech(file) {
  if (opt('--speech')) return opt('--speech');
  if (process.platform !== 'win32') throw new Error('Pass --speech <16-bit mono wav> (speech is generated with Windows TTS only)');
  const ps = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(${RATE}, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono); $s.SetOutputToWaveFile('${file}', $f); $s.Speak('Hello, this is a test of the noise suppression. My voice should stay clear and loud while the background noise is removed. One two three four five six seven eight nine ten.'); $s.Dispose()`;
  const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('could not generate speech: ' + r.stderr);
  return file;
}

// ------------------------------------------------------------------ chrome
async function withChrome(wavFile, fn) {
  const profile = mkdtempSync(join(tmpdir(), 'tw-ns-'));
  const port = 9700 + Math.floor(Math.random() * 200);
  const proc = spawn(CHROME, ['--headless=new', '--no-first-run', `--remote-debugging-port=${port}`, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-audio-capture=${wavFile}`, '--autoplay-policy=no-user-gesture-required', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let ws; let id = 0; const pending = new Map();
  try {
    let targets;
    for (let i = 0; i < 60; i++) {
      try { targets = await new Promise((res, rej) => http.get(`http://127.0.0.1:${port}/json`, (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej)); if (targets.some((t) => t.type === 'page')) break; } catch { /* wait */ }
      await delay(250);
    }
    ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((r) => ws.on('open', r));
    ws.on('message', (m) => { const d = JSON.parse(m); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.reject(new Error(d.error.message)) : p.resolve(d.result); } });
    const send = (method, params = {}) => new Promise((resolve, reject) => { const i = ++id; pending.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params })); });
    await send('Page.enable'); await send('Runtime.enable');
    await send('Page.navigate', { url: `${WEB}/` }); await delay(2500);
    const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
    return await fn(evaluate);
  } finally { try { ws?.close(); } catch { /* ignore */ } proc.kill(); await delay(400); try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ } }
}

// In-page measurement. The raw microphone and the effect output are measured in the SAME time windows
// (the fake microphone loops the file, so separate runs would not line up).
const PAGE_SCRIPT = (windowMs, windows) => `(async () => {
  const { NoiseSuppressionEffect } = await import('/src/lib/noiseSuppression/NoiseSuppressionEffect.ts');
  const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  const ctx = new AudioContext({ sampleRate: ${RATE} });
  await ctx.resume();
  const meter = (stream) => {
    const src = ctx.createMediaStreamSource(stream); const an = ctx.createAnalyser(); an.fftSize = 2048; src.connect(an);
    const buf = new Float32Array(an.fftSize); let sum = 0; let n = 0;
    const timer = setInterval(() => { an.getFloatTimeDomainData(buf); for (const x of buf) { sum += x * x; n++; } }, 30);
    return { read: () => { const v = n ? Math.sqrt(sum / n) : 0; sum = 0; n = 0; return v; }, stop: () => { clearInterval(timer); src.disconnect(); } };
  };
  const both = async (outStream) => {
    const mr = meter(mic); const mo = meter(outStream); const raw = []; const out = [];
    for (let w = 0; w < ${windows}; w++) { await new Promise(r => setTimeout(r, ${windowMs})); raw.push(mr.read()); out.push(mo.read()); }
    mr.stop(); mo.stop(); return { raw, out };
  };
  const effect = new NoiseSuppressionEffect();
  const out1 = effect.startEffect(mic);
  await new Promise(r => setTimeout(r, 1500));
  const first = await both(out1);
  effect.stopEffect();
  await new Promise(r => setTimeout(r, 400));
  const effect2 = new NoiseSuppressionEffect();
  const out2 = effect2.startEffect(mic);
  await new Promise(r => setTimeout(r, 1500));
  const second = await both(out2);
  effect2.stopEffect();
  return { first, second, sampleRate: ctx.sampleRate };
})()`;

const db = (r) => 20 * Math.log10(Math.max(r, 1e-6));
const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };

if (!CHROME) { console.log('Chrome not found (set CHROME_PATH)'); process.exit(1); }
try { const r = await fetch(WEB); if (r.status >= 500) throw new Error(); } catch { console.log(`Web dev server not reachable at ${WEB}. Start it: cd toowix-web-app && npm run dev`); process.exit(1); }

const work = mkdtempSync(join(tmpdir(), 'tw-ns-wav-'));
const speechFile = makeSpeech(join(work, 'speech.wav'));
const speech = readWavPcm(speechFile);
if (speech.rate !== RATE) throw new Error(`speech must be ${RATE} Hz (got ${speech.rate})`);
const voice = scaleTo(speech.samples, 0.1); // a normal loud-ish voice
const noiseOnly = whiteNoise(RATE * 8, 0.05);
const mixed = voice.map((x, i) => x + noiseOnly[i % noiseOnly.length]);
const quietVoice = scaleTo(speech.samples, 0.1 * 0.16); // "someone talking behind you", ~16 dB quieter
const loudThenQuiet = concat(voice.subarray(0, RATE * 5), quietVoice.subarray(0, RATE * 5), voice.subarray(0, RATE * 5));

const scenarios = [
  { key: 'speech', label: 'speech only', wav: voice, seconds: 6, windows: 12 },
  { key: 'noise', label: 'noise only', wav: noiseOnly, seconds: 6, windows: 12 },
  { key: 'mix', label: 'speech + noise', wav: mixed, seconds: 6, windows: 12 },
  { key: 'seq', label: 'loud voice, then quiet background voice', wav: loudThenQuiet, seconds: 15, windows: 32 }
];
const data = {};
for (const s of scenarios) {
  const f = join(work, `${s.key}.wav`);
  writeWav(f, s.wav);
  console.log(`running: ${s.label} ...`);
  data[s.key] = await withChrome(f, (ev) => ev(PAGE_SCRIPT(500, s.windows)));
}
console.log('');

const sp = data.speech;
const ratio = (m) => avg(m.out) / (avg(m.raw) || 1e-9);
check('voice is not lost: speech is still loud with the effect on', ratio(sp.first) > 0.5, `${db(avg(sp.first.raw)).toFixed(1)} dB -> ${db(avg(sp.first.out)).toFixed(1)} dB`);
check('voice is not lost after switching the effect off and on again', ratio(sp.second) > 0.5, `${db(avg(sp.second.raw)).toFixed(1)} dB -> ${db(avg(sp.second.out)).toFixed(1)} dB`);
const nz = data.noise;
check('background noise is removed (at least 20 dB quieter)', db(avg(nz.first.out)) < db(avg(nz.first.raw)) - 20, `${db(avg(nz.first.raw)).toFixed(1)} dB -> ${db(avg(nz.first.out)).toFixed(1)} dB`);
const mx = data.mix;
check('speech + noise: result is about as loud as a clean voice, not the noisy mix', avg(mx.first.out) > 0.5 * avg(sp.first.out) && avg(mx.first.out) < 1.6 * avg(sp.first.out), `mixed in ${db(avg(mx.first.raw)).toFixed(1)} dB -> out ${db(avg(mx.first.out)).toFixed(1)} dB; clean voice out ${db(avg(sp.first.out)).toFixed(1)} dB`);
const sq = data.seq.first;
const peak = Math.max(...sq.raw);
const loud = sq.raw.map((r, i) => (r > 0.6 * peak ? i : -1)).filter((i) => i >= 0);
const quiet = sq.raw.map((r, i) => (r > 0.08 * peak && r < 0.3 * peak ? i : -1)).filter((i) => i >= 0);
const gainOf = (idx) => 20 * Math.log10(avg(idx.map((i) => sq.out[i])) / avg(idx.map((i) => sq.raw[i])));
if (loud.length < 4 || quiet.length < 4) check('loud/quiet sequence was captured', false, `loud windows ${loud.length}, quiet windows ${quiet.length}`);
else {
  check('your loud voice is kept in the loud/quiet sequence', gainOf(loud) > -6, `${gainOf(loud).toFixed(1)} dB change`);
  check('a much quieter background voice is reduced at least 8 dB more than yours', gainOf(quiet) < gainOf(loud) - 8, `voice ${gainOf(loud).toFixed(1)} dB, background ${gainOf(quiet).toFixed(1)} dB`);
}
check('sample rate is 48 kHz (what the noise model expects)', data.speech.sampleRate === RATE, String(data.speech.sampleRate));

try { rmSync(work, { recursive: true, force: true }); } catch { /* ignore */ }
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

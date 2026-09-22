const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/lib/networkQuality.ts'), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;
const exportsObject = {};
vm.runInNewContext(code, { exports: exportsObject });

const healthy = (overrides = {}) => ({
  availableOutgoingBitrateKbps: null,
  candidateType: 'host',
  connectionState: 'connected',
  jitterMs: 5,
  packetLossPercent: 0,
  rttMs: 25,
  videoBitrateKbps: 800,
  ...overrides
});

test('does not mark a connected Edge call poor when bitrate is unavailable or zero', () => {
  assert.equal(exportsObject.classifyNetwork(healthy()), 'GOOD');
  assert.equal(exportsObject.classifyNetwork(healthy({ availableOutgoingBitrateKbps: 0 })), 'GOOD');
});

test('still detects a verified low positive bandwidth estimate', () => {
  assert.equal(exportsObject.classifyNetwork(healthy({ availableOutgoingBitrateKbps: 149 })), 'POOR');
});

test('still detects real loss, latency, and connection failures', () => {
  assert.equal(exportsObject.classifyNetwork(healthy({ packetLossPercent: 6 })), 'POOR');
  assert.equal(exportsObject.classifyNetwork(healthy({ rttMs: 301 })), 'POOR');
  assert.equal(exportsObject.classifyNetwork(healthy({ connectionState: 'failed' })), 'POOR');
});

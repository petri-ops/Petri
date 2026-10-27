import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

// BLOCK-272 — gate-skip-state decideSkip 判定矩阵（红绿先行：实现缺失时本文件红）。
// git 事实（HEAD/ancestor）用真实仓库；状态文件与 changedFiles 注入 tmpdir/内存值保证确定性。

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIB = pathToFileURL(path.join(ROOT, 'scripts', 'lib', 'gate-skip-state.mjs')).href;
const { decideSkip, computeConfigDigest, recordPass, readState } = await import(LIB);

const HEAD = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
const ARCH_CONFIG = '.dependency-cruiser.cjs';
// 真实仓库当前改动不含 src/（scripts/docs/test 面），src 域判定在本测试语境下为"不相交"。
const ARCH_DOMAIN = {
  label: '源码域(src)',
  matchFile: (f) => f.startsWith('src/') || f.startsWith('core/') || f.startsWith('frontend/src/'),
  configPaths: [ARCH_CONFIG],
};

function makeStateDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'petri-gate-skip-'));
}

function stateFile(dir) {
  return path.join(dir, 'closeout-gate-state.json');
}

const NO_CHANGES = [];

test('decideSkip: 无验证状态 → 全量（fail-open）', () => {
  const dir = makeStateDir();
  const r = decideSkip({ gateId: 'gate:arch-cycles', domain: ARCH_DOMAIN, statePath: stateFile(dir), changedFiles: NO_CHANGES });
  assert.equal(r.skip, false);
  assert.match(r.reason, /无验证状态/);
});

test('decideSkip: 状态文件损坏 → 全量（fail-open，不抛异常）', () => {
  const dir = makeStateDir();
  fs.writeFileSync(stateFile(dir), '{not valid json');
  const r = decideSkip({ gateId: 'gate:arch-cycles', domain: ARCH_DOMAIN, statePath: stateFile(dir), changedFiles: NO_CHANGES });
  assert.equal(r.skip, false);
  assert.match(r.reason, /损坏|不可读/);
});

test('decideSkip: 锚点不可达（伪造 sha）→ 全量', () => {
  const dir = makeStateDir();
  fs.writeFileSync(stateFile(dir), JSON.stringify({
    schema: 'petri/closeout-gate-state.v1',
    gates: { 'gate:arch-cycles': { verifiedCommit: 'f'.repeat(40), configDigest: computeConfigDigest(ROOT, ARCH_DOMAIN.configPaths) } },
  }));
  const r = decideSkip({ gateId: 'gate:arch-cycles', domain: ARCH_DOMAIN, statePath: stateFile(dir), changedFiles: NO_CHANGES });
  assert.equal(r.skip, false);
  assert.match(r.reason, /锚点不可达/);
});

test('decideSkip: 配置漂移（digest 失配）→ 全量', () => {
  const dir = makeStateDir();
  fs.writeFileSync(stateFile(dir), JSON.stringify({
    schema: 'petri/closeout-gate-state.v1',
    gates: { 'gate:arch-cycles': { verifiedCommit: HEAD, configDigest: 'stale-digest' } },
  }));
  const r = decideSkip({ gateId: 'gate:arch-cycles', domain: ARCH_DOMAIN, statePath: stateFile(dir), changedFiles: NO_CHANGES });
  assert.equal(r.skip, false);
  assert.match(r.reason, /漂移/);
});

test('decideSkip: 改动域相交 → 全量', () => {
  const dir = makeStateDir();
  fs.writeFileSync(stateFile(dir), JSON.stringify({
    schema: 'petri/closeout-gate-state.v1',
    gates: { 'gate:arch-cycles': { verifiedCommit: HEAD, configDigest: computeConfigDigest(ROOT, ARCH_DOMAIN.configPaths) } },
  }));
  const r = decideSkip({
    gateId: 'gate:arch-cycles', domain: ARCH_DOMAIN, statePath: stateFile(dir),
    changedFiles: ['docs/README.md', 'src/foo.js'],
  });
  assert.equal(r.skip, false);
  assert.match(r.reason, /域内命中/);
  assert.match(r.reason, /src\/foo\.js/);
});

test('decideSkip: 改动域不相交 → SKIP（带锚点 sha）', () => {
  const dir = makeStateDir();
  fs.writeFileSync(stateFile(dir), JSON.stringify({
    schema: 'petri/closeout-gate-state.v1',
    gates: { 'gate:arch-cycles': { verifiedCommit: HEAD, configDigest: computeConfigDigest(ROOT, ARCH_DOMAIN.configPaths) } },
  }));
  const r = decideSkip({
    gateId: 'gate:arch-cycles', domain: ARCH_DOMAIN, statePath: stateFile(dir),
    changedFiles: ['docs/README.md', 'scripts/foo.mjs', 'test/foo.test.mjs'],
  });
  assert.equal(r.skip, true);
  assert.match(r.reason, /域不相交/);
  assert.ok(r.reason.includes(HEAD.slice(0, 8)), 'reason 应带锚点短 sha');
});

test('decideSkip: force-full 旁路一切 → 全量', () => {
  const dir = makeStateDir();
  fs.writeFileSync(stateFile(dir), JSON.stringify({
    schema: 'petri/closeout-gate-state.v1',
    gates: { 'gate:arch-cycles': { verifiedCommit: HEAD, configDigest: computeConfigDigest(ROOT, ARCH_DOMAIN.configPaths) } },
  }));
  const r = decideSkip({
    gateId: 'gate:arch-cycles', domain: ARCH_DOMAIN, statePath: stateFile(dir),
    changedFiles: NO_CHANGES, forceFull: true,
  });
  assert.equal(r.skip, false);
  assert.match(r.reason, /force-full/);
});

test('recordPass → 落盘可读；round-trip 后域不相交场景可 SKIP', () => {
  const dir = makeStateDir();
  recordPass({ gateId: 'gate:arch-cycles', domain: ARCH_DOMAIN, statePath: stateFile(dir), verifiedCommit: HEAD });
  const state = readState({ statePath: stateFile(dir) });
  assert.equal(state.schema, 'petri/closeout-gate-state.v1');
  assert.equal(state.gates['gate:arch-cycles'].verifiedCommit, HEAD);
  assert.match(state.gates['gate:arch-cycles'].configDigest, /^[a-f0-9]{64}$/);
  const r = decideSkip({
    gateId: 'gate:arch-cycles', domain: ARCH_DOMAIN, statePath: stateFile(dir),
    changedFiles: ['docs/foo.md'],
  });
  assert.equal(r.skip, true);
});

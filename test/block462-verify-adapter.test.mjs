import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const VERIFY = path.join(ROOT, 'sidecars', 'three-live-runner', 'verify.mjs');
const CLI = path.join(ROOT, '.petri-dev-user-data', 'three-live', 'node_modules', 'three-live', 'dist', 'three-live-cli.js');
const toolInstalled = fs.existsSync(CLI);

// BLOCK-462 — L4 verification adapter 契约（HK-01 红绿先行）。
// three-live@1.4.0 隔离安装于 .petri-dev-user-data/three-live（B-2 裁决：外部工具 +
// adapter 隔离、capability 默认关、零产品依赖）。契约：JSON stdout 唯一机器出口；
// verdict=pass 当且仅当 info/render/sim 全过；诊断含 sha256（渲染证据双跑一致已实测）；
// --append-truth 把 verifierResults 追加进 SceneSpec metadata.provenance（不建第二真相）。

function run(args, cwd = ROOT) {
  const { spawnSync } = require('node:child_process');
  return spawnSync(process.execPath, [VERIFY, ...args], { cwd, encoding: 'utf8', timeout: 180000 });
}

function parseJsonLine(stdout) {
  const line = String(stdout).split('\n').filter((l) => l.startsWith('{')).pop();
  return line ? JSON.parse(line) : null;
}

test('BLOCK-462 前置：sidecar verify.mjs 在册（HK-01 红转绿的实现物）', () => {
  assert.equal(fs.existsSync(VERIFY), true, 'sidecars/three-live-runner/verify.mjs 必须在册');
});

test('BLOCK-462: 真实探针 GLB 全步验证 → verdict=pass + 渲染证据 sha256（需 three-live 已装，否则 skip）', { skip: toolInstalled ? false : 'three-live 隔离安装缺席（先 bootstrap）' }, () => {
  const glbRelative = 'test/fixtures/sand3d-probe-rest.glb';
  const outRelative = 'acceptance/block462/adapter-out';
  const result = run(['--glb', glbRelative, '--out', outRelative]);
  const payload = parseJsonLine(result.stdout);
  assert.ok(payload, `stdout 必须含 JSON 契约行: ${result.stdout.slice(0, 200)}`);
  assert.equal(payload.ok, true, `验证必须通过: ${JSON.stringify(payload).slice(0, 400)}`);
  assert.equal(payload.verdict, 'pass');
  assert.match(payload.glbSha256, /^[a-f0-9]{64}$/);
  assert.equal(payload.steps.info.ok, true);
  assert.equal(payload.steps.render.ok, true);
  assert.match(payload.steps.render.sha256, /^[a-f0-9]{64}$/);
  assert.equal(payload.steps.render.bytes > 0, true);
  assert.equal(payload.steps.sim.ok, true);
  assert.ok(payload.steps.sim.nodes >= 9, `sim 节点报告应含探针 GLB 的 9 节点: ${payload.steps.sim.nodes}`);
  assert.match(payload.digest, /^[a-f0-9]{64}$/);
});

test('BLOCK-462: sha256 复现用例——同一 GLB 双跑 digest 一致', { skip: toolInstalled ? false : 'three-live 隔离安装缺席' }, () => {
  const glbRelative = 'test/fixtures/sand3d-probe-rest.glb';
  const outA = 'acceptance/block462/repro-a';
  const outB = 'acceptance/block462/repro-b';
  const a = parseJsonLine(run(['--glb', glbRelative, '--out', outA]).stdout);
  const b = parseJsonLine(run(['--glb', glbRelative, '--out', outB]).stdout);
  assert.equal(a.digest, b.digest, `复现 digest 必须一致: ${a.digest} vs ${b.digest}`);
  assert.equal(a.steps.render.sha256, b.steps.render.sha256, '渲染证据 PNG 双跑一致（headless 确定性实测）');
});

test('BLOCK-462: 损坏 GLB → verdict=fail + 诚实退出（不伪造通过）', { skip: toolInstalled ? false : 'three-live 隔离安装缺席' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'block462-bad-'));
  const badGlb = path.join(root, 'bad.glb');
  fs.writeFileSync(badGlb, Buffer.from('definitely not a glTF container........'));
  // 越界路径守卫先用仓库内相对路径形态测试：把坏文件放进仓库 tmp（工作区内）
  const wsBad = path.join(ROOT, 'acceptance', 'block462', 'bad-tmp.glb');
  fs.writeFileSync(wsBad, Buffer.from('definitely not a glTF container........'));
  try {
    const result = run(['--glb', 'acceptance/block462/bad-tmp.glb', '--out', 'acceptance/block462/bad-out']);
    const payload = parseJsonLine(result.stdout);
    assert.ok(payload, '失败也必须输出 JSON 契约');
    assert.equal(payload.ok, false);
    assert.equal(payload.verdict, 'fail');
    assert.equal(result.status !== 0, true, '失败退出码非 0（诚实）');
  } finally {
    fs.rmSync(wsBad, { force: true });
    fs.rmSync(path.join(ROOT, 'acceptance', 'block462', 'bad-out'), { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('BLOCK-462: --append-truth 把 verifierResults 追加进 SceneSpec（单一真相，不建第二份）', { skip: toolInstalled ? false : 'three-live 隔离安装缺席' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'block462-truth-'));
  const sceneRel = 'acceptance/block462/truth-tmp.scene3d.json';
  const sceneAbs = path.join(ROOT, sceneRel);
  const spec = {
    version: 'scene3d/v1',
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    parameters: {},
    nodes: [{ id: 'probe_machine', type: 'mesh-reference', source: { path: 'test/fixtures/sand3d-probe-rest.glb', sourceSha256: '2e803be355e92866d276357311fba73d60f7092b5533764771b6e4d3bbf4434e' } }],
    joints: [],
    metadata: { provenance: { producer: 'sand3d', glbSha256: '2e803be355e92866d276357311fba73d60f7092b5533764771b6e4d3bbf4434e' } },
  };
  fs.writeFileSync(sceneAbs, `${JSON.stringify(spec, null, 2)}\n`);
  try {
    const result = run(['--glb', 'test/fixtures/sand3d-probe-rest.glb', '--out', 'acceptance/block462/truth-out', '--append-truth', sceneRel]);
    const payload = parseJsonLine(result.stdout);
    assert.equal(payload?.ok, true, JSON.stringify(payload).slice(0, 300));
    const written = JSON.parse(fs.readFileSync(sceneAbs, 'utf8'));
    const results = written.metadata?.provenance?.verifierResults;
    assert.ok(Array.isArray(results) && results.length === 1, 'verifierResults 必须追加一条');
    assert.equal(results[0].tool, 'three-live@1.4.0');
    assert.equal(results[0].verdict, 'pass');
    assert.match(results[0].digest, /^[a-f0-9]{64}$/);
    assert.ok(results[0].at, '时间戳在册');
    // 幂等：同 spec 再跑一次不重复追加（digest 相同的记录去重）
    run(['--glb', 'test/fixtures/sand3d-probe-rest.glb', '--out', 'acceptance/block462/truth-out', '--append-truth', sceneRel]);
    const written2 = JSON.parse(fs.readFileSync(sceneAbs, 'utf8'));
    assert.equal(written2.metadata.provenance.verifierResults.length, 1, '同 digest 重复验证不重复入账');
  } finally {
    fs.rmSync(sceneAbs, { force: true });
    fs.rmSync(path.join(ROOT, 'acceptance', 'block462', 'truth-out'), { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('BLOCK-462: 越界路径拒绝（adapter 不读工作区外文件）', () => {
  const result = run(['--glb', '../outside/secret.glb', '--out', 'acceptance/block462/x']);
  const payload = parseJsonLine(result.stdout);
  assert.equal(payload?.ok, false);
  assert.equal(payload?.error, 'path_outside_workspace');
});

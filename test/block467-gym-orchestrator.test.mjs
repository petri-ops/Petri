import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';

// BLOCK-467 / 3D P4 — Agent Gym 编排首片 HK-01 红绿先行（R3：只编排与证据，不引训练框架）。
// gym.mjs 编排 three-live gym reset → step×N → session finalize（"close"语义），
// 消费 BLOCK-459 探针 GLB，产 stdout 单行 JSON 证据 + digest 幂等；失败诚实。

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GYM = path.join(ROOT, 'sidecars/three-live-runner/gym.mjs');
const CLI = path.join(ROOT, '.petri-dev-user-data/three-live/node_modules/three-live/dist/three-live-cli.js');
const GLB = 'test/fixtures/sand3d-probe-rest.glb';
const toolInstalled = fs.existsSync(CLI);

function run(args, cwd = ROOT) {
  return spawnSync(process.execPath, [GYM, ...args], { cwd, encoding: 'utf8', timeout: 180000 });
}
function jsonLine(stdout) {
  // gym.mjs stdout 为单行 JSON；损坏源 fail 路径亦单行——兼容 pretty 兜底。
  try { return JSON.parse(String(stdout || '')); } catch { /* fallthrough */ }
  const line = String(stdout || '').split('\n').filter((l) => l.trim().startsWith('{')).pop();
  assert.ok(line, 'stdout 必须有 JSON');
  return JSON.parse(line);
}

describe('Agent Gym 编排契约（BLOCK-467 P4）', () => {
  it('实现物在册：gym.mjs + README gym 节', () => {
    assert.equal(fs.existsSync(GYM), true, 'gym.mjs 必须在场');
    const readme = fs.readFileSync(path.join(ROOT, 'sidecars/three-live-runner/README.md'), 'utf8');
    assert.match(readme, /gym\.mjs|Agent Gym 编排/, 'README 必须有 gym 编排说明');
  });

  it('真实探针 GLB：reset→step×2 产出 pass + 步数/观察形状/digest', { skip: toolInstalled ? false : 'three-live 隔离安装缺席' }, () => {
    const out = `acceptance/block467-3d-p4/run-${process.pid}`;
    try {
      const res = run(['--glb', GLB, '--out', out, '--steps', '2', '--actions', '[{"type":"moveCharacter","direction":[1,0,0]}]']);
      const payload = jsonLine(res.stdout);
      assert.equal(res.status, 0, `exit 应为 0: ${res.stderr}`);
      assert.equal(payload.verdict, 'pass');
      assert.match(payload.glbSha256, /^[0-9a-f]{64}$/);
      assert.match(payload.digest, /^[0-9a-f]{64}$/);
      assert.equal(payload.steps.observations.length, 3); // t0 reset + 2 steps
      for (const obs of payload.steps.observations) {
        assert.ok(typeof obs.step === 'number');
        assert.ok(typeof obs.tick === 'number');
        assert.ok(typeof obs.bodyCount === 'number' && obs.bodyCount > 0);
        assert.ok(typeof obs.reward === 'number');
        assert.ok(typeof obs.done === 'boolean');
      }
      assert.equal(payload.steps.reset.ok, true);
      assert.equal(payload.steps.finalize.ok, true);
      assert.ok(fs.existsSync(path.join(ROOT, out, 'gym-evidence.json')));
    } finally {
      fs.rmSync(path.join(ROOT, out), { recursive: true, force: true });
    }
  });

  it('digest 双跑一致（确定性字段集，时间戳/会话临时路径不入）', { skip: toolInstalled ? false : 'three-live 隔离安装缺席' }, () => {
    const digestOf = () => {
      const out = `acceptance/block467-3d-p4/repro-${process.pid}-${Math.random().toString(36).slice(2, 7)}`;
      try {
        const res = run(['--glb', GLB, '--out', out, '--steps', '1']);
        return jsonLine(res.stdout).digest;
      } finally {
        fs.rmSync(path.join(ROOT, out), { recursive: true, force: true });
      }
    };
    assert.equal(digestOf(), digestOf());
  });

  it('损坏 GLB → verdict=fail + exit≠0（诚实失败，不伪造 pass）', { skip: toolInstalled ? false : 'three-live 隔离安装缺席' }, () => {
    // 临时 GLB 落在已映射的 acceptance 证据目录内，避免未映射根文件触发 FAIL_CLOSED。
    const glbRel = `acceptance/block467-3d-p4/bad-${process.pid}.glb`;
    const out = `acceptance/block467-3d-p4/bad-${process.pid}-out`;
    fs.writeFileSync(path.join(ROOT, glbRel), 'not a glb');
    try {
      const res = run(['--glb', glbRel, '--out', out, '--steps', '1']);
      const payload = jsonLine(res.stdout);
      assert.notEqual(res.status, 0);
      assert.equal(payload.verdict, 'fail');
    } finally {
      fs.rmSync(path.join(ROOT, glbRel), { force: true });
      fs.rmSync(path.join(ROOT, out), { recursive: true, force: true });
    }
  });

  it('越界路径 → path_outside_workspace（防目录穿越）', () => {
    const res = run(['--glb', '../outside.glb', '--out', 'acceptance/block467-3d-p4/x', '--steps', '1']);
    const payload = jsonLine(res.stdout);
    assert.equal(payload.error, 'path_outside_workspace');
    assert.notEqual(res.status, 0);
  });

  it('零训练框架依赖面：gym.mjs 源码只 spawnSync three-live + node 内建', () => {
    const src = fs.readFileSync(GYM, 'utf8');
    assert.ok(/spawnSync/.test(src));
    for (const banned of ['torch', 'tensorflow', 'tfjs', '@tensorflow', 'brain.js', 'training']) {
      assert.equal(src.includes(banned), false, `不得引入训练框架 ${banned}`);
    }
  });
});

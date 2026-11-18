import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  evaluateSpecGate,
  advanceGate,
  validateExternalServices,
  PASSES,
} from '../sidecars/img2threejs-shim/spec-gate.mjs';

// BLOCK-469 / S5 — img2threejs 借形封装首片 HK-01 红绿先行。
// 借的是"门禁范式"（script-enforce / fail-closed / pass-gated / per-region confidence），
// 不整包、不引 Python/外部服务。fail-closed 不写 factory，是评估 §1.2 原则的核心。

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const goodSpec = () => ({
  version: 1,
  objectClass: 'hard-surface',
  componentTree: [{ id: 'body', region: 'shell', confidence: 0.9, children: [] }],
  materials: [{ id: 'matte', roughness: 0.8 }],
  sockets: [],
  runtimeHierarchy: { root: 'body' },
  detailInventory: [{ region: 'shell', level: 'structural' }],
});

describe('img2threejs 借形门禁骨架（BLOCK-469 S5）', () => {
  it('零整包安装证明：无上游包/宿主目录/Python runner 落仓', () => {
    assert.equal(fs.existsSync(path.join(ROOT, 'sidecars/img2threejs-shim/spec-gate.mjs')), true);
    for (const forbidden of [
      '.img2threejs', 'img2threejs/package.json', 'img2threejs/scripts',
    ]) {
      assert.equal(fs.existsSync(path.join(ROOT, forbidden)), false, `不得落盘整包 ${forbidden}`);
    }
    assert.equal(fs.existsSync(path.join(ROOT, 'sidecars/img2threejs-shim/requirements.txt')), false, '不得引入 Python 依赖');
  });

  it('合法 spec → pass + factoryEmitted=true（脚本强制门禁通过）', () => {
    const r = evaluateSpecGate(goodSpec());
    assert.equal(r.verdict, 'pass');
    assert.equal(r.factoryEmitted, true);
    assert.ok(Array.isArray(r.diagnostics));
  });

  it('fail-closed：缺 componentTree / 非法 class / 空节点 → BLOCKED 且不写 factory', () => {
    for (const bad of [
      { ...goodSpec(), componentTree: undefined },
      { ...goodSpec(), objectClass: 'unknown' },
      { ...goodSpec(), componentTree: [] },
      null,
    ]) {
      const r = evaluateSpecGate(bad);
      assert.equal(r.verdict, 'BLOCKED');
      assert.equal(r.factoryEmitted, false, 'BLOCKED 绝不写 factory（不冒充成功）');
      assert.ok(r.diagnostics.length > 0, 'BLOCKED 必带诊断');
    }
  });

  it('per-region confidence 低于阈值 → BLOCKED（评估 confidence→evidence 思想）', () => {
    const spec = goodSpec();
    spec.componentTree[0].confidence = 0.2;
    const r = evaluateSpecGate(spec);
    assert.equal(r.verdict, 'BLOCKED');
    assert.equal(r.factoryEmitted, false);
    assert.ok(r.diagnostics.some((d) => /confidence/i.test(d)));
  });

  it('pass-gated：按序推进 intake→spec→build→review→rig，跳阶/重复拒绝', () => {
    let state = { pass: 'intake' };
    state = advanceGate(state, 'spec');
    assert.equal(state.pass, 'spec');
    assert.equal(advanceGate(state, 'rig').rejected, true, '跳阶必须拒绝');
    assert.equal(advanceGate(state, 'spec').rejected, true, '重复同阶拒绝');
    state = advanceGate(state, 'build');
    state = advanceGate(state, 'review');
    state = advanceGate(state, 'rig');
    assert.equal(state.pass, 'rig');
    assert.deepEqual(PASSES, ['intake', 'spec', 'build', 'review', 'rig']);
  });

  it('外部服务默认关：非白名单服务一律拒绝，显式 allow 才放行', () => {
    const off = validateExternalServices({ host: {} });
    assert.equal(off.allowed, false, '未显式声明 = 默认关');
    const trellis = validateExternalServices({ host: {}, external: [{ name: 'hosted-trellis' }] });
    assert.equal(trellis.allowed, false, '外部服务默认 deny');
    assert.ok(trellis.diagnostics.some((d) => /denied|默认关/i.test(d)));
    const on = validateExternalServices({ host: {}, external: [{ name: 'hosted-trellis' }], externalServiceAllow: ['hosted-trellis'] });
    assert.equal(on.allowed, true, '仅显式 allow 才放行（P5-a 确认位）');
  });

  it('零训练/外部依赖面：spec-gate.mjs 仅 node 内建，无 img2threejs import/require', () => {
    const src = fs.readFileSync(path.join(ROOT, 'sidecars/img2threejs-shim/spec-gate.mjs'), 'utf8');
    assert.equal(/require\(['"]img2threejs|from ['"]img2threejs/.test(src), false, '不得 import 上游包');
    for (const banned of ['child_process', 'https', 'node-fetch', 'axios', 'tensorflow', 'torch']) {
      assert.equal(src.includes(banned), false, `纯本地门禁不得引入 ${banned}`);
    }
  });
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { clusterCycles, CLUSTERS } from '../scripts/post-s7-cycle-cluster.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('现场：12 个存量环全部归因到 5 个真实根因簇', () => {
  const e = JSON.parse(fs.readFileSync(path.join(ROOT, 'acceptance/post-s7-2026-11-10/h10/cycle-clusters.json'), 'utf8'));
  assert.equal(e.totalCycles, 12);
  assert.equal(e.ok, true);
  assert.deepEqual(e.unclustered, []);
  assert.equal(e.byCluster['agent-runner-agent-tools-backref'], 5);
  assert.equal(e.byCluster['agent-fallback-resume-backref'], 2);
  assert.equal(e.byCluster['tool-defs-registry-backref'], 1);
  assert.equal(e.byCluster['guest-permissions-backref'], 1);
  assert.equal(e.byCluster['frontend-component-mutual'], 3);
  assert.equal(Object.keys(e.byCluster).length, 5);
  assert.ok(e.note.includes('归簇≠消亡'), '不得冒充环已消亡');
});

test('负测：新簇出现必须被识别', () => {
  // 注册表清空后：任何环都是「未归簇」=新环，照旧被识别（值守语义不变）
  const r = clusterCycles(['brand-new-a.js -> brand-new-b.js -> brand-new-a.js']);
  assert.equal(r.unclustered.length, 1);
});

test('簇登记自洽（item86 收尾）：根因边已消亡，回归即红', () => {
  assert.equal(CLUSTERS.length, 0, 'item86 后五簇全部消亡，登记表应为空（新环走 arch-cycles 基线外即红）');
  // 值岗断言：item86 解耦的三类根因边不得回归（回归=新环，arch-cycles 门与这里双钉）
  const spawnSrc = fs.readFileSync(path.join(ROOT, 'core/petri-server/agent-tools/spawn-agent-tools.js'), 'utf8');
  assert.equal(
    spawnSrc.includes("require('../agent-runner')"),
    false,
    'spawn-agent-tools 不得恢复对 agent-runner 的反向 require（item86 改经 kernel-registry locator）',
  );
  const toolDefsSrc = fs.readFileSync(path.join(ROOT, 'core/petri-server/agent-tools/tool-defs.js'), 'utf8');
  assert.equal(
    /require\(['"]\.\/registry['"]\)/.test(toolDefsSrc),
    false,
    'tool-defs 不得恢复对 registry 的 require（纯数据面契约）',
  );
});
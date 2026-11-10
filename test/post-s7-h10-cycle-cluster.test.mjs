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
  const r = clusterCycles(['brand-new-a.js -> brand-new-b.js -> brand-new-a.js']);
  assert.equal(r.unclustered.length, 1);
  assert.equal(clusterCycles(['core/petri-server/agent-runner.js -> core/petri-server/agent-tools/x.js']).unclustered.length, 0);
});

test('簇登记自洽：根因边在源码里真实存在', () => {
  const src = fs.readFileSync(path.join(ROOT, 'core/petri-server/agent-tools/spawn-agent-tools.js'), 'utf8');
  assert.ok(src.includes("require('../agent-runner')"));
  assert.equal(CLUSTERS.length, 5);
});

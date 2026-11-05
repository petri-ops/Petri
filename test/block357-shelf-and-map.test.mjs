'use strict';

/**
 * BLOCK-357 — 四个 detour 逐件裁决 + 用户向能力地图生成器契约。
 */

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const shelf = read('acceptance/block-352/shelf-matrix.json');
const rulings = read('acceptance/block-357/detour-rulings.json');
const matrix = read('acceptance/functional-audit-2026-11-04/surface-matrix.json');

async function loadGenerator() {
  return import(pathToFileURL(path.join(ROOT, 'scripts/block357-capability-map.mjs')).href);
}

function allShelfItems() {
  const out = [];
  for (const [name, v] of Object.entries(shelf.shelves || {})) {
    const arr = Array.isArray(v) ? v : (v.items || []);
    for (const x of arr) out.push({ shelf: name, ...x });
  }
  return out;
}

describe('BLOCK-357 detour 逐件裁决', () => {
  test('矩阵里每个 detour 都有一条裁决（不漏项）', () => {
    const detours = allShelfItems().filter((x) => x.verdict === 'detour').map((x) => x.name).sort();
    const ruled = rulings.rulings.map((r) => r.name).sort();
    assert.deepEqual(ruled, detours, '裁决集合必须与矩阵 detour 集合完全一致');
    assert.equal(detours.length, 4);
  });

  test('每条裁决都有理由、绕路步骤、清偿触发条件，且未批量下架', () => {
    for (const r of rulings.rulings) {
      assert.equal(r.ruling, 'keep-with-detour', `${r.name} 不得被静默下架`);
      assert.ok(r.reason && r.reason.length > 20, `${r.name} 缺理由`);
      assert.ok(r.detourSteps && r.detourSteps.length > 10, `${r.name} 缺绕路步骤`);
      assert.ok(r.clearTrigger && r.rejudgeBy, `${r.name} 缺清偿触发条件`);
    }
    assert.equal(rulings.summary.removed, 0);
    assert.equal(rulings.summary.downgradedToShell, 0);
    assert.equal(rulings.summary.directPathCreated, 0, '不得伪造本仓直连路径');
  });

  test('零空壳保持：矩阵 verdicts 中 shell = 0', () => {
    assert.equal(shelf.totals.verdicts.detour, 4);
    assert.equal(shelf.totals.verdicts.available, 17);
    assert.equal(shelf.totals.verdicts.shell || 0, 0);
    assert.equal(shelf.totals.allJudged, true);
  });
});

describe('BLOCK-357 能力地图生成器', () => {
  test('同一矩阵输入生成结果确定（可复跑比对）', async () => {
    const g = await loadGenerator();
    assert.equal(g.buildCapabilityMap(matrix), g.buildCapabilityMap(matrix));
  });

  test('覆盖全部工具域且数字来自矩阵', async () => {
    const g = await loadGenerator();
    const md = g.buildCapabilityMap(matrix);
    assert.ok(md.includes(`${matrix.toolRows.length} 个工具`));
    for (const domain of new Set(matrix.toolRows.map((t) => t.domain))) {
      assert.ok(md.includes(`\`${domain}\``), `能力地图缺域 ${domain}`);
    }
    assert.ok(md.includes('P1=') && md.includes('P2='));
  });

  test('边界声明在场：G0 / 不外推 packaged / Provider / GA', async () => {
    const g = await loadGenerator();
    const md = g.buildCapabilityMap(matrix);
    assert.match(md, /G0 开发期/);
    assert.match(md, /不外推/);
    assert.match(md, /packaged/);
    g.assertNoOverclaim(md);
  });

  test('负测：越界宣称被守卫拦截', async () => {
    const g = await loadGenerator();
    assert.throws(
      () => g.assertNoOverclaim('本产品已发布，Provider 矩阵已验证，可发布对外'),
      /越界宣称/,
    );
  });

  test('磁盘产物与生成器输出一致（勿手改约束）', async () => {
    const g = await loadGenerator();
    const onDisk = fs.readFileSync(path.join(ROOT, 'docs/capability-map.md'), 'utf8');
    assert.equal(onDisk, g.buildCapabilityMap(matrix), '产物被手改或矩阵刷新后未重跑生成器');
  });
});

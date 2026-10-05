#!/usr/bin/env node

/**
 * BLOCK-141 R-2：bundle 体积基线机制——计量/比对纯函数契约测试。
 *
 * 机制（docs/block-141-riders-clearing-plan.md §1.1 R-2）：
 *   vite build → frontend/dist/assets 下全部 *.js（assets/** 递归 glob）gzip 计量 → 比对
 *   acceptance/bundle-size-baseline.json：
 *     - 单资产增幅 > 20%      → 红（exit 1）
 *     - 新增资产 gzip > 100KB → 红（exit 1）
 *     - 以内                  → 绿
 *   --write 重锚基线（@xyflow/react 增量就此入册的机制载体）。
 *
 * 本文件只测纯函数（HK-01：不跑真构建；vite build 与锚定运行留给集成阶段）。
 *
 * Run via: node --test test/block141-bundle-baseline.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

import {
  GROWTH_LIMIT_PCT,
  NEW_ASSET_LIMIT_BYTES,
  stripViteHash,
  computeGzipBytes,
  measureDistAssets,
  compareAgainstBaseline,
  buildBaseline,
} from '../scripts/bundle-size-baseline.mjs';

const KB = 1024;
const writeAsset = (distDir, relPath, content) => {
  const abs = path.join(distDir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
};

/** 造一个 measurement 形状（与 measureDistAssets 输出同构）。 */
const makeMeasurement = (assets) => {
  const map = {};
  let total = 0;
  for (const [key, gzipBytes] of Object.entries(assets)) {
    map[key] = { gzipBytes, rawBytes: gzipBytes * 3 };
    total += gzipBytes;
  }
  return { distDir: '<fixture>', scannedFiles: Object.keys(assets).length, collisions: 0, collisionKeys: [], assets: map, totalGzipBytes: total };
};

const makeBaseline = (assets) => ({
  schemaVersion: 1,
  anchored: true,
  limits: { growthPct: 20, newAssetGzipBytes: 100 * KB },
  updatedAt: '2026-10-05',
  assets,
  totalGzipBytes: Object.values(assets).reduce((a, b) => a + b, 0),
});

// ---------------------------------------------------------------------------
// 计量纯函数：vite 哈希名 → 稳定资产键（跨构建可比的前提）
// ---------------------------------------------------------------------------
describe('stripViteHash（稳定资产键）', () => {
  it('剥离 vite 默认 [name]-[hash] 哈希段，跨构建同名归并', () => {
    assert.strictEqual(stripViteHash('index-B1ghXk9p.js'), 'index.js');
    assert.strictEqual(stripViteHash('vendor-Cd_9xQ2z.js'), 'vendor.js');
    assert.strictEqual(stripViteHash('PanelChunk-a1B2c3D4.js'), 'PanelChunk.js');
  });

  it('子目录路径保留目录部分，只剥文件名哈希', () => {
    assert.strictEqual(stripViteHash('assets/chunk-AbCd1234.js'), 'assets/chunk.js');
  });

  it('无哈希段的名字原样返回（幂等）', () => {
    assert.strictEqual(stripViteHash('index.js'), 'index.js');
    assert.strictEqual(stripViteHash(stripViteHash('main-xYz12Abc.js')), 'main.js');
  });
});

describe('computeGzipBytes（gzip 计量）', () => {
  it('与 zlib.gzipSync 同值且确定性（同一内容两次计量一致）', () => {
    const content = Buffer.from('const x = ' + JSON.stringify({ a: 1, b: 'xyflow' }) + ';'.repeat(500));
    const first = computeGzipBytes(content);
    assert.strictEqual(first, computeGzipBytes(content));
    assert.strictEqual(first, zlib.gzipSync(content, { level: 9 }).length);
    assert.ok(first > 0 && first < content.length);
  });
});

describe('measureDistAssets（dist 资产扫描）', () => {
  it('扫描 assets/**/*.js、剥哈希成稳定键、忽略非 js', () => {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-r2-dist-'));
    try {
      writeAsset(dist, 'assets/index-B1ghXk9p.js', 'console.log("entry")'.repeat(40));
      writeAsset(dist, 'assets/vendor-Cd_9xQ2z.js', 'export const v = 1;'.repeat(30));
      writeAsset(dist, 'assets/nested/lazy-A1b2C3d4.js', 'export const l = 2;');
      writeAsset(dist, 'assets/logo-AbCd1234.svg', '<svg/>'); // 非 js 不计量
      writeAsset(dist, 'favicon.ico', 'x'); // assets 目录外不计理

      const m = measureDistAssets(dist);
      assert.deepStrictEqual(Object.keys(m.assets).sort(), ['index.js', 'nested/lazy.js', 'vendor.js']);
      assert.strictEqual(m.assets['index.js'].gzipBytes, computeGzipBytes(Buffer.from('console.log("entry")'.repeat(40))));
      assert.strictEqual(m.scannedFiles, 3);
      assert.strictEqual(m.collisions, 0);
      assert.strictEqual(m.totalGzipBytes, Object.values(m.assets).reduce((a, e) => a + e.gzipBytes, 0));
    } finally {
      fs.rmSync(dist, { recursive: true, force: true });
    }
  });

  it('同键哈希碰撞时保留较大者并如实计数（确定性）', () => {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-r2-coll-'));
    try {
      writeAsset(dist, 'assets/chunk-Aaaa1111.js', 'small');
      writeAsset(dist, 'assets/chunk-Bbbb2222.js', 'x'.repeat(4000));
      const m = measureDistAssets(dist);
      assert.strictEqual(m.collisions, 1);
      assert.deepStrictEqual(m.collisionKeys, ['chunk.js']);
      assert.strictEqual(m.assets['chunk.js'].gzipBytes, computeGzipBytes(Buffer.from('x'.repeat(4000))));
    } finally {
      fs.rmSync(dist, { recursive: true, force: true });
    }
  });

  it('dist 无 assets 目录 → 抛清晰错误（fail-closed）', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-r2-empty-'));
    try {
      assert.throws(() => measureDistAssets(empty), /assets/);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 比对纯函数：单资产增幅 >20% 红 / 新增资产 >100KB 红 / 以内绿
// ---------------------------------------------------------------------------
describe('compareAgainstBaseline（比对规则）', () => {
  it('单资产 gzip 增幅 >20% → 红（type=growth）', () => {
    const r = compareAgainstBaseline(makeMeasurement({ 'index.js': 1201 }), makeBaseline({ 'index.js': 1000 }));
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.violations.length, 1);
    assert.strictEqual(r.violations[0].type, 'growth');
    assert.strictEqual(r.violations[0].key, 'index.js');
    assert.strictEqual(r.violations[0].growthPct > GROWTH_LIMIT_PCT, true);
  });

  it('增幅恰为 20% → 绿（边界：规则是严格大于）', () => {
    const r = compareAgainstBaseline(makeMeasurement({ 'index.js': 1200 }), makeBaseline({ 'index.js': 1000 }));
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.violations.length, 0);
  });

  it('增幅略过 20%（20.1%）→ 红', () => {
    const r = compareAgainstBaseline(makeMeasurement({ 'index.js': 1201 }), makeBaseline({ 'index.js': 1000 }));
    assert.ok(r.violations[0].growthPct > 20);
    assert.strictEqual(r.ok, false);
  });

  it('新增资产 gzip >100KB → 红（type=new）', () => {
    const r = compareAgainstBaseline(makeMeasurement({ 'xyflow.js': 100 * KB + 1 }), makeBaseline({}));
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.violations.length, 1);
    assert.strictEqual(r.violations[0].type, 'new');
    assert.strictEqual(r.violations[0].key, 'xyflow.js');
  });

  it('新增资产恰为 100KB → 绿（边界：规则是严格大于）', () => {
    const r = compareAgainstBaseline(makeMeasurement({ 'xyflow.js': NEW_ASSET_LIMIT_BYTES }), makeBaseline({}));
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.violations.length, 0);
  });

  it('增幅 15% + 新增 50KB → 绿（以内）', () => {
    const r = compareAgainstBaseline(
      makeMeasurement({ 'index.js': 1150, 'charts.js': 50 * KB }),
      makeBaseline({ 'index.js': 1000 }),
    );
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.violations.length, 0);
    assert.strictEqual(r.summary.comparedAssets, 1);
    assert.strictEqual(r.summary.newAssets, 1);
  });

  it('基线 0 字节资产的正增长按新增资产规则判（增幅无定义，不误报 growth）', () => {
    const r = compareAgainstBaseline(makeMeasurement({ 'index.js': 50 * KB }), makeBaseline({ 'index.js': 0 }));
    assert.strictEqual(r.ok, true); // 50KB ≤ 100KB 新增阈值
    const r2 = compareAgainstBaseline(makeMeasurement({ 'index.js': 100 * KB + 1 }), makeBaseline({ 'index.js': 0 }));
    assert.strictEqual(r2.ok, false);
    assert.strictEqual(r2.violations[0].type, 'new');
  });

  it('基线有而当前无的资产只进 summary（不红：chunk 重组不误伤）', () => {
    const r = compareAgainstBaseline(makeMeasurement({ 'index.js': 1000 }), makeBaseline({ 'index.js': 1000, 'legacy.js': 999 }));
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.summary.removedAssets, ['legacy.js']);
  });

  it('双规则同时命中 → 两条违规都报', () => {
    const r = compareAgainstBaseline(
      makeMeasurement({ 'index.js': 2000, 'big.js': 200 * KB }),
      makeBaseline({ 'index.js': 1000 }),
    );
    assert.strictEqual(r.ok, false);
    assert.deepStrictEqual(r.violations.map((v) => v.type).sort(), ['growth', 'new']);
  });
});

// ---------------------------------------------------------------------------
// --write 重锚：基线对象形状 + 幂等
// ---------------------------------------------------------------------------
describe('buildBaseline（--write 重锚形状，幂等）', () => {
  const measurement = makeMeasurement({ 'index.js': 123456, 'vendor.js': 654321 });

  it('形状固定：schemaVersion/anchored/limits/updatedAt/assets/totalGzipBytes', () => {
    const b = buildBaseline(measurement, { anchored: true, updatedAt: '2026-10-05' });
    assert.deepStrictEqual(
      Object.keys(b).sort(),
      ['_about', 'anchored', 'assets', 'limits', 'schemaVersion', 'totalGzipBytes', 'updatedAt'].sort(),
    );
    assert.strictEqual(b.schemaVersion, 1);
    assert.deepStrictEqual(b.limits, { growthPct: 20, newAssetGzipBytes: 100 * KB });
    assert.deepStrictEqual(b.assets, { 'index.js': 123456, 'vendor.js': 654321 });
    assert.strictEqual(b.totalGzipBytes, 123456 + 654321);
  });

  it('幂等：同输入两次 buildBaseline 深相等，序列化两次字节一致', () => {
    const b1 = buildBaseline(measurement, { anchored: true, updatedAt: '2026-10-05' });
    const b2 = buildBaseline(measurement, { anchored: true, updatedAt: '2026-10-05' });
    assert.deepStrictEqual(b1, b2);
    assert.strictEqual(JSON.stringify(b1), JSON.stringify(b2));
  });

  it('assets 为空（未锚定初始态）→ 空映射 + anchored 如实传递', () => {
    const b = buildBaseline(makeMeasurement({}), { anchored: false, updatedAt: '2026-10-05' });
    assert.deepStrictEqual(b.assets, {});
    assert.strictEqual(b.totalGzipBytes, 0);
    assert.strictEqual(b.anchored, false);
  });
});

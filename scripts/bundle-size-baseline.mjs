#!/usr/bin/env node
'use strict';

/**
 * BLOCK-141 R-2：bundle 体积基线机制。
 *
 *   node scripts/bundle-size-baseline.mjs --measure              # vite build → dist gzip 计量 → 比对基线（超限 exit 1）
 *   node scripts/bundle-size-baseline.mjs --measure --skip-build # 跳过构建，直接计量既有 frontend/dist
 *   node scripts/bundle-size-baseline.mjs --write                # vite build → 计量 → 重锚 acceptance/bundle-size-baseline.json
 *   node scripts/bundle-size-baseline.mjs --write --skip-build   # 跳过构建，用既有 dist 重锚
 *
 * 比对规则（docs/block-141-riders-clearing-plan.md §1.1 R-2）：
 *   - 单资产 gzip 增幅 > 20%        → 红（exit 1）
 *   - 新增资产 gzip > 100KB         → 红（exit 1）
 *   - 以内                          → 绿
 * 规则是严格大于：恰为 20% / 恰为 100KB 都不红。--write 是唯一重锚通道
 * （@xyflow/react 等已裁决增量就此入册），重锚本身永不因超限而红。
 *
 * 计量/比对全部拆成纯函数导出（契约测试：test/block141-bundle-baseline.test.mjs，
 * HK-01 红绿先行、不跑真构建）；CLI 只做装配（spawn 构建计量落盘）。
 *
 * 资产键稳定性：vite 默认产物名是 [name]-[hash][extname]，哈希逐构建漂移；
 * 稳定键 = 剥掉扩展名前的 8 位哈希段（stripViteHash）。若哈希剥离失配，
 * 每次构建都会判「新增资产」→ fail-closed 报红，不会静默漏检。
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FRONTEND_DIR = path.join(ROOT_DIR, 'frontend');
const DIST_DIR = path.join(FRONTEND_DIR, 'dist');
const BASELINE_PATH = path.join(ROOT_DIR, 'acceptance', 'bundle-size-baseline.json');

/** 单资产 gzip 增幅上限（百分比，严格大于即红）。 */
export const GROWTH_LIMIT_PCT = 20;
/** 新增资产 gzip 字节上限（100KB，严格大于即红）。 */
export const NEW_ASSET_LIMIT_BYTES = 100 * 1024;

// ---------------------------------------------------------------------------
// 计量纯函数
// ---------------------------------------------------------------------------

/**
 * 剥掉 vite 默认哈希段得到稳定资产键：index-B1ghXk9p.js → index.js。
 * 只在「紧邻扩展名前」恰好是 8 位 [A-Za-z0-9_-] 时才剥（vite hashDigestLength 默认 8），
 * 避免误剥普通连字符名。幂等：无哈希名原样返回。
 */
export function stripViteHash(fileName) {
  return fileName.replace(/-([A-Za-z0-9_-]{8})(\.[A-Za-z0-9]+)$/, '$2');
}

/** gzip 字节计量（level 9：确定性优先，同内容同值）。 */
export function computeGzipBytes(content) {
  return zlib.gzipSync(content, { level: 9 }).length;
}

/**
 * 扫描 <distDir>/assets 下递归全部 *.js，计量 gzip/raw 字节。
 * 返回形状（确定性：目录遍历按名字排序，键按稳定键插入序）：
 *   { distDir, scannedFiles, collisions, collisionKeys,
 *     assets: { [稳定键]: { gzipBytes, rawBytes } }, totalGzipBytes }
 * 哈希剥离碰撞（两个物理文件同稳定键）保留较大者并如实计数，不静默吞。
 * assets 目录缺失 → 抛错（fail-closed，CLI 转 exit 1）。
 */
export function measureDistAssets(distDir) {
  const assetsDir = path.join(distDir, 'assets');
  if (!fs.existsSync(assetsDir) || !fs.statSync(assetsDir).isDirectory()) {
    throw new Error(`dist assets 目录不存在: ${assetsDir}（先跑 vite build，或用 --skip-build 指向已构建的 dist）`);
  }
  const jsFiles = [];
  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile() && entry.name.endsWith('.js')) jsFiles.push(abs);
    }
  };
  walk(assetsDir);

  const assets = {};
  const collisionKeys = [];
  let collisions = 0;
  let totalGzipBytes = 0;
  for (const abs of jsFiles) {
    const rel = path.relative(assetsDir, abs).split(path.sep).join('/');
    const key = stripViteHash(rel);
    const raw = fs.readFileSync(abs);
    const entry = { gzipBytes: computeGzipBytes(raw), rawBytes: raw.length };
    if (Object.prototype.hasOwnProperty.call(assets, key)) {
      collisions += 1;
      if (!collisionKeys.includes(key)) collisionKeys.push(key);
      if (entry.gzipBytes > assets[key].gzipBytes) assets[key] = entry;
    } else {
      assets[key] = entry;
    }
    totalGzipBytes += entry.gzipBytes;
  }
  return { distDir, scannedFiles: jsFiles.length, collisions, collisionKeys, assets, totalGzipBytes };
}

// ---------------------------------------------------------------------------
// 比对纯函数
// ---------------------------------------------------------------------------

/**
 * 计量结果对照基线。返回 { ok, violations, summary }（纯函数，无 IO 无日期）：
 *   violations[].type = 'growth'（单资产增幅 > 20%）| 'new'（新增资产 > 100KB）
 * 边界是严格大于：恰 20% / 恰 100KB 不红。基线缺该键判「新增」；
 * 基线 0 字节资产的增幅无定义，按新增资产规则判（不虚构 growth 百分比）；
 * 基线有而当前无的资产只进 summary.removedAssets（chunk 重组不误伤）。
 */
export function compareAgainstBaseline(measurement, baseline, limits = {}) {
  const growthLimitPct = limits.growthPct ?? baseline?.limits?.growthPct ?? GROWTH_LIMIT_PCT;
  const newAssetLimitBytes = limits.newAssetGzipBytes ?? baseline?.limits?.newAssetGzipBytes ?? NEW_ASSET_LIMIT_BYTES;
  const baselineAssets = baseline?.assets ?? {};

  const violations = [];
  let comparedAssets = 0;
  let newAssets = 0;

  for (const key of Object.keys(measurement.assets)) {
    const currentBytes = measurement.assets[key].gzipBytes;
    const baselineBytes = Object.prototype.hasOwnProperty.call(baselineAssets, key) ? baselineAssets[key] : null;

    if (baselineBytes === null || baselineBytes === 0) {
      newAssets += 1;
      if (currentBytes > newAssetLimitBytes) {
        violations.push({
          type: 'new',
          key,
          baselineGzipBytes: baselineBytes,
          currentGzipBytes: currentBytes,
          limitGzipBytes: newAssetLimitBytes,
          message:
            `新增资产 ${key}: gzip ${currentBytes}B 超过新增阈值 ${newAssetLimitBytes}B（100KB）` +
            (baselineBytes === 0 ? '（基线 0 字节，按新增规则判）' : ''),
        });
      }
      continue;
    }

    comparedAssets += 1;
    // 先乘后除保持整数路径精确：(1200-1000)*100/1000 === 20，恰 20% 不红
    const growthPct = ((currentBytes - baselineBytes) * 100) / baselineBytes;
    if (growthPct > growthLimitPct) {
      violations.push({
        type: 'growth',
        key,
        baselineGzipBytes: baselineBytes,
        currentGzipBytes: currentBytes,
        growthPct,
        limitPct: growthLimitPct,
        message: `单资产增幅 ${key}: gzip ${baselineBytes}B → ${currentBytes}B（+${growthPct.toFixed(1)}% > 上限 ${growthLimitPct}%）`,
      });
    }
  }

  violations.sort((a, b) => a.type.localeCompare(b.type) || a.key.localeCompare(b.key));
  const removedAssets = Object.keys(baselineAssets)
    .filter((key) => !Object.prototype.hasOwnProperty.call(measurement.assets, key))
    .sort();

  return {
    ok: violations.length === 0,
    violations,
    summary: { comparedAssets, newAssets, removedAssets },
  };
}

// ---------------------------------------------------------------------------
// 重锚纯函数（--write）
// ---------------------------------------------------------------------------

/**
 * 由计量结果构造基线对象（--write 落盘形状）。确定性：键排序、无运行时随机，
 * 同输入（含固定 updatedAt）两次构造深相等、序列化字节一致（幂等）。
 * anchored 如实传递：初始锚（未跑真构建）false，重锚 true。
 */
export function buildBaseline(measurement, { anchored, updatedAt }) {
  const assets = {};
  for (const key of Object.keys(measurement.assets).sort()) {
    assets[key] = measurement.assets[key].gzipBytes;
  }
  return {
    _about:
      'R-2 bundle 体积基线（BLOCK-141）：vite build 后 frontend/dist/assets 下 *.js 的 gzip 字节' +
      '（资产键已剥 vite 哈希段）。门禁=scripts/bundle-size-baseline.mjs --measure：单资产增幅 >20% 或' +
      '新增资产 gzip >100KB 即红；已裁决增量用 --write 重锚（@xyflow/react 增量就此入册），禁止手改 assets 数字。',
    schemaVersion: 1,
    anchored: Boolean(anchored),
    limits: { growthPct: GROWTH_LIMIT_PCT, newAssetGzipBytes: NEW_ASSET_LIMIT_BYTES },
    updatedAt,
    assets,
    totalGzipBytes: Object.values(assets).reduce((sum, bytes) => sum + bytes, 0),
  };
}

// ---------------------------------------------------------------------------
// CLI 装配（纯函数之上）
// ---------------------------------------------------------------------------

const parseFlags = (argv) => ({
  measure: argv.includes('--measure'),
  write: argv.includes('--write'),
  skipBuild: argv.includes('--skip-build'),
});

// 直接以本进程 node 拉起 frontend 的 vite build（等价 npm run build 的 vite build 段）；
// 不经 npm/shell，无平台分支——platform-branch-freeze 门禁冻结 scripts/** 新增平台分支。
const VITE_BIN = path.join(FRONTEND_DIR, 'node_modules', 'vite', 'bin', 'vite.js');

const runViteBuild = () =>
  new Promise((resolve, reject) => {
    if (!fs.existsSync(VITE_BIN)) {
      reject(new Error(`vite 不可执行: ${VITE_BIN}（先 cd frontend && npm install）`));
      return;
    }
    console.log('[bundle-baseline] 运行 frontend 生产构建（vite build）…');
    const child = spawn(process.execPath, [VITE_BIN, 'build'], { cwd: FRONTEND_DIR, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`vite build 失败（exit ${code}）`)),
    );
  });

const formatBytes = (bytes) => `${(bytes / 1024).toFixed(1)}KB`;

const printMeasurement = (measurement) => {
  console.log(
    `[bundle-baseline] 计量完成：${measurement.scannedFiles} 个 js → ` +
      `${Object.keys(measurement.assets).length} 个稳定键，gzip 总量 ${formatBytes(measurement.totalGzipBytes)}`,
  );
  if (measurement.collisions > 0) {
    console.log(`[bundle-baseline] ⚠ 稳定键碰撞 ${measurement.collisions} 处（保留较大者）: ${measurement.collisionKeys.join(', ')}`);
  }
  const ranked = Object.entries(measurement.assets).sort((a, b) => b[1].gzipBytes - a[1].gzipBytes).slice(0, 10);
  for (const [key, { gzipBytes }] of ranked) {
    console.log(`  ${formatBytes(gzipBytes).padStart(9)}  ${key}`);
  }
};

async function runCli(argv) {
  const flags = parseFlags(argv);
  if (flags.measure && flags.write) {
    console.error('用法: node scripts/bundle-size-baseline.mjs --measure | --write [--skip-build]（--measure 与 --write 互斥）');
    return 2;
  }
  if (!flags.measure && !flags.write) {
    // 无模式旗标 = 零副作用提示态、exit 0（不宣称任何检查）：node --test 会把本脚本
    // 当文件目标执行（argv[1]=本脚本），此时必须不红；裸跑真实 CLI 同样只给无害提示。
    // 门禁语义只存在于 --measure / --write 模式（违规 exit 1）。
    console.log('用法: node scripts/bundle-size-baseline.mjs --measure | --write [--skip-build]');
    return 0;
  }
  if (!flags.skipBuild) await runViteBuild();

  const measurement = measureDistAssets(DIST_DIR);
  printMeasurement(measurement);

  if (flags.write) {
    const baseline = buildBaseline(measurement, { anchored: true, updatedAt: new Date().toISOString().slice(0, 10) });
    fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
    fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
    console.log(`[bundle-baseline] 基线已重锚 → ${path.relative(ROOT_DIR, BASELINE_PATH)}（${Object.keys(baseline.assets).length} 键）`);
    return 0;
  }

  if (!fs.existsSync(BASELINE_PATH)) {
    console.error(`[bundle-baseline] ✗ 基线不存在: ${path.relative(ROOT_DIR, BASELINE_PATH)}（先跑 --write 锚定）`);
    return 1;
  }
  let baseline;
  try {
    baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  } catch (error) {
    console.error(`[bundle-baseline] ✗ 基线不可解析: ${error.message}`);
    return 1;
  }
  if (baseline.anchored !== true) {
    console.error('[bundle-baseline] ✗ 基线尚未锚定（anchored=false；初始空锚，先跑 --write 完成首次锚定）');
    return 1;
  }

  const result = compareAgainstBaseline(measurement, baseline);
  if (result.ok) {
    console.log(
      `[bundle-baseline] ✓ 绿：比对 ${result.summary.comparedAssets} 资产，新增 ${result.summary.newAssets}` +
        `（全部在限内：增幅 ≤ ${GROWTH_LIMIT_PCT}% 且新增 ≤ ${formatBytes(NEW_ASSET_LIMIT_BYTES)}）` +
        (result.summary.removedAssets.length ? `，移除 ${result.summary.removedAssets.length}` : ''),
    );
    return 0;
  }
  for (const violation of result.violations) console.error(`[bundle-baseline] ✗ ${violation.message}`);
  console.error(`[bundle-baseline] ✗ 红：${result.violations.length} 条超限。已裁决的增量请用 --write 重锚入册。`);
  return 1;
}

const SCRIPT_PATH = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  runCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`[bundle-baseline] 失败: ${error.message}`);
      process.exitCode = 1;
    });
}

/**
 * scripts/lib/arch-cruise.mjs — dependency-cruiser 共享单轮 cruise（BLOCK-272）
 *
 * 一次收口内 gate:arch-cycles 与 quality:arch 共享同一份 cruise JSON，消除
 * 「同三棵树 cruise 两遍」：合并配置 = .dependency-cruiser.cjs 的 R1-R5 +
 * P3-no-cycles（arch-cycles 的环规则，配置逐字段同 arch-cycles-gate 原实现），
 * 输出 JSON 由各门自行过滤本门规则（extractCycleSignatures / evaluateArchRules）。
 *
 * 缓存：node_modules/.cache/petri-closeout/arch-cruise-<runId>.json，新鲜度 =
 * PETRI_CLOSEOUT_RUN_ID + HEAD 同轮一致（聚合器注入 runId）；无 runId（独立运行）
 * 不读不写缓存。**不做跨轮复用**：untracked 文件内容变更对 git status 不可见，
 * 跨轮复用不健全——跨轮性能由 closeout 域跳过承担。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const SELF = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SELF, '..', '..');
const CRUISE_TARGETS = ['src', 'core', 'frontend/src'];
// 与 arch-cycles-gate.mjs 原 cruiseCycles() 的环规则逐字段一致。
const CYCLE_RULE = {
  name: 'P3-no-cycles',
  comment: 'BLOCK-109-CORE-ARCH P3-2 — 循环依赖硬门禁（存量环入基线，新环即红）',
  severity: 'error',
  from: {},
  to: { circular: true },
};

function loadBaseConfig(root = REPO_ROOT) {
  const require = createRequire(import.meta.url);
  return require(path.join(root, '.dependency-cruiser.cjs'));
}

export function runSharedCruise({ root = REPO_ROOT, runId = process.env.PETRI_CLOSEOUT_RUN_ID || null } = {}) {
  const cacheDir = path.join(root, 'node_modules', '.cache', 'petri-closeout');
  const cachePath = runId
    ? path.join(cacheDir, `arch-cruise-${String(runId).replace(/[^\w.-]/g, '_')}.json`)
    : null;
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

  if (cachePath && fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (cached.runId === runId && cached.head === head && Array.isArray(cached.violations)) {
        return { violations: cached.violations, cached: true, cachePath };
      }
    } catch {
      // 缓存损坏即重 cruise（fail-open）
    }
  }

  const base = loadBaseConfig(root);
  const config = { forbidden: [...(base.forbidden || []), CYCLE_RULE], options: { ...(base.options || {}) } };
  // os.tmpdir 而非仓库根：Windows unlink 竞态（AV/索引器持句柄）会把残留留进工作区，
  // 污染 knip 保留面扫描（arch-cycles-gate 原实现同款注释，先例保持）。
  const configFile = path.join(os.tmpdir(), `petri-arch-cruise-${process.pid}.cjs`);
  fs.writeFileSync(configFile, `module.exports = ${JSON.stringify(config)};`);
  const cruiserBin = path.join(root, 'node_modules', 'dependency-cruiser', 'bin', 'dependency-cruiser.mjs');
  if (!fs.existsSync(cruiserBin)) {
    throw new Error(`dependency-cruiser bin 缺失（依赖损坏）: ${cruiserBin}`);
  }
  try {
    const out = execFileSync(
      process.execPath,
      [cruiserBin, ...CRUISE_TARGETS, '--config', configFile, '--output-type', 'json'],
      { cwd: root, maxBuffer: 256 * 1024 * 1024, encoding: 'utf8' },
    );
    const violations = JSON.parse(out).summary?.violations || [];
    if (cachePath) {
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(cachePath, JSON.stringify({ runId, head, cachedAt: new Date().toISOString(), violations }) + '\n');
    }
    return { violations, cached: false, cachePath };
  } finally {
    try { fs.unlinkSync(configFile); } catch { /* 清理失败不阻塞 */ }
  }
}

/**
 * L0-2（蓝图 L-30）：perf 基线绑定的热路径源码与 host 单源。
 *
 * collect 与 gate 共用本清单——任一热路径文件变化或 host 漂移，基线即失效，
 * gate fail-closed 要求重采（node scripts/block350-perf-collect.mjs）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

/** perf 四场景覆盖的热路径源码（入口/DB 面/两读路径/spawn 机制）。 */
export const HOT_PATH_FILES = Object.freeze([
  'core/petri-server/server.js',
  'core/petri-server/bootstrap.js',
  'core/petri-server/db/connection.js',
  'core/petri-server/db/schema.js',
  'core/petri-server/routes/ai-conversations.js',
  'core/petri-server/routes/files.js',
  'scripts/lib/evals-harness.mjs',
]);

/** 组合指纹（对清单逐文件 rel\0内容 求和），与旧单文件 coreSha 不兼容——旧基线即失效。 */
export function computeHotPathSha(root) {
  const h = crypto.createHash('sha256');
  for (const rel of HOT_PATH_FILES) {
    h.update(rel);
    h.update('\0');
    h.update(fs.readFileSync(path.join(root, rel)));
  }
  return h.digest('hex').slice(0, 16);
}

/** host 指纹：换机型 / CPU 数 / Node 版本变化都要求重采。 */
export function describeHost() {
  return {
    platform: `${os.platform()}-${os.arch()}`,
    cpus: os.cpus().length,
    memoryGB: Math.round(os.totalmem() / 1073741824),
    node: process.version,
  };
}

/** 基线有效性裁决（纯函数，供负测）：host 或热路径 sha 失配即要求重采。 */
export function adjudicateBaselineBinding(baseline, { host, coreSha } = {}) {
  const issues = [];
  const h = host || describeHost();
  const sha = coreSha || computeHotPathSha(process.cwd());
  if (!baseline || typeof baseline !== 'object') issues.push('基线缺席');
  if (!baseline?.host) issues.push('基线缺 host 绑定（L-30）——重采基线');
  else {
    for (const key of ['platform', 'cpus', 'node']) {
      if (baseline.host[key] !== h[key]) issues.push(`host.${key} 漂移（基线 ${JSON.stringify(baseline.host[key])} ≠ 当前 ${JSON.stringify(h[key])}）——基线失效，重采：node scripts/block350-perf-collect.mjs`);
    }
  }
  if (!baseline?.coreSha) issues.push('基线缺 coreSha 绑定（L-30）——重采基线');
  else if (baseline.coreSha !== sha) issues.push(`热路径源码变化（基线 ${baseline.coreSha} ≠ 当前 ${sha}）——基线失效，重采：node scripts/block350-perf-collect.mjs`);
  return { ok: issues.length === 0, issues };
}

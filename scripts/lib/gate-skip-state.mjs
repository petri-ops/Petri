/**
 * scripts/lib/gate-skip-state.mjs — 收口门禁域跳过状态（BLOCK-272）
 *
 * 判定链（任一不满足即全量，fail-open，绝不出错性跳过）：
 *   1) force-full 显式旁路；
 *   2) 状态文件在且 schema 合法（缺失 → 无验证状态；损坏 → fail-open）；
 *   3) 锚点 merge-base --is-ancestor 可达（rebase/换分支即失效）；
 *   4) 门禁配置/基线 digest 未变；
 *   5) 锚点以来改动（锚点..HEAD + 工作区 + untracked）与门禁域不相交。
 *
 * 写入纪律：SKIP 不刷新锚点（防漂移累积）；只有门禁实际全量跑过且 PASS 才 recordPass。
 * 状态文件默认 `.petri-dev-user-data/closeout-gate-state.json`（gitignored 运行时目录，
 * 仿 scripts/lib/dev-launch-state.js 模式；statePath 可注入供测试）。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { collectChangedFiles, runGit, currentHead } from './changed-files.mjs';

const SELF = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SELF, '..', '..');
export const DEFAULT_STATE_PATH = path.join(REPO_ROOT, '.petri-dev-user-data', 'closeout-gate-state.json');
export const STATE_SCHEMA = 'petri/closeout-gate-state.v1';

export function readState({ statePath = DEFAULT_STATE_PATH } = {}) {
  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (state && state.schema === STATE_SCHEMA && state.gates && typeof state.gates === 'object') return state;
    return null;
  } catch {
    return null; // 缺失/损坏一律按无状态处理（fail-open）
  }
}

export function computeConfigDigest(root, configPaths) {
  const hash = crypto.createHash('sha256');
  for (const rel of configPaths) {
    hash.update(rel);
    hash.update('\u0000');
    try {
      hash.update(fs.readFileSync(path.resolve(root, rel)));
    } catch {
      hash.update('<missing>'); // 配置缺失视作内容变化（fail-open 全量）
    }
  }
  return hash.digest('hex');
}

export function recordPass({ gateId, domain, statePath = DEFAULT_STATE_PATH, verifiedCommit = null, root = REPO_ROOT } = {}) {
  const head = verifiedCommit ?? currentHead({ root });
  const state = readState({ statePath }) ?? { schema: STATE_SCHEMA, gates: {} };
  state.updatedAt = new Date().toISOString();
  state.gates[gateId] = {
    verifiedCommit: head,
    configDigest: computeConfigDigest(root, domain.configPaths),
    verifiedAt: state.updatedAt,
  };
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
}

/**
 * 域跳过判定。changedFiles 可注入（测试确定性）；缺省从 git 实算（锚点以来 + 工作区 + untracked）。
 * 返回 { skip, reason, anchor? }。
 */
export function decideSkip({
  gateId, domain, statePath = DEFAULT_STATE_PATH, forceFull = false, changedFiles = null, root = REPO_ROOT,
} = {}) {
  if (forceFull) return { skip: false, reason: 'force-full：显式要求全量' };

  let raw = null;
  let corrupt = false;
  try {
    raw = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    if (fs.existsSync(statePath)) corrupt = true;
  }
  if (corrupt) return { skip: false, reason: '状态文件损坏（fail-open 全量）' };
  const state = raw && raw.schema === STATE_SCHEMA && raw.gates ? raw : null;
  const rec = state ? state.gates[gateId] : null;
  if (!rec || !rec.verifiedCommit) return { skip: false, reason: '无验证状态（首次或从未全量通过）' };

  const anchor = rec.verifiedCommit;
  try {
    runGit(['merge-base', '--is-ancestor', anchor, 'HEAD'], { root });
  } catch {
    return { skip: false, reason: `锚点不可达（rebase/换分支）：${anchor.slice(0, 8)}` };
  }
  if (rec.configDigest !== computeConfigDigest(root, domain.configPaths)) {
    return { skip: false, reason: '配置/基线漂移（digest 失配）' };
  }

  const files = changedFiles ?? collectChangedFiles({ base: anchor, root });
  const hits = files.filter((f) => domain.matchFile(f) || domain.configPaths.includes(f));
  if (hits.length > 0) {
    const shown = hits.slice(0, 3).join(', ');
    return { skip: false, reason: `域内命中（${shown}${hits.length > 3 ? ` 等 ${hits.length} 个` : ''}）`, anchor };
  }
  return {
    skip: true,
    reason: `域不相交：锚点 ${anchor.slice(0, 8)} 以来 ${files.length} 个改动均不在${domain.label || '门禁域'}`,
    anchor,
  };
}

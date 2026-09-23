#!/usr/bin/env node
'use strict';

/**
 * scripts/code-size-ledger.mjs — 巨型文件行数/指纹台账（v2，BLOCK-109-CORE-ARCH P3-1）
 *
 * v1（BLOCK-92 P1）：清单驱动行数棘轮（任一文件 > 基线行数即红）。
 * v2 新增（P3-1 裁决）：
 *   - sha256 内容指纹：基线记录每文件内容指纹；指纹漂移（改动未随提交重打基线）即红，
 *     「node scripts/code-size-ledger.mjs --write」刷新并同提交——有意的变更必须显式重打。
 *   - 预算 + 例外 expires：单文件预算 700 行；超预算文件必须有**未过期**例外
 *     （acceptance/block-92/size-exceptions.json：{path, reason, expires, sha256?}），
 *     到期未清（仍超预算）即红；续期=更新 expires 并登记理由。例外可选 sha256 锚定
 *     （冻结文件场景：锚后任何改动即红）。
 *
 * 用法：
 *   node scripts/code-size-ledger.mjs                 # 打印当前度量 JSON（可复现）
 *   node scripts/code-size-ledger.mjs --write         # 重打 v2 基线（含 sha256）
 *   node scripts/code-size-ledger.mjs --check         # 门禁：棘轮+指纹+预算例外
 *   --baseline <path> --exceptions <path> --today YYYY-MM-DD   # 自测注入（不复产文件）
 *
 * 可复现契约：同 HEAD 两次 --check 输出逐字节一致（不含时间戳/绝对路径）。
 * 自测：test/block109-p3-gates.test.mjs 构造红/绿样本直接调用 evaluateGate。
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, 'acceptance', 'block-92', 'size-baseline.json');
const EXCEPTIONS = path.join(ROOT, 'acceptance', 'block-92', 'size-exceptions.json');
export const BUDGET_LINES = 700;
const SCHEMA_V2 = 'biof3/block109-size-ledger.v2';

// plan §1 清单（BLOCK-92 P1 立项时 ≥700 行产品文件；拆分完成后原文件可能只剩薄层）
const MANIFEST = [
  { path: 'frontend/src/components/copilot/conversationRunStore.ts', wave: 'A', module: 'W-03' },
  { path: 'frontend/src/components/copilot/copilotClient.ts', wave: 'A', module: 'W-03' },
  { path: 'frontend/src/components/copilot/SimpleChat.tsx', wave: 'A', module: 'W-03' },
  { path: 'frontend/src/components/copilot/SimpleChat/hooks/useThinkingLevel.ts', wave: 'A', module: 'W-03' },
  { path: 'frontend/src/components/copilot/SimpleChat/hooks/useScrollGuard.ts', wave: 'A', module: 'W-03' },
  { path: 'frontend/src/pages/project-workspace.tsx', wave: 'B', module: 'W-02' },
  { path: 'frontend/src/components/workspace-panels/ResultArtifactShell.tsx', wave: 'B', module: 'W-04' },
  { path: 'frontend/src/components/desktop/WorkingTreeReview/ReviewMode.tsx', wave: 'B', module: 'W-04' },
  { path: 'frontend/src/components/desktop/DesktopSettingsPanel.tsx', wave: 'B', module: 'W-01' },
  { path: 'frontend/src/components/desktop/PluginStorePanel.tsx', wave: 'B', module: 'W-01' },
  { path: 'frontend/src/pages/home.tsx', wave: 'B', module: 'W-02' },
  { path: 'frontend/src/components/desktop/WorkingTreeReview/useWorkingTreeReview.ts', wave: 'B', module: 'W-04' },
  { path: 'frontend/src/hooks/useSkillStore.ts', wave: 'B', module: 'W-02' },
  { path: 'frontend/src/components/result-studio/ResultStudioChangeSetPanel.tsx', wave: 'B', module: 'W-04' },
  { path: 'core/shared-backend/result-changeset-service.js', wave: 'C', module: 'W-04' },
  { path: 'core/biof3-server/helpers/tools-executor.js', wave: 'C', module: 'P-03' },
  { path: 'core/biof3-server/db.js', wave: 'C', module: 'P-01' },
  { path: 'core/shared-backend/result-studio-repository.js', wave: 'C', module: 'W-04' },
  { path: 'core/biof3-server/agent-tools/workspace-tools.js', wave: 'C', module: 'P-03' },
  { path: 'core/biof3-server/mcp/registry.js', wave: 'C', module: 'P-02' },
  { path: 'core/shared-backend/result-studio-lifecycle.js', wave: 'C', module: 'W-04' },
  { path: 'core/shared-backend/result-replay-service.js', wave: 'C', module: 'W-04' },
  { path: 'core/shared-backend/git-adapter.js', wave: 'C', module: 'P-01' },
  { path: 'src/ipc/working-tree-review.js', wave: 'D', module: 'P-01' },
];

function countLines(abs) {
  const text = fs.readFileSync(abs, 'utf8');
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.length;
}

function sha256(abs) {
  return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
}

function buildLedger(manifest = MANIFEST) {
  const files = manifest.map((entry) => {
    const abs = path.join(ROOT, entry.path);
    if (!fs.existsSync(abs)) {
      throw new Error(`manifest 文件不存在且未更新台账清单: ${entry.path}`);
    }
    return { ...entry, lines: countLines(abs), sha256: sha256(abs) };
  });
  const total = files.reduce((sum, f) => sum + f.lines, 0);
  return { schema: SCHEMA_V2, files, total };
}

/**
 * 门禁核心（纯函数，供 CLI 与自测共用）。
 * @returns {{ ok: boolean, violations: string[], warnings: string[] }}
 */
export function evaluateGate({ current, baseline, exceptions, today }) {
  const violations = [];
  const warnings = [];
  const baseMap = new Map(baseline.files.map((f) => [f.path, f]));
  const currentMap = new Map(current.files.map((f) => [f.path, f]));
  const exceptionMap = new Map((exceptions.exceptions || []).map((e) => [e.path, e]));

  // 例外登记卫生：未知路径的例外即红（清单已不含该文件时须显式移除例外）
  for (const [p] of exceptionMap) {
    if (!currentMap.has(p)) violations.push(`${p}: 例外登记的文件不在台账清单——请移除该例外`);
  }

  for (const file of current.files) {
    const base = baseMap.get(file.path);
    if (base === undefined) {
      violations.push(`${file.path}: 新入册文件未刷新基线——请 --write 并同提交`);
      continue;
    }
    // 1) 行数棘轮（v1 语义保留）
    if (file.lines > base.lines) {
      violations.push(`${file.path}: ${file.lines} > 基线 ${base.lines}（棘轮只减不增）`);
    }
    // 2) sha256 指纹（P3-1）：改动必须随提交显式重打基线
    if (file.sha256 !== base.sha256) {
      violations.push(`${file.path}: 内容指纹漂移（sha256 变更未随提交重打基线）——node scripts/code-size-ledger.mjs --write`);
    }
    // 3) 预算 + 例外 expires（P3-1）：超预算必须有未过期例外
    if (file.lines > BUDGET_LINES) {
      const exc = exceptionMap.get(file.path);
      if (!exc) {
        violations.push(`${file.path}: ${file.lines} 行超预算 ${BUDGET_LINES} 且无例外——请登记 {reason, expires} 或拆分降至预算内`);
      } else if (!/^\d{4}-\d{2}-\d{2}$/.test(String(exc.expires || ''))) {
        violations.push(`${file.path}: 例外 expires 缺失或非 YYYY-MM-DD`);
      } else if (exc.expires < today) {
        violations.push(`${file.path}: 例外已过期（expires=${exc.expires}）且仍 ${file.lines} 行超预算——到期未清即红；续期需登记理由`);
      } else if (exc.sha256 && exc.sha256 !== file.sha256) {
        violations.push(`${file.path}: 例外 sha256 锚定漂移——冻结文件被改动；续期需登记理由并刷新锚定`);
      } else if (!String(exc.reason || '').trim()) {
        violations.push(`${file.path}: 例外缺 reason（续期/授予都必须登记理由）`);
      }
    } else if (exceptionMap.has(file.path)) {
      warnings.push(`${file.path}: 已降至预算内（${file.lines} ≤ ${BUDGET_LINES}）——例外可移除`);
    }
  }
  return { ok: violations.length === 0, violations, warnings };
}

function isDirectInvocation() {
  try {
    return import.meta.url === pathToFileURL(process.argv[1] || '').href;
  } catch {
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const argValue = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
  };
  const baselinePath = argValue('--baseline') || BASELINE;
  const exceptionsPath = argValue('--exceptions') || EXCEPTIONS;
  const manifestPath = argValue('--manifest');
  const manifest = manifestPath
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    : MANIFEST;

  const ledger = buildLedger(manifest);

  if (args.includes('--check')) {
    let baseline;
    try {
      baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    } catch {
      console.error(`[code-size-ledger] FAIL 基线文件不可读: ${baselinePath}`);
      process.exit(1);
    }
    if (baseline.schema !== SCHEMA_V2) {
      console.error(`[code-size-ledger] FAIL 基线为 ${baseline.schema || 'v1'}——P3 起需 v2（含 sha256 指纹）。请 --write 升级并随提交登记。`);
      process.exit(1);
    }
    let exceptions = { exceptions: [] };
    try {
      exceptions = JSON.parse(fs.readFileSync(exceptionsPath, 'utf8'));
    } catch {
      console.error('[code-size-ledger] WARN 例外文件不可读（视为无例外）');
    }
    const today = argValue('--today') || new Date().toISOString().slice(0, 10);
    const result = evaluateGate({ current: ledger, baseline, exceptions, today });
    for (const w of result.warnings) console.warn(`[code-size-ledger] WARN ${w}`);
    if (!result.ok) {
      console.error('[code-size-ledger] FAIL 门禁违规：');
      for (const v of result.violations) console.error(`  - ${v}`);
      process.exit(1);
    }
    const activeExceptions = (exceptions.exceptions || []).length;
    console.log(`[code-size-ledger] PASS v2 门禁（${ledger.files.length} 文件，总行数 ${ledger.total}，基线 ${baseline.total}，生效例外 ${activeExceptions}，预算 ${BUDGET_LINES} 行）`);
    process.exit(0);
  }

  const json = JSON.stringify(ledger, null, 2);
  if (args.includes('--write')) {
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
    fs.writeFileSync(baselinePath, `${json}\n`);
    console.log(`[code-size-ledger] v2 基线已写入 ${path.relative(ROOT, baselinePath) || baselinePath}`);
  } else {
    console.log(json);
  }
}

if (isDirectInvocation()) {
  await main();
}

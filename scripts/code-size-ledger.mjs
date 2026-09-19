#!/usr/bin/env node
'use strict';

/**
 * BLOCK-92 P1 — M1 行数台账（巨型文件模块化二期的可复现度量）。
 *
 * 清单驱动（plan §1 的 22 个 ≥700 行产品文件，非扫描式——扫描会把阈值边缘
 * 文件抖动进台账，破坏「只减不增」棘轮的稳定基线）。
 *
 * 用法：
 *   node scripts/code-size-ledger.mjs                 # 打印 JSON（可复现，无时间戳）
 *   node scripts/code-size-ledger.mjs --write        # 写入 acceptance/block-92/size-baseline.json
 *   node scripts/code-size-ledger.mjs --check        # 棘轮：任一文件行数 > 基线即 exit 1（只减不增）
 *
 * 可复现契约：同 HEAD 两次运行输出逐字节一致（不含时间戳/绝对路径）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, 'acceptance', 'block-92', 'size-baseline.json');

// plan §1 清单（2026-09-16 wc -l 基线证据；wave 对应 plan §4）
const MANIFEST = [
  // Wave A — 前端 copilot 族
  { path: 'frontend/src/components/copilot/conversationRunStore.ts', wave: 'A', module: 'W-03' },
  { path: 'frontend/src/components/copilot/copilotClient.ts', wave: 'A', module: 'W-03' },
  { path: 'frontend/src/components/copilot/SimpleChat.tsx', wave: 'A', module: 'W-03' },
  // 三波拆分（2026-09-19）— SimpleChat 簇外迁 hooks/ 入册
  { path: 'frontend/src/components/copilot/SimpleChat/hooks/useThinkingLevel.ts', wave: 'A', module: 'W-03' },
  { path: 'frontend/src/components/copilot/SimpleChat/hooks/useScrollGuard.ts', wave: 'A', module: 'W-03' },
  { path: 'frontend/src/components/copilot/SimpleChat/hooks/useTerminalSubAgentResults.ts', wave: 'A', module: 'W-03' },
  // Wave B — 前端页面/面板族
  { path: 'frontend/src/pages/project-workspace.tsx', wave: 'B', module: 'W-02' },
  { path: 'frontend/src/components/workspace-panels/ResultArtifactShell.tsx', wave: 'B', module: 'W-04' },
  { path: 'frontend/src/components/desktop/WorkingTreeReview/ReviewMode.tsx', wave: 'B', module: 'W-04' },
  { path: 'frontend/src/components/desktop/DesktopSettingsPanel.tsx', wave: 'B', module: 'W-01' },
  { path: 'frontend/src/components/desktop/PluginStorePanel.tsx', wave: 'B', module: 'W-01' },
  { path: 'frontend/src/pages/home.tsx', wave: 'B', module: 'W-02' },
  { path: 'frontend/src/components/desktop/WorkingTreeReview/useWorkingTreeReview.ts', wave: 'B', module: 'W-04' },
  { path: 'frontend/src/hooks/useSkillStore.ts', wave: 'B', module: 'W-02' },
  { path: 'frontend/src/components/result-studio/ResultStudioChangeSetPanel.tsx', wave: 'B', module: 'W-04' },
  // Wave C — core 族
  { path: 'core/shared-backend/result-changeset-service.js', wave: 'C', module: 'W-04' },
  { path: 'core/biof3-server/helpers/tools-executor.js', wave: 'C', module: 'P-03' },
  { path: 'core/biof3-server/db.js', wave: 'C', module: 'P-01' },
  { path: 'core/shared-backend/result-studio-repository.js', wave: 'C', module: 'W-04' },
  { path: 'core/biof3-server/agent-tools/workspace-tools.js', wave: 'C', module: 'P-03' },
  { path: 'core/biof3-server/mcp/registry.js', wave: 'C', module: 'P-02' },
  { path: 'core/shared-backend/result-studio-lifecycle.js', wave: 'C', module: 'W-04' },
  { path: 'core/shared-backend/result-replay-service.js', wave: 'C', module: 'W-04' },
  { path: 'core/shared-backend/git-adapter.js', wave: 'C', module: 'P-01' },
  // Wave D — src/ 族
  { path: 'src/ipc/working-tree-review.js', wave: 'D', module: 'P-01' },
];

function countLines(relativePath) {
  const abs = path.join(ROOT, relativePath);
  const text = fs.readFileSync(abs, 'utf8');
  const lines = text.split('\n');
  // 与 wc -l 同口径：末尾无换行时最后一行不计入换行数，但行数含末行。
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.length;
}

function buildLedger() {
  const files = MANIFEST.map((entry) => {
    const abs = path.join(ROOT, entry.path);
    if (!fs.existsSync(abs)) {
      // 拆分完成后原文件可能只剩 re-export 薄层（<700）——台账仍记录其实际行数
      if (!fs.existsSync(abs)) {
        // 路径彻底不存在 = 拆分重命名，要求显式更新 MANIFEST（fail-closed）
        throw new Error(`manifest 文件不存在且未更新台账清单: ${entry.path}`);
      }
    }
    return { ...entry, lines: countLines(entry.path) };
  });
  const total = files.reduce((sum, f) => sum + f.lines, 0);
  return {
    schema: 'biof3/block92-size-ledger.v1',
    head: (() => {
      try {
        return fs
          .readFileSync(path.join(ROOT, '.git', 'HEAD'), 'utf8')
          .trim();
      } catch {
        return 'unknown';
      }
    })(),
    files,
    total,
  };
}

const args = process.argv.slice(2);
const ledger = buildLedger();

if (args.includes('--check')) {
  let baseline;
  try {
    baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  } catch {
    console.error(`[code-size-ledger] FAIL 基线文件不可读: ${BASELINE}`);
    process.exit(1);
  }
  const baseMap = new Map(baseline.files.map((f) => [f.path, f.lines]));
  const violations = [];
  for (const file of ledger.files) {
    const base = baseMap.get(file.path);
    if (base === undefined) continue; // 新入册文件（显式更新清单时同步刷新基线）
    if (file.lines > base) violations.push(`${file.path}: ${file.lines} > 基线 ${base}（棘轮只减不增）`);
  }
  if (violations.length > 0) {
    console.error('[code-size-ledger] FAIL 棘轮违规：');
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }
  console.log(`[code-size-ledger] PASS 棘轮检查（${ledger.files.length} 文件，总行数 ${ledger.total}，基线 ${baseline.total}）`);
  process.exit(0);
}

const json = JSON.stringify(ledger, null, 2);
if (args.includes('--write')) {
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
  fs.writeFileSync(BASELINE, `${json}\n`);
  console.log(`[code-size-ledger] 基线已写入 ${path.relative(ROOT, BASELINE)}`);
} else {
  console.log(json);
}

#!/usr/bin/env node
'use strict';
/**
 * audit-log-compact.mjs — AUDIT-LOG 自稳（BLOCK-170 · 用户裁决
 * 「需要有个更稳定且优秀的设计 靠手动来优化 AUDIT-LOG 是不合理的」；
 * v1 基座=BLOCK-105 增量 · 用户裁决「AUDIT-LOG 的规范和精简应该是自动化的过程，仅保留必要的内容」）
 *
 * v2 全量自稳（v1 只管「最近处理记录」表；铁律=**搬移不改写**——台账原文只能被整行
 * 搬进归档，永不被工具截断或改写；超长行的收敛责任在写入方，由 docs:check 建议级提示）：
 *   保留（活跃台）：
 *     - 头部（含入口直链行，永不剪切）+ 「最后更新」链最近 CHAIN_KEEP 条
 *     - 「当前待处理项」全量（🔴/🟡/🟢 是活跃广播）
 *     - 「最近处理记录」表最新 ROWS_KEEP 条（表结构行与段内说明原样保留）
 *     - 「广播规则」全量
 *   剪切（归档台，原文追加）：
 *     - 链淘汰行 → archive/checkpoints/audit-log-through-<被剪行最新日期>.md
 *     - 表淘汰行 → archive/checkpoints/audit-log-compact-<运行日>.md（v1 约定延续）
 *   幂等：无淘汰行输出「already compact」且不改文件。
 *   接线：npm run closeout 首步自动执行；docs:check 对 >50KB 出建议级提示、
 *   >120KB（单读工具安全阈）硬红（AUDIT_LOG_OVERSIZE）。
 * 归档后必须跑 `npm run docs:check`（registry entrypoint 直链不得随旧记录进归档）。
 *
 * 用法：node scripts/audit-log-compact.mjs   （npm run audit:compact）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHAIN_KEEP = Number(process.env.AUDIT_LOG_CHAIN_KEEP ?? 8);
export const ROWS_KEEP = Number(process.env.AUDIT_LOG_ROWS_KEEP ?? 10);

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const LEDGER = path.join(ROOT, 'docs', 'AUDIT-LOG.md');
const ARCHIVE_DIR = path.join(ROOT, 'docs', 'archive', 'checkpoints');

const PENDING_HEAD = '## 当前待处理项';
const RECORDS_HEAD = '## 最近处理记录';
const RULES_HEAD = '## 广播规则';
const CHAIN_ENTRY = /^(?:此前 )?最后更新：/;

/** 从一条台账行提取 YYYY-MM-DD 日期（无则 null）。 */
function entryDate(line) {
  const match = line.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

/**
 * 纯函数核心：给定台账行数组，返回保留/剪切划分。不触碰文件系统，便于契约直测。
 * 结构不变量（fail-closed）：三段标题必须存在且按 链→待处理项→记录表→规则 排列。
 */
export function compactLedgerLines(lines, { chainKeep = CHAIN_KEEP, rowsKeep = ROWS_KEEP } = {}) {
  const idxPending = lines.findIndex((l) => l.trim() === PENDING_HEAD);
  const idxRecords = lines.findIndex((l) => l.trim() === RECORDS_HEAD);
  const idxRules = lines.findIndex((l) => l.trim() === RULES_HEAD);
  if (idxPending < 0 || idxRecords < 0 || idxRules < 0) {
    throw new Error('未找到「当前待处理项」/「最近处理记录」/「广播规则」段——文件结构变更，人工核查。');
  }
  if (!(idxPending < idxRecords && idxRecords < idxRules)) {
    throw new Error('段序异常（应为 链→当前待处理项→最近处理记录→广播规则）——人工核查。');
  }

  // 「最后更新」链：文件按最新在前，保留前 chainKeep 条，其余淘汰。
  // 头部引用行（> 开头，含入口直链）与空行不是链条目，永不剪切。
  const chainCutIdx = new Set();
  let chainSeen = 0;
  for (let i = 0; i < idxPending; i += 1) {
    if (CHAIN_ENTRY.test(lines[i])) {
      chainSeen += 1;
      if (chainSeen > chainKeep) chainCutIdx.add(i);
    }
  }

  // 处理记录表：✅ 行按表序（新→旧）只留前 rowsKeep 条；窗口外即使是其包唯一行也淘汰
  //（包状态真相在 roadmap/plan，台账只承载「最近处理记录」）。表结构行/段内说明不受窗口约束。
  const rowsCutIdx = new Set();
  let rowSeen = 0;
  for (let i = idxRecords + 1; i < idxRules; i += 1) {
    if (lines[i].startsWith('| ✅')) {
      rowSeen += 1;
      if (rowSeen > rowsKeep) rowsCutIdx.add(i);
    }
  }

  const outLines = lines.filter((_, i) => !chainCutIdx.has(i) && !rowsCutIdx.has(i));
  const chainCutLines = [...chainCutIdx].map((i) => lines[i]);
  const rowsCutLines = [...rowsCutIdx].map((i) => lines[i]);
  const dates = chainCutLines.map(entryDate).filter(Boolean).sort();
  return { outLines, chainCutLines, rowsCutLines, throughDate: dates[dates.length - 1] ?? null };
}

function main() {
  const lines = fs.readFileSync(LEDGER, 'utf8').split('\n');
  const result = compactLedgerLines(lines);
  if (result.chainCutLines.length === 0 && result.rowsCutLines.length === 0) {
    console.log('[audit-compact] already compact——无淘汰行，文件未改动。');
    return;
  }

  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);

  if (result.chainCutLines.length > 0) {
    const throughDate = result.throughDate ?? stamp;
    const throughPath = path.join(ARCHIVE_DIR, `audit-log-through-${throughDate}.md`);
    const note = fs.existsSync(throughPath)
      ? `\n<!-- audit-log-compact.mjs 追加 @ ${new Date().toISOString()} -->\n`
      : [
          `# 审计广播台历史归档 · through ${throughDate}`,
          '',
          `> 来源声明：本档由 scripts/audit-log-compact.mjs 自动剪切生成（BLOCK-170 自稳设计；`,
          `> 活跃台只留「最后更新」链最近 ${CHAIN_KEEP} 条，本档=被淘汰链行原文追加，搬移不改写）。`,
          `> 状态与完成语义以 canonical 文档（roadmap/plan/DOC-REGISTRY）为准，本档仅作广播历史追溯。`,
          '',
          '',
        ].join('\n');
    fs.appendFileSync(throughPath, `${note}${result.chainCutLines.join('\n')}\n`, 'utf8');
  }

  if (result.rowsCutLines.length > 0) {
    const compactPath = path.join(ARCHIVE_DIR, `audit-log-compact-${stamp}.md`);
    const note = fs.existsSync(compactPath)
      ? `\n<!-- audit-log-compact.mjs 追加 @ ${new Date().toISOString()} -->\n`
      : [
          `# AUDIT-LOG 自动精简归档 · ${stamp}（audit-log-compact.mjs）`,
          '',
          `> 来源声明：本档由 scripts/audit-log-compact.mjs 自动剪切生成（用户裁决「AUDIT-LOG 的规范和精简`,
          `> 应该是自动化的过程，仅保留必要的内容」）。内容=「最近处理记录」表窗口外淘汰行原文（搬移不改写）。`,
          `> canonical 状态以 roadmap/plan/DOC-REGISTRY 为准，本档仅作广播历史追溯。`,
          '',
          '',
        ].join('\n');
    fs.appendFileSync(compactPath, `${note}${result.rowsCutLines.join('\n')}\n`, 'utf8');
  }

  fs.writeFileSync(LEDGER, `${result.outLines.join('\n')}`, 'utf8');
  console.log(
    `[audit-compact] 链淘汰 ${result.chainCutLines.length} 行 + 记录表淘汰 ${result.rowsCutLines.length} 行 → ${path.relative(ROOT, ARCHIVE_DIR)}/`,
  );
  console.log(`[audit-compact] 活跃台现在 ${fs.statSync(LEDGER).size} 字节。请跑 npm run docs:check 验证直链完整性。`);
}

if (path.resolve(process.argv[1] ?? '') === SCRIPT_PATH) {
  main();
}

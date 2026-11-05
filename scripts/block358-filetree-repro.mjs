#!/usr/bin/env node
/**
 * BLOCK-358 / C-47 — 文件树连翻页「惰性 / 回弹」证据回放与归因辅助。
 *
 * 诚实边界（重要）：
 * - 本脚本**不声称复现了 GUI 竞态**。349 的 B3 是 GUI 会话中的单次观察
 *   （clicked=true / 200→200 / grew=false），headless 无法重放真实点击与面板轮询。
 * - 脚本做的是：把模糊观察变成**可复算的数据**（游标序列不变量检查），
 *   并静态列出可核查的候选竞态点（file:line），供后续人工复现时定位。
 * - 结论三态之一，默认 `observed_but_not_reproduced`：
 *   观察证据在场、headless 未独立复现、根因未归因 → **不做猜测性修复、不销票**。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EVIDENCE = path.join(ROOT, 'acceptance/block-349/block349-bigdir-live-darwin.json');
const OUT = path.join(ROOT, 'acceptance/block-358/repro-result.json');

/**
 * 回放点击序列，检查游标单调性与根列表重置。
 * @param {Array<{ click:number, rowsBefore:number, rowsAfter:number, label?:string }>} clicks
 */
export function replayPagingClicks(clicks) {
  const steps = [];
  let nonMonotonic = 0;
  let resets = 0;
  for (const c of clicks) {
    const grew = c.rowsAfter > c.rowsBefore;
    const reset = c.rowsAfter < c.rowsBefore;
    if (!grew) nonMonotonic += 1;
    if (reset) resets += 1;
    steps.push({ click: c.click, rowsBefore: c.rowsBefore, rowsAfter: c.rowsAfter, grew, reset, label: c.label || '' });
  }
  return { steps, nonMonotonic, resets, cursorMonotonic: nonMonotonic === 0 && resets === 0 };
}

/** 从 349 的 B2/B3 观察生成可复算序列（两次独立观察，不拼成连续会话）。 */
export function observationsFromEvidence(evidence) {
  const text = JSON.stringify(evidence);
  const b2 = /200\s*(?:→|->)\s*400/.test(text);
  const b3 = /200\s*(?:→|->)\s*200/.test(text);
  return {
    // B2 与 B3 是两次独立观察，各自成一段，避免误导为同一次会话的连续点击
    b2CursorLoadMoreGrows: b2,
    b3RepeatClickInert: b3,
    clicks: [
      ...(b2 ? [{ click: 1, rowsBefore: 200, rowsAfter: 400, label: 'B2 游标加载生效（独立观察）' }] : []),
      ...(b3 ? [{ click: 1, rowsBefore: 200, rowsAfter: 200, label: 'B3 单次复击惰性（独立观察）' }] : []),
    ],
  };
}

/** 静态候选竞态点：只报告真实存在的文件/符号，不猜测根因。 */
export function candidateRacePoints() {
  const candidates = [
    { file: 'frontend/src/components/workspace-panels', symbol: '加载更多 / cursor / hasMore', note: 'UI 层点击与游标推进的同步点' },
    { file: 'frontend/src/components/copilot/SimpleChat/hooks/useScrollGuard.ts', symbol: 'scroll guard', note: '滚动/轮询收敛可能触发列表重建' },
    { file: 'frontend/src/components/copilot/SimpleChat/hooks/useConversationResume.ts', symbol: 'resume', note: '会话恢复与面板状态重置的交叉面' },
  ];
  return candidates.filter((c) => fs.existsSync(path.join(ROOT, c.file)));
}

export function buildConclusion() {
  const evidence = JSON.parse(fs.readFileSync(EVIDENCE, 'utf8'));
  const obs = observationsFromEvidence(evidence);
  const replay = replayPagingClicks(obs.clicks);
  const races = candidateRacePoints();
  return {
    package: 'BLOCK-358',
    at: '2026-11-05',
    source: 'acceptance/block-349/block349-bigdir-live-darwin.json (B2/B3)',
    triState: 'observed_but_not_reproduced',
    statement: 'B3 观察证据在场（单次复击 grew=false），但 headless 无法重放 GUI 点击与面板轮询收敛，未独立复现；根因未归因。',
    observations: { b2CursorLoadMoreGrows: obs.b2CursorLoadMoreGrows, b3RepeatClickInert: obs.b3RepeatClickInert },
    replay,
    candidateRacePoints: races,
    rootCauseAttributed: false,
    fixApplied: false,
    ticketStatus: 'kept-open',
    ticketStatusNote: 'C-47 保持「观察未归因」，不销票、不做猜测性修复；启动条件仍为人工复现归因后立票。',
    nextStep: '人工在 520 文件项目上连续点击「加载更多」并观察面板轮询收敛，记录每次游标与根列表状态；归因后再立修复票。',
    honestBoundary: '本脚本是证据回放与静态候选归因，不是 GUI 复现；不得表述为「已复现并修复」。',
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const conclusion = buildConclusion();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(conclusion, null, 2)}\n`);
  console.log(`[block358] triState=${conclusion.triState} rootCause=${conclusion.rootCauseAttributed} fix=${conclusion.fixApplied}`);
  console.log(`[block358] replay: nonMonotonic=${conclusion.replay.nonMonotonic} resets=${conclusion.replay.resets} candidates=${conclusion.candidateRacePoints.length}`);
  console.log(`[block358] out=${path.relative(ROOT, OUT)}`);
}

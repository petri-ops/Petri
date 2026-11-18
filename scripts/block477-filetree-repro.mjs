#!/usr/bin/env node
/**
 * BLOCK-477 / C-47 — 文件树连翻页「惰性 / 回弹」源码锚定 + 分页时序状态机 + 三态结论。
 *
 * 与 BLOCK-358 的差别：358 只回放 349 的两段独立观察（200→400 / 200→200）并列静态候选点，
 * 明确「未复现、未归因」。本模块对**真实源码语义**做确定性建模：
 *   - loadMoreRoot 以 rootMore.done 续拉并 append（RightFileTree.tsx:168-178）
 *   - 本地项目 2s 轮询 refreshFiles()（:268-270）
 *   - refreshFiles 以 fetchDirPage('', 0) 覆盖整树并把 rootMore.done 重置回第一页（:180-185）
 * 三处构成「加载第 2 页后 ≤2s 内被拉回第一页」的确定性因果链，可复算、可负测。
 *
 * 诚实边界：状态机是源码语义抽象，不冒充 GUI 真值；GUI 复现证据由 block477-filetree-live.cjs
 * 在 9223 离屏实例（若环境允许）产出。本模块 triState 依据两类证据给出，并声明 evidenceLevel。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_FILE = 'frontend/src/pages/project-workspace/RightFileTree.tsx';

/** 从源码机械提取三处因果模式；任一缺失即判缺失（fail-closed）。 */
export function scanSourceAnchors(root) {
  const file = path.join(root, SOURCE_FILE);
  let src = '';
  try { src = fs.readFileSync(file, 'utf8'); } catch { src = ''; }
  const compact = src.replace(/\s+/g, ' ');
  const loadMoreAppend = /setTree\(\s*\(prev\)\s*=>\s*\[\.\.\.prev,\s*\.\.\.page\.entries\]\)/.test(compact)
    && /fetchDirPage\('',\s*rootMore\.done\)/.test(compact);
  const refreshResetsToOffsetZero = /const\s+rootPage\s*=\s*await\s+fetchDirPage\('',\s*0\)/.test(compact)
    && /setTree\(rootPage\.entries\)/.test(compact)
    && /setRootMore\(rootPage\.truncated/.test(compact);
  const pollEvery2s = /setInterval\(\s*\(\)\s*=>\s*\{[^}]*refreshFiles\(\)[^}]*\},\s*2000\s*\)/.test(compact);
  return {
    loadMoreAppend,
    refreshResetsToOffsetZero,
    pollEvery2s,
    allPresent: loadMoreAppend && refreshResetsToOffsetZero && pollEvery2s,
    source: SOURCE_FILE,
  };
}

/**
 * 分页时序状态机。默认 pollResets=true 复刻当前源码；传 false 模拟"轮询不重置"的修复版做负测。
 * 返回首击 / 轮询后行数与游标，以及是否观测到回弹与惰性。
 */
export function simulatePaging({
  total = 520,
  pageSize = 200,
  clicks = 2,
  pollAfterEachClickMs = 2000,
  pollResets = true,
} = {}) {
  // 起始：首次加载第 1 页（B0/B1：200 行 + 「加载更多（剩余 320）」）
  let rows = Math.min(pageSize, total);
  let cursorDone = rows;
  const firstPage = { rows, cursorDone };
  const truncated = () => cursorDone < total;

  // 首击「加载更多」（B2）：从 cursorDone 续拉一页 → 200→400
  if (truncated()) {
    const added = Math.min(pageSize, total - cursorDone);
    rows += added;
    cursorDone += added;
  }
  const afterFirstClick = { rows, cursorDone };

  // 2s 轮询 refreshFiles()：当前源码以 offset=0 覆盖整树，游标回第一页 → 400→200
  const afterPoll = pollResets
    ? { rows: Math.min(pageSize, total), cursorDone: Math.min(pageSize, total) }
    : { rows, cursorDone };

  // 回弹 = 已增长后出现行数回落；惰性 = 回弹后再次点击只回到第一页量级（B3 的 200→200 grew=false）
  const reboundObserved = afterPoll.rows < afterFirstClick.rows;
  const inertObserved = reboundObserved && afterPoll.rows <= firstPage.rows;

  return {
    input: { total, pageSize, clicks, pollAfterEachClickMs, pollResets },
    initialPage: firstPage,
    afterFirstClick,
    afterPoll,
    reboundObserved,
    inertObserved,
    rootCauseChain: pollResets
      ? 'loadMoreRoot append → 2s poll refreshFiles → fetchDirPage(\'\',0) 覆盖 setTree + 重置 rootMore.done'
      : 'pollResets=false：轮询不重置，因果链断开',
  };
}

/** 三态结论。sourceAnchors 全在场且状态机复现回弹 → reproduced_and_attributed。 */
export function buildConclusion(root) {
  const anchors = scanSourceAnchors(root);
  const replay = simulatePaging();
  const reproduced = anchors.allPresent && replay.reboundObserved && replay.inertObserved;
  const triState = reproduced ? 'reproduced_and_attributed' : 'observed_not_reproduced';
  return {
    package: 'BLOCK-477',
    source: SOURCE_FILE,
    triState,
    statement: reproduced
      ? '源码三处因果模式在场，状态机确定性复现「加载第 2 页后 2s 轮询拉回第一页」→ B3 惰性/回弹根因可归因。'
      : '源码锚点未全部在场或状态机未复现回弹，保持 observed_not_reproduced，不硬归因。',
    sourceAnchors: anchors,
    replay,
    rootCauseAttributed: reproduced,
    fixApplied: false,
    ticketStatus: 'kept-open',
    ticketStatusNote: 'C-47 归因成立仅立修复票，不销票；修复实施属独立票，需用户显式发令。',
    evidenceLevel: 'source-anchored deterministic state machine（GUI 实机证据见 acceptance/block477-filetree-attribution/ 若在场）',
    nextStep: reproduced
      ? '立 C-47 修复票（轮询不重置已加载分页 / 或只增量对账），用户发令后实施；GUI 实机腿佐证。'
      : '保持 kept-open，补 GUI 实机腿再判，不猜测性修复。',
    honestBoundary: '状态机为源码语义抽象，非 GUI 真值；triState 不表述为「已修复」。',
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const c = buildConclusion(root);
  console.log(`[block477] triState=${c.triState} rootCause=${c.rootCauseAttributed} fix=${c.fixApplied}`);
  console.log(`[block477] anchors=${JSON.stringify(c.sourceAnchors)}`);
  console.log(`[block477] replay rebound=${c.replay.reboundObserved} inert=${c.replay.inertObserved}`);
}

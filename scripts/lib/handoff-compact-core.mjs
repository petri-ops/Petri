/**
 * scripts/lib/handoff-compact-core.mjs — BLOCK-470 / T2 纯函数核心。
 *
 * handoff 头部「最后更新」链是**多行链区**：前几行各一条，末行是 ｜ 拼接巨行
 * （实测 lines[0..5]，第 5 行 9025 字符含 ~25 条，共 30 条）。不能只处理首行，
 * 也不套用 AUDIT-LOG 的按行切链 compactLedgerLines。本模块：
 *   splitHandoffChain       把单行按 ｜ 拆条目
 *   collectChainRegion      扫描头部连续链行区，合并为条目数组（最新在前）
 *   compactHandoffLines     保留最近 keep 条、其余原文搬移、锚点不动、幂等
 * 铁律=搬移不改写、fail-closed（无链条目拒绝处理）。
 */

/** 判定一行是否属于头部链（以「最后更新：」开头，或含「最后更新：」的拼接行）。 */
export function isChainLine(line = '') {
  const t = String(line).trim();
  return t.startsWith('最后更新：') || t.includes('最后更新：');
}

/** 把单行按全角 ｜ 拆条目（含无前缀裸条目），去空白。 */
export function splitHandoffChain(line = '') {
  return String(line).split('｜').map((s) => s.trim()).filter(Boolean);
}

/**
 * 扫描 lines 开头连续链行区，返回 { chainLines, rest, allParts }。
 * 链区 = 开头连续的 isChainLine 行；遇到空行/`---`/正文即停。
 */
export function collectChainRegion(lines = []) {
  const arr = Array.isArray(lines) ? [...lines] : [];
  const chainLines = [];
  let i = 0;
  for (const line of arr) {
    if (!isChainLine(line)) break;
    chainLines.push(line);
    i += 1;
  }
  const allParts = chainLines.flatMap(splitHandoffChain);
  return { chainLines, rest: arr.slice(i), allParts };
}

/**
 * 收敛 handoff 头部链区。返回 { ok, reason?, outLines, keptChain, cutLines, throughDate, changed }。
 * keep 条保留（每条一行，最新在前），其余原文搬移；空行/`---`/正文原样。
 */
export function compactHandoffLines(lines = [], { keep = 1 } = {}) {
  const { chainLines, rest, allParts } = collectChainRegion(lines);
  if (!chainLines.length || !allParts.length) {
    return { ok: false, reason: 'no-chain-region（头部无「最后更新」链区，拒绝处理——fail-closed）', outLines: [...lines], keptChain: [], cutLines: [], throughDate: null, changed: false };
  }
  const k = Math.max(1, keep);
  const keptChain = allParts.slice(0, k);
  const cutLines = allParts.slice(k);
  if (!cutLines.length) {
    return { ok: true, outLines: [...lines], keptChain, cutLines: [], throughDate: null, changed: false };
  }
  const dates = cutLines.flatMap((l) => l.match(/\d{4}-\d{2}-\d{2}/g) || []).sort();
  const throughDate = dates.at(-1) || null;
  const outLines = [...keptChain, ...rest];
  return { ok: true, outLines, keptChain, cutLines, throughDate, changed: true };
}

// ============================================================
// markdownDiff — BLOCK-18 markdown 前后差异算法
//
// 三种 diff：
//   - computeSimpleDiff：BLOCK-17 傻瓜并排（保留为 fallback / 回归对照）
//   - computeLcsDiff : LCS 双列并排（git-style 折叠）
//   - computeUnifiedDiff : LCS 单列 unified（git diff 默认风格，带 @@ hunk 头）
//
// 渲染端按 `classifyDiffLine` 上色，无需感知算法来源。
// ============================================================

export interface DiffSide {
  left: string[];
  right: string[];
}

export type DiffLineKind = 'add' | 'del' | 'ctx' | 'fold' | 'hunk';

// ---------- 旧版 BLOCK-17 傻瓜并排 ----------

export function computeSimpleDiff(left: string, right: string): DiffSide {
  const leftLines = left.split('\n');
  const rightLines = right.split('\n');
  const minLen = Math.min(leftLines.length, rightLines.length);
  const result: DiffSide = { left: [], right: [] };
  for (let i = 0; i < minLen; i++) {
    if (leftLines[i] === rightLines[i]) {
      result.left.push(` ${leftLines[i]}`);
      result.right.push(` ${rightLines[i]}`);
    } else {
      result.left.push(`-${leftLines[i]}`);
      result.right.push(`+${rightLines[i]}`);
    }
  }
  for (let i = minLen; i < leftLines.length; i++) {
    result.left.push(`-${leftLines[i]}`);
    result.right.push('  ');
  }
  for (let i = minLen; i < rightLines.length; i++) {
    result.left.push('  ');
    result.right.push(`+${rightLines[i]}`);
  }
  return result;
}

// ---------- LCS 共享底层 ----------

type Op = { kind: 'eq' | 'del' | 'add'; line: string };

export function buildOps(leftLines: string[], rightLines: string[]): Op[] {
  const m = leftLines.length;
  const n = rightLines.length;
  // dp 使用 number[]（避免 Uint32Array 在 V8 里的特殊处理）
  const dp: number[][] = [];
  for (let i = 0; i <= m; i++) {
    dp.push(new Array<number>(n + 1).fill(0));
  }
  for (let i = 1; i <= m; i++) {
    const li = leftLines[i - 1];
    for (let j = 1; j <= n; j++) {
      if (li === rightLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = dp[i - 1][j] >= dp[i][j - 1] ? dp[i - 1][j] : dp[i][j - 1];
      }
    }
  }
  const ops: Op[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (leftLines[i - 1] === rightLines[j - 1]) {
      ops.push({ kind: 'eq', line: leftLines[i - 1] });
      i--; j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      ops.push({ kind: 'del', line: leftLines[i - 1] });
      i--;
    } else {
      ops.push({ kind: 'add', line: rightLines[j - 1] });
      j--;
    }
  }
  while (i > 0) { ops.push({ kind: 'del', line: leftLines[i - 1] }); i--; }
  while (j > 0) { ops.push({ kind: 'add', line: rightLines[j - 1] }); j--; }
  ops.reverse();
  return ops;
}

// ---------- computeLcsDiff 双列 ----------

export function computeLcsDiff(left: string, right: string, context = 3): DiffSide {
  const leftLines = left.split('\n');
  const rightLines = right.split('\n');
  const ops = buildOps(leftLines, rightLines);
  const sides: DiffSide = { left: [], right: [] };
  let k = 0;
  while (k < ops.length) {
    const op = ops[k];
    if (op.kind === 'eq') {
      let runEnd = k;
      while (runEnd + 1 < ops.length && ops[runEnd + 1].kind === 'eq') runEnd++;
      const runLen = runEnd - k + 1;
      let nearBefore = false;
      let nearAfter = false;
      for (let d = 1; d <= context; d++) {
        if (k - d >= 0 && ops[k - d].kind !== 'eq') { nearBefore = true; break; }
      }
      for (let d = 1; d <= context; d++) {
        if (runEnd + d < ops.length && ops[runEnd + d].kind !== 'eq') { nearAfter = true; break; }
      }
      const anyNear = nearBefore || nearAfter;
      if (!anyNear || runLen <= context * 2) {
        for (let q = k; q <= runEnd; q++) {
          sides.left.push(` ${ops[q].line}`);
          sides.right.push(` ${ops[q].line}`);
        }
      } else {
        const head = context;
        const tail = context;
        const foldCount = runLen - head - tail;
        for (let q = 0; q < head; q++) {
          sides.left.push(` ${ops[k + q].line}`);
          sides.right.push(` ${ops[k + q].line}`);
        }
        sides.left.push(`… ${foldCount} unchanged line${foldCount === 1 ? '' : 's'}`);
        sides.right.push(`… ${foldCount} unchanged line${foldCount === 1 ? '' : 's'}`);
        for (let q = 0; q < tail; q++) {
          sides.left.push(` ${ops[runEnd - tail + 1 + q].line}`);
          sides.right.push(` ${ops[runEnd - tail + 1 + q].line}`);
        }
      }
      k = runEnd + 1;
    } else if (op.kind === 'del') {
      let runEnd = k;
      while (runEnd + 1 < ops.length && ops[runEnd + 1].kind === 'del') runEnd++;
      for (let q = k; q <= runEnd; q++) {
        sides.left.push(`-${ops[q].line}`);
        sides.right.push('  ');
      }
      k = runEnd + 1;
    } else {
      let runEnd = k;
      while (runEnd + 1 < ops.length && ops[runEnd + 1].kind === 'add') runEnd++;
      for (let q = k; q <= runEnd; q++) {
        sides.left.push('  ');
        sides.right.push(`+${ops[q].line}`);
      }
      k = runEnd + 1;
    }
  }
  return sides;
}

// ---------- computeUnifiedDiff 单列 (BLOCK-18 用户要的 unified) ----------

function appendFoldedEqRun(
  out: string[],
  lines: string[],
  context: number,
) {
  if (lines.length === 0) return;
  if (lines.length <= context * 2) {
    for (const l of lines) out.push(` ${l}`);
    return;
  }
  const head = context;
  const tail = context;
  const foldCount = lines.length - head - tail;
  for (let i = 0; i < head; i++) out.push(` ${lines[i]}`);
  out.push(`… ${foldCount} unchanged line${foldCount === 1 ? '' : 's'}`);
  for (let i = lines.length - tail; i < lines.length; i++) out.push(` ${lines[i]}`);
}

/**
 * 找出 ops 中所有 hunk（[0..n-1] 区间）的 [start, end) 半开区间。
 * 每个 hunk 包含：前 context 行 eq + 连续 del/add + 后 context 行 eq。
 */
function computeHunkRanges(ops: Op[], context: number): Array<[number, number]> {
  const hunks: Array<[number, number]> = [];
  // 第一遍：标记每个 eq 是否被 hunk 内的 ctx 保留（即是否在某个改动的前后 context 行内）
  const kept = new Array<boolean>(ops.length).fill(false);
  for (let i = 0; i < ops.length; i++) {
    if (ops[i].kind !== 'eq') continue;
    // 看 i 前后 context 行内是否有非 eq
    let nearChange = false;
    for (let d = 1; d <= context; d++) {
      if (i - d >= 0 && ops[i - d].kind !== 'eq') { nearChange = true; break; }
      if (i + d < ops.length && ops[i + d].kind !== 'eq') { nearChange = true; break; }
    }
    if (nearChange) kept[i] = true;
  }
  // 第二遍：找出所有 hunks（被 kept 的 eq 也属于某个 hunk）
  let k = 0;
  while (k < ops.length) {
    // 跳过"游离" eq（即前后都没改动的 eq）
    while (k < ops.length && ops[k].kind === 'eq' && !kept[k]) k++;
    if (k >= ops.length) break;
    const start = k;
    // 找连续 hunk 区域：所有非游离 ops（被 kept 的 eq + 所有非 eq）
    while (k < ops.length && (ops[k].kind !== 'eq' || kept[k])) k++;
    const end = k;
    hunks.push([start, end]);
  }
  // 合并相邻 hunk
  const merged: Array<[number, number]> = [];
  for (const h of hunks) {
    const last = merged[merged.length - 1];
    if (last && last[1] >= h[0]) {
      last[1] = Math.max(last[1], h[1]);
    } else {
      merged.push([h[0], h[1]]);
    }
  }
  return merged;
}

function hunkHeaderCounts(
  ops: Op[],
  start: number,
  end: number,
): { leftStart: number; rightStart: number; leftCount: number; rightCount: number } {
  let leftStart = 1;
  let rightStart = 1;
  for (let i = 0; i < start; i++) {
    const o = ops[i];
    if (o.kind === 'eq') { leftStart++; rightStart++; }
    else if (o.kind === 'del') leftStart++;
    else rightStart++;
  }
  let leftCount = 0;
  let rightCount = 0;
  for (let i = start; i < end; i++) {
    const o = ops[i];
    if (o.kind === 'eq') { leftCount++; rightCount++; }
    else if (o.kind === 'del') leftCount++;
    else rightCount++;
  }
  return { leftStart, rightStart, leftCount, rightCount };
}

export function computeUnifiedDiff(left: string, right: string, context = 3): string[] {
  const leftLines = left.split('\n');
  const rightLines = right.split('\n');
  const ops = buildOps(leftLines, rightLines);
  const hunks = computeHunkRanges(ops, context);
  const out: string[] = [];
  for (const [start, end] of hunks) {
    const c = hunkHeaderCounts(ops, start, end);
    if (c.leftCount === 0 && c.rightCount === 0) continue;
    out.push(`@@ -${c.leftStart},${c.leftCount} +${c.rightStart},${c.rightCount} @@`);
    let i = start;
    while (i < end) {
      const o = ops[i];
      if (o.kind === 'eq') {
        let runEnd = i;
        while (runEnd < end && ops[runEnd].kind === 'eq') runEnd++;
        const ctxLines: string[] = [];
        for (let q = i; q < runEnd; q++) ctxLines.push(ops[q].line);
        appendFoldedEqRun(out, ctxLines, context);
        i = runEnd;
      } else if (o.kind === 'del') {
        out.push(`-${o.line}`);
        i++;
      } else {
        out.push(`+${o.line}`);
        i++;
      }
    }
  }
  return out;
}

// ---------- classifyDiffLine ----------

export function classifyDiffLine(line: string): DiffLineKind {
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  if (line.startsWith('…')) return 'fold';
  if (line.startsWith('@@')) return 'hunk';
  return 'ctx';
}

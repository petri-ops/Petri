'use strict';

// BLOCK-92 Wave D1 — 自 src/ipc/working-tree-review.js 纯搬运（零行为变化）：
// unified diff 基线选择 + 解析（含硬上限截断/尾部换行伪影防御）+ reject 反向 patch 构造。

const MAX_HUNK_LINES_HARD_CAP = 5000;

/**
 * BLOCK-25 acceptance fix: WTR's baseline is "working tree vs git HEAD"
 * (BLOCK-20 spec), so the default diff must include staged-only changes.
 * A plain `git diff` shows unstaged changes only, which left files with
 * staged-only edits rendering an empty diff panel. Explicit staged
 * requests keep using --cached.
 */
function diffForReview(adapter, paths, stagedOnly) {
  if (stagedOnly) {
    return adapter.diff({ paths, staged: true });
  }
  return adapter.diff({ paths, fromRef: 'HEAD' });
}

/**
 * 把 unified diff text 解析为 file→hunks 树。若含 `Binary files ... differ` 行则整文件标 binary。
 * @param {string} diffText
 * @returns {{ files: Array<{ path: string, oldPath: string|null, hunks: any[], binary: boolean }>, truncated: boolean, summary: { added: number, removed: number } }}
 */
function parseDiffFiles(diffText) {
  if (!diffText || typeof diffText !== 'string') {
    return { files: [], truncated: false, summary: { added: 0, removed: 0 } };
  }
  const lines = diffText.split('\n');
  const files = [];
  let current = null;
  let added = 0;
  let removed = 0;
  let truncated = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith('diff --git ')) {
      if (current) files.push(current);
      const m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      current = m ? { path: m[2], oldPath: m[1] !== m[2] ? m[1] : null, hunks: [], binary: false } : { path: 'unknown', oldPath: null, hunks: [], binary: false };
      continue;
    }
    if (!current) continue;
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      current.binary = true;
      current.hunks = [];
      continue;
    }
    if (line.startsWith('@@')) {
      const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) {
        current.hunks.push({ oldStart: Number(m[1]), newStart: Number(m[2]), lines: [] });
      } else {
        current.hunks.push({ oldStart: 0, newStart: 0, lines: [] });
      }
      continue;
    }
    if (current.hunks.length > 0) {
      const hunk = current.hunks[current.hunks.length - 1];
      // 尾部换行切分伪影：split('\n') 在 diff 末尾产生零长度行。真空的 ctx 行在
      // raw diff 里是单个空格（' '），零长度行只会是伪影 —— 若当作 ctx 吸进 hunk
      // 会让行数虚增 1，导致 buildReversePatchForReject 产出的反向 patch 被
      // git apply 以 "patch does not apply" 拒绝（hunk 位于文件末尾时必现）。
      if (line === '') continue;
      if (line.startsWith('+') && !line.startsWith('+++')) {
        hunk.lines.push({ type: 'add', text: line.slice(1) });
        added += 1;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        hunk.lines.push({ type: 'del', text: line.slice(1) });
        removed += 1;
      } else if (line.startsWith('\\')) {
        // "\ No newline at end of file" — 跳过
      } else {
        hunk.lines.push({ type: 'ctx', text: line.startsWith(' ') ? line.slice(1) : line });
      }
      // 整文件总行数超过硬上限则截断
      const totalLines = current.hunks.reduce((sum, h) => sum + h.lines.length, 0);
      if (totalLines >= MAX_HUNK_LINES_HARD_CAP) {
        truncated = true;
        current.hunks = current.hunks.map((h) => {
          if (h.lines.length >= MAX_HUNK_LINES_HARD_CAP) {
            return { ...h, lines: h.lines.slice(0, MAX_HUNK_LINES_HARD_CAP), truncated: true };
          }
          return h;
        });
      }
    }
  }
  if (current) files.push(current);
  return { files, truncated, summary: { added, removed } };
}

/**
 * 反向 patch：把 hunk 的 add 行变 "-" 行、ctx 行保留。
 * 供 reject 路径使用 —— 把 hunk 写入 patch 后用 git apply --reverse 等价语义。
 * BLOCK-16 v1 thin-slice：直接走 git apply --reverse，需要 reject hunk 是 patch 的子段。
 * 实现策略：前端 reject 时已持有 hunk 的 oldText / newText，由前端构造反向 patch 传入；
 * 主进程直接 git apply 调用，不再二次解析。
 */
function buildReversePatchForReject({ file, hunk }) {
  if (!hunk || !Array.isArray(hunk.lines)) return null;
  // 反向 patch 的 pre-image 是「当前已修改文件」（hunk 的 new 侧）：
  //   - 行 = add 行（当前文件持有、将被移除），pre-image 行数 = ctx + add = filter(type !== 'del')
  //   + 行 = del 行（还原回旧文件），post-image 行数 = ctx + del = filter(type !== 'add')
  // 起始行同理：pre-image 用 hunk.newStart，post-image 用 hunk.oldStart。
  // （BLOCK-43 P3 实机复核修复：原实现 start 与 count 均按正向 patch 取值，git apply 校验 pre-image 行数不符必拒。）
  const oldStart = hunk.newStart || 0;
  const newStart = hunk.oldStart || 0;
  const oldCount = hunk.lines.filter((l) => l.type !== 'del').length;
  const newCount = hunk.lines.filter((l) => l.type !== 'add').length;
  const header = `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n`;
  // unified diff 规范：一个连续变更块内必须先全部 `-` 行再全部 `+` 行。
  // 原始 diff 的块内顺序是 [del, add]，逐行反转会得到交错序列，git apply 拒绝。
  // 因此按连续非 ctx 块分组：先输出反转后的删除行（原 add → `-`），再输出插入行（原 del → `+`）。
  let body = '';
  let run = [];
  const flushRun = () => {
    if (!run.length) return;
    for (const l of run) if (l.type === 'add') body += `-${l.text}\n`;
    for (const l of run) if (l.type === 'del') body += `+${l.text}\n`;
    run = [];
  };
  for (const line of hunk.lines) {
    if (line.type === 'ctx') {
      flushRun();
      body += ` ${line.text}\n`;
    } else {
      run.push(line);
    }
  }
  flushRun();
  return header + body;
}

module.exports = { diffForReview, parseDiffFiles, buildReversePatchForReject };

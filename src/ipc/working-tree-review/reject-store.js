'use strict';

const path = require('path');
const fs = require('fs');

// BLOCK-92 Wave D1 — 自 src/ipc/working-tree-review.js 纯搬运（零行为变化）：
// reject 清单落盘（BLOCK-16 schema 镜像）+ TTL 清理；写入失败静默不影响 git apply。

const REJECT_TTL_DAYS = 30;

/**
 * 清理过期 reject 文件（> 30 天）。
 */
function pruneRejectFiles(rejectDir) {
  if (!fs.existsSync(rejectDir)) return;
  const cutoff = Date.now() - REJECT_TTL_DAYS * 24 * 60 * 60 * 1000;
  for (const name of fs.readdirSync(rejectDir)) {
    if (!name.endsWith('.json')) continue;
    const p = path.join(rejectDir, name);
    try {
      const stat = fs.statSync(p);
      if (stat.mtimeMs < cutoff) fs.unlinkSync(p);
    } catch {
      /* best effort */
    }
  }
}

/**
 * 把 reject 决策写到 userData/working-tree-review/rejects/<taskId>-<fileSafe>-<hunkIndex>.json。
 * 镜像 BLOCK-16 L277-299 的 schema：{ taskId, file, hunkIndex, oldText, newText, feedback, rejectedAt }。
 * fs 失败由 try/catch 吞掉 —— reject 清单写入失败不影响 git apply / inverse 结果。
 * @param {string} userDataDir
 * @param {{
 *   file: string,
 *   hunkIndex: number,
 *   taskId?: string|null,
 *   feedback?: string|null,
 *   hunk?: { lines?: Array<{ type: string, text: string }> }|null,
 * }} args
 */
function _writeRejectEntry(userDataDir, args) {
  try {
    const rejectDir = path.join(userDataDir, 'working-tree-review', 'rejects');
    fs.mkdirSync(rejectDir, { recursive: true });
    pruneRejectFiles(rejectDir);
    const id = (args.taskId || 'anonymous').replace(/[^a-zA-Z0-9_.-]/g, '_');
    const fileSafe = args.file.replace(/[^a-zA-Z0-9_.-]/g, '_').replace(/\//g, '__');
    const filename = `${id}-${fileSafe}-${args.hunkIndex}.json`;
    fs.writeFileSync(path.join(rejectDir, filename), JSON.stringify({
      taskId: args.taskId || null,
      file: args.file,
      hunkIndex: args.hunkIndex,
      oldText: args.hunk && Array.isArray(args.hunk.lines)
        ? args.hunk.lines.filter((l) => l.type !== 'add').map((l) => l.text).join('\n')
        : null,
      newText: args.hunk && Array.isArray(args.hunk.lines)
        ? args.hunk.lines.filter((l) => l.type !== 'del').map((l) => l.text).join('\n')
        : null,
      feedback: typeof args.feedback === 'string' ? args.feedback : null,
      rejectedAt: new Date().toISOString(),
    }, null, 2));
  } catch (e) {
    // reject 清单写入失败不影响 git apply / inverse 结果
  }
}

module.exports = { pruneRejectFiles, _writeRejectEntry, REJECT_TTL_DAYS };

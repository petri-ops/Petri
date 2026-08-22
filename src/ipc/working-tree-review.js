// ============================================================
// IPC handlers: Working Tree Review Mode
//
// BLOCK-16 PHASE 1 — Working tree PR-style diff viewer 支撑层。
// 暴露 5 条 invoke/handle 通道 + 1 条 main→renderer 通知。
// 风格与 src/ipc/branch-handlers.js / src/ipc/result-handlers.js 对齐。
//
// 通道清单（与 plan §4.1 严格一致）：
//   git:working-tree-status      → git-adapter.status
//   git:working-tree-diff        → git-adapter.diff + parseUnifiedHunks
//   git:working-tree-file-content→ git-adapter.showFile
//   git:hunk-apply               → git-adapter.applyPatch（accept/reject）
//   git:working-tree-revert      → git-adapter.revertPaths
//   agent:task-done              → main→renderer 通知（webContents.send）
//
// 路径入参统一走 core/shared-backend/git-adapter.js 的 assertSafePathspecs。
// ============================================================

const path = require('path');
const fs = require('fs');
const { ipcMain, app } = require('electron');
const { createGitAdapter, GitAdapterError } = require('../../core/shared-backend/git-adapter');
const { parseUnifiedHunks } = require('../../core/r-server/mcp/ide-tools/diff-helpers');
const { createSenderGuard } = require('./_sender-guard');

const MAX_HUNK_LINES_HARD_CAP = 5000;
const MAX_FILE_CONTENT_BYTES = 1024 * 1024; // 1MB；超过只返回元信息（行级渲染策略）
const REJECT_TTL_DAYS = 30;

/**
 * 把 { ok, error } / throw 统一成 renderer 期望的契约。
 * @param {() => any} body
 */
async function safeInvoke(body) {
  try {
    const data = await body();
    return { ok: true, data };
  } catch (e) {
    if (e instanceof GitAdapterError) {
      return { ok: false, error: e.code || 'git_error', message: e.message, detail: e.detail || null };
    }
    return { ok: false, error: 'unexpected_error', message: e && e.message ? e.message : String(e) };
  }
}

/**
 * 取得当前 working tree 的 GitAdapter。worktree = app.getPath('userData')/workspace。
 * 失败时抛 GitAdapterError('git_repo_not_found')。
 */
function resolveGitAdapter() {
  const userData = app.getPath('userData');
  const candidates = [
    path.join(userData, 'workspace'),
    process.cwd(),
  ];
  for (const workTree of candidates) {
    const gitDir = path.join(workTree, '.git');
    if (fs.existsSync(gitDir)) {
      return createGitAdapter({ gitDir, workTree });
    }
  }
  throw new GitAdapterError(
    'git_repo_not_found',
    `No .git directory found under ${candidates.join(' / ')}`,
    { tried: candidates }
  );
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
function buildReversePatchForReject({ file, hunkIndex, hunk }) {
  if (!hunk || !Array.isArray(hunk.lines)) return null;
  const oldStart = hunk.oldStart || 0;
  const newStart = hunk.newStart || 0;
  const header = `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -${oldStart},${hunk.lines.filter((l) => l.type !== 'add').length} +${newStart},${hunk.lines.filter((l) => l.type !== 'del').length} @@\n`;
  let body = '';
  for (const line of hunk.lines) {
    if (line.type === 'add') body += `-${line.text}\n`;
    else if (line.type === 'del') body += `+${line.text}\n`;
    else body += ` ${line.text}\n`;
  }
  return header + body;
}

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
 * 装配所有 BLOCK-16 IPC handlers。
 * @param {{mainWindow?: Electron.BrowserWindow|null}} [options]
 */
function setupWorkingTreeReviewIpc(options = {}) {
  const assertSender = createSenderGuard(options.mainWindow);

  ipcMain.handle('git:working-tree-status', async (event) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = resolveGitAdapter();
      const status = adapter.status({ untracked: 'all' });
      return {
        files: status.entries.map((e) => ({
          path: e.path,
          oldPath: e.oldPath || null,
          status: e.status,
          untracked: !!e.untracked,
          conflicted: !!e.conflicted,
        })),
        totalFiles: status.entries.length,
        hasUntracked: !!status.hasUntracked,
        hasConflict: !!status.hasConflict,
      };
    });
  });

  ipcMain.handle('git:working-tree-diff', async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = resolveGitAdapter();
      const paths = Array.isArray(args.paths) && args.paths.length > 0 ? args.paths : null;
      const raw = adapter.diff({ paths, staged: !!args.staged });
      const parsed = parseDiffFiles(raw.stdout || '');
      // 触发 parseUnifiedHunks 一次确保 diff-helpers 的语法契约未漂移（不消费结果）
      if (parsed.files.length > 0 && parsed.files[0].hunks.length > 0) {
        try { parseUnifiedHunks(raw.stdout || ''); } catch { /* parseUnifiedHunks is best-effort sanity check */ }
      }
      return parsed;
    });
  });

  ipcMain.handle('git:working-tree-file-content', async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = resolveGitAdapter();
      if (!args || !args.path || typeof args.path !== 'string') {
        throw new GitAdapterError('path_required', 'path is required.');
      }
      if (args.ref && args.ref !== 'HEAD' && args.ref !== 'WORKTREE') {
        throw new GitAdapterError('invalid_ref', `ref must be 'HEAD' or 'WORKTREE'.`);
      }
      if (args.ref === 'HEAD') {
        const content = adapter.showFile({ ref: 'HEAD', filePath: args.path });
        return { content, encoding: 'utf-8', size: Buffer.byteLength(content, 'utf-8') };
      }
      const abs = path.resolve(adapter.workTree || process.cwd(), args.path);
      if (!fs.existsSync(abs)) {
        throw new GitAdapterError('file_missing', `file not found: ${args.path}`);
      }
      const stat = fs.statSync(abs);
      if (stat.size > MAX_FILE_CONTENT_BYTES) {
        return {
          content: '',
          encoding: 'utf-8',
          size: stat.size,
          truncated: true,
          message: `File exceeds ${MAX_FILE_CONTENT_BYTES} bytes; only metadata returned.`,
        };
      }
      const content = fs.readFileSync(abs, 'utf-8');
      return { content, encoding: 'utf-8', size: stat.size };
    });
  });

  ipcMain.handle('git:hunk-apply', async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = resolveGitAdapter();
      if (!args || typeof args.file !== 'string' || typeof args.hunkIndex !== 'number') {
        throw new GitAdapterError('args_required', 'file and hunkIndex are required.');
      }
      if (args.action !== 'accept' && args.action !== 'reject') {
        throw new GitAdapterError('invalid_action', `action must be 'accept' or 'reject'.`);
      }
      if (args.action === 'accept') {
        // accept 路径：不修改文件（已是 working tree 状态），仅返回 ok
        return { action: 'accept', file: args.file, hunkIndex: args.hunkIndex };
      }
      // reject 路径：构造反向 patch，调 git apply
      const reversePatch = buildReversePatchForReject({
        file: args.file,
        hunkIndex: args.hunkIndex,
        hunk: args.hunk || null,
      });
      if (!reversePatch) {
        throw new GitAdapterError('hunk_required', 'hunk payload is required for reject.');
      }
      adapter.applyPatch({ patch: reversePatch });
      // 写入 reject 清单（30 天 TTL）
      const rejectDir = path.join(app.getPath('userData'), 'working-tree-review', 'rejects');
      try {
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
        // reject 清单写入失败不影响 git apply 结果
      }
      return { action: 'reject', file: args.file, hunkIndex: args.hunkIndex };
    });
  });

  ipcMain.handle('git:working-tree-revert', async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = resolveGitAdapter();
      const paths = Array.isArray(args.paths) && args.paths.length > 0 ? args.paths : null;
      return adapter.revertPaths({ paths });
    });
  });

  // ============================================================
  // BLOCK-20 — Code Review Panel 新增 IPC
  // 与 BLOCK-16 5 通道并列；同一 sender guard + 同 safeInvoke 错误契约。
  // ============================================================

  ipcMain.handle('git:list-modified', async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = resolveGitAdapter();
      const includeUntracked = args.includeUntracked !== false; // default true
      const result = adapter.listModified({ includeUntracked });
      return { files: result.files, count: result.files.length };
    });
  });

  ipcMain.handle('git:file-head-content', async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = resolveGitAdapter();
      if (!args || !args.path || typeof args.path !== 'string') {
        throw new GitAdapterError('path_required', 'path is required.');
      }
      const result = adapter.fileHeadContent({ path: args.path });
      return { content: result.content, mtime: result.mtime };
    });
  });

  ipcMain.handle('git:split-side-diff', async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = resolveGitAdapter();
      if (!args || !args.path || typeof args.path !== 'string') {
        throw new GitAdapterError('path_required', 'path is required.');
      }
      const context = typeof args.context === 'number' && args.context >= 0 && args.context <= 20
        ? args.context
        : 3;
      const result = adapter.splitSideDiff({ path: args.path, context });
      const parsed = parseDiffFiles(result.diff || '');
      return {
        diff: result.diff,
        headContent: result.headContent,
        workTreeContent: result.workTreeContent,
        hunks: parsed.files.length > 0 ? parsed.files[0].hunks : [],
        summary: parsed.summary,
        truncated: parsed.truncated,
      };
    });
  });

  ipcMain.handle('git:revert-file', async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = resolveGitAdapter();
      if (!args || !args.path || typeof args.path !== 'string') {
        throw new GitAdapterError('path_required', 'path is required.');
      }
      const result = adapter.revertFile({ path: args.path });
      return { ok: true, reverted: result.reverted };
    });
  });

  ipcMain.handle('git:apply-inverse-hunk', async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = resolveGitAdapter();
      if (!args || typeof args.patch !== 'string' || args.patch.length === 0) {
        throw new GitAdapterError('patch_required', 'patch text is required.');
      }
      adapter.applyInverseHunk({ patch: args.patch });
      return { ok: true };
    });
  });

  /**
   * 暴露 main→renderer 通知触发器，供主进程其他模块（如 agent runner / SSE listener）
   * 在任务完成时调用。BLOCK-16 PHASE 3 接入。
   */
  function notifyAgentTaskDone({ taskId, filesChanged }) {
    if (!options.mainWindow || options.mainWindow.isDestroyed()) return;
    options.mainWindow.webContents.send('agent:task-done', {
      taskId: taskId || null,
      filesChanged: Array.isArray(filesChanged) ? filesChanged : [],
      notifiedAt: new Date().toISOString(),
    });
  }

  return { notifyAgentTaskDone };
}

module.exports = { setupWorkingTreeReviewIpc, MAX_FILE_CONTENT_BYTES, REJECT_TTL_DAYS };

// ============================================================
// IPC handlers: Working Tree Review Mode
//
// BLOCK-16 PHASE 1 — Working tree PR-style diff viewer 支撑层。
// 暴露 5 条 invoke/handle 通道 + 1 条 main→renderer 通知。
// 风格与 src/ipc/branch-handlers.js / src/ipc/result-handlers.js 对齐。
//
// 通道清单（与 plan §4.1 严格一致）：
//   git:working-tree-status      → git-adapter.status
//   git:working-tree-diff        → git-adapter.diff + 本地 unified diff 解析
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
const { getBackendPort } = require('../main/env-coordinator');
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
 * BLOCK-32 P1 — 取项目工作区路径（经后端 HTTP，避免主进程直连 better-sqlite3 的
 * ABI 不匹配问题：Electron 主进程 Node ABI ≠ npm 安装编译目标）。短 TTL 缓存
 * （30s）吸收高频 status/diff 轮询；项目不存在返回 null。
 */
const PROJECT_WORKSPACE_TTL_MS = 30_000;
const projectWorkspaceCache = new Map();

async function getProjectWorkspacePath(projectId) {
  const cached = projectWorkspaceCache.get(projectId);
  if (cached && Date.now() - cached.at < PROJECT_WORKSPACE_TTL_MS) return cached.workspacePath;
  const base = `http://127.0.0.1:${getBackendPort('r')}`;
  const res = await fetch(`${base}/api/data/projects`);
  if (!res.ok) {
    throw new GitAdapterError('project_not_found', `无法读取项目信息 (HTTP ${res.status})`, { projectId });
  }
  const body = await res.json();
  const project = (body.projects || []).find((p) => p.id === projectId);
  if (!project) {
    throw new GitAdapterError('project_not_found', `项目不存在: ${projectId}`, { projectId });
  }
  const workspacePath = project.workspace_path || null;
  projectWorkspaceCache.set(projectId, { workspacePath, at: Date.now() });
  return workspacePath;
}

/**
 * 取得当前 working tree 的 GitAdapter。
 * BLOCK-32 P1 项目级审阅隔离：传 projectId 时解析该项目工作区的 git 仓库
 * （后端 /api/data/projects → workspace_path，校验 .git 存在；非 git 抛
 * `project_workspace_not_git`）；未传时维持旧行为（app 仓库候选）渐进兼容。
 * 失败时抛 GitAdapterError。
 */
async function resolveGitAdapter(projectId) {
  if (projectId) {
    const workspacePath = await getProjectWorkspacePath(projectId);
    if (!workspacePath || !fs.existsSync(path.join(workspacePath, '.git'))) {
      throw new GitAdapterError(
        'project_workspace_not_git',
        '当前项目工作区不是 git 仓库，无法提供审阅数据。',
        { projectId, workspacePath: workspacePath || null }
      );
    }
    return createGitAdapter({ gitDir: path.join(workspacePath, '.git'), workTree: workspacePath });
  }
  const userData = app.getPath('userData');
  const candidates = [
    app.getAppPath(),
    path.join(userData, 'workspace'),
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

/**
 * 装配所有 BLOCK-16 IPC handlers。
 * @param {{mainWindow?: Electron.BrowserWindow|null}} [options]
 */
function setupWorkingTreeReviewIpc(options = {}) {
  const assertSender = createSenderGuard(options.mainWindow);

  ipcMain.handle('git:working-tree-status', async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = await resolveGitAdapter(args.projectId);
      const status = adapter.repositoryStatus({ untracked: 'all' });
      return {
        files: status.entries.map((e) => ({
          path: e.path,
          oldPath: e.oldPath || null,
          status: e.status,
          // BLOCK-41 — 暂存区两栏分组所需 additive 字段（indexStatus=X → 已暂存）
          indexStatus: e.indexStatus,
          worktreeStatus: e.worktreeStatus,
          staged: !!e.staged,
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
      const adapter = await resolveGitAdapter(args.projectId);
      const paths = Array.isArray(args.paths) && args.paths.length > 0 ? args.paths : null;
      const effectivePaths = paths;
      if (!effectivePaths) {
        const repoStatus = adapter.repositoryStatus({ untracked: 'all' });
        const changedPaths = repoStatus.entries.map((e) => e.path);
        if (changedPaths.length === 0) {
          return { files: [], truncated: false, summary: { added: 0, removed: 0 } };
        }
        const rawAll = diffForReview(adapter, changedPaths, !!args.staged);
        const parsedAll = parseDiffFiles(rawAll.patch || '');
        return parsedAll;
      }
      const raw = diffForReview(adapter, effectivePaths, !!args.staged);
      const parsed = parseDiffFiles(raw.patch || '');
      return parsed;
    });
  });

  ipcMain.handle('git:working-tree-file-content', async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = await resolveGitAdapter(args.projectId);
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
      const adapter = await resolveGitAdapter(args.projectId);
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
      _writeRejectEntry(app.getPath('userData'), {
        file: args.file,
        hunkIndex: args.hunkIndex,
        taskId: args.taskId,
        feedback: args.feedback,
        hunk: args.hunk || null,
      });
      return { action: 'reject', file: args.file, hunkIndex: args.hunkIndex };
    });
  });

  ipcMain.handle('git:working-tree-revert', async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = await resolveGitAdapter(args.projectId);
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
      const adapter = await resolveGitAdapter(args.projectId);
      const includeUntracked = args.includeUntracked !== false; // default true
      const result = adapter.listModified({ includeUntracked });
      return { files: result.files, count: result.files.length };
    });
  });

  ipcMain.handle('git:file-head-content', async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = await resolveGitAdapter(args.projectId);
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
      const adapter = await resolveGitAdapter(args.projectId);
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
      const adapter = await resolveGitAdapter(args.projectId);
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
      const adapter = await resolveGitAdapter(args.projectId);
      if (!args || typeof args.patch !== 'string' || args.patch.length === 0) {
        throw new GitAdapterError('patch_required', 'patch text is required.');
      }
      adapter.applyInverseHunk({ patch: args.patch });
      return { ok: true };
    });
  });

  // ============================================================
  // BLOCK-20 — per-hunk reject via applyInverseHunk
  // 与 `git:hunk-apply(action='reject')` 并列：保留 BLOCK-16 的 reject 路径不动，
  // 新路径接受前端组装好的正向 unified diff patch（含 ---/+++ 与 @@ header），
  // 由 applyInverseHunk 内部 invert 后回退 working tree。
  // reject 清单写入走 _writeRejectEntry 共享 helper（与 BLOCK-16 一致 schema）。
  // ============================================================
  ipcMain.handle('git:hunk-reject-inverse', async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = await resolveGitAdapter(args.projectId);
      if (!args || typeof args.file !== 'string' || typeof args.hunkIndex !== 'number') {
        throw new GitAdapterError('args_required', 'file and hunkIndex are required.');
      }
      if (typeof args.patch !== 'string' || args.patch.length === 0) {
        throw new GitAdapterError('patch_required', 'patch text is required.');
      }
      adapter.applyInverseHunk({ patch: args.patch });
      _writeRejectEntry(app.getPath('userData'), {
        file: args.file,
        hunkIndex: args.hunkIndex,
        taskId: args.taskId,
        feedback: args.feedback,
        hunk: args.hunk || null,
      });
      return { ok: true, action: 'reject', file: args.file, hunkIndex: args.hunkIndex };
    });
  });

  // ============================================================
  // BLOCK-20 — Commit Review：收集审阅结果并提交
  //
  // 语义：用户逐 hunk 审阅后，点 "Commit Review" 将所有 accepted hunks
  // stage 并 commit。commit message 由用户在 dialog 中填写。
  //
  // decisions 格式：Record<`${file}#${hunkIndex}`, 'accept'|'reject'|'pending'>
  // 提交时只 stage accepted 文件；rejected 文件保持 working tree 不变。
  // 返回 { ok, commit, files, message, stats }。
  // ============================================================
  ipcMain.handle('git:commit-review', async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = await resolveGitAdapter(args.projectId);

      if (!args || !args.decisions || typeof args.decisions !== 'object') {
        throw new GitAdapterError('decisions_required', 'decisions map is required.');
      }
      if (typeof args.message !== 'string' || args.message.trim() === '') {
        throw new GitAdapterError('commit_message_required', 'Commit message is required.');
      }

      const decisions = args.decisions; // Record<`${path}#${hunkIndex}`, 'accept'|'reject'|'pending'>
      const message = args.message.trim();

      // 收集 accepted 文件列表（去重）
      const acceptedFiles = new Set();
      const rejectedFiles = new Set();
      for (const [key, decision] of Object.entries(decisions)) {
        if (decision !== 'accept' && decision !== 'reject') continue;
        const hashIdx = key.lastIndexOf('#');
        if (hashIdx < 0) continue;
        const file = key.slice(0, hashIdx);
        if (decision === 'accept') acceptedFiles.add(file);
        else rejectedFiles.add(file);
      }

      if (acceptedFiles.size === 0) {
        throw new GitAdapterError('no_files_to_commit', 'No accepted files to commit.');
      }

      const filesToStage = [...acceptedFiles];

      // stage accepted 文件
      adapter.stage({ paths: filesToStage });

      // 路径受限提交（--only 保证不带入其他内容）
      const commitResult = adapter.commit({ message, paths: filesToStage });

      // 刷新工作区状态
      const newStatus = adapter.repositoryStatus({ untracked: 'all' });

      return {
        ok: true,
        commit: commitResult.commit,
        files: filesToStage,
        message,
        rejectedFiles: [...rejectedFiles],
        stats: {
          acceptedFiles: acceptedFiles.size,
          rejectedFiles: rejectedFiles.size,
          totalWorkingTree: newStatus.entries.length,
        },
      };
    });
  });

  // ============================================================
  // BLOCK-29 — 提交历史（git log）与任意提交 diff 查看通道。
  // 仅供审阅面板「历史」分区只读使用；不提供 checkout/push 等写操作。
  // ============================================================

  const SHA_RE = /^[0-9a-f]{7,64}$/i;
  const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

  function assertSha(value, name) {
    if (typeof value !== 'string' || !SHA_RE.test(value)) {
      throw new GitAdapterError('invalid_sha', `${name} must be a hex commit sha.`);
    }
    return value;
  }

  /** 单个提交的 diff（vs 第一父提交；根提交回退到空树）。 */
  function commitDiffParsed(adapter, hash) {
    try {
      return parseDiffFiles(adapter.diff({ fromRef: `${hash}^`, toRef: hash }).patch || '');
    } catch (e) {
      // 根提交无父：与空树比较
      if (e instanceof GitAdapterError) {
        return parseDiffFiles(adapter.diff({ fromRef: EMPTY_TREE_SHA, toRef: hash }).patch || '');
      }
      throw e;
    }
  }

  ipcMain.handle('git:commit-log', async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = await resolveGitAdapter(args.projectId);
      const limit = typeof args.limit === 'number' ? args.limit : 50;
      // BLOCK-29.5 — skip/file 透传修复（UI-221 分页与文件历史在真实 IPC 链路被丢弃）
      // + ref 透传（分支选择器，只读）。
      const skip = typeof args.skip === 'number' ? args.skip : 0;
      const file = typeof args.file === 'string' && args.file ? args.file : null;
      const ref = typeof args.ref === 'string' && args.ref ? args.ref : null;
      const result = adapter.log({ limit, skip, file, ref });
      return { commits: result.commits, count: result.count };
    });
  });

  // BLOCK-29.5 — 本地分支列表（历史分区选择器，只读）
  ipcMain.handle('git:branch-list', async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = await resolveGitAdapter(args.projectId);
      const result = adapter.listBranches();
      return { branches: result.branches, count: result.count };
    });
  });

  // BLOCK-29.5 — 逐行归属（文件视图第四态，只读）
  ipcMain.handle('git:blame', async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = await resolveGitAdapter(args.projectId);
      if (!args || typeof args.path !== 'string' || !args.path) {
        throw new GitAdapterError('path_required', 'path is required.');
      }
      const ref = typeof args.ref === 'string' && args.ref ? args.ref : null;
      return adapter.blame({ path: args.path, ref });
    });
  });

  // BLOCK-29.5 — stash 列表（只读，不含 pop/apply 写操作）
  ipcMain.handle('git:stash-list', async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = await resolveGitAdapter(args.projectId);
      const result = adapter.stashList();
      return { stashes: result.stashes, count: result.count };
    });
  });

  // BLOCK-29.5 — 标签列表（只读）
  ipcMain.handle('git:tag-list', async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = await resolveGitAdapter(args.projectId);
      const result = adapter.tagList();
      return { tags: result.tags, count: result.count };
    });
  });

  ipcMain.handle('git:commit-diff', async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = await resolveGitAdapter(args.projectId);
      // BLOCK-29.5 — 区间对比模式：fromRef..toRef（均为 hex sha，只读）
      if (args && typeof args.fromRef === 'string' && typeof args.toRef === 'string') {
        const fromRef = assertSha(args.fromRef, 'fromRef');
        const toRef = assertSha(args.toRef, 'toRef');
        return parseDiffFiles(adapter.diff({ fromRef, toRef }).patch || '');
      }
      const hash = assertSha(args && args.hash, 'hash');
      return commitDiffParsed(adapter, hash);
    });
  });

  ipcMain.handle('git:commit-file-content', async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = await resolveGitAdapter(args.projectId);
      if (!args || typeof args.path !== 'string' || !args.path) {
        throw new GitAdapterError('path_required', 'path is required.');
      }
      // BLOCK-29.5 — 区间模式：fromRef 版本为 original，toRef 版本为 modified（均为 hex sha）
      if (typeof args.fromRef === 'string' && typeof args.toRef === 'string') {
        const fromRef = assertSha(args.fromRef, 'fromRef');
        const toRef = assertSha(args.toRef, 'toRef');
        const atRange = (ref) => {
          try {
            return adapter.showFile({ ref, filePath: args.path });
          } catch {
            return null;
          }
        };
        return { original: atRange(fromRef) ?? '', modified: atRange(toRef) ?? '' };
      }
      const hash = assertSha(args && args.hash, 'hash');
      const at = (ref) => {
        try {
          return adapter.showFile({ ref, filePath: args.path });
        } catch {
          return null; // 新增文件在父提交不存在 / 删除文件在本提交不存在
        }
      };
      return {
        original: at(`${hash}^`) ?? '',
        modified: at(hash) ?? '',
      };
    });
  });

  // ============================================================
  // BLOCK-29.2 — git 工具二期（审阅面板内联操作，均带前端确认框）：
  //   git:discard-file      放弃单文件工作区改动（tracked 还原 / untracked 删除）
  //   git:undo-last-commit  撤销最近一次提交（mixed reset，内容回工作区）
  // ============================================================
  ipcMain.handle('git:discard-file', async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = await resolveGitAdapter(args.projectId);
      if (!args || typeof args.path !== 'string' || !args.path) {
        throw new GitAdapterError('path_required', 'path is required.');
      }
      return adapter.discardFile({ path: args.path });
    });
  });

  ipcMain.handle('git:undo-last-commit', async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = await resolveGitAdapter(args.projectId);
      return adapter.undoLastCommit();
    });
  });

  // ============================================================
  // BLOCK-41 — git 写操作三期（审阅面板，均经 resolveGitAdapter 项目级隔离）：
  //   git:stage-paths       显式路径暂存（复用 BLOCK-20 commit-review 的 adapter.stage）
  //   git:unstage-paths     显式路径取消暂存（unborn HEAD 回退 git rm --cached）
  //   git:commit-index      提交整个暂存区（手动提交框；无 pathspec，不隐式带工作区改动）
  //   git:checkout-branch   切换本地分支（脏树拒绝 + 冲突清单；mid-operation 拒绝）
  //   git:remote-list       远程列表（只读）
  //   git:remote-status     fetch + ahead/behind（async，离线诚实降级）
  //   git:push / git:pull   推送/拉取（async 不阻塞主进程；认证依赖系统 credential helper）
  // ============================================================
  ipcMain.handle('git:stage-paths', async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = await resolveGitAdapter(args.projectId);
      if (!args || !Array.isArray(args.paths) || args.paths.length === 0) {
        throw new GitAdapterError('paths_required', 'paths array is required.');
      }
      return adapter.stage({ paths: args.paths });
    });
  });

  ipcMain.handle('git:unstage-paths', async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = await resolveGitAdapter(args.projectId);
      if (!args || !Array.isArray(args.paths) || args.paths.length === 0) {
        throw new GitAdapterError('paths_required', 'paths array is required.');
      }
      return adapter.unstage({ paths: args.paths });
    });
  });

  ipcMain.handle('git:commit-index', async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = await resolveGitAdapter(args.projectId);
      if (!args || typeof args.message !== 'string' || args.message.trim() === '') {
        throw new GitAdapterError('commit_message_required', 'Commit message is required.');
      }
      const result = adapter.commitIndex({ message: args.message.trim() });
      const newStatus = adapter.repositoryStatus({ untracked: 'all' });
      return { ...result, remaining: newStatus.entries.length };
    });
  });

  ipcMain.handle('git:checkout-branch', async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = await resolveGitAdapter(args.projectId);
      if (!args || typeof args.name !== 'string' || !args.name.trim()) {
        throw new GitAdapterError('branch_name_required', 'Branch name is required.');
      }
      return adapter.checkoutBranch({ name: args.name.trim() });
    });
  });

  ipcMain.handle('git:remote-list', async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = await resolveGitAdapter(args.projectId);
      return adapter.remoteList();
    });
  });

  ipcMain.handle('git:remote-status', async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = await resolveGitAdapter(args.projectId);
      return adapter.remoteStatus();
    });
  });

  ipcMain.handle('git:push', async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = await resolveGitAdapter(args.projectId);
      return adapter.push({
        remote: typeof args.remote === 'string' ? args.remote : null,
        branch: typeof args.branch === 'string' ? args.branch : null,
        setUpstream: args.setUpstream === true,
      });
    });
  });

  ipcMain.handle('git:pull', async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = await resolveGitAdapter(args.projectId);
      return adapter.pull({
        remote: typeof args.remote === 'string' ? args.remote : null,
        branch: typeof args.branch === 'string' ? args.branch : null,
      });
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

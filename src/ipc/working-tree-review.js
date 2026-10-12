const CHANNELS = require('./channels');
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
const { GitAdapterError } = require('../../core/shared-backend/git-adapter');
const { createSenderGuard } = require('./_sender-guard');
// BLOCK-92 Wave D1 — 模块级 helpers 外迁 ./working-tree-review/*（纯搬运零行为变化）：
// context（项目工作区/adapter 装配/safeInvoke）/ repository-init（git init 引导）/
// diff-parse（diff 解析与反向 patch）/ reject-store（reject 清单落盘）。
// 本文件保留 setupWorkingTreeReviewIpc 工厂编排与通道装配（同 tools-executor 先例）。
const { safeInvoke, resolveGitAdapter, getProjectWorkspacePath } = require('./working-tree-review/context');
const { initRepositoryAt } = require('./working-tree-review/repository-init');
const { diffForReview, parseDiffFiles, buildReversePatchForReject } = require('./working-tree-review/diff-parse');
const { _writeRejectEntry } = require('./working-tree-review/reject-store');
// BLOCK-152 H 轨 — commitReview hunk 级 stage 面分类（纯函数：签名复算/diff 切片/patch 构造）。
const { classifyReviewStageSurface } = require('./working-tree-review/review-stage');

// BLOCK-125：拒绝清单根目录解析——与 core/petri-server/helpers/system-prompt.js
// resolveWorkingTreeRejectRoot 同优先级（LOCAL_DATA_DIR 优先 / USER_DATA_DIR 回退），
// 两侧口径由 test/reject-loop-root.test.mjs 源码扫描守卫钉住（本文件受 quality:arch
// R5 限制不能 require core helper，故内联同逻辑；改解析规则必须两侧同批改）。
function resolveRejectRootDir() {
  if (process.env.PETRI_LOCAL_DATA_DIR) return process.env.PETRI_LOCAL_DATA_DIR;
  return app.getPath('userData');
}

const MAX_FILE_CONTENT_BYTES = 1024 * 1024; // 1MB；超过只返回元信息（行级渲染策略）

/**
 * 装配所有 BLOCK-16 IPC handlers。
 * @param {{mainWindow?: Electron.BrowserWindow|null}} [options]
 */
function setupWorkingTreeReviewIpc(options = {}) {
  const assertSender = createSenderGuard(options.mainWindow);

  ipcMain.handle(CHANNELS.git.workingTreeStatus, async (event, args = {}) => {
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

  // UI-449（C-16）— 审阅徽章 ±行数权威源：git shortstat（tracked+untracked 分开），
  // 前端不自行数行（避免第二真相）。
  ipcMain.handle(CHANNELS.git.shortstat, async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = await resolveGitAdapter(args.projectId);
      const stat = adapter.workingTreeShortstat();
      return { tracked: stat.tracked, untrackedFiles: stat.untrackedFiles, empty: stat.empty };
    });
  });

  ipcMain.handle(CHANNELS.git.workingTreeDiff, async (event, args = {}) => {
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

  ipcMain.handle(CHANNELS.git.workingTreeFileContent, async (event, args = {}) => {
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
        // BLOCK-50 — 已删除（D）/已消失文件是审阅合法条目，不再抛 file_missing：
        // HEAD 有（showFile 返回非 null）→ deleted:true（空内容呈现删除 diff）；
        // HEAD 也无（null）→ missing:true（彻底消失，前端占位）。
        const headContent = adapter.showFile({ ref: 'HEAD', filePath: args.path });
        return headContent != null
          ? { content: '', encoding: 'utf-8', size: 0, deleted: true }
          : { content: '', encoding: 'utf-8', size: 0, missing: true };
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

  ipcMain.handle(CHANNELS.git.hunkApply, async (event, args = {}) => {
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
      _writeRejectEntry(resolveRejectRootDir(), {
        file: args.file,
        hunkIndex: args.hunkIndex,
        taskId: args.taskId,
        feedback: args.feedback,
        hunk: args.hunk || null,
      });
      return { action: 'reject', file: args.file, hunkIndex: args.hunkIndex };
    });
  });

  ipcMain.handle(CHANNELS.git.workingTreeRevert, async (event, args = {}) => {
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

  ipcMain.handle(CHANNELS.git.listModified, async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = await resolveGitAdapter(args.projectId);
      const includeUntracked = args.includeUntracked !== false; // default true
      const result = adapter.listModified({ includeUntracked });
      return { files: result.files, count: result.files.length };
    });
  });

  ipcMain.handle(CHANNELS.git.fileHeadContent, async (event, args = {}) => {
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

  ipcMain.handle(CHANNELS.git.splitSideDiff, async (event, args = {}) => {
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

  ipcMain.handle(CHANNELS.git.revertFile, async (event, args = {}) => {
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

  ipcMain.handle(CHANNELS.git.applyInverseHunk, async (event, args = {}) => {
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
  ipcMain.handle(CHANNELS.git.hunkRejectInverse, async (event, args = {}) => {
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
      _writeRejectEntry(resolveRejectRootDir(), {
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
  // 语义：用户逐 hunk 审阅后，点 "Commit Review" 将 accepted hunks
  // stage 并 commit。commit message 由用户在 dialog 中填写。
  //
  // decisions 格式：Record<`${file}#${hunkIndex}`, 'accept'|'reject'|'pending'>
  // 返回 { ok, commit, files, message, stats }。
  //
  // BLOCK-152 H 轨根修复 — stage 面按 hunk 粒度精确化（旧实现整文件 stage，
  // 未决 hunk 会随所属文件静默入提交；前端 BLOCK-147 拦截保留为第二道防线）：
  //   - 全 hunk accept 文件 = 整文件 git add（现状保绿）；
  //   - 混合（accept + reject/未决）= 仅含 accept hunk 的 patch 经
  //     git apply --cached 入隔离 index（commitFromIsolatedIndex），
  //     提交后真实 index 对齐新 HEAD，未决 hunk 留在工作树为未暂存改动；
  //   - 全 reject/未决 = 不 stage；stale（对不上当前 diff）的 accept 键
  //     一律不 stage，只如实上报 staleDecisionKeys；
  //   - patch 应用失败 = fail-closed 结构化错误，不静默整文件降级。
  // ============================================================
  ipcMain.handle(CHANNELS.git.commitReview, async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = await resolveGitAdapter(args.projectId);

      if (!args || !args.decisions || typeof args.decisions !== 'object') {
        throw new GitAdapterError('decisions_required', 'decisions map is required.');
      }
      if (typeof args.message !== 'string' || args.message.trim() === '') {
        throw new GitAdapterError('commit_message_required', 'Commit message is required.');
      }

      // BLOCK-147：键形态已改内容寻址 `${path}#${hunkSignature}`（oldStart+内容指纹）；
      // 本端以 lastIndexOf('#') 取路径，索引段不被解析，与旧 file#index 形态行为兼容。
      const decisions = args.decisions; // Record<`${path}#${hunkSignature}`, 'accept'|'reject'|'pending'>
      const message = args.message.trim();

      // 收集 accepted / rejected 文件列表（去重；rejected 仅用于回执留痕）
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

      // BLOCK-169 H-1 — 对账基线与面板同源：staged 文件（indexStatus 非空）的面板键
      // 来自 HEAD→index 面；统一用工作树面对账会把「staged 后再编辑」误判 stale。
      const statusEntriesForBaseline = adapter.repositoryStatus({ untracked: 'all' }).entries;
      const stagedIndex = new Set(statusEntriesForBaseline
        .filter((entry) => entry.indexStatus && entry.indexStatus !== ' '
          && acceptedFiles.has(entry.path))
        .map((entry) => entry.path));
      const worktreeAccepted = [...acceptedFiles].filter((p) => !stagedIndex.has(p));
      const stagedAccepted = [...acceptedFiles].filter((p) => stagedIndex.has(p));
      const diffText = [
        stagedAccepted.length > 0
          ? diffForReview(adapter, stagedAccepted, true).patch || ''
          : '',
        worktreeAccepted.length > 0
          ? diffForReview(adapter, worktreeAccepted, false).patch || ''
          : '',
      ].filter(Boolean).join('\n');
      const surface = classifyReviewStageSurface({ decisions, diffText });
      const committedFiles = [...surface.wholeFiles, ...surface.patches.map((p) => p.path)];

      if (committedFiles.length === 0) {
        // 治本语义：accept 键全部 stale（hunk 已回退/变更）时不得整文件降级入提交。
        throw new GitAdapterError('no_files_to_commit', 'No accepted hunks matched the current diff.');
      }

      // BLOCK-152 P1 — staged rename 配对修复：R 条目（porcelain `R old -> new`）在
      // 面板上只有 new 侧（parsePorcelainZ 单条目 + pathspec diff 破坏 rename 配对），
      // 用户审的只有 new 侧一个面；隔离 index 自 read-tree HEAD 出发仍持有 old 侧，
      // 只 add new 侧会把 old 以旧内容带进提交（rename 半套提交）。凡提交面覆盖
      // R 条目 new 侧的，其 originalPath 必须从隔离树移除。C（copy）条目不同：
      // copy 源本就应留在树里（read-tree HEAD 已含、未动即正确），不移除。
      // 真实 index 侧无需处理：indexStatus=R 的定义即真实 index 已删 originalPath
      // （git mv/index rm 后 add），提交后天然与新 HEAD 一致（场景 8/9 status 干净断言兜底）。
      const committedPathSet = new Set(committedFiles);
      const renameOriginalPaths = statusEntriesForBaseline
        .filter((entry) => entry.indexStatus === 'R' && entry.originalPath && committedPathSet.has(entry.path))
        .map((entry) => entry.originalPath);

      // BLOCK-169 H-2 — staged 删除条目分流：index 已删且工作树无文件的 pathspec
      // 走 git add 会 fatal；删除语义经 removePaths 进隔离 index（对照 unstage 的
      // git rm --cached 先例）。真实 index 对这类条目无需动作（indexStatus=D 的
      // 定义即 index 已删，提交后与新 HEAD 天然一致）。
      // BLOCK-169 H-1 内容面 — staged 文件（M/A/D）整文件面不走 git add（工作树
      // 内容可能含未审阅再编辑），改用其 staged 基线 patch 进 apply --cached 管线：
      // 提交内容恰为面板审阅的 staged 快照，再编辑以未暂存形态保留。R/C 条目保留
      // add 语义（BLOCK-152 rename 配对修复的行为面）。
      const stagedWholePatches = [];
      const stageWhole = [];
      for (const p of surface.wholeFiles) {
        const entry = statusEntriesForBaseline.find((e) => e.path === p);
        const indexStatus = (entry && entry.indexStatus) || '';
        if (indexStatus === 'M' || indexStatus === 'A' || indexStatus === 'D') {
          const stagedPatch = diffForReview(adapter, [p], true).patch || '';
          if (stagedPatch) {
            stagedWholePatches.push({ path: p, patch: stagedPatch });
            continue;
          }
        }
        stageWhole.push(p);
      }
      const patches = [...surface.patches, ...stagedWholePatches];
      const removePaths = renameOriginalPaths;

      // 隔离 index 提交：临时 index 自 HEAD 出发，rename original 侧 force-remove +
      // 整文件 add + per-hunk patch apply --cached，write-tree/commit-tree/
      // update-ref(CAS) 落提交。不走 commit --only——它取工作树内容，
      // 会把未决 hunk 一起带进提交。
      const commitResult = adapter.commitFromIsolatedIndex({
        message,
        stagePaths: stageWhole,
        patches,
        removePaths,
      });

      // BLOCK-169 H-3 — 真实 index 对齐后移到成功路径：apply 失败 fail-closed 时
      // 真实 index 不残留先行 stage（提交意图一致性；原实现 wholeFiles 先行 stage
      // 失败后遗留用户可见）。staged 文件经 patch 管线后真实 index 需重 stage 对齐
      // 新 HEAD（git add 取工作树内容；staged-only 文件工作树==staged 内容时零差异）。
      // 对齐步骤排除 staged 删除条目（git add 对工作树已无文件的 pathspec fatal；
      // 其真实 index 本就不含该文件，提交后天然对齐）。
      const alignPaths = surface.wholeFiles.filter((p) => {
        const entry = statusEntriesForBaseline.find((e) => e.path === p);
        return !entry || entry.indexStatus !== 'D';
      });
      if (alignPaths.length > 0) {
        adapter.stage({ paths: alignPaths });
      }

      // 混合文件对账：真实 index 对齐新 HEAD，未决改动以未暂存形态留在工作树
      if (surface.patches.length > 0) {
        adapter.unstage({ paths: surface.patches.map((p) => p.path) });
      }

      // 刷新工作区状态
      const newStatus = adapter.repositoryStatus({ untracked: 'all' });

      return {
        ok: true,
        commit: commitResult.commit,
        files: committedFiles,
        message,
        rejectedFiles: [...rejectedFiles],
        // BLOCK-152 — 内容寻址对不上当前 diff 的 accept 键（stale），未入提交（additive）
        staleDecisionKeys: surface.staleKeys,
        stats: {
          acceptedFiles: committedFiles.length,
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

  ipcMain.handle(CHANNELS.git.commitLog, async (event, args = {}) => {
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
  ipcMain.handle(CHANNELS.git.branchList, async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = await resolveGitAdapter(args.projectId);
      const result = adapter.listBranches();
      return { branches: result.branches, count: result.count };
    });
  });

  // BLOCK-29.5 — 逐行归属（文件视图第四态，只读）
  ipcMain.handle(CHANNELS.git.blame, async (event, args = {}) => {
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
  ipcMain.handle(CHANNELS.git.stashList, async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = await resolveGitAdapter(args.projectId);
      const result = adapter.stashList();
      return { stashes: result.stashes, count: result.count };
    });
  });

  // BLOCK-29.5 — 标签列表（只读）
  ipcMain.handle(CHANNELS.git.tagList, async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = await resolveGitAdapter(args.projectId);
      const result = adapter.tagList();
      return { tags: result.tags, count: result.count };
    });
  });

  ipcMain.handle(CHANNELS.git.commitDiff, async (event, args = {}) => {
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

  ipcMain.handle(CHANNELS.git.commitFileContent, async (event, args = {}) => {
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
  ipcMain.handle(CHANNELS.git.discardFile, async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = await resolveGitAdapter(args.projectId);
      if (!args || typeof args.path !== 'string' || !args.path) {
        throw new GitAdapterError('path_required', 'path is required.');
      }
      return adapter.discardFile({ path: args.path });
    });
  });

  ipcMain.handle(CHANNELS.git.undoLastCommit, async (event, args = {}) => {
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
  ipcMain.handle(CHANNELS.git.stagePaths, async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = await resolveGitAdapter(args.projectId);
      if (!args || !Array.isArray(args.paths) || args.paths.length === 0) {
        throw new GitAdapterError('paths_required', 'paths array is required.');
      }
      return adapter.stage({ paths: args.paths });
    });
  });

  ipcMain.handle(CHANNELS.git.unstagePaths, async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = await resolveGitAdapter(args.projectId);
      if (!args || !Array.isArray(args.paths) || args.paths.length === 0) {
        throw new GitAdapterError('paths_required', 'paths array is required.');
      }
      return adapter.unstage({ paths: args.paths });
    });
  });

  ipcMain.handle(CHANNELS.git.commitIndex, async (event, args = {}) => {
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

  ipcMain.handle(CHANNELS.git.checkoutBranch, async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = await resolveGitAdapter(args.projectId);
      if (!args || typeof args.name !== 'string' || !args.name.trim()) {
        throw new GitAdapterError('branch_name_required', 'Branch name is required.');
      }
      return adapter.checkoutBranch({ name: args.name.trim() });
    });
  });

  ipcMain.handle(CHANNELS.git.remoteList, async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = await resolveGitAdapter(args.projectId);
      return adapter.remoteList();
    });
  });

  ipcMain.handle(CHANNELS.git.remoteStatus, async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = await resolveGitAdapter(args.projectId);
      return adapter.remoteStatus();
    });
  });

  ipcMain.handle(CHANNELS.git.push, async (event, args = {}) => {
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

  ipcMain.handle(CHANNELS.git.pull, async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const adapter = await resolveGitAdapter(args.projectId);
      return adapter.pull({
        remote: typeof args.remote === 'string' ? args.remote : null,
        branch: typeof args.branch === 'string' ? args.branch : null,
      });
    });
  });

  // BLOCK-53 P2 — 非 git 工作区一次性引导：在项目 workspace 执行 git init + 初始提交。
  // 注意不走 resolveGitAdapter（它对非 git 抛 project_workspace_not_git，正是本通道要解决的状态）。
  ipcMain.handle(CHANNELS.git.initRepository, async (event, args = {}) => {
    const deny = assertSender(event); if (deny) return deny;
    return safeInvoke(async () => {
      const projectId = args && typeof args.projectId === 'string' ? args.projectId.trim() : '';
      if (!projectId) {
        throw new GitAdapterError('project_required', '缺少 projectId，无法定位项目工作区。');
      }
      const workspacePath = await getProjectWorkspacePath(projectId);
      if (!workspacePath || !path.isAbsolute(workspacePath)) {
        throw new GitAdapterError('workspace_unavailable', '项目工作区路径未配置或无效。', { projectId });
      }
      if (!fs.existsSync(workspacePath) || !fs.statSync(workspacePath).isDirectory()) {
        throw new GitAdapterError('workspace_unavailable', `项目工作区目录不存在: ${workspacePath}`, { projectId, workspacePath });
      }
      return initRepositoryAt(workspacePath);
    });
  });

  /**
   * 暴露 main→renderer 通知触发器，供主进程其他模块（如 agent runner / SSE listener）
   * 在任务完成时调用。BLOCK-16 PHASE 3 接入。
   */
  function notifyAgentTaskDone({ taskId, filesChanged }) {
    if (!options.mainWindow || options.mainWindow.isDestroyed()) return;
    options.mainWindow.webContents.send(CHANNELS.agent.taskDone, {
      taskId: taskId || null,
      filesChanged: Array.isArray(filesChanged) ? filesChanged : [],
      notifiedAt: new Date().toISOString(),
    });
  }

  return { notifyAgentTaskDone };
}

module.exports = { setupWorkingTreeReviewIpc, initRepositoryAt };
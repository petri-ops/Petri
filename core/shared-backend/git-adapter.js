'use strict';

const { execFileSync } = require('child_process');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');
const pathModule = path;
// BLOCK-92 Wave C-9 — git 运行时探测/诊断脱敏/pathspec 校验/porcelain 解析/
// unified-diff 反演已外迁 ./git-adapter/runtime.js（纯搬运零行为变化）；
// 本文件保留 createGitAdapter 工厂闭包（同 tools-executor 先例）。
const {
  GIT_ADAPTER_VERSION,
  MINIMUM_GIT_VERSION,
  FORBIDDEN_PATHSPECS,
  GitAdapterError,
  redactGitDiagnostic,
  parseGitVersion,
  baseEnv,
  resetGitRuntimeCache,
  detectGitRuntime,
  assertSafePathspecs,
  assertSafeRef,
  parsePorcelainZ,
  invertUnifiedDiff,
  HASH_OBJECT_TIMEOUT_MS,
  HASH_OBJECT_MAX_ATTEMPTS,
} = require('./git-adapter/runtime');

function createGitAdapter(options = {}) {
  const { gitDir, workTree } = options;
  if (!gitDir || typeof gitDir !== 'string') {
    throw new GitAdapterError('git_dir_required', 'gitDir is required.');
  }
  if (!workTree || typeof workTree !== 'string') {
    throw new GitAdapterError('work_tree_required', 'workTree is required.');
  }
  // BLOCK-67 P3：remoteSsh 模式——同一 argv 面经 `ssh <alias> git` 在远端执行
  // （远程 POSIX 路径不做本地 path.resolve；只读链先行，写操作 argv 数组同通道无注入面）。
  const remoteSsh = options.remoteSsh && options.remoteSsh.alias
    ? { alias: String(options.remoteSsh.alias).replace(/[^A-Za-z0-9._-]/g, '') }
    : null;
  const resolvedGitDir = remoteSsh ? gitDir : path.resolve(gitDir);
  const resolvedWorkTree = remoteSsh ? workTree : path.resolve(workTree);
  const gitBin = options.gitBin || 'git';
  const allowHooks = options.allowHooks === true;
  const identity = options.identity || null;
  const scope = { gitDir: resolvedGitDir, workTree: resolvedWorkTree, remote: !!remoteSsh };

  /** 远端执行：ssh <alias> git <argv>（BatchMode；env 不外传，只读语义足够）。 */
  function execGitArgv(argv, execOptions) {
    if (!remoteSsh) return execFileSync(gitBin, argv, execOptions);
    return execFileSync(
      'ssh',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '--', remoteSsh.alias, 'git', ...argv],
      execOptions
    );
  }

  /**
   * 执行一条 git 命令。参数以数组传入，不经 shell。
   *
   * @param {string[]} args
   * @param {{ allowFailure?: boolean, readOnly?: boolean, timeout?: number }} [runOptions]
   */
  function run(args, runOptions = {}) {
    const prefix = ['--git-dir', resolvedGitDir, '--work-tree', resolvedWorkTree];
    if (!allowHooks) {
      // 指向一个我们从不创建的目录 → git 找不到任何 hook，等价于禁用。
      prefix.unshift('-c', `core.hooksPath=${path.join(resolvedGitDir, 'biof3-disabled-hooks')}`);
    }
    const env = baseEnv();
    if (runOptions.readOnly) env.GIT_OPTIONAL_LOCKS = '0';
    let stdout = '';
    try {
      stdout = execGitArgv([...prefix, ...args], {
        encoding: 'utf8',
        cwd: remoteSsh ? undefined : (fs.existsSync(resolvedWorkTree) ? resolvedWorkTree : undefined),
        env: { ...env, ...(runOptions.env || {}) },
        input: runOptions.input,
        timeout: runOptions.timeout || 60000,
        maxBuffer: 32 * 1024 * 1024,
        stdio: [runOptions.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      });
      return { ok: true, stdout: stdout == null ? '' : String(stdout), stderr: '', status: 0 };
    } catch (error) {
      const systemCode = error && typeof error.code === 'string' ? error.code : null;
      const failure = {
        ok: false,
        command: args[0] || null,
        stdout: error && error.stdout ? String(error.stdout) : '',
        stderr: redactGitDiagnostic(error && error.stderr ? String(error.stderr) : (error && error.message), scope),
        status: error && typeof error.status === 'number' ? error.status : null,
        systemCode,
        signal: error && typeof error.signal === 'string' ? error.signal : null,
        killed: error && error.killed === true,
        code: systemCode === 'ENOENT' ? 'git_executable_not_found' : 'git_command_failed',
      };
      if (runOptions.allowFailure) return failure;
      throw new GitAdapterError(failure.code, `git ${args[0] || ''} failed`, failure);
    }
  }

  function identityArgs() {
    if (!identity || !identity.name || !identity.email) return [];
    return ['-c', `user.name=${identity.name}`, '-c', `user.email=${identity.email}`];
  }

  /**
   * BLOCK-41 — 异步执行一条 git 命令（push/pull 等网络操作专用）。
   * 与 run() 同参同样走数组 + 不经 shell + 诊断脱敏，但不阻塞主进程事件循环：
   * push/pull 可能等待网络/凭据数十秒，execFileSync 会冻结整个 IPC 通道。
   * @param {string[]} args
   * @param {{ allowFailure?: boolean, readOnly?: boolean, timeout?: number }} [runOptions]
   * @returns {Promise<{ok: boolean, stdout: string, stderr: string, status: number|null, code?: string, command: string|null}>}
   */
  function runAsync(args, runOptions = {}) {
    const prefix = ['--git-dir', resolvedGitDir, '--work-tree', resolvedWorkTree];
    if (!allowHooks) {
      prefix.unshift('-c', `core.hooksPath=${path.join(resolvedGitDir, 'biof3-disabled-hooks')}`);
    }
    const env = baseEnv();
    if (runOptions.readOnly) env.GIT_OPTIONAL_LOCKS = '0';
    const command = remoteSsh
      ? ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '--', remoteSsh.alias, 'git', ...prefix, ...args]
      : [gitBin, ...prefix, ...args];
    return new Promise((resolve) => {
      const child = execFile(
        command[0],
        command.slice(1),
        {
          encoding: 'utf8',
          cwd: remoteSsh ? undefined : (fs.existsSync(resolvedWorkTree) ? resolvedWorkTree : undefined),
          env: { ...env, ...(runOptions.env || {}) },
          timeout: runOptions.timeout || 60000,
          maxBuffer: 32 * 1024 * 1024,
          killSignal: 'SIGKILL',
        },
        (error, stdout, stderr) => {
          if (!error) {
            resolve({ ok: true, stdout: stdout == null ? '' : String(stdout), stderr: '', status: 0, command: args[0] || null });
            return;
          }
          resolve({
            ok: false,
            command: args[0] || null,
            stdout: stdout ? String(stdout) : '',
            stderr: redactGitDiagnostic(stderr ? String(stderr) : (error && error.message) || '', scope),
            status: typeof error.code === 'number' ? error.code : null,
            killed: error.killed === true,
            code: error.code === 'ENOENT' ? 'git_executable_not_found' : 'git_command_failed',
          });
        }
      );
      // 防凭据类交互挂起：execFile 的 timeout 覆盖不了全部等待态，超时兜底强杀。
      child.on('error', () => { /* 错误已在回调里归一化 */ });
    });
  }

  return {
    gitAdapterVersion: GIT_ADAPTER_VERSION,
    gitDir: resolvedGitDir,
    workTree: resolvedWorkTree,
    gitBin,

    run,

    /** 该 gitDir 是否已经是一个仓库。 */
    isRepository() {
      if (!fs.existsSync(path.join(resolvedGitDir, 'HEAD'))) return false;
      return run(['rev-parse', '--git-dir'], { allowFailure: true, readOnly: true }).ok;
    },

    /**
     * 初始化托管仓库（git 元数据与工作区分离，用户目录不出现 .git）。
     * 幂等：已存在则只补齐本地身份配置。
     */
    initManaged() {
      fs.mkdirSync(path.dirname(resolvedGitDir), { recursive: true });
      if (!fs.existsSync(path.join(resolvedGitDir, 'HEAD'))) {
        const init = run(['init', '--quiet'], { allowFailure: true });
        if (!init.ok) throw new GitAdapterError('git_init_failed', 'Managed repository init failed.', init);
      }
      // 托管仓库自带提交身份，避免机器没有 global identity 时提交失败。
      run(['config', 'user.name', identity?.name || 'BioF3'], { allowFailure: true });
      run(['config', 'user.email', identity?.email || 'biof3@localhost'], { allowFailure: true });
      // 托管历史不对外推送，显式关闭 gc 自动打包外的远程行为面。
      run(['config', 'core.logAllRefUpdates', 'true'], { allowFailure: true });
      return this.repositoryState();
    },

    /** 仓库运行态：锁、中途操作、submodule、linked worktree、HEAD。 */
    repositoryState() {
      const hasIndexLock = fs.existsSync(path.join(resolvedGitDir, 'index.lock'));
      const mergeInProgress = fs.existsSync(path.join(resolvedGitDir, 'MERGE_HEAD'));
      const cherryPickInProgress = fs.existsSync(path.join(resolvedGitDir, 'CHERRY_PICK_HEAD'));
      const revertInProgress = fs.existsSync(path.join(resolvedGitDir, 'REVERT_HEAD'));
      const rebaseInProgress = fs.existsSync(path.join(resolvedGitDir, 'rebase-merge'))
        || fs.existsSync(path.join(resolvedGitDir, 'rebase-apply'));
      const hasSubmodules = fs.existsSync(path.join(resolvedWorkTree, '.gitmodules'));
      // 下面三个字段各需一次 git 子进程，而上面的锁/中途操作/submodule 判断
      // 全是 fs.existsSync。`bindProjectRepository()` 在 managed 模式下只读
      // fs 那几项（git-repository-binding.js:301-317），
      // linkedWorktreeCount 仅在 `mode === 'existing'` 分支使用，
      // 因此只读请求过去白付三次 fork。
      //
      // 改为惰性求值：对象形状与字段语义不变，读到才 fork，读一次缓存一次。
      // 写路径（result-changeset-service.js:242 读 headCommit）照常付出代价。
      let headProbe = null;
      const probeHead = () => {
        if (!headProbe) {
          headProbe = {
            ref: run(['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFailure: true, readOnly: true }),
            commit: run(['rev-parse', '--verify', '--quiet', 'HEAD'], { allowFailure: true, readOnly: true }),
          };
        }
        return headProbe;
      };
      let worktreeCount = null;
      const probeWorktrees = () => {
        if (worktreeCount === null) {
          const worktrees = run(['worktree', 'list', '--porcelain'], { allowFailure: true, readOnly: true });
          worktreeCount = worktrees.ok
            ? Math.max(0, worktrees.stdout.split('\n').filter((line) => line.startsWith('worktree ')).length - 1)
            : 0;
        }
        return worktreeCount;
      };
      return {
        gitAdapterVersion: GIT_ADAPTER_VERSION,
        initialized: fs.existsSync(path.join(resolvedGitDir, 'HEAD')),
        // getter：读到才 fork。属性访问语义与原来完全一致，
        // 既有读取方（result-changeset-service.js:242、test/git-adapter.test.mjs:208/:344）无需改动。
        get headRef() {
          const { ref } = probeHead();
          return ref.ok ? ref.stdout.trim() || null : null;
        },
        get headCommit() {
          const { commit } = probeHead();
          return commit.ok ? commit.stdout.trim() || null : null;
        },
        get detached() {
          const { ref, commit } = probeHead();
          return ref.ok ? false : !!(commit.ok && commit.stdout.trim());
        },
        get unborn() {
          const { commit } = probeHead();
          return !(commit.ok && commit.stdout.trim());
        },
        hasIndexLock,
        mergeInProgress,
        cherryPickInProgress,
        revertInProgress,
        rebaseInProgress,
        midOperation: mergeInProgress || cherryPickInProgress || revertInProgress || rebaseInProgress,
        hasSubmodules,
        get linkedWorktreeCount() { return probeWorktrees(); },
      };
    },

    /**
     * 路径受限状态查询。必须提供显式 pathspec。
     *
     * 默认 `untracked='all'`：`normal` 会把完全未跟踪的目录折叠成一个条目
     * （例如新建的 `analysis/scripts/x.R` 只报告 `analysis/`），
     * 会让受管理路径下的用户新文件在冲突检测中漏判。
     */
    status({ paths, untracked = 'all' } = {}) {
      const safe = assertSafePathspecs(paths, scope);
      const mode = ['no', 'normal', 'all'].includes(untracked) ? untracked : 'all';
      const output = run(
        ['status', '--porcelain=v1', '-z', `--untracked-files=${mode}`, '--', ...safe],
        { allowFailure: true, readOnly: true }
      );
      if (!output.ok) throw new GitAdapterError('git_status_failed', 'Scoped git status failed.', output);
      const parsed = parsePorcelainZ(output.stdout);
      return {
        scope: 'paths',
        paths: safe,
        ...parsed,
        dirty: parsed.entries.some((entry) => !entry.untracked),
        hasUntracked: parsed.entries.some((entry) => entry.untracked),
        hasConflict: parsed.entries.some((entry) => entry.conflicted),
      };
    },

    /**
     * 仓库级状态。仅用于绑定既有用户仓库时判断 clean/dirty；
     * 托管模式下工作区可能包含大量科学数据，不应调用。
     */
    repositoryStatus({ untracked = 'normal' } = {}) {
      const mode = ['no', 'normal', 'all'].includes(untracked) ? untracked : 'normal';
      const output = run(
        ['status', '--porcelain=v1', '-z', `--untracked-files=${mode}`],
        { allowFailure: true, readOnly: true }
      );
      if (!output.ok) throw new GitAdapterError('git_status_failed', 'Repository git status failed.', output);
      const parsed = parsePorcelainZ(output.stdout);
      return {
        scope: 'repository',
        ...parsed,
        dirty: parsed.entries.some((entry) => !entry.untracked),
        hasUntracked: parsed.entries.some((entry) => entry.untracked),
        hasConflict: parsed.entries.some((entry) => entry.conflicted),
      };
    },

    /** 路径受限 diff。`staged` 走 --cached；给定 refs 则比较两个提交。
     * UI-232 — 双 ref（fromRef+toRef）区间是有界的提交间只读比较，允许不带
     * pathspec 整树比较；工作区 diff（无 ref，含 --cached）维持 pathspec 强制
     * （assertSafePathspecs fail-closed 不变）。此前 commitDiffParsed 传空路径
     * 被拒（pathspec_required），真实链路所有提交差异恒为空。 */
    diff({ paths, staged = false, fromRef = null, toRef = null } = {}) {
      const boundedRange = Boolean(fromRef && toRef);
      const safe = boundedRange && (paths === undefined || paths === null)
        ? []
        : assertSafePathspecs(paths, scope);
      const args = ['diff', '--no-color', '--no-ext-diff'];
      if (staged) args.push('--cached');
      if (fromRef) args.push(fromRef);
      if (toRef) args.push(toRef);
      args.push('--', ...safe);
      const output = run(args, { allowFailure: true, readOnly: true });
      if (!output.ok) throw new GitAdapterError('git_diff_failed', 'Scoped git diff failed.', output);
      return { paths: safe, patch: output.stdout };
    },

    /**
     * BLOCK-29 — 提交历史列表（git log）。
     * BLOCK-29.3 — 记录分隔改为 \x01、追加 %b 完整提交说明（body 可含换行，
     * 不能按行切分）；字段 NUL 分隔（sha/shortSha/author/isoDate/subject/message）。
     * UI-234 — 加 --shortstat：每条提交附 stats {files, added, removed}（随 log
     * 一次取回，前端列表行默认可见，无需点开）。stat 行附在记录末尾，从末行提取。
     * limit 上限 200；ref 必须是安全的 ref 表达式（hex sha / 分支名 / HEAD），
     * 不接受空白与以 '-' 开头的值，防参数注入。
     */
    log({ limit = 50, ref = 'HEAD', file = null, skip = 0 } = {}) {
      const maxCount = Math.max(1, Math.min(Number(limit) || 50, 200));
      const refArg = assertSafeRef(ref) ?? 'HEAD';
      const args = [
        'log',
        '--pretty=format:%x01%H%x00%h%x00%an%x00%aI%x00%s%x00%b',
        '--shortstat',
        '--max-count=' + String(maxCount),
      ];
      const skipCount = Math.max(0, Math.floor(Number(skip) || 0));
      if (skipCount > 0) args.push('--skip=' + String(skipCount));
      args.push(refArg);
      if (typeof file === 'string' && file.trim()) {
        const safeFile = assertSafePathspecs([file.trim()], scope);
        args.push('--', ...safeFile);
      }
      const output = run(args, { allowFailure: true, readOnly: true });
      if (!output.ok) throw new GitAdapterError('git_log_failed', 'Scoped git log failed.', output);
      // UI-234 — git --shortstat 行：" N files changed, X insertions(+), Y deletions(-)"
      // （仅插入/仅删除时对应段可缺省；空提交无 stat 行）
      const STAT_LINE_RE = /^ (\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?\s*$/;
      const commits = [];
      for (const record of output.stdout.split('\x01')) {
        if (!record) continue;
        const fields = record.split('\x00');
        if (fields.length < 6 || !/^[0-9a-f]{7,64}$/i.test(fields[0])) continue;
        let message = (fields[5] ?? '').replace(/\n+$/, '');
        let stats = null;
        const msgLines = message.split('\n');
        const m = STAT_LINE_RE.exec(msgLines[msgLines.length - 1] ?? '');
        if (m) {
          stats = { files: Number(m[1]), added: Number(m[2] ?? 0), removed: Number(m[3] ?? 0) };
          msgLines.pop();
          message = msgLines.join('\n').replace(/\n+$/, '');
        }
        commits.push({
          sha: fields[0],
          shortSha: fields[1] || fields[0].slice(0, 7),
          author: fields[2] || '',
          isoDate: fields[3] || '',
          subject: fields[4] || '',
          message,
          stats,
        });
      }
      return { commits, count: commits.length };
    },

    /**
     * BLOCK-29.5 — 逐行归属（只读）。--porcelain 解析；commit 信息按 sha 去重；
     * 行数超 5000 截断（truncated: true）；行 → shortSha 映射，内容由前端全文视图对齐。
     */
    blame({ path: filePath, ref = null } = {}) {
      const safe = assertSafePathspecs([filePath], scope);
      const args = ['blame', '--porcelain'];
      const refArg = assertSafeRef(ref);
      if (refArg) args.push(refArg);
      args.push('--', safe[0]);
      const output = run(args, { allowFailure: true, readOnly: true });
      if (!output.ok) throw new GitAdapterError('git_blame_failed', 'Scoped git blame failed.', output);
      const lines = [];
      const commits = new Map();
      let cur = null;
      for (const raw of output.stdout.split('\n')) {
        if (cur === null) {
          const m = /^([0-9a-f]{40})\s+(\d+)\s+(\d+)(?:\s+(\d+))?$/.exec(raw);
          if (!m) continue;
          cur = { sha: m[1], finalLine: Number(m[3]), author: '', authorTime: '', summary: '' };
          continue;
        }
        if (raw.startsWith('author ')) { cur.author = raw.slice(7); continue; }
        if (raw.startsWith('author-time ')) { cur.authorTime = raw.slice(12); continue; }
        if (raw.startsWith('summary ')) { cur.summary = raw.slice(8); continue; }
        if (raw.startsWith('\t')) {
          // 行引用与 commits 键都用 shortSha，前端单表查找
          const shortSha = cur.sha.slice(0, 7);
          if (!commits.has(shortSha)) {
            const epoch = Number(cur.authorTime);
            commits.set(shortSha, {
              sha: cur.sha,
              shortSha,
              author: cur.author || '',
              isoDate: Number.isFinite(epoch) && epoch > 0 ? new Date(epoch * 1000).toISOString() : '',
              subject: cur.summary || '',
            });
          }
          lines.push({ line: cur.finalLine, sha: shortSha });
          cur = null;
          continue;
        }
        // 其它 header（committer / filename / previous / boundary）忽略
      }
      const maxLines = 5000;
      const truncated = lines.length > maxLines;
      return {
        path: safe[0],
        lines: truncated ? lines.slice(0, maxLines) : lines,
        commits: Object.fromEntries(commits),
        truncated,
      };
    },

    /**
     * BLOCK-29.5 — 本地分支列表（只读）。for-each-ref refs/heads，
     * NUL 分隔（name/shortSha/isoDate/HEAD 标记），供历史分区选择器。
     */
    listBranches() {
      const output = run(
        ['for-each-ref', '--format=%(refname:short)%00%(objectname:short)%00%(committerdate:iso8601-strict)%00%(HEAD)', 'refs/heads'],
        { allowFailure: true, readOnly: true },
      );
      if (!output.ok) throw new GitAdapterError('git_branch_list_failed', 'Scoped git for-each-ref failed.', output);
      const branches = [];
      for (const line of output.stdout.split('\n')) {
        if (!line) continue;
        const fields = line.split('\x00');
        if (fields.length < 4 || !fields[0]) continue;
        branches.push({
          name: fields[0],
          shortSha: fields[1] || '',
          isoDate: fields[2] || '',
          current: fields[3] === '*',
        });
      }
      return { branches, count: branches.length };
    },

    /**
     * BLOCK-29.5 — stash 列表（只读）。git stash list，NUL 分隔（ref/shortSha/isoDate/subject）。
     * 不含 pop/apply/clear 等写操作。
     */
    stashList() {
      const output = run(['stash', 'list', '--date=iso-strict', '--format=%gd%00%h%00%aI%00%gs'], {
        allowFailure: true,
        readOnly: true,
      });
      if (!output.ok) throw new GitAdapterError('git_stash_list_failed', 'Scoped git stash list failed.', output);
      const stashes = [];
      for (const line of output.stdout.split('\n')) {
        if (!line) continue;
        const fields = line.split('\x00');
        if (fields.length < 4 || !fields[0]) continue;
        stashes.push({ ref: fields[0], shortSha: fields[1] || '', isoDate: fields[2] || '', subject: fields[3] || '' });
      }
      return { stashes, count: stashes.length };
    },

    /**
     * BLOCK-29.5 — 标签列表（只读）。for-each-ref refs/tags，按创建时间倒序。
     */
    tagList() {
      const output = run(
        ['for-each-ref', '--sort=-creatordate', '--format=%(refname:short)%00%(objectname:short)%00%(creatordate:iso8601-strict)', 'refs/tags'],
        { allowFailure: true, readOnly: true },
      );
      if (!output.ok) throw new GitAdapterError('git_tag_list_failed', 'Scoped git for-each-ref tags failed.', output);
      const tags = [];
      for (const line of output.stdout.split('\n')) {
        if (!line) continue;
        const fields = line.split('\x00');
        if (fields.length < 3 || !fields[0]) continue;
        tags.push({ name: fields[0], shortSha: fields[1] || '', isoDate: fields[2] || '' });
      }
      return { tags, count: tags.length };
    },

    /** 显式路径暂存。整树写法在 assertSafePathspecs 层已被拒绝。 */
    stage({ paths } = {}) {
      const safe = assertSafePathspecs(paths, scope);
      const output = run(['add', '--', ...safe], { allowFailure: true });
      if (!output.ok) throw new GitAdapterError('git_stage_failed', 'Scoped git add failed.', output);
      return { staged: safe };
    },

    /**
     * 路径受限提交：只提交给定 pathspec，不会带入其他已暂存内容。
     */
    commit({ message, paths } = {}) {
      if (typeof message !== 'string' || message.trim() === '') {
        throw new GitAdapterError('commit_message_required', 'Commit message is required.');
      }
      const safe = assertSafePathspecs(paths, scope);
      this.stage({ paths: safe });
      const args = [...identityArgs(), 'commit', '--quiet', '--no-verify', '-m', message, '--only', '--', ...safe];
      const output = run(args, { allowFailure: true });
      if (!output.ok) throw new GitAdapterError('git_commit_failed', 'Scoped git commit failed.', output);
      const head = run(['rev-parse', 'HEAD'], { allowFailure: true, readOnly: true });
      return {
        commit: head.ok ? head.stdout.trim() : null,
        paths: safe,
        message,
      };
    },

    revParse(ref) {
      if (typeof ref !== 'string' || ref.trim() === '' || ref.startsWith('-')) {
        throw new GitAdapterError('ref_invalid', 'Invalid git ref.');
      }
      const output = run(['rev-parse', '--verify', '--quiet', ref], { allowFailure: true, readOnly: true });
      return output.ok ? output.stdout.trim() || null : null;
    },

    /**
     * BLOCK-41 — 取消暂存（显式 pathspec）：`git reset -q HEAD -- <paths>`。
     * unborn HEAD（仓库还没有任何提交）时 HEAD 不存在，回退 `git rm --cached`。
     * 整树写法在 assertSafePathspecs 层已被拒绝。
     */
    unstage({ paths } = {}) {
      const safe = assertSafePathspecs(paths, scope);
      const unborn = this.repositoryState().unborn;
      const args = unborn
        ? ['rm', '--cached', '--quiet', '--', ...safe]
        : ['reset', '--quiet', 'HEAD', '--', ...safe];
      const output = run(args, { allowFailure: true });
      if (!output.ok) throw new GitAdapterError('git_unstage_failed', 'Scoped git unstage failed.', output);
      return { unstaged: safe };
    },

    /**
     * BLOCK-41 — 提交整个暂存区（无 pathspec），供审阅面板手动提交框使用。
     * 与 `commit({ paths })` 的 `--only` 路径受限语义区分：这里只提交已经
     * stage 进 index 的内容，不隐式带任何工作区改动。
     */
    commitIndex({ message } = {}) {
      if (typeof message !== 'string' || message.trim() === '') {
        throw new GitAdapterError('commit_message_required', 'Commit message is required.');
      }
      const args = [...identityArgs(), 'commit', '--quiet', '--no-verify', '-m', message];
      const output = run(args, { allowFailure: true });
      if (!output.ok) throw new GitAdapterError('git_commit_failed', 'Staged-area git commit failed.', output);
      const head = run(['rev-parse', 'HEAD'], { allowFailure: true, readOnly: true });
      return { commit: head.ok ? head.stdout.trim() : null, message };
    },

    /**
     * BLOCK-41 — 切换本地分支（用户裁决：脏树阻止并提示冲突清单）。
     * - mid-operation（merge/rebase/cherry-pick/revert 进行中）直接拒绝；
     * - 仅限本地分支（listBranches refs/heads），防止误建分支或切到远程引用；
     * - 已在目标分支 → 幂等返回 switched:false；
     * - 有 tracked 未提交改动 → 拒绝（checkout_dirty_worktree），冲突清单 =
     *   本地已改路径 ∩ HEAD..target 有差异路径（无交集时列全部脏文件）；
     *   untracked 改动不阻止（git 自身会兜底拒绝覆盖性冲突）。
     */
    checkoutBranch({ name } = {}) {
      const branch = assertSafeRef(name);
      if (!branch || branch.includes('..') || branch.includes('\x00') || /\s/.test(branch)) {
        throw new GitAdapterError('branch_name_invalid', 'Invalid branch name.');
      }
      const state = this.repositoryState();
      if (state.midOperation) {
        throw new GitAdapterError(
          'checkout_mid_operation',
          'Repository is mid-operation (merge/rebase/cherry-pick/revert); resolve it before switching branches.'
        );
      }
      const heads = this.listBranches();
      if (!heads.branches.some((b) => b.name === branch)) {
        throw new GitAdapterError('branch_not_found', `Local branch '${branch}' does not exist.`);
      }
      if (heads.branches.some((b) => b.name === branch && b.current)) {
        return { branch, switched: false, reason: 'already_current' };
      }
      const status = this.repositoryStatus({ untracked: 'normal' });
      const dirtyTracked = status.entries.filter((e) => !e.untracked);
      if (dirtyTracked.length > 0) {
        let conflicts = dirtyTracked.map((e) => e.path);
        try {
          const range = run(['diff', '--no-color', '--name-only', 'HEAD', branch], { allowFailure: true, readOnly: true });
          if (range.ok) {
            const differing = new Set(range.stdout.split('\n').filter(Boolean));
            const overlap = dirtyTracked.map((e) => e.path).filter((p) => differing.has(p));
            if (overlap.length > 0) conflicts = overlap;
          }
        } catch { /* 冲突判定失败时保守列全部脏文件 */ }
        throw new GitAdapterError(
          'checkout_dirty_worktree',
          `Working tree has uncommitted changes; commit or discard them before switching to '${branch}'.`,
          { conflicts, dirtyCount: dirtyTracked.length }
        );
      }
      const output = run(['checkout', '--quiet', branch], { allowFailure: true });
      if (!output.ok) throw new GitAdapterError('git_checkout_failed', `git checkout '${branch}' failed.`, output);
      return { branch, switched: true };
    },

    /** BLOCK-41 — 远程列表（只读，`git remote -v`）。供 push/pull 入口与诊断。 */
    remoteList() {
      const output = run(['remote', '-v'], { allowFailure: true, readOnly: true });
      if (!output.ok) throw new GitAdapterError('git_remote_list_failed', 'git remote failed.', output);
      const remotes = [];
      for (const rawLine of output.stdout.split('\n')) {
        const line = rawLine.trim();
        if (!line) continue;
        const match = /^(\S+)\t(\S+)\s+\((push|fetch)\)$/.exec(line);
        if (!match) continue;
        let entry = remotes.find((r) => r.name === match[1]);
        if (!entry) {
          entry = { name: match[1] };
          remotes.push(entry);
        }
        entry[match[3] === 'push' ? 'pushUrl' : 'fetchUrl'] = match[2];
      }
      return { remotes, count: remotes.length };
    },

    /** 当前分支的推送/拉取目标：branch.<name>.remote 配置 → origin 兜底。 */
    _resolveUpstreamTarget(branchName) {
      const cfg = run(['config', '--get', `branch.${branchName}.remote`], { allowFailure: true, readOnly: true });
      return cfg.ok && cfg.stdout.trim() ? cfg.stdout.trim() : 'origin';
    },

    /**
     * BLOCK-41 — 远程同步状态（async）：fetch（离线诚实降级）→ upstream →
     * ahead/behind（rev-list --left-right --count upstream...HEAD，左 behind 右 ahead）。
     * 无 upstream / rev-list 失败 → 对应字段 null（UI 显示为不可判断，不虚报同步）。
     */
    async remoteStatus() {
      // fetch 失败（离线/无远程/无凭据）不阻断：ahead/behind 退回上次 fetch 的缓存事实
      await runAsync(['fetch', '--quiet', '--all'], { allowFailure: true, timeout: 30000 });
      const upstreamRes = await runAsync(
        ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
        { allowFailure: true, readOnly: true }
      );
      if (!upstreamRes.ok || !upstreamRes.stdout.trim()) {
        return { upstream: null, ahead: null, behind: null };
      }
      const upstream = upstreamRes.stdout.trim();
      const count = await runAsync(['rev-list', '--left-right', '--count', `${upstream}...HEAD`], {
        allowFailure: true,
        readOnly: true,
      });
      if (!count.ok) return { upstream, ahead: null, behind: null };
      const [behind, ahead] = count.stdout.trim().split(/\s+/).map((n) => Number(n) || 0);
      return { upstream, ahead, behind };
    },

    /**
     * BLOCK-41 — 推送（async，不阻塞主进程事件循环）。默认推送当前分支到
     * 其 configured remote（branch.<name>.remote → origin 兜底）；setUpstream
     * 时 `--set-upstream`。认证依赖系统 credential helper（baseEnv 已设
     * GIT_TERMINAL_PROMPT=0 + 空 askpass，无凭据时快速失败不挂起）。
     */
    async push({ remote = null, branch = null, setUpstream = false } = {}) {
      const current = this.listBranches().branches.find((b) => b.current);
      const branchName = assertSafeRef(branch || (current && current.name));
      if (!branchName || /\s/.test(branchName)) {
        throw new GitAdapterError('branch_name_invalid', 'Cannot resolve a branch to push.');
      }
      const remoteName = remote ? assertSafeRef(remote) : this._resolveUpstreamTarget(branchName);
      if (!remoteName || /\s/.test(remoteName)) {
        throw new GitAdapterError('remote_name_invalid', 'Invalid remote name.');
      }
      const args = ['push', ...(setUpstream ? ['--set-upstream', remoteName, branchName] : [remoteName, branchName])];
      const output = await runAsync(args, { timeout: 120000 });
      if (!output.ok) throw new GitAdapterError('git_push_failed', 'git push failed.', output);
      return { remote: remoteName, branch: branchName, pushed: true };
    },

    /**
     * BLOCK-41 — 拉取（async）：`git pull <remote> <branch>`（merge 语义，
     * 不带 --rebase，尊重仓库配置之外的明确预期）。冲突/认证失败诚实报错，
     * 冲突后 midOperation 状态经 repositoryState() 可见。
     */
    async pull({ remote = null, branch = null } = {}) {
      const current = this.listBranches().branches.find((b) => b.current);
      const branchName = assertSafeRef(branch || (current && current.name));
      if (!branchName || /\s/.test(branchName)) {
        throw new GitAdapterError('branch_name_invalid', 'Cannot resolve a branch to pull.');
      }
      const remoteName = remote ? assertSafeRef(remote) : this._resolveUpstreamTarget(branchName);
      if (!remoteName || /\s/.test(remoteName)) {
        throw new GitAdapterError('remote_name_invalid', 'Invalid remote name.');
      }
      const output = await runAsync(['pull', remoteName, branchName], { timeout: 120000 });
      if (!output.ok) throw new GitAdapterError('git_pull_failed', 'git pull failed.', output);
      return { remote: remoteName, branch: branchName, pulled: true, output: output.stdout };
    },

    /** Distinguish an absent ref from an unreadable repository. */
    readRefExact(ref) {
      if (typeof ref !== 'string' || ref.trim() === '' || ref.startsWith('-')) {
        throw new GitAdapterError('ref_invalid', 'Invalid git ref.');
      }
      const output = run(['rev-parse', '--verify', '--quiet', ref], {
        allowFailure: true,
        readOnly: true,
      });
      if (output.ok) {
        const oid = output.stdout.trim();
        if (/^[a-f0-9]{40}$/.test(oid)) return oid;
        throw new GitAdapterError('git_ref_read_failed', 'Git returned an invalid ref object id.', output);
      }
      if (output.status === 1) return null;
      throw new GitAdapterError('git_ref_read_failed', 'Git ref state could not be read exactly.', output);
    },

    /**
     * 批量解析多个 ref/commit：一次子进程替代 N 次 revParse。
     *
     * `inspectRevisionIntegrity` 过去按 revision 逐个 revParse，实测约
     * 20ms/revision（每 revision 两次 fork × ~10ms），于是 workspace/status
     * 的开销随项目历史线性增长，约 10 个 revision 就会撞破 250ms 事件循环预算。
     *
     * 用 `cat-file --batch-check` 一次读完 stdin 上的全部对象。返回 Map，
     * 语义与 revParse 对齐：解析不到的键映射为 null。
     */
    resolveManyRefs(refs) {
      const wanted = [...new Set((refs || []).filter(
        (ref) => typeof ref === 'string' && ref.trim() !== '' && !ref.startsWith('-'),
      ))];
      const resolved = new Map(wanted.map((ref) => [ref, null]));
      if (wanted.length === 0) return resolved;
      const output = run(['cat-file', '--batch-check=%(objectname) %(rest)'], {
        allowFailure: true,
        readOnly: true,
        // %(rest) 回显该行 ref 之后的内容，用它把结果对回请求的键，
        // 避免依赖行序或对 peel 后的名字做猜测。
        input: `${wanted.map((ref) => `${ref} ${ref}`).join('\n')}\n`,
      });
      if (!output.ok) return resolved;
      for (const line of output.stdout.split('\n')) {
        if (!line.trim()) continue;
        // 命中: "<sha> <原始键>"；未命中: "<原始键> missing"
        const hit = /^([a-f0-9]{40,64})\s+(.+)$/.exec(line);
        if (hit && resolved.has(hit[2])) resolved.set(hit[2], hit[1]);
      }
      return resolved;
    },

    /**
     * 一次列出某前缀下的全部 ref。
     *
     * 替代「对每个 current revision 各 revParse 一次」的写法。
     */
    listRefs(prefix) {
      if (typeof prefix !== 'string' || prefix.trim() === '' || prefix.startsWith('-')) {
        throw new GitAdapterError('ref_invalid', 'Invalid git ref prefix.');
      }
      const output = run(['for-each-ref', '--format=%(refname) %(objectname)', prefix], {
        allowFailure: true,
        readOnly: true,
      });
      const refs = new Map();
      if (!output.ok) return refs;
      for (const line of output.stdout.split('\n')) {
        const match = /^(\S+)\s+([a-f0-9]{40,64})$/.exec(line.trim());
        if (match) refs.set(match[1], match[2]);
      }
      return refs;
    },

    /** Atomically apply one exact BioF3 ref compare-and-swap cohort. */
    updateRefsCas({ updates } = {}) {
      if (!Array.isArray(updates) || updates.length === 0) {
        throw new GitAdapterError('ref_transaction_invalid', 'At least one ref update is required.');
      }
      const normalized = updates.map((entry) => ({
        ref: String(entry?.ref || ''),
        expectedOld: String(entry?.expectedOld || ''),
        newOid: String(entry?.newOid || ''),
      }));
      if (new Set(normalized.map((entry) => entry.ref)).size !== normalized.length
          || normalized.some((entry) =>
            !/^refs\/heads\/biof3\/[A-Za-z0-9][A-Za-z0-9._\-/]*$/.test(entry.ref)
            || !/^[a-f0-9]{40}$/.test(entry.expectedOld)
            || !/^[a-f0-9]{40}$/.test(entry.newOid)
            || entry.expectedOld === entry.newOid)) {
        throw new GitAdapterError(
          'ref_transaction_invalid',
          'Every ref transaction entry must be one unique exact BioF3 compare-and-swap.'
        );
      }
      const zero = '0'.repeat(40);
      const commands = ['start'];
      for (const entry of normalized) {
        if (entry.newOid === zero) commands.push(`delete ${entry.ref} ${entry.expectedOld}`);
        else if (entry.expectedOld === zero) commands.push(`create ${entry.ref} ${entry.newOid}`);
        else commands.push(`update ${entry.ref} ${entry.newOid} ${entry.expectedOld}`);
      }
      commands.push('prepare', 'commit');
      const result = run(['update-ref', '--stdin'], {
        allowFailure: true,
        input: `${commands.join('\n')}\n`,
      });
      if (!result.ok) {
        throw new GitAdapterError(
          'git_ref_transaction_conflict',
          'Git refs changed concurrently or could not be committed atomically.',
          result,
        );
      }
      return { updated: normalized.length, updates: normalized };
    },

    /**
     * 以 compare-and-swap 更新一个 BioF3 refs/heads 引用。
     * 调用方必须给出预期旧值；不存在的 ref 使用 40 个 0。
     */
    updateRefCas({ ref, newCommit, expectedOld } = {}) {
      if (typeof ref !== 'string' || !/^refs\/heads\/biof3\/[A-Za-z0-9][A-Za-z0-9._\-/]*$/.test(ref)) {
        throw new GitAdapterError('ref_invalid', 'A refs/heads/biof3/* destination is required.');
      }
      if (!/^[a-f0-9]{40}$/.test(String(newCommit || ''))) {
        throw new GitAdapterError('new_commit_invalid', 'newCommit must be a full git object id.');
      }
      if (!/^[a-f0-9]{40}$/.test(String(expectedOld || ''))) {
        throw new GitAdapterError('expected_old_invalid', 'expectedOld must be a full git object id or forty zeroes.');
      }
      const updated = run(['update-ref', ref, newCommit, expectedOld], { allowFailure: true });
      if (!updated.ok) throw new GitAdapterError('git_ref_conflict', 'Git ref changed concurrently.', updated);
      return { ref, commit: newCommit, previous: expectedOld };
    },

    deleteRefCas({ ref, expectedOld } = {}) {
      if (typeof ref !== 'string' || !/^refs\/heads\/biof3\/[A-Za-z0-9][A-Za-z0-9._\-/]*$/.test(ref)) {
        throw new GitAdapterError('ref_invalid', 'A refs/heads/biof3/* destination is required.');
      }
      if (!/^[a-f0-9]{40}$/.test(String(expectedOld || ''))) {
        throw new GitAdapterError('expected_old_invalid', 'expectedOld must be a full git object id.');
      }
      const deleted = run(['update-ref', '-d', ref, expectedOld], { allowFailure: true });
      if (!deleted.ok) throw new GitAdapterError('git_ref_conflict', 'Git ref changed concurrently.', deleted);
      return { ref, deleted: true, previous: expectedOld };
    },

    /** 读取某个提交中的文件内容，用于版本恢复与前后比较。 */
    showFile({ ref, filePath } = {}) {
      if (typeof ref !== 'string' || ref.trim() === '' || ref.startsWith('-')) {
        throw new GitAdapterError('ref_invalid', 'Invalid git ref.');
      }
      const [safe] = assertSafePathspecs([filePath], scope);
      const output = run(['show', `${ref}:${safe}`], { allowFailure: true, readOnly: true });
      if (!output.ok) return null;
      return output.stdout;
    },

    /** 创建隔离分支。不切换当前 HEAD 的调用方需自行决定。 */
    createBranch({ name, startPoint = 'HEAD' } = {}) {
      if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._\-/]*$/.test(name)) {
        throw new GitAdapterError('branch_name_invalid', 'Invalid branch name.');
      }
      const output = run(['branch', name, startPoint], { allowFailure: true });
      if (!output.ok) throw new GitAdapterError('git_branch_failed', 'Branch creation failed.', output);
      return { branch: name, startPoint };
    },

    /**
     * 从内存文件构造隔离 commit，不 checkout、不改写工作区。
     * 临时 index + Git plumbing 只更新指定 ref，并以 expectedOld 做 CAS。
     */
    commitVirtualFiles({ parentCommit = null, ref, expectedOld = null, message, files } = {}) {
      if (parentCommit && !/^[a-f0-9]{7,40}$/.test(parentCommit)) {
        throw new GitAdapterError('parent_commit_invalid', 'parentCommit must be a git object id.');
      }
      if (typeof ref !== 'string' || !/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._\-/]*$/.test(ref)) {
        throw new GitAdapterError('ref_invalid', 'A refs/heads/* destination is required.');
      }
      if (typeof message !== 'string' || message.trim() === '') {
        throw new GitAdapterError('commit_message_required', 'Commit message is required.');
      }
      if (!Array.isArray(files) || files.length === 0) {
        throw new GitAdapterError('virtual_files_required', 'At least one virtual file is required.');
      }
      const safePaths = assertSafePathspecs(files.map((file) => file && file.path), scope);
      if (new Set(safePaths).size !== files.length) {
        throw new GitAdapterError('virtual_file_duplicate', 'Virtual file paths must be unique.');
      }
      const indexPath = path.join(resolvedGitDir, `biof3-index-${randomUUID()}`);
      const isolatedEnv = { GIT_INDEX_FILE: indexPath };
      try {
        const readTree = parentCommit
          ? run(['read-tree', parentCommit], { allowFailure: true, env: isolatedEnv })
          : run(['read-tree', '--empty'], { allowFailure: true, env: isolatedEnv });
        if (!readTree.ok) throw new GitAdapterError('git_read_tree_failed', 'Cannot initialize isolated Git index.', readTree);

        for (let index = 0; index < files.length; index += 1) {
          const content = files[index].content;
          if (typeof content !== 'string' && !Buffer.isBuffer(content)) {
            throw new GitAdapterError('virtual_file_content_invalid', `Virtual file content is invalid: ${safePaths[index]}`);
          }
          let blob = null;
          let attempts = 0;
          while (attempts < HASH_OBJECT_MAX_ATTEMPTS) {
            attempts += 1;
            blob = run(['hash-object', '-w', '--stdin'], {
              allowFailure: true,
              env: isolatedEnv,
              input: content,
              timeout: HASH_OBJECT_TIMEOUT_MS,
            });
            if (blob.ok && /^[a-f0-9]{40}$/.test(blob.stdout.trim())) break;
            const transientInvocationFailure = blob.status === null && (
              ['EAGAIN', 'EINTR', 'ETIMEDOUT'].includes(blob.systemCode)
            );
            if (!transientInvocationFailure) break;
          }
          if (!blob.ok || !/^[a-f0-9]{40}$/.test(blob.stdout.trim())) {
            throw new GitAdapterError('git_hash_object_failed', 'Cannot write isolated Git blob.', {
              ...blob,
              attempts,
            });
          }
          const update = run(
            ['update-index', '--add', '--cacheinfo', '100644', blob.stdout.trim(), safePaths[index]],
            { allowFailure: true, env: isolatedEnv }
          );
          if (!update.ok) throw new GitAdapterError('git_update_index_failed', 'Cannot update isolated Git index.', update);
        }

        const tree = run(['write-tree'], { allowFailure: true, env: isolatedEnv });
        if (!tree.ok || !/^[a-f0-9]{40}$/.test(tree.stdout.trim())) {
          throw new GitAdapterError('git_write_tree_failed', 'Cannot write isolated Git tree.', tree);
        }
        const commitArgs = [...identityArgs(), 'commit-tree', tree.stdout.trim()];
        if (parentCommit) commitArgs.push('-p', parentCommit);
        commitArgs.push('-m', message);
        const commit = run(commitArgs, { allowFailure: true, env: isolatedEnv });
        if (!commit.ok || !/^[a-f0-9]{40}$/.test(commit.stdout.trim())) {
          throw new GitAdapterError('git_commit_tree_failed', 'Cannot create isolated Git commit.', commit);
        }
        const existingRef = this.revParse(ref);
        const old = expectedOld || existingRef || '0'.repeat(40);
        const updateRef = run(['update-ref', ref, commit.stdout.trim(), old], { allowFailure: true });
        if (!updateRef.ok) {
          throw new GitAdapterError('git_ref_conflict', 'Isolation ref changed concurrently.', updateRef);
        }
        return {
          commit: commit.stdout.trim(),
          tree: tree.stdout.trim(),
          ref,
          parentCommit,
          paths: safePaths,
        };
      } finally {
        try { fs.unlinkSync(indexPath); } catch { /* temporary index may not exist */ }
        try { fs.unlinkSync(`${indexPath}.lock`); } catch { /* best effort */ }
      }
    },

    applyPatch({ patch, dryRun = false } = {}) {
      if (typeof patch !== 'string' || patch.length === 0) {
        throw new GitAdapterError('patch_required', 'patch text is required.');
      }
      const args = ['apply'];
      if (dryRun) args.push('--check');
      args.push('--whitespace=nowarn');
      const result = run(args, {
        allowFailure: true,
        input: patch,
      });
      if (!result.ok) {
        throw new GitAdapterError(
          'git_apply_failed',
          'git apply rejected the patch.',
          { stderr: result.stderr, code: result.code, dryRun }
        );
      }
      return { ok: true, dryRun };
    },

    revertPaths({ paths } = {}) {
      const safe = assertSafePathspecs(paths, scope);
      if (safe.length === 0) {
        throw new GitAdapterError('paths_required', 'paths is required and must not be empty.');
      }
      // UI-180 实机验收发现缺陷：untracked 文件不在 HEAD，`git checkout HEAD -- <paths>`
      // 以 "pathspec did not match any file(s) known to git" 整体失败 —— 只要状态列表里
      // 有任一未跟踪文件，「全部还原」就恒败。先按 tracked / untracked 分区：
      // tracked 走 checkout HEAD 还原；untracked 直接删除文件（与 BLOCK-20 discard-file
      // 的 untracked 语义一致 —— UI 确认文案即承诺「未跟踪文件将被删除」）。
      const ls = run(['ls-files', '-z', '--', ...safe], { allowFailure: true, readOnly: true });
      const trackedSet = new Set(ls.ok ? ls.stdout.split('\0').filter(Boolean) : []);
      const tracked = safe.filter((p) => trackedSet.has(p));
      const untracked = safe.filter((p) => !trackedSet.has(p));
      if (tracked.length > 0) {
        const result = run(['checkout', 'HEAD', '--', ...tracked], { allowFailure: true });
        if (!result.ok) {
          throw new GitAdapterError(
            'git_checkout_failed',
            'git checkout HEAD failed for the requested paths.',
            { stderr: result.stderr, code: result.code, paths: tracked }
          );
        }
      }
      for (const rel of untracked) {
        const abs = pathModule.join(resolvedWorkTree, rel);
        try {
          if (fs.existsSync(abs)) fs.rmSync(abs, { force: true });
        } catch (e) {
          throw new GitAdapterError(
            'untracked_delete_failed',
            `failed to delete untracked path ${rel}.`,
            { code: 'fs_error' }
          );
        }
      }
      return { ok: true, reverted: tracked, deletedUntracked: untracked };
    },

    listTrackedFiles({ paths } = {}) {
      const safe = assertSafePathspecs(paths, scope);
      const output = run(['ls-files', '-z', '--', ...safe], { allowFailure: true, readOnly: true });
      if (!output.ok) throw new GitAdapterError('git_ls_files_failed', 'Scoped ls-files failed.', output);
      return output.stdout.split('\0').filter(Boolean);
    },

    // ============================================================
    // BLOCK-20 — Code Review Panel 新增方法
    // 列出/读取/拆分对比/单文件还原/单 hunk inverse 拒绝。
    // 设计：所有写操作走 assertSafePathspecs 安全门 + 只针对 working tree
    // （不动 index、不动 HEAD），与 BLOCK-16 applyPatch/revertPaths 同一安全边界。
    // ============================================================

    /**
     * BLOCK-20 — 列出 working tree 中被修改/新增的文件。
     * 等价 `git status --porcelain=v1 -z --untracked-files=all`。
     * @param {{ includeUntracked?: boolean }} [options]
     * @returns {{ ok: true, files: Array<{ path: string, status: string, indexStatus: string, workTreeStatus: string }> }}
     */
    listModified({ includeUntracked = true } = {}) {
      const args = ['status', '--porcelain=v1', '-z'];
      if (includeUntracked) args.push('--untracked-files=all');
      const output = run(args, { allowFailure: true, readOnly: true });
      if (!output.ok) {
        throw new GitAdapterError('git_status_failed', 'git status failed.', output);
      }
      const files = [];
      const entries = output.stdout.split('\0');
      for (let i = 0; i < entries.length; i++) {
        const raw = entries[i];
        if (!raw) continue;
        // porcelain v1：XY<space>path，untracked 时 XY="??"
        const code = raw.slice(0, 2);
        const path = raw.slice(3);
        if (!path) continue;
        files.push({
          path,
          status: code.trim() || '??',
          indexStatus: code[0] === '?' ? '?' : code[0],
          workTreeStatus: code[1] === '?' ? '?' : code[1],
        });
        // rename 模式下 path 后还有 \0 + 新文件名，跳过它
        if (code[0] === 'R' || code[1] === 'R') {
          i += 1; // 跳过第二个 NUL 段（rename 目标路径）
        }
      }
      return { ok: true, files };
    },

    /**
     * BLOCK-20 — 读取 HEAD 中某文件的内容（split view 左栏）。
     * 新增文件（未跟踪）返回 null（与 BLOCK-16 fileContent 一致语义）。
     * @param {{ path: string }} args
     * @returns {{ ok: true, content: string | null, mtime: string | null }}
     */
    fileHeadContent({ path: filePath } = {}) {
      const safe = assertSafePathspecs([filePath], scope);
      const target = safe[0];
      const show = run(['show', `HEAD:${target}`], { allowFailure: true, readOnly: true });
      if (!show.ok) {
        // 新增文件 → HEAD 不存在，返回 null（与 BLOCK-16 fileContent 一致）
        if (show.stderr && /exists on disk, but not in/.test(show.stderr)) {
          return { ok: true, content: null, mtime: null };
        }
        throw new GitAdapterError('git_show_failed', `git show HEAD:${target} failed.`, show);
      }
      return { ok: true, content: show.stdout, mtime: null };
    },

    /**
     * BLOCK-20 — 读取 working tree 中某文件的当前内容（split view 右栏）。
     * @param {{ path: string }} args
     * @returns {{ ok: true, content: string }}
     */
    fileWorkTreeContent({ path: filePath } = {}) {
      const safe = assertSafePathspecs([filePath], scope);
      const fullPath = pathModule.join(resolvedWorkTree, safe[0]);
      if (!fs.existsSync(fullPath)) {
        return { ok: true, content: '' };
      }
      return { ok: true, content: fs.readFileSync(fullPath, 'utf-8') };
    },

    /**
     * BLOCK-20 — 对单个文件生成 unified diff（HEAD vs working tree）。
     * 输出可直接喂给 parseUnifiedHunks。
     * @param {{ path: string, context?: number }} args
     * @returns {{ ok: true, diff: string, headContent: string | null, workTreeContent: string }}
     */
    splitSideDiff({ path: filePath, context = 3 } = {}) {
      const safe = assertSafePathspecs([filePath], scope);
      const target = safe[0];
      const headShow = run(['show', `HEAD:${target}`], { allowFailure: true, readOnly: true });
      const headContent = headShow.ok ? headShow.stdout : null;
      let workTreeContent = '';
      const fullPath = pathModule.join(resolvedWorkTree, target);
      if (fs.existsSync(fullPath)) {
        workTreeContent = fs.readFileSync(fullPath, 'utf-8');
      }
      // 走 `git diff --no-color --no-ext-diff -- <path>` 让 git 生成标准 unified diff。
      const diffResult = run(
        ['diff', '--no-color', '--no-ext-diff', `-U${context}`, '--', target],
        { allowFailure: true, readOnly: true }
      );
      // 全新文件（untracked）→ git diff 不输出；保留 headContent=null / workTreeContent 提示前端。
      const diffText = diffResult.ok ? diffResult.stdout : '';
      return { ok: true, diff: diffText, headContent, workTreeContent };
    },

    /**
     * BLOCK-20 — 单文件回滚到 HEAD（仅 working tree，不动 index）。
     * 与 revertPaths({ paths: [path] }) 等价但单文件语义更清晰。
     * @param {{ path: string }} args
     */
    revertFile({ path } = {}) {
      const safe = assertSafePathspecs([path], scope);
      const target = safe[0];
      const result = run(['checkout', 'HEAD', '--', target], { allowFailure: true });
      if (!result.ok) {
        throw new GitAdapterError(
          'git_checkout_failed',
          `git checkout HEAD -- ${target} failed.`,
          result
        );
      }
      return { ok: true, reverted: [target] };
    },

    /**
     * BLOCK-29.2 — 放弃单个文件的工作区改动（VS Code「Discard Changes」语义）。
     * tracked 文件 → checkout HEAD 还原；untracked 文件 → 直接删除
     * （与 VS Code 行为一致）。路径经 assertSafePathspecs 且限制在 workTree 内。
     */
    discardFile({ path } = {}) {
      const safe = assertSafePathspecs([path], scope);
      const target = safe[0];
      const tracked = run(['ls-files', '--', target], { allowFailure: true, readOnly: true });
      const isTracked = tracked.ok && tracked.stdout.trim() !== '';
      if (!isTracked) {
        const abs = pathModule.resolve(resolvedWorkTree, target);
        if (abs !== resolvedWorkTree && !abs.startsWith(resolvedWorkTree + pathModule.sep)) {
          throw new GitAdapterError('path_escape', 'path escapes work tree.');
        }
        if (fs.existsSync(abs)) fs.unlinkSync(abs);
        return { ok: true, discarded: [target], deleted: true };
      }
      const result = run(['checkout', 'HEAD', '--', target], { allowFailure: true });
      if (!result.ok) {
        throw new GitAdapterError('git_checkout_failed', `git checkout HEAD -- ${target} failed.`, result);
      }
      return { ok: true, discarded: [target], deleted: false };
    },

    /**
     * BLOCK-29.2 — 撤销最近一次提交（mixed reset HEAD~1）：提交内容回到
     * 工作区未暂存状态，可重新审阅。根提交（无父）不可撤销，显式报错。
     */
    undoLastCommit() {
      const head = run(['rev-parse', '--verify', 'HEAD'], { allowFailure: true, readOnly: true });
      if (!head.ok) {
        throw new GitAdapterError('no_commits', 'Repository has no commits to undo.');
      }
      const parent = run(['rev-parse', '--verify', 'HEAD~1'], { allowFailure: true, readOnly: true });
      if (!parent.ok) {
        throw new GitAdapterError('root_commit', 'The root commit cannot be undone.');
      }
      const output = run(['reset', '--mixed', 'HEAD~1'], { allowFailure: true });
      if (!output.ok) throw new GitAdapterError('git_reset_failed', 'git reset HEAD~1 failed.', output);
      return { ok: true, undoneCommit: head.stdout.trim() };
    },

    /**
     * BLOCK-20 — per-hunk reject：接受一个 unified diff patch（正向 hunk），
     * 把它 inverse 后 apply 回 working tree。
     * 与 applyPatch 的差别：applyPatch 期望传"反向 patch"（要回滚的那段），
     * applyInverseHunk 期望传"正向 patch"（当前 working tree 跟 HEAD 的差异那段），
     * 函数内部 invert + apply 更友好给前端。
     * @param {{ patch: string }} args  patch 是标准 unified diff 单 hunk（带 ---/+++ 与 @@ header）
     */
    applyInverseHunk({ patch } = {}) {
      if (typeof patch !== 'string' || patch.length === 0) {
        throw new GitAdapterError('patch_required', 'patch text is required.');
      }
      const inverse = invertUnifiedDiff(patch);
      const result = run(['apply', '--whitespace=nowarn'], {
        allowFailure: true,
        input: inverse,
      });
      if (!result.ok) {
        throw new GitAdapterError(
          'git_apply_inverse_failed',
          'git apply rejected the inverse patch.',
          { stderr: result.stderr, code: result.code }
        );
      }
      return { ok: true };
    },
  };
}

/**
 * BLOCK-20 — 把 unified diff 的 + → -、- → +，得到反向 diff。
 * context 行、空行、---/+++ 与 @@ header 保持原样。
 * 必须是单 hunk 输入；多 hunk 在前端循环调用即可。
 */

module.exports = {
  GIT_ADAPTER_VERSION,
  MINIMUM_GIT_VERSION,
  FORBIDDEN_PATHSPECS,
  GitAdapterError,
  detectGitRuntime,
  resetGitRuntimeCache,
  assertSafePathspecs,
  redactGitDiagnostic,
  parseGitVersion,
  createGitAdapter,
};

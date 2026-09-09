'use strict';

/**
 * Project-scoped foundation tools for the Agent Harness.
 *
 * These tools operate on the existing project workspace. They do not create a
 * second analysis executor, job table, or artifact truth system.
 */

const crypto = require('crypto');
const fsp = require('fs/promises');
const path = require('path');
const { promisify } = require('util');
const { execFile, spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');
const { assertProjectG0Compatible } = require('../../shared-backend/g0-baseline');
const execFileAsync = promisify(execFile);

const DEFAULT_MAX_ENTRIES = 200;
const DEFAULT_MAX_READ_LINES = 240;
const MAX_READ_LINES = 1000;
const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_WRITE_BYTES = 1024 * 1024;

const SKIP_DIRECTORIES = new Set([
  '.git',
  '.svn',
  '.hg',
  'node_modules',
  'target',
  'dist',
  'build',
  '__pycache__',
  '.cache',
]);

const SENSITIVE_SEGMENTS = new Set([
  '.git',
  '.ssh',
  '.env',
  '.env.local',
  '.env.production',
  '.biof3-secrets',
  '.netrc',
  '.npmrc',
  'credentials',
  'id_rsa',
  'id_ed25519',
  'keychain',
]);

const MAX_COMMAND_BYTES = 64 * 1024;
const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_COMMAND_TIMEOUT_MS = 120000;
const MAX_COMMAND_TIMEOUT_MS = 30 * 60 * 1000;

// BLOCK-54 P1 — workspace_exec yield 中间档（对齐 codex yield_time_ms）：
// 提供了 yield_ms 才启用（不传保持既有同步语义，向后兼容）；等到产出或超时即
// 交还控制权，超时未完成的命令挂入既有后台进程表（与 exec_background 共用
// process_status/process_stop，0 重复设施）。输出另受 token 级预算截断。
const DEFAULT_YIELD_MS = 10000;
const MIN_YIELD_MS = 250;
const MAX_YIELD_MS = 30000;
const DEFAULT_MAX_OUTPUT_TOKENS = 10000;
const MAX_OUTPUT_TOKENS_CAP = 50000;

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function clampInteger(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function errorResult(error, message, extra = {}) {
  return { ok: false, error, message, ...extra };
}

// BLOCK-33 P3 — spawn 执行命令：stdout/stderr 增量通过 onOutput({ stream, text })
// 外抛供 SSE 流式转发，同时保留 execFile 的超时/maxBuffer 截断语义。
// 返回统一形状：{ ok, code, signal, timedOut, stdout, stderr, truncated, errorMessage }
function spawnCommand(invocation, { cwd, timeout, maxBuffer, onOutput }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(invocation.executable, invocation.args, {
        cwd,
        shell: false,
        windowsHide: true,
      });
    } catch (error) {
      resolve({
        ok: false, code: 1, signal: null, timedOut: false,
        stdout: '', stderr: error.message, truncated: false, errorMessage: error.message,
      });
      return;
    }

    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');
    let stdoutBuf = Buffer.alloc(0);
    let stderrBuf = Buffer.alloc(0);
    let truncated = false;
    let timedOut = false;
    let settled = false;
    let killTimer = null;
    let forceKillTimer = null;

    const clearTimers = () => {
      if (killTimer) clearTimeout(killTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
    };

    const killChild = () => {
      try { child.kill('SIGTERM'); } catch {}
      forceKillTimer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
      }, 5000);
    };

    // 返回 false 表示该流已超限，调用方应终止进程（对齐 execFile maxBuffer 行为）
    const collect = (chunk, isStdout) => {
      const target = isStdout ? stdoutBuf : stderrBuf;
      if (target.length >= maxBuffer) {
        truncated = true;
        return false;
      }
      const room = maxBuffer - target.length;
      const sliced = chunk.length > room ? chunk.subarray(0, room) : chunk;
      if (isStdout) stdoutBuf = Buffer.concat([stdoutBuf, sliced]);
      else stderrBuf = Buffer.concat([stderrBuf, sliced]);
      if (chunk.length > room) {
        truncated = true;
        return false;
      }
      return true;
    };

    const attach = (stream, isStdout, decoder) => {
      if (!stream) return;
      stream.on('data', (chunk) => {
        const text = decoder.write(chunk);
        if (onOutput && text) {
          try { onOutput({ stream: isStdout ? 'stdout' : 'stderr', text }); } catch {}
        }
        if (!collect(chunk, isStdout)) killChild();
      });
    };
    attach(child.stdout, true, stdoutDecoder);
    attach(child.stderr, false, stderrDecoder);

    if (Number.isFinite(timeout) && timeout > 0) {
      killTimer = setTimeout(() => {
        timedOut = true;
        killChild();
      }, timeout);
    }

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimers();
      resolve({
        ok: false, code: 1, signal: null, timedOut,
        stdout: stdoutBuf.toString('utf8'),
        stderr: (stderrBuf.toString('utf8') + (stderrBuf.length ? '\n' : '') + error.message),
        truncated, errorMessage: error.message,
      });
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimers();
      resolve({
        ok: code === 0,
        code,
        signal: signal || null,
        timedOut,
        stdout: stdoutBuf.toString('utf8') + stdoutDecoder.end(),
        stderr: stderrBuf.toString('utf8') + stderrDecoder.end(),
        truncated,
        errorMessage: null,
      });
    });
  });
}

function normalizeRelativePath(value) {
  const raw = String(value == null ? '.' : value).trim();
  if (!raw || raw === '.') return '.';
  if (path.isAbsolute(raw)) {
    throw Object.assign(new Error('只接受项目工作区内的相对路径'), { code: 'absolute_path_not_allowed' });
  }
  return raw.replace(/\\/g, '/').replace(/^\.\//, '');
}

function containsSensitiveSegment(relativePath) {
  return String(relativePath)
    .split(/[\\/]+/)
    .filter(Boolean)
    .some((segment) => SENSITIVE_SEGMENTS.has(segment.toLowerCase()));
}

function isContained(root, target) {
  const normalizedRoot = path.resolve(root);
  const normalizedTarget = path.resolve(target);
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(normalizedRoot + path.sep);
}

async function nearestExistingAncestor(target) {
  let current = target;
  while (true) {
    try {
      await fsp.lstat(current);
      return current;
    } catch (error) {
      if (error && error.code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) return current;
      current = parent;
    }
  }
}

async function resolveWorkspaceTarget(workspaceRoot, relativePath, options = {}) {
  const normalizedRelative = normalizeRelativePath(relativePath);
  if (containsSensitiveSegment(normalizedRelative)) {
    throw Object.assign(new Error('该路径属于敏感文件或元数据目录'), { code: 'sensitive_path' });
  }

  const root = path.resolve(workspaceRoot);
  const target = path.resolve(root, normalizedRelative);
  if (!isContained(root, target)) {
    throw Object.assign(new Error('路径逃逸出当前项目工作区'), { code: 'path_escape' });
  }

  if (options.createRoot !== false) {
    await fsp.mkdir(root, { recursive: true });
  }
  let realRoot;
  try {
    realRoot = await fsp.realpath(root);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw Object.assign(new Error('项目工作区尚不存在，无法执行只读预演'), {
        code: 'workspace_unavailable',
      });
    }
    throw error;
  }
  const existingAncestor = await nearestExistingAncestor(target);
  const realAncestor = await fsp.realpath(existingAncestor);
  if (!isContained(realRoot, realAncestor)) {
    throw Object.assign(new Error('符号链接指向项目工作区外部'), { code: 'symlink_escape' });
  }

  if (options.rejectSymlink !== false) {
    try {
      const stat = await fsp.lstat(target);
      if (stat.isSymbolicLink()) {
        throw Object.assign(new Error('不允许直接操作符号链接'), { code: 'symlink_not_allowed' });
      }
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
    }
  }

  return { root: realRoot, target, relativePath: normalizedRelative };
}

function authorizeProject(project, userId, db) {
  if (!userId) {
    throw Object.assign(new Error('需要登录后才能访问项目工作区'), { code: 'unauthorized' });
  }
  if (project.status === 'archived') {
    throw Object.assign(new Error('项目已归档'), { code: 'project_archived' });
  }
  if (project.user_id && project.user_id !== userId) {
    let isAdmin = false;
    try {
      isAdmin = typeof db.getUserById === 'function' && db.getUserById(userId)?.role === 'admin';
    } catch {}
    if (!isAdmin) {
      throw Object.assign(new Error('无权访问该项目工作区'), { code: 'permission_denied' });
    }
  }
}

// ===== BLOCK-33 P4 — 后台进程（workspace_exec_background / process_status / process_stop） =====
// 进程表为内存态、per conversation（应用重启自然失效——诚实边界，日志文件仍在工作区内可手工查看）。
const BACKGROUND_LOG_DIR = '.biof3-agent-tmp';
const BACKGROUND_MAX_RUNNING_PER_SESSION = 16;
const BACKGROUND_MAX_RECORDS = 256;
const BACKGROUND_LOG_TAIL_DEFAULT = 4096;
const BACKGROUND_LOG_TAIL_MAX = 65536;
const PROCESS_STOP_GRACE_MS = 3000;

const backgroundProcesses = new Map();

function backgroundSessionKey(ctx = {}) {
  if (ctx.conversationId) return `conv:${ctx.conversationId}`;
  return `project:${ctx.projectId || 'unknown'}:${ctx.userId || 'unknown'}`;
}

async function readLogTail(logPath, bytes) {
  const handle = await fsp.open(logPath, 'r');
  try {
    const stat = await handle.stat();
    const size = Math.min(stat.size, bytes);
    if (size <= 0) return { text: '', truncated: false, size: stat.size };
    const buffer = Buffer.alloc(size);
    await handle.read(buffer, 0, size, stat.size - size);
    return {
      text: buffer.toString('utf8'),
      truncated: stat.size > bytes,
      size: stat.size,
    };
  } finally {
    await handle.close();
  }
}

function killBackgroundProcess(record, signal) {
  const isWindows = process.platform === 'win32';
  try {
    if (isWindows) {
      // Windows：taskkill /T 结束整棵进程树
      spawn('taskkill', ['/pid', String(record.pid), '/T', '/F'], { windowsHide: true }).unref();
      return;
    }
    if (record.detachedGroup) {
      // posix：detached 使子进程成为进程组长，负 pid 可杀整组（shell 及其后代）
      try {
        process.kill(-record.pid, signal);
        return;
      } catch {
        // 进程组已消失，退回直接杀
      }
    }
    record.child.kill(signal);
  } catch {
    // 进程已退出：close 回调负责收敛状态
  }
}

function terminateBackgroundProcess(record) {
  if (record.status !== 'running') return;
  killBackgroundProcess(record, 'SIGTERM');
  setTimeout(() => {
    if (record.status !== 'running') return;
    killBackgroundProcess(record, 'SIGKILL');
  }, PROCESS_STOP_GRACE_MS);
}

function pruneBackgroundRecords() {
  if (backgroundProcesses.size <= BACKGROUND_MAX_RECORDS) return;
  const removable = [...backgroundProcesses.values()]
    .filter((record) => record.status !== 'running')
    .sort((a, b) => a.startedAt - b.startedAt);
  let overflow = backgroundProcesses.size - BACKGROUND_MAX_RECORDS;
  for (const record of removable) {
    if (overflow <= 0) break;
    backgroundProcesses.delete(record.id);
    overflow -= 1;
  }
}

function createWorkspaceTools(options = {}) {
  const dbProvider = options.dbProvider || (() => require('../db'));
  const targetLocks = new Map();

  async function withTargetLock(target, callback) {
    const previous = targetLocks.get(target) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
      release = resolve;
    });
    targetLocks.set(target, current);
    await previous.catch(() => {});
    try {
      return await callback();
    } finally {
      release();
      if (targetLocks.get(target) === current) targetLocks.delete(target);
    }
  }

  async function getWorkspace(ctx, options = {}) {
    const projectId = String((ctx && ctx.projectId) || '').trim();
    if (!projectId) {
      throw Object.assign(new Error('基础文件工具只能在有效项目中使用'), { code: 'project_required' });
    }
    const db = dbProvider();
    const createRoot = options.createRoot !== false;
    let project = !createRoot && typeof db.getDatabase === 'function'
      ? db.getDatabase().prepare('SELECT * FROM projects WHERE id = ?').get(projectId) || null
      : db.getProject(projectId);
    if (!project) {
      throw Object.assign(new Error('项目不存在'), { code: 'project_not_found' });
    }
    authorizeProject(project, ctx && ctx.userId, db);
    if (options.requireCompatible === true) {
      if (!project.g0_baseline && typeof db.getDatabase === 'function') {
        try {
          const baseline = db.getDatabase()
            .prepare('SELECT * FROM project_g0_baselines WHERE project_id = ?')
            .get(projectId);
          if (baseline) project = { ...project, g0_baseline: baseline };
        } catch {}
      }
      assertProjectG0Compatible(project);
    }
    if (!project.workspace_path || !path.isAbsolute(project.workspace_path)) {
      throw Object.assign(new Error('项目工作区路径未配置或不是绝对路径'), { code: 'workspace_unavailable' });
    }
    if (createRoot) {
      await fsp.mkdir(project.workspace_path, { recursive: true });
    }
    let root;
    try {
      root = await fsp.realpath(project.workspace_path);
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        throw Object.assign(new Error('项目工作区尚不存在，无法执行只读预演'), {
          code: 'workspace_unavailable',
        });
      }
      throw error;
    }
    return { project, root };
  }

  async function withWorkspace(ctx, callback, options = {}) {
    try {
      const workspace = await getWorkspace(ctx, options);
      return await callback(workspace);
    } catch (error) {
      return errorResult(error.code || 'workspace_error', error.message || String(error));
    }
  }

  async function listDirectory(args = {}, ctx = {}) {
    return withWorkspace(ctx, async ({ root }) => {
      const resolved = await resolveWorkspaceTarget(root, args.path || '.');
      const stat = await fsp.stat(resolved.target);
      if (!stat.isDirectory()) return errorResult('not_a_directory', '目标不是目录');
      const includeHidden = args.includeHidden === true;
      const limit = clampInteger(args.limit, DEFAULT_MAX_ENTRIES, 1, 500);
      const dirents = await fsp.readdir(resolved.target, { withFileTypes: true });
      const entries = [];
      for (const entry of dirents) {
        if (SENSITIVE_SEGMENTS.has(entry.name.toLowerCase())) continue;
        if (!includeHidden && entry.name.startsWith('.')) continue;
        if (entry.isSymbolicLink()) continue;
        const fullPath = path.join(resolved.target, entry.name);
        const itemStat = await fsp.stat(fullPath);
        entries.push({
          name: entry.name,
          path: path.relative(root, fullPath).replace(/\\/g, '/'),
          type: entry.isDirectory() ? 'directory' : 'file',
          ...(entry.isFile() ? { sizeBytes: itemStat.size } : {}),
          modifiedAt: itemStat.mtime.toISOString(),
        });
      }
      entries.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      return {
        ok: true,
        path: resolved.relativePath,
        entries: entries.slice(0, limit),
        truncated: entries.length > limit,
      };
    });
  }

  async function walkFiles(root, start, args, onFile) {
    const maxDepth = clampInteger(args.maxDepth, 8, 0, 20);
    const maxFiles = clampInteger(args.maxFiles, 5000, 1, 20_000);
    const includeHidden = args.includeHidden === true;
    let visited = 0;
    let stopped = false;

    async function walk(directory, depth) {
      if (stopped || depth > maxDepth) return;
      let dirents;
      try {
        dirents = await fsp.readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of dirents) {
        if (stopped) break;
        if (SENSITIVE_SEGMENTS.has(entry.name.toLowerCase())) continue;
        if (!includeHidden && entry.name.startsWith('.')) continue;
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath, depth + 1);
          continue;
        }
        if (!entry.isFile()) continue;
        visited += 1;
        if (visited > maxFiles) {
          stopped = true;
          break;
        }
        await onFile(fullPath, path.relative(root, fullPath).replace(/\\/g, '/'));
      }
    }

    await walk(start, 0);
    return { visited: Math.min(visited, maxFiles), stopped };
  }

  function globToRegExp(pattern) {
    const source = String(pattern || '*')
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '\u0000')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')
      .replace(/\u0000/g, '.*');
    return new RegExp(`^${source}$`, 'i');
  }

  async function findFiles(args = {}, ctx = {}) {
    return withWorkspace(ctx, async ({ root }) => {
      const resolved = await resolveWorkspaceTarget(root, args.path || '.');
      const stat = await fsp.stat(resolved.target);
      if (!stat.isDirectory()) return errorResult('not_a_directory', '查找起点不是目录');
      const pattern = String(args.pattern || '*').trim() || '*';
      const matcher = globToRegExp(pattern);
      const limit = clampInteger(args.limit, DEFAULT_MAX_ENTRIES, 1, 500);
      const matches = [];
      const walk = await walkFiles(root, resolved.target, args, async (fullPath, relativePath) => {
        if (matches.length >= limit) return;
        if (matcher.test(relativePath) || matcher.test(path.basename(relativePath))) {
          const fileStat = await fsp.stat(fullPath);
          matches.push({ path: relativePath, sizeBytes: fileStat.size, modifiedAt: fileStat.mtime.toISOString() });
        }
      });
      return {
        ok: true,
        pattern,
        matches,
        filesScanned: walk.visited,
        truncated: matches.length >= limit || walk.stopped,
      };
    });
  }

  async function searchText(args = {}, ctx = {}) {
    const query = String(args.query || '');
    if (!query) return errorResult('query_required', 'query 不能为空');
    return withWorkspace(ctx, async ({ root }) => {
      const resolved = await resolveWorkspaceTarget(root, args.path || '.');
      const startStat = await fsp.stat(resolved.target);
      const caseSensitive = args.caseSensitive === true;
      const needle = caseSensitive ? query : query.toLowerCase();
      const limit = clampInteger(args.limit, 80, 1, 300);
      const fileMatcher = args.filePattern ? globToRegExp(args.filePattern) : null;
      const matches = [];
      let skippedBinaryOrLarge = 0;

      async function inspectFile(fullPath, relativePath) {
        if (matches.length >= limit) return;
        if (fileMatcher && !fileMatcher.test(relativePath) && !fileMatcher.test(path.basename(relativePath))) return;
        const stat = await fsp.stat(fullPath);
        if (stat.size > MAX_TEXT_FILE_BYTES) {
          skippedBinaryOrLarge += 1;
          return;
        }
        const buffer = await fsp.readFile(fullPath);
        if (buffer.includes(0)) {
          skippedBinaryOrLarge += 1;
          return;
        }
        const lines = buffer.toString('utf8').split(/\r?\n/);
        for (let index = 0; index < lines.length && matches.length < limit; index += 1) {
          const haystack = caseSensitive ? lines[index] : lines[index].toLowerCase();
          if (haystack.includes(needle)) {
            matches.push({
              path: relativePath,
              line: index + 1,
              text: lines[index].slice(0, 500),
            });
          }
        }
      }

      let walk = { visited: 1, stopped: false };
      if (startStat.isFile()) {
        await inspectFile(resolved.target, resolved.relativePath);
      } else if (startStat.isDirectory()) {
        walk = await walkFiles(root, resolved.target, args, inspectFile);
      } else {
        return errorResult('unsupported_file_type', '只支持普通文件或目录');
      }
      return {
        ok: true,
        query,
        matches,
        filesScanned: walk.visited,
        skippedBinaryOrLarge,
        truncated: matches.length >= limit || walk.stopped,
      };
    });
  }

  async function readFile(args = {}, ctx = {}) {
    return withWorkspace(ctx, async ({ root }) => {
      const resolved = await resolveWorkspaceTarget(root, args.path);
      const stat = await fsp.stat(resolved.target);
      if (!stat.isFile()) return errorResult('not_a_file', '目标不是文件');
      if (stat.size > MAX_TEXT_FILE_BYTES) {
        return errorResult('file_too_large', `文本读取上限为 ${MAX_TEXT_FILE_BYTES} 字节`, {
          sizeBytes: stat.size,
        });
      }
      const buffer = await fsp.readFile(resolved.target);
      if (buffer.includes(0)) return errorResult('binary_file', '二进制文件不能作为文本读取');
      const content = buffer.toString('utf8');
      const lines = content.split(/\r?\n/);
      const startLine = clampInteger(args.startLine, 1, 1, Math.max(1, lines.length));
      const maxLines = clampInteger(args.maxLines, DEFAULT_MAX_READ_LINES, 1, MAX_READ_LINES);
      const selected = lines.slice(startLine - 1, startLine - 1 + maxLines);
      return {
        ok: true,
        path: resolved.relativePath,
        content: selected.join('\n'),
        startLine,
        endLine: startLine + Math.max(0, selected.length - 1),
        totalLines: lines.length,
        sizeBytes: stat.size,
        sha256: sha256(buffer),
        truncated: startLine - 1 + selected.length < lines.length,
      };
    });
  }

  function contentMetadata(content) {
    if (content == null) return { sha256: null, sizeBytes: 0, lineCount: 0 };
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
    return {
      sha256: sha256(buffer),
      sizeBytes: buffer.length,
      lineCount: buffer.toString('utf8').split(/\r?\n/).length,
    };
  }

  function buildChangeSummary(relativePath, before, after) {
    return {
      path: relativePath,
      before: contentMetadata(before),
      after: contentMetadata(after),
    };
  }

  // UI-273 增补 — 逐行 diff（统计 + 截断 hunks），供前端执行记录展开行展示每次操作的实际改动。
  // hunks 结构与前端 DiffFile 对齐：{ oldStart, newStart, lines: [{ type: 'ctx'|'add'|'del', text }] }。
  const CHANGE_DIFF_MAX_DP_LINES = 1200; // 超过则退化为整段替换统计（诚实计数，不产精细 hunks）
  const CHANGE_DIFF_MAX_HUNK_LINES = 48; // diff 展示行数上限
  const CHANGE_DIFF_MAX_LINE_CHARS = 240; // 单行文本上限

  function buildChangeDiff(beforeRaw, afterRaw) {
    const toLines = (value) => {
      const text = value == null ? '' : Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
      if (text === '') return []; // 空文件（含新建）= 0 行，不产生删除行
      const lines = text.split('\n');
      if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop(); // 尾部换行不产生空行差异
      return lines;
    };
    const a = toLines(beforeRaw);
    const b = toLines(afterRaw);

    // 公共前后缀裁剪，缩小 DP 规模
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
    let endA = a.length;
    let endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
      endA -= 1;
      endB -= 1;
    }
    const midA = a.slice(start, endA);
    const midB = b.slice(start, endB);

    function diffMidOps() {
      const n = midA.length;
      const m = midB.length;
      if (n === 0 && m === 0) return [];
      if (n > CHANGE_DIFF_MAX_DP_LINES || m > CHANGE_DIFF_MAX_DP_LINES) {
        // 整段替换近似：计数诚实（删 A 段 + 增 B 段），不产精细 hunks
        return [
          ...midA.map((text, i) => ({ type: 'del', text, oldLine: start + i + 1, newLine: null })),
          ...midB.map((text, j) => ({ type: 'add', text, oldLine: null, newLine: start + j + 1 })),
        ];
      }
      const dp = new Uint32Array((n + 1) * (m + 1));
      const w = m + 1;
      for (let i = n - 1; i >= 0; i -= 1) {
        for (let j = m - 1; j >= 0; j -= 1) {
          dp[i * w + j] = midA[i] === midB[j]
            ? dp[(i + 1) * w + j + 1] + 1
            : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
        }
      }
      const ops = [];
      let i = 0;
      let j = 0;
      while (i < n && j < m) {
        if (midA[i] === midB[j]) {
          ops.push({ type: 'ctx', text: midA[i], oldLine: start + i + 1, newLine: start + j + 1 });
          i += 1;
          j += 1;
        } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
          ops.push({ type: 'del', text: midA[i], oldLine: start + i + 1, newLine: null });
          i += 1;
        } else {
          ops.push({ type: 'add', text: midB[j], oldLine: null, newLine: start + j + 1 });
          j += 1;
        }
      }
      while (i < n) {
        ops.push({ type: 'del', text: midA[i], oldLine: start + i + 1, newLine: null });
        i += 1;
      }
      while (j < m) {
        ops.push({ type: 'add', text: midB[j], oldLine: null, newLine: start + j + 1 });
        j += 1;
      }
      return ops;
    }

    const ops = diffMidOps();
    let added = 0;
    let removed = 0;
    for (const op of ops) {
      if (op.type === 'add') added += 1;
      else if (op.type === 'del') removed += 1;
    }

    // 组装带 ±2 行上下文的 hunks，限制总行数
    const CONTEXT = 2;
    const clip = (line) => (line.length > CHANGE_DIFF_MAX_LINE_CHARS ? `${line.slice(0, CHANGE_DIFF_MAX_LINE_CHARS)}…` : line);
    const hunks = [];
    let linesUsed = 0;
    let hunksTruncated = false;
    let idx = 0;
    while (idx < ops.length) {
      if (ops[idx].type === 'ctx') {
        idx += 1;
        continue;
      }
      const hunkStart = Math.max(0, idx - CONTEXT);
      let hunkEnd = idx;
      let quiet = 0;
      let k = idx;
      while (k < ops.length) {
        if (ops[k].type === 'ctx') {
          quiet += 1;
          if (quiet > CONTEXT) break;
        } else {
          quiet = 0;
          hunkEnd = k;
        }
        k += 1;
      }
      const slice = ops.slice(hunkStart, hunkEnd + 1);
      if (linesUsed + slice.length > CHANGE_DIFF_MAX_HUNK_LINES) {
        hunksTruncated = true;
        break;
      }
      linesUsed += slice.length;
      const oldFirst = slice.find((op) => op.oldLine != null);
      const newFirst = slice.find((op) => op.newLine != null);
      hunks.push({
        oldStart: oldFirst ? oldFirst.oldLine : (newFirst ? newFirst.newLine : 1),
        newStart: newFirst ? newFirst.newLine : (oldFirst ? oldFirst.oldLine : 1),
        lines: slice.map((op) => ({ type: op.type, text: clip(op.text) })),
      });
      idx = hunkEnd + 1;
    }
    if (idx < ops.length) hunksTruncated = true;

    // 公共前后缀不参与 DP，但作为 ctx 上下文补进首/末 hunk（各最多 CONTEXT 行）
    if (hunks.length > 0) {
      const prefixCtx = a.slice(Math.max(0, start - CONTEXT), start).map((text, i) => ({
        type: 'ctx',
        text: clip(text),
        line: Math.max(0, start - CONTEXT) + i + 1,
      }));
      if (prefixCtx.length > 0) {
        hunks[0].lines.unshift(...prefixCtx);
        hunks[0].oldStart = prefixCtx[0].line;
        hunks[0].newStart = prefixCtx[0].line;
      }
      const suffixCtx = a.slice(endA, Math.min(a.length, endA + CONTEXT)).map((text, i) => ({
        type: 'ctx',
        text: clip(text),
        line: endA + i + 1,
      }));
      if (suffixCtx.length > 0) {
        hunks[hunks.length - 1].lines.push(...suffixCtx);
      }
    }

    return { added, removed, truncated: hunksTruncated, hunks };
  }

  async function atomicPublish(target, content, expected, options = {}) {
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const tempPath = path.join(
      path.dirname(target),
      `.biof3-${options.prefix || 'write'}-${process.pid}-${crypto.randomBytes(6).toString('hex')}`
    );
    try {
      await fsp.writeFile(tempPath, content, {
        encoding: 'utf8',
        mode: options.mode == null ? 0o600 : options.mode,
        flag: 'wx',
      });
      if (expected != null) {
        const latest = await fsp.readFile(target);
        if (sha256(latest) !== sha256(expected)) {
          throw Object.assign(new Error('文件在写入期间发生变化'), { code: 'content_conflict' });
        }
        await fsp.rename(tempPath, target);
        return;
      }
      try {
        await fsp.link(tempPath, target);
      } catch (error) {
        if (error && error.code === 'EEXIST') {
          throw Object.assign(new Error('目标文件在写入前已被创建'), {
            code: 'content_conflict',
          });
        }
        throw error;
      }
    } finally {
      await fsp.rm(tempPath, { force: true }).catch(() => {});
    }
  }

  async function checkWritePreconditions(target, args) {
    let existing = null;
    try {
      existing = await fsp.readFile(target);
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
    }
    if (existing && args.overwrite !== true) {
      throw Object.assign(new Error('目标文件已存在；覆写时必须显式传 overwrite=true'), {
        code: 'overwrite_required',
      });
    }
    if (existing && !args.expectedSha256) {
      throw Object.assign(new Error('覆写已有文件必须提供 expectedSha256'), {
        code: 'expected_sha256_required',
      });
    }
    if (args.expectedSha256 && (!existing || sha256(existing) !== String(args.expectedSha256))) {
      throw Object.assign(new Error('文件已发生变化，expectedSha256 不匹配'), {
        code: 'content_conflict',
      });
    }
    return existing;
  }

  async function writeFile(args = {}, ctx = {}) {
    const content = String(args.content == null ? '' : args.content);
    if (Buffer.byteLength(content) > MAX_WRITE_BYTES) {
      return errorResult('content_too_large', `单次写入上限为 ${MAX_WRITE_BYTES} 字节`);
    }
    return withWorkspace(ctx, async ({ root }) => {
      const resolved = await resolveWorkspaceTarget(root, args.path, {
        createRoot: args.dryRun !== true,
      });
      return withTargetLock(resolved.target, async () => {
        const existing = await checkWritePreconditions(resolved.target, args);
        const changeSummary = buildChangeSummary(resolved.relativePath, existing, content);
        const changeDiff = buildChangeDiff(existing, content);
        if (args.dryRun !== true) {
          await atomicPublish(resolved.target, content, existing, { prefix: 'write' });
        }
        return {
          ok: true,
          path: resolved.relativePath,
          created: !existing,
          sizeBytes: Buffer.byteLength(content),
          previousSha256: existing ? sha256(existing) : null,
          sha256: sha256(content),
          dryRun: args.dryRun === true,
          changeSummary,
          changeDiff,
        };
      });
    }, { createRoot: args.dryRun !== true, requireCompatible: true });
  }

  async function replaceText(args = {}, ctx = {}) {
    const oldText = String(args.oldText == null ? '' : args.oldText);
    const newText = String(args.newText == null ? '' : args.newText);
    if (!oldText) return errorResult('old_text_required', 'oldText 不能为空');
    if (!args.expectedSha256) {
      return errorResult('expected_sha256_required', '文本替换必须提供 expectedSha256');
    }
    return withWorkspace(ctx, async ({ root }) => {
      const resolved = await resolveWorkspaceTarget(root, args.path, {
        createRoot: args.dryRun !== true,
      });
      return withTargetLock(resolved.target, async () => {
        const stat = await fsp.stat(resolved.target);
        if (!stat.isFile()) return errorResult('not_a_file', '目标不是文件');
        if (stat.size > MAX_TEXT_FILE_BYTES) return errorResult('file_too_large', '文件过大，拒绝文本替换');
        const before = await fsp.readFile(resolved.target, 'utf8');
        if (sha256(before) !== String(args.expectedSha256)) {
          return errorResult('content_conflict', '文件已发生变化，expectedSha256 不匹配');
        }
        let count = 0;
        let position = before.indexOf(oldText);
        while (position !== -1) {
          count += 1;
          position = before.indexOf(oldText, position + oldText.length);
        }
        if (count === 0) return errorResult('text_not_found', 'oldText 未找到');
        if (count !== 1) {
          return errorResult('text_not_unique', `oldText 匹配 ${count} 次；必须提供唯一片段`);
        }
        const after = before.replace(oldText, newText);
        if (Buffer.byteLength(after) > MAX_WRITE_BYTES) {
          return errorResult('content_too_large', `替换后的文件超过 ${MAX_WRITE_BYTES} 字节`);
        }
        const changeSummary = buildChangeSummary(resolved.relativePath, before, after);
        const changeDiff = buildChangeDiff(before, after);
        if (args.dryRun !== true) {
          await atomicPublish(resolved.target, after, before, {
            prefix: 'replace',
            mode: stat.mode & 0o777,
          });
        }
        return {
          ok: true,
          path: resolved.relativePath,
          replacements: 1,
          previousSha256: sha256(before),
          sha256: sha256(after),
          dryRun: args.dryRun === true,
          changeSummary,
          changeDiff,
        };
      });
    }, { createRoot: args.dryRun !== true, requireCompatible: true });
  }

  function commandVerdict(command) {
    const normalized = String(command || '').trim();
    if (!normalized) return { ok: false, reason: 'command 不能为空' };
    if (Buffer.byteLength(normalized) > MAX_COMMAND_BYTES) return { ok: false, reason: 'command 过长' };
    if (normalized.includes('\0')) return { ok: false, reason: 'command 不能包含空字节' };
    // BLOCK-10 S-005: capability token bypass.
    // The token is set into `process.env.BIOF3_WORKSPACE_EXEC_TOKEN` by the
    // privileged caller (mcp-server / agent-task-store) right before invoking
    // workspace_exec. The verdict reads it, strips it from the command, and
    // returns { ok: true, allowed: true } so the blacklist regexes below
    // never get to evaluate risk patterns the elevated layer already
    // pre-approved. The strip + length cap is symmetric: removing the token
    // shortens the command and is validated as part of the byte-length check
    // before token evaluation, so a payload whose stripped form is empty
    // fails the empty-string guard above.
    const token = process.env.BIOF3_WORKSPACE_EXEC_TOKEN;
    if (token && normalized.includes(token)) {
      const stripped = normalized.split(token).join('').trim();
      if (!stripped) return { ok: false, reason: 'command 不能为空' };
      return { ok: true, allowed: true, stripped };
    }
    const nonNegotiableRisks = [
      {
        pattern: /(^|[;&|]\s*)(sudo|doas)(\s|$)/i,
        reason: '禁止通过命令行发起交互式提权',
      },
      {
        pattern: /(^|[;&|]\s*)rm(\s|$)/i,
        reason: '禁止通过命令行执行不可恢复删除；请使用受控文件操作',
      },
      {
        pattern: /(^|[;&|]\s*)git(?:\s+-C\s+\S+)?\s+push(\s|$)/i,
        reason: '禁止由工作区命令静默推送远端',
      },
      {
        pattern: /\b(curl|wget)\b[^|]*\|\s*(sh|bash|zsh|fish|python(?:3)?|perl|ruby)\b/i,
        reason: '禁止下载远程内容后直接管道执行',
      },
    ];
    const blocked = nonNegotiableRisks.find(({ pattern }) => pattern.test(normalized));
    if (blocked) return { ok: false, reason: blocked.reason };
    return { ok: true };
  }

  function shellInvocation(command, shellPreference) {
    // BLOCK-33 P2 — shell 选择：auto（平台默认）| posix | powershell | cmd。
    // Windows 上 PowerShell 提供现代语法（对象管道、POSIX 风格引号），降低方言陷阱。
    // UI-315 优化 — Windows 中文环境 PowerShell/cmd 默认输出 GBK，按 UTF-8 解码即乱码：
    // powershell 注入 [Console]::OutputEncoding=UTF8、cmd 前置 chcp 65001，统一按 UTF-8 出流。
    const preference = String(shellPreference || 'auto').toLowerCase();
    if (preference === 'posix') {
      if (process.platform === 'win32') {
        return { error: 'posix shell 在 Windows 上不可用，请使用 powershell 或 cmd' };
      }
      return {
        executable: process.env.SHELL && path.isAbsolute(process.env.SHELL) ? process.env.SHELL : '/bin/sh',
        args: ['-lc', command],
      };
    }
    if (preference === 'powershell') {
      const executable = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
      const inner = process.platform === 'win32'
        ? '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ' + command
        : command;
      return {
        executable,
        args: ['-NoProfile', '-NonInteractive', '-Command', inner],
      };
    }
    if (preference === 'cmd') {
      if (process.platform !== 'win32') {
        return { error: 'cmd.exe 仅在 Windows 上可用' };
      }
      return {
        executable: process.env.ComSpec || 'cmd.exe',
        args: ['/d', '/s', '/c', 'chcp 65001>nul & ' + command],
      };
    }
    if (process.platform === 'win32') {
      return {
        executable: process.env.ComSpec || 'cmd.exe',
        args: ['/d', '/s', '/c', 'chcp 65001>nul & ' + command],
      };
    }
    return {
      executable: process.env.SHELL && path.isAbsolute(process.env.SHELL) ? process.env.SHELL : '/bin/sh',
      args: ['-lc', command],
    };
  }

  async function preflightTool(name, args = {}, ctx = {}) {
    return withWorkspace(ctx, async ({ root }) => {
      if (name === 'workspace_exec' || name === 'workspace_exec_background') {
        // BLOCK-56 P2 — workspace-write 中间档：前台命令放行（黑名单维持 + cwd
        // 限定项目根，下方既有校验不变）；后台进程面维持 full 专属。
        const execAllowed = ctx.accessMode === 'full'
          || (ctx.accessMode === 'workspace-write' && name === 'workspace_exec');
        if (!execAllowed) {
          return errorResult(
            ctx.accessMode === 'workspace-write' ? 'access_mode_workspace_write' : 'access_mode_read_only',
            ctx.accessMode === 'workspace-write'
              ? '项目写模式仅允许前台命令执行；后台进程需要完全访问模式'
              : '聊天当前处于只读模式，禁止执行命令'
          );
        }
        const command = String(args.command || '').trim();
        const verdict = commandVerdict(command);
        if (!verdict.ok) return errorResult('command_blocked', verdict.reason);
        // BLOCK-33 P2 — cwd 提前校验（fail-early），执行时 handler 内还会再解析一次
        if (args.cwd != null && String(args.cwd).trim() !== '' && String(args.cwd).trim() !== '.') {
          const resolvedCwd = await resolveWorkspaceTarget(root, String(args.cwd).trim(), {
            createRoot: false,
          });
          const cwdStat = await fsp.stat(resolvedCwd.target).catch(() => null);
          if (!cwdStat || !cwdStat.isDirectory()) {
            return errorResult('invalid_arguments', `cwd 不是工作区内已存在的目录: ${resolvedCwd.relativePath}`);
          }
        }
        return {
          ok: true,
          commandRisk: 'full_access',
        };
      }

      if (name === 'process_status' || name === 'process_stop') {
        // BLOCK-33 P4 — 只操作本工具启动的进程，无文件路径参数
        return { ok: true, commandRisk: 'process_control' };
      }

      const resolved = await resolveWorkspaceTarget(root, args.path || '.', {
        createRoot: args.dryRun !== true,
      });
      let exists = true;
      try {
        await fsp.lstat(resolved.target);
      } catch (error) {
        if (!error || error.code !== 'ENOENT') throw error;
        exists = false;
      }
      return {
        ok: true,
        exists,
        relativePath: resolved.relativePath,
      };
    }, {
      createRoot: args.dryRun !== true,
      requireCompatible: ['workspace_write', 'workspace_replace', 'workspace_exec', 'workspace_exec_background'].includes(name),
    });
  }

  // handlerOptions: BLOCK-33 P3 — 第 3 参携带 { onOutput } 流式回调（可选）
  async function executeCommand(args = {}, ctx = {}, handlerOptions = {}) {
    // BLOCK-56 P2 — workspace-write 中间档放行前台命令（黑名单 + cwd 限项目根维持）
    if (ctx.accessMode !== 'full' && ctx.accessMode !== 'workspace-write') {
      return errorResult('access_mode_read_only', '聊天当前处于只读模式，禁止执行命令');
    }
    const command = String(args.command || '').trim();
    const verdict = commandVerdict(command);
    if (!verdict.ok) return errorResult('command_blocked', verdict.reason);
    // BLOCK-54 P1 — yield 中间档分流：显式传 yield_ms（>0）才启用；不传 = 既有同步语义
    if (args.yield_ms != null && Number(args.yield_ms) > 0) {
      const yieldMs = clampInteger(args.yield_ms, DEFAULT_YIELD_MS, MIN_YIELD_MS, MAX_YIELD_MS);
      const maxOutputTokens = clampInteger(
        args.max_output_tokens,
        DEFAULT_MAX_OUTPUT_TOKENS,
        100,
        MAX_OUTPUT_TOKENS_CAP
      );
      return executeCommandWithYield(args, ctx, yieldMs, maxOutputTokens);
    }
    const shellPreference = String(args.shell || 'auto').toLowerCase();
    return withWorkspace(ctx, async ({ root }) => {
      // BLOCK-33 P2 — cwd 参数：相对工作区根，过沙箱校验（逃逸/符号链接拒绝）
      let cwdRoot = root;
      let cwdLabel = '.';
      if (args.cwd != null && String(args.cwd).trim() !== '' && String(args.cwd).trim() !== '.') {
        try {
          const resolvedCwd = await resolveWorkspaceTarget(root, String(args.cwd).trim(), {
            createRoot: false,
          });
          const cwdStat = await fsp.stat(resolvedCwd.target).catch(() => null);
          if (!cwdStat || !cwdStat.isDirectory()) {
            return errorResult('invalid_arguments', `cwd 不是工作区内已存在的目录: ${resolvedCwd.relativePath}`);
          }
          cwdRoot = resolvedCwd.target;
          cwdLabel = resolvedCwd.relativePath;
        } catch (error) {
          return errorResult(
            error && error.code ? error.code : 'invalid_arguments',
            (error && error.message) || 'cwd 校验失败'
          );
        }
      }
      const invocation = shellInvocation(command, shellPreference);
      if (invocation.error) return errorResult('invalid_arguments', invocation.error);
      const startedAt = Date.now();
      const spawnResult = await spawnCommand(invocation, {
        cwd: cwdRoot,
        timeout: clampInteger(args.timeoutMs, DEFAULT_COMMAND_TIMEOUT_MS, 100, MAX_COMMAND_TIMEOUT_MS),
        maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
        onOutput: handlerOptions && typeof handlerOptions.onOutput === 'function'
          ? handlerOptions.onOutput
          : null,
      });
      const durationMs = Date.now() - startedAt;
      if (spawnResult.ok) {
        return {
          ok: true,
          command,
          cwd: cwdLabel,
          shell: invocation.executable,
          exitCode: 0,
          signal: null,
          timedOut: false,
          durationMs,
          stdout: spawnResult.stdout.slice(0, MAX_COMMAND_OUTPUT_BYTES),
          stderr: spawnResult.stderr.slice(0, MAX_COMMAND_OUTPUT_BYTES),
          truncated: spawnResult.truncated,
        };
      }
      return {
        ok: false,
        command,
        cwd: cwdLabel,
        shell: invocation.executable,
        exitCode: Number.isInteger(spawnResult.code) ? spawnResult.code : 1,
        signal: spawnResult.signal,
        timedOut: spawnResult.timedOut,
        durationMs,
        stdout: spawnResult.stdout.slice(0, MAX_COMMAND_OUTPUT_BYTES),
        stderr: spawnResult.stderr.slice(0, MAX_COMMAND_OUTPUT_BYTES),
        truncated: spawnResult.truncated,
      };
    }, { requireCompatible: true });
  }

  // BLOCK-54 P1 — workspace_exec yield 中间档：命令启动后等到产出或 yield_ms 超时。
  // 完成路径返回与同步 workspace_exec 相同形状（另加 token 预算截断标记）；
  // 超时路径把仍存活的子进程按 exec_background 同款 record 挂入 backgroundProcesses
  // （process_status 轮询日志尾部 / process_stop 停止），返回 { yielded: true, processId }。
  async function executeCommandWithYield(args, ctx, yieldMs, maxOutputTokens) {
    const command = String(args.command || '').trim();
    const shellPreference = String(args.shell || 'auto').toLowerCase();
    return withWorkspace(ctx, async ({ root }) => {
      let cwdRoot = root;
      let cwdLabel = '.';
      if (args.cwd != null && String(args.cwd).trim() !== '' && String(args.cwd).trim() !== '.') {
        try {
          const resolvedCwd = await resolveWorkspaceTarget(root, String(args.cwd).trim(), {
            createRoot: false,
          });
          const cwdStat = await fsp.stat(resolvedCwd.target).catch(() => null);
          if (!cwdStat || !cwdStat.isDirectory()) {
            return errorResult('invalid_arguments', `cwd 不是工作区内已存在的目录: ${resolvedCwd.relativePath}`);
          }
          cwdRoot = resolvedCwd.target;
          cwdLabel = resolvedCwd.relativePath;
        } catch (error) {
          return errorResult(
            error && error.code ? error.code : 'invalid_arguments',
            (error && error.message) || 'cwd 校验失败'
          );
        }
      }
      const invocation = shellInvocation(command, shellPreference);
      if (invocation.error) return errorResult('invalid_arguments', invocation.error);

      const sessionKey = backgroundSessionKey(ctx);
      let runningCount = 0;
      for (const record of backgroundProcesses.values()) {
        if (record.sessionKey === sessionKey && record.status === 'running') runningCount += 1;
      }
      if (runningCount >= BACKGROUND_MAX_RUNNING_PER_SESSION) {
        return errorResult(
          'resource_limit',
          `本会话后台进程已达上限 ${BACKGROUND_MAX_RUNNING_PER_SESSION}，请先用 process_stop 释放`
        );
      }

      const processId = `bg-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
      const logRelativePath = `${BACKGROUND_LOG_DIR}/${processId}.log`;
      const logPath = path.join(root, BACKGROUND_LOG_DIR, `${processId}.log`);
      await fsp.mkdir(path.dirname(logPath), { recursive: true });
      const logFd = await fsp.open(logPath, 'a');
      let child;
      try {
        child = spawn(invocation.executable, invocation.args, {
          cwd: cwdRoot,
          detached: process.platform !== 'win32',
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } catch (error) {
        await logFd.close().catch(() => {});
        return errorResult('invalid_arguments', (error && error.message) || '命令启动失败');
      }

      const startedAt = Date.now();
      const stdoutChunks = [];
      const stderrChunks = [];
      let collected = 0;
      const appendLog = (chunk) => {
        logFd.write(chunk).catch(() => {});
      };
      child.stdout.on('data', (chunk) => {
        appendLog(chunk);
        if (collected < MAX_COMMAND_OUTPUT_BYTES) {
          stdoutChunks.push(chunk);
          collected += chunk.length;
        }
      });
      child.stderr.on('data', (chunk) => {
        appendLog(chunk);
        if (collected < MAX_COMMAND_OUTPUT_BYTES) {
          stderrChunks.push(chunk);
          collected += chunk.length;
        }
      });

      const outcome = await new Promise((resolve) => {
        let settled = false;
        child.on('close', (code, signal) => {
          if (!settled) {
            settled = true;
            resolve({ exited: true, code, signal });
          }
        });
        child.on('error', (error) => {
          if (!settled) {
            settled = true;
            resolve({ exited: true, code: 1, signal: null, spawnError: (error && error.message) || '进程异常' });
          }
        });
        setTimeout(() => {
          if (!settled) {
            settled = true;
            resolve({ exited: false });
          }
        }, yieldMs);
      });

      if (outcome.exited) {
        // 完成路径：等数据 flush 后关日志，Buffer 返回（形状对齐同步路径）
        await new Promise((resolve) => setTimeout(resolve, 50));
        logFd.close().catch(() => {});
        const stdoutRaw = Buffer.concat(stdoutChunks).toString('utf-8');
        const stderrRaw = Buffer.concat(stderrChunks).toString('utf-8');
        const durationMs = Date.now() - startedAt;
        const stdoutBudgeted = applyOutputTokenBudget(stdoutRaw, maxOutputTokens);
        const stderrBudgeted = applyOutputTokenBudget(stderrRaw, maxOutputTokens);
        const result = {
          ok: !outcome.spawnError && outcome.code === 0,
          command,
          cwd: cwdLabel,
          shell: invocation.executable,
          exitCode: Number.isInteger(outcome.code) ? outcome.code : 1,
          signal: outcome.signal || null,
          timedOut: false,
          durationMs,
          stdout: stdoutBudgeted.text,
          stderr: outcome.spawnError ? `${stderrRaw}${stderrRaw ? '\n' : ''}${outcome.spawnError}` : stderrBudgeted.text,
          truncated: collected >= MAX_COMMAND_OUTPUT_BYTES,
        };
        if (stdoutBudgeted.truncated || stderrBudgeted.truncated) {
          result.outputTruncatedByTokenBudget = true;
          result.note = `输出超出 max_output_tokens=${maxOutputTokens} 预算，已按 token 预算截断（完整输出可改用 exec_background 落日志后 workspace_read）`;
        }
        return result;
      }

      // 超时路径：按 exec_background 同款 record 挂入进程表（日志 fd 保持打开，
      // onData 持续落盘；process_status 读日志尾部 / process_stop 走既有信号链）
      const record = {
        id: processId,
        sessionKey,
        projectId: ctx.projectId || null,
        userId: ctx.userId || null,
        command,
        cwd: cwdLabel,
        shell: invocation.executable,
        pid: child.pid,
        child,
        detachedGroup: process.platform !== 'win32',
        viaYield: true,
        yieldMs,
        logPath,
        logRelativePath,
        startedAt,
        endedAt: null,
        status: 'running',
        exitCode: null,
        signal: null,
        stoppedByUser: false,
        spawnError: null,
      };
      child.on('close', (code, signal) => {
        record.status = record.stoppedByUser ? 'stopped' : 'exited';
        record.exitCode = Number.isInteger(code) ? code : null;
        record.signal = signal || null;
        record.endedAt = Date.now();
        logFd.close().catch(() => {});
      });
      child.on('error', (error) => {
        record.status = 'failed';
        record.spawnError = (error && error.message) || '进程异常退出';
        record.endedAt = Date.now();
      });
      child.unref();
      backgroundProcesses.set(processId, record);
      pruneBackgroundRecords();
      return {
        ok: true,
        yielded: true,
        processId,
        pid: record.pid,
        command,
        cwd: cwdLabel,
        shell: invocation.executable,
        yieldMs,
        logPath: logRelativePath,
        stdoutPreview: applyOutputTokenBudget(Buffer.concat(stdoutChunks).toString('utf-8'), maxOutputTokens).text,
        note: `${yieldMs}ms 内未完成：已转入后台进程表（输出持续写入日志）。process_status 轮询收尾，process_stop 停止。`,
      };
    }, { requireCompatible: true });
  }

  // BLOCK-54 P1 — token 级输出预算截断（tiktoken countTokens，fallback chars/4）
  function applyOutputTokenBudget(text, budget) {
    if (!text) return { text: '', truncated: false };
    const { countTokens } = require('../helpers/token-estimator');
    const tokens = countTokens(text);
    if (tokens <= budget) return { text, truncated: false };
    let cut = text.slice(0, Math.max(Math.floor((text.length * budget) / tokens) - 64, 1));
    while (cut.length > 1 && countTokens(cut) > budget) {
      cut = cut.slice(0, Math.floor(cut.length * 0.9));
    }
    return { text: cut, truncated: true };
  }

  // BLOCK-33 P4 — 后台启动长任务：黑名单/accessMode/沙箱与 workspace_exec 相同，
  // 输出重定向到工作区 .biof3-agent-tmp/ 日志文件，立即返回 processId。
  async function execBackground(args = {}, ctx = {}) {
    if (ctx.accessMode !== 'full') {
      return errorResult('access_mode_read_only', '聊天当前处于只读模式，禁止启动后台进程');
    }
    const command = String(args.command || '').trim();
    if (!command) return errorResult('invalid_arguments', 'command 不能为空');
    const verdict = commandVerdict(command);
    if (!verdict.ok) return errorResult('command_blocked', verdict.reason);
    const shellPreference = String(args.shell || 'auto').toLowerCase();
    return withWorkspace(ctx, async ({ root }) => {
      const sessionKey = backgroundSessionKey(ctx);
      let runningCount = 0;
      for (const record of backgroundProcesses.values()) {
        if (record.sessionKey === sessionKey && record.status === 'running') runningCount += 1;
      }
      if (runningCount >= BACKGROUND_MAX_RUNNING_PER_SESSION) {
        return errorResult(
          'resource_limit',
          `本会话后台进程已达上限 ${BACKGROUND_MAX_RUNNING_PER_SESSION}，请先用 process_stop 释放`
        );
      }
      let cwdRoot = root;
      let cwdLabel = '.';
      if (args.cwd != null && String(args.cwd).trim() !== '' && String(args.cwd).trim() !== '.') {
        try {
          const resolvedCwd = await resolveWorkspaceTarget(root, String(args.cwd).trim(), {
            createRoot: false,
          });
          const cwdStat = await fsp.stat(resolvedCwd.target).catch(() => null);
          if (!cwdStat || !cwdStat.isDirectory()) {
            return errorResult('invalid_arguments', `cwd 不是工作区内已存在的目录: ${resolvedCwd.relativePath}`);
          }
          cwdRoot = resolvedCwd.target;
          cwdLabel = resolvedCwd.relativePath;
        } catch (error) {
          return errorResult(
            error && error.code ? error.code : 'invalid_arguments',
            (error && error.message) || 'cwd 校验失败'
          );
        }
      }
      const invocation = shellInvocation(command, shellPreference);
      if (invocation.error) return errorResult('invalid_arguments', invocation.error);

      const processId = `bg-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
      const logRelativePath = `${BACKGROUND_LOG_DIR}/${processId}.log`;
      const logPath = path.join(root, BACKGROUND_LOG_DIR, `${processId}.log`);
      await fsp.mkdir(path.dirname(logPath), { recursive: true });
      const logFd = await fsp.open(logPath, 'a');
      let child;
      try {
        child = spawn(invocation.executable, invocation.args, {
          cwd: cwdRoot,
          // posix 下 detached 使子进程成为进程组长，process_stop 可整组终止
          detached: process.platform !== 'win32',
          stdio: ['ignore', logFd.fd, logFd.fd],
          windowsHide: true,
        });
      } catch (error) {
        await logFd.close().catch(() => {});
        return errorResult('invalid_arguments', (error && error.message) || '后台进程启动失败');
      }
      logFd.close().catch(() => {});

      const record = {
        id: processId,
        sessionKey,
        projectId: ctx.projectId || null,
        userId: ctx.userId || null,
        command,
        cwd: cwdLabel,
        shell: invocation.executable,
        pid: child.pid,
        child,
        detachedGroup: process.platform !== 'win32',
        logPath,
        logRelativePath,
        startedAt: Date.now(),
        endedAt: null,
        status: 'running',
        exitCode: null,
        signal: null,
        stoppedByUser: false,
        spawnError: null,
      };
      child.on('close', (code, signal) => {
        record.status = record.stoppedByUser ? 'stopped' : 'exited';
        record.exitCode = Number.isInteger(code) ? code : null;
        record.signal = signal || null;
        record.endedAt = Date.now();
      });
      child.on('error', (error) => {
        record.status = 'failed';
        record.spawnError = (error && error.message) || '后台进程异常退出';
        record.endedAt = Date.now();
      });
      // 诚实边界：应用退出后后台进程继续存活（日志文件仍在），不做进程树托管
      child.unref();

      backgroundProcesses.set(processId, record);
      pruneBackgroundRecords();
      return {
        ok: true,
        processId,
        pid: record.pid,
        command,
        cwd: cwdLabel,
        shell: invocation.executable,
        status: 'running',
        startedAtIso: new Date(record.startedAt).toISOString(),
        logPath: logRelativePath,
        note: '输出已重定向到日志文件：workspace_read 可读取全文，process_status 查询存活与日志尾部，process_stop 停止',
      };
    }, { requireCompatible: true });
  }

  // BLOCK-33 P4 — 查询本会话后台进程（存活状态 + 日志尾部）
  async function processStatus(args = {}, ctx = {}) {
    const sessionKey = backgroundSessionKey(ctx);
    const logTailBytes = clampInteger(
      args.logTailBytes, BACKGROUND_LOG_TAIL_DEFAULT, 128, BACKGROUND_LOG_TAIL_MAX
    );
    const missingMessage = '未找到该后台进程（可能属于其他会话，或应用已重启导致进程表失效）';
    const viewRecord = async (record) => {
      const view = {
        processId: record.id,
        pid: record.pid,
        status: record.status,
        command: record.command,
        cwd: record.cwd,
        shell: record.shell,
        startedAtIso: new Date(record.startedAt).toISOString(),
        durationMs: (record.endedAt || Date.now()) - record.startedAt,
        exitCode: record.exitCode,
        signal: record.signal,
        logPath: record.logRelativePath,
      };
      if (record.spawnError) view.spawnError = record.spawnError;
      if (record.status === 'running') {
        // 兜底核验：进程表在但系统进程已消失（如被外部杀掉）
        let alive = true;
        try {
          process.kill(record.pid, 0);
        } catch (error) {
          alive = Boolean(error && error.code === 'EPERM');
        }
        if (!alive) {
          view.status = 'orphaned';
          return view;
        }
      }
      try {
        const tail = await readLogTail(record.logPath, logTailBytes);
        view.logTail = tail.text;
        view.logTruncated = tail.truncated;
        view.logSizeBytes = tail.size;
      } catch {
        // 日志文件缺失不阻塞状态查询
      }
      return view;
    };
    if (args.processId != null && String(args.processId).trim() !== '') {
      const record = backgroundProcesses.get(String(args.processId).trim());
      if (!record || record.sessionKey !== sessionKey) {
        return errorResult('not_found', missingMessage);
      }
      return { ok: true, process: await viewRecord(record) };
    }
    const records = [...backgroundProcesses.values()]
      .filter((record) => record.sessionKey === sessionKey)
      .sort((a, b) => a.startedAt - b.startedAt);
    const processes = await Promise.all(records.map(viewRecord));
    return { ok: true, count: processes.length, processes };
  }

  // BLOCK-33 P4 — 停止本会话后台进程：SIGTERM → 宽限 3s → SIGKILL
  async function processStop(args = {}, ctx = {}) {
    if (ctx.accessMode !== 'full') {
      return errorResult('access_mode_read_only', '聊天当前处于只读模式，禁止停止后台进程');
    }
    const processId = String(args.processId || '').trim();
    if (!processId) return errorResult('invalid_arguments', 'processId 不能为空');
    const sessionKey = backgroundSessionKey(ctx);
    const record = backgroundProcesses.get(processId);
    if (!record || record.sessionKey !== sessionKey) {
      return errorResult('not_found', '未找到该后台进程（只能停止本会话启动的进程）');
    }
    if (record.status !== 'running') {
      return {
        ok: true,
        processId,
        status: record.status,
        alreadyStopped: true,
        exitCode: record.exitCode,
      };
    }
    record.stoppedByUser = true;
    terminateBackgroundProcess(record);
    return {
      ok: true,
      processId,
      pid: record.pid,
      status: 'stopping',
      stopSignal: 'SIGTERM',
      graceMs: PROCESS_STOP_GRACE_MS,
      note: '已发送 SIGTERM，宽限 3 秒后仍存活将 SIGKILL；用 process_status 查看最终状态',
    };
  }

  // ── BLOCK-67 P2：SSH 远程面路由 ──
  // 项目 workspace_kind === 'ssh' 时，8 工具 + 后台进程三件套路由到 ssh surface；
  // local 项目原路径零改动（零回归红线）。项目形态取自 DB（创建时定死，D7）。
  const { createSshWorkspaceSurface } = require('./workspace-ssh-surface');
  const sshSurface = createSshWorkspaceSurface({
    getProject: (projectId) => dbProvider().getProject(projectId),
    authorizeProject,
    assertProjectG0Compatible,
    commandVerdict,
    sensitiveSegments: SENSITIVE_SEGMENTS,
    dbProvider,
  });

  async function projectIsSsh(ctx) {
    const projectId = String((ctx && ctx.projectId) || '').trim();
    if (!projectId) return false;
    try {
      const d = dbProvider();
      const row = typeof d.getDatabase === 'function'
        ? d.getDatabase().prepare('SELECT workspace_kind FROM projects WHERE id = ?').get(projectId)
        : d.getProject(projectId);
      return row ? row.workspace_kind === 'ssh' : false;
    } catch {
      return false;
    }
  }

  function routeByWorkspaceKind(sshHandler) {
    return async (args, ctx, handlerOptions) => {
      if (await projectIsSsh(ctx)) {
        return sshHandler(args, ctx, handlerOptions, {
          buildChange: (rel, before, after) => ({
            summary: buildChangeSummary(rel, before, after),
            diff: buildChangeDiff(before, after),
          }),
        });
      }
      return null; // null = 走本地实现（由包装层处理）
    };
  }

  function routed(localImpl, sshHandlerName) {
    const router = routeByWorkspaceKind(sshSurface[sshHandlerName]);
    return async (args, ctx, handlerOptions) => {
      const sshResult = await router(args, ctx, handlerOptions);
      if (sshResult !== null) return sshResult;
      return localImpl(args, ctx, handlerOptions);
    };
  }

  return {
    listDirectory: routed(listDirectory, 'listDirectory'),
    findFiles: routed(findFiles, 'findFiles'),
    searchText: routed(searchText, 'searchText'),
    readFile: routed(readFile, 'readFile'),
    writeFile: routed(writeFile, 'writeFile'),
    replaceText: routed(replaceText, 'replaceText'),
    executeCommand: routed(executeCommand, 'executeCommand'),
    execBackground: routed(execBackground, 'execBackground'),
    processStatus: routed(processStatus, 'processStatus'),
    processStop: routed(processStop, 'processStop'),
    preflightTool,
    commandVerdict,
  };
}

const defaultTools = createWorkspaceTools();

module.exports = {
  createWorkspaceTools,
  tool_workspace_list: defaultTools.listDirectory,
  tool_workspace_find: defaultTools.findFiles,
  tool_workspace_search: defaultTools.searchText,
  tool_workspace_read: defaultTools.readFile,
  tool_workspace_write: defaultTools.writeFile,
  tool_workspace_replace: defaultTools.replaceText,
  tool_workspace_exec: defaultTools.executeCommand,
  tool_workspace_exec_background: defaultTools.execBackground,
  tool_process_status: defaultTools.processStatus,
  tool_process_stop: defaultTools.processStop,
  preflightWorkspaceTool: defaultTools.preflightTool,
  _internal: {
    commandVerdict: defaultTools.commandVerdict,
    globToRegExp: (pattern) => {
      const source = String(pattern || '*')
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '\u0000')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]')
        .replace(/\u0000/g, '.*');
      return new RegExp(`^${source}$`, 'i');
    },
    isContained,
    sha256,
  },
};

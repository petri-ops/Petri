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
      return {
        executable,
        args: ['-NoProfile', '-NonInteractive', '-Command', command],
      };
    }
    if (preference === 'cmd') {
      if (process.platform !== 'win32') {
        return { error: 'cmd.exe 仅在 Windows 上可用' };
      }
      return {
        executable: process.env.ComSpec || 'cmd.exe',
        args: ['/d', '/s', '/c', command],
      };
    }
    if (process.platform === 'win32') {
      return {
        executable: process.env.ComSpec || 'cmd.exe',
        args: ['/d', '/s', '/c', command],
      };
    }
    return {
      executable: process.env.SHELL && path.isAbsolute(process.env.SHELL) ? process.env.SHELL : '/bin/sh',
      args: ['-lc', command],
    };
  }

  async function preflightTool(name, args = {}, ctx = {}) {
    return withWorkspace(ctx, async ({ root }) => {
      if (name === 'workspace_exec') {
        if (ctx.accessMode !== 'full') {
          return errorResult('access_mode_read_only', '聊天当前处于只读模式，禁止执行命令');
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
      requireCompatible: ['workspace_write', 'workspace_replace', 'workspace_exec'].includes(name),
    });
  }

  // handlerOptions: BLOCK-33 P3 — 第 3 参携带 { onOutput } 流式回调（可选）
  async function executeCommand(args = {}, ctx = {}, handlerOptions = {}) {
    if (ctx.accessMode !== 'full') {
      return errorResult('access_mode_read_only', '聊天当前处于只读模式，禁止执行命令');
    }
    const command = String(args.command || '').trim();
    const verdict = commandVerdict(command);
    if (!verdict.ok) return errorResult('command_blocked', verdict.reason);
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

  return {
    listDirectory,
    findFiles,
    searchText,
    readFile,
    writeFile,
    replaceText,
    executeCommand,
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

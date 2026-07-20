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

const READ_ONLY_COMMAND_PATTERNS = [/^pwd$/];

const BLOCKED_COMMAND_PATTERNS = [
  { pattern: /(^|[;&|]\s*)sudo\b/i, reason: 'sudo is not allowed' },
  { pattern: /(?:^|[^\\])[;&|`]|&&|\|\||\$\(/, reason: 'shell chaining, pipes, and command substitution are not allowed' },
  { pattern: /(^|[\s"'=])\/(?!\/|dev\/null\b)/, reason: 'absolute filesystem paths are not allowed' },
  { pattern: /(^|[\s"'=])~(?:\/|\s|$)|(?:^|[\s"'=])\.\.(?:\/|\s|$)/, reason: 'paths outside the project workspace are not allowed' },
  { pattern: /\b(?:mkfs|shutdown|reboot|halt)\b/i, reason: 'system administration command is not allowed' },
  { pattern: /\b(?:rm|rmdir|unlink)\b/i, reason: 'file deletion is not allowed' },
  { pattern: /\bgit\s+(?:push|reset\s+--hard|clean\s+-[^\s]*f|checkout\s+--|restore\s+--source)\b/i, reason: 'destructive or remote git operation is not allowed' },
  { pattern: /\b(?:npm|pnpm|yarn|cargo)\s+publish\b/i, reason: 'package publishing is not allowed' },
  { pattern: /\b(?:docker\s+(?:rm|rmi|system\s+prune)|kubectl\s+delete|terraform\s+destroy)\b/i, reason: 'destructive infrastructure operation is not allowed' },
  { pattern: /(?:curl|wget)[^\n|]*\|\s*(?:sh|bash|zsh)\b/i, reason: 'piping remote content to a shell is not allowed' },
  { pattern: /(?:^|[\s;&|])cd\s+\.\.(?:\/|\s|$)/i, reason: 'leaving the project workspace is not allowed' },
  { pattern: /(?:^|[\s;&|])(?:source|\.)\s+\/|(?:^|[\s;&|])(?:sh|bash|zsh)\s+\//i, reason: 'executing an absolute-path script is not allowed' },
  { pattern: /(?:^|[^>])>{1,2}\s*\/(?!dev\/null\b)/i, reason: 'redirecting output outside the project workspace is not allowed' },
  { pattern: /\b(?:node|python3?|rscript|r)\s+(?:-e|-c)\b/i, reason: 'inline interpreter programs are not allowed' },
];

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
    const project = !createRoot && typeof db.getDatabase === 'function'
      ? db.getDatabase().prepare('SELECT * FROM projects WHERE id = ?').get(projectId) || null
      : db.getProject(projectId);
    if (!project) {
      throw Object.assign(new Error('项目不存在'), { code: 'project_not_found' });
    }
    authorizeProject(project, ctx && ctx.userId, db);
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
    }, { createRoot: args.dryRun !== true });
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
    }, { createRoot: args.dryRun !== true });
  }

  function commandVerdict(command) {
    const normalized = String(command || '').trim();
    if (!normalized) return { ok: false, reason: 'command 不能为空' };
    if (normalized.length > 4000) return { ok: false, reason: 'command 过长' };
    if (normalized.includes('\0') || normalized.includes('\n') || normalized.includes('\r')) {
      return { ok: false, reason: 'command 必须是单行命令' };
    }
    for (const rule of BLOCKED_COMMAND_PATTERNS) {
      if (rule.pattern.test(normalized)) return { ok: false, reason: rule.reason };
    }
    return { ok: true };
  }

  async function preflightTool(name, args = {}, ctx = {}) {
    return withWorkspace(ctx, async ({ root }) => {
      if (name === 'workspace_exec') {
        const command = String(args.command || '').trim();
        const verdict = commandVerdict(command);
        if (!verdict.ok) return errorResult('command_blocked', verdict.reason);
        return {
          ok: true,
          commandRisk: READ_ONLY_COMMAND_PATTERNS.some((pattern) => pattern.test(command))
            ? 'read_only'
            : 'unknown',
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
    }, { createRoot: args.dryRun !== true });
  }

  async function executeCommand(args = {}, ctx = {}) {
    const command = String(args.command || '').trim();
    const verdict = commandVerdict(command);
    if (!verdict.ok) return errorResult('command_blocked', verdict.reason);
    if (!READ_ONLY_COMMAND_PATTERNS.some((pattern) => pattern.test(command))) {
      return errorResult('command_not_allowlisted', '该命令不在自动执行白名单中');
    }
    return withWorkspace(ctx, async ({ root }) => ({
      ok: true,
      command,
      cwd: '.',
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: `${root}\n`,
      stderr: '',
      truncated: false,
    }));
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

/**
 * core/petri-server/mcp/ide-tools/file.js
 *
 * Phase 1：IDE 文件操作 MCP 工具集实现（7 个工具）。
 * 暴露工具：ide_file_read / ide_file_write / ide_file_create /
 *          ide_file_delete / ide_file_rename / ide_file_exists / ide_file_list
 *
 * 设计依据：G0-IDE-MCP-TOOLS Phase 1（docs/g0-ide-mcp-tools-plan.md §3）
 * 安全约束：路径白名单、危险操作 confirm=true、操作审计
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { resolveAllowlisted, resolveAllowlistedPair } = require('./path-allowlist');

const MAX_READ_BYTES = 10 * 1024 * 1024; // 10MB 上限，避免大文件炸上下文

// ─── 工具定义（MCP inputSchema） ───────────────────────────────

function fileToolDefinitions() {
  return [
    {
      name: 'ide_file_read',
      description: 'Read file content. Returns { content, size, encoding }. Refuses files > 10MB.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path (absolute or relative to cwd).' },
          encoding: { type: 'string', enum: ['utf8', 'base64'], default: 'utf8' },
          maxSize: { type: 'number', description: 'Override size limit (bytes).' },
        },
        required: ['path'],
      },
    },
    {
      name: 'ide_file_write',
      description: 'Write file content. Requires confirm=true when overwriting an existing file.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path.' },
          content: { type: 'string', description: 'File content (utf8).' },
          encoding: { type: 'string', enum: ['utf8', 'base64'], default: 'utf8' },
          mode: { type: 'string', enum: ['overwrite', 'append'], default: 'overwrite' },
          confirm: { type: 'boolean', description: 'Required true when overwriting an existing file.' },
        },
        required: ['path', 'content'],
      },
    },
    {
      name: 'ide_file_create',
      description: 'Create a new file. Refuses if file already exists.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string', default: '' },
          template: { type: 'string', description: 'Optional template name (reserved for future).' },
        },
        required: ['path'],
      },
    },
    {
      name: 'ide_file_delete',
      description: 'Delete a file or directory. Requires confirm=true.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          recursive: { type: 'boolean', default: false, description: 'Required true for non-empty directories.' },
          confirm: { type: 'boolean', description: 'Must be true.' },
        },
        required: ['path', 'confirm'],
      },
    },
    {
      name: 'ide_file_rename',
      description: 'Rename or move a file. Requires confirm=true when overwriting.',
      inputSchema: {
        type: 'object',
        properties: {
          oldPath: { type: 'string' },
          newPath: { type: 'string' },
          overwrite: { type: 'boolean', default: false },
          confirm: { type: 'boolean', description: 'Must be true when overwrite=true.' },
        },
        required: ['oldPath', 'newPath'],
      },
    },
    {
      name: 'ide_file_exists',
      description: 'Check whether a file or directory exists. Returns { exists, isFile, isDirectory, size }.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
    {
      name: 'ide_file_list',
      description: 'List directory contents. Returns array of FileInfo.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path.' },
          recursive: { type: 'boolean', default: false },
          filter: { type: 'string', description: 'Substring filter (matched on name).' },
          maxFiles: { type: 'number', default: 1000, description: 'Hard cap on results.' },
        },
        required: ['path'],
      },
    },
  ];
}

// ─── 实现 ─────────────────────────────────────────────────────

function fileRead({ path: inputPath, encoding = 'utf8', maxSize }) {
  const resolved = resolveAllowlisted(inputPath);
  if (!resolved.ok) return { ok: false, error: resolved.reason };
  const abs = resolved.absolutePath;
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch (e) {
    return { ok: false, error: `stat failed: ${e.message}` };
  }
  if (!stat.isFile()) return { ok: false, error: 'path is not a file' };
  const limit = typeof maxSize === 'number' && maxSize > 0 ? maxSize : MAX_READ_BYTES;
  if (stat.size > limit) {
    return { ok: false, error: `file too large: ${stat.size} > limit ${limit}` };
  }
  try {
    const content = fs.readFileSync(abs, encoding);
    return { ok: true, content, size: stat.size, encoding };
  } catch (e) {
    return { ok: false, error: `read failed: ${e.message}` };
  }
}

function fileWrite({ path: inputPath, content, encoding = 'utf8', mode = 'overwrite', confirm }) {
  const resolved = resolveAllowlisted(inputPath);
  if (!resolved.ok) return { ok: false, error: resolved.reason };
  const abs = resolved.absolutePath;
  const exists = fs.existsSync(abs);
  if (exists && mode === 'overwrite' && confirm !== true) {
    return { ok: false, error: 'overwrite requires confirm=true' };
  }
  try {
    if (mode === 'append') {
      fs.appendFileSync(abs, content, encoding);
    } else {
      fs.writeFileSync(abs, content, encoding);
    }
    const stat = fs.statSync(abs);
    return { ok: true, path: abs, size: stat.size, mode };
  } catch (e) {
    return { ok: false, error: `write failed: ${e.message}` };
  }
}

function fileCreate({ path: inputPath, content = '', template }) {
  // template 当前为未来扩展点（按设计文档 §3.1）；此处忽略。
  void template;
  const resolved = resolveAllowlisted(inputPath);
  if (!resolved.ok) return { ok: false, error: resolved.reason };
  const abs = resolved.absolutePath;
  if (fs.existsSync(abs)) {
    return { ok: false, error: 'file already exists; use ide_file_write to overwrite' };
  }
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
    return { ok: true, path: abs, size: fs.statSync(abs).size };
  } catch (e) {
    return { ok: false, error: `create failed: ${e.message}` };
  }
}

function fileDelete({ path: inputPath, recursive = false, confirm }) {
  if (confirm !== true) return { ok: false, error: 'confirm=true required' };
  const resolved = resolveAllowlisted(inputPath);
  if (!resolved.ok) return { ok: false, error: resolved.reason };
  const abs = resolved.absolutePath;
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    return { ok: false, error: `path does not exist: ${abs}` };
  }
  try {
    if (stat.isDirectory()) {
      if (!recursive) {
        return { ok: false, error: 'directory deletion requires recursive=true' };
      }
      fs.rmSync(abs, { recursive: true, force: false });
    } else {
      fs.unlinkSync(abs);
    }
    return { ok: true, path: abs, kind: stat.isDirectory() ? 'directory' : 'file' };
  } catch (e) {
    return { ok: false, error: `delete failed: ${e.message}` };
  }
}

function fileRename({ oldPath, newPath, overwrite = false, confirm }) {
  if (overwrite && confirm !== true) {
    return { ok: false, error: 'overwrite requires confirm=true' };
  }
  const resolved = resolveAllowlistedPair(oldPath, newPath);
  if (!resolved.ok) return { ok: false, error: resolved.reason };
  if (!fs.existsSync(resolved.oldPath)) {
    return { ok: false, error: 'oldPath does not exist' };
  }
  if (fs.existsSync(resolved.newPath) && !overwrite) {
    return { ok: false, error: 'newPath already exists; pass overwrite=true + confirm=true' };
  }
  try {
    fs.mkdirSync(path.dirname(resolved.newPath), { recursive: true });
    fs.renameSync(resolved.oldPath, resolved.newPath);
    return { ok: true, oldPath: resolved.oldPath, newPath: resolved.newPath };
  } catch (e) {
    return { ok: false, error: `rename failed: ${e.message}` };
  }
}

function fileExists({ path: inputPath }) {
  const resolved = resolveAllowlisted(inputPath);
  if (!resolved.ok) return { ok: false, exists: false, error: resolved.reason };
  const abs = resolved.absolutePath;
  if (!fs.existsSync(abs)) return { ok: true, exists: false };
  const stat = fs.statSync(abs);
  return {
    ok: true,
    exists: true,
    isFile: stat.isFile(),
    isDirectory: stat.isDirectory(),
    size: stat.size,
  };
}

function fileList({ path: inputPath, recursive = false, filter, maxFiles = 1000 }) {
  const resolved = resolveAllowlisted(inputPath);
  if (!resolved.ok) return { ok: false, error: resolved.reason };
  const abs = resolved.absolutePath;
  if (!fs.existsSync(abs)) return { ok: false, error: 'path does not exist' };
  const stat = fs.statSync(abs);
  if (!stat.isDirectory()) return { ok: false, error: 'path is not a directory' };
  const results = [];
  const filterLower = typeof filter === 'string' ? filter.toLowerCase() : null;
  function walk(dir, depth) {
    if (results.length >= maxFiles) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (results.length >= maxFiles) return;
      const name = ent.name;
      if (filterLower && !name.toLowerCase().includes(filterLower)) continue;
      const fullPath = path.join(dir, name);
      let entryStat;
      try {
        entryStat = fs.statSync(fullPath);
      } catch {
        continue; // 跳过 stat 失败的条目（断链接等）
      }
      results.push({
        name,
        path: fullPath,
        relativePath: path.relative(abs, fullPath),
        isFile: entryStat.isFile(),
        isDirectory: entryStat.isDirectory(),
        size: entryStat.isFile() ? entryStat.size : undefined,
        mtime: entryStat.mtimeMs ? Math.floor(entryStat.mtimeMs) : undefined,
        extension: entryStat.isFile() ? path.extname(name).slice(1) : undefined,
      });
      if (recursive && entryStat.isDirectory() && depth > 0) {
        walk(fullPath, depth - 1);
      }
    }
  }
  walk(abs, recursive ? 32 : 0); // 32 层上限，防无限递归
  return { ok: true, count: results.length, entries: results, truncated: results.length >= maxFiles };
}

const HANDLERS = {
  ide_file_read: fileRead,
  ide_file_write: fileWrite,
  ide_file_create: fileCreate,
  ide_file_delete: fileDelete,
  ide_file_rename: fileRename,
  ide_file_exists: fileExists,
  ide_file_list: fileList,
};

module.exports = {
  fileToolDefinitions,
  HANDLERS,
};

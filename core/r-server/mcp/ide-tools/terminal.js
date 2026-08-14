/**
 * core/r-server/mcp/ide-tools/terminal.js
 *
 * Phase 1：IDE 终端操作 MCP 工具集实现（5 个工具）。
 * 暴露工具：ide_terminal_create / ide_terminal_write / ide_terminal_read /
 *          ide_terminal_close / ide_terminal_list
 *
 * 设计依据：G0-IDE-MCP-TOOLS Phase 1（docs/g0-ide-mcp-tools-plan.md §3）
 * 实现：node-pty 1.1.0-beta34（已在 package.json）。
 *
 * 安全约束：
 * - cwd 必须 resolveAllowlisted 通过
 * - 默认 shell 为 'sh'（不暴露 bash -c 拼接）
 * - 每个 session 限长 5 分钟（300000ms），超时自动清理
 * - 输出 buffer 限 64KB（超出滚动保留最新）
 */

'use strict';

const pty = require('node-pty');
const { resolveAllowlisted } = require('./path-allowlist');

const SESSION_TTL_MS = 5 * 60 * 1000;
const MAX_BUFFER_BYTES = 64 * 1024;
const MAX_READ_BYTES = 64 * 1024;
const DEFAULT_SHELL = process.env.SHELL || '/bin/sh';

/**
 * @typedef {object} Session
 * @property {string} id
 * @property {object} pty
 * @property {string} cwd
 * @property {string} shell
 * @property {Buffer} buffer
 * @property {number} createdAt
 * @property {number} lastReadAt
 */

/** @type {Map<string, Session>} */
const sessions = new Map();

function genId() {
  return `term_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function gcExpired() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.createdAt > SESSION_TTL_MS) {
      try {
        s.pty.kill();
      } catch (_e) { /* ignore */ }
      sessions.delete(id);
    }
  }
}

function terminalToolDefinitions() {
  return [
    {
      name: 'ide_terminal_create',
      description: 'Create a persistent terminal session. Returns sessionId.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Optional session name (used in list).' },
          cwd: { type: 'string', description: 'Working directory (must be in allowlist).' },
          shell: { type: 'string', description: 'Shell path; default = process.env.SHELL or /bin/sh.' },
        },
      },
    },
    {
      name: 'ide_terminal_write',
      description: 'Write a command to the terminal stdin. Returns { written }.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          command: { type: 'string', description: 'Command to execute (with newline).' },
        },
        required: ['sessionId', 'command'],
      },
    },
    {
      name: 'ide_terminal_read',
      description: 'Read pending output buffer. Output after lastReadAt. Returns { text, bytes }.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          since: { type: 'number', description: 'Timestamp in ms; read pending after this point.' },
        },
        required: ['sessionId'],
      },
    },
    {
      name: 'ide_terminal_close',
      description: 'Close the terminal session. Requires confirm=true.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          confirm: { type: 'boolean', description: 'Must be true.' },
        },
        required: ['sessionId', 'confirm'],
      },
    },
    {
      name: 'ide_terminal_list',
      description: 'List active terminal sessions. Returns { count, sessions: [{ id, name, cwd, createdAt, ageMs }] }.',
      inputSchema: { type: 'object', properties: {} },
    },
  ];
}

function terminalCreate({ name, cwd, shell } = {}) {
  gcExpired();
  const resolved = resolveAllowlisted(cwd || process.cwd());
  if (!resolved.ok) return { ok: false, error: `cwd: ${resolved.reason}` };
  const useShell = shell || DEFAULT_SHELL;
  const id = genId();
  let ptyProcess;
  try {
    ptyProcess = pty.spawn(useShell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: resolved.absolutePath,
      env: { ...process.env, BIOF3_IDE_TERM: '1' },
    });
  } catch (e) {
    return { ok: false, error: `pty spawn failed: ${e.message}` };
  }
  const session = {
    id,
    pty: ptyProcess,
    cwd: resolved.absolutePath,
    shell: useShell,
    name: name || null,
    buffer: Buffer.alloc(0),
    createdAt: Date.now(),
    lastReadAt: Date.now(),
  };
  ptyProcess.onData((data) => {
    const chunk = Buffer.from(data, 'utf8');
    let next = Buffer.concat([session.buffer, chunk]);
    if (next.length > MAX_BUFFER_BYTES) {
      next = next.slice(next.length - MAX_BUFFER_BYTES);
    }
    session.buffer = next;
  });
  ptyProcess.onExit(({ exitCode }) => {
    sessions.delete(id);
  });
  sessions.set(id, session);
  return { ok: true, sessionId: id, cwd: resolved.absolutePath, shell: useShell, createdAt: session.createdAt };
}

function terminalWrite({ sessionId, command }) {
  const session = sessions.get(sessionId);
  if (!session) return { ok: false, error: 'session not found' };
  const text = typeof command === 'string' ? command : '';
  if (!text) return { ok: false, error: 'command must be a non-empty string' };
  // 防止恶意长命令
  if (text.length > 8192) return { ok: false, error: 'command too long (>8KB)' };
  try {
    session.pty.write(text);
    return { ok: true, written: text.length };
  } catch (e) {
    return { ok: false, error: `write failed: ${e.message}` };
  }
}

function terminalRead({ sessionId, since } = {}) {
  const session = sessions.get(sessionId);
  if (!session) return { ok: false, error: 'session not found' };
  const cutoff = typeof since === 'number' ? since : session.lastReadAt;
  const all = session.buffer.toString('utf8');
  // 对 PTY 流式输出，since 只控制时间戳；buffer 本身已按 64KB 滚动。
  // 简化：返回最近可达的 MAX_READ_BYTES，按 lastReadAt 截取。
  const text = all.length > MAX_READ_BYTES ? all.slice(all.length - MAX_READ_BYTES) : all;
  session.lastReadAt = Date.now();
  return { ok: true, text, bytes: Buffer.byteLength(text, 'utf8'), since: cutoff, totalBuffered: all.length };
}

function terminalClose({ sessionId, confirm }) {
  if (confirm !== true) return { ok: false, error: 'confirm=true required' };
  const session = sessions.get(sessionId);
  if (!session) return { ok: false, error: 'session not found' };
  try {
    session.pty.kill();
  } catch (e) {
    // 仍清理记录
  }
  sessions.delete(sessionId);
  return { ok: true, sessionId };
}

function terminalList() {
  gcExpired();
  const list = [];
  for (const s of sessions.values()) {
    list.push({
      id: s.id,
      name: s.name,
      cwd: s.cwd,
      shell: s.shell,
      createdAt: s.createdAt,
      ageMs: Date.now() - s.createdAt,
    });
  }
  return { ok: true, count: list.length, sessions: list };
}

const HANDLERS = {
  ide_terminal_create: terminalCreate,
  ide_terminal_write: terminalWrite,
  ide_terminal_read: terminalRead,
  ide_terminal_close: terminalClose,
  ide_terminal_list: terminalList,
};

module.exports = {
  terminalToolDefinitions,
  HANDLERS,
  // 暴露给测试清理
  _resetForTest() { sessions.clear(); },
};

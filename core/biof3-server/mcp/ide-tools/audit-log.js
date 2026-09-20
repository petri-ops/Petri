/**
 * core/biof3-server/mcp/ide-tools/audit-log.js
 *
 * IDE MCP 工具操作审计日志。
 * 所有 IDE 工具调用（成功 / 失败）必须经过该日志。
 * 写入 ~/.biof3/logs/ide-tools.log，每次一行 JSON。
 *
 * 设计依据：G0-IDE-MCP-TOOLS §4.2，复用既有 ~/.biof3/logs/ 目录。
 *
 * 日志行结构（JSON Lines）：
 * {
 *   "ts": "2026-08-14T10:00:00.000Z",
 *   "tool": "ide_file_write",
 *   "args": { "path": "/abs/path", "mode": "overwrite" },
 *   "ok": true,
 *   "durationMs": 12,
 *   "error": null
 * }
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { BIOF3_LOG_DIR } = require('./path-allowlist');

const LOG_PATH = path.join(BIOF3_LOG_DIR, 'ide-tools.log');

function ensureDir() {
  if (!fs.existsSync(BIOF3_LOG_DIR)) {
    fs.mkdirSync(BIOF3_LOG_DIR, { recursive: true });
  }
}

/**
 * 记录一次工具调用。失败也必须记录（便于审计）。
 *
 * @param {object} params
 * @param {string} params.tool - 工具名
 * @param {object} [params.args] - 工具参数（路径会被保留为用户原始输入）
 * @param {boolean} params.ok - 是否成功
 * @param {number} params.durationMs - 耗时
 * @param {string|null} [params.error] - 错误信息
 */
function record({ tool, args, ok, durationMs, error = null }) {
  try {
    ensureDir();
    const entry = {
      ts: new Date().toISOString(),
      tool,
      args: sanitizeArgs(args),
      ok,
      durationMs,
      error,
    };
    fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + '\n', 'utf8');
  } catch (e) {
    // 审计日志失败不应阻塞主流程；只在 stderr 打印
     
    console.error('[ide-tools audit] failed to write audit log:', e.message);
  }
}

/**
 * 脱敏：避免把 content（可能含大段文件内容）写入审计日志。
 * 只保留 path / mode / recursive 等元数据字段。
 */
function sanitizeArgs(args) {
  if (!args || typeof args !== 'object') return args;
  const out = {};
  for (const [k, v] of Object.entries(args)) {
    if (k === 'content') {
      out.contentLength = typeof v === 'string' ? v.length : 0;
      out.contentTruncated = false;
    } else if (k === 'command') {
      out.commandLength = typeof v === 'string' ? v.length : 0;
      out.commandPreview = typeof v === 'string' ? v.slice(0, 80) : null;
    } else {
      out[k] = v;
    }
  }
  return out;
}

module.exports = {
  record,
  LOG_PATH,
};

'use strict';

/**
 * helpers/mcp-config-import.js — MCP 配置文件导入（BLOCK-160 W2 P5/DIST-2）。
 *
 * 形态：{ servers: [...] } 或裸数组（Claude Desktop/Cursor 导出物常为裸数组）。
 * 逐条经 mcp-settings.upsertMcpServer（normalize + CAP-2 env 落盘加密）；
 * 坏条目不阻断整批——skipped 诚实列出（id+原因）。env 值字符串过滤同 normalize。
 */

const fs = require('fs');
const settings = require('./mcp-settings');

function importMcpConfigFile(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return { ok: false, error: 'file_path_required' };
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return { ok: false, error: 'config_file_unreadable', message: e.message };
  }
  const servers = Array.isArray(parsed)
    ? parsed
    : (parsed && Array.isArray(parsed.servers) ? parsed.servers : null);
  if (!servers) {
    return { ok: false, error: 'config_shape_invalid', message: '配置需为 {servers:[…]} 或 server 数组' };
  }
  let imported = 0;
  const skipped = [];
  for (const entry of servers) {
    const id = entry && typeof entry.id === 'string' ? entry.id : '(unnamed)';
    const result = settings.upsertMcpServer(entry);
    if (result.error) {
      skipped.push({ id, error: result.error });
    } else {
      imported++;
    }
  }
  return { ok: true, imported, skipped, total: servers.length };
}

module.exports = { importMcpConfigFile };

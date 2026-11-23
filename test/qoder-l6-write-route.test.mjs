/**
 * QODER-L6 写路由 — HK-01 契约（2026-11-23）。
 *
 * 用户「后面还有哪些能一次搞定」→ L6 最后一项集成：P1 plugin-lifecycle-audit.js
 * 接成 GET 统一投影 + POST 追加 JSONL 路由。红线：不读写凭据/不改 handler/
 * 投影不承载信任真源（不随配置导出）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('L6 写路由文件存在且消费 P1 核心', () => {
  const route = path.join(ROOT, 'core/petri-server/routes/plugin-lifecycle-audit.js');
  assert.ok(fs.existsSync(route), '须有 plugin-lifecycle-audit 路由');
  const s = fs.readFileSync(route, 'utf8');
  assert.match(s, /plugin-lifecycle-audit\.js|projectUnifiedAudit|formatAuditEvent/, '须消费 P1 投影/格式化');
});

test('路由注册：GET 只读投影 + POST 追加，注册到 routes/index', () => {
  const s = read('core/petri-server/routes/plugin-lifecycle-audit.js');
  assert.match(s, /app\.get\(/, '须有 GET 只读路由');
  assert.match(s, /app\.post\(/, '须有 POST 追加路由');
  assert.match(s, /appendFileSync/, 'POST 须追加 JSONL（非覆盖）');
  const index = read('core/petri-server/routes/index.js');
  assert.match(index, /plugin-lifecycle-audit/, '须注册到 routes/index');
});

test('只读投影不泄漏凭据/信任真源', () => {
  const s = read('core/petri-server/routes/plugin-lifecycle-audit.js');
  assert.match(s, /formatAuditEvent/, '写入须经脱敏格式化');
  assert.doesNotMatch(s, /require\([^)]*mcp-oauth|decryptTokens|readTokens/, '不得 require/调用凭据存储');
});

test('红线：信任策略/凭据 handler 未改', () => {
  const policy = read('core/petri-server/helpers/mcp-server-policy.js');
  const store = read('core/petri-server/helpers/mcp-oauth-store.js');
  assert.match(policy, /trust/);
  assert.match(store, /encryptTokens/);
});

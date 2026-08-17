/**
 * Phase 1 — result-handlers C-002 validTypes 修复
 *
 * 验证：
 *   1) result:create 的 validTypes 包含 'conversation_export'
 *   2) createFromConversation 实际使用 'conversation_export'（不再走 'text' 兜底）
 *
 * 策略：解析 src/ipc/result-handlers.js 文本，
 *   - 对 result:create handler 抽出 validTypes 数组
 *   - 对 createFromConversation handler 检查 createResult 的 type 实参
 *
 * 不 require 整个文件（避免 better-sqlite3 native binding 在测试机缺失），
 * 直接源码级断言 — 与现有 test/window-controls.test.mjs / test/preload-* 风格一致。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RESULT_HANDLERS = readFileSync(
  path.join(ROOT, 'src/ipc/result-handlers.js'),
  'utf8',
);

/**
 * 在指定 marker 之后抽取一个字符串字面量数组（含单引号）。
 * 例如: const validTypes = ['chart', 'table', ...];
 * 找到第一个 `[` 与匹配的 `]`，内部按 `', '` split + 去掉单引号。
 */
function extractStringArray(source, afterMarker) {
  const start = source.indexOf(afterMarker);
  assert.ok(start >= 0, `expected source to contain ${afterMarker}`);
  const bracketStart = source.indexOf('[', start);
  assert.ok(bracketStart >= 0, `expected [ after ${afterMarker}`);
  // 简单 bracket 匹配（数组里没有嵌套 [ ]）
  const bracketEnd = source.indexOf(']', bracketStart);
  assert.ok(bracketEnd >= 0, `expected ] for array after ${afterMarker}`);
  const raw = source.slice(bracketStart + 1, bracketEnd);
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^['"]|['"]$/g, ''));
}

test("C-002: result:create validTypes includes 'conversation_export'", () => {
  // 第一个 validTypes（在 result:create handler 里）的数组
  const createHandlerIdx = RESULT_HANDLERS.indexOf("ipcMain.handle('result:create'");
  assert.ok(createHandlerIdx >= 0, 'result:create handler must exist');
  // 只在 createHandler 之后 + before result:createWithBranch 之前扫描
  const createWithBranchIdx = RESULT_HANDLERS.indexOf(
    "ipcMain.handle('result:createWithBranch'",
  );
  assert.ok(createWithBranchIdx >= 0, 'result:createWithBranch handler must exist');
  assert.ok(createHandlerIdx < createWithBranchIdx, 'handler order sanity');

  const segment = RESULT_HANDLERS.slice(createHandlerIdx, createWithBranchIdx);
  const validTypes = extractStringArray(segment, 'const validTypes =');
  assert.ok(
    validTypes.includes('conversation_export'),
    `validTypes must include 'conversation_export' (got: ${validTypes.join(', ')})`,
  );
  // 兼容性：原 5 个仍在
  for (const t of ['chart', 'table', 'code', 'text', 'file']) {
    assert.ok(validTypes.includes(t), `validTypes must still include '${t}'`);
  }
});

test('C-002: createFromConversation persists as conversation_export, not text', () => {
  // 抽 ipcMain.handle('result:createFromConversation', ...) 函数体
  const marker = "ipcMain.handle('result:createFromConversation'";
  const start = RESULT_HANDLERS.indexOf(marker);
  assert.ok(start >= 0, 'createFromConversation handler must exist');
  const bodyStart = RESULT_HANDLERS.indexOf('=>', start);
  assert.ok(bodyStart >= 0);
  const openBrace = RESULT_HANDLERS.indexOf('{', bodyStart);
  assert.ok(openBrace >= 0);

  // brace matching — 简单 depth 跟踪
  let depth = 0;
  let quote = null;
  let escaped = false;
  let bodyEnd = -1;
  for (let i = openBrace; i < RESULT_HANDLERS.length; i += 1) {
    const ch = RESULT_HANDLERS[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        bodyEnd = i + 1;
        break;
      }
    }
  }
  assert.ok(bodyEnd > openBrace, 'must find end of createFromConversation body');
  const body = RESULT_HANDLERS.slice(openBrace, bodyEnd);

  // createResult(...) 的 type 实参必须是 'conversation_export'
  // 找到 createResult( 后面第一个 ' 包裹的字面量
  const createCall = body.indexOf('createResult(');
  assert.ok(createCall >= 0, 'must call createResult');
  const typeArgIdx = body.indexOf("'", createCall);
  assert.ok(typeArgIdx > 0);
  const typeArgEnd = body.indexOf("'", typeArgIdx + 1);
  const typeArg = body.slice(typeArgIdx + 1, typeArgEnd);
  assert.equal(
    typeArg,
    'conversation_export',
    `createFromConversation must persist type 'conversation_export', got '${typeArg}'`,
  );
});
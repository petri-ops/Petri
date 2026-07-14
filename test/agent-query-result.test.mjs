import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const R_SERVER = resolve(__dirname, '..', 'vendor', 'biof3-core', 'r-server');
const { localizeToolResult } = require(R_SERVER + '/helpers/system-prompt.js');
const { tool_query } = require(R_SERVER + '/agent-tools/query-tools.js');

test('空工具结果会归一化为可序列化的 not_found', () => {
  const result = localizeToolResult(undefined);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'not_found');
  assert.doesNotThrow(() => JSON.stringify(result).length);
});

test('按错误 tool job id 查询 analyses 返回结构化 not_found', async () => {
  const result = await tool_query(
    { resource: 'analyses', id: 'tj_not_an_analysis' },
    { userId: 'local-user' },
  );
  assert.equal(result.error, 'analysis_not_found');
  assert.equal(result.id, 'tj_not_an_analysis');
});

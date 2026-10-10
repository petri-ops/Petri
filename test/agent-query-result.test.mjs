import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// BLOCK-49 加映清债 —— 统一临时 DB 自举（存量：单跑/全量缺 projects 表）
//（PETRI_DB_PATH 须在 require db.js 前生效；与 agent-tool-registry.test 同一修法）
{
  const fsx = require('node:fs');
  const osx = require('node:os');
  const pth = require('node:path');
  const urlx = require('node:url');
  const hereDir = pth.dirname(urlx.fileURLToPath(import.meta.url));
  const Database = require(pth.resolve(hereDir, '..', 'core', 'petri-server', 'node_modules', 'better-sqlite3'));
  const tempDbDir = fsx.mkdtempSync(pth.join(osx.tmpdir(), 'petri-sweep-db-'));
  const boot = new Database(pth.join(tempDbDir, 'petri.db'));
  const migrationsDir = pth.resolve(hereDir, '..', 'src', 'migrations');
  for (const f of fsx.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(fsx.readFileSync(pth.join(migrationsDir, f), 'utf8'));
  }
  boot.close();
  process.env.PETRI_DB_PATH = pth.join(tempDbDir, 'petri.db');
  process.on('exit', () => { try { fsx.rmSync(tempDbDir, { recursive: true, force: true }); } catch {} });
}
const R_SERVER = resolve(__dirname, '..', 'core', 'petri-server');
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

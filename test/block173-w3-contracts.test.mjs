// BLOCK-173 W3 契约（CP-8 spawn 可配 + CP-10 tool-route 转正）。
// CP-9 编排图为前端组件契约（useAppCommands 同目录另册）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import fssync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 统一临时 DB 自举（spawn-agent-tools require 链触发 agent-task-store schema）
{
  const pth = require('node:path');
  const Database = require(pth.resolve(ROOT, 'core', 'petri-server', 'node_modules', 'better-sqlite3'));
  const tempDbDir = fssync.mkdtempSync(path.join(os.tmpdir(), 'petri-b173-db-'));
  const boot = new Database(pth.join(tempDbDir, 'petri.db'));
  const migrationsDir = pth.resolve(ROOT, 'src', 'migrations');
  for (const f of fssync.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(fssync.readFileSync(pth.join(migrationsDir, f), 'utf8'));
  }
  boot.close();
  process.env.PETRI_DB_PATH = pth.join(tempDbDir, 'petri.db');
  // CP-10 契约用干净决策配置（无 stored 显式关）——隔离本机真实配置
  process.env.PETRI_DECISION_CONFIG_PATH = pth.join(tempDbDir, 'decision-config.json');
  process.on('exit', () => { try { fssync.rmSync(tempDbDir, { recursive: true, force: true }); } catch {} });
}

test('CP-8：并发上限 env 钳制（1-8；缺省 3；非法回 3）', () => {
  delete process.env.PETRI_SPAWN_CONCURRENCY_LIMIT;
  const mod = require('../core/petri-server/agent-tools/spawn-agent-tools.js');
  const resolve = mod.resolveSpawnConcurrencyLimit;
  assert.equal(resolve(), 3, '缺省 3=既有保守值');
  process.env.PETRI_SPAWN_CONCURRENCY_LIMIT = '5';
  assert.equal(resolve(), 5);
  process.env.PETRI_SPAWN_CONCURRENCY_LIMIT = '12';
  assert.equal(resolve(), 8, '钳制上限 8');
  process.env.PETRI_SPAWN_CONCURRENCY_LIMIT = '0';
  assert.equal(resolve(), 1, '钳制下限 1');
  process.env.PETRI_SPAWN_CONCURRENCY_LIMIT = 'abc';
  assert.equal(resolve(), 3, '非法回缺省');
  delete process.env.PETRI_SPAWN_CONCURRENCY_LIMIT;
});

test('CP-8：深度解析 env 钳制（缺省 1=现状；上限 3 防环有界）', () => {
  delete process.env.PETRI_SPAWN_MAX_DEPTH;
  const mod = require('../core/petri-server/agent-tools/spawn-agent-tools.js');
  const resolve = mod.resolveSpawnMaxDepth;
  assert.equal(resolve(), 1, '缺省 1=「子不可再生子」现状');
  process.env.PETRI_SPAWN_MAX_DEPTH = '2';
  assert.equal(resolve(), 2);
  process.env.PETRI_SPAWN_MAX_DEPTH = '9';
  assert.equal(resolve(), 3, '上限 3');
  process.env.PETRI_SPAWN_MAX_DEPTH = '0';
  assert.equal(resolve(), 1);
  delete process.env.PETRI_SPAWN_MAX_DEPTH;
});

test('CP-8：spawn_agent 深度闸在源码层接线（maxDepth 闸+父链校验）', () => {
  const source = readFileSync(path.join(ROOT, 'core', 'petri-server', 'agent-tools', 'spawn-agent-tools.js'), 'utf8');
  assert.match(source, /resolveSpawnMaxDepth\(\)/);
  assert.match(source, /spawn_depth_exceeded/);
  assert.match(source, /resolveSpawnConcurrencyLimit\(\)/);
});

test('CP-10：tool-route defaultOn=true 且解析为默认启用（无 stored/env）', () => {
  process.env.PETRI_JEV_TOOL_ROUTE = '';
  const config = require('../core/petri-server/helpers/decision-config.js');
  const runtime = config.getPointRuntime('tool-route');
  assert.equal(runtime.enabled, true, '转正：无配置默认启用');
  const configs = config.getAllPointConfigs();
  const toolRoute = configs.find((p) => p.point === 'tool-route');
  assert.equal(toolRoute.enabled, true);
  // 其他接点不受牵连：knowledge-guard 仍默认关
  const kg = config.getPointRuntime('knowledge-guard');
  assert.equal(kg.enabled, false, '非 defaultOn 接点维持显式才启用');
});

test('CP-10：env 杀开关仍最高（PETRI_JEV_TOOL_ROUTE=0 → off）', () => {
  process.env.PETRI_JEV_TOOL_ROUTE = '0';
  const config = require('../core/petri-server/helpers/decision-config.js');
  assert.equal(config.getPointRuntime('tool-route').enabled, false);
  process.env.PETRI_JEV_TOOL_ROUTE = '1';
  assert.equal(config.getPointRuntime('tool-route').enabled, true);
  delete process.env.PETRI_JEV_TOOL_ROUTE;
});

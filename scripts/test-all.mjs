#!/usr/bin/env node
/**
 * scripts/test-all.mjs — BLOCK-511 S2.2 全量 Node 测试递归入口。
 *
 * 替代原 `test/*.test.mjs test/*.test.cjs` 顶层 glob（漏掉 test/scripts/ 子目录与
 * .test.js）。递归枚举 test/ 下全部 *.test.{mjs,cjs,js}，按 BLOCK-359 实测教训
 * 逐文件进程隔离执行（--test-concurrency=1），避免单命令大清单并行挂起。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_DIR = path.join(ROOT, 'test');

function listNodeTests(dir = TEST_DIR) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listNodeTests(full));
    else if (entry.isFile() && /\.test\.(mjs|cjs|js)$/.test(entry.name)) out.push(full);
  }
  return out.sort();
}

const files = listNodeTests();
const args = ['--test', '--test-force-exit', '--test-timeout=120000', '--test-concurrency=1', ...files];
const result = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: ROOT });
process.exit(result.status == null ? 1 : result.status);

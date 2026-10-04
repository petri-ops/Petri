#!/usr/bin/env node
/**
 * test-files.mjs — `npm run test:files` 的入参归一化包装。
 *
 * 背景（BLOCK-139 P0 定向门禁第 1 轮实测红）：定向门禁以 **repo 相对路径**
 * （`frontend/src/...`）作 vitest filter，而 vitest root 是 `frontend/`
 * （include 匹配 src 目录树下的 *.test.{ts,tsx}），带前缀的 filter 匹配不到任何文件，
 * vitest 以 `No test files found` 退出码 1 收场。仓库既有约定
 * （scripts/test-affected.mjs 在分流前 `test.replace(/^frontend\//, '')`；
 * 根 package.json 各 g0 脚本用裸文件名 / frontend 相对路径）是
 * 「test:files 收 frontend 相对路径」，本包装把 repo 相对路径这一形态
 * 也归一化进来，三种形态等价可跑：
 *   npm run test:files -- src/lib/foo.test.ts            （frontend 相对，既有）
 *   npm run test:files -- foo.test.ts                    （裸文件名，既有）
 *   npm run test:files -- frontend/src/lib/foo.test.ts   （repo 相对，门禁形态）
 *
 * 其余参数原样透传；行为只是路径归一化，不改变 vitest 的选择与执行语义。
 */
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const args = process.argv.slice(2).map((arg) => {
  if (typeof arg !== 'string') return arg;
  // 仅剥「frontend/」这一目录前缀（repo 相对 → frontend 相对）；
  // 裸文件名与 frontend 相对路径不含该前缀，原样透传。
  return arg.replace(/^frontend\//, '');
});

const result = spawnSync('npx', ['vitest', 'run', ...args], {
  stdio: 'inherit',
  cwd: new URL('..', import.meta.url),
  shell: process.platform === 'win32',
  env: process.env,
});

process.exit(result.status ?? 1);

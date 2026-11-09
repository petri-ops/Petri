#!/usr/bin/env node
/**
 * scripts/user-asset-guard.mjs — 在制用户资产 / 临时目录「零入库」机械门
 * （BLOCK-393 · 同类第二次转门禁：34076352 + 932b9136 两次 `git add -A docs`
 *  把 docs/pelican-bicycle.html 误提交；上次只写了教训，这次把教训落成门）。
 *
 * 判红条件：清单里的路径（精确文件 / 目录前缀）出现在
 *   ① `git ls-files`（已入库）或 ② `git diff --cached --name-only`（已暂存）任一侧。
 * 只报告，不代删、不代撤索引——撤回需人工 `git rm --cached`（保留磁盘文件）。
 *
 * 用法：node scripts/user-asset-guard.mjs [--check] [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, 'test', 'user-asset-guard-baseline.json');

export function matchProtected(relativePath, protectedPaths) {
  const normalized = String(relativePath).replace(/\\/g, '/').replace(/^\.\//, '');
  return protectedPaths.find((entry) => {
    const p = String(entry).replace(/\\/g, '/');
    return p.endsWith('/') ? normalized === p.slice(0, -1) || normalized.startsWith(p) : normalized === p;
  }) ?? null;
}

export function evaluateIndex({ trackedPaths, stagedPaths, protectedPaths }) {
  const hits = [];
  const seen = new Set();
  for (const [source, list] of [['tracked', trackedPaths], ['staged', stagedPaths]]) {
    for (const file of list) {
      const matched = matchProtected(file, protectedPaths);
      if (!matched) continue;
      const key = `${source}:${file}:${matched}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ source, file, protectedPath: matched });
    }
  }
  return { ok: hits.length === 0, hits };
}

function gitLines(args) {
  try {
    const out = execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
    return out.split('\n').map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export function collectIndexState() {
  return {
    trackedPaths: gitLines(['ls-files']),
    stagedPaths: gitLines(['diff', '--cached', '--name-only', '--diff-filter=ACMRT']),
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const state = collectIndexState();
  const result = evaluateIndex({ ...state, protectedPaths: baseline.paths });
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ ...result, protectedPathCount: baseline.paths.length }, null, 2));
  } else if (result.ok) {
    console.log(`[user-asset-guard] PASS — ${baseline.paths.length} 项受保护路径未入库/未暂存（tracked=${state.trackedPaths.length} staged=${state.stagedPaths.length}）`);
  } else {
    console.error('[user-asset-guard] FAIL 受保护用户资产出现在 git 索引：');
    for (const hit of result.hits) {
      console.error(`  - [${hit.source}] ${hit.file}  ← 清单 ${hit.protectedPath}`);
    }
    console.error('处置：git rm --cached <path>（磁盘文件保留），禁止覆盖/暂存/删除未知 WIP。');
  }
  process.exitCode = result.ok ? 0 : 1;
}

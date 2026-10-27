/**
 * scripts/lib/changed-files.mjs — git 变更文件收集（BLOCK-272 从 test-affected.mjs 提取）
 *
 * 单一真相：test-affected（test:changed）与 gate-skip-state（收口域跳过）共用同一收集口径，
 * 避免两处 git diff 并集口径漂移。行为与原实现逐字节等价（4 路并集 + 排序）。
 */
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function normalizePath(value) { return value.replaceAll('\\', '/').replace(/^\.\//, ''); }

export function runGit(args, { root = ROOT } = {}) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' })
    .split(/\r?\n/).map((line) => normalizePath(line.trim())).filter(Boolean);
}

export function currentHead({ root = ROOT } = {}) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}

export function collectChangedFiles({ base = null, explicit = [], root = ROOT } = {}) {
  if (explicit.length) return [...new Set(explicit.map(normalizePath))].sort();
  const files = new Set();
  if (base) runGit(['diff', '--name-only', '--diff-filter=ACMR', `${base}...HEAD`], { root }).forEach((file) => files.add(file));
  runGit(['diff', '--name-only', '--diff-filter=ACMR'], { root }).forEach((file) => files.add(file));
  runGit(['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { root }).forEach((file) => files.add(file));
  runGit(['ls-files', '--others', '--exclude-standard'], { root }).forEach((file) => files.add(file));
  return [...files].sort();
}

#!/usr/bin/env node
/**
 * K-05 复发防护：lint 扫描根 ∩ hygiene 报告的未跟踪临时产物 对账门。
 *
 * 复发经过（同类第二次，按评审 skill「回归→门禁转化」）：
 *   BLOCK-394/395 取样时 `tmp-b22-complete.mjs:30` 与 `errorMessages.ts:19,44`
 *   两轮错误源漂移，根因是 untracked 临时脚本进入 eslint 扫描面；
 *   hygiene:check 只报告不拦截，且无机器可读输出（stdout 截断 30 条）。
 *
 * 本门自带 `git ls-files --others --exclude-standard` 全量枚举（不解析 stdout），
 * 判定「临时产物形态 ∩ lint 可扫描后缀」即红；用户资产由
 * test/user-asset-guard-baseline.json 的 9 项路径精确豁免（不新建第二清单）。
 *
 * 纯函数 evaluateOverlap() 不读写外部状态，供负测注入。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// 与 .agents/skills/petri-dev-infra/scripts/hygiene-check.mjs:65-75 的 TEMP_PATTERNS 同族
export const TEMP_PATTERNS = Object.freeze([
  /^tmp-/, /^temp-/, /\.tmp\./, /^nul$/, /^tmp\//, /^temp\//,
  /-complete\.mjs$/, /-probe\.mjs$/, /^tmp-.*\.(mjs|cjs|js|ts|tsx)$/,
]);
export const LINT_SCANNABLE = Object.freeze(/\.(mjs|cjs|js|ts|tsx|jsx)$/);

export function isTempArtifact(rel) {
  return TEMP_PATTERNS.some((re) => re.test(rel));
}

export function isLintScannable(rel) {
  return LINT_SCANNABLE.test(rel) &&
    !/^(node_modules|dist|build|release|core\/petri-server\/build)\//.test(rel);
}

/** 9 项受保护用户资产精确/前缀豁免（单一真相源 = user-asset-guard baseline）。 */
export function protectedPaths(root = ROOT) {
  const b = JSON.parse(fs.readFileSync(path.join(root, 'test/user-asset-guard-baseline.json'), 'utf8'));
  return b.paths;
}

export function isProtected(rel, protectedList) {
  return protectedList.some((p) => (p.endsWith('/') ? rel.startsWith(p) : rel === p));
}

/**
 * 纯函数裁决：untracked 里若有「临时产物 ∧ 可 lint 扫描 ∧ 非受保护」即 FAIL。
 * 同时校验 protectedList 非空（防止 exemption 被清空形成假绿）。
 */
export function evaluateOverlap({ untracked, protectedList }) {
  const issues = [];
  if (!Array.isArray(untracked)) return { ok: false, issues: ['untracked 非数组'], offenders: [], verdict: 'fail-closed' };
  if (!Array.isArray(protectedList) || protectedList.length === 0) {
    return { ok: false, issues: ['受保护路径清单为空：拒绝空豁免形成假绿'], offenders: [], verdict: 'fail-closed' };
  }
  const offenders = untracked.filter((f) => isTempArtifact(f) && isLintScannable(f) && !isProtected(f, protectedList));
  if (offenders.length) issues.push(`临时产物进入 lint 扫描面: ${offenders.join(', ')}`);
  return {
    ok: issues.length === 0,
    issues,
    offenders,
    verdict: issues.length === 0 ? 'no-overlap' : 'lint-hygiene-overlap',
  };
}

export function collectUntracked(root = ROOT) {
  const out = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' });
  return out.split('\0').filter(Boolean).sort();
}

function main() {
  const untracked = collectUntracked();
  const protectedList = protectedPaths();
  const verdict = evaluateOverlap({ untracked, protectedList });
  console.log(JSON.stringify({
    kind: 'post-h9-k0-lint-hygiene-overlap',
    untrackedCount: untracked.length,
    protectedCount: protectedList.length,
    ...verdict,
  }, null, 2));
  if (!verdict.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(`[post-h9:k0-overlap] fail-closed: ${e.message}`); process.exitCode = 1; }
}

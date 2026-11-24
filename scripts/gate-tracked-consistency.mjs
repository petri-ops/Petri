#!/usr/bin/env node
/**
 * gate:tracked-consistency — 已跟踪文件引用的仓库内路径必须存在且已跟踪（BLOCK-511 S2.4）。
 *
 * 覆盖：
 *  ① test/impact-map.json 每条 rule.tests 与「具体路径」patterns（非 glob/非目录）；
 *  ② package.json scripts 中字面量指向的仓库内脚本/测试文件（scripts/*.{mjs,cjs,js,sh}、test/*.test.*）。
 * 在制未入库项走带 owner/date/reason 的豁免基线（acceptance/panoramic-remediation-2026-11-24/
 * tracked-consistency-exemptions.json），只减不增语义：新豁免须显式登记、不得自动添加。
 *
 * 用法：node scripts/gate-tracked-consistency.mjs [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXEMPTIONS = path.join(ROOT, 'acceptance/panoramic-remediation-2026-11-24/tracked-consistency-exemptions.json');
const MAP = path.join(ROOT, 'test/impact-map.json');
const PKG = path.join(ROOT, 'package.json');
const SRC_ROOTS = /^(test|src|core|frontend|scripts|docs)\//;

export function analyze({ tracked, map, pkg, exemptions } = {}) {
  const refs = [];
  const testsSet = new Set(tracked || []);

  // ① impact-map
  for (const rule of map.rules || []) {
    for (const t of rule.tests || []) {
      if (typeof t === 'string' && t.startsWith('test/')) refs.push({ source: `${rule.id}.tests`, path: t });
    }
    for (const p of rule.patterns || []) {
      if (typeof p !== 'string' || !SRC_ROOTS.test(p)) continue;
      if (/[*{}?]/.test(p) || p.endsWith('/')) continue; // glob/目录跳过
      refs.push({ source: `${rule.id}.patterns`, path: p });
    }
  }

  // ② package.json scripts 字面量文件目标
  for (const [name, cmd] of Object.entries(pkg.scripts || {})) {
    if (typeof cmd !== 'string') continue;
    const re = /((?:scripts|test)\/[A-Za-z0-9_./-]+\.(?:mjs|cjs|json|tsx|js|sh|ts)(?![A-Za-z]))|(\.?\/?(?:src|core|frontend|docs)\/[A-Za-z0-9_./-]+\.(?:mjs|cjs|json|tsx|js|ts)(?![A-Za-z]))/g;
    for (const m of cmd.matchAll(re)) {
      const p = (m[1] || m[2] || '').replace(/^\.\//, '');
      if (p) refs.push({ source: `package.json#${name}`, path: p });
    }
  }

  const exempt = new Set((exemptions?.items || []).map((x) => x.path));
  // 脚本目标的工作目录可能是 frontend/（--prefix frontend）或 .agents/skills/*/（skill 自带脚本）；
  // 这些前缀下存在的路径视为已解析，不算违规。
  const resolvedElsewhere = (p) =>
    testsSet.has(`frontend/${p}`) || [...testsSet].some((f) =>
      (f.startsWith('.agents/skills/') || f.includes('/.agents/skills/')) && f.endsWith(`/${p}`));
  const violations = refs.filter((r) =>
    !testsSet.has(r.path) && !exempt.has(r.path) && !resolvedElsewhere(r.path));
  return { refs: refs.length, violations: violations.map((v) => ({ ...v, reason: 'not tracked' })) };
}

function main() {
  const tracked = new Set(execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter(Boolean));
  const map = JSON.parse(fs.readFileSync(MAP, 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));
  const exemptions = fs.existsSync(EXEMPTIONS) ? JSON.parse(fs.readFileSync(EXEMPTIONS, 'utf8')) : { items: [] };
  const result = analyze({ tracked, map, pkg, exemptions });
  if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
  if (result.violations.length) {
    console.error(`[tracked-consistency] FAIL：${result.violations.length} 处已跟踪文件引用了未跟踪路径：`);
    for (const v of result.violations.slice(0, 60)) console.error(`  - ${v.source} -> ${v.path}`);
    process.exitCode = 1;
  } else {
    console.log(`[tracked-consistency] PASS — ${result.refs} 处引用全部存在且已跟踪`);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();

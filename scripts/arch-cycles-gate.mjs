#!/usr/bin/env node
'use strict';

/**
 * scripts/arch-cycles-gate.mjs — 循环依赖硬门禁（BLOCK-109-CORE-ARCH P3-2）
 *
 * forbidCycles（dependency-cruiser circular 规则）+ 存量环基线：
 *   - 规则：src/core/frontend/src 全量 cruise，circular 即违规；
 *   - 基线：acceptance/block-109/arch-cycles-baseline.json 逐环签名入册
 *     （环链按字典序旋转规范化，同环不同起点同签名）；基线外的**新环即红**；
 *   - --write 重打基线（=存量环确认，须随提交登记理由）。
 *
 * 自测：test/block109-p3-gates.test.mjs 调用 extractCycleSignatures/computeGate。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// BLOCK-272：cruise 走共享单轮（与 quality:arch 合并配置一次执行），消除同轮二次全量 cruise。
// 独立运行（无 PETRI_CLOSEOUT_RUN_ID）时不读不写缓存，行为等同原实现。
import { runSharedCruise } from './lib/arch-cruise.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, 'acceptance', 'block-109', 'arch-cycles-baseline.json');

/** 环链 → 规范化签名：按字典序旋转到最小模块开头后 join。 */
export function cycleSignature(cycleNames) {
  if (!Array.isArray(cycleNames) || cycleNames.length === 0) return String(cycleNames);
  let minIdx = 0;
  for (let i = 1; i < cycleNames.length; i++) {
    if (cycleNames[i] < cycleNames[minIdx]) minIdx = i;
  }
  const rotated = [];
  for (let i = 0; i < cycleNames.length; i++) rotated.push(cycleNames[(minIdx + i) % cycleNames.length]);
  return rotated.join(' -> ');
}

/** depcruise JSON 输出 → 环签名集合（去重排序）。 */
export function extractCycleSignatures(violations) {
  const sigs = new Set();
  for (const v of violations || []) {
    if (!v || !v.rule || !/cycle/i.test(v.rule.name || '')) continue;
    const chain = Array.isArray(v.cycle) ? v.cycle.map((m) => (typeof m === 'string' ? m : m && m.name)).filter(Boolean) : [];
    if (chain.length > 0) sigs.add(cycleSignature(chain));
  }
  return [...sigs].sort();
}

export function computeGate({ current, baseline }) {
  const known = new Set(baseline.cycles || []);
  const newCycles = current.filter((s) => !known.has(s));
  return {
    ok: newCycles.length === 0,
    newCycles,
    resolved: (baseline.cycles || []).filter((s) => !current.includes(s)),
  };
}

function cruiseCycles() {
  const { violations, cached } = runSharedCruise();
  if (cached) console.error('[arch-cycles] cruise 缓存命中（同轮与 quality:arch 共享）');
  return extractCycleSignatures(violations);
}

const args = process.argv.slice(2);
const current = cruiseCycles();

if (args.includes('--check')) {
  let baseline;
  try {
    baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  } catch {
    console.error(`[arch-cycles] FAIL 基线不可读: ${BASELINE}`);
    process.exit(1);
  }
  const gate = computeGate({ current, baseline });
  if (!gate.ok) {
    console.error('[arch-cycles] FAIL 发现基线外新环：');
    for (const s of gate.newCycles) console.error(`  - ${s}`);
    process.exit(1);
  }
  if (gate.resolved.length > 0) {
    console.log(`[arch-cycles] PASS（${current.length} 存量环在册；${gate.resolved.length} 个已消亡——建议 --write 收紧基线）`);
  } else {
    console.log(`[arch-cycles] PASS（${current.length} 存量环在册，无新环）`);
  }
  process.exit(0);
}

if (args.includes('--write')) {
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
  fs.writeFileSync(
    BASELINE,
    JSON.stringify({ schema: 'petri/block109-arch-cycles.v1', note: 'P3-2：存量循环依赖逐环签名入册（规范化=环链旋转到字典序最小模块）；新环即红；消亡环应随 --write 收紧。', cycles: current }, null, 2) + '\n',
  );
  console.log(`[arch-cycles] 基线已写入（${current.length} 环）`);
  process.exit(0);
}

console.log(JSON.stringify(current, null, 2));

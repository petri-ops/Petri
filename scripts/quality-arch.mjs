#!/usr/bin/env node
/**
 * scripts/quality-arch.mjs — quality:arch 门禁包装器（BLOCK-272）
 *
 * 替代裸 `depcruise src core frontend/src --config .dependency-cruiser.cjs`：与
 * gate:arch-cycles 共享单轮 cruise（scripts/lib/arch-cruise.mjs），从同一份 JSON
 * 评 R1-R5，消除一次收口内的第二次全量 cruise。退出码语义与裸 depcruise 门禁等价：
 * 0 = 无 R 规则违规；1 = 有违规（有违规时逐规则计数打印，可读性不降）。
 * evaluateArchRules 导出供红绿测试（对标 block154-css-modules-ratchet 纯函数惯例）。
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runSharedCruise } from './lib/arch-cruise.mjs';

const R_RULE = /^R\d-/;

export function evaluateArchRules(violations) {
  const hits = (violations || []).filter((v) => v && v.rule && R_RULE.test(v.rule.name || ''));
  const byRule = {};
  for (const v of hits) byRule[v.rule.name] = (byRule[v.rule.name] || 0) + 1;
  return { ok: hits.length === 0, total: hits.length, byRule, violations: hits };
}

function main() {
  const { violations, cached } = runSharedCruise();
  const result = evaluateArchRules(violations);
  if (!result.ok) {
    console.error('[quality:arch] FAIL 架构规则违规（R1-R5）：');
    for (const [name, count] of Object.entries(result.byRule)) console.error(`  - ${name}: ${count} 处`);
    for (const v of result.violations.slice(0, 10)) {
      console.error(`    ${v.from?.name ?? '?'} -> ${v.to?.name ?? '?'}`);
    }
    process.exit(1);
  }
  console.log(`[quality:arch] PASS（R1-R5 无违规；cruise ${cached ? '缓存命中' : '全新'}）`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main();

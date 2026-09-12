import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { scanDomainResidue, diffAgainstBaseline, DOMAIN_WORDS } from './helpers/domain-scan.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = path.join(root, 'test/domain-neutrality-baseline.json');

/**
 * BLOCK-83 D7：领域中性化棘轮门禁。
 *
 * 判据（机械化「核心无领域词」）：
 *   - 核心生产代码（core/ + frontend/src/ + src/）新增或恶化的领域关键词 → FAIL；
 *   - 清理导致计数下降 → 不 FAIL，但要求同步下调基线（--update），保持基线即真相。
 *
 * 目标形态：本基线最终清空 → 核心对生信（及其它领域）零硬编码，领域能力随包交付。
 */
test('BLOCK-83 D7 core production code has no NEW domain-word residue (ratchet)', () => {
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const current = scanDomainResidue({ root });
  const { regressions, improvements } = diffAgainstBaseline(current, baseline.hits);

  assert.deepEqual(
    baseline.words,
    DOMAIN_WORDS,
    'baseline.words 必须与扫描器词表一致（词表变更需同步刷新基线）',
  );

  const detail = regressions
    .map((r) => `${r.kind}: ${r.key} (now ${r.count}, baseline ${r.baseline})`)
    .join('\n  ');
  assert.equal(
    regressions.length,
    0,
    '核心生产代码出现新的领域词残留——领域能力必须随领域包交付，不得进核心：\n  ' + detail,
  );

  if (improvements.length > 0) {
    const lines = improvements.map((i) => `${i.key} (baseline ${i.baseline} → ${i.count})`).join('\n  ');
    console.log(
      `[domain-neutrality] 残留已减少 ${improvements.length} 处——请运行 ` +
      `\`node scripts/d7-baseline.mjs --update\` 下调基线以保持真相：\n  ` + lines,
    );
  }
});

test('BLOCK-83 D7 scanner is deterministic and scoped to core production code', () => {
  const first = scanDomainResidue({ root });
  const second = scanDomainResidue({ root });
  assert.deepEqual(first, second, '扫描结果必须可复现（确定性）');
  // 插件目录与测试面不得被计入（否则棘轮会因域包内容而假红）
  const keys = Object.keys(first);
  assert.ok(!keys.some((k) => k.startsWith('resources/')), '插件目录不计入核心扫描');
  assert.ok(!keys.some((k) => k.startsWith('test/')), '测试面不计入核心扫描');
  assert.ok(!keys.some((k) => k.startsWith('src/migrations/')), 'SQL 迁移不计入核心扫描（D1 schema 留置）');
});

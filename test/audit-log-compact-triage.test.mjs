/**
 * 审计台「待处理项 ✅ 行分诊」契约（治理归位包 · HK-01 红绿先行 · 2026-11-21）。
 *
 * 背景：BLOCK-170 设计「当前待处理项全量保留」时该表只承载活跃广播（🔴/🟡/🟢）；
 * 实践中 ✅/COMPLETED 完成行也堆积在内（实测 113KB>50KB 阈且 compact 无法压回——
 * 记录表窗口不覆盖待处理项段）。演进：✅ 行按日期分诊——早于 keepDays 天的完成行
 * 整行搬移归档（搬移不改写不变量），🔴/🟡/🟢/📋 等未决行与新鲜 ✅ 行永不剪切。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compactLedgerLines } from '../scripts/audit-log-compact.mjs';

const HEAD = ['最后更新：2026-11-21（x）', '', '## 当前待处理项'];
const TAIL = ['', '## 最近处理记录', '', '## 广播规则', '', '> 规则正文'];

const ledger = (...rows) => [...HEAD, ...rows, ...TAIL];

test('红基线：旧行为=待处理项 ✅ 行全量保留（分诊前永不变短）', () => {
  const rows = [
    '| ✅ | 2026-11-01 | **旧完成行 A** | x |',
    '| 🔴 | 2026-11-21 | **阻塞行** | x |',
  ];
  const r = compactLedgerLines(ledger(...rows), { pendingKeepDays: 0 });
  // 分诊关闭（无 pendingKeepDays 语义前）→ 本断言钉住「默认关闭时零剪切」的兼容面
  const rDefault = compactLedgerLines(ledger(...rows));
  assert.equal(rDefault.outLines.length, ledger(...rows).length);
  assert.equal(rDefault.pendingCutLines.length, 0);
});

test('分诊：过期 ✅ 行整行剪切进归档，🔴/🟡/🟢 未决行与新鲜 ✅ 行保留', () => {
  const rows = [
    '| ✅ | 2026-11-01 | **旧完成行 A** | x |',
    '| ✅ | 2026-11-20 | **昨日完成行 B** | x |',
    '| ✅ | 2026-11-21 | **今日完成行 C** | x |',
    '| 🔴 | 2026-11-21 | **阻塞行** | x |',
    '| 🟡 | 2026-11-21 | **评估行** | x |',
    '| 📋 | 2026-11-21 | **材料行** | x |',
  ];
  const r = compactLedgerLines(ledger(...rows), { pendingKeepDays: 1, today: '2026-11-21' });
  // keepDays=1 → 保留 11-20 及之后：B/C/阻塞/评估/材料留，仅 A（11-01）剪切
  assert.deepEqual(r.pendingCutLines, ['| ✅ | 2026-11-01 | **旧完成行 A** | x |']);
  const out = r.outLines.join('\n');
  assert.ok(out.includes('**昨日完成行 B**'));
  assert.ok(out.includes('**今日完成行 C**'));
  assert.ok(out.includes('**阻塞行**'));
  assert.ok(out.includes('**评估行**'));
  assert.ok(out.includes('**材料行**'));
  assert.ok(!out.includes('**旧完成行 A**'));
});

test('分诊：无日期的 ✅ 行保守保留（fail-closed，不猜日期不误剪）', () => {
  const rows = ['| ✅ |（无日期行）| x |', '| 🔴 | 2026-11-21 | 阻塞 | x |'];
  const r = compactLedgerLines(ledger(...rows), { pendingKeepDays: 1, today: '2026-11-21' });
  assert.equal(r.pendingCutLines.length, 0);
  assert.ok(r.outLines.join('\n').includes('（无日期行）'));
});

test('分诊：🔴 阻塞行再旧也永不剪切（活跃广播语义优先）', () => {
  const rows = ['| 🔴 | 2026-11-01 | **很旧的阻塞行** | x |'];
  const r = compactLedgerLines(ledger(...rows), { pendingKeepDays: 1, today: '2026-11-21' });
  assert.equal(r.pendingCutLines.length, 0);
  assert.ok(r.outLines.join('\n').includes('**很旧的阻塞行**'));
});

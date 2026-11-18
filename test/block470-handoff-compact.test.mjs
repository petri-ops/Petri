// BLOCK-470 / T2 — handoff compact 纯函数负测（HK-01 判据侧红绿，治理批豁免声明）。
// 真实结构=头部多行链区（前几行各一条 + 末行 ｜ 拼接巨行），行后空行+---+正文。
// 保留最近 keep 条 → 淘汰原文搬移（不改措辞）→ 锚点不动 → 幂等 → fail-closed。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  splitHandoffChain,
  collectChainRegion,
  compactHandoffLines,
} from '../scripts/lib/handoff-compact-core.mjs';

// 模拟真实 handoff：两条独立链行 + 一条 ｜ 拼接巨行（含裸条目），后接空行/---/正文。
const CHAIN = [
  '最后更新：2026-11-18（**BLOCK-469 收口**：S5 完成）',
  '最后更新：2026-11-18（**BLOCK-468 收口**：S4 完成）',
  '最后更新：2026-11-17（**BLOCK-467 收口**：S3 完成）｜最后更新：2026-11-17（**BLOCK-466 收口**：S2 完成）｜（**裸条目**无前缀）',
];
const BODY = ['', '---', '# 工作区交接（Workspace Handoff）', '## 恢复顺序（接手 Agent 必读）', '1. AUDIT-LOG', '## 当前事实快照', '正文内容'];
const fixture = [...CHAIN, ...BODY];

test('T2-1 splitHandoffChain 按 ｜ 拆分，含裸条目', () => {
  const parts = splitHandoffChain(CHAIN[2]);
  assert.equal(parts.length, 3);
  assert.ok(parts[0].startsWith('最后更新：'));
  assert.ok(parts.at(-1).startsWith('（'));
});

test('T2-2 collectChainRegion 扫描全部头部链行（不止首行），正文分离', () => {
  const r = collectChainRegion(fixture);
  assert.equal(r.chainLines.length, 3, '三条链行都要识别');
  assert.equal(r.allParts.length, 5, '拆出 5 条链条目（2+1+2，含裸条目）');
  assert.deepEqual(r.rest, BODY, '正文原样分离');
});

test('T2-3 compactHandoffLines 保留最近 keep 条，其余淘汰原文搬移', () => {
  const r = compactHandoffLines(fixture, { keep: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.keptChain.length, 1);
  assert.ok(r.keptChain[0].includes('BLOCK-469'), '保留最新一条');
  assert.equal(r.cutLines.length, 4, '淘汰 4 条');
  for (const cut of r.cutLines) {
    assert.ok(CHAIN.join('｜').includes(cut), '淘汰条目必须是原文子串（搬移不改写）');
  }
});

test('T2-4 结构锚点保留（--- / 标题 / 恢复顺序 / 快照 / 正文）', () => {
  const r = compactHandoffLines(fixture, { keep: 1 });
  const out = r.outLines.join('\n');
  for (const anchor of ['---', '# 工作区交接', '## 恢复顺序', '## 当前事实快照', '正文内容']) {
    assert.ok(out.includes(anchor), `锚点 ${anchor} 必须保留`);
  }
});

test('T2-5 幂等：keep ≥ 链条目数 → 无淘汰、outLines 等价', () => {
  const r = compactHandoffLines(fixture, { keep: 10 });
  assert.equal(r.cutLines.length, 0);
  assert.deepEqual(r.outLines, fixture);
  assert.equal(r.changed, false);
});

test('T2-6 无链区（首行为正文）→ fail-closed 不改文件', () => {
  const noChain = ['# 标题', '正文', '---'];
  const r = compactHandoffLines(noChain, { keep: 1 });
  assert.equal(r.ok, false);
  assert.match(r.reason, /no-chain-region/i);
});

test('T2-7 淘汰项按日期取 throughDate（被剪条目最新日期）', () => {
  const r = compactHandoffLines(fixture, { keep: 1 });
  assert.match(r.throughDate, /^2026-11-\d{2}$/);
});

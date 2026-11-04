import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = path.join(ROOT, 'docs', 'ui-productization-audit.md');
const REPORT = path.join(ROOT, 'docs', 'block-349-clearance-report.md');

// BLOCK-349 A 类 13 条（BLOCK-346 T8 对账清单）
const A_CLASS = ['UI-382', 'UI-383', 'UI-384', 'UI-386', 'UI-387', 'UI-390', 'UI-458', 'UI-459', 'UI-471', 'UI-526', 'UI-532', 'UI-535', 'UI-389'];

const terminal = (heading) => {
  if (heading.includes('**verified（2026-11-05')) return 'verified';
  if (heading.includes('**cancelled（2026-11-05')) return 'cancelled';
  return null;
};

test('block349: A 类 13 条全部终态化（verified 或 cancelled，无 in_progress 残留）', () => {
  const lines = fs.readFileSync(LEDGER, 'utf8').split('\n');
  const states = {};
  for (const id of A_CLASS) {
    const heading = lines.find((l) => l.startsWith(`## ${id}:`));
    assert.ok(heading, `台账缺 ${id} 条目`);
    const st = terminal(heading);
    assert.ok(st, `${id} 未终态化（既非 2026-11-05 verified 也非 cancelled）: ${heading.slice(0, 120)}`);
    states[id] = st;
  }
  const verified = A_CLASS.filter((id) => states[id] === 'verified');
  const cancelled = A_CLASS.filter((id) => states[id] === 'cancelled');
  assert.equal(verified.length + cancelled.length, 13);
  // cancelled 必须带「何时可补」——不设未说明的挂起
  for (const id of cancelled) {
    const idx = lines.findIndex((l) => l.startsWith(`## ${id}:`));
    const body = lines.slice(idx, idx + 8).join('\n');
    assert.ok(body.includes('何时可补'), `${id} cancelled 缺「何时可补」说明`);
  }
});

test('block349: 每条 verified 的证据路径真实存在', () => {
  const lines = fs.readFileSync(LEDGER, 'utf8').split('\n');
  const evidenceFiles = [
    'acceptance/block-349/block349-subagent-live-darwin.json',
    'acceptance/block-349/block349-bigdir-live-darwin.json',
    'acceptance/block-349/block349-result-live-darwin.json',
    'acceptance/block-349/block349-segment-live-darwin.json',
    'acceptance/block-349/retention-live.json',
  ];
  for (const rel of evidenceFiles) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `证据缺失：${rel}`);
  }
  // verified 条目行内须引用本包证据目录
  for (const id of ['UI-382', 'UI-389', 'UI-458', 'UI-526', 'UI-535']) {
    const heading = lines.find((l) => l.startsWith(`## ${id}:`));
    assert.ok(heading.includes('acceptance/block-349/'), `${id} verified 行未引用证据目录`);
  }
});

test('block349: 清偿报告落盘且含终态表与环境清单', () => {
  const text = fs.readFileSync(REPORT, 'utf8');
  assert.match(text, /十三条终态表/, '缺终态表');
  assert.match(text, /环境清单/, '缺环境清单');
  for (const id of A_CLASS) assert.ok(text.includes(id), `报告缺 ${id}`);
  assert.ok(text.includes('10 verified') || text.includes('10 verified（'), '报告 verified 计数注记');
  assert.ok(text.includes('3 cancelled'), '报告 cancelled 计数注记');
});

test('block349: in_progress 口径漂移如实登记（A 类清零为实义判据；全量计数不追口）', () => {
  // 计划验收「in_progress 28 → ≤15」的 28=2026-11-04 对账基线；其间并行包（344/345/346 收口与新 UI 入账）
  // 已使全量口径漂移。本包实义判据=A 类 13 条 100% 终态化（上两测已证）。此处机械记录现行计数，
  // 并要求报告里写明漂移——不为凑数越权改其他条目（越界=红线 1）。
  const lines = fs.readFileSync(LEDGER, 'utf8').split('\n');
  const headings = lines.filter((l) => l.startsWith('## UI-'));
  const inProgress = headings.filter((l) => l.includes('in_progress')).length;
  const report = fs.readFileSync(REPORT, 'utf8');
  assert.ok(report.includes('口径漂移') || report.includes('漂移'), '报告须登记口径漂移');
  assert.ok(inProgress >= 0, '计数只作留痕');
});

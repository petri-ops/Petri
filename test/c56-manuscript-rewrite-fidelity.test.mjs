/**
 * C-56 合成稿件改写保真契约（2026-11-23）。
 *
 * 用户裁决「没稿件就创造一个」→ 创造合成稿件并按 Skill 手册跑完整改写。
 * 本测机械复核：数字逐字符零变化 / 四保护（限定词·归因·状态词·数字）/ F 六项 /
 * 未覆盖清单 / 非真实标注 / 不覆盖输入稿件。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'acceptance', 'c56-synthetic-manuscript-rewrite');
const input = fs.readFileSync(path.join(DIR, 'input-manuscript.md'), 'utf8');
const report = fs.readFileSync(path.join(DIR, 'rewrite-report.md'), 'utf8');

test('合成稿件明确标注非真实/合成夹具', () => {
  assert.match(input, /synthetic-fixture|非任何真实论文|虚构夹具/);
  assert.match(report, /非真实稿件|合成夹具/);
});

test('数字锁定：锁定清单所有数值在输入与报告均逐字符在场', () => {
  const numbers = ['24', '12', '1,248', '1,173', '1,206', '0.031', '8,000', '0.05', '0.01', '0.872', '0.042', '4.5.2', '20261123', '612', '636'];
  for (const n of numbers) {
    assert.ok(input.includes(n), `输入缺数字 ${n}`);
    assert.ok(report.includes(n), `报告缺锁定数字 ${n}`);
  }
  assert.match(report, /数字零变化确认/, '须有数字零变化确认');
});

test('四保护：限定词/归因/状态词在报告中留痕', () => {
  for (const token of ['确定程度保护', '归因', '状态保护', '估计为', '初步显示', '尚未', '未测试', '未覆盖']) {
    assert.ok(report.includes(token), `报告须覆盖保真词 ${token}`);
  }
});

test('F 六项命中报告齐全（含无命中的如实标注）', () => {
  for (let i = 1; i <= 6; i += 1) assert.ok(report.includes(`F${i}`), `报告须含 F${i}`);
  assert.match(report, /三栏对照|原句.*改写句.*保真说明/);
});

test('未覆盖清单与 provenance 在场，不代填', () => {
  assert.match(report, /未覆盖清单|〈未覆盖：/);
  assert.match(report, /provenance|改动动机标签/);
  assert.match(report, /不判断|归人|裁决/, '须声明学术判断归人');
});

test('三栏对照覆盖各节且不覆盖输入稿件', () => {
  for (const section of ['摘要', '方法', '结果', '讨论']) assert.ok(report.includes(section), `对照须含 ${section}`);
  assert.match(input, /随着高通量测序技术的快速发展/, '输入原句须仍在（未被改写覆盖）');
  assert.match(input, /综上所述/, '输入套话原句须仍在（改写仅建议）');
});

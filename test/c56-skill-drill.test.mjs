/**
 * C-56 合成夹具端到端演练（2026-11-23）— HK-01 契约。
 *
 * 用户裁决「用合成夹具跑通 Skill 端到端演练，明确非真实稿件、不改判据语义」。
 * 演练=真实 Skill 链路（discover/get）读回 system.md 规则→对 jia1 夹具应用保真
 * 不变量→产出结构化演练证据。本测钉死演练驱动存在且保真规则可机械复核。
 * 红线：非真实稿件标注在场；不改手册 §9「真实稿件须用户给路径」判据语义。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRILL = path.join(ROOT, 'scripts', 'c56-paper-writing-drill.mjs');

test('演练驱动存在且真实调用 Skill 发现/读取链路', () => {
  assert.ok(fs.existsSync(DRILL), '须有 scripts/c56-paper-writing-drill.mjs 演练驱动');
  const s = fs.readFileSync(DRILL, 'utf8');
  assert.match(s, /tool_skill_discover/, '演练须走真实 skill_discover');
  assert.match(s, /tool_skill_get/, '演练须走真实 skill_get');
  assert.match(s, /paper-writing/, '演练对象须为 paper-writing skill');
});

test('演练标注非真实稿件、不改判据语义', () => {
  const s = fs.readFileSync(DRILL, 'utf8');
  assert.match(s, /合成夹具|非真实稿件|synthetic/, '须标注输入为合成夹具/非真实稿件');
  assert.match(s, /不改判据|不改.*语义|真实稿件.*路径|不替代/, '须声明不替代真实稿件判据语义');
});

test('保真不变量可机械复核（数字锁定/四保护/F六项/provenance）', () => {
  const s = fs.readFileSync(DRILL, 'utf8');
  for (const token of ['98.7', '数字锁定', 'determination', 'attribution', 'completion', 'F1', 'F6', 'provenance']) {
    assert.ok(s.includes(token), `演练驱动须覆盖保真不变量 ${token}`);
  }
});

test('手册 §9 真实稿件判据未被改写', () => {
  const manual = fs.readFileSync(
    path.join(ROOT, 'docs', 'c56-paper-writing-manual-draft-2026-11-19.md'), 'utf8',
  );
  assert.match(manual, /用户给出文件路径/, '手册 §9「用户给出文件路径」判据须保留');
  assert.match(manual, /完整读取原文/, '手册 §9「完整读取原文」判据须保留');
});

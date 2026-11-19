/**
 * BLOCK-501 capability-intake 最小垂直切片 — 消费契约（HK-01 红绿先行）。
 *
 * 用户裁决：B 组按推荐（D2/D8 采纳 + 最小垂直切片「接收→登记→评审稿三步」）。
 * D1–D8 已于 2026-11-18 全 ruled（block490 评审稿 §4）；本切片落地骨架：
 *   - D1 Agent skill canonical SKILL.md（三步闭环 + 红线）；
 *   - D7 发现桥两处真 symlink（.claude/.codebuddy → ../../.agents/skills/capability-intake）；
 *   - D4 provenance 台账 append-only 字段契约（seed=C-56 humanizer 两行，license_unknown=true）；
 *   - D2/D5 边界锚进手册文本（篡改即红）。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILL = path.join(ROOT, '.agents', 'skills', 'capability-intake', 'SKILL.md');
const BRIDGES = [
  path.join(ROOT, '.claude', 'skills', 'capability-intake'),
  path.join(ROOT, '.codebuddy', 'skills', 'capability-intake'),
];
const PROVENANCE = path.join(ROOT, 'acceptance', 'capability-intake', 'provenance.jsonl');

test('D1：SKILL.md 在场且三步闭环+红线锚齐备（缺席红）', () => {
  assert.equal(fs.existsSync(SKILL), true, 'capability-intake SKILL.md 必须在场');
  const text = fs.readFileSync(SKILL, 'utf8');
  for (const anchor of [
    'name: capability-intake',
    'Step 1 · 接收与解析',
    'Step 2 · 理解拆解与内化设计',
    'Step 3 · 候选登记与评审稿',
    '启动实现永远需用户显式发令',
    'license_unknown',
    'source_type=utterance',
    'source_type=url',
    'source_type=knowledge-ref',
    'provenance.jsonl',
    '不造第二套治理',
  ]) {
    assert.ok(text.includes(anchor), `SKILL.md 契约锚丢失：${anchor}`);
  }
});

test('D7：两发现桥为真 symlink 且解析到 canonical（退化=宿主静默 not found）', () => {
  for (const bridge of BRIDGES) {
    const stat = fs.lstatSync(bridge);
    assert.equal(stat.isSymbolicLink(), true, `发现桥必须是真 symlink：${bridge}`);
    const resolved = fs.realpathSync(bridge);
    assert.equal(resolved, fs.realpathSync(path.dirname(SKILL)), `桥必须解析到 canonical skill 目录：${bridge}`);
  }
});

test('D4：provenance 台账 append-only 契约——逐行 JSON、必填字段齐、sha256 可复算锚', () => {
  const lines = fs.readFileSync(PROVENANCE, 'utf8').trim().split('\n');
  assert.ok(lines.length >= 2, '台账至少含 C-56 来源两行（seed）');
  const REQUIRED = ['id', 'source_type', 'uri', 'captured_at', 'author', 'license', 'license_source', 'sha256', 'internalization_plan', 'license_unknown'];
  for (const [i, line] of lines.entries()) {
    const row = JSON.parse(line);
    for (const field of REQUIRED) {
      assert.ok(Object.prototype.hasOwnProperty.call(row, field), `行 ${i + 1} 缺 provenance 字段 ${field}`);
    }
    assert.equal(typeof row.license_unknown, 'boolean', `行 ${i + 1} license_unknown 必须布尔`);
  }
});

test('D5：seed 行 license_unknown=true 在册（C-56 humanizer 来源停等用户裁决，不代答）', () => {
  const lines = fs.readFileSync(PROVENANCE, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const humanizer = lines.filter((row) => row.uri.includes('humanizer') || row.uri.includes('Humanizer-zh'));
  assert.ok(humanizer.length >= 2, 'humanizer 两来源必须在册');
  for (const row of humanizer) {
    assert.equal(row.license_unknown, true, 'D5：license_unknown=true 停等在册（接入类动作禁止，直至用户裁决）');
    assert.equal(row.license, 'unknown');
  }
});

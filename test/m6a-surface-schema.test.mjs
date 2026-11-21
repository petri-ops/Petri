/**
 * M6-A / BLOCK-435 三面共用 schema 门 · HK-01 负测（篡改必红）。
 * 覆盖：结构性必填 / 空面 / 新增缺陷 / 摘要漂移 / 漂移棘轮 / 基线缺失。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSchema, adjudicateSchema } from '../scripts/m-blueprint-m6a-surface-schema.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, 'acceptance/m-blueprint-2026-11-11/m6a/surface-schema.json');

const readBaseline = () => JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));

test('M6-A 三面 schema：矩阵与真相源/基线一致，身份唯一性缺陷已冻结', () => {
  const schema = buildSchema();
  const baseline = readBaseline();
  // BLOCK-445：新增 IPC 通道（gen-ui:prepare-mcp-app）后改为「与真相源 + 冻结基线一致」，
  // 不再硬编码计数（否则每次合法扩面都假红）。真相源计数由生成器从 channels.js / TOOL_DEFS 复算。
  assert.equal(schema.counts.ipc, schema.counts.truthChannels, 'ipc 必须与 channels.js 叶子数一致');
  assert.equal(schema.counts.tool, schema.counts.truthTools, 'tool 必须与 TOOL_DEFS 一致');
  assert.equal(schema.counts.ipc, baseline.counts.ipc);
  assert.equal(schema.counts.tool, baseline.counts.tool);
  assert.equal(schema.counts.route, baseline.counts.route);
  assert.equal(schema.counts.entries, baseline.counts.entries);
  assert.equal(schema.counts.entries, schema.counts.ipc + schema.counts.tool + schema.counts.route);
  assert.ok(Array.isArray(schema.defects));
  // 演进（R2 清偿批清退票 2026-11-21）：两项冻结缺陷已根修清零——
  // DUPLICATE_ENTRY route::POST /api/ai/interpret = ai-legacy 旧实现不可达双注册（退役注释本就
  // 约定「pack 迁移后删除」，P4-REM 已收口故删除）；SUMMARY_DRIFT metadata = 生成器 summary 口径
  // 混源（TOOL_METADATA 119 全量 vs toolRows 118 宇宙），统一到行宇宙后归零。
  assert.deepEqual(schema.defects, [], `冻结缺陷应已清零: ${JSON.stringify(schema.defects)}`);
});

test('M6-A 门基线：当前实现 + 基线 → PASS 0 issues', () => {
  const verdict = adjudicateSchema(buildSchema(), readBaseline());
  assert.equal(verdict.ok, true, JSON.stringify(verdict.issues));
});

test('植入新缺陷（重复身份）→ NEW_DEFECT 必红', () => {
  const schema = buildSchema();
  const next = clone(schema);
  next.entries.push({ ...next.entries[0] });
  next.defects = [...new Set([...(next.defects || []), `DUPLICATE_ENTRY: ${next.entries[0].kind}::${next.entries[0].id}`])];
  const verdict = adjudicateSchema(next, readBaseline());
  assert.equal(verdict.ok, false);
  assert.ok(verdict.issues.some((i) => i.startsWith('NEW_DEFECT')));
});

test('植入漂移上升 → DRIFT_INCREASED 必红', () => {
  const schema = buildSchema();
  const next = clone(schema);
  next.drift.toolMissingInDefs = Number(next.drift.toolMissingInDefs) + 1;
  const verdict = adjudicateSchema(next, readBaseline());
  assert.ok(verdict.issues.some((i) => i.includes('DRIFT_INCREASED: toolMissingInDefs')));
});

test('缺少基线 → BASELINE_MISSING 必红（不能空口 PASS）', () => {
  const verdict = adjudicateSchema(buildSchema(), null);
  assert.ok(verdict.issues.some((i) => i.includes('BASELINE_MISSING')));
});

test('必填字段缺失 / 空面 → 恒红（不受基线豁免）', () => {
  const schema = buildSchema();
  const missingField = clone(schema);
  missingField.entries[0].scope = '';
  assert.ok(adjudicateSchema(missingField, readBaseline()).issues.some((i) => i.includes('ENTRY_FIELD_MISSING')));

  const emptySurface = clone(schema);
  emptySurface.entries = emptySurface.entries.filter((e) => e.kind !== 'route');
  assert.ok(adjudicateSchema(emptySurface, readBaseline()).issues.some((i) => i.includes('EMPTY_SURFACE: route')));
});

test('漂移棘轮只减不增：收敛后按新基线仍 PASS（不锁死已修项）', () => {
  const schema = buildSchema();
  const relaxedBaseline = clone(readBaseline());
  relaxedBaseline.drift.toolMissingInDefs = Number(schema.drift.toolMissingInDefs);
  assert.equal(adjudicateSchema(schema, relaxedBaseline).ok, true);
});

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

test('M6-A 三面 schema：ipc 168 / tool 115 / route 283，身份唯一性缺陷已冻结', () => {
  const schema = buildSchema();
  assert.equal(schema.counts.ipc, 168);
  assert.equal(schema.counts.tool, 115);
  assert.equal(schema.counts.route, 283);
  assert.equal(schema.counts.entries, 566);
  assert.ok(Array.isArray(schema.defects));
  assert.ok(schema.defects.length >= 1, '至少冻结重复注册缺陷');
  assert.ok(schema.defects.every((d) => /^(DUPLICATE_ENTRY|SUMMARY_DRIFT):/.test(d)));
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

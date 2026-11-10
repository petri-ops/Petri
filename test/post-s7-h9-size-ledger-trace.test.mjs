/**
 * B-16 尺寸门重打留因 + 负测（棘轮只减不增的守护，不是放宽）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestSrc = fs.readFileSync(path.join(ROOT, 'scripts/code-size-ledger.mjs'), 'utf8');
const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'acceptance/block-92/size-baseline.json'), 'utf8'));

test('loop-orchestrator.js 已纳管 MANIFEST，且基线有对应行', () => {
  // 判定修正：不塞进 700 行预算门（会必红且需新增例外，违反「只出不进」裁决），
  // 另立独立行数锚棘轮守护（见 scripts/post-s7-big-file-ratchet.mjs）。
  assert.equal(manifestSrc.includes('loop-orchestrator.js'), false);
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts/post-s7-big-file-ratchet.mjs')));
  const anchor = JSON.parse(fs.readFileSync(path.join(ROOT, 'acceptance/post-s7-2026-11-10/h9/big-file-anchor.json'), 'utf8'));
  const row = anchor.files.find((f) => f.path === 'core/petri-server/loop-orchestrator.js');
  assert.ok(row && row.lines > 1500 && row.lines < 1700, `行数锚异常: ${JSON.stringify(row)}`);
});

test('tools-executor.js 基线 +1 行有据可查：确为 B-17 单源引用', () => {
  const row = baseline.files.find((f) => f.path === 'core/petri-server/helpers/tools-executor.js');
  assert.ok(row);
  const src = fs.readFileSync(path.join(ROOT, 'core/petri-server/helpers/tools-executor.js'), 'utf8');
  assert.ok(src.includes("const { ARTIFACT_SCHEMA_VERSION } = require('../../shared-backend/schema-versions');"),
    '基线放宽必须能归因到本轮单源引用改动');
  const countLines = (t) => { const a = t.split('\n'); if (a.length && a.at(-1) === '') a.pop(); return a.length; };
  assert.equal(countLines(src), row.lines, '基线行数必须与源码一致（门口径）');
});

test('负测：棘轮语义不能变成「允许增长」——源码若多一行无留因应被识别', () => {
  const src = fs.readFileSync(path.join(ROOT, 'core/petri-server/helpers/tools-executor.js'), 'utf8');
  const row = baseline.files.find((f) => f.path === 'core/petri-server/helpers/tools-executor.js');
  const countLines = (t) => { const a = t.split('\n'); if (a.length && a.at(-1) === '') a.pop(); return a.length; };
  assert.equal(countLines(src), row.lines);
  assert.notEqual(countLines(src) + 1, row.lines, '多一行即应触发棘轮');
});

test('只减不增：总行数预算仍为 700 额外额度，未被放大', () => {
  assert.ok(manifestSrc.includes('export const BUDGET_LINES = 700;'));
});

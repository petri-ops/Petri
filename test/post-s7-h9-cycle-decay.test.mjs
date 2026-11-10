/**
 * B-25 环消亡契约：公共类型归位后 types ↔ unifiedDiff 必须单向。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = path.join(ROOT, 'frontend/src/components/editor/CodeMirror/types.ts');
const DIFF = path.join(ROOT, 'frontend/src/components/editor/CodeMirror/extensions/unifiedDiff.ts');

test('DiffViewOptions 单一定义在 types.ts，unifiedDiff 只 re-export', () => {
  const types = fs.readFileSync(TYPES, 'utf8');
  const diff = fs.readFileSync(DIFF, 'utf8');
  assert.ok(types.includes('export interface DiffViewOptions'), '公共类型必须归位 barrel');
  assert.equal(/from ['"]\.\/extensions\/unifiedDiff['"]/.test(types), false, 'types.ts 不得反向 import extension');
  assert.ok(diff.includes("export type { DiffViewOptions } from '../types';"));
  assert.ok(diff.includes("import type { DiffViewOptions } from '../types';"));
  assert.equal(/export interface DiffViewOptions/.test(diff), false, 'extension 不得再定义第二份');
});

test('环基线 13→12 已收紧，无回退', () => {
  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'acceptance/block-109/arch-cycles-baseline.json'), 'utf8'));
  assert.equal(baseline.cycles.length, 12);
  const codeMirrorCycle = baseline.cycles.filter((c) => c.includes('CodeMirror/types.ts') && c.includes('unifiedDiff'));
  assert.equal(codeMirrorCycle.length, 0, '该环应已消亡');
});

test('负测：若把定义挪回 extension，类型环判据应能识别', () => {
  const reverted = "import type { DiffViewOptions } from './extensions/unifiedDiff';\nexport type { DiffViewOptions };";
  assert.equal(/from ['"]\.\/extensions\/unifiedDiff['"]/.test(reverted), true);
});

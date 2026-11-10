/**
 * B-32 颜色字面量棘轮契约：token 定义合法、生产面债冻结、新增即红。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { scanColorDebt, evaluate } from '../scripts/post-s7-color-ratchet.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('token 定义不计债，生产面字面量计入，注释不计', () => {
  const r = scanColorDebt({
    'a.css': `--petri-surface: #ffffff;\n/* #123456 注释 */\n.box { color: #abcdef; }`,
  });
  assert.equal(r['a.css'], 1);
});

test('现场：基线在册且与当前源码一致（债被冻结，未新增）', () => {
  const b = JSON.parse(fs.readFileSync(path.join(ROOT, 'acceptance/post-s7-2026-11-10/h10/color-baseline.json'), 'utf8'));
  assert.ok(b.total > 0, '必须如实登记存量债，不许报零交差');
  assert.ok(Object.keys(b.perFile).length >= 20);
  assert.ok(b.note.includes('仍待人眼'), '不得冒充视觉收敛完成');
  const r = evaluate(b.perFile, b);
  assert.equal(r.ok, true);
});

test('负测：新增字面量 / 新文件引入 / 虚构清零都红', () => {
  const baseline = { perFile: { 'a.css': 2 } };
  assert.equal(evaluate({ 'a.css': 3 }, baseline).ok, false, '同文件新增即红');
  assert.equal(evaluate({ 'a.css': 2, 'b.css': 1 }, baseline).ok, false, '新文件引入即红');
  assert.equal(evaluate({ 'a.css': 1 }, baseline).ok, true, '减少允许（只减不增）');
});

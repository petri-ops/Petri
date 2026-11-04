import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MATRIX = path.join(ROOT, 'acceptance', 'block-352', 'shelf-matrix.json');

const VERDICTS = ['available', 'detour', 'shell'];

/** 契约校验（与采集器 totals.allJudged 同口径的测试侧独立实现）。 */
const checkMatrix = (matrix) => {
  const issues = [];
  const groups = [...(matrix.shelves.skills || []), ...(matrix.shelves.plugins || [])];
  for (const item of groups) {
    if (!VERDICTS.includes(item.verdict)) issues.push(`${item.name} 判定非法：${item.verdict}`);
    if (!item.basis || String(item.basis).length < 20) issues.push(`${item.name} 判定依据缺失`);
    if (item.verdict === 'detour' && !/绕路步骤=/.test(item.basis)) issues.push(`${item.name} detour 缺具体绕路步骤`);
  }
  if ((matrix.shelves.skills || []).length + (matrix.shelves.plugins || []).length === 0) {
    issues.push('货架为空（清单生成失败）');
  }
  return issues;
};

test('block352: 三货架矩阵在场且全判定（verdict ∈ 三态 + 依据在场）', () => {
  const matrix = JSON.parse(fs.readFileSync(MATRIX, 'utf8'));
  const issues = checkMatrix(matrix);
  assert.deepEqual(issues, [], `矩阵契约违规：${issues.join('；')}`);
  assert.equal(matrix.totals.allJudged, true, 'totals.allJudged 应为 true');
  assert.equal(matrix.totals.skills, (matrix.shelves.skills || []).length);
  assert.equal(matrix.totals.plugins, (matrix.shelves.plugins || []).length);
});

test('block352: available 判定必须带真实动作证据（jobId 或真实握手计数）', () => {
  const matrix = JSON.parse(fs.readFileSync(MATRIX, 'utf8'));
  for (const p of matrix.shelves.plugins.filter((x) => x.verdict === 'available')) {
    assert.ok(p.jobId || /真实动作|真跑完成/.test(p.basis), `${p.name} available 缺真实动作证据`);
  }
  const mcp = matrix.shelves.mcp.server;
  assert.equal(mcp.verdict, 'available');
  assert.ok(mcp.basis.includes('stdio') || mcp.toolCount > 0, 'MCP server 需真实握手证据');
});

test('block352: detour 判定必须带具体绕路步骤（不写「暂不支持」了事）', () => {
  const matrix = JSON.parse(fs.readFileSync(MATRIX, 'utf8'));
  for (const item of [...matrix.shelves.skills, ...matrix.shelves.plugins].filter((x) => x.verdict === 'detour')) {
    assert.match(item.basis, /绕路步骤=/, `${item.name} 缺绕路步骤`);
  }
});

test('block352 负测：造无判定条目 → 契约判红；恢复后判绿', () => {
  const matrix = JSON.parse(fs.readFileSync(MATRIX, 'utf8'));
  const doctored = JSON.parse(JSON.stringify(matrix));
  doctored.shelves.skills.push({ shelf: 'skills', name: 'fake-extension', source: 'built-in', verdict: 'pending', basis: '' });
  const issues = checkMatrix(doctored);
  assert.ok(issues.some((i) => i.includes('fake-extension')), '无判定条目必须判红');
  assert.deepEqual(checkMatrix(matrix), [], '原矩阵恢复判绿');
});

test('block352 负测：空壳判定必须带处置（shell 均有处置语义或本轮无 shell 如实记录）', () => {
  const matrix = JSON.parse(fs.readFileSync(MATRIX, 'utf8'));
  const shells = [...matrix.shelves.skills, ...matrix.shelves.plugins].filter((x) => x.verdict === 'shell');
  for (const s of shells) {
    assert.match(s.basis, /在架无实现|无契约|不可解析/, `${s.name} shell 依据须说明实现缺失形态`);
  }
});

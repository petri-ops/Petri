import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildResultSummary, pickPrimaryArtifact, readTablePreview, tool_result_summary } from '../core/biof3-server/agent-tools/result-summary-tools.js';

/**
 * BLOCK-121 P2（B1）— result_summary 有界只读读取工具契约。
 * 断点=跨轮无工具可读结果内容（plan §8.2.4）；本工具是有界修复面。
 */

function makeRow(overrides = {}) {
  return {
    id: 'tj_test_1',
    tool_id: 'deseq2',
    status: 'completed',
    name: 'deseq2 via agent',
    conversation_id: 'conv_x',
    completed_at: 1,
    error: null,
    ...overrides,
  };
}

test('纯装配：产物截 20 + 截断标记 + truth/summary 投影', () => {
  const artifacts = Array.from({ length: 30 }, (_, i) => ({ filename: `f${i}.csv`, type: 'table' }));
  const data = buildResultSummary(makeRow(), {
    artifactTruth: { status: 'valid', blocking: false },
    manifest: { summary: { total_genes: 100, sig_genes: 5, up: 3, down: 2 } },
    artifacts,
  });
  assert.equal(data.artifactCount, 30);
  assert.equal(data.artifacts.length, 20, '产物清单截 20');
  assert.equal(data.artifactsTruncated, true);
  assert.deepEqual(data.truth, { status: 'valid', blocking: false });
  assert.deepEqual(data.summary, { total_genes: 100, sig_genes: 5, up: 3, down: 2 });
  assert.equal(data.job.toolId, 'deseq2');
});

test('主表挑选：type=table 优先；表预览列/行/单元格三重截断', () => {
  const primary = pickPrimaryArtifact({
    artifacts: [
      { name: 'volcano.png', type: 'plot' },
      { name: 'deg_table.csv', type: 'table' },
      { name: 'up_genes.csv', type: 'table' },
    ],
  });
  assert.equal(primary.name, 'deg_table.csv');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'result-summary-'));
  const csvPath = path.join(dir, 'deg_table.csv');
  const wideRow = Array.from({ length: 12 }, (_, i) => `col${i}`).join(',');
  const longCell = 'G'.repeat(60);
  const lines = [wideRow];
  for (let i = 0; i < 10; i += 1) lines.push(`${longCell},${i},x,y,z,a,b,c,d,e,f`);
  lines.push(''); // 尾空行应被忽略
  fs.writeFileSync(csvPath, lines.join('\n'));

  const preview = readTablePreview({ path: csvPath });
  assert.equal(preview.available, true);
  assert.equal(preview.columns.length, 8, '列截 8');
  assert.equal(preview.rows.length, 6, '行截 6');
  assert.equal(preview.totalDataRows, 10);
  assert.deepEqual(preview.truncated, { columns: true, rows: true });
  assert.ok(preview.rows[0][0].endsWith('…') && preview.rows[0][0].length <= 25, '单元格截 24 字');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('工具包装：缺参 fail-closed；未知 job 与空结果如实 available:false', async () => {
  const missing = await tool_result_summary({});
  assert.equal(missing.ok, false);
  assert.equal(missing.error, 'missing_toolJobId');

  const unknown = await tool_result_summary(
    { toolJobId: 'tj_nope' },
    { getToolJob: () => undefined },
  );
  assert.equal(unknown.ok, true);
  assert.equal(unknown.available, false);

  const empty = await tool_result_summary(
    { toolJobId: 'tj_empty' },
    { getToolJob: () => makeRow({ id: 'tj_empty', result_json: null }) },
  );
  assert.equal(empty.available, false);
  assert.match(empty.message, /还没有可读的结果内容/);

  const broken = await tool_result_summary(
    { toolJobId: 'tj_bad' },
    { getToolJob: () => makeRow({ id: 'tj_bad', result_json: '{not-json' }) },
  );
  assert.equal(broken.available, false);
});

test('工具包装：真实形态 happy path（关键统计进 message，主表真值在场）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'result-summary-'));
  const csvPath = path.join(dir, 'deg_table.csv');
  fs.writeFileSync(csvPath, 'baseMean,log2FoldChange,padj,gene\n598.7,-2.68,7.6e-13,"Gene61"\n100,1.9,0.01,"Gene7"\n');

  const row = makeRow({
    result_json: JSON.stringify({
      artifactTruth: { status: 'valid', blocking: false },
      manifest: { summary: { total_genes: 1978, sig_genes: 82, up: 46, down: 36 } },
      artifacts: [
        { filename: 'volcano.png', type: 'plot' },
        { filename: 'deg_table.csv', type: 'table', path: csvPath },
      ],
    }),
  });
  const r = await tool_result_summary({ toolJobId: 'tj_test_1' }, { getToolJob: () => row });
  assert.equal(r.ok, true);
  assert.equal(r.available, true);
  assert.equal(r.table.available, true);
  assert.deepEqual(r.table.rows[0][3], 'Gene61');
  assert.match(r.message, /显著 82（上调 46 \/ 下调 36）/);
  assert.match(r.message, /不要编造/);

  fs.rmSync(dir, { recursive: true, force: true });
});

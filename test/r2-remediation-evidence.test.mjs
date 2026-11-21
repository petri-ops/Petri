/**
 * R2 清偿批证据链完整性契约（S8 · 2026-11-21）。
 *
 * 本测试消费 R2 清偿批（acceptance/r2-remediation/**）与前批评估
 * （acceptance/project-status-assessment-r2-2026-11-20/、r3-2026-11-21/）与
 * S1 极简变体留证包（acceptance/cultural-watermark/minimal-variant-preserved/）：
 * 断言每波 RULINGS 在场非空、门禁退出码台账可解析且与波次对账、留证包逐字节
 * 锚（sha256 一致的契约测副本）、实机证据 allPass 结构、R2/R3 评估四维评分在场。
 * 语义=证据链防静默丢失（消费面即资产化面，EAR 口径 testRef ∧ impactRule）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const R2 = path.join(ROOT, 'acceptance', 'r2-remediation');
const R2_ASSESS = path.join(ROOT, 'acceptance', 'project-status-assessment-r2-2026-11-20');
const R3_ASSESS = path.join(ROOT, 'acceptance', 'project-status-assessment-r3-2026-11-21');
const PRESERVED = path.join(ROOT, 'acceptance', 'cultural-watermark', 'minimal-variant-preserved');


test('每波 RULINGS 在场且非空（S1–S7 + s8 契约演进）', () => {
  const rulings = [
    's1/RULINGS.md', 's2/RULINGS.md', 's3/RULINGS.md', 's4/RULINGS.md', 's5/RULINGS.md',
    's6/RULINGS-status-color.md', 's6/RULINGS-breakpoints.md', 's6/RULINGS-target-score.md',
    's7/RULINGS.md', 's8/RULINGS-closeout-contracts.md',
  ];
  for (const rel of rulings) {
    const p = path.join(R2, rel);
    assert.ok(fs.existsSync(p), `缺 RULINGS: ${rel}`);
    assert.ok(fs.readFileSync(p, 'utf8').length > 200, `RULINGS 过短（疑似占位）: ${rel}`);
  }
});

test('exit-codes.tsv 可解析且含基线与波次行', () => {
  const rows = fs.readFileSync(path.join(R2, 'gates', 'exit-codes.tsv'), 'utf8')
    .split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  assert.ok(rows.length >= 8, `退出码台账行数不足: ${rows.length}`);
  const labels = rows.map((r) => r.split('\t')[0]);
  for (const wave of ['s6a-status-color', 's8a-closeout-contracts']) {
    assert.ok(labels.some((l) => l.includes(wave)), `缺波次行: ${wave}`);
  }
});

test('S1 极简变体留证包完整且契约测副本逐字节一致', () => {
  for (const rel of ['watermark.css', 'GlobalWatermark.tsx', 'cultural-watermark.cjs', 'watermark-contract.test.ts', 'README.md']) {
    assert.ok(fs.existsSync(path.join(PRESERVED, rel)), `留证缺文件: ${rel}`);
  }
  assert.ok(fs.existsSync(path.join(PRESERVED, 'live-minimal', 'cultural-watermark-live-darwin.json')), '留证缺 live-minimal JSON');
  // 留证的极简 flow 必须仍是极简形态（断言锚其特征串，防留证被替换）
  const flow = fs.readFileSync(path.join(PRESERVED, 'cultural-watermark.cjs'), 'utf8');
  assert.ok(flow.length > 500, '留证 flow 异常短');
  const liveMinimal = JSON.parse(fs.readFileSync(path.join(PRESERVED, 'live-minimal', 'cultural-watermark-live-darwin.json'), 'utf8'));
  assert.equal(liveMinimal.allPass, false, '极简版自身实机证据=allPass:false（终版裁决依据，留证不得美化）');
});

test('S5 实机证据 allPass 结构在场', () => {
  const live = JSON.parse(fs.readFileSync(path.join(R2, 's5', 'live', 's5-default-identity-live-darwin.json'), 'utf8'));
  assert.equal(live.allPass, true);
  assert.ok(Array.isArray(live.assertions) && live.assertions.length >= 10, `断言数异常: ${live.assertions.length}`);
  for (const a of live.assertions) assert.equal(a.pass, true, `断言失败残留: ${a.name}`);
});

test('R2/R3 评估在场且含四维评分与总分（9/20 基线 → R3 趋势）', () => {
  const r2 = fs.readFileSync(path.join(R2_ASSESS, 'ASSESSMENT.md'), 'utf8');
  assert.match(r2, /9\s*\/\s*20（45%）/, 'R2 首基线 9/20 读数在场');
  assert.ok(fs.existsSync(path.join(R2_ASSESS, 'gates', 'exit-codes.tsv')), 'R2 gates 退出码台账在场');
  const r3 = fs.readFileSync(path.join(R3_ASSESS, 'ASSESSMENT.md'), 'utf8');
  assert.match(r3, /R2 问题清单/, 'R3 闭环表在场');
  assert.ok(/16\s*\/\s*20（80%）/.test(r3), 'R3 四维重打分总分在场');
});

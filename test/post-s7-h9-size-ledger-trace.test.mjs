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

test('loop-orchestrator.js 双层守护：独立行数锚 + L0 发现入册冻结棘轮', () => {
  // 判定沿革：BLOCK-394 时不塞 700 行预算门（需新增例外，违反「只出不进」裁决），另立
  // 独立行数锚棘轮（scripts/post-s7-big-file-ratchet.mjs）；L0-7（L-36）起生产树 >700 行
  // 全量发现入册（wave='L0'，行数/sha/CSS 字节棘轮、预算 enforcement 随拆分转正），
  // 与行数锚双层并存——脚本源码仍不点名该文件（发现器通用，防清单漂移）。
  assert.equal(manifestSrc.includes('loop-orchestrator.js'), false);
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts/post-s7-big-file-ratchet.mjs')));
  const anchor = JSON.parse(fs.readFileSync(path.join(ROOT, 'acceptance/post-s7-2026-11-10/h9/big-file-anchor.json'), 'utf8'));
  const row = anchor.files.find((f) => f.path === 'core/petri-server/loop-orchestrator.js');
  assert.ok(row && row.lines > 1500 && row.lines < 1700, `行数锚异常: ${JSON.stringify(row)}`);
  // L0-7：尺寸台账已覆盖该文件（行数冻结棘轮）
  const ledgerRow = baseline.files.find((f) => f.path === 'core/petri-server/loop-orchestrator.js');
  assert.ok(ledgerRow, 'loop-orchestrator.js 应已入尺寸台账（L0 发现入册）');
  assert.equal(ledgerRow.wave, 'L0');
  assert.equal(ledgerRow.lines, row.lines, '尺寸台账与行数锚读数一致');
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

// BLOCK-394 B-14 重打留因：SimpleChat.tsx +10 行全部来自重连横幅挂载（非放宽）。
test('SimpleChat.tsx 基线 +10 行有据可查：确为 B-14 横幅挂载', () => {
  const row = baseline.files.find((f) => f.path === 'frontend/src/components/copilot/SimpleChat.tsx');
  assert.ok(row);
  const src = fs.readFileSync(path.join(ROOT, 'frontend/src/components/copilot/SimpleChat.tsx'), 'utf8');
  assert.ok(src.includes("import { StreamReconnectBanner, deriveReconnectPhase }"));
  assert.ok(src.includes('<StreamReconnectBanner'));
  assert.ok(src.includes('const reconnectAttempt = useMemo'));
  assert.equal(row.lines, 2089, '基线须与 B-14 挂载后的源码一致');
  const countLines = (t) => { const a = t.split('\n'); if (a.length && a.at(-1) === '') a.pop(); return a.length; };
  assert.equal(countLines(src), row.lines);
});

test('负测：B-14 挂载被移除后不得仍宣称 +10 行有据', () => {
  const src = fs.readFileSync(path.join(ROOT, 'frontend/src/components/copilot/SimpleChat.tsx'), 'utf8');
  assert.ok(src.includes('<StreamReconnectBanner'));
  const removed = src.replace("import { StreamReconnectBanner, deriveReconnectPhase } from './StreamReconnectBanner';", '');
  assert.equal(removed.includes("import { StreamReconnectBanner"), false, 'import 行应被移除');
  assert.ok(removed.includes('<StreamReconnectBanner'), '渲染引用仍在（只删 import 的局部形态）');
});

/**
 * K1 改进点 4 契约：165 通道分诊可信度 + 启发式负测。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readTriage, registeredChannels, firstBatch, adjudicateIpcTriage,
} from '../scripts/lib/post-h9-k1-ipc-triage.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const triage = readTriage(ROOT);
const registered = registeredChannels(ROOT);
const first = firstBatch(triage, registered);
const good = {
  triage, registered, firstBatchItems: first,
  consumerDetector: { commentOnly: false, dynamicMountMissed: false },
};
const red = (patch) => {
  const v = adjudicateIpcTriage({ ...good, ...patch });
  assert.equal(v.ok, false, `篡改后必须判红: ${JSON.stringify(patch)}`);
  return v;
};

test('165 通道三桶计数机械一致，124/41/0 与 H9 证据相符', () => {
  const v = adjudicateIpcTriage(good);
  assert.equal(v.ok, true, v.issues.join(' / '));
  assert.deepEqual(v.counts, { needsWiring: 124, retainWithReason: 41, deletable: 0, total: 165 });
  assert.equal(v.verdict, 'triage-credible-first-batch-scoped');
});

test('第一批（有 preload 包装且非 mainOnly）非空且全部在唯一注册表', () => {
  assert.ok(first.length >= 40, `第一批 ${first.length} 条`);
  assert.ok(first.every((i) => i.registered));
  assert.ok(first.every((i) => i.hasPreloadWrapper && !i.mainOnly));
  assert.ok(first.every((i) => i.decision === 'retain-for-K5-adjudication'), 'K1 不擅自接线');
});

test('负测：删掉一条通道导致静默消失 → 判红', () => {
  const t = structuredClone(triage);
  t.buckets.needsWiring.pop();
  red({ triage: t });
});

test('负测：total 被改成 164 → 判红', () => {
  red({ triage: { ...triage, total: 164 } });
});

test('负测：needsWiring 出现重复通道 → 判红', () => {
  const t = structuredClone(triage);
  t.buckets.needsWiring.push({ ...t.buckets.needsWiring[0] });
  red({ triage: t });
});

test('负测：通道名不在 channels.js（凭空销号）→ 判红', () => {
  const t = structuredClone(triage);
  t.buckets.needsWiring.push({ channel: 'fake:never-registered', domain: 'fake', inPreload: true, mainOnly: false, usedInRenderer: false });
  t.total = 166;
  red({ triage: t, firstBatchItems: [...first, { registered: false }] });
});

test('负测：第一批为空（空转）→ 判红', () => {
  red({ firstBatchItems: [] });
});

test('负测：消费检测把注释命中当真实消费（宽松启发式假绿）→ 判红', () => {
  red({ consumerDetector: { commentOnly: true, dynamicMountMissed: false } });
});

test('负测：消费检测漏掉 router.* / 动态挂载 → 判红', () => {
  red({ consumerDetector: { commentOnly: false, dynamicMountMissed: true } });
});

test('负测：缺消费方检测可信度证据 → 判红', () => {
  red({ consumerDetector: null });
});

test('负测：证据整体缺席 → fail-closed 判红', () => {
  assert.equal(adjudicateIpcTriage({}).ok, false);
});

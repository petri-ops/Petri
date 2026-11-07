/**
 * BLOCK-332 — UI 台账状态契约 + 证据债棘轮。
 *
 * 动因（测量腿实测）：`grep -c in_progress docs/ui-productization-audit.md` 在 2026-11-02 给出 **218**，
 * 而按段首状态解析只有 **29 条**真正未闭合（10 可补 + 19 受阻）——差在「最后更新」链行也带
 * in_progress 字样、以及历史「in_progress → verified」叠加写法。计数不可信 → 债无法管理。
 *
 * 本测钉四件事（口径唯一源 = `scripts/ui-ledger-triage.mjs`，这里不重写解析逻辑）：
 * ① 每个 `## UI-###` 段首必须带合法状态词（verified/in_progress/cancelled/superseded）——
 *    否则是台账缺陷（历史 `active` 单独出现即算缺陷）；
 * ② 同一 id 允许多段（UI-185 曾 6 段），但至多一段未闭合——避免「一个 id 两处并行验收」；
 * ③ 证据债上限棘轮：`debt = live-missing + blocked` 不得高于基线（只许下降）；
 * ④ 测量证据在册可回读（acceptance/block-332/ui-ledger-triage.json 与当前台账同构）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { triageLedger } from '../scripts/ui-ledger-triage.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = path.join(root, 'docs', 'ui-productization-audit.md');
const EVIDENCE = path.join(root, 'acceptance', 'block-332', 'ui-ledger-triage.json');

// 债务上限：2026-11-02 BLOCK-332 分诊实测值（补齐或判销后下调；只许下降）。
// 注：脚本分桶是**启发式预分类**（关键词：随/依赖/前提/外部条件），权威处置写在本包 plan §4 分诊表；
// 本棘轮只防「新条目悄悄堆债」，不代替逐条判档。
// BLOCK-370/371 — NSO W3/W3b 新增 UI-697/698/699 三条 in_progress（均有明确 pending 腿描述：
// binary 产物种子/scheduled 入口/读屏走查），上限随事实同步上调；下一步=补腿降回。
// BLOCK-376（S1）— 新增 UI-700（SSE task.failed 结构化终态消费；pending 腿=实机失败场景
// 走查，补腿队列归蓝图 S3 UI 台账终态化批），上限随事实同步上调 7→8。
const DEBT_CEILING = { liveMissing: 8, blocked: 25 };

const report = triageLedger(fs.readFileSync(LEDGER, 'utf8'));

test('BLOCK-332 — 每个 UI 段首都有合法状态词（台账缺陷即红）', () => {
  assert.deepEqual(
    report.unknown,
    [],
    `以下条目段首没有合法状态词（verified/in_progress/cancelled/superseded）：${report.unknown.join(', ')}`,
  );
});

test('BLOCK-332 — 同一 id 至多一段未闭合', () => {
  assert.deepEqual(
    report.duplicateOpenIds,
    [],
    `同 id 多段且都未闭合：${report.duplicateOpenIds.map((d) => `${d.id}×${d.sections}`).join(', ')}`,
  );
});

test('BLOCK-332 — 证据债只许下降（棘轮）', () => {
  assert.ok(
    report.liveMissing.length <= DEBT_CEILING.liveMissing,
    `可补实机腿条目涨到 ${report.liveMissing.length}（上限 ${DEBT_CEILING.liveMissing}）——新条目应先补腿或如实判档`,
  );
  assert.ok(
    report.blocked.length <= DEBT_CEILING.blocked,
    `受阻条目涨到 ${report.blocked.length}（上限 ${DEBT_CEILING.blocked}）`,
  );
});

test('BLOCK-332 — 测量证据在册且与当前台账同构（不靠叙述）', () => {
  assert.ok(fs.existsSync(EVIDENCE), '缺 acceptance/block-332/ui-ledger-triage.json');
  const evidence = JSON.parse(fs.readFileSync(EVIDENCE, 'utf8'));
  assert.equal(evidence.sections, report.sections, '证据与当前台账段数不一致——请重跑 npm run ui:audit:triage');
  assert.equal(evidence.debt, report.debt);
  assert.deepEqual(evidence.counts, report.counts);
});

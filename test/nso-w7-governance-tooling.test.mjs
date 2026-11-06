/**
 * nso-w7-governance-tooling.test.mjs — BLOCK-362（NSO-W7a）治理漂移转机械门禁。
 *
 * W7a-1 audit:compact 归档目标守卫：链淘汰行写入 audit-log-through-<最新日期>.md；若该文件带
 *       他方未提交改动，追加即「覆盖他人在制」。本程序 W0/W2/W4 三次复发，均人工逐字迁回。
 *       规则：不存在→新建；存在且干净→追加；存在且脏或 git 状态不可读→带时间戳新文件。
 * W7a-2 coverage 字段：documentCount / managedMarkdown 由手工同步（本程序内 4 次），
 *       漂移不红（F-22）。规则：docs:check 校验与实际计数一致，提供重算写回。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';

const { chooseArchiveTarget } = await import('../scripts/audit-log-compact.mjs');
const { computeCoverageCounts, validateCoverageCounts } = await import('../scripts/docs-governance.mjs');

const DIR = '/repo/docs/archive/checkpoints';

test('W7a-1 目标不存在 → 新建标准名', () => {
  const t = chooseArchiveTarget({ archiveDir: DIR, baseName: 'audit-log-through-2026-11-05.md', exists: false, dirty: false, nowIso: '2026-11-06T03:00:00.000Z' });
  assert.deepEqual(t, { path: path.join(DIR, 'audit-log-through-2026-11-05.md'), redirected: false });
});

test('W7a-1 目标存在且干净 → 追加标准名（既有行为不变）', () => {
  const t = chooseArchiveTarget({ archiveDir: DIR, baseName: 'audit-log-through-2026-11-05.md', exists: true, dirty: false, nowIso: '2026-11-06T03:00:00.000Z' });
  assert.equal(t.redirected, false);
  assert.equal(path.basename(t.path), 'audit-log-through-2026-11-05.md');
});

test('W7a-1 负测：目标带未提交改动 → 改写带时间戳的新文件，永不追加脏文件', () => {
  const t = chooseArchiveTarget({ archiveDir: DIR, baseName: 'audit-log-through-2026-11-05.md', exists: true, dirty: true, nowIso: '2026-11-06T03:00:23.681Z' });
  assert.equal(t.redirected, true);
  assert.equal(path.basename(t.path), 'audit-log-through-2026-11-05.r20261106T030023Z.md');
});

test('W7a-1 负测：git 状态不可读按脏处理（fail-safe）', () => {
  const t = chooseArchiveTarget({ archiveDir: DIR, baseName: 'audit-log-compact-2026-11-06.md', exists: true, dirty: null, nowIso: '2026-11-06T03:00:23.681Z' });
  assert.equal(t.redirected, true);
});

test('W7a-2 coverage 计数一致性：一致通过，漂移逐字段点名', () => {
  const registry = { documents: new Array(5).fill({}), coverage: { documentCount: 5, managedMarkdown: 4 } };
  assert.deepEqual(validateCoverageCounts(registry, computeCoverageCounts(registry, 4)), []);
  const drift = validateCoverageCounts({ ...registry, coverage: { documentCount: 3, managedMarkdown: 9 } }, computeCoverageCounts(registry, 4));
  assert.equal(drift.length, 2);
  assert.ok(drift.some((d) => /documentCount/.test(d.message)));
  assert.ok(drift.some((d) => /managedMarkdown/.test(d.message)));
});

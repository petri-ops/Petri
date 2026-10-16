/**
 * BLOCK-190 — catalog 五列化契约测（确定性、离线、零 volatile）。
 * 守：①每枚 evals 任务派生五列 ID/setup/action/assertion/evidence 全非空；②evals/CATALOG.md 与生成物
 *     逐字节同步（棘轮：新增/改任务未重生成目录→红）；③目录零 volatile（无 tmp/path/id/时间戳/随机）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { deriveCatalogRow, listSuites, collectSuiteTasks, renderCatalog } from '../scripts/lib/evals-catalog.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SUITES = path.join(ROOT, 'evals', 'suites');
const CATALOG = path.join(ROOT, 'evals', 'CATALOG.md');

test('每枚 evals 任务五列非空（ID/setup/action/assertion/evidence）', () => {
  let total = 0;
  for (const suite of listSuites(SUITES)) {
    for (const t of collectSuiteTasks(SUITES, suite)) {
      const r = deriveCatalogRow(t);
      total += 1;
      for (const col of ['id', 'setup', 'action', 'assertion', 'evidence']) {
        assert.ok(String(r[col] || '').trim().length > 0, `${suite}/${t.id} 五列「${col}」不得为空`);
      }
    }
  }
  assert.ok(total >= 10, `catalog 应覆盖 ≥10 枚任务，实测 ${total}`);
});

test('evals/CATALOG.md 与生成物逐字节同步（ratchet：新任务未入目录即红）', () => {
  const committed = fs.readFileSync(CATALOG, 'utf8');
  assert.equal(committed, renderCatalog() + '\n', 'CATALOG.md 过期——跑 npm run evals:catalog 重生成');
});

test('CATALOG.md 零 volatile（无临时路径/机器 id/时间戳）', () => {
  const text = fs.readFileSync(CATALOG, 'utf8');
  assert.doesNotMatch(text, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, '不得含 UUID');
  assert.doesNotMatch(text, /\bp_[0-9a-z]{6,}_[0-9a-z]{3,}\b/, '不得含项目 id');
  assert.doesNotMatch(text, /petri-evals-[a-z0-9]{4,}|C:\\\\Users|\/var\/folders|\/tmp\/petri/, '不得含临时库路径');
  assert.doesNotMatch(text, /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}\b/, '不得含时间戳');
});

test('deriveCatalogRow：golden first-success 五列语义正确', () => {
  const t = JSON.parse(fs.readFileSync(path.join(SUITES, 'golden', 'first-success.json'), 'utf8'));
  const r = deriveCatalogRow(t);
  assert.match(r.evidence, /归一化出站请求/, 'outbound_contains 应映射到出站 evidence');
  assert.match(r.evidence, /funnel TTFS/, 'ttfs_computable 应映射到 funnel TTFS');
  assert.match(r.assertion, /task_completed/);
});

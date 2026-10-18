/**
 * BLOCK-210（runlist W7e）— 留存/归档 + 迁移计划器契约测。
 *
 * 钉四件事：
 *  ① **默认零行为变化**：全 0/空配置下 keep 一切、不归档、不删除；
 *  ② **删除是显式动作**：`applyRetention` 默认 dryRun 且 allowDelete=false ⇒ 无 delete 动作；
 *  ③ **规划是纯函数**：不传真实文件也能断过期/容量两类分类；
 *  ④ **迁移只出计划**：阻塞项如实（源缺失/目标非空/同目录/相对路径），步骤含备份与回退。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b210-retention-'));
process.env.PETRI_LOCAL_DATA_DIR = dir;

const retention = require(path.join(ROOT, 'core/petri-server/helpers/data-retention.js'));
const migration = require(path.join(ROOT, 'core/petri-server/helpers/data-dir-migration.js'));
const schema = require(path.join(ROOT, 'core/packages/shared-config/config-schema.js'));

const DAY = 24 * 60 * 60 * 1000;
const entry = (name, daysOld, size = 100) => ({ path: `/d/${name}`, size, mtimeMs: Date.now() - daysOld * DAY });

test('BLOCK-210 基线 — 默认配置 = 不删不移（keep 全部，reclaimable 0）', () => {
  assert.deepEqual({ ...retention.DEFAULTS }, { historyDays: 0, archiveDir: '', maxBytesPerDir: 0 });
  const plan = retention.planRetention({ entries: [entry('a', 400), entry('b', 1)] });
  assert.deepEqual(plan.keep.map((e) => e.path), ['/d/a', '/d/b']);
  assert.equal(plan.archive.length, 0);
  assert.equal(plan.expired.length, 0);
  assert.equal(plan.totals.reclaimableBytes, 0);
});

test('BLOCK-210 — 过期分类：配了 archiveDir 进 archive，没配进 expired（都不自动删）', () => {
  const entries = [entry('old', 90), entry('new', 1)];
  const noArchive = retention.planRetention({ entries, config: { ...retention.DEFAULTS, historyDays: 30 } });
  assert.deepEqual(noArchive.expired.map((e) => e.path), ['/d/old']);
  assert.deepEqual(noArchive.keep.map((e) => e.path), ['/d/new']);

  const withArchive = retention.planRetention({ entries, config: { historyDays: 30, archiveDir: '/archive', maxBytesPerDir: 0 } });
  assert.deepEqual(withArchive.archive.map((e) => e.path), ['/d/old']);
  assert.equal(withArchive.expired.length, 0);
});

test('BLOCK-210 — 容量上限：按最新优先保留，超出部分进 expired', () => {
  const entries = [entry('newest', 1, 60), entry('middle', 2, 60), entry('oldest', 3, 60)];
  const plan = retention.planRetention({ entries, config: { ...retention.DEFAULTS, maxBytesPerDir: 120 } });
  assert.deepEqual(plan.keep.map((e) => e.path), ['/d/newest', '/d/middle']);
  assert.deepEqual(plan.expired.map((e) => e.path), ['/d/oldest']);
  assert.equal(plan.totals.keepBytes, 120);
});

test('BLOCK-210 — applyRetention：默认 dryRun 无动作；显式非 dryRun 且 allowDelete 才出 delete', () => {
  const entries = [entry('old', 90), entry('new', 1)];
  const config = { historyDays: 30, archiveDir: '', maxBytesPerDir: 0 };

  const dry = retention.applyRetention({ entries, config });
  assert.equal(dry.dryRun, true);
  assert.deepEqual(dry.actions, [], 'dryRun 默认不产生任何动作');

  const archiveOnly = retention.applyRetention({ entries, config: { historyDays: 30, archiveDir: '/archive', maxBytesPerDir: 0 }, dryRun: false });
  assert.deepEqual(archiveOnly.actions.map((a) => a.action), ['archive'], '有归档目录时只归档');

  const deleting = retention.applyRetention({ entries, config, dryRun: false, allowDelete: true });
  assert.deepEqual(deleting.actions.map((a) => a.action), ['delete'], 'allowDelete 才出现 delete');

  const noDelete = retention.applyRetention({ entries, config, dryRun: false, allowDelete: false });
  assert.deepEqual(noDelete.actions, [], '没有 allowDelete 时过期项也不删');
});

test('BLOCK-210 — 写面守卫：未知键/越界拒绝；命中审计', () => {
  assert.ok(retention.validatePatch({ historyDays: -1 }).some((d) => d.code === 'out-of-range'));
  assert.ok(retention.validatePatch({ bogus: 1 }).some((d) => d.code === 'unknown-key'));
  assert.ok(retention.validatePatch({ maxBytesPerDir: 1e13 }).some((d) => d.code === 'out-of-range'));

  retention.resetRetention();
  assert.equal(retention.writeStore({ historyDays: -5 }).ok, false);
  assert.equal(fs.existsSync(retention.configFilePath()), false, '拒绝写 = 不落盘');

  assert.equal(retention.writeStore({ historyDays: 30 }).ok, true);
  assert.equal(retention.readStore().historyDays, 30);
  const audit = fs.readFileSync(retention.auditFilePath(), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(audit.some((a) => a.what === 'config'), '配置变更要留痕');
  retention.resetRetention();
});

test('BLOCK-210 — 迁移计划器：只读、阻塞项如实、含备份与回退', () => {
  const missing = migration.planMigration({ from: path.join(dir, 'nope'), to: path.join(dir, 'dst') });
  assert.equal(missing.ok, false);
  assert.ok(missing.blockers.some((b) => b.includes('源目录不可读或不存在')));

  const relative = migration.planMigration({ from: 'rel/x', to: '/abs/y' });
  assert.ok(relative.blockers.some((b) => b.includes('绝对路径')));

  const same = migration.planMigration({ from: dir, to: dir });
  assert.ok(same.blockers.some((b) => b.includes('同一目录')));

  const src = path.join(dir, 'src');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'petri.db'), 'x');
  const nonEmptyDst = path.join(dir, 'dst');
  fs.mkdirSync(nonEmptyDst, { recursive: true });
  fs.writeFileSync(path.join(nonEmptyDst, 'keep.txt'), 'x');
  const blocked = migration.planMigration({ from: src, to: nonEmptyDst });
  assert.ok(blocked.blockers.some((b) => b.includes('目标目录已存在且非空')));

  const okPlan = migration.planMigration({ from: src, to: path.join(dir, 'fresh') });
  assert.ok(okPlan.steps.some((s) => s.includes('备份')));
  assert.ok(okPlan.steps.some((s) => s.includes('校验')));
  assert.ok(okPlan.rollback.length >= 1, '必须有回退路径');
  assert.ok(okPlan.backupPath && okPlan.backupPath.includes('.bak-'));
  // 只读：计划器不得创建目标目录
  assert.equal(fs.existsSync(path.join(dir, 'fresh')), false, 'planMigration 不得创建任何东西');
});

test('BLOCK-210 — 注册面：data-retention 三键、全部 ui:none', () => {
  const keys = schema.CONFIG_KEYS.filter((e) => e.family === 'data-retention');
  assert.deepEqual(keys.map((e) => e.path).sort(), ['archiveDir', 'historyDays', 'maxBytesPerDir']);
  assert.ok(keys.every((e) => e.ui === 'none'));
});

test('BLOCK-210 — HTTP 面：PUT 400 守卫；迁移计划缺参 400、正常 200 且 executed:false', async () => {
  const express = require('express');
  const app = express();
  require(path.join(ROOT, 'core/petri-server/routes/data-retention.js')).registerDataRetentionRoutes(app);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const bad = await fetch(`${base}/api/data/retention`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ historyDays: -1 }),
    });
    assert.equal(bad.status, 400);

    const planMissing = await fetch(`${base}/api/data/migration/plan`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: dir }),
    });
    assert.equal(planMissing.status, 400);

    const ok = await fetch(`${base}/api/data/migration/plan`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: path.join(dir, 'src'), to: path.join(dir, 'fresh') }),
    });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.executed, false, '预览端点永不执行');
    assert.ok(Array.isArray(body.plan.steps));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

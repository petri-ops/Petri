/**
 * BLOCK-207（runlist W7b）— 项目信任级契约测。
 *
 * 钉四件事：
 *  ① **默认 = 零行为变化**：`inherit` 不改任何档位（不配置就不干预任何项目）。
 *  ② **只收紧**：`untrusted` 下 `workspace-write`/`full` → `read`；`read`/`plan` 原样
 *     （信任是"能不能动工作区"，不是"能不能看"）；`trusted` 原样。
 *  ③ **敏感项留审计**：信任变更追加 `trust-audit.jsonl`（from/to/actor），导入与重置也留痕。
 *  ④ **不是第二套权限系统**：本模块不导出任何"判定/审批"入口，四档矩阵由 policy 层守。
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b207-trust-'));
process.env.PETRI_LOCAL_DATA_DIR = dir;

const trust = require(path.join(ROOT, 'core/petri-server/helpers/trust-policy.js'));

test('BLOCK-207 基线 — 天花板的四档 × 三信任级矩阵（只能收紧）', () => {
  // inherit：零行为变化
  for (const mode of trust.ACCESS_MODES) assert.equal(trust.applyTrustCeiling(mode, 'inherit'), mode);
  // trusted：原样（信任不等于提权，只是不压）
  for (const mode of trust.ACCESS_MODES) assert.equal(trust.applyTrustCeiling(mode, 'trusted'), mode);
  // untrusted：写/执行降 read；看与规划保留
  assert.equal(trust.applyTrustCeiling('read', 'untrusted'), 'read');
  assert.equal(trust.applyTrustCeiling('plan', 'untrusted'), 'plan');
  assert.equal(trust.applyTrustCeiling('workspace-write', 'untrusted'), 'read');
  assert.equal(trust.applyTrustCeiling('full', 'untrusted'), 'read');
  // 未知档位不替上游改语义（上游本就会把未知值塌缩 full）
  assert.equal(trust.applyTrustCeiling('weird', 'untrusted'), 'weird');
});

test('BLOCK-207 — 默认 inherit：不配置时任何项目都不被干预', () => {
  trust.resetTrustPolicy();
  assert.equal(trust.readStore().defaultLevel, 'inherit');
  assert.equal(trust.levelForProject('p_any'), 'inherit');
  assert.equal(trust.levelForProject(null), 'inherit');
  assert.equal(trust.policyFilePath(), path.join(dir, 'trust-policy.json'));
});

test('BLOCK-207 — 落点：写/读/优先级（项目级覆盖 defaultLevel）', () => {
  const saved = trust.writeStore({
    defaultLevel: 'trusted',
    projects: [{ project: 'p_untrusted', level: 'untrusted' }, { project: 'p_inherit', level: 'inherit' }],
  });
  assert.equal(saved.ok, true, `写入应通过：${JSON.stringify(saved.diagnostics)}`);
  assert.equal(trust.levelForProject('p_untrusted'), 'untrusted', '项目级覆盖默认');
  assert.equal(trust.levelForProject('p_other'), 'trusted', '未列出的项目走 defaultLevel');
  assert.equal(trust.levelForProject('p_inherit'), 'inherit');
  trust.resetTrustPolicy();
});

test('BLOCK-207 — 写侧守卫：未知 level / 重名 / 未知字段 / 缺 project 一律拒且不落盘', () => {
  assert.ok(trust.validateStore({ defaultLevel: 'maybe' }).some((d) => d.code === 'not-allowed'));
  assert.ok(trust.validateStore({ projects: [{ project: 'a', level: 'root' }] }).some((d) => d.path === 'projects[0].level'));
  assert.ok(trust.validateStore({ projects: [{ project: 'a', level: 'trusted' }, { project: 'a', level: 'untrusted' }] }).some((d) => d.code === 'not-allowed'));
  assert.ok(trust.validateStore({ projects: [{ level: 'trusted' }] }).some((d) => d.path === 'projects[0]'));
  assert.ok(trust.validateStore({ projects: [{ project: 'a', level: 'trusted', allow: 'x' }] }).some((d) => d.code === 'unknown-key'));

  trust.resetTrustPolicy();
  assert.equal(trust.writeStore({ projects: [{ project: 'a', level: 'root' }] }).ok, false);
  assert.equal(fs.existsSync(trust.policyFilePath()), false, '拒绝写 = 一个字节都不落');
});

test('BLOCK-207 — 审计：变更逐条留痕（含 from/to/actor），无变更不写', () => {
  trust.resetTrustPolicy();
  const auditPath = trust.auditFilePath();
  fs.rmSync(auditPath, { force: true });

  // 无变更（写同样的内容）不应产生审计行
  trust.writeStore({ defaultLevel: 'inherit', projects: [] });
  assert.equal(fs.existsSync(auditPath), false, '没有变更就不写审计');

  trust.writeStore({ defaultLevel: 'inherit', projects: [{ project: 'p1', level: 'untrusted' }] });
  trust.writeStore({ defaultLevel: 'trusted', projects: [{ project: 'p1', level: 'untrusted' }] }, { actor: 'import' });
  trust.writeStore({ defaultLevel: 'trusted', projects: [] }, { actor: 'user' });

  const lines = fs.readFileSync(auditPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(lines.length >= 3, `审计应至少 3 条（实得 ${lines.length}）`);
  assert.ok(lines.some((l) => l.what === 'project' && l.project === 'p1' && l.to === 'untrusted' && l.actor === 'user'));
  assert.ok(lines.some((l) => l.what === 'defaultLevel' && l.from === 'inherit' && l.to === 'trusted' && l.actor === 'import'));
  assert.ok(lines.some((l) => l.what === 'project' && l.project === 'p1' && l.to === null), '移除项目也要留痕');
  trust.resetTrustPolicy();
});

test('BLOCK-207 — 读侧宽容：坏文件/未知 level 条目回落默认', () => {
  fs.writeFileSync(trust.policyFilePath(), JSON.stringify({
    version: 1,
    defaultLevel: 'nonsense',
    projects: [{ project: 'ok', level: 'untrusted' }, { project: 'bad', level: 'root' }],
  }), 'utf8');
  const store = trust.readStore();
  assert.equal(store.defaultLevel, 'inherit', '非法默认级回落 inherit（零干预）');
  assert.deepEqual(store.projects, [{ project: 'ok', level: 'untrusted' }], '非法 level 的条目丢弃，合法条目保留');
  trust.resetTrustPolicy();
});

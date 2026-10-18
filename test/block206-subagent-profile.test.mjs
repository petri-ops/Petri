/**
 * BLOCK-206（runlist W7a）— 子智能体 profile 声明式配置契约测。
 *
 * 钉四件事：
 *  ① **对账条款**：profile 的 `concurrency` 域必须与 `runtime.spawnConcurrency` **逐字相等**
 *     （不许出现第二套并发上限数字）；`reportGuard` 只接受 `inherit`（汇报门是全局接点）。
 *  ② **只能收紧**：`effectiveSpawnConcurrency(runtime, profile)` = min，永不放宽——安全方向单向。
 *  ③ **未配置 = 零行为变化**：没传 profile 时派发上限就是 runtime 值；profile 空库时解析返回空。
 *  ④ 未知 profile fail-closed；写侧整份消毒（重名/default 悬空/未知字段都拒绝）。
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b206-subagent-profile-'));
process.env.PETRI_LOCAL_DATA_DIR = dir;

const schema = require(path.join(ROOT, 'core/packages/shared-config/config-schema.js'));
const profiles = require(path.join(ROOT, 'core/petri-server/helpers/subagent-profile.js'));
const { effectiveSpawnConcurrency } = profiles;

test('BLOCK-206 基线 — 对账：profile.concurrency 的域与 runtime.spawnConcurrency 逐字相等', () => {
  const runtime = schema.findKeyEntry('runtime.spawnConcurrency');
  const profile = schema.findKeyEntry('subagentProfile.<item>.concurrency');
  assert.ok(runtime && profile, '两条键都必须登记');
  assert.deepEqual(profile.domain, runtime.domain, 'profile 不许自带第二套并发上限');
  // 深度不属 profile（它是全局拓扑约束）：profile 字段里不得出现 maxDepth
  assert.deepEqual(schema.itemFieldPaths('subagent-profile'), ['name', 'role', 'model', 'concurrency', 'reportGuard']);
});

test('BLOCK-206 基线 — 只能收紧：min(runtime, profile)，永不放宽', () => {
  assert.equal(effectiveSpawnConcurrency(3, null), 3, '未传 profile = 零行为变化');
  assert.equal(effectiveSpawnConcurrency(3, { concurrency: 2 }), 2, 'profile 更严 ⇒ 取更严');
  assert.equal(effectiveSpawnConcurrency(2, { concurrency: 8 }), 2, 'profile 更松 ⇒ 仍取 runtime（永不放大）');
  assert.equal(effectiveSpawnConcurrency(3, { concurrency: undefined }), 3, 'profile 未声明并发 ⇒ 沿用 runtime');
});

test('BLOCK-206 — 落点：写/读/解析/重置 + 位置走数据根单源', () => {
  assert.equal(profiles.profileFilePath(), path.join(dir, 'subagent-profiles.json'));
  assert.deepEqual(profiles.readStore(), { version: 1, default: '', profiles: [] }, '空库 = 零配置');

  const saved = profiles.writeStore({
    default: 'researcher',
    profiles: [
      { name: 'researcher', role: 'explorer', concurrency: 2, reportGuard: 'inherit' },
      { name: 'coder', model: 'deepseek-chat' },
    ],
  });
  assert.equal(saved.ok, true, `写入应通过：${JSON.stringify(saved.diagnostics)}`);

  const resolved = profiles.resolveProfile('researcher');
  assert.equal(resolved.ok, true);
  assert.deepEqual(resolved.profile, { name: 'researcher', role: 'explorer', concurrency: 2, reportGuard: 'inherit' });
  assert.equal(profiles.readStore().default, 'researcher');
  assert.deepEqual(profiles.listProfiles().map((p) => p.name), ['researcher', 'coder']);

  // 未知 profile：fail-closed（与 agentRoles 同语义）
  assert.equal(profiles.resolveProfile('nope').error, 'unknown_profile');
  assert.equal(profiles.resolveProfile('').error, 'profile_name_required');

  profiles.resetProfiles();
  assert.deepEqual(profiles.readStore().profiles, []);
});

test('BLOCK-206 — 写侧守卫：reportGuard 只收 inherit、重名/悬空 default/未知字段一律拒', () => {
  // reportGuard 只有 inherit：逐子任务覆盖汇报门要改 report-guard 契约（reopen）
  const badGuard = profiles.validateStore({ profiles: [{ name: 'x', reportGuard: 'on' }] });
  assert.ok(badGuard.some((d) => d.path === 'reportGuard' && d.code === 'not-allowed'));

  assert.ok(profiles.validateStore({ profiles: [{ name: 'dup' }, { name: 'dup' }] }).some((d) => d.code === 'not-allowed'));
  assert.ok(profiles.validateStore({ default: 'ghost', profiles: [] }).some((d) => d.path === 'default'));
  assert.ok(profiles.validateStore({ profiles: [{ name: 'x', toolAllow: 'a,b' }] }).some((d) => d.code === 'unknown-key'));
  // 并发域外
  assert.ok(profiles.validateStore({ profiles: [{ name: 'x', concurrency: 99 }] }).some((d) => d.code === 'out-of-range'));

  // 整批不落盘
  assert.equal(profiles.writeStore({ profiles: [{ name: 'x', reportGuard: 'on' }] }).ok, false);
  assert.equal(fs.existsSync(profiles.profileFilePath()), false);
});

test('BLOCK-206 — 读侧宽容：坏文件/坏条目只丢该条', () => {
  fs.writeFileSync(profiles.profileFilePath(), JSON.stringify({
    version: 1,
    default: 'ok-one',
    profiles: [
      { name: 'ok-one', concurrency: 2 },
      { name: 'bad-name', concurrency: 99 },
      { name: 'ok-two', junk: 1 },
    ],
  }), 'utf8');
  const store = profiles.readStore();
  assert.deepEqual(store.profiles.map((p) => p.name), ['ok-one', 'bad-name', 'ok-two'], '合法条目全部保留');
  assert.equal(store.profiles[1].concurrency, undefined, '域外值丢弃该字段（不连坐整条）');
  assert.equal(store.profiles[2].junk, undefined, '未注册字段不得进内存');
  assert.equal(store.profiles[1].reportGuard, undefined);
  profiles.resetProfiles();
});

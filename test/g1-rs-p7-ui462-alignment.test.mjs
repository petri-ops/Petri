/**
 * G1 P7 资格契约与 UI-462 对齐 — HK-01 红绿先行（owner 裁决 msg_5bc541c8c0eb）。
 * ①REQUIRED_ENVIRONMENTS 保留 existing_* 防历史绑定漂移；ACTIVE_ENVIRONMENTS 去掉退役项；
 * ②新证据不再要求 existing_*；③qualificationEligible 恒 false 不翻；既有门零放宽。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

test('P7 对齐 HK-01：退役环境有显式标注，历史枚举不删（防绑定漂移）', () => {
  const q = require(path.join(ROOT, 'core/shared-backend/result-studio-qualification.js'));
  assert.ok(Array.isArray(q.RETIRED_ENVIRONMENTS), '须导出 RETIRED_ENVIRONMENTS');
  assert.deepEqual(q.RETIRED_ENVIRONMENTS, ['existing_clean_git', 'existing_dirty_git']);
  assert.ok(Array.isArray(q.ACTIVE_ENVIRONMENTS), '须导出 ACTIVE_ENVIRONMENTS');
  // 历史枚举保留（证据绑定不漂）
  for (const id of q.RETIRED_ENVIRONMENTS) {
    assert.ok(q.REQUIRED_ENVIRONMENTS.includes(id), `${id} 须保留在 REQUIRED_ENVIRONMENTS`);
    assert.equal(q.ACTIVE_ENVIRONMENTS.includes(id), false, `${id} 不得在 ACTIVE`);
  }
  assert.ok(q.ACTIVE_ENVIRONMENTS.includes('managed_non_git'));
});

test('P7 对齐 HK-01：新资格判定按 ACTIVE 集——不要求已退役的 existing_*', () => {
  const src = fs.readFileSync(path.join(ROOT, 'core/shared-backend/result-studio-qualification.js'), 'utf-8');
  assert.match(src, /ACTIVE_ENVIRONMENTS\.filter\(\(id\) => !environments\.has\(id\)\)/);
});

test('P7 对齐 HK-01：evidence-bundle existing 分支标退役 + 历史引用可分离', () => {
  const src = fs.readFileSync(path.join(ROOT, 'core/shared-backend/result-studio-evidence-bundle.js'), 'utf-8');
  assert.match(src, /UI-462|retired|Retired|退役/);
  // 历史证据仍可被读取（不删 existing 分支），但不是新资格要求
  assert.match(src, /repository\.mode === 'existing'/);
});

test('P7 对齐 HK-01：资格语义零翻转——qualificationEligible 恒 false、门不放宽', () => {
  const q = require(path.join(ROOT, 'core/shared-backend/result-studio-qualification.js'));
  const src = fs.readFileSync(path.join(ROOT, 'core/shared-backend/result-studio-qualification.js'), 'utf-8');
  assert.match(src, /qualificationEligible: false/);
  assert.match(src, /REQUIRED_TASKS/); // 五任务门未删
  assert.equal(Object.isFrozen(q.ACTIVE_ENVIRONMENTS), true);
  assert.equal(Object.isFrozen(q.RETIRED_ENVIRONMENTS), true);
});

/**
 * BLOCK-201 W2 — 拆前基线（设置搜索/分区过滤/按区重置/全景导出导入）。
 *
 * 本文件在实现前写下并跑红（`config-transfer` 尚不存在），实现后转绿；此后**冻结**：
 * 它钉住的是「设置分区清单」与「注册表族/键集合」这两份事实，任何一边悄悄增删都必须
 * 显式改本文件——这正是本包要防的「搜索索引漏分区 / 导出漏族」。
 *
 * 三条事实：
 *  ① 设置面板分区清单 = 10 项（BLOCK-200 加了 keymap/reasoning 后从 8 变 10；
 *     `docs/stage-3-4-execution-runlist.md` 的「8 分区」口径已过时，本包按实况登记）；
 *  ② 配置注册表 = 8 族 / 35 键（BLOCK-199 四族 + BLOCK-200 两族 + BLOCK-202 两族）；
 *  ③ 导出/导入的族集合必须与注册表**逐族相等**（不得偷偷漏族或加未注册族）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const schema = require(path.join(ROOT, 'core/packages/shared-config/config-schema.js'));

const SETTINGS_TYPES = 'frontend/src/components/desktop/DesktopSettingsPanel/types.ts';

test('设置分区清单冻结：10 个分区 id（搜索索引必须逐项覆盖）', () => {
  const src = read(SETTINGS_TYPES);
  const ids = [...src.matchAll(/\{ id: '([a-z-]+)', label:/g)].map((m) => m[1]);
  assert.deepEqual(ids, [
    'general', 'models', 'compute', 'usage', 'decisions',
    'keymap', 'reasoning', 'diagnostics', 'experimental', 'maintenance',
  ]);
  assert.equal(ids.length, 10, `分区数应为 10（实得 ${ids.length}）：${ids.join(', ')}`);
});

test('配置注册表冻结：8 族 / 35 键（BLOCK-202 加 network/runtime 两族）', () => {
  assert.equal(Object.keys(schema.CONFIG_FAMILIES).length, 8);
  assert.equal(schema.CONFIG_KEYS.length, 35);
});

test('导出/导入的族集合 == 注册表族集合（漏族/未注册族都算红）', () => {
  const { CONFIG_TRANSFER_FAMILIES } = require(path.join(ROOT, 'core/petri-server/helpers/config-transfer.js'));
  assert.deepEqual(
    [...CONFIG_TRANSFER_FAMILIES].sort(),
    Object.keys(schema.CONFIG_FAMILIES).sort(),
  );
});

test('导出永不包含凭据字段（D-2 静态面：schema 与 transfer 源码都不出现 key 明文出口）', () => {
  const src = read('core/petri-server/helpers/config-transfer.js');
  for (const forbidden of ['apiKey', 'credential', 'secret']) {
    assert.ok(!new RegExp(`${forbidden}\\s*:`).test(src), `config-transfer 不得构造 ${forbidden} 字段`);
  }
  assert.match(src, /EXCLUDES|excludes/, '导出必须显式声明排除清单（凭据/未注册落点）');
});

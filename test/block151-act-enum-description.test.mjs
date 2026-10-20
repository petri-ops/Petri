/**
 * BLOCK-217 — act 工具「描述 ↔ schema ↔ 运行时派发实现」三方一致契约（P2-UI 版）。
 *
 * 核心只保留领域中性动作；单细胞/FigCode 动作已随旧页面退役移除。
 * ① description 必须逐字覆盖 enum 全集；
 * ② enum ↔ 派发实现一一对应（实现不逃逸 enum，enum 不指向缺失实现）；
 * ③ 旧领域动作不得回潮。
 */
import assert from 'node:assert/strict';
import fssync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(import.meta.url);

// 内存 DB 自举（act-tools 顶层 require ../db，同 block109 先例）
{
  const Database = require('better-sqlite3');
  const tempDbDir = fssync.mkdtempSync(path.join(os.tmpdir(), 'petri-b217-act-desc-'));
  const db = new Database(path.join(tempDbDir, 'petri.db'));
  const migrationsDir = path.join(root, 'src', 'migrations');
  for (const file of fssync.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(fssync.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  db.close();
  process.env.PETRI_DB_PATH = path.join(tempDbDir, 'petri.db');
  process.on('exit', () => {
    try { fssync.rmSync(tempDbDir, { recursive: true, force: true }); } catch { /* Windows 句柄延迟释放 */ }
  });
}

const browserDefs = require(path.join(root, 'core', 'petri-server', 'agent-tools', 'tool-defs', 'browser.js'));
const actTools = require(path.join(root, 'core', 'petri-server', 'agent-tools', 'act-tools.js'));

const actDef = browserDefs.find((d) => d.function && d.function.name === 'act');
const actEnum = actDef.function.parameters.properties.type.enum;
const actDescription = actDef.function.description;

const CORE_ACTIONS = [
  'rename_project',
  'rename_dataset',
  'rename_analysis',
  'update_analysis_params',
  'open_tool',
  'ui_action',
];

const RETIRED_ACTIONS = [
  'update_figcode_editor',
  'switch_result_tab',
  'focus_cluster',
  'highlight_gene',
  'select_cells',
  'filter_table',
  'label_cells',
  'merge_datasets',
  'open_replot',
  'upload_data_hint',
  'open_figcode_plot',
];

const pascal = (t) => t.split('_').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('');

test('P2-UI ① — act enum 只保留领域中性动作', () => {
  assert.deepEqual(actEnum, CORE_ACTIONS);
  assert.deepEqual(actTools.CORE_ACT_TYPES, CORE_ACTIONS);
});

test('P2-UI ① — act description 逐字覆盖 enum 全集', () => {
  const missing = actEnum.filter((type) => !actDescription.includes(type));
  assert.deepEqual(
    missing,
    [],
    `description 未提及的 enum type：${missing.join(', ')}`,
  );
});

test('P2-UI ① — 撤销声明与事实一致（仅重命名/参数修改可撤销，30 秒窗）', () => {
  assert.ok(actDescription.includes('撤销'), '撤销语义必须声明');
  assert.match(
    actDescription,
    /不支持撤销|不可撤销|仅重命名|只有重命名|重命名与参数修改/,
    '撤销声明必须限定可撤销子集',
  );
  assert.match(actDescription, /30 秒内撤销/, '撤销窗口须写 30 秒');
  assert.doesNotMatch(actDescription, /5 秒内撤销/, '不得写 5 秒');
  assert.doesNotMatch(actDescription, /所有操作[^。]*撤销/, '不得声称所有操作都支持撤销');
});

test('P2-UI ① — 旧单细胞/FigCode 动作不得回潮', () => {
  for (const retired of RETIRED_ACTIONS) {
    assert.equal(actEnum.includes(retired), false, `enum 不得包含 ${retired}`);
    assert.doesNotMatch(actDescription, new RegExp(retired), `description 不得包含 ${retired}`);
  }
  for (const domainWord of ['single-cell-result', '单细胞分析结果页', 'FigCode 工具页']) {
    assert.equal(actDescription.includes(domainWord), false, `description 不得包含领域页面标签 ${domainWord}`);
  }
});

test('P2-UI ② — act enum ↔ 派发实现一一对应', () => {
  for (const type of actEnum) {
    const fn = actTools[`act${pascal(type)}`];
    assert.equal(typeof fn, 'function', `enum type ${type} 没有对应派发实现 act${pascal(type)}`);
  }
  const enumFns = new Set(actEnum.map((type) => `act${pascal(type)}`));
  const escaped = Object.keys(actTools)
    .filter((key) => /^act[A-Z]/.test(key))
    .filter((key) => !enumFns.has(key));
  assert.deepEqual(escaped, [], `存在 enum 之外的派发实现：${escaped.join(', ')}`);
});

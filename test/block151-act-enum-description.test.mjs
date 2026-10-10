/**
 * BLOCK-151 C 轨 A3 — act 工具「描述 ↔ schema ↔ 运行时派发实现」三方一致契约。
 *
 * 审视坐实的漂移形态：schema enum 已有 16 种 type，description 却只列 4 种
 * （重命名 ×3 + 参数修改），其余 12 种动作对模型隐藏；且旧文案「所有操作…支持
 * 5 秒内撤销」与事实不符（实际仅重命名/参数修改可撤销，见 helpers/act-tool.js
 * undoAgentAct 的分支集）。本契约双向钉住，杜绝再次漂移：
 * ① description 必须逐字覆盖 enum 全集（新增 enum 不写描述即红）；
 * ② enum ↔ 派发实现一一对应——实现侧 act* 导出不得逃逸出 enum（隐藏动作即红），
 *    enum 不得指向不存在的实现（模型可调用面与真实执行面一致）。
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

// 内存 DB 自举（act-tools/plan-ui-tools 顶层 require ../db，同 block109 先例）
{
  const Database = require('better-sqlite3');
  const tempDbDir = fssync.mkdtempSync(path.join(os.tmpdir(), 'petri-b151-act-desc-'));
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
const planUiTools = require(path.join(root, 'core', 'petri-server', 'agent-tools', 'plan-ui-tools.js'));

const actDef = browserDefs.find((d) => d.function && d.function.name === 'act');
const actEnum = actDef.function.parameters.properties.type.enum;
const actDescription = actDef.function.description;

const pascal = (t) => t.split('_').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('');

test('A3 ① — act description 逐字覆盖 type enum 全集（对模型隐藏动作即红）', () => {
  assert.ok(Array.isArray(actEnum) && actEnum.length > 0, 'type enum 非空');
  assert.equal(new Set(actEnum).size, actEnum.length, 'type enum 无重复值');
  const missing = actEnum.filter((t) => !actDescription.includes(t));
  assert.deepEqual(
    missing,
    [],
    `description 未提及的 enum type（即对模型隐藏的动作）：${missing.join(', ')}`,
  );
});

test('A3 ① — act 撤销声明与事实一致（仅重命名/参数修改可撤销，不得声称「所有操作」）', () => {
  assert.ok(actDescription.includes('撤销'), '撤销语义必须声明（审计记录含 undoToken）');
  assert.match(
    actDescription,
    /不支持撤销|不可撤销|仅重命名|只有重命名|重命名与参数修改/,
    '撤销声明必须限定可撤销子集（rename_* / update_analysis_params）',
  );
  // 撤销窗口措辞钉事实（BLOCK-151 P2 携带项）：act-tool.js ageMs > 30_000 = 30 秒窗
  assert.match(actDescription, /30 秒内撤销/, '撤销窗口须写 30 秒（与 act-tool.js undo_window_expired 阈值一致）');
  assert.doesNotMatch(actDescription, /5 秒内撤销/, '不得写 5 秒（旧措辞与 30s 实现不符）');
  assert.doesNotMatch(
    actDescription,
    /所有操作[^。]*撤销/,
    '不得声称所有操作都支持撤销——undoAgentAct 只恢复重命名/旧参数',
  );
});

test('A3 ② — act enum ↔ 派发实现一一对应（实现不逃逸 enum，enum 不指向缺失实现）', () => {
  // enum 侧：每个 type 都有同名派发实现（act<Pad>，分布在 act-tools / plan-ui-tools）
  for (const t of actEnum) {
    const fn = actTools[`act${pascal(t)}`] || planUiTools[`act${pascal(t)}`];
    assert.equal(typeof fn, 'function', `enum type ${t} 没有对应派发实现 act${pascal(t)}`);
  }
  // 实现侧：所有 act<Pad> 导出都必须能映射回 enum——新派发实现漏登 schema 即红
  const enumFns = new Set(actEnum.map((t) => `act${pascal(t)}`));
  const implNames = [...Object.keys(actTools), ...Object.keys(planUiTools)]
    .filter((k) => /^act[A-Z]/.test(k));
  const escaped = implNames.filter((k) => !enumFns.has(k));
  assert.deepEqual(
    escaped,
    [],
    `存在 enum 之外的派发实现（即对模型隐藏的动作）：${escaped.join(', ')}`,
  );
});

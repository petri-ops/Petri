// BLOCK-200 P1 键位落盘面契约测：读写往返、写侧拒绝、解绑语义、坏文件宽松。
// 全部离线零网络；落点用 PETRI_LOCAL_DATA_DIR 指向临时目录（不碰真实数据目录）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-keymap-'));
process.env.PETRI_LOCAL_DATA_DIR = tmp;
const keymap = require('../core/petri-server/helpers/keymap.js');

function reset() {
  try { fs.rmSync(keymap.storePath(), { force: true }); } catch { /* 不存在即已重置 */ }
}

test('文件缺失=空覆盖且不落盘（读侧不得凭空造文件）', () => {
  reset();
  const snap = keymap.getKeymapSnapshot();
  assert.deepEqual(snap.bindings, {});
  assert.deepEqual(snap.diagnostics, []);
  assert.equal(fs.existsSync(keymap.storePath()), false, '读操作不该创建文件');
});

test('写入合法组合后读回一致（序列化往返）', () => {
  reset();
  const result = keymap.setKeymapBindings({ 'nav-home': 'Mod+Shift+N', 'palette.toggle': 'Mod+Shift+K' });
  assert.deepEqual(result.bindings, { 'nav-home': 'Mod+Shift+N', 'palette.toggle': 'Mod+Shift+K' });
  assert.deepEqual(keymap.getKeymapSnapshot().bindings, result.bindings);
});

test('未知命令 id 写侧拒绝并回结构化诊断（不再静默存活）', () => {
  reset();
  assert.throws(() => keymap.setKeymapBindings({ 'nav-typo': 'Mod+K' }), (err) => {
    assert.equal(err.message, 'config_value_rejected');
    assert.equal(err.diagnostics[0].code, 'unknown-key');
    assert.equal(err.diagnostics[0].path, 'nav-typo');
    return true;
  });
  assert.deepEqual(keymap.getKeymapSnapshot().bindings, {}, '拒绝写入后盘上必须无痕');
});

test('非法组合拒：裸键／重复修饰键／乱序修饰键／非白名单主键', () => {
  reset();
  for (const bad of ['K', 'Mod+Mod+K', 'Alt+Mod+K', 'Mod+£', 'Mod+', '']) {
    assert.throws(() => keymap.setKeymapBindings({ 'nav-home': bad }), (err) => {
      assert.equal(err.message, 'config_value_rejected');
      assert.ok(['not-allowed', 'type-mismatch'].includes(err.diagnostics[0].code), `${bad} → ${err.diagnostics[0].code}`);
      return true;
    }, `应当拒绝：${JSON.stringify(bad)}`);
  }
});

test('null=解绑：从盘上移除该命令（前端据此回落命令源默认）', () => {
  reset();
  keymap.setKeymapBindings({ 'nav-home': 'Mod+Shift+N' });
  const after = keymap.setKeymapBindings({ 'nav-home': null });
  assert.equal(after.bindings['nav-home'], undefined);
  assert.deepEqual(keymap.getKeymapSnapshot().bindings, {});
});

test('一批补丁里有一条非法 → 整批拒（不部分落盘，避免半套键位）', () => {
  reset();
  assert.throws(() => keymap.setKeymapBindings({ 'nav-home': 'Mod+Shift+N', 'nav-projects': 'bad value' }), /config_value_rejected/);
  assert.deepEqual(keymap.getKeymapSnapshot().bindings, {});
});

test('读侧宽松：盘上有未知 id 或坏值时只报告，不抛错、不炸启动', () => {
  reset();
  fs.mkdirSync(path.dirname(keymap.storePath()), { recursive: true });
  fs.writeFileSync(keymap.storePath(), JSON.stringify({
    bindings: { 'nav-home': 'Mod+Shift+N', 'nav-ghost': 'Mod+Q', 'palette.toggle': 'Mod+Mod+K', 'workspace.toggleRight': 42 },
  }));
  const snap = keymap.getKeymapSnapshot();
  assert.deepEqual(snap.bindings, { 'nav-home': 'Mod+Shift+N', 'nav-ghost': 'Mod+Q', 'palette.toggle': 'Mod+Mod+K' }, '非字符串值读侧丢弃');
  const codes = snap.diagnostics.map((d) => `${d.path}:${d.code}`).sort();
  assert.deepEqual(codes, ['nav-ghost:unknown-key', 'palette.toggle:not-allowed']);
});

test('损坏 JSON=空选择（与 feature-flags 同族的容错语义）', () => {
  reset();
  fs.mkdirSync(path.dirname(keymap.storePath()), { recursive: true });
  fs.writeFileSync(keymap.storePath(), '{ this is not json');
  assert.deepEqual(keymap.getKeymapSnapshot().bindings, {});
});

/**
 * BLOCK-203 W4a P4 — `agent-rules` 集合型落点收编契约测。
 *
 * 钉四件事：
 *  ① **集合形状单一实现**：条目字段用 `<item>.` 精确寻址（不是占位段匹配——占位段会让任意字段名
 *     都"注册"成功，写侧未知字段拒绝就空转了），读写两侧共用 `sanitizeItem`。
 *  ② **BLOCK-160 契约不破**：错误码仍是 `rule_id_required` / `rule_matcher_type_invalid` /
 *     `rule_pattern_required` / `rule_action_invalid`（前端与既有测试都认），新增只有
 *     `rule_field_unknown`（未知字段此前会被原样写进盘永久存活）。
 *  ③ **读侧宽容 / 写侧 fail-closed**：脏规则只丢该条，不连坐整份文件；写侧未知字段整单拒绝。
 *  ④ **落点路径与 first-match 语义不变**：`$PETRI_LOCAL_DATA_DIR/agent-rules.json`；规则顺序即判序。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = require(path.join(ROOT, 'core/packages/shared-config/config-schema.js'));
const rules = require(path.join(ROOT, 'core/petri-server/helpers/agent-user-rules.js'));

function withDataDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'petri-b203-rules-'));
  const previous = process.env.PETRI_LOCAL_DATA_DIR;
  process.env.PETRI_LOCAL_DATA_DIR = dir;
  try {
    return fn(dir);
  } finally {
    if (previous === undefined) delete process.env.PETRI_LOCAL_DATA_DIR;
    else process.env.PETRI_LOCAL_DATA_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}

const valid = (over = {}) => ({
  id: 'r1',
  matcher: { type: 'path-glob', pattern: 'secrets/**' },
  action: 'deny',
  scope: 'global',
  ...over,
});

test('BLOCK-203 P4 — 条目字段精确寻址：占位段不许把任意字段名"注册"成功', () => {
  assert.equal(schema.findItemFieldEntry('agent-rules', 'matcher.pattern').key, 'agentRules.<item>.matcher.pattern');
  assert.equal(schema.findItemFieldEntry('agent-rules', 'matcher.extra'), null);
  assert.equal(schema.findItemFieldEntry('agent-rules', 'anythingElse'), null);
  assert.deepEqual(schema.itemFieldPaths('agent-rules'), [
    'id', 'matcher.type', 'matcher.pattern', 'action', 'scope', 'note', 'createdAt',
  ]);
});

test('BLOCK-203 P4 — sanitizeItem：重建嵌套形状，未知字段/域外值只产诊断不进结果', () => {
  const { item, diagnostics } = schema.sanitizeItem('agent-rules', {
    id: 'r1',
    matcher: { type: 'path-glob', pattern: 'secrets/**', depth: 3 },
    action: 'deny',
    scope: 'global',
    unknownTop: true,
  });
  assert.deepEqual(item, { id: 'r1', matcher: { type: 'path-glob', pattern: 'secrets/**' }, action: 'deny', scope: 'global' });
  assert.deepEqual(diagnostics.map((d) => d.path).sort(), ['matcher.depth', 'unknownTop']);

  const bad = schema.sanitizeItem('agent-rules', { id: 'r2', matcher: { type: 'regex', pattern: 'x' }, action: 'allow' });
  assert.ok(bad.diagnostics.some((d) => d.path === 'matcher.type' && d.code === 'not-allowed'));
  assert.ok(bad.diagnostics.some((d) => d.path === 'action' && d.code === 'not-allowed'));
});

test('BLOCK-203 P4 — 写侧：未知字段整单拒绝（新码 rule_field_unknown），旧错误码逐一保持', () => withDataDir(() => {
  assert.deepEqual(rules.saveUserRules('nope'), { ok: false, error: 'rules_must_be_array' });

  const unknown = rules.saveUserRules([valid({ extra: 'x' })]);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error, 'rule_field_unknown');
  assert.ok(unknown.diagnostics.some((d) => d.path === 'extra'));

  assert.equal(rules.saveUserRules([valid({ id: '' })]).error, 'rule_id_required');
  assert.equal(rules.saveUserRules([valid({ matcher: { type: 'regex', pattern: 'x' } })]).error, 'rule_matcher_type_invalid');
  assert.equal(rules.saveUserRules([valid({ matcher: { type: 'path-glob', pattern: '   ' } })]).error, 'rule_pattern_required');
  assert.equal(rules.saveUserRules([valid({ action: 'allow' })]).error, 'rule_action_invalid');
  // 未知字段被拒 = 文件一个字节都不写
  assert.deepEqual(rules.loadUserRules(), []);
}));

test('BLOCK-203 P4 — 落点路径不变 + 写读往返（未知字段不落盘）', () => withDataDir((dir) => {
  assert.equal(rules.rulesFile(dir), path.join(dir, 'agent-rules.json'));
  const saved = rules.saveUserRules([valid(), valid({ id: 'r2', matcher: { type: 'command-token', pattern: 'rm' }, action: 'require-ack' })]);
  assert.deepEqual(saved, { ok: true, count: 2 });

  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'agent-rules.json'), 'utf8'));
  assert.equal(onDisk.version, 1);
  assert.deepEqual(Object.keys(onDisk.rules[0]).sort(), ['action', 'id', 'matcher', 'scope']);
  assert.deepEqual(onDisk.rules[1].matcher, { type: 'command-token', pattern: 'rm' });
}));

test('BLOCK-203 P4 — 读侧宽容：脏规则只丢该条，合法规则与 first-match 顺序不受影响', () => withDataDir((dir) => {
  fs.writeFileSync(path.join(dir, 'agent-rules.json'), JSON.stringify({
    version: 1,
    rules: [
      { id: 'keep-deny', matcher: { type: 'path-glob', pattern: 'secrets/**' }, action: 'deny', scope: 'global', junk: 1 },
      { id: 'bad-type', matcher: { type: 'regex', pattern: 'x' }, action: 'deny' },
      { id: 'keep-ack', matcher: { type: 'command-token', pattern: 'rm' }, action: 'require-ack' },
    ],
  }));
  const loaded = rules.loadUserRules();
  assert.deepEqual(loaded.map((r) => r.id), ['keep-deny', 'keep-ack'], '枚举域外的规则被丢，合法规则保留');
  assert.equal(loaded[0].junk, undefined, '未注册字段不得进内存（下次写入即自愈）');

  const hit = rules.evaluateUserRules('workspace_write', { path: 'secrets/key.pem' }, loaded);
  assert.equal(hit.rule.id, 'keep-deny', 'first-match 判序不变');
  assert.equal(hit.guardKey, 'rule:keep-deny');
}));

test('BLOCK-203 P4 — 导入侧：未知条目字段进诊断（整批拒绝），重置清空规则', () => {
  const { validateImport } = require(path.join(ROOT, 'core/petri-server/helpers/config-transfer.js'));
  const envelope = (families) => ({ format: 'petri-config', version: 1, families });

  assert.equal(validateImport(envelope({ 'agent-rules': { rules: [valid()] } })).ok, true);

  const bad = validateImport(envelope({ 'agent-rules': { rules: [valid({ extra: 'x' })] } }));
  assert.equal(bad.ok, false);
  assert.ok(bad.diagnostics.some((d) => d.path === 'rules[0].extra' && d.code === 'unknown-key'));

  const notArray = validateImport(envelope({ 'agent-rules': { rules: 'nope' } }));
  assert.equal(notArray.ok, false);
  assert.ok(notArray.diagnostics.some((d) => d.path === 'rules' && d.code === 'type-mismatch'));
});

test('BLOCK-203 P4 — version 是代码自写字段：读不报噪音，写仍拒绝', () => {
  const entry = schema.findItemFieldEntry('agent-rules', 'id');
  assert.equal(entry.ui, 'settings');
  const versionEntry = schema.findKeyEntry('agentRules.version');
  assert.equal(versionEntry.owner, 'code');
  assert.deepEqual(schema.diagnoseObject('agent-rules', schema.flattenOneLevel({ version: 1 }), (f, p) => schema.findEntryByPath(f, p)), []);
  assert.equal(schema.commitGuard('agent-rules', { version: 2 }, (f, p) => schema.findEntryByPath(f, p)).ok, false);
});

/**
 * QODER-J6 Agent builder — 自定义角色纯函数 HK-01（2026-11-23）。
 * 用户发令一次性推完；D 默认口径=自定义角色不得覆盖 baseRole/内置 key（人设钉死 BLOCK-339）。
 * 红线：只做角色 directive 软约束，不碰 sandbox/执行器/审批链。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULE = path.join(ROOT, 'core', 'shared-backend', 'custom-agent-roles.js');
const load = () => require(MODULE);

test('J6 模块存在且零新依赖', () => {
  assert.ok(fs.existsSync(MODULE), '须有 custom-agent-roles.js');
  assert.doesNotMatch(fs.readFileSync(MODULE, 'utf8'), /require\(['"](?!\.\.?\/|node:)/);
});

test('normalizeCustomRoles：合法角色入场，非法形状丢弃不整份失败', () => {
  const { normalizeCustomRoles } = load();
  const out = normalizeCustomRoles({
    roles: {
      reviewer2: { label: '审稿人', description: '审稿件', directive: '逐段审查论证', version: 1 },
      bad: { label: '' },
    },
  });
  assert.equal(out.ok, true);
  assert.equal(out.roles.length, 1);
  assert.equal(out.roles[0].key, 'reviewer2');
  assert.ok(out.diagnostics.some((d) => d.includes('bad')), '非法条目须有诊断');
});

test('禁止覆盖内置角色 key 与 baseRole 人设', () => {
  const { normalizeCustomRoles } = load();
  const out = normalizeCustomRoles({
    roles: {
      coder: { label: '冒名', directive: '覆盖内置' },
      baseRole: { label: '冒名 base', directive: '改人设' },
    },
    builtinKeys: ['coder'],
  });
  assert.equal(out.roles.length, 0, '内置 key/baseRole 均不得被自定义覆盖');
  assert.ok(out.diagnostics.length >= 2);
});

test('mergeAgentRoles：内置∪自定义，unknown fail-closed 路径仍有效', () => {
  const { mergeAgentRoles } = load();
  const merged = mergeAgentRoles(
    [{ key: 'coder', label: '编码' }],
    [{ key: 'reviewer2', label: '审稿人', directive: '审查' }],
  );
  assert.equal(merged.map.size, 2);
  assert.ok(merged.keys.has('coder') && merged.keys.has('reviewer2'));
  assert.equal(merged.map.get('nope'), undefined, '未知角色仍 fail-closed');
});

test('红线：baseRole 人设真源未改', () => {
  const sys = fs.readFileSync(path.join(ROOT, 'core/petri-server/helpers/system-prompt.js'), 'utf8');
  assert.match(sys, /baseRole/, 'baseRole 钉死仍在');
});

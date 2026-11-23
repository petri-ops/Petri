/**
 * QODER-J6 角色接入 — HK-01 契约（2026-11-23）。
 *
 * 用户发令「开始 J6 角色接入」：P1 核心 custom-agent-roles.js 接入 agent-roles.js，
 * 内置∪用户自定义 roles.json 合并、消费端零改、不覆盖 baseRole/内置 key。
 * 红线：不改产品 sandbox/CSP/凭据/B1 token/handler/pack 声明；不动 baseRole 人设。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AGENT_ROLES = path.join(ROOT, 'core/petri-server/agent-tools/agent-roles.js');
const load = () => require(AGENT_ROLES);

test('J6 接入：agent-roles.js 消费 P1 核心 custom-agent-roles', () => {
  const s = fs.readFileSync(AGENT_ROLES, 'utf8');
  assert.match(s, /custom-agent-roles|normalizeCustomRoles|mergeAgentRoles/, '须接入 P1 合并纯函数');
  assert.match(s, /agent-roles\.json|roles\.json/, '须读用户角色账本');
});

test('内置角色行为零变化（消费端零改）', () => {
  const { getAgentRole, isValidAgentRole, renderRoleDirective, resolveRoleOrError } = load();
  assert.ok(getAgentRole('write'), '内置 write 仍在');
  assert.equal(isValidAgentRole('write'), true);
  assert.match(renderRoleDirective('write'), /【角色：/);
  assert.deepEqual(resolveRoleOrError(''), { ok: true, role: null });
});

test('baseRole/内置 key 不可被自定义覆盖，未知角色仍 fail-closed', () => {
  const { isValidAgentRole, getAgentRole, resolveRoleOrError } = load();
  assert.equal(isValidAgentRole('baseRole'), false, 'baseRole 不得成为角色 key');
  assert.equal(isValidAgentRole('__proto__'), false, '原型污染 key 拒绝');
  assert.equal(getAgentRole('nope'), null);
  const bad = resolveRoleOrError('totally_unknown_role');
  assert.equal(bad.ok, false);
  assert.ok(bad.fail || bad.error);
});

test('自定义角色可读入（注入账本路径验证合并）', () => {
  const mod = load();
  assert.equal(typeof mod.__test.loadCustomRoles, 'function', '须有可测的自定义角色读取入口');
  const custom = mod.__test.loadCustomRoles('/nonexistent/roles.json');
  assert.deepEqual(custom, [], '账本不存在返回空数组（fail-soft）');
});

test('红线：baseRole 人设真源与产品安全边界未改', () => {
  const sys = fs.readFileSync(path.join(ROOT, 'core/petri-server/helpers/system-prompt.js'), 'utf8');
  const scheme = fs.readFileSync(path.join(ROOT, 'src/main/pack-ui/scheme.js'), 'utf8');
  assert.match(sys, /baseRole/);
  assert.match(scheme, /protocol\.handle\(SCHEME/);
});

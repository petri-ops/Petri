// BLOCK-177 — 技能治理面契约测试（停用/卸载/重装/审计）。
//
// 真实代码路径：skill-prefs 单源（temp userData 注入）+ 真实 skill-registry
// 安装/卸载/重装（真实临时目录与 installed manifest）+ SDK 治理方法 + agent 面过滤。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 每个测试文件级独立 userData（进程内全局注册表/偏好共享）
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'w177-'));
process.env.PETRI_USER_DATA_DIR = USER_DATA;

const prefs = require('../core/shared-backend/skill-prefs.js');

/** 造一个可安装的最小 skill 目录（skill.json 契约格式）。 */
function makeSkillDir(id, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `w177-skill-${id}-`));
  fs.writeFileSync(path.join(dir, 'skill.json'), JSON.stringify({
    skillManifestVersion: 1,
    id,
    name,
    version: '1.0.0',
    description: `${name}（BLOCK-177 测试技能）`,
    category: 'coding/notes',
    tags: [],
    plugins: { required: [], optional: [] },
    prompts: { system: '# 手册' },
    parameters: { required: [], optional: {} },
  }, null, 2));
  return dir;
}

// ---------- P0：停用/启用（prefs 单源） ----------
test('P0 setSkillDisabled：幂等停用/启用 + 审计 jsonl 落账', () => {
  assert.equal(prefs.setSkillDisabled('some-skill', true, '测试停用').ok, true);
  assert.equal(prefs.isSkillDisabled('some-skill'), true);
  // 幂等重复停用
  assert.equal(prefs.setSkillDisabled('some-skill', true).ok, true);
  assert.equal(prefs.isSkillDisabled('some-skill'), true);
  // 偏好文件真实落盘
  const saved = JSON.parse(fs.readFileSync(prefs.getPrefsFilePath(), 'utf8'));
  assert.equal(saved.disabled['some-skill'].reason, '测试停用');
  // 启用恢复
  assert.equal(prefs.setSkillDisabled('some-skill', false).ok, true);
  assert.equal(prefs.isSkillDisabled('some-skill'), false);
  // 审计序列：disable ×2 + enable
  const actions = prefs.readAuditTail().map((a) => a.action);
  assert.deepEqual(actions, ['disable', 'disable', 'enable']);
});

test('P0 annotate/filter：管理面打标不过滤，agent 面过滤', () => {
  prefs.setSkillDisabled('knap-x', true);
  const rows = [{ id: 'knap-x' }, { id: 'defuddle' }];
  assert.deepEqual(
    prefs.annotateDisabled(rows).map((s) => [s.id, s.disabled]),
    [['knap-x', true], ['defuddle', false]],
  );
  assert.deepEqual(prefs.filterDisabled(rows).map((s) => s.id), ['defuddle']);
});

// ---------- P0：SDK/agent 面真实链（真实 registry + 临时安装件） ----------
test('P0 SDK 全链：停用→管理面旗标在/agent 面消失/执行拒绝→启用→全恢复', async () => {
  const { SkillsSDK } = require('../core/shared-backend/skills-sdk.js');
  const { tool_skill_discover, tool_skill_get } = require('../core/petri-server/agent-tools/skill-tools.js');
  const sdk = new SkillsSDK();

  // 安装一个 imported 技能作为靶子（discover 可见 → installed 面真实在册）
  const dir = makeSkillDir('gov-target', '治理靶子');
  const installed = require('../core/shared-backend/skill-registry.js').installSkillFromDir(dir);
  assert.equal(installed.ok, true, JSON.stringify(installed));

  // 安装信息：sourceDir 记录在案且存在
  const info = sdk.getInstallInfo('gov-target');
  assert.equal(info.ok, true);
  assert.equal(info.sourceExists, true);
  assert.ok(info.sourceDir);

  // 停用 → 管理面：行在 + disabled 旗标
  assert.equal(sdk.setSkillDisabled('gov-target', true).ok, true);
  const listed = sdk.listSkills().find((s) => s.id === 'gov-target');
  assert.equal(listed.disabled, true);

  // 停用 → agent 面：discover 不可见、get 拒绝、执行拒绝
  const agentView = await tool_skill_discover({});
  assert.equal(agentView.skills.some((s) => s.id === 'gov-target'), false);
  const got = await tool_skill_get({ id: 'gov-target' });
  assert.equal(got.ok, false);
  assert.equal(got.error, 'skill_disabled');
  const exec = await sdk.executeSkill('gov-target', {});
  assert.equal(exec.success, false);
  assert.equal(exec.error.code, 'SKILL_DISABLED');

  // 启用 → 全部恢复
  assert.equal(sdk.setSkillDisabled('gov-target', false).ok, true);
  const restored = await tool_skill_discover({});
  assert.equal(restored.skills.some((s) => s.id === 'gov-target'), true);
  assert.equal(sdk.listSkills().find((s) => s.id === 'gov-target').disabled, false);
});

// ---------- P1：卸载/重装 ----------
test('P1 卸载与重装：installed 可卸（built-in 拒绝）→ sourceDir 一键重装恢复', async () => {
  const { SkillsSDK } = require('../core/shared-backend/skills-sdk.js');
  const sdk = new SkillsSDK();

  // built-in 卸载 = 诚实拒绝（既有内置件）
  const builtin = sdk.uninstallSkill('coding-playbook');
  assert.equal(builtin.ok, false);
  assert.equal(builtin.error, 'builtin_cannot_uninstall');

  // installed 卸载 → discover 消失
  assert.equal(sdk.uninstallSkill('gov-target').ok, true);
  assert.equal(sdk.listSkills().some((s) => s.id === 'gov-target'), false);

  // 重装（来源目录还在）→ 恢复在册 + 审计落账
  const reinstalled = sdk.reinstallFromSource('gov-target');
  assert.equal(reinstalled.ok, true, JSON.stringify(reinstalled));
  assert.equal(sdk.listSkills().some((s) => s.id === 'gov-target'), true);
  const actions = prefs.readAuditTail().map((a) => a.action);
  assert.ok(actions.includes('uninstall') && actions.includes('reinstall'));

  // 源目录缺失的重装 = 诚实报错
  const info = sdk.getInstallInfo('gov-target');
  fs.rmSync(info.sourceDir, { recursive: true, force: true });
  const missing = sdk.reinstallFromSource('gov-target');
  assert.equal(missing.ok, false);
  assert.equal(missing.error, 'source_dir_missing');
});

// ---------- 接线源码面（IPC/类型/UI） ----------
test('接线：四通道双侧登记+类型面+UI 分叉+store actions（源码级）', () => {
  const channels = fs.readFileSync(path.join(ROOT, 'src/ipc/channels.js'), 'utf8');
  const preload = fs.readFileSync(path.join(ROOT, 'src/preload.js'), 'utf8');
  for (const ch of ['skills:set-disabled', 'skills:uninstall', 'skills:get-install-info', 'skills:reinstall']) {
    assert.ok(channels.includes(`'${ch}'`), `channels 缺 ${ch}`);
    assert.ok(preload.includes(`'${ch}'`), `preload 缺 ${ch}`);
  }
  const dts = fs.readFileSync(path.join(ROOT, 'frontend/src/lib/electron.d.ts'), 'utf8');
  assert.ok(dts.includes('setDisabled') && dts.includes('getInstallInfo'));
  const store = fs.readFileSync(path.join(ROOT, 'frontend/src/hooks/useSkillStore.ts'), 'utf8');
  assert.ok(store.includes('setSkillDisabled') && store.includes('reinstallSkill'));
  const detail = fs.readFileSync(path.join(ROOT, 'frontend/src/pages/extensions/SkillDetail.tsx'), 'utf8');
  assert.ok(detail.includes('skill-toggle-disabled') && detail.includes('skill-uninstall') && detail.includes('skill-reinstall'));
  const card = fs.readFileSync(path.join(ROOT, 'frontend/src/pages/extensions/SkillCard.tsx'), 'utf8');
  assert.ok(card.includes('已停用'));
});

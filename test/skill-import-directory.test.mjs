/**
 * BLOCK-156 D7 — 第三方技能本地目录导入测试。
 * 钉住：合法目录安装后 discoverSkills 可见（source=installed）/缺 skill.json
 * fail-closed/坏 manifest 拒绝/built-in id 冲突拒绝/重复导入覆盖/卸载清净。
 * PETRI_USER_DATA_DIR 指向临时目录隔离本机真实 installed 清单。
 */

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve('.');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'b156-skill-import-'));
process.env.PETRI_USER_DATA_DIR = path.join(tmpRoot, 'user-data');

const registry = require(path.join(ROOT, 'core', 'shared-backend', 'skill-registry.js'));

const VALID_MANIFEST = {
  skillManifestVersion: 1,
  id: 'my-general-skill',
  name: '我的通用技能',
  version: '1.0.0',
  description: 'BLOCK-156 D7 导入测试用通用技能',
  category: 'productivity',
  plugins: { required: [], optional: [] },
  parameters: { required: [], optional: {} },
};

function makeSkillDir(id, version, overrides = {}) {
  const dir = path.join(tmpRoot, 'sources', `${id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'skill.json'),
    JSON.stringify({ ...VALID_MANIFEST, id, version, ...overrides }, null, 2),
  );
  fs.writeFileSync(path.join(dir, 'workflow.md'), '# demo\n');
  return dir;
}

after(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* Windows 句柄延迟 */ }
});

test('D7 合法目录导入 → discoverSkills 可见（source=installed，附件随目录复制）', () => {
  const dir = makeSkillDir('my-general-skill', '1.0.0');
  const installed = registry.installSkillFromDir(dir);
  assert.equal(installed.ok, true, JSON.stringify(installed));

  const found = registry.discoverSkills().find((s) => s.id === 'my-general-skill');
  assert.ok(found, 'discoverSkills 应含导入技能');
  assert.equal(found.source, 'installed');
  assert.equal(found.version, '1.0.0');

  // 附件随目录复制（导入的是副本，不是源目录引用）
  const dest = path.join(process.env.PETRI_USER_DATA_DIR, 'skills', 'my-general-skill');
  assert.ok(fs.existsSync(path.join(dest, 'workflow.md')));
});

test('D7 缺 skill.json / 坏 manifest → fail-closed 拒绝且零写入', () => {
  const emptyDir = path.join(tmpRoot, 'sources', 'no-manifest');
  fs.mkdirSync(emptyDir, { recursive: true });
  const miss = registry.installSkillFromDir(emptyDir);
  assert.equal(miss.ok, false);
  assert.equal(miss.error, 'skill_manifest_missing');

  const badDir = makeSkillDir('bad-skill', 'not-semver');
  const bad = registry.installSkillFromDir(badDir);
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'skill_manifest_invalid');

  // 零写入：installed 目录无 bad-skill
  assert.ok(!fs.existsSync(path.join(process.env.PETRI_USER_DATA_DIR, 'skills', 'bad-skill')));
});

test('D7 built-in id 冲突拒绝（导入不得静默不可见）', () => {
  const dir = makeSkillDir('deg-analysis-standard', '9.9.9');
  const conflict = registry.installSkillFromDir(dir);
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error, 'skill_id_conflicts_builtin');
});

test('D7 重复导入覆盖更新（以最新导入为准）+ 卸载清净', () => {
  const v1 = makeSkillDir('my-general-skill', '1.0.0');
  assert.equal(registry.installSkillFromDir(v1).ok, true);
  const v2 = makeSkillDir('my-general-skill', '2.0.0');
  const upgraded = registry.installSkillFromDir(v2);
  assert.equal(upgraded.ok, true);

  const found = registry.discoverSkills().find((s) => s.id === 'my-general-skill');
  assert.equal(found.version, '2.0.0');

  const removed = registry.uninstallImportedSkill('my-general-skill');
  assert.equal(removed.ok, true);
  assert.ok(!registry.discoverSkills().some((s) => s.id === 'my-general-skill'));
  assert.ok(!fs.existsSync(path.join(process.env.PETRI_USER_DATA_DIR, 'skills', 'my-general-skill')));
});

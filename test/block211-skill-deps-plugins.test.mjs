/**
 * BLOCK-211（W8 第六批 · C-33 代码侧）— preflight 必须把 `plugins.required` 算进依赖。
 *
 * 背景：「货架可见不可用」的机械原因=preflight 只看 `dependencies.requiresBins`（二进制），
 * 完全无视 `plugins.required`（插件包硬依赖）。生物信息学两族依赖是**插件而不是二进制**，
 * 所以恒报 `available`，卡片显示"依赖可用"但实际缺 5 个插件包。
 *
 * 本测钉：①插件缺失 ⇒ 不得 available；②插件缺失不标 installable（插件没有自动安装配方）；
 * ③不传 hasPlugin 时保持既有纯函数语义（默认视为可用，不给既有调用方制造假红）；
 * ④领域包注册表里两族的 plugins.required 确实非空（数据面不减配；BLOCK-214 后
 *   两族已从 core built-in 迁入 petri-pack-bio/skills）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const preflight = require(path.join(ROOT, 'core/shared-backend/skill-preflight.js'));
const { discoverAvailablePacks } = require(path.join(ROOT, 'core/shared-backend/pack-registry.js'));

const bioPack = discoverAvailablePacks({ projectRoot: ROOT }).find((pack) => pack.packId === 'petri-pack-bio') || null;

const skillWithPlugins = (required) => ({ id: 'deg-x', dependencies: {}, plugins: { required, optional: [] } });

test('C-33 — 插件缺失不得报 available；缺插件也不算 installable', () => {
  const skill = skillWithPlugins(['expression-qc', 'deseq2']);
  const allMissing = preflight.checkSkillDeps(skill, { hasPlugin: () => false });
  assert.equal(allMissing.status, 'missing_deps');
  assert.deepEqual(allMissing.missingPlugins, ['expression-qc', 'deseq2']);

  const partial = preflight.checkSkillDeps(skill, { hasPlugin: (id) => id === 'expression-qc' });
  assert.deepEqual(partial.missingPlugins, ['deseq2']);

  // 有 install 配方也不行：配方只装二进制，装不出插件包
  const withInstall = preflight.checkSkillDeps({ ...skill, dependencies: { install: 'brew install r' } }, { hasPlugin: () => false });
  assert.equal(withInstall.status, 'missing_deps', '插件缺失不能标"可安装"');

  const ok = preflight.checkSkillDeps(skill, { hasPlugin: () => true });
  assert.equal(ok.status, 'available');
  assert.deepEqual(ok.missingPlugins, []);
});

test('C-33 — 不传 hasPlugin 保持既有语义（默认视为可用，不制造假红）', () => {
  const skill = skillWithPlugins(['custom-thing']);
  assert.equal(preflight.checkSkillDeps(skill).status, 'available');
  const bins = { id: 'b', dependencies: { requiresBins: ['rscript'] }, plugins: { required: [] } };
  assert.equal(preflight.checkSkillDeps(bins, { hasBin: () => false }).status, 'missing_deps');
  assert.deepEqual(preflight.checkSkillDeps(bins, { hasBin: () => false }).missingPlugins, []);
});

test('C-33 — preflightAll 透传 hasPlugin，逐技能给出缺失插件', () => {
  const skills = [skillWithPlugins(['a', 'b']), { id: 'plain', dependencies: {}, plugins: { required: [] } }];
  const out = preflight.preflightAll(skills, { hasPlugin: (id) => id !== 'b' });
  assert.deepEqual(out['deg-x'].missingPlugins, ['b']);
  assert.equal(out.plain.status, 'available');
});

test('C-33 — 领域包注册表：两族生信 skill 的 plugins.required 非空（数据面不减配）', { skip: !bioPack && 'sibling bio pack absent' }, () => {
  const skillsRoot = path.join(bioPack.packRoot, 'skills');
  const manifest = JSON.parse(fs.readFileSync(path.join(skillsRoot, 'manifest.json'), 'utf8'));
  const deg = JSON.parse(fs.readFileSync(path.join(skillsRoot, 'deg-analysis-standard', 'skill.json'), 'utf8'));
  const sc = JSON.parse(fs.readFileSync(path.join(skillsRoot, 'sc-analysis-standard', 'skill.json'), 'utf8'));
  assert.ok(manifest.skills['deg-analysis-standard'], 'deg 未登记进 pack skills manifest');
  assert.ok(manifest.skills['sc-analysis-standard'], 'sc 未登记进 pack skills manifest');
  assert.ok(deg.plugins.required.length >= 3, 'deg 至少 3 个插件硬依赖');
  assert.ok(sc.plugins.required.length >= 2, 'sc 至少 2 个插件硬依赖');
});

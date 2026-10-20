// BLOCK-176 W7 — Agent Skill 知识面契约测试（CP-20/21/22）。
//
// CP-20：SKILL.md 双格式常驻注册 + 声明式依赖（os/requires.bins/install）归一与校验。
// CP-21：preflight 依赖三态纯函数面（注入 platform/hasBin）。
// CP-22：九个 Obsidian 迁移技能真实在册（真实 resources/skills/ 数据源）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
  normalizeDependencies,
  parseSkillMd,
  loadSkillFromDir,
  loadSkillMdEntry,
  loadBuiltInSkills,
} = require('../core/shared-backend/skill-registry.js');
const { checkSkillDeps } = require('../core/shared-backend/skill-preflight.js');

// ---------- CP-20：依赖归一 ----------
test('CP-20 normalizeDependencies：别名归一/列表拆分/非法 token 进 invalid（fail-closed 报告）', () => {
  const ok = normalizeDependencies({ os: 'macos, win', requiresBins: 'a, b b', install: 'npm i -g x' });
  assert.deepEqual(ok.os, ['darwin', 'win32']);
  assert.deepEqual(ok.requiresBins, ['a', 'b', 'b'].filter((v, i, a) => a.indexOf(v) === i));
  assert.equal(ok.install, 'npm i -g x');
  assert.deepEqual(ok.invalid, []);

  const bad = normalizeDependencies({ os: 'sunos', requiresBins: '', install: '' });
  assert.equal(bad.os, null);
  assert.deepEqual(bad.invalid, ['sunos']);
  assert.deepEqual(normalizeDependencies(null), { os: null, requiresBins: [], install: null, invalid: [] });
});

test('CP-20 parseSkillMd：点号键 requires.bins 解析 + 旧四键不受影响', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w7-skillmd-'));
  try {
    fs.writeFileSync(path.join(dir, 'SKILL.md'), [
      '---',
      'name: 依赖技能',
      'description: 带外部二进制',
      'version: 2.0.0',
      'category: coding/extract',
      'os: darwin, linux',
      'requires.bins: foo-cli, bar',
      'install: npm i -g foo-cli',
      '---',
      '# 手册',
      '正文步骤',
    ].join('\n'));
    const parsed = parseSkillMd(dir);
    assert.equal(parsed.manifest.id, path.basename(dir).toLowerCase()); // id 规则含小写归一
    assert.deepEqual(parsed.manifest.dependencies.os, ['darwin', 'linux']);
    assert.deepEqual(parsed.manifest.dependencies.requiresBins, ['foo-cli', 'bar']);
    assert.equal(parsed.manifest.dependencies.install, 'npm i -g foo-cli');
    assert.match(parsed.systemPrompt, /^# 手册/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CP-20 双格式装载：skill.json 优先；仅 SKILL.md 时直装载（_format=skill-md，正文进 prompts.system）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w7-dual-'));
  try {
    // 仅 SKILL.md
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: A\ndescription: 双格式 A\n---\n正文 A');
    const mdEntry = loadSkillFromDir(dir, 'built-in');
    assert.ok(mdEntry, 'SKILL.md 目录应可装载');
    assert.equal(mdEntry._format, 'skill-md');
    assert.equal(mdEntry.prompts.system, '正文 A');
    assert.ok(mdEntry.dependencies);

    // skill.json 优先于 SKILL.md
    fs.writeFileSync(path.join(dir, 'skill.json'), JSON.stringify({
      skillManifestVersion: 1, id: 'dual-test', name: 'JSON 优先', version: '1.0.0',
      description: 'skill.json 与 SKILL.md 并存时 json 胜出', category: 'general',
      prompts: { system: '直接内联' },
    }));
    const jsonEntry = loadSkillFromDir(dir, 'built-in');
    assert.equal(jsonEntry._format, 'skill-json');
    assert.equal(jsonEntry.name, 'JSON 优先');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CP-20 loadBuiltInSkills：真实仓发现 11 技能（2 json + 9 skill-md）且 CP-22 九件在册', () => {
  const builtIn = loadBuiltInSkills();
  const ids = new Set(builtIn.map((s) => s.id));
  const expected9 = ['obsidian-markdown', 'mermaid-visualizer', 'excalidraw-diagram', 'json-canvas',
    'obsidian-bases', 'obsidian-cli', 'defuddle', 'knap', 'obsidian-setup'];
  for (const id of expected9) assert.ok(ids.has(id), `缺 CP-22 技能: ${id}`);
  const mdEntries = builtIn.filter((s) => s._format === 'skill-md');
  assert.ok(mdEntries.length >= 9, `skill-md 装载数应 ≥9，实际 ${mdEntries.length}`);
  assert.ok(builtIn.length >= 11, `总内置应 ≥11（2 json + 9 md），实际 ${builtIn.length}`);
  const defuddle = builtIn.find((s) => s.id === 'defuddle');
  assert.deepEqual(defuddle.dependencies.requiresBins, ['defuddle']);
  assert.match(defuddle.dependencies.install, /npm install -g defuddle-cli/);
});

// ---------- CP-21：preflight 三态（纯函数注入面） ----------
test('CP-21 checkSkillDeps：available/installable/missing_deps/blocked_platform 四态', () => {
  const skill = { dependencies: { os: null, requiresBins: ['a', 'b'], install: 'npm i -g ab' } };
  assert.equal(checkSkillDeps(skill, { hasBin: () => true }).status, 'available');
  const inst = checkSkillDeps(skill, { hasBin: (b) => b !== 'a' });
  assert.equal(inst.status, 'installable');
  assert.deepEqual(inst.missingBins, ['a']);
  assert.equal(inst.install, 'npm i -g ab');
  const noRecipe = checkSkillDeps({ dependencies: { os: null, requiresBins: ['x'], install: null } }, { hasBin: () => false });
  assert.equal(noRecipe.status, 'missing_deps');
  const blocked = checkSkillDeps({ dependencies: { os: ['darwin'], requiresBins: ['a'] } }, { platform: 'win32', hasBin: () => true });
  assert.equal(blocked.status, 'blocked_platform');
  assert.equal(blocked.platformOk, false);
  // 无依赖技能=available（现状零变化）
  assert.equal(checkSkillDeps({}, { hasBin: () => false }).status, 'available');
});

test('CP-21 工具接线：skill_preflight 在册（registry+tool-defs+路由+前端徽章 源码面）', () => {
  const fs2 = require('node:fs');
  const reg = fs2.readFileSync(path.join(ROOT, 'core/petri-server/agent-tools/registry.js'), 'utf8');
  assert.match(reg, /skill_preflight: tool_skill_preflight/);
  assert.match(reg, /skill_preflight: contract\('retrieval', 'none', 'R0'/);
  const defs = fs2.readFileSync(path.join(ROOT, 'core/petri-server/agent-tools/tool-defs/skill.js'), 'utf8');
  assert.match(defs, /name: 'skill_preflight'/);
  const route = fs2.readFileSync(path.join(ROOT, 'core/petri-server/routes/projection-data.js'), 'utf8');
  assert.match(route, /\/api\/skills\/preflight/);
  const card = fs2.readFileSync(path.join(ROOT, 'frontend/src/pages/extensions/SkillCard.tsx'), 'utf8');
  assert.match(card, /skill-deps-/);
  const preflightMsg = fs2.readFileSync(path.join(ROOT, 'core/petri-server/agent-tools/skill-tools.js'), 'utf8');
  assert.match(preflightMsg, /审批确认/); // 安装指引走既有审批链（不建第二确认通道）
});

// ---------- CP-22：迁移面 ----------
test('CP-22 九技能 SKILL.md 齐备且 skills:check 纪律面（manifest format 标注）', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'resources/skills/manifest.json'), 'utf8'));
  const expected9 = ['obsidian-markdown', 'mermaid-visualizer', 'excalidraw-diagram', 'json-canvas',
    'obsidian-bases', 'obsidian-cli', 'defuddle', 'knap', 'obsidian-setup'];
  for (const id of expected9) {
    assert.ok(manifest.skills[id], `${id} 未登记顶层 manifest`);
    assert.equal(manifest.skills[id].format, 'skill-md', `${id} 应标 format=skill-md`);
    assert.ok(fs.existsSync(path.join(ROOT, 'resources/skills', id, 'SKILL.md')), `${id} 缺 SKILL.md`);
  }
});

test('CP-22 loadSkillMdEntry 导出与 discover 集成（注册表即真实数据源）', () => {
  assert.equal(typeof loadSkillMdEntry, 'function');
  const { SkillRegistry } = require('../core/shared-backend/skill-registry.js');
  const registry = new SkillRegistry();
  const all = registry.discover();
  assert.ok(all.some((s) => s.id === 'knap' && s._format === 'skill-md'));
  assert.ok(all.some((s) => s.id === 'visualize' && s._format === 'skill-json'));
});

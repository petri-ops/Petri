import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  MANIFEST_CANDIDATES,
  looksLikePluginManifest,
  resolvePluginRoot,
  scanPluginSources,
  synthesizeCommandSkills,
} from '../scripts/lib/agent-plugin-sources.mjs';
import { importExternalPlugin } from '../scripts/import-external-plugin.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(ROOT, 'test', 'fixtures', 'external-plugins');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'b445-'));

test('BLOCK-445 清单候选覆盖多 Agent，泛化清单需带插件特征', () => {
  for (const c of ['.zcode-plugin/plugin.json', '.claude-plugin/plugin.json', '.codex-plugin/plugin.json', '.codebuddy-plugin/plugin.json']) {
    assert.ok(MANIFEST_CANDIDATES.includes(c));
  }
  assert.equal(looksLikePluginManifest({ name: 'x', mcpServers: {} }), true);
  assert.equal(looksLikePluginManifest({ name: 'x', description: '只是普通包' }), false);
  assert.equal(looksLikePluginManifest(null), false);
});

test('BLOCK-445 resolvePluginRoot：ZCode / Claude / 单技能目录 / 普通目录', () => {
  const z = resolvePluginRoot(path.join(FIX, 'zcode-demo'));
  assert.equal(z.agent, 'zcode');
  assert.equal(z.singleSkill, false);
  assert.equal(z.manifest.name, 'zcode-demo');
  const c = resolvePluginRoot(path.join(FIX, 'claude-demo'));
  assert.equal(c.agent, 'claude-code');
  const skill = resolvePluginRoot(path.join(FIX, 'claude-demo', 'skills', 'doc-writer'));
  assert.equal(skill.agent, 'any-skill');
  assert.equal(skill.singleSkill, true);
  assert.equal(skill.manifestPath, null);
  const empty = tmp();
  assert.equal(resolvePluginRoot(empty), null);
  fs.rmSync(empty, { recursive: true, force: true });
});

test('BLOCK-445 scanPluginSources：用户级插件根 + 工作区技能根', () => {
  const home = tmp();
  const workspace = tmp();
  const pluginDir = path.join(home, '.codebuddy', 'plugins', 'cb-demo');
  const skillDir = path.join(workspace, '.agents', 'skills', 'any-skill');
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify({ name: 'cb-demo', skills: 'skills' }));
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: any-skill\ndescription: 任意 Agent 的技能\n---\n正文。\n');
  const found = scanPluginSources({ home, workspace, limit: 50 });
  assert.ok(found.some((x) => x.sourceDir === pluginDir && x.agent === 'codebuddy'));
  assert.ok(found.some((x) => x.sourceDir === skillDir && x.kind === 'skill'));
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
});

test('BLOCK-445 synthesizeCommandSkills：生成可被 skill-registry 识别的 SKILL.md', () => {
  const dir = tmp();
  const out = synthesizeCommandSkills([{ name: 'summarize', description: '总结文档', body: '请总结成三条要点。' }], dir, { prefix: 'cmd-demo' });
  assert.equal(out.length, 1);
  const text = fs.readFileSync(path.join(out[0].sourceDir, 'SKILL.md'), 'utf8');
  assert.ok(text.startsWith('---'));
  assert.match(text, /name: cmd-demo-summarize/);
  assert.match(text, /请总结成三条要点/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('BLOCK-445 集成：任意 Agent 的单技能目录可直接安装', async () => {
  const dataDir = tmp();
  const r = await importExternalPlugin({
    sourceDir: path.join(FIX, 'claude-demo', 'skills', 'doc-writer'),
    apply: true,
    dataDir,
  });
  assert.equal(r.ok, true);
  assert.equal(r.plugin.agent, 'any-skill');
  assert.equal(r.imported.skills.length, 1);
  assert.equal(r.imported.skills[0].installed, true);
  assert.ok(fs.existsSync(path.join(dataDir, 'skills', 'doc-writer', 'skill.json')));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

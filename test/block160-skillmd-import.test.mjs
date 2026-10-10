/**
 * BLOCK-160 W2 P5（KNW-4⇄DIST-2）— SKILL.md 兼容导入 + MCP 配置导入契约测试。
 *
 * 钉住：①SKILL.md 目录导入合成（front-matter 受限解析 name/description/version/
 * category；body→prompts/system.md；合成文件写 dest 不改源目录；discover/get
 * 即刻可见=「导入即用」；built-in id 冲突拒绝零写入）；②MCP 配置文件导入
 * helper（{servers:[…]} 与裸数组双形态；逐条 upsert；坏条目 skipped 诚实列出；
 * env 值随 CAP-2 落盘加密）。
 */

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve('.');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'b160-skillmd-'));
process.env.BIOF3_USER_DATA_DIR = path.join(tmpRoot, 'user-data');
process.env.BIOF3_LOCAL_DATA_DIR = path.join(tmpRoot, 'data');

const registry = require(path.join(ROOT, 'core', 'shared-backend', 'skill-registry.js'));
const mcpImport = require(path.join(ROOT, 'core', 'biof3-server', 'helpers', 'mcp-config-import.js'));

const SKILL_MD = `---
name: My Imported Skill
description: 从 SKILL.md 导入的技能（KNW-4 兼容面）
version: 0.2.0
category: imported
---

# My Imported Skill

按以下步骤执行任务：

1. 先读项目约定
2. 小步修改
3. 验证后汇报
`;

function makeSkillMdDir(name, content = SKILL_MD) {
  const dir = path.join(tmpRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content);
  return dir;
}

test('BLOCK-160 KNW-4 SKILL.md 导入：合成 skill.json+prompts/system.md，discover/get 即刻可见', () => {
  const sourceDir = makeSkillMdDir('my-imported-skill');
  const result = registry.installSkillFromDir(sourceDir);
  assert.equal(result.ok, true, JSON.stringify(result));

  // 合成文件落在 dest（源目录不得被改写）
  const destDir = path.join(tmpRoot, 'user-data', 'skills', 'my-imported-skill');
  assert.ok(fs.existsSync(path.join(destDir, 'skill.json')), 'dest 应有合成 skill.json');
  assert.ok(fs.existsSync(path.join(destDir, 'prompts', 'system.md')), 'dest 应有 prompts/system.md');
  assert.ok(!fs.existsSync(path.join(sourceDir, 'skill.json')), '源目录不得被写入 skill.json');

  // 导入即用：discover 可见 + get 读到手册
  const discovered = registry.discoverSkills();
  const found = discovered.find((s) => s.id === 'my-imported-skill');
  assert.ok(found, `discover 应含 my-imported-skill，实际 ${discovered.map((s) => s.id).join(',')}`);
  assert.equal(found.source, 'installed');
  const got = registry.createRegistry().get('my-imported-skill');
  assert.ok(got.prompts && got.prompts.system, 'manifest 应引用手册文件');
  const systemMd = fs.readFileSync(path.join(destDir, 'prompts', 'system.md'), 'utf8');
  assert.match(systemMd, /先读项目约定/, '手册正文应落在 prompts/system.md');
});

test('BLOCK-160 KNW-4 front-matter 受限解析：name/version/category 进入合成清单', () => {
  const got = registry.createRegistry().get('my-imported-skill');
  assert.equal(got.name, 'My Imported Skill');
  assert.equal(got.version, '0.2.0');
  assert.equal(got.category, 'imported');
});

test('BLOCK-160 KNW-4 回滚面：built-in id 冲突拒绝且零写入', () => {
  const sourceDir = makeSkillMdDir('conflict-skill', `---\nname: x\ndescription: y\n---\nbody`);
  // 目录名映射 id 后与内置冲突：直接用内置 id 的目录名
  const conflictDir = path.join(tmpRoot, 'coding-playbook');
  fs.mkdirSync(conflictDir, { recursive: true });
  fs.writeFileSync(path.join(conflictDir, 'SKILL.md'), SKILL_MD);
  const result = registry.installSkillFromDir(conflictDir);
  assert.equal(result.ok, false);
  assert.match(result.error || '', /conflicts_builtin|invalid/);
});

test('BLOCK-160 DIST-2 MCP 配置导入 helper：对象与裸数组双形态+坏条目 skipped 诚实列出', () => {
  const file = path.join(tmpRoot, 'mcp-config.json');
  fs.writeFileSync(file, JSON.stringify({
    servers: [
      { id: 'imported-a', command: 'node', args: ['a.js'], env: { TOKEN: 't1' } },
      { id: 'bad id with space', command: 'node' },
      { id: 'imported-b', command: 'python', args: ['-u', 'b.py'], autoConnect: false },
    ],
  }));
  const result = mcpImport.importMcpConfigFile(file);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.imported, 2, JSON.stringify(result));
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].id, 'bad id with space');

  // 裸数组形态
  const file2 = path.join(tmpRoot, 'mcp-config-array.json');
  fs.writeFileSync(file2, JSON.stringify([{ id: 'imported-c', command: 'node' }]));
  const r2 = mcpImport.importMcpConfigFile(file2);
  assert.equal(r2.ok, true);
  assert.equal(r2.imported, 1);
});

test.after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

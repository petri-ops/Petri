/**
 * nso-w4-extension-single-source.test.mjs — BLOCK-361（NSO-W4）扩展生态单源化。
 *
 *  W4-1（F-07）registry 插件源绕开 plugin-loader 单源：installed 只认
 *       PETRI_PLUGINS_DIR || ~/Documents/Petri-Local/plugins，漏 BLOCK-157 DIST-1 的
 *       $PETRI_LOCAL_DATA_DIR/plugins 一档 → 主进程装到数据目录的插件，MCP 读不到。
 *  W4-2（F-08）listTools.withMetadata 只认 t.function.name：{name} 形状的 Skill/IDE 工具
 *       拿不到 executionMetadata（保守缺省缺席）。
 *  W4-3（F-17）skill_discover.source enum 缺 'pack'（SOURCE_PRIORITY 有）；
 *       _inputsToInputSchema 注释声称支持 boolean，实现一律映射 string。
 *  W4-4 插件入口：精确匹配缺失时静默 files[0]（readdir 未排序；6 个插件同目录有
 *       _petri-theme.R 辅助脚本，哈希序文件系统上可能把辅助脚本当入口执行）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// db.js 依赖真实 schema（同 W2-6 测试的自举）
{
  const Database = require('better-sqlite3');
  const tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-w4-db-'));
  const db = new Database(path.join(tempDbDir, 'petri.db'));
  const migrationsDir = path.join(ROOT, 'src', 'migrations');
  for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  db.close();
  process.env.PETRI_DB_PATH = path.join(tempDbDir, 'petri.db');
  process.on('exit', () => { try { fs.rmSync(tempDbDir, { recursive: true, force: true }); } catch { /* best-effort */ } });
}

const registry = require('../core/petri-server/mcp/registry.js');
const pluginLoader = require('../core/petri-server/plugin-loader.js');
const { SOURCE_PRIORITY } = require('../core/shared-backend/skill-registry.js');

test('W4-1 registry 插件源与 plugin-loader 同源：installed 认 $PETRI_LOCAL_DATA_DIR/plugins', () => {
  const prev = { dir: process.env.PETRI_PLUGINS_DIR, data: process.env.PETRI_LOCAL_DATA_DIR };
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-w4-data-'));
  try {
    delete process.env.PETRI_PLUGINS_DIR;
    process.env.PETRI_LOCAL_DATA_DIR = dataDir;
    const sources = registry._test.computePluginSources();
    const installed = sources.find((s) => s.type === 'installed');
    assert.equal(installed.root, path.join(dataDir, 'plugins'));
    assert.equal(installed.root, pluginLoader.resolveDefaultPluginSources().installedDir, '两侧必须同一解析结果');
    const builtin = sources.find((s) => s.type === 'builtin');
    assert.equal(builtin.root, pluginLoader.resolveBuiltInPluginsDir(), 'built-in 同源');
  } finally {
    if (prev.dir === undefined) delete process.env.PETRI_PLUGINS_DIR; else process.env.PETRI_PLUGINS_DIR = prev.dir;
    if (prev.data === undefined) delete process.env.PETRI_LOCAL_DATA_DIR; else process.env.PETRI_LOCAL_DATA_DIR = prev.data;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('W4-2 listTools：{name} 与 {function.name} 两种形状都带 executionMetadata（未知名取保守缺省）', async () => {
  const tools = await registry.listTools();
  const missing = tools.filter((t) => !t.executionMetadata).map((t) => t.name || t.function?.name);
  assert.deepEqual(missing, [], '每个工具条目都必须投影 executionMetadata');
  const skill = tools.find((t) => t.name === 'skill_discover');
  assert.ok(skill, '技能工具在列');
  assert.equal(typeof skill.executionMetadata.readOnly, 'boolean');
});

test('W4-3 skill_discover.source enum 由 SOURCE_PRIORITY 派生（含 pack）', async () => {
  const tools = await registry.listTools();
  const discover = tools.find((t) => t.name === 'skill_discover');
  assert.deepEqual([...discover.inputSchema.properties.source.enum].sort(), Object.keys(SOURCE_PRIORITY).sort());
});

test('W4-3 _inputsToInputSchema：boolean 显式映射 boolean，file/directory 映射 string', () => {
  const schema = pluginLoader._inputsToInputSchema([
    { id: 'flag', type: 'boolean' },
    { id: 'counts', type: 'file' },
    { id: 'outdir', type: 'directory' },
    { id: 'n', type: 'integer', min: 1 },
  ]);
  assert.equal(schema.properties.flag.type, 'boolean');
  assert.equal(schema.properties.counts.type, 'string');
  assert.equal(schema.properties.outdir.type, 'string');
  assert.equal(schema.properties.n.type, 'integer');
});

test('W4-4 入口选择：entryScript > 精确同名 > 唯一非辅助脚本 > 歧义 fail-closed', () => {
  const select = pluginLoader.selectPluginEntryScript;
  assert.equal(select({ toolId: 'x', language: 'r', files: ['_petri-theme.R', 'x.R'] }).file, 'x.R');
  assert.equal(select({ toolId: 'x', language: 'r', files: ['main.R', 'x.R'], entryScript: 'main.R' }).file, 'main.R');
  assert.equal(select({ toolId: 'x', language: 'r', files: ['_petri-theme.R', 'only.R'] }).file, 'only.R', '辅助脚本不算候选');
  const ambiguous = select({ toolId: 'x', language: 'r', files: ['b.R', 'a.R', '_petri-theme.R'] });
  assert.equal(ambiguous.file, null);
  assert.equal(ambiguous.reason, 'plugin_entry_ambiguous');
  const helperOnly = select({ toolId: 'x', language: 'r', files: ['_petri-theme.R'] });
  assert.equal(helperOnly.file, null, '只有辅助脚本时不得把它当入口');
  const declaredMissing = select({ toolId: 'x', language: 'r', files: ['x.R'], entryScript: 'gone.R' });
  assert.deepEqual([declaredMissing.file, declaredMissing.reason], [null, 'plugin_entry_declared_missing']);
});

/**
 * BLOCK-157 W1 P4（DIST-1）— 插件启停粒度契约测试。
 *
 * 钉住：installed.json enabled 标志（装=启用缺省；存量无字段=启用零破坏；
 * 停用持久化布尔）；核心加载器尊重（loadPluginsFromDisk 对 enabled=false
 * 条目不注册 _biof3Plugins → run_tool 清单/执行与 MCP listToolsForMCP
 * 天然不出现=「停用即不注册」；重新启用免重装——文件仍在，仅标志翻转）。
 * 红绿先行：先红（setPluginEnabled 不存在/加载器不停用）后实现转绿。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve('.');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b157-plugin-enabled-'));
process.env.BIOF3_LOCAL_DATA_DIR = tmpDir; // src/plugin/paths.js 纯 Node 加载前提（app.getPath 兜底规避）
const pluginsDir = path.join(tmpDir, 'plugins');
fs.mkdirSync(path.join(pluginsDir, 'p-on', 'scripts'), { recursive: true });
fs.mkdirSync(path.join(pluginsDir, 'p-off', 'scripts'), { recursive: true });
for (const [id, extra] of [
  ['p-on', {}],
  ['p-off', { enabled: false }],
]) {
  fs.writeFileSync(
    path.join(pluginsDir, id, 'plugin.json'),
    JSON.stringify({ id, title: id, version: '1.0.0', language: 'r' })
  );
  fs.writeFileSync(
    path.join(pluginsDir, id, 'scripts', 'main.R'),
    '# fixture script\n'
  );
}
fs.writeFileSync(
  path.join(pluginsDir, 'installed.json'),
  JSON.stringify([
    { id: 'p-on', title: 'p-on', version: '1.0.0', type: 'analysis-plugin' },
    { id: 'p-off', title: 'p-off', version: '1.0.0', type: 'analysis-plugin', enabled: false },
  ])
);
process.env.BIOF3_PLUGINS_DIR = pluginsDir;

const installed = require(path.join(ROOT, 'src/plugin/installed.js'));
const pluginLoader = require(path.join(ROOT, 'core/biof3-server/plugin-loader.js'));

test('BLOCK-157 DIST-1 installed 标志：缺省=启用；enabled=false 持久化可读', () => {
  const rows = installed.getInstalledPlugins();
  const on = rows.find((r) => r.id === 'p-on');
  const off = rows.find((r) => r.id === 'p-off');
  assert.equal(on.enabled, true, '无 enabled 字段 = 启用（存量零破坏）');
  assert.equal(off.enabled, false, 'enabled=false 应如实读出');
});

test('BLOCK-157 DIST-1 setPluginEnabled：翻转持久化（启用免重装=文件不动仅标志翻转）', () => {
  const r1 = installed.setPluginEnabled('p-off', true);
  assert.equal(r1.ok, true, JSON.stringify(r1));
  assert.equal(installed.getInstalledPlugins().find((r) => r.id === 'p-off').enabled, true);
  assert.ok(fs.existsSync(path.join(pluginsDir, 'p-off', 'plugin.json')), '启用不重装：插件文件仍在');

  const r2 = installed.setPluginEnabled('p-off', false);
  assert.equal(r2.ok, true);
  assert.equal(installed.getInstalledPlugins().find((r) => r.id === 'p-off').enabled, false);

  const missing = installed.setPluginEnabled('no-such', true);
  assert.equal(missing.ok, false, '未知 id 诚实失败');
});

test('BLOCK-157 DIST-1 加载器尊重：停用件不注册（run_tool/MCP 工具面天然不出现）', () => {
  pluginLoader.loadPluginsFromDisk(pluginsDir);
  assert.ok(pluginLoader.getPlugin('p-on'), '启用件应注册');
  assert.equal(pluginLoader.getPlugin('p-off'), undefined, '停用件不得注册（停用即不注册）');

  // 再启用 → 重扫即恢复（免重装）
  installed.setPluginEnabled('p-off', true);
  pluginLoader.loadPluginsFromDisk(pluginsDir);
  assert.ok(pluginLoader.getPlugin('p-off'), '重新启用后重扫应注册（免重装）');

  installed.setPluginEnabled('p-off', false);
  pluginLoader.loadPluginsFromDisk(pluginsDir);
  assert.equal(pluginLoader.getPlugin('p-off'), undefined, '再停用再扫仍不注册');
});

test('BLOCK-157 DIST-1 拓扑收敛：installed 目录缺省解析优先 BIOF3_LOCAL_DATA_DIR（BLOCK-125 脑裂家族修复）', () => {
  // 本文件头部已设 BIOF3_LOCAL_DATA_DIR=tmpDir；pluginsDir 即 $LOCAL_DATA_DIR/plugins。
  // 主进程装插件写 $BIOF3_LOCAL_DATA_DIR/plugins（src/plugin/paths.js），core 后端
  // 此前只认 BIOF3_PLUGINS_DIR || ~/Documents/BioF3-Local/plugins → dev 拓扑分裂。
  const prev = process.env.BIOF3_PLUGINS_DIR;
  delete process.env.BIOF3_PLUGINS_DIR;
  try {
    const loader2 = require(path.join(ROOT, 'core/biof3-server/plugin-loader.js'));
    assert.equal(
      loader2.resolveInstalledPluginsDir(),
      pluginsDir,
      'BIOF3_PLUGINS_DIR 缺省时应回落 $BIOF3_LOCAL_DATA_DIR/plugins'
    );
    // 同语义落地：无参 loadPluginsFromDisk() 应从同一目录装载（p-on 在册）
    loader2.loadPluginsFromDisk();
    assert.ok(loader2.getPlugin('p-on'), '无参装载应从 LOCAL_DATA_DIR/plugins 读到启用件');
  } finally {
    if (prev !== undefined) process.env.BIOF3_PLUGINS_DIR = prev;
  }
});

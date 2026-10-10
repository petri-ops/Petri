import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packRegistry = require('../core/shared-backend/pack-registry.js');
const toolRegistry = require('../core/petri-server/tool-registry.js');

// D2 注册表死链守卫（G0-BIO §2.0 / BLOCK-145 D2①）
//
// 契约（退役契约）：领域注册表 registry/tool-registry.json 里声明了脚本的每个
// TOOLS.* 条目（cfg.script 非空字符串），其脚本必须真实存在于：
//   a) pack 仓 petri-pack-bio/plugins*/（含 plugins.dormant——glob `plugins*` 字面义）
//      任一插件的 scripts/ 目录；或
//   b) desktop 侧 core/petri-server/tool-scripts/（tools-executor 的 scriptsDir
//      解析目标，core/petri-server/routes/tools.js:28）。
// 死链逐条列出 = 红。退役（删除条目/script 置空走插件通道/改指 pack 插件脚本）后转绿。
//
// 背景：BLOCK-83 P4 领域中立化后 desktop 侧 tool-scripts/ 已删（G0-BIO §2.0）。
// 遗留 legacy 条目经 helpers/tools-executor.js getToolConfig 的 registry fallback
// （tools-executor.js:727-734，lang==='r' 且 pluginOnly!==true）返回 { script }，
// 再被 `path.join(scriptsDir, cfg.script)`（tools-executor.js:1396）拼到已删目录 →
// 必然 "Script not found"（tools-executor.js:1398）。本测试把「声明了脚本就必须
// 找得到脚本」变成机械守卫，防止注册表再积累纸面条目。

const DESKTOP_SCRIPTS_DIR = path.join(root, 'core', 'petri-server', 'tool-scripts');

function findPackRoot() {
  const available = packRegistry.discoverAvailablePacks({ projectRoot: root });
  const pack = available.find((p) => p.packId === 'petri-pack-bio');
  if (!pack) {
    throw new Error(
      'pack 仓未找到：discoverAvailablePacks 未发现 petri-pack-bio' +
        '（期望兄弟仓 ../petri-pack-bio，实际候选见 core/shared-backend/pack-registry.js:100-115）'
    );
  }
  return pack.packRoot;
}

/** 收集 pack 仓 plugins*（plugins / plugins.dormant / 未来 plugins.xxx）下所有插件 scripts/ 的文件名。 */
function listPackScriptNames(packRoot) {
  const names = new Set();
  for (const entry of fs.readdirSync(packRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('plugins')) continue;
    const pluginsDir = path.join(packRoot, entry.name);
    for (const plugin of fs.readdirSync(pluginsDir, { withFileTypes: true })) {
      if (!plugin.isDirectory()) continue;
      const scriptsDir = path.join(pluginsDir, plugin.name, 'scripts');
      if (!fs.existsSync(scriptsDir)) continue;
      for (const f of fs.readdirSync(scriptsDir, { withFileTypes: true })) {
        if (f.isFile()) names.add(f.name);
      }
    }
  }
  return names;
}

/** 脚本在 pack（精确名或补 .R/.py）或 desktop 侧是否存在；返回命中处或 null。 */
function locateScript(script, packScriptNames) {
  const candidates = [script, script + '.R', script + '.py'];
  for (const name of candidates) {
    if (packScriptNames.has(name)) return 'pack:' + name;
  }
  for (const name of candidates) {
    if (fs.existsSync(path.join(DESKTOP_SCRIPTS_DIR, name))) return 'desktop:' + name;
  }
  return null;
}

test('D2 注册表死链守卫：registry 声明的每个脚本必须存在于 pack plugins*/ 或 desktop 侧', () => {
  const packRoot = findPackRoot();
  const registryFile = path.join(packRoot, 'registry', 'tool-registry.json');
  assert.ok(fs.existsSync(registryFile), 'pack 注册表缺失: ' + registryFile);

  // 走生产注册单入口（core/petri-server/tool-registry.js registerDomainToolsFile），
  // 与 server.js:82 boot 接线同一路径，不直接裸读 JSON。
  const wired = toolRegistry.registerDomainToolsFile(registryFile);
  assert.equal(wired.ok, true, '注册表装载失败: ' + JSON.stringify(wired));

  const tools = toolRegistry.listTools();
  assert.ok(tools.length > 0, 'pack 注册表为空，死链守卫失去守卫对象（fail-closed）');

  const packScriptNames = listPackScriptNames(packRoot);
  const dead = [];
  for (const cfg of tools) {
    const script = cfg.script;
    // script 置空/null（如 deseq2 的 pluginOnly 形态）= 插件通道交付，不在本守卫范围
    if (typeof script !== 'string' || script.trim() === '') continue;
    const hit = locateScript(script, packScriptNames);
    if (!hit) {
      dead.push({ id: cfg.id, script, lang: cfg.lang || null });
    }
  }

  assert.equal(
    dead.length,
    0,
    `registry 死链 ${dead.length} 条（脚本既不在 pack plugins*/ 也不在 desktop ${path.relative(root, DESKTOP_SCRIPTS_DIR)}/）：\n` +
      dead.map((d) => `  - ${d.id} → ${d.script} (lang=${d.lang})`).join('\n')
  );
});

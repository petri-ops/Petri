/**
 * r-server/plugin-loader.js — 服务端插件加载器
 *
 * 桌面版 Electron 启动时通过 plugin-manager.js 加载已装插件，
 * 注册到 globalThis._biof3Plugins。本模块负责：
 * 1. 读取已注册插件
 * 2. 将插件工具定义注册到工具列表
 * 3. 提供脚本路径查询（工具执行时用）
 *
 * Web 版不使用此模块（工具定义硬编码在 _data.ts + tool-scripts/）。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../shared-backend/logger');

// 已注册插件 Map（id → { ...meta, pluginDir, scriptPath }）
let _lastPluginsDir = null;
function _getPluginsMap() {
  if (!globalThis._biof3Plugins) globalThis._biof3Plugins = new Map();
  return globalThis._biof3Plugins;
}

/**
 * 获取已注册的所有插件。
 */
function getAllPlugins() {
  return Array.from(_getPluginsMap().values());
}

/**
 * 获取指定插件。
 */
function getPlugin(pluginId) {
  return _getPluginsMap().get(pluginId);
}

/**
 * 检查插件是否已安装。
 */
function isPluginInstalled(pluginId) {
  return _getPluginsMap().has(pluginId);
}

/**
 * 获取工具对应的脚本路径。
 * 插件 scripts/ 目录下的脚本文件（.R / .py）。
 *
 * @param {string} toolId - 工具 ID（= 插件 ID）
 * @returns {string|null} - 脚本绝对路径
 */
function getScriptForTool(toolId) {
  const plugin = getPlugin(toolId);
  if (!plugin) return null;

  const scriptDir = plugin.scriptPath;
  if (!fs.existsSync(scriptDir)) return null;

  // 根据 language 找对应扩展名的脚本
  const ext = plugin.language === 'r' ? '.R' : '.py';
  const files = fs.readdirSync(scriptDir).filter((f) => f.endsWith(ext));

  if (files.length === 0) return null;
  // 优先找和 toolId 同名的脚本
  const match = files.find((f) => f.replace(ext, '') === toolId);
  return path.join(scriptDir, match || files[0]);
}

/**
 * 获取插件的工具定义（tool-definition.json）。
 */
function getToolDefinition(pluginId) {
  const plugin = getPlugin(pluginId);
  if (!plugin) return null;

  const defPath = path.join(plugin.pluginDir, 'tool-definition.json');
  try {
    return JSON.parse(fs.readFileSync(defPath, 'utf8'));
  } catch {
    return null;
  }
}

function _walkFiles(dir) {
  const out = [];
  if (!dir || !fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) out.push(full);
    }
  }
  return out.sort();
}

function _hashFileContents(hash, filePath) {
  try {
    hash.update(filePath);
    hash.update('\0');
    hash.update(fs.readFileSync(filePath));
    hash.update('\0');
  } catch (e) {
    hash.update(`[missing:${filePath}]`);
    hash.update('\0');
  }
}

function computePluginFingerprint(plugin, def) {
  if (!plugin || !plugin.pluginDir) return null;
  const hash = crypto.createHash('sha256');
  _hashFileContents(hash, path.join(plugin.pluginDir, 'plugin.json'));
  _hashFileContents(hash, path.join(plugin.pluginDir, 'tool-definition.json'));
  if (plugin.scriptPath) {
    for (const file of _walkFiles(plugin.scriptPath)) {
      _hashFileContents(hash, file);
    }
  }
  if (def) {
    hash.update(JSON.stringify({
      id: def.id || plugin.id || null,
      version: def.version || plugin.version || null,
      language: def.language || plugin.language || null,
    }));
  }
  return hash.digest('hex');
}

function _normalizeArtifactHint(output, index) {
  if (!output || typeof output !== 'object') return null;
  const id = String(output.id || output.name || `artifact_${index + 1}`);
  const rawType = String(output.type || output.kind || 'file').toLowerCase();
  const type =
    rawType === 'image' || rawType === 'pdf'
      ? 'plot'
      : rawType === 'dataframe'
        ? 'table'
        : ['plot', 'table', 'text', 'json', 'html', 'file', 'log'].includes(rawType)
          ? rawType
          : 'file';
  const label = output.label || output.title || id;
  return {
    id,
    type,
    title: output.title || label,
    label,
    description: output.description || output.hint || '',
    preview: output.preview !== false,
    download: output.download !== false,
    required: output.required !== false,
  };
}

function _normalizeFailureMode(mode, index) {
  if (!mode) return null;
  if (typeof mode === 'string') {
    return {
      code: mode,
      title: mode,
      description: '',
      recoverable: true,
      suggestedFix: '',
    };
  }
  if (typeof mode !== 'object') return null;
  const code = String(mode.code || mode.id || `failure_${index + 1}`);
  return {
    code,
    title: mode.title || mode.label || code,
    description: mode.description || mode.reason || '',
    recoverable: mode.recoverable !== false,
    suggestedFix: mode.suggestedFix || mode.fix || mode.repairHint || '',
    detect: mode.detect || mode.detectWhen || '',
  };
}

const GLOBAL_ARTIFACT_FAILURE_MODES = [
  {
    code: 'required_artifact_missing',
    title: '必需结果产物缺失',
    description: '工具运行结束，但声明为 required 的结果文件没有真实生成。',
    recoverable: true,
    suggestedFix: '检查运行日志和输出约定，修复工具后重新执行。',
    detect: 'required artifact missing|was not produced',
  },
  {
    code: 'required_artifact_empty',
    title: '必需结果产物为空',
    description: '工具生成了结果文件名，但文件为空或不可读取。',
    recoverable: true,
    suggestedFix: '检查运行日志、磁盘空间和写文件逻辑后重新执行。',
    detect: 'required artifact empty|empty or unreadable',
  },
  {
    code: 'artifact_type_mismatch',
    title: '结果产物类型不匹配',
    description: 'manifest 声明类型与真实文件扩展名不一致。',
    recoverable: true,
    suggestedFix: '修正 manifest 类型，或输出符合声明格式的文件。',
    detect: 'artifact type mismatch|declared as|detected as',
  },
  {
    code: 'artifact_missing',
    title: '可选结果产物缺失',
    description: 'manifest 声明了可选产物，但磁盘中不存在该文件。',
    recoverable: true,
    suggestedFix: '移除失效声明或重新生成可选产物。',
    detect: 'declared artifact missing|does not exist on disk',
  },
  {
    code: 'artifact_empty',
    title: '可选结果产物为空',
    description: '可选结果文件为空或不可读取。',
    recoverable: true,
    suggestedFix: '移除空产物或重新生成。',
    detect: 'declared artifact empty|empty or unreadable',
  },
];

/**
 * BioF3PluginManifest v1 normalized view.
 *
 * Compatibility note:
 * - Existing plugins still ship `plugin.json` for install/runtime metadata and
 *   `tool-definition.json` for form/output metadata.
 * - Harness consumes this merged manifest so prompt/runtime logic no longer
 *   depends on two partially-overlapping files.
 */
function normalizePluginManifest(plugin, def) {
  if (!plugin) return null;
  const toolDef = def || {};
  const id = String(toolDef.id || plugin.id || '');
  if (!id) return null;
  const language = toolDef.language || plugin.language || null;
  const outputs = Array.isArray(toolDef.outputs) ? toolDef.outputs : [];
  const failureModes = Array.isArray(toolDef.failureModes)
    ? toolDef.failureModes
    : Array.isArray(plugin.failureModes)
      ? plugin.failureModes
      : [];
  const mergedFailureModes = [...failureModes];
  const failureCodes = new Set(mergedFailureModes.map((mode) => mode && mode.code).filter(Boolean));
  for (const mode of GLOBAL_ARTIFACT_FAILURE_MODES) {
    if (!failureCodes.has(mode.code)) mergedFailureModes.push(mode);
  }
  return {
    pluginManifestVersion: Number(plugin.pluginManifestVersion || toolDef.pluginManifestVersion || 1),
    id,
    title: toolDef.title || plugin.title || id,
    subtitle: toolDef.subtitle || '',
    description: toolDef.description || plugin.description || '',
    category: toolDef.category || plugin.category || 'analysis',
    type: plugin.type || toolDef.type || 'analysis-plugin',
    version: plugin.version || toolDef.version || null,
    language,
    runtime: plugin.runtime || {},
    packages: plugin.packages || {},
    builtAgainst: plugin.builtAgainst || {},
    supportedPlatforms: plugin.supportedPlatforms || plugin.platform || [],
    platform: plugin.platform || plugin.supportedPlatforms || [],
    inputs: Array.isArray(toolDef.inputs) ? toolDef.inputs : [],
    outputs,
    artifactSchemaVersion: 1,
    artifacts: outputs.map(_normalizeArtifactHint).filter(Boolean),
    examples: Array.isArray(toolDef.examples)
      ? toolDef.examples
      : Array.isArray(plugin.examples)
        ? plugin.examples
        : [],
    failureModes: mergedFailureModes.map(_normalizeFailureMode).filter(Boolean),
    estimatedMinutes: toolDef.estimatedMinutes || plugin.estimatedMinutes || null,
    execution: {
      scriptPath: plugin.scriptPath || null,
      pluginDir: plugin.pluginDir || null,
      scriptFingerprint: computePluginFingerprint(plugin, toolDef),
      installedFingerprint: plugin._installedFingerprint || null,
      manifestDrift: !!plugin._manifestDrift,
      driftReason: plugin._driftReason || null,
      demoDataDir: plugin.pluginDir
        ? (fs.existsSync(path.join(plugin.pluginDir, 'demo-data'))
            ? path.join(plugin.pluginDir, 'demo-data')
            : null)
        : null,
    },
    legacy: {
      pluginJson: plugin,
      toolDefinition: toolDef,
    },
  };
}

function getPluginManifest(pluginId) {
  const plugin = getPlugin(pluginId);
  if (!plugin) return null;
  return normalizePluginManifest(plugin, getToolDefinition(pluginId));
}

function getAllPluginManifests() {
  return getAllPlugins().map((plugin) => getPluginManifest(plugin.id)).filter(Boolean);
}

/**
 * 获取所有已装插件的工具定义列表（供前端工具列表渲染）。
 */
function getAllToolDefinitions() {
  const defs = [];
  for (const plugin of getAllPlugins()) {
    const def = getToolDefinition(plugin.id);
    if (def) {
      const manifest = normalizePluginManifest(plugin, def);
      defs.push({
        ...def,
        _pluginVersion: plugin.version,
        _language: plugin.language,
        _installed: true,
        _manifest: manifest,
        failureModes: manifest.failureModes,
      });
    }
  }
  return defs;
}

/**
 * 把 tool-definition.json 的 inputs[] 数组转成 MCP inputSchema
 * （JSON Schema object：{type:'object', properties:{}, required:[]}）。
 * MCP 工具调用的参数契约用 inputSchema，BioF3 内部用 inputs[]。
 */
function _inputsToInputSchema(inputs) {
  const properties = {};
  const required = [];
  for (const inp of inputs || []) {
    if (!inp || !inp.id) continue;
    const schema = { type: inp.type === 'number' ? 'number' : 'string' };
    if (inp.label) schema.description = inp.label;
    if (inp.hint) schema.description = (schema.description ? schema.description + '。' : '') + inp.hint;
    if (inp.default !== undefined) schema.default = inp.default;
    properties[inp.id] = schema;
    if (inp.required) required.push(inp.id);
  }
  return { type: 'object', properties, required };
}

/**
 * MCP 工具列表薄封装：把已装插件转成 MCP tools/list 格式。
 * 返回 [{name, description, inputSchema}]，name = 插件 id。
 */
function listToolsForMCP() {
  return getAllPluginManifests().map((manifest) => ({
    name: manifest.id,
    description: manifest.description || manifest.title || manifest.id,
    inputSchema: _inputsToInputSchema(manifest.inputs),
    outputSchema: {
      type: 'object',
      artifactSchemaVersion: manifest.artifactSchemaVersion,
      artifacts: manifest.artifacts,
    },
    failureModes: manifest.failureModes,
    // 透传元数据，供 callTool / Harness 执行时用
    _language: manifest.language,
    _pluginVersion: manifest.version,
    _outputs: manifest.outputs,
    _manifest: {
      pluginManifestVersion: manifest.pluginManifestVersion,
      id: manifest.id,
      title: manifest.title,
      version: manifest.version,
      language: manifest.language,
      runtime: manifest.runtime,
      supportedPlatforms: manifest.supportedPlatforms,
      artifactSchemaVersion: manifest.artifactSchemaVersion,
      artifacts: manifest.artifacts,
      failureModes: manifest.failureModes,
      execution: manifest.execution,
    },
  }));
}

/**
 * 获取插件的 Demo 数据目录（如果存在）。
 */
function getDemoDataDir(pluginId) {
  const plugin = getPlugin(pluginId);
  if (!plugin) return null;

  const demoDir = path.join(plugin.pluginDir, 'demo-data');
  return fs.existsSync(demoDir) ? demoDir : null;
}

/**
 * 检查工具所需的所有包是否已安装。
 * @returns {{ ready: boolean, missing: string[], language: string }}
 */
function checkPluginPackages(pluginId) {
  const plugin = getPlugin(pluginId);
  if (!plugin) return { ready: false, missing: [], language: 'unknown', error: 'not_installed' };

  const { getExecutor } = require('../../shared-backend/executors');
  const executor = getExecutor(plugin.language);
  const missing = [];

  if (plugin.packages && plugin.packages[plugin.language]) {
    for (const pkgName of Object.keys(plugin.packages[plugin.language])) {
      if (!executor.checkPackageInstalled(pkgName)) {
        missing.push(pkgName);
      }
    }
  }

  return { ready: missing.length === 0, missing, language: plugin.language };
}

/**
 * 从磁盘重新加载所有插件（plugin-manager 安装新插件后调用）。
 */
function reloadAllPlugins() {
  // plugin-manager.js 已经注册到 globalThis._biof3Plugins
  // 这里只做验证 + 日志
  const plugins = getAllPlugins();
  logger.info(`[plugin-loader] ${plugins.length} plugin(s) registered`);
  for (const p of plugins) {
    const check = checkPluginPackages(p.id);
    if (!check.ready) {
      logger.warn(`[plugin-loader] ${p.id}: missing packages: ${check.missing.join(', ')}`);
    }
  }
}

/**
 * 从磁盘扫描已装插件并注册（r-server 子进程启动时调用）。
 *
 * 桌面版架构：plugin-manager.js 在 Electron 主进程里把插件注册到
 * globalThis._biof3Plugins，但 r-server 是独立子进程，globalThis 不共享。
 * 所以 r-server 必须自己从 ~/Documents/BioF3-Local/plugins/ 扫盘加载。
 *
 * 读取 installed.json → 逐个读 plugin.json → 注册到 _biof3Plugins。
 */
function loadPluginsFromDisk(pluginsDir) {
  const os = require('os');
  const dir =
    pluginsDir ||
    _lastPluginsDir ||
    process.env.BIOF3_PLUGINS_DIR ||
    path.join(os.homedir(), 'Documents', 'BioF3-Local', 'plugins');
  _lastPluginsDir = dir;
  const installedFile = path.join(dir, 'installed.json');
  let installed = [];
  try {
    installed = JSON.parse(fs.readFileSync(installedFile, 'utf8'));
  } catch {
    return; // 无 installed.json = 没装过插件，正常
  }
  if (!Array.isArray(installed)) return;

  const map = _getPluginsMap();
  for (const [id, plug] of map.entries()) {
    if (plug && plug._fromInstalled) {
      map.delete(id);
    }
  }
  let count = 0;
  for (const plug of installed) {
    // Runtime 条目（type === 'runtime'）装在 runtimes/ 目录，不在 plugins/ 下，
    // 没有 plugin.json，跳过（由 plugin-manager.js 管理环境变量）
    if (plug.type === 'runtime') continue;

    const pluginDir = path.join(dir, plug.id);
    const metaPath = path.join(pluginDir, 'plugin.json');
    try {
      if (!fs.existsSync(metaPath)) {
        logger.warn(`[plugin-loader] ${plug.id}: plugin.json missing, skipping`);
        continue;
      }
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      let toolDefinition = null;
      const toolDefPath = path.join(pluginDir, 'tool-definition.json');
      if (fs.existsSync(toolDefPath)) {
        try {
          toolDefinition = JSON.parse(fs.readFileSync(toolDefPath, 'utf8'));
        } catch (e) {
          logger.warn(`[plugin-loader] ${plug.id}: tool-definition.json parse failed: ${e.message}`);
        }
      }
      const currentFingerprint = computePluginFingerprint(
        { ...meta, pluginDir, scriptPath: path.join(pluginDir, 'scripts') },
        toolDefinition,
      );
      const installedFingerprint =
        plug.scriptFingerprint || plug.manifestFingerprint || plug.fingerprint || null;
      const manifestDrift = !!(installedFingerprint && currentFingerprint && installedFingerprint !== currentFingerprint);
      if (manifestDrift) {
        logger.warn(`[plugin-loader] ${meta.id}: fingerprint changed since install`);
      }
      map.set(meta.id, {
        ...meta,
        pluginDir,
        scriptPath: path.join(pluginDir, 'scripts'),
        _installedFingerprint: installedFingerprint,
        _currentFingerprint: currentFingerprint,
        _manifestDrift: manifestDrift,
        _driftReason: manifestDrift ? 'fingerprint_changed' : null,
        _fromInstalled: true,
      });
      count++;
    } catch (e) {
      logger.warn(`[plugin-loader] load ${plug.id} failed: ${e.message}`);
    }
  }
  if (count > 0) {
    logger.info(`[plugin-loader] loaded ${count} plugin(s) from disk`);
  }
}

/**
 * 扫描 built-in 插件目录并注册（MCP 自动发现，不依赖 install）。
 *
 * built-in 插件在 resources/built-in-plugins/<id>/ 下，manifest.json 列出所有
 * 可用插件。只注册"工具插件"（无 type 或 type 不是 runtime/figcode-card/
 * figcode-data/content-plugin），且 manifest url 是 "built-in://..." 的。
 *
 * 已在 _biof3Plugins 里的（用户已装）跳过——已装版本优先。
 *
 * @param {string} builtInDir - built-in 插件目录（含 manifest.json + 各 <id>/ 子目录）
 */
function loadBuiltInPlugins(builtInDir) {
  if (!builtInDir || !fs.existsSync(builtInDir)) return;
  const manifestPath = path.join(builtInDir, 'manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    return;
  }
  const map = _getPluginsMap();
  const NON_TOOL_TYPES = ['runtime', 'figcode-card', 'figcode-data', 'content-plugin'];
  let count = 0;
  for (const [id, meta] of Object.entries(manifest.plugins || {})) {
    // 只注册 built-in 工具插件：url 是 built-in:// 且非 runtime/figcode/content 类型
    if (!meta.url || !meta.url.startsWith('built-in://')) continue;
    if (meta.type && NON_TOOL_TYPES.includes(meta.type)) continue;
    // 去重：已装的（map 已有）跳过，已装版本优先
    if (map.has(id)) continue;
    const pluginDir = path.join(builtInDir, id);
    if (!fs.existsSync(path.join(pluginDir, 'plugin.json'))) continue;
    map.set(id, {
      ...meta,
      id,
      pluginDir,
      scriptPath: path.join(pluginDir, 'scripts'),
      _builtIn: true,
    });
    count++;
  }
  if (count > 0) {
    logger.info(`[plugin-loader] loaded ${count} built-in plugin(s)`);
  }
}

function loadPluginsFromSources({ builtInDir, installedDir, developmentDirs = [] } = {}) {
  const { inspectPluginSources } = require('../shared-backend/plugin-sdk');
  const sources = [];
  if (builtInDir) sources.push({ type: 'builtin', root: builtInDir });
  if (installedDir) sources.push({ type: 'installed', root: installedDir });
  for (const root of developmentDirs) sources.push({ type: 'development', root });
  const result = inspectPluginSources({ sources, normalizeManifest: normalizePluginManifest });
  const map = _getPluginsMap();
  for (const [id, plugin] of map.entries()) {
    if (plugin && plugin._fromSdkSource) map.delete(id);
  }
  for (const candidate of result.candidates) {
    if (!candidate.valid || !candidate.manifest) continue;
    const existing = map.get(candidate.manifest.id);
    if (existing && !existing._fromSdkSource && candidate.sourceType === 'builtin') continue;
    const currentFingerprint = candidate.manifest.execution.scriptFingerprint;
    const installedFingerprint = candidate.plugin._installedFingerprint || null;
    const manifestDrift = !!(
      installedFingerprint && currentFingerprint && installedFingerprint !== currentFingerprint
    );
    map.set(candidate.manifest.id, {
      ...candidate.plugin,
      id: candidate.manifest.id,
      pluginDir: candidate.pluginDir,
      scriptPath: path.join(candidate.pluginDir, 'scripts'),
      _sourceType: candidate.sourceType,
      _installedFingerprint: installedFingerprint,
      _currentFingerprint: currentFingerprint,
      _manifestDrift: manifestDrift,
      _driftReason: manifestDrift ? 'fingerprint_changed' : null,
      _fromSdkSource: true,
    });
  }
  return result;
}

module.exports = {
  getAllPlugins,
  getPlugin,
  isPluginInstalled,
  getScriptForTool,
  getToolDefinition,
  computePluginFingerprint,
  normalizePluginManifest,
  getPluginManifest,
  getAllPluginManifests,
  getAllToolDefinitions,
  listToolsForMCP,
  _inputsToInputSchema,
  getDemoDataDir,
  checkPluginPackages,
  reloadAllPlugins,
  loadPluginsFromDisk,
  loadBuiltInPlugins,
  loadPluginsFromSources,
};

/**
 * petri-server/plugin-loader.js — 服务端插件加载器
 *
 * 桌面版 Electron 启动时通过 plugin-manager.js 加载已装插件，
 * 注册到 globalThis._petriPlugins。本模块负责：
 * 1. 读取已注册插件
 * 2. 将插件工具定义注册到工具列表
 * 3. 提供脚本路径查询（工具执行时用）
 *
 * Web 版不使用此模块（工具定义硬编码在 _data.ts + tool-scripts/）。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const logger = require('../shared-backend/logger');

// BLOCK-157 DIST-1 — installed 插件目录单源解析（BLOCK-125 拓扑脑裂家族修复）：
// 主进程装插件写 $PETRI_LOCAL_DATA_DIR/plugins（src/plugin/paths.js），core 后端
// 此前只认 PETRI_PLUGINS_DIR || ~/Documents/Petri-Local/plugins → dev 拓扑分裂、
// 装了读不到。收敛序 = PETRI_PLUGINS_DIR > $PETRI_LOCAL_DATA_DIR/plugins > 旧默认；
// 未设 env 时行为不变（生产行为零变化）。
function resolveInstalledPluginsDir() {
  if (process.env.PETRI_PLUGINS_DIR) return process.env.PETRI_PLUGINS_DIR;
  if (process.env.PETRI_LOCAL_DATA_DIR) return path.join(process.env.PETRI_LOCAL_DATA_DIR, 'plugins');
  return path.join(os.homedir(), 'Documents', 'Petri-Local', 'plugins');
}
const { validateResultStudioDescriptor } = require('../shared-backend/result-studio-plugin-sdk');
// BLOCK-83 D3 过渡装配：凡装载带 Result Studio descriptor 的插件，即注册科学任务确认钩子——
// 核心其余层只认钩子注册表（零 RS 插件 = 零注册 = 零确认直通）。P3/P4 生信包建仓后本装配随 scientific-task-* 迁出核心。
const { registerTaskConfirmationHook } = require('../shared-backend/task-confirmation-hooks');
let scientificTaskConfirmationHookRegistered = false;
function ensureScientificTaskConfirmationHookRegistered() {
  if (scientificTaskConfirmationHookRegistered) return;
  const { createScientificTaskConfirmationHook } = require('../shared-backend/scientific-task-confirmation');
  registerTaskConfirmationHook(createScientificTaskConfirmationHook());
  scientificTaskConfirmationHookRegistered = true;
}

// 已注册插件 Map（id → { ...meta, pluginDir, scriptPath }）
let _lastPluginsDir = null;
function _getPluginsMap() {
  if (!globalThis._petriPlugins) globalThis._petriPlugins = new Map();
  return globalThis._petriPlugins;
}

function _resolveBuiltInPluginsDir() {
  return (
    process.env.PETRI_BUILT_IN_PLUGINS_DIR ||
    path.resolve(__dirname, '..', '..', 'resources', 'built-in-plugins')
  );
}

function _getCanonicalBuiltInPlugin(pluginId, builtInDir = _resolveBuiltInPluginsDir()) {
  if (!pluginId || !builtInDir) return null;
  const pluginDir = path.join(builtInDir, pluginId);
  const pluginPath = path.join(pluginDir, 'plugin.json');
  const toolDefinitionPath = path.join(pluginDir, 'tool-definition.json');
  try {
    if (!fs.existsSync(pluginPath) || !fs.existsSync(toolDefinitionPath)) return null;
    const plugin = JSON.parse(fs.readFileSync(pluginPath, 'utf8'));
    if (plugin.sourcePolicy !== 'builtin-canonical') return null;
    return {
      ...plugin,
      id: plugin.id || pluginId,
      pluginDir,
      scriptPath: path.join(pluginDir, 'scripts'),
      _builtIn: true,
      _sourceType: 'builtin',
      _fromCanonicalBuiltIn: true,
    };
  } catch {
    return null;
  }
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
 * 获取插件的 MCP inputSchema（PL-001 配套）。
 * 工具入口在 _runPluginScript 之前调用 validateToolArgs(name, schema, args)，
 * 该函数从 tool-definition.json 的 inputs[] 派生出 JSON Schema，
 * 包含 type / required / minimum / maximum / enum。
 *
 * 插件 inputs[] 中每个元素的扩展字段：
 *   - type: 'number' | 'integer' | 'string' | 'enum'
 *   - min / max: 数值边界（number / integer 类型时生效）
 *   - enum: string[]（type='enum' 时必填）
 *   - required: boolean
 *   - default: 默认值
 *
 * @param {string} toolId - 工具 ID
 * @returns {object|null} - JSON Schema { type: 'object', properties: {...}, required: [...] }
 */
function getInputSchema(toolId) {
  const def = getToolDefinition(toolId);
  if (!def || !Array.isArray(def.inputs)) return null;
  return _inputsToInputSchema(def.inputs);
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
  } catch {
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
 * PetriPluginManifest v1 normalized view.
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
  const resultStudioValidation = validateResultStudioDescriptor({
    plugin,
    toolDefinition: toolDef,
    pluginDir: plugin.pluginDir || null,
  });
  if (resultStudioValidation.valid) ensureScientificTaskConfirmationHookRegistered();
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
    // BLOCK-83 D4：目录投影所需的表现层字段透传（additive；缺省由前端兜底）。
    color: toolDef.color || plugin.color || null,
    tutorialUrl: toolDef.tutorialUrl || plugin.tutorialUrl || null,
    demoDataUrl: toolDef.demoDataUrl || plugin.demoDataUrl || null,
    comingSoon: toolDef.comingSoon === true || plugin.comingSoon === true,
    // Optional Result Studio descriptor. Absence is meaningful: RS4 must then
    // classify unknown parameter edits as scientific recomputation.
    resultStudio: resultStudioValidation.valid ? resultStudioValidation.descriptor : null,
    resultStudioValidation: {
      valid: resultStudioValidation.valid,
      errors: resultStudioValidation.errors,
      warnings: resultStudioValidation.warnings,
    },
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

// RW-01 — 一方工具（agent-tools 直注册、无插件 manifest）的成果面描述符。
// validator.id 是历史恢复资格校验（restore_validator_proof_mismatch）的信任锚，
// 必须与登记桥 validationSummary.validatorIds 同源（model3d-revision-bridge.js）。
const FIRST_PARTY_RESULT_STUDIO_DESCRIPTORS = Object.freeze({
  model3d_export: Object.freeze({ validator: Object.freeze({ id: 'model3d-manifest/v1' }) }),
});

function getPluginManifest(pluginId) {
  const plugin = getPlugin(pluginId);
  if (!plugin) {
    const firstParty = FIRST_PARTY_RESULT_STUDIO_DESCRIPTORS[pluginId];
    return firstParty ? { resultStudio: { ...firstParty } } : null;
  }
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
 * MCP 工具调用的参数契约用 inputSchema，Petri 内部用 inputs[]。
 */
function _inputsToInputSchema(inputs) {
  const properties = {};
  const required = [];
  for (const inp of inputs || []) {
    if (!inp || !inp.id) continue;
    // 支持 number / integer / enum / string / boolean / file / directory
    let schemaType;
    if (inp.type === 'number' || inp.type === 'integer') {
      schemaType = inp.type;
    } else if (inp.type === 'enum') {
      schemaType = 'string';
    } else {
      schemaType = 'string';
    }
    const schema = { type: schemaType };
    if (inp.label) schema.description = inp.label;
    if (inp.hint) schema.description = (schema.description ? schema.description + '。' : '') + inp.hint;
    if (inp.default !== undefined) schema.default = inp.default;
    // PL-001 配套：number / integer 边界
    if (typeof inp.min === 'number') schema.minimum = inp.min;
    if (typeof inp.max === 'number') schema.maximum = inp.max;
    // enum 取值
    if (inp.type === 'enum' && Array.isArray(inp.enum)) {
      schema.enum = inp.enum;
    } else if (Array.isArray(inp.enum)) {
      schema.enum = inp.enum;
    }
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
    _inputs: manifest.inputs,
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
  // plugin-manager.js 已经注册到 globalThis._petriPlugins
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
 * 从磁盘扫描已装插件并注册（petri-server 子进程启动时调用）。
 *
 * 桌面版架构：plugin-manager.js 在 Electron 主进程里把插件注册到
 * globalThis._petriPlugins，但 petri-server 是独立子进程，globalThis 不共享。
 * 所以 petri-server 必须自己从 ~/Documents/Petri-Local/plugins/ 扫盘加载。
 *
 * 读取 installed.json → 逐个读 plugin.json → 注册到 _petriPlugins。
 */
function loadPluginsFromDisk(pluginsDir) {
  const dir =
    pluginsDir ||
    _lastPluginsDir ||
    resolveInstalledPluginsDir();
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

    const canonicalBuiltIn = _getCanonicalBuiltInPlugin(plug.id);
    if (canonicalBuiltIn) {
      const existing = map.get(plug.id);
      if (!existing || existing._sourceType !== 'development') {
        map.set(plug.id, canonicalBuiltIn);
      }
      logger.warn(
        `[plugin-loader] ${plug.id}: stale installed copy ignored; using builtin-canonical source`
      );
      continue;
    }

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
 * 已在 _petriPlugins 里的（用户已装）跳过——已装版本优先。
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
    const pluginDir = path.join(builtInDir, id);
    if (!fs.existsSync(path.join(pluginDir, 'plugin.json'))) continue;
    const canonicalBuiltIn = _getCanonicalBuiltInPlugin(id, builtInDir);
    const existing = map.get(id);
    // 普通内置插件保持历史优先级；builtin-canonical 可以替换历史安装副本，
    // 但显式开发者来源仍可覆盖，便于本地插件开发。
    if (
      existing &&
      !(canonicalBuiltIn && existing._sourceType !== 'development')
    ) {
      continue;
    }
    map.set(id, {
      ...meta,
      id,
      pluginDir,
      scriptPath: path.join(pluginDir, 'scripts'),
      _builtIn: true,
      _sourceType: 'builtin',
      ...(canonicalBuiltIn ? { sourcePolicy: 'builtin-canonical', _fromCanonicalBuiltIn: true } : {}),
    });
    count++;
  }
  if (count > 0) {
    logger.info(`[plugin-loader] loaded ${count} built-in plugin(s)`);
  }
}

// BLOCK-83 D4：默认插件源解析（与 server.js 启动路径同源），供目录投影等
// 非启动期消费者惰性加载使用，避免各处重复实现三源发现。
function resolveDefaultPluginSources() {
  const path = require('path');
  const developmentDirs = String(process.env.PETRI_DEVELOPMENT_PLUGIN_DIRS || '')
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
  return {
    builtInDir:
      process.env.PETRI_BUILT_IN_PLUGINS_DIR ||
      path.resolve(__dirname, '..', '..', 'resources', 'built-in-plugins'),
    installedDir: resolveInstalledPluginsDir(),
    developmentDirs,
  };
}

let _defaultSourcesLoaded = false;
function ensurePluginSourcesLoaded() {
  if (_defaultSourcesLoaded || getAllPluginManifests().length > 0) {
    _defaultSourcesLoaded = true;
    return getAllPluginManifests();
  }
  _defaultSourcesLoaded = true;
  try {
    loadPluginsFromSources(resolveDefaultPluginSources());
  } catch (error) {
    logger.warn('[plugin-loader] default source load failed: ' + (error && error.message));
  }
  return getAllPluginManifests();
}

/**
 * BLOCK-84：多源单次装载——任意 source 数组一次注册（避免多次调用互相清除 _fromSdkSource）。
 * sources 元素：{ type: 'builtin'|'installed'|'development', root, required? }
 */
function loadFromSourcesArray(sources) {
  const { inspectPluginSources } = require('../shared-backend/plugin-sdk');
  const result = inspectPluginSources({ sources, normalizeManifest: normalizePluginManifest });
  const map = _getPluginsMap();
  for (const [id, plugin] of map.entries()) {
    if (plugin && plugin._fromSdkSource) map.delete(id);
  }
  let count = 0;
  for (const candidate of result.candidates) {
    if (!candidate.valid || !candidate.manifest) continue;
    const existing = map.get(candidate.manifest.id);
    const canonicalBuiltIn =
      candidate.sourceType === 'builtin' &&
      candidate.plugin &&
      candidate.plugin.sourcePolicy === 'builtin-canonical';
    if (
      existing &&
      !existing._fromSdkSource &&
      candidate.sourceType === 'builtin' &&
      !(canonicalBuiltIn && existing._sourceType !== 'development')
    ) {
      continue;
    }
    const currentFingerprint = candidate.manifest.execution
      ? candidate.manifest.execution.scriptFingerprint
      : undefined;
    const installedFingerprint = candidate.plugin._installedFingerprint || null;
    const manifestDrift = !!(
      installedFingerprint && currentFingerprint && installedFingerprint !== currentFingerprint
    );
    // 与 loadPluginsFromSources 同一装配语义：必须补齐 pluginDir/scriptPath/_sourceType
    // 等运行时字段，否则 getToolDefinition 读 pluginDir 得到 undefined（catalog 投影 500）。
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
    count += 1;
  }
  if (count > 0) {
    logger.info(`[plugin-loader] loaded ${count} plugin(s) from source list`);
  }
  return count;
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
    const canonicalBuiltIn =
      candidate.sourceType === 'builtin' &&
      candidate.plugin &&
      candidate.plugin.sourcePolicy === 'builtin-canonical';
    if (
      existing &&
      !existing._fromSdkSource &&
      candidate.sourceType === 'builtin' &&
      !(canonicalBuiltIn && existing._sourceType !== 'development')
    ) {
      continue;
    }
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
  getInputSchema,
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
  resolveInstalledPluginsDir,
  loadBuiltInPlugins,
  loadPluginsFromSources,
  loadFromSourcesArray,
  resolveDefaultPluginSources,
  ensurePluginSourcesLoaded,
};

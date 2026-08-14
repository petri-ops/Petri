'use strict';

/**
 * Tool Plugin Loader — 动态加载和管理工具插件，支持热加载。
 *
 * 插件目录结构：
 *   plugins/
 *   ├── my-tool/
 *   │   ├── definition.json  # 工具元数据（OpenAI 兼容 schema）
 *   │   ├── handler.js        # 处理函数（module.exports = async function(context, args) {...}）
 *   │   └── schema.json        # 契约 schema（可选，默认使用预定义模板）
 *
 * 热加载：插件文件变更时自动重新加载（使用 fs.watchFile）
 * 错误隔离：单个插件失败不影响其他插件
 * 向后兼容：现有硬编码工具通过 registerTool() 接口注册
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_PLUGIN_DIR = path.join(__dirname, 'plugins');
const CONTRACT_VERSION = '1.0.0';
const DEFAULT_CATEGORY = 'workspace';
const DEFAULT_SIDE_EFFECT = 'none';
const DEFAULT_RISK_TIER = 'R1';

const CATEGORIES = new Set([
  'workspace',
  'retrieval',
  'action',
  'planning',
  'analysis',
  'vision',
  'reporting',
  'verification',
  'result-studio',
  'plugin',
]);

const SIDE_EFFECTS = new Set([
  'none',
  'state-write',
  'workspace-write',
  'execution',
  'external-request',
]);

const RISK_TIERS = Object.freeze(['R0', 'R1', 'R2', 'R3']);
const RISK_TIER_SET = new Set(RISK_TIERS);

/**
 * @typedef {Object} PluginContract
 * @property {string} contractVersion
 * @property {string} category
 * @property {string} sideEffect
 * @property {string} riskTier
 * @property {string[]} resources
 * @property {number} estimatedDurationMs
 * @property {boolean} [cancellable]
 */

/**
 * @typedef {Object} PluginInfo
 * @property {string} name
 * @property {string} pluginPath
 * @property {Object} definition
 * @property {Function} handler
 * @property {PluginContract} contract
 * @property {Object} schema
 * @property {number} loadedAt
 */

class ToolPluginLoader {
  /**
   * @param {Object} options
   * @param {string} [options.pluginDir] - 插件目录路径
   * @param {boolean} [options.watchEnabled=true] - 是否启用热加载监听
   * @param {Function} [options.onPluginLoaded] - 插件加载成功回调 (pluginInfo) => void
   * @param {Function} [options.onPluginError] - 插件加载失败回调 (name, error) => void
   * @param {Function} [options.onPluginChanged] - 插件变更回调 (name, type) => void
   */
  constructor(options = {}) {
    this.pluginDir = options.pluginDir || DEFAULT_PLUGIN_DIR;
    this.watchEnabled = options.watchEnabled !== false;
    this.onPluginLoaded = options.onPluginLoaded || null;
    this.onPluginError = options.onPluginError || null;
    this.onPluginChanged = options.onPluginChanged || null;

    /** @type {Map<string, PluginInfo>} */
    this._plugins = new Map();

    /** @type {Map<string, NodeJS.Timeout>} */
    this._reloadTimers = new Map();

    /** @type {Map<string, {mtime: number, size: number}>} */
    this._fileStats = new Map();

    /** @type {fs.StatWatcher | null} */
    this._watcher = null;

    this._isInitialized = false;
  }

  /**
   * 初始化加载器：扫描并加载所有插件
   * @returns {Promise<ToolPluginLoader>} this
   */
  async initialize() {
    if (this._isInitialized) {
      return this;
    }

    await this.loadAllPlugins(this.pluginDir);

    if (this.watchEnabled) {
      this._startWatching();
    }

    this._isInitialized = true;
    return this;
  }

  /**
   * 加载单个插件
   * @param {string} pluginPath - 插件目录路径
   * @returns {Promise<PluginInfo|null>}
   */
  async loadPlugin(pluginPath) {
    const name = path.basename(pluginPath);

    try {
      // 验证插件目录
      const stat = await fs.promises.stat(pluginPath);
      if (!stat.isDirectory()) {
        throw new Error(`Plugin path is not a directory: ${pluginPath}`);
      }

      // 读取 definition.json（必需）
      const defPath = path.join(pluginPath, 'definition.json');
      const definition = JSON.parse(await fs.promises.readFile(defPath, 'utf-8'));

      // 验证 definition
      if (!definition.type || definition.type !== 'function' || !definition.function) {
        throw new Error('Invalid definition: must have type="function" and function property');
      }
      if (!definition.function.name || typeof definition.function.name !== 'string') {
        throw new Error('Invalid definition.function.name');
      }

      // 读取 handler.js（必需）
      const handlerPath = path.join(pluginPath, 'handler.js');
      const handler = require(handlerPath);
      if (typeof handler !== 'function') {
        throw new Error('handler.js must export a function');
      }

      // 读取 schema.json（可选，用于契约）
      let schema = null;
      const schemaPath = path.join(pluginPath, 'schema.json');
      try {
        schema = JSON.parse(await fs.promises.readFile(schemaPath, 'utf-8'));
      } catch {
        // schema.json 可选，使用默认值
      }

      // 构建契约
      const contract = this._buildContract(name, schema);

      // 缓存文件统计
      this._cacheFileStats(pluginPath);

      const pluginInfo = {
        name: definition.function.name,
        pluginPath,
        definition,
        handler,
        contract,
        schema,
        loadedAt: Date.now(),
      };

      this._plugins.set(name, pluginInfo);

      if (this.onPluginLoaded) {
        this.onPluginLoaded(pluginInfo);
      }

      return pluginInfo;
    } catch (error) {
      if (this.onPluginError) {
        this.onPluginError(name, error);
      }
      return null;
    }
  }

  /**
   * 加载指定目录下的所有插件
   * @param {string} pluginDir - 插件目录路径
   * @returns {Promise<PluginInfo[]>}
   */
  async loadAllPlugins(pluginDir) {
    const results = [];

    try {
      // 确保目录存在
      await fs.promises.access(pluginDir);
    } catch {
      // 目录不存在，创建并返回空
      await fs.promises.mkdir(pluginDir, { recursive: true });
      return results;
    }

    const entries = await fs.promises.readdir(pluginDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const pluginPath = path.join(pluginDir, entry.name);

      // 跳过隐藏目录
      if (entry.name.startsWith('.')) continue;

      const plugin = await this.loadPlugin(pluginPath);
      if (plugin) {
        results.push(plugin);
      }
    }

    return results;
  }

  /**
   * 注册工具（向后兼容现有硬编码工具）
   * @param {Object} definition - OpenAI 兼容的工具定义
   * @param {Function} handler - 处理函数
   * @param {Object} [contract] - 契约元数据
   * @returns {PluginInfo}
   */
  registerTool(definition, handler, contract = {}) {
    if (!definition || !definition.function || !definition.function.name) {
      throw new Error('Invalid tool definition: missing function.name');
    }

    const name = definition.function.name;

    const fullContract = {
      contractVersion: CONTRACT_VERSION,
      category: contract.category || DEFAULT_CATEGORY,
      sideEffect: contract.sideEffect || DEFAULT_SIDE_EFFECT,
      riskTier: contract.riskTier || DEFAULT_RISK_TIER,
      resources: contract.resources || [],
      estimatedDurationMs: contract.estimatedDurationMs || 1000,
      cancellable: contract.cancellable || false,
    };

    const pluginInfo = {
      name,
      pluginPath: null,
      definition,
      handler,
      contract: fullContract,
      schema: null,
      loadedAt: Date.now(),
      isBuiltin: true,
    };

    this._plugins.set(name, pluginInfo);
    return pluginInfo;
  }

  /**
   * 注销工具
   * @param {string} name - 工具名称
   * @returns {boolean} 是否成功注销
   */
  unregisterTool(name) {
    return this._plugins.delete(name);
  }

  /**
   * 获取所有已加载的工具
   * @returns {PluginInfo[]}
   */
  getAllTools() {
    return Array.from(this._plugins.values());
  }

  /**
   * 获取工具定义列表（用于 provider）
   * @returns {Object[]}
   */
  getToolDefs() {
    return this.getAllTools().map((info) => ({
      type: 'function',
      function: {
        name: info.definition.function.name,
        description: info.definition.function.description || '',
        parameters: info.definition.function.parameters || {},
      },
    }));
  }

  /**
   * 获取工具处理器
   * @param {string} name - 工具名称
   * @returns {Function|undefined}
   */
  getToolHandler(name) {
    const info = this._plugins.get(name);
    return info ? info.handler : undefined;
  }

  /**
   * 获取工具契约
   * @param {string} name - 工具名称
   * @returns {Object|undefined}
   */
  getToolContract(name) {
    const info = this._plugins.get(name);
    return info ? info.contract : undefined;
  }

  /**
   * 获取单个工具信息
   * @param {string} name - 工具名称
   * @returns {PluginInfo|undefined}
   */
  getToolInfo(name) {
    return this._plugins.get(name);
  }

  /**
   * 检查工具是否存在
   * @param {string} name - 工具名称
   * @returns {boolean}
   */
  hasTool(name) {
    return this._plugins.has(name);
  }

  /**
   * 重新加载单个插件
   * @param {string} name - 插件名称
   * @returns {Promise<PluginInfo|null>}
   */
  async reloadPlugin(name) {
    const existing = this._plugins.get(name);
    if (!existing || !existing.pluginPath) {
      return null;
    }

    // 清除 require 缓存
    this._clearRequireCache(existing.pluginPath);

    // 重新加载
    return await this.loadPlugin(existing.pluginPath);
  }

  /**
   * 重新加载所有插件
   * @returns {Promise<PluginInfo[]>}
   */
  async reloadAllPlugins() {
    // 清除所有插件的 require 缓存
    for (const [name, info] of this._plugins) {
      if (info.pluginPath) {
        this._clearRequireCache(info.pluginPath);
      }
    }

    // 清空插件映射
    this._plugins.clear();

    // 重新加载
    return await this.loadAllPlugins(this.pluginDir);
  }

  /**
   * 停止热加载监听
   */
  stopWatching() {
    if (this._watcher) {
      this._watcher.close();
      this._watcher = null;
    }

    for (const timer of this._reloadTimers.values()) {
      clearTimeout(timer);
    }
    this._reloadTimers.clear();

    // 取消 fs.watchFile 监听
    for (const key of this._fileStats.keys()) {
      try {
        fs.unwatchFile(key);
      } catch {}
    }
    this._fileStats.clear();
  }

  /**
   * 销毁加载器
   */
  destroy() {
    this.stopWatching();
    this._plugins.clear();
    this._isInitialized = false;
  }

  // ==================== 私有方法 ====================

  /**
   * 构建契约对象
   * @private
   */
  _buildContract(name, schema) {
    if (!schema) {
      // 使用默认契约模板
      return {
        contractVersion: CONTRACT_VERSION,
        category: 'plugin',
        sideEffect: DEFAULT_SIDE_EFFECT,
        riskTier: DEFAULT_RISK_TIER,
        resources: [],
        estimatedDurationMs: 1000,
        cancellable: false,
      };
    }

    const errors = [];
    const contract = {
      contractVersion: schema.contractVersion || CONTRACT_VERSION,
      category: CATEGORIES.has(schema.category) ? schema.category : 'plugin',
      sideEffect: SIDE_EFFECTS.has(schema.sideEffect) ? schema.sideEffect : DEFAULT_SIDE_EFFECT,
      riskTier: RISK_TIER_SET.has(schema.riskTier) ? schema.riskTier : DEFAULT_RISK_TIER,
      resources: Array.isArray(schema.resources) ? schema.resources : [],
      estimatedDurationMs: Number.isInteger(schema.estimatedDurationMs) ? schema.estimatedDurationMs : 1000,
      cancellable: typeof schema.cancellable === 'boolean' ? schema.cancellable : false,
    };

    this._validateContract(name, contract, errors);

    if (errors.length > 0) {
      throw new Error(`Invalid contract for ${name}:\n- ${errors.join('\n- ')}`);
    }

    return contract;
  }

  /**
   * 验证契约
   * @private
   */
  _validateContract(name, contract, errors) {
    if (!contract.contractVersion || !/^\d+\.\d+\.\d+$/.test(contract.contractVersion)) {
      errors.push('invalid contractVersion (expected semver)');
    }
    if (!CATEGORIES.has(contract.category)) {
      errors.push(`invalid category (expected one of: ${[...CATEGORIES].join(', ')})`);
    }
    if (!SIDE_EFFECTS.has(contract.sideEffect)) {
      errors.push(`invalid sideEffect (expected one of: ${[...SIDE_EFFECTS].join(', ')})`);
    }
    if (!RISK_TIER_SET.has(contract.riskTier)) {
      errors.push(`invalid riskTier (expected one of: ${RISK_TIERS.join(', ')})`);
    }
    if (!Array.isArray(contract.resources)) {
      errors.push('resources must be an array');
    }
    if (!Number.isInteger(contract.estimatedDurationMs) || contract.estimatedDurationMs < 0) {
      errors.push('estimatedDurationMs must be a non-negative integer');
    }
  }

  /**
   * 缓存文件统计信息
   * @private
   */
  _cacheFileStats(pluginPath) {
    const files = ['definition.json', 'handler.js', 'schema.json'];
    for (const file of files) {
      const filePath = path.join(pluginPath, file);
      try {
        const stat = fs.statSync(filePath);
        this._fileStats.set(filePath, { mtime: stat.mtimeMs, size: stat.size });
      } catch {
        // 文件不存在，忽略
      }
    }
  }

  /**
   * 清除 require 缓存
   * @private
   */
  _clearRequireCache(pluginPath) {
    const files = ['definition.json', 'handler.js', 'schema.json'];
    for (const file of files) {
      const filePath = path.join(pluginPath, file);
      const ext = path.extname(filePath);
      if (ext === '.js') {
        delete require.cache[require.resolve(filePath)];
      }
      this._fileStats.delete(filePath);
    }
  }

  /**
   * 启动文件监听
   * @private
   */
  _startWatching() {
    const pluginDir = this.pluginDir;

    // 监听插件目录本身（检测新增/删除插件目录）
    try {
      this._watcher = fs.watch(pluginDir, { recursive: false }, (eventType, filename) => {
        if (!filename) return;

        const fullPath = path.join(pluginDir, filename);

        // 新增插件目录
        if (eventType === 'rename') {
          fs.access(fullPath, (err) => {
            if (!err) {
              // 可能是新增目录
              const stat = fs.statSync(fullPath);
              if (stat.isDirectory()) {
                this._scheduleReload(fullPath, 'add');
              }
            }
          });
        }
      });
    } catch (error) {
      // 监听失败不影响主功能
      console.warn(`[ToolPluginLoader] Failed to watch plugin directory: ${error.message}`);
      return;
    }

    // 监听所有已加载插件的文件变更
    this._watchAllPluginFiles();
  }

  /**
   * 监听所有插件文件
   * @private
   */
  _watchAllPluginFiles() {
    for (const [filePath] of this._fileStats) {
      this._watchFile(filePath);
    }
  }

  /**
   * 监听单个文件
   * @private
   */
  _watchFile(filePath) {
    fs.watchFile(filePath, { interval: 1000 }, (curr, prev) => {
      if (curr.mtimeMs !== prev.mtimeMs || curr.size !== prev.size) {
        const pluginPath = path.dirname(filePath);
        this._scheduleReload(pluginPath, 'change');
      }
    });
  }

  /**
   * 调度重新加载（防抖）
   * @private
   */
  _scheduleReload(pluginPath, type) {
    const name = path.basename(pluginPath);
    const key = `${name}:${type}`;

    // 清除之前的定时器
    const existingTimer = this._reloadTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // 防抖延迟
    const timer = setTimeout(async () => {
      this._reloadTimers.delete(key);

      try {
        if (type === 'add') {
          await this.loadPlugin(pluginPath);
          if (this.onPluginChanged) {
            this.onPluginChanged(name, 'loaded');
          }
        } else {
          await this.reloadPlugin(name);
          if (this.onPluginChanged) {
            this.onPluginChanged(name, 'reloaded');
          }
        }
      } catch (error) {
        if (this.onPluginError) {
          this.onPluginError(name, error);
        }
      }
    }, 500);

    this._reloadTimers.set(key, timer);
  }
}

module.exports = {
  ToolPluginLoader,
  DEFAULT_PLUGIN_DIR,
  CONTRACT_VERSION,
  CATEGORIES,
  SIDE_EFFECTS,
  RISK_TIERS,
};

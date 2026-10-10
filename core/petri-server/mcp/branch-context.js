// ============================================================
// Branch Context Module
//
// Phase 3: MCP tool binding to active branch context
//
// Provides branch context injection for MCP tools:
//   - Auto-injects branchId for message operations
//   - Tracks sourceBranchId for result creation
//   - Wraps handlers to transparently add context
// ============================================================

const path = require('path');

// Branch DB 导入（延迟加载避免 Electron 打包问题）
let _branchDb = null;
function getBranchDb() {
  if (!_branchDb) {
    try {
      // desktop-app/src/database/branch-db.js 的相对路径（从 core/petri-server/mcp/ 出发）
      const desktopAppRoot = path.resolve(__dirname, '..', '..', '..', 'desktop');
      const branchDbPath = path.join(desktopAppRoot, 'src', 'database', 'branch-db.js');
      require(path.join(desktopAppRoot, 'src', 'migration-runner'));
      _branchDb = require(branchDbPath);
    } catch (e) {
      console.warn('[branch-context] Branch DB require failed:', e.message);
      return null;
    }
  }
  return _branchDb;
}

/**
 * 获取项目的当前活跃分支 ID
 * @param {string} projectId - 项目 ID
 * @returns {string|null} 活跃分支 ID 或 null
 */
function getActiveBranchId(projectId) {
  const db = getBranchDb();
  if (!db || !projectId) return null;
  try {
    const branch = db.getActiveBranch(projectId);
    return branch?.id || null;
  } catch (e) {
    console.warn('[branch-context] getActiveBranchId failed:', e.message);
    return null;
  }
}

/**
 * 获取项目的当前活跃分支对象
 * @param {string} projectId - 项目 ID
 * @returns {object|null} 活跃分支对象或 null
 */
function getActiveBranch(projectId) {
  const db = getBranchDb();
  if (!db || !projectId) return null;
  try {
    return db.getActiveBranch(projectId);
  } catch (e) {
    console.warn('[branch-context] getActiveBranch failed:', e.message);
    return null;
  }
}

/**
 * 验证分支是否属于指定项目
 * @param {string} branchId - 分支 ID
 * @param {string} projectId - 项目 ID
 * @returns {boolean} 是否属于
 */
function isBranchInProject(branchId, projectId) {
  const db = getBranchDb();
  if (!db || !branchId || !projectId) return false;
  try {
    const branch = db.getBranch(branchId);
    return branch?.project_id === projectId;
  } catch {
    return false;
  }
}

/**
 * 分支上下文管理器
 * 用于包装 MCP 工具处理器，自动注入分支上下文
 */
class BranchContextManager {
  constructor() {
    this._cache = new Map();
    this._cacheTimeout = 5000; // 5秒缓存，避免频繁查询
  }

  /**
   * 获取缓存 key
   */
  _cacheKey(projectId, operation) {
    return `${projectId}:${operation}`;
  }

  /**
   * 清除项目缓存
   */
  clearCache(projectId) {
    const prefix = `${projectId}:`;
    for (const key of this._cache.keys()) {
      if (key.startsWith(prefix)) {
        this._cache.delete(key);
      }
    }
  }

  /**
   * 获取活跃分支 ID（带缓存）
   * @param {string} projectId - 项目 ID
   * @returns {string|null}
   */
  getActiveBranchId(projectId) {
    const cacheKey = this._cacheKey(projectId, 'activeBranchId');
    const cached = this._cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this._cacheTimeout) {
      return cached.value;
    }
    const value = getActiveBranchId(projectId);
    this._cache.set(cacheKey, { value, timestamp: Date.now() });
    return value;
  }

  /**
   * 获取活跃分支对象（带缓存）
   * @param {string} projectId - 项目 ID
   * @returns {object|null}
   */
  getActiveBranch(projectId) {
    const cacheKey = this._cacheKey(projectId, 'activeBranch');
    const cached = this._cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this._cacheTimeout) {
      return cached.value;
    }
    const value = getActiveBranch(projectId);
    this._cache.set(cacheKey, { value, timestamp: Date.now() });
    return value;
  }

  /**
   * 包装消息处理器，自动注入 branchId
   * 当用户未提供 branchId 时，自动使用活跃分支
   *
   * @param {Function} handler - 原始处理器
   * @param {object} options - 选项
   * @param {boolean} options.requireActiveBranch - 是否要求存在活跃分支（默认 false）
   * @returns {Function} 包装后的处理器
   */
  wrapMessageHandler(handler, options = {}) {
    const { requireActiveBranch = false } = options;
    return async (args, context = {}) => {
      const { projectId } = context;
      let branchId = args.branchId;

      // 如果未提供 branchId，尝试使用活跃分支
      if (!branchId && projectId) {
        branchId = this.getActiveBranchId(projectId);
        if (branchId) {
          // 透明注入，不修改原始 args
          args = { ...args, branchId };
        }
      }

      // 验证分支归属
      if (branchId && projectId && !isBranchInProject(branchId, projectId)) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'Branch does not belong to project' }) }],
          isError: true,
        };
      }

      // 如果要求活跃分支但不存在
      if (requireActiveBranch && !branchId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'No active branch for project' }) }],
          isError: true,
        };
      }

      return handler(args, context);
    };
  }

  /**
   * 包装结果创建处理器，自动注入 sourceBranchId
   * sourceBranchId 仅用于追溯，不影响 Result 访问
   *
   * @param {Function} handler - 原始处理器
   * @returns {Function} 包装后的处理器
   */
  wrapResultCreateHandler(handler) {
    return async (args, context = {}) => {
      const { projectId } = context;
      let sourceBranchId = args.sourceBranchId;

      // 如果未提供 sourceBranchId，尝试使用活跃分支
      if (!sourceBranchId && projectId) {
        const activeBranch = this.getActiveBranch(projectId);
        if (activeBranch) {
          sourceBranchId = activeBranch.id;
          // 透明注入
          args = { ...args, sourceBranchId };
        }
      }

      return handler(args, context);
    };
  }

  /**
   * 包装插件工具处理器，自动注入 sourceBranchId 到工具参数
   * 用于记录结果来源分支
   *
   * @param {Function} handler - 原始处理器
   * @returns {Function} 包装后的处理器
   */
  wrapPluginToolHandler(handler) {
    return async (args, context = {}) => {
      const { projectId } = context;

      // 注入 sourceBranchId 到 context（由调用方写入 tool_jobs）
      if (projectId) {
        const sourceBranchId = this.getActiveBranchId(projectId);
        if (sourceBranchId) {
          context = { ...context, sourceBranchId };
        }
      }

      return handler(args, context);
    };
  }
}

// 单例导出
const branchContext = new BranchContextManager();

module.exports = {
  // 原始函数
  getActiveBranchId,
  getActiveBranch,
  isBranchInProject,
  // 管理器实例
  branchContext,
  // 管理器类（用于测试或特殊场景）
  BranchContextManager,
};

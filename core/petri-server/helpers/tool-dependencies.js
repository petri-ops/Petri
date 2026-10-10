// ============================================================
// tool-dependencies.js — BLOCK-58 R 工具依赖治理
//
// 内置 tool-scripts 依赖单一事实源（_dependencies.json）的加载与
// 执行前毫秒级检查。分析执行路径零安装：脚本内已改为 MISSING_R_PACKAGES
// fail-fast（绝不联网），本模块把拦截再提前到提交 job 前——缺包直接
// markJobFailed 并给出可行动指引，不浪费一次注定失败的进程派生。
//
// 依赖清单覆盖的脚本才检查（_dependencies.json.tools[*].script）；
// 插件脚本（_isPlugin）有自己的 manifest packages + 预编译包通道，不在此管。
// ============================================================

const fs = require('fs');
const path = require('path');

// BLOCK-83 P4：依赖清单随领域包交付（PETRI_DOMAIN_TOOL_DEPENDENCIES 可覆盖；缺省路径不存在=跳过检查不阻塞）
const DEPENDENCIES_FILE = process.env.PETRI_DOMAIN_TOOL_DEPENDENCIES || path.join(__dirname, '..', 'tool-scripts', '_dependencies.json');

let cache = null;

/** 读取依赖清单（进程内缓存；文件缺失/坏 JSON 返回 null，调用方跳过检查不阻塞执行）。 */
function loadToolDependencies() {
  if (cache) return cache;
  try {
    const raw = JSON.parse(fs.readFileSync(DEPENDENCIES_FILE, 'utf-8'));
    if (!raw || typeof raw.tools !== 'object') return null;
    cache = raw;
    return cache;
  } catch {
    return null;
  }
}

/** 测试用：清缓存（_dependencies.json 内容在测试中可能被 mock）。 */
function _resetCacheForTest() {
  cache = null;
}

/**
 * 执行前检查：目标脚本声明的工具专属包是否全部就位。
 * @param {{checkPackageInstalled: (pkg: string) => boolean}} executor - r-executor
 * @param {string} scriptName - 如 "consensus-cluster.R"（tool-registry 的 cfg.script）
 * @returns {{checked: boolean, missing: string[]}} checked=false 表示清单无此脚本或清单不可读（放行，由脚本内 fail-fast 兜底）
 */
function checkToolDependencies(executor, scriptName) {
  const deps = loadToolDependencies();
  if (!deps || !executor || typeof executor.checkPackageInstalled !== 'function') {
    return { checked: false, missing: [] };
  }
  const entry = Object.values(deps.tools || {}).find((t) => t.script === scriptName);
  if (!entry) return { checked: false, missing: [] };
  const missing = Object.keys(entry.packages || {}).filter((pkg) => !executor.checkPackageInstalled(pkg));
  return { checked: true, missing };
}

/**
 * 缺包失败信息（markJobFailed 消费）：缺失清单 + 可行动指引。
 */
function missingPackagesMessage(toolId, missing) {
  return (
    `缺少 R 依赖包: ${missing.join(', ')}。`
    + `分析路径不联网安装（BLOCK-58 治理）；显式补装：node scripts/install-r-tool-dependencies.mjs --tool ${toolId}，`
    + `或安装携带预编译包的 R 工具链插件。`
  );
}

module.exports = { loadToolDependencies, checkToolDependencies, missingPackagesMessage, _resetCacheForTest, DEPENDENCIES_FILE };

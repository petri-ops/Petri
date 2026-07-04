/**
 * desktop-app/src/mcp-tool-registry.js — MCP 统一工具注册表（产线合一）
 *
 * 合并两条产线成单一 listTools()/callTool() 接口：
 *   1. 插件通道（bulk 工具，如 volcano-plot/deseq2）—— r-server/plugin-loader
 *   2. 单细胞步骤（10 步，如 scrna-standard/deg）—— r-server/task-scripts-gen
 *
 * 这是 BioF3 两套脚本产线的接合点。Task 2 只实现 listTools（合并列表），
 * callTool 是 stub（Task 3 实现插件分支，Task 4 实现单细胞分支）。
 */

const path = require('path');

// 复用 plugin-manager.js 的路径解析策略（dev/pack 两种模式）
function resolveRSserver() {
  // dev 模式：desktop-app/src/ → 仓库根/r-server
  const devPath = path.resolve(__dirname, '..', '..', 'r-server');
  try {
    require('fs').accessSync(devPath);
    return devPath;
  } catch {
    // 打包模式：r-server 在 resources 下（见 plugin-manager resolveSharedBackendDir）
    return path.join(process.resourcesPath || '', 'r-server');
  }
}

const R_SERVER = resolveRSserver();
const pluginLoader = require(path.join(R_SERVER, 'plugin-loader.js'));
const taskScripts = require(path.join(R_SERVER, 'task-scripts-gen', 'index.js'));

/**
 * 合并插件工具 + 单细胞步骤，返回 MCP tools/list 格式。
 * @returns {Promise<Array<{name, description, inputSchema}>>}
 */
async function listTools() {
  const pluginTools = pluginLoader.listToolsForMCP();
  const stepTools = taskScripts.listStepTools();
  return [...pluginTools, ...stepTools];
}

/**
 * 执行工具（Task 3-4 实现）。Task 2 阶段是 stub。
 */
async function callTool(name, args) {
  throw new Error(`not_implemented: callTool 尚未实现（Task 3-4 填充），name=${name}`);
}

module.exports = { listTools, callTool };

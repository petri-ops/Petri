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
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

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

function resolveSharedBackend() {
  const devPath = path.resolve(__dirname, '..', '..', 'shared-backend');
  try {
    require('fs').accessSync(devPath);
    return devPath;
  } catch {
    return path.join(process.resourcesPath || '', 'shared-backend');
  }
}

const R_SERVER = resolveRSserver();
const SHARED_BACKEND = resolveSharedBackend();
const pluginLoader = require(path.join(R_SERVER, 'plugin-loader.js'));
const taskScripts = require(path.join(R_SERVER, 'task-scripts-gen', 'index.js'));
const config = require(path.join(R_SERVER, 'config.js'));

// 注册 R/Python 执行器（plugin-manager 同款，主进程子进程都要自己 init）
try {
  require(path.join(SHARED_BACKEND, 'init')).initSharedBackend();
} catch (e) {
  console.warn('[mcp-registry] initSharedBackend failed:', e.message);
}

// MCP 工具 jobDir 根（local 模式，复用 tools.js 的 JOBS_DIR 约定）
const MCP_JOBS_DIR = path.join(
  config.localResultsDir || path.join(os.homedir(), 'Documents', 'BioF3-Local', 'results'),
  'mcp-tool-jobs'
);

/**
 * 合并插件工具 + 单细胞步骤，返回 MCP tools/list 格式。
 */
async function listTools() {
  const pluginTools = pluginLoader.listToolsForMCP();
  const stepTools = taskScripts.listStepTools();
  return [...pluginTools, ...stepTools];
}

/**
 * 执行插件 R 脚本（local 模式）。
 * 复刻 r-server/helpers/tools-executor.js:384-407 的执行约定：
 *   - R 工具脚本约定 commandArgs(trailingOnly=TRUE)[1] = job_dir
 *   - 不用 buildSpawnCommand（那是 figcode 的 --args params.json 约定）
 *   - 调用方写 jobDir/params.json，脚本 setwd(jobDir) 后 fromJSON 读
 *   - 插件包注入 R_LIBS_USER（pluginDir/packages/r 优先）
 *   - 结果读 jobDir/manifest.json（脚本写）+ 列 jobDir 下输出文件
 */
function _runPluginScript(plugin, scriptPath, args) {
  return new Promise((resolve) => {
    const jobId = 'mcp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const jobDir = path.join(MCP_JOBS_DIR, jobId);
    const outputDir = path.join(jobDir, 'output');
    config.mkdirSandbox(jobDir);
    config.mkdirSandbox(outputDir);

    // 1. 写 params.json（脚本从 args[1]=jobDir 读它）
    fs.writeFileSync(path.join(jobDir, 'params.json'), JSON.stringify(args || {}));

    // 2. 复制脚本到 jobDir（run-script.R），避免污染插件原脚本目录
    const scriptExt = plugin.language === 'r' ? '.R' : '.py';
    const runScript = path.join(jobDir, 'run-script' + scriptExt);
    fs.copyFileSync(scriptPath, runScript);

    // 3. 构造执行命令（local 模式）
    const { getExecutor } = require(path.join(SHARED_BACKEND, 'executors'));
    const executor = getExecutor(plugin.language);
    let runCmd;
    let runEnv = undefined;
    if (plugin.language === 'r') {
      runCmd = [executor.binPath, runScript, jobDir];
      // 插件包注入 R_LIBS_USER
      const pluginRPkgDir = path.join(plugin.pluginDir, 'packages', 'r');
      if (fs.existsSync(pluginRPkgDir)) {
        const rHomeLib = path.join(process.env.BIOF3_R_HOME || '', 'library');
        runEnv = {
          ...process.env,
          R_HOME: process.env.BIOF3_R_HOME || process.env.R_HOME,
          R_LIBS_USER: pluginRPkgDir + (fs.existsSync(rHomeLib) ? ':' + rHomeLib : ''),
        };
      }
    } else {
      // Python 走 buildSpawnCommand（--params 约定）
      const spawnCmd = executor.buildSpawnCommand(runScript, jobDir, args || {});
      runCmd = [spawnCmd.cmd, ...spawnCmd.args];
      if (spawnCmd.env) runEnv = spawnCmd.env;
    }

    // 4. 执行
    execFile(
      runCmd[0],
      runCmd.slice(1),
      { timeout: 300000, maxBuffer: 10 * 1024 * 1024, env: runEnv },
      (err, stdout, stderr) => {
        if (err) {
          return resolve({
            content: [
              {
                type: 'text',
                text: `执行失败: ${err.killed ? '超时（>300s）' : stderr || err.message}\n\nSTDOUT:\n${stdout || ''}`,
              },
            ],
            isError: true,
            _jobDir: jobDir,
          });
        }
        // 5. 读 manifest.json + 列输出文件
        const manifestPath = path.join(jobDir, 'manifest.json');
        let manifest = null;
        try {
          if (fs.existsSync(manifestPath)) {
            manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
          }
        } catch {}
        const outFiles = fs.existsSync(jobDir)
          ? fs
              .readdirSync(jobDir)
              .filter((f) => !['params.json', 'run-script.R', 'run-script.py'].includes(f))
          : [];
        const summary = {
          jobDir,
          outputs: (manifest?.outputs || []).map((o) => ({
            ...o,
            path: path.join(jobDir, o.filename),
          })),
          files: outFiles,
          manifest: manifest,
          stdout: (stdout || '').slice(-2000),
        };
        resolve({
          content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
          isError: false,
          _jobDir: jobDir,
        });
      }
    );
  });
}

/**
 * 执行工具。插件分支（Task 3）；单细胞步骤分支（Task 4）。
 * @returns {Promise<{content: Array, isError: boolean}>}
 */
async function callTool(name, args) {
  // 插件分支
  const plugin = pluginLoader.getPlugin(name);
  if (plugin) {
    const scriptPath = pluginLoader.getScriptForTool(name);
    if (!scriptPath || !fs.existsSync(scriptPath)) {
      return {
        content: [{ type: 'text', text: `插件 ${name} 脚本未找到: ${scriptPath}` }],
        isError: true,
      };
    }
    return _runPluginScript(plugin, scriptPath, args);
  }

  // 单细胞步骤分支（Task 4）
  if (taskScripts.STEP_META[name]) {
    return {
      content: [{ type: 'text', text: `步骤 ${name} 执行通道待 Task 4 实现` }],
      isError: true,
    };
  }

  return {
    content: [{ type: 'text', text: `unknown_tool: ${name}` }],
    isError: true,
  };
}

module.exports = { listTools, callTool };

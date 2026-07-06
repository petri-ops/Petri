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
// db.js 双驱动（SQLite/PG）：callTool 跑完写 tool_jobs 记录（方案 C，agent-led Task 1）
let db = null;
try {
  db = require(path.join(R_SERVER, 'db.js'));
} catch (e) {
  console.warn('[mcp-registry] db.js require failed, tool_jobs 记录不可用:', e.message);
}
// helpers/plans.js：tool_jobs 状态变化同步 plan step（agent-led Task 2）
let plans = null;
try {
  plans = require(path.join(R_SERVER, 'helpers', 'plans.js'));
} catch (e) {
  console.warn('[mcp-registry] plans.js require failed, plan step 同步不可用:', e.message);
}

// 注册 R/Python 执行器（plugin-manager 同款，主进程子进程都要自己 init）
try {
  require(path.join(SHARED_BACKEND, 'init')).initSharedBackend();
} catch (e) {
  console.warn('[mcp-registry] initSharedBackend failed:', e.message);
}

// 断点1（分仓前置）：注入 config 让执行器/storage 读到真 config（不走 env fallback）。
// 桌面版 mcp-tool-registry 在 stdio 子进程跑，不经 r-server/server.js 的注入，
// 必须自己注入。ai-usage 桌面版不写库（无用户上下文），不注入（helper no-op）。
try {
  require(SHARED_BACKEND).configure({
    getConfig: () => config,
  });
} catch (e) {
  console.warn('[mcp-registry] shared-backend configure failed:', e.message);
}

// 启动时自动加载用户已装插件（~/Documents/BioF3-Local/plugins/）。
// mcp-server 子进程与 Electron 主进程不共享 globalThis，必须自己 load。
// 失败不致命（无 installed.json = 没装过插件，正常），listTools 仍返回 10 个单细胞步骤。
try {
  pluginLoader.loadPluginsFromDisk();
} catch (e) {
  console.warn('[mcp-registry] loadPluginsFromDisk failed:', e.message);
}

// 自动发现 built-in 插件（resources/built-in-plugins/），不依赖 install。
// 让外部 agent 即使没装任何插件也能看到/调用 built-in 工具（volcano-plot 等）。
// 已装版本优先（loadBuiltInPlugins 内部去重）。
function resolveBuiltInPluginsDir() {
  // dev 模式：desktop-app/src/ → desktop-app/resources/built-in-plugins/
  const devPath = path.resolve(__dirname, '..', 'resources', 'built-in-plugins');
  if (fs.existsSync(devPath)) return devPath;
  // 打包模式：app bundle 的 Resources/built-in-plugins/
  if (process.resourcesPath) {
    const pkgPath = path.join(process.resourcesPath, 'built-in-plugins');
    if (fs.existsSync(pkgPath)) return pkgPath;
  }
  return null;
}
try {
  const builtInDir = resolveBuiltInPluginsDir();
  if (builtInDir) pluginLoader.loadBuiltInPlugins(builtInDir);
} catch (e) {
  console.warn('[mcp-registry] loadBuiltInPlugins failed:', e.message);
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
function _runPluginScript(plugin, scriptPath, args, userId = 'agent') {
  return new Promise((resolve) => {
    const jobId = 'mcp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const jobDir = path.join(MCP_JOBS_DIR, jobId);
    const outputDir = path.join(jobDir, 'output');
    config.mkdirSandbox(jobDir);
    config.mkdirSandbox(outputDir);

    // 方案 C（agent-led Task 1）：跑前建 tool_jobs 记录，跑完更新状态。
    // user_id 用调用方传入的 userId（agent 登录态下跑 = 真实用户 id，
    // 这样用户能在 history 看到、open_result 能按 jobId 加载）。
    let toolJobId = null;
    if (db) {
      try {
        const job = db.createToolJob({
          toolId: plugin.id,
          userId,
          params: args,
          status: 'running',
          name: `${plugin.id} via agent`,
        });
        toolJobId = job && job.id;
      } catch (e) {
        console.warn('[mcp-registry] createToolJob failed:', e.message);
      }
    }

    // 1. 写 params.json（脚本从 args[1]=jobDir 读它）
    fs.writeFileSync(path.join(jobDir, 'params.json'), JSON.stringify(args || {}));

    // 1b. file 类型输入：复制文件到 jobDir/<input_id>。
    // BioF3 工具脚本有两种读文件约定：
    //   (a) volcano-plot: 从 params$deg_table 读绝对路径
    //   (b) deseq2: list.files(job_dir, pattern="^counts") 在 jobDir 找文件
    // 为兼容两者，file input 既保留在 params（路径），又复制到 jobDir/<id>。
    // 复刻 tools-executor.js:572-578 的 files 写入约定（文件名 = input id）。
    const toolDef = pluginLoader.getToolDefinition(plugin.id);
    if (toolDef && Array.isArray(toolDef.inputs)) {
      for (const inp of toolDef.inputs) {
        if (inp.type !== 'file' || !inp.id) continue;
        const srcPath = args && args[inp.id];
        if (typeof srcPath !== 'string' || !fs.existsSync(srcPath)) continue;
        const ext = path.extname(srcPath);
        // 文件名 = input id（+ 原扩展名），deseq2 的 list.files("^counts") 才能命中
        fs.copyFileSync(srcPath, path.join(jobDir, inp.id + ext));
      }
    }

    // 2. 复制脚本到 jobDir（run-script.R），避免污染插件原脚本目录
    const scriptExt = plugin.language === 'r' ? '.R' : '.py';
    const runScript = path.join(jobDir, 'run-script' + scriptExt);
    fs.copyFileSync(scriptPath, runScript);

    // 2b. R 工具：复制 _biof3-theme.R 到 jobDir（脚本顶部 source 它）。
    // 复刻 tools-executor.js:361-374：插件脚本目录优先（build-plugin.sh 已复制），
    // 其次 r-server/tool-scripts/。漏这步会导致 source("_biof3-theme.R") 找不到文件。
    if (plugin.language === 'r') {
      const helperSearchDirs = [
        path.dirname(scriptPath), // 插件 scripts/ 目录
        path.join(R_SERVER, 'tool-scripts'), // 内置工具脚本目录
      ];
      for (const dir of helperSearchDirs) {
        const src = path.join(dir, '_biof3-theme.R');
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(jobDir, '_biof3-theme.R'));
          break;
        }
      }
    }

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
          const errText = `执行失败: ${err.killed ? '超时（>300s）' : stderr || err.message}\n\nSTDOUT:\n${stdout || ''}`;
          // 失败：更新 tool_jobs 状态
          if (db && toolJobId) {
            try {
              db.updateToolJob(toolJobId, {
                status: 'failed',
                error: errText,
                completedAt: Date.now(),
              });
              // 同步 plan step 状态（方案 C，agent-led Task 2）
              if (plans) plans.syncPlanStepStatusFromToolJob(toolJobId, 'failed', errText);
            } catch (e) {
              console.warn('[mcp-registry] updateToolJob(failed) failed:', e.message);
            }
          }
          return resolve({
            content: [{ type: 'text', text: errText }],
            isError: true,
            _jobDir: jobDir,
            toolJobId,
          });
        }
        // 5. 读 manifest.json + 列输出文件。
        // 产物位置有两种约定：(a) output/ 子目录（deseq2，tools-executor 标准）
        // (b) jobDir 根（volcano-plot 等独立插件脚本，setwd(jobDir) 后直接写）。
        // 先查 output/，再查 jobDir 根。
        let manifestPath = path.join(outputDir, 'manifest.json');
        let resultDir = outputDir;
        if (!fs.existsSync(manifestPath)) {
          manifestPath = path.join(jobDir, 'manifest.json');
          resultDir = jobDir;
        }
        let manifest = null;
        try {
          if (fs.existsSync(manifestPath)) {
            manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
          }
        } catch {}
        // manifest 有两种格式：(a) {outputs:[{id,filename,...}]} (b) {files:[{name,type,...}]}
        const manifestItems = manifest?.outputs || manifest?.files || [];
        const outFiles = fs.existsSync(resultDir)
          ? fs
              .readdirSync(resultDir)
              .filter(
                (f) =>
                  !['params.json', 'run-script.R', 'run-script.py', '_biof3-theme.R'].includes(f)
              )
          : [];
        const summary = {
          toolJobId,
          jobDir,
          outputDir,
          resultDir,
          outputs: manifestItems.map((o) => ({
            ...o,
            path: path.join(resultDir, o.filename || o.name || ''),
          })),
          files: outFiles,
          manifest: manifest,
          stdout: (stdout || '').slice(-2000),
        };
        // 成功：更新 tool_jobs 状态 + 写 result_json
        if (db && toolJobId) {
          try {
            db.updateToolJob(toolJobId, {
              status: 'completed',
              resultJson: summary,
              completedAt: Date.now(),
            });
            // 同步 plan step 状态（方案 C，agent-led Task 2）
            if (plans) plans.syncPlanStepStatusFromToolJob(toolJobId, 'completed');
          } catch (e) {
            console.warn('[mcp-registry] updateToolJob(completed) failed:', e.message);
          }
        }
        resolve({
          content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
          isError: false,
          _jobDir: jobDir,
          toolJobId,
        });
      }
    );
  });
}

/**
 * 执行工具。插件分支（Task 3）；单细胞步骤分支（Task 4）。
 * @returns {Promise<{content: Array, isError: boolean}>}
 */
async function callTool(name, args, opts = {}) {
  // opts.userId：归属用户（agent 在登录态下跑，写进 tool_jobs.user_id，
  // 这样用户能在 history 看到、open_result 能按 jobId 加载结果）。
  // 兜底 'agent'（无用户上下文，如 MCP 直连场景）。
  const userId = (opts && opts.userId) || 'agent';
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
    return _runPluginScript(plugin, scriptPath, args, userId);
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

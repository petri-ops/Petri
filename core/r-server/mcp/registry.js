/**
 * r-server/mcp/registry.js — MCP 统一工具注册表（产线合一）
 *
 * 断点2（A1）：从 desktop-app/src/mcp-tool-registry.js 下沉到 r-server/mcp/，
 * 斩断 r-server/agent-tools/learning.js → desktop-app/src/mcp-tool-registry 的反向引用。
 * desktop-app/src/mcp-server.js 改 require 本文件（dev: ../../r-server/mcp/registry）。
 *
 * 合并两条产线成单一 listTools()/callTool() 接口：
 *   1. 插件通道（bulk 工具，如 volcano-plot/deseq2）—— r-server/plugin-loader
 *   2. 单细胞步骤（10 步，如 scrna-standard/deg）—— r-server/task-scripts-gen
 *
 * 这是 BioF3 两套脚本产线的接合点。
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { reconcileArtifactTruth } = require('../helpers/artifact-truth');
const { createExecutionContext } = require('../../shared-backend/execution-context');
const { resolveProjectRunLayout } = require('../../shared-backend/project-run-layout');

// 路径解析（dev/pack 两种模式）
// 下沉后 r-server 自己 require 自己，路径变简单：
//   dev: __dirname = r-server/mcp → resolveRSserver = r-server 根
//   pack: r-server 在 resources/r-server，__dirname = resources/r-server/mcp → resolveRSserver = resources/r-server
function resolveRSserver() {
  // dev 模式：r-server/mcp/ → r-server 根
  const devPath = path.resolve(__dirname, '..');
  try {
    require('fs').accessSync(path.join(devPath, 'plugin-loader.js'));
    return devPath;
  } catch {
    // 打包模式：r-server 在 resources/r-server 下
    return path.join(process.resourcesPath || '', 'r-server');
  }
}

function resolveSharedBackend() {
  // dev 模式：r-server/mcp/ → 仓库根/shared-backend
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
const config = require(path.join(R_SERVER, 'config.js'));
// callTool 跑完后通过 db.js 写入 tool_jobs 记录（方案 C，agent-led Task 1）
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
// 桌面版 mcp-server 子进程跑本文件，不经 r-server/server.js 的注入，必须自己注入。
// ai-usage 桌面版不写库（无用户上下文），不注入（helper no-op）。
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
  // 去 submodule 后：core 直接内嵌在 desktop 仓根 core/ 下，built-in-plugins 在 desktop 仓根 resources/
  // r-server/mcp/ → r-server → core → desktop 仓根 → resources/built-in-plugins/
  const splitPath = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    'resources',
    'built-in-plugins'
  );
  if (fs.existsSync(splitPath)) return splitPath;
  // 打包模式：app bundle 的 Resources/built-in-plugins/
  if (process.resourcesPath) {
    const pkgPath = path.join(process.resourcesPath, 'built-in-plugins');
    if (fs.existsSync(pkgPath)) return pkgPath;
  }
  return null;
}
function refreshPluginSources() {
  const builtInDir = resolveBuiltInPluginsDir();
  const developmentDirs = String(process.env.BIOF3_DEVELOPMENT_PLUGIN_DIRS || '')
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
  return pluginLoader.loadPluginsFromSources({
    builtInDir,
    installedDir:
      process.env.BIOF3_PLUGINS_DIR ||
      path.join(os.homedir(), 'Documents', 'BioF3-Local', 'plugins'),
    developmentDirs,
  });
}

try {
  refreshPluginSources();
} catch (e) {
  console.warn('[mcp-registry] plugin source refresh failed:', e.message);
}

// Phase 3 (project-result-sandbox): MCP/Agent 工具物理目录收敛。
//
// 不再把 mcp-tool-jobs 作为项目任务默认根：
//   - 有 projectId → 走 resolveProjectRunLayout，落项目沙盒 <workspace>/results/jobs/<toolJobId>
//   - 无 projectId → 落共享全局 tool-jobs/<toolJobId>（与 R/Python HTTP executor 同根、同 tool_job.id 身份）
// 物理目录主键统一使用正式 tool_job.id（tj_xxx），不再用 mcp_xxx。
// 历史 mcp-tool-jobs 结果不自动搬迁，按 result_json 中的绝对路径回读
// （tools-executor.js 的 isManagedResultDir 已识别 mcp-tool-jobs 根）。
const GLOBAL_JOBS_DIR = path.join(
  config.localResultsDir || path.join(os.homedir(), 'Documents', 'BioF3-Local', 'results'),
  'tool-jobs'
);

const DEFAULT_CANONICAL_ROOT = '/work/biof3';

function _canonicalRootFromEnv() {
  return (
    process.env.BIOF3_HARNESS_CANONICAL_ROOT ||
    process.env.BIOF3_CANONICAL_ROOT ||
    DEFAULT_CANONICAL_ROOT
  );
}

function _localRootFromEnv() {
  return (
    process.env.BIOF3_HARNESS_LOCAL_ROOT ||
    process.env.BIOF3_LOCAL_ROOT ||
    config.localResultsDir ||
    path.join(os.homedir(), 'Documents', 'BioF3-Local', 'results')
  );
}

function _canonicalizePath(localPath, options = {}) {
  return createExecutionContext({
    workDir: localPath,
    localRoot: options.localRoot || _localRootFromEnv(),
    canonicalRoot: options.canonicalRoot || _canonicalRootFromEnv(),
  }).canonicalizePath(localPath);
}

function _createMcpExecutionContext({
  jobDir,
  outputDir,
  resultDir,
  runtime,
  runtimeCommand,
  runtimeReady,
  localRoot,
  canonicalRoot,
} = {}) {
  return createExecutionContext({
    workDir: jobDir,
    outputDir,
    resultDir,
    runtime,
    runtimeCommand,
    runtimeReady,
    mode: 'local',
    localRoot: localRoot || _localRootFromEnv(),
    canonicalRoot: canonicalRoot || _canonicalRootFromEnv(),
  });
}

/**
 * Phase 3: 解析 MCP/Agent 工具的物理运行目录，物理主键统一使用 tool_job.id。
 *   - 有 projectId + toolJobId → resolveProjectRunLayout（项目沙盒，客户端只提交 projectId）
 *   - 否则 → 全局 tool-jobs/<toolJobId>（与 R/Python HTTP executor 同根、同身份）
 * db 不可用（无 toolJobId）时回退临时 mcp_ 身份，仅保证不崩。
 * 有 projectId 但解析失败会 throw（不存在/归档/无权限/不可写），调用方硬失败、不静默写全局。
 */
function _resolveMcpJobLayout({ toolJobId, projectId, userId }) {
  if (projectId && toolJobId) {
    const layout = resolveProjectRunLayout({
      projectId,
      toolJobId,
      db,
      userId,
      skipPermissionCheck: false,
      ensureDirs: true,
    });
    return { jobDir: layout.jobRoot, outputDir: layout.outputDir };
  }
  const dirKey = toolJobId || 'mcp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const jobDir = path.join(GLOBAL_JOBS_DIR, dirKey);
  const outputDir = path.join(jobDir, 'output');
  config.mkdirSandbox(jobDir);
  config.mkdirSandbox(outputDir);
  return { jobDir, outputDir };
}

/**
 * 返回插件工具的 MCP tools/list 格式。
 * 单细胞步骤（旧 web task 引擎）已移除，不再对外暴露。
 */
async function listTools() {
  try {
    refreshPluginSources();
  } catch (e) {
    console.warn('[mcp-registry] refresh plugins before listTools failed:', e.message);
  }
  return pluginLoader.listToolsForMCP();
}

function _inferArtifactType(item, filename) {
  const explicit = item && (item.type || item.kind);
  if (explicit === 'plot' || explicit === 'image') return 'plot';
  if (explicit === 'table' || explicit === 'dataframe') return 'table';
  if (explicit === 'text' || explicit === 'log') return 'text';
  if (explicit === 'json') return 'json';
  const lower = String(filename || '').toLowerCase();
  if (/\.(png|jpg|jpeg|svg|webp|pdf)$/.test(lower)) return 'plot';
  if (/\.(csv|tsv|xlsx?)$/.test(lower)) return 'table';
  if (/\.json$/.test(lower)) return 'json';
  if (/\.(txt|log|md)$/.test(lower)) return 'text';
  return 'file';
}

function _normalizeArtifact(item, resultDir, index, canonicalizePath = null) {
  const filename = item && (item.filename || item.name || item.path);
  if (!filename) return null;
  const name = path.basename(String(filename));
  const type = _inferArtifactType(item, name);
  const label =
    (item && (item.label || item.title || item.description)) ||
    name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
  const artifact = {
    id: item && item.id ? String(item.id) : `artifact_${index + 1}`,
    name,
    filename: name,
    type,
    title: String(label),
    label: String(label),
    path: path.join(resultDir, name),
    preview: ['plot', 'table', 'text', 'json'].includes(type),
    download: true,
  };
  if (typeof canonicalizePath === 'function')
    artifact.canonicalPath = canonicalizePath(artifact.path);
  if (item && item.role) artifact.role = String(item.role);
  if (item && item.mime) artifact.mime = String(item.mime);
  return artifact;
}

function _normalizeArtifacts({ manifestItems, outFiles, resultDir, canonicalizePath = null }) {
  const sourceItems = [];
  for (const item of manifestItems || []) sourceItems.push(item);
  const knownNames = new Set(
    sourceItems
      .map((item) => path.basename(String(item && (item.filename || item.name || item.path || ''))))
      .filter(Boolean)
  );
  for (const file of outFiles || []) {
    if (!knownNames.has(file)) sourceItems.push({ name: file });
  }
  return sourceItems
    .map((item, index) => _normalizeArtifact(item, resultDir, index, canonicalizePath))
    .filter(Boolean);
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
function _runPluginScript(
  plugin,
  scriptPath,
  args,
  userId = 'agent',
  projectId = null,
  existingToolJobId = null
) {
  return new Promise((resolve) => {
    // Phase 3: 先创建/准备正式 tool_job，再以 tool_job.id 创建物理目录。
    // 方案 C（agent-led Task 1）：跑前建 tool_jobs 记录，跑完更新状态。
    // user_id 用调用方传入的 userId（agent 登录态下跑 = 真实用户 id，
    // 这样用户能在 history 看到、open_result 能按 jobId 加载）。
    let toolJobId = existingToolJobId || null;
    if (db) {
      try {
        const job = existingToolJobId
          ? db.prepareToolJobForRun(existingToolJobId, {
              params: args,
              name: `${plugin.id} via agent`,
            })
          : db.createToolJob({
              toolId: plugin.id,
              userId,
              params: args,
              status: 'running',
              name: `${plugin.id} via agent`,
              projectId,
            });
        toolJobId = job && job.id;
      } catch (e) {
        console.warn('[mcp-registry] prepare/create toolJob failed:', e.message);
      }
    }

    // Phase 3: 以 tool_job.id 作为物理目录主键（项目沙盒或全局 tool-jobs）。
    let jobDir;
    let outputDir;
    try {
      const layout = _resolveMcpJobLayout({ toolJobId, projectId, userId });
      jobDir = layout.jobDir;
      outputDir = layout.outputDir;
    } catch (e) {
      // 有 projectId 但解析失败（不存在/归档/无权限/不可写）→ 硬失败，不静默写全局。
      const errText = `执行失败: 项目结果目录解析失败: ${e.message}`;
      console.warn('[mcp-registry] resolveProjectRunLayout failed:', e.message);
      if (db && toolJobId) {
        try {
          db.updateToolJob(toolJobId, {
            status: 'failed',
            error: errText,
            completedAt: Date.now(),
          });
          if (plans) plans.syncPlanStepStatusFromToolJob(toolJobId, 'failed', errText);
        } catch {}
      }
      return resolve({
        content: [{ type: 'text', text: errText }],
        isError: true,
        toolJobId,
      });
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

    // Keep report generation identical to the HTTP executor: plugin report
    // templates are copied into the isolated job directory under the stable
    // name consumed by tool scripts.
    const reportTemplate = path.join(plugin.pluginDir, plugin.id + '-report-template.html');
    if (fs.existsSync(reportTemplate)) {
      fs.copyFileSync(reportTemplate, path.join(jobDir, 'report-template.html'));
    }

    // 3. 构造执行命令（local 模式）
    const { getExecutor } = require(path.join(SHARED_BACKEND, 'executors'));
    const executor = getExecutor(plugin.language);
    const runtimeReady =
      executor && executor.binPath
        ? { runtime: plugin.language || null, ready: true, command: executor.binPath, reason: null }
        : {
            runtime: plugin.language || null,
            ready: false,
            command: null,
            reason: `未找到 ${plugin.language || 'unknown'} 执行器`,
          };
    const { context: initialExecutionContext, canonicalizePath } = _createMcpExecutionContext({
      jobDir,
      outputDir,
      runtime: plugin.language || null,
      runtimeCommand: executor && executor.binPath,
      runtimeReady,
    });
    if (!runtimeReady.ready) {
      const errText = `执行失败: ${runtimeReady.reason}`;
      if (db && toolJobId) {
        try {
          db.updateToolJob(toolJobId, {
            status: 'failed',
            error: errText,
            resultJson: {
              toolJobId,
              jobDir,
              outputDir,
              canonicalJobDir: canonicalizePath(jobDir),
              canonicalOutputDir: canonicalizePath(outputDir),
              execution: initialExecutionContext,
              tool: {
                id: plugin.id,
                version: plugin.version || null,
                language: plugin.language || null,
              },
            },
            completedAt: Date.now(),
          });
          if (plans) plans.syncPlanStepStatusFromToolJob(toolJobId, 'failed', errText);
        } catch (e) {
          console.warn('[mcp-registry] updateToolJob(runtime failed) failed:', e.message);
        }
      }
      return resolve({
        content: [{ type: 'text', text: errText }],
        isError: true,
        _jobDir: jobDir,
        toolJobId,
      });
    }
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
              .readdirSync(resultDir, { withFileTypes: true })
              .filter(
                (entry) =>
                  entry.isFile() &&
                  ![
                    'params.json',
                    'run-script.R',
                    'run-script.py',
                    '_biof3-theme.R',
                    'report-template.html',
                  ].includes(entry.name)
              )
              .map((entry) => entry.name)
          : [];
        const { context: executionContext } = _createMcpExecutionContext({
          jobDir,
          outputDir,
          resultDir,
          runtime: plugin.language || null,
          runtimeCommand: executor && executor.binPath,
          runtimeReady,
        });
        const artifacts = _normalizeArtifacts({
          manifestItems,
          outFiles,
          resultDir,
          canonicalizePath,
        });
        const rawSummary = {
          toolJobId,
          jobDir,
          outputDir,
          resultDir,
          canonicalJobDir: canonicalizePath(jobDir),
          canonicalOutputDir: canonicalizePath(outputDir),
          canonicalResultDir: canonicalizePath(resultDir),
          execution: executionContext,
          tool: {
            id: plugin.id,
            version: plugin.version || null,
            language: plugin.language || null,
          },
          artifactSchemaVersion: 1,
          artifacts,
          outputs: manifestItems.map((o) => ({
            ...o,
            path: path.join(resultDir, o.filename || o.name || ''),
            canonicalPath: canonicalizePath(path.join(resultDir, o.filename || o.name || '')),
          })),
          files: artifacts.map((artifact) => ({
            name: artifact.name,
            filename: artifact.filename,
            type: artifact.type,
            label: artifact.label,
            title: artifact.title,
            path: artifact.path,
            canonicalPath: artifact.canonicalPath,
          })),
          manifest: manifest,
          stdout: (stdout || '').slice(-2000),
        };
        const toolDefinition = pluginLoader.getToolDefinition(plugin.id) || {};
        const truth = reconcileArtifactTruth({
          result: rawSummary,
          resultDir,
          expectedArtifacts: Array.isArray(toolDefinition.outputs) ? toolDefinition.outputs : [],
          canonicalizePath,
        });
        const summary = truth.result;
        if (truth.blocking) {
          const truthError =
            truth.issues
              .filter((issue) => issue.severity === 'error')
              .map((issue) => issue.message)
              .join('; ') || 'Required result artifacts are missing.';
          if (db && toolJobId) {
            try {
              db.updateToolJob(toolJobId, {
                status: 'failed',
                error: truthError,
                resultJson: summary,
                completedAt: Date.now(),
              });
              if (plans) plans.syncPlanStepStatusFromToolJob(toolJobId, 'failed', truthError);
            } catch (e) {
              console.warn(
                '[mcp-registry] updateToolJob(artifact validation failed) failed:',
                e.message
              );
            }
          }
          return resolve({
            content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
            isError: true,
            _jobDir: jobDir,
            toolJobId,
          });
        }
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
  try {
    refreshPluginSources();
  } catch (e) {
    console.warn('[mcp-registry] refresh plugins before callTool failed:', e.message);
  }
  // opts.userId：归属用户（agent 在登录态下跑，写进 tool_jobs.user_id，
  // 这样用户能在 history 看到、open_result 能按 jobId 加载结果）。
  // 兜底 'agent'（无用户上下文，如 MCP 直连场景）。
  const userId = (opts && opts.userId) || 'agent';
  const projectId = (opts && opts.projectId) || null;
  const toolJobId = (opts && opts.toolJobId) || null;
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
    return _runPluginScript(plugin, scriptPath, args, userId, projectId, toolJobId);
  }

  // 单细胞步骤（STEP_META）已移除：其异步 task-queue/OSS 引擎属于旧 web 产线，
  // 不契合本地 agent 模型；工作流稳定后将重写。这些工具不再暴露，调用按未知工具处理。

  return {
    content: [{ type: 'text', text: `unknown_tool: ${name}` }],
    isError: true,
  };
}

module.exports = {
  listTools,
  callTool,
  _test: {
    canonicalizePath: _canonicalizePath,
    createMcpExecutionContext: _createMcpExecutionContext,
    normalizeArtifacts: _normalizeArtifacts,
    resolveMcpJobLayout: _resolveMcpJobLayout,
    GLOBAL_JOBS_DIR,
  },
};

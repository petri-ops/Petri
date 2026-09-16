/**
 * biof3-server/mcp/registry.js — MCP 统一工具注册表（产线合一）
 *
 * 断点2（A1）：从 desktop-app/src/mcp-tool-registry.js 下沉到 biof3-server/mcp/，
 * 斩断 biof3-server/agent-tools/learning.js → desktop-app/src/mcp-tool-registry 的反向引用。
 * desktop-app/src/mcp-server.js 改 require 本文件（dev: ../../biof3-server/mcp/registry）。
 *
 * 通过单一 listTools()/callTool() 接口暴露插件工具，所有执行统一进入
 * run_tool → tool_job → artifact truth 事实链。
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
// BLOCK-57 — 会话执行目标 → 插件远程直跑（设计评审 D1-D9；同步预算 ≤300s 与本地插件语义一致）
const { createRemoteJobRunner, AGENT_SCRIPT_HASH } = require('../helpers/remote-execution/remote-job-runner');
const { createTargetRegistry } = require('../helpers/remote-execution/target-registry');
const { runSshOp, remoteJobDirPath } = require('../helpers/remote-execution/ssh-transport');
const { remoteAgentCommand } = require('../helpers/remote-execution/node-agent');
const {
  captureStagedInputSnapshots,
  isInternalArtifactName,
  isSafeFlatFilename,
  reconcileArtifactTruth,
} = require('../helpers/artifact-truth');
const { checkAllowedDownstream } = require('../agent-tools/agent-tool-policy');
const { createResultArchive } = require('../helpers/result-archive');
const { createExecutionContext } = require('../../shared-backend/execution-context');
const { resolveProjectRunLayout } = require('../../shared-backend/project-run-layout');
const { createExecutionProvenance, attachProvenanceToResult } = require('../../shared-backend/execution-provenance');
const { collectExecutionInputs, writeArtifactManifest } = require('../../shared-backend/artifact-manifest');
const { validateToolArgs, McpValidationError } = require('./_validate-tool-args');

// Skill Registry & Runtime 导入（延迟加载避免循环依赖）
let _skillRegistry = null;
let _skillRuntimeFactory = null;
function getSkillRegistry() {
  if (!_skillRegistry) {
    try {
      const { SkillRegistry } = require('../../shared-backend/skill-registry');
      _skillRegistry = new SkillRegistry();
    } catch (e) {
      console.warn('[mcp-registry] SkillRegistry require failed:', e.message);
      return null;
    }
  }
  return _skillRegistry;
}
function getSkillRuntimeFactory() {
  if (!_skillRuntimeFactory) {
    try {
      const { createSkillRuntime } = require('../../shared-backend/skill-runtime');
      _skillRuntimeFactory = createSkillRuntime;
    } catch (e) {
      console.warn('[mcp-registry] SkillRuntime require failed:', e.message);
      return null;
    }
  }
  return _skillRuntimeFactory;
}

// ── Skill MCP 工具定义 ────────────────────────────────────────────────────────

/**
 * Skill 相关 MCP 工具列表
 */
function getSkillToolDefinitions() {
  return [
    {
      name: 'skill_discover',
      description: 'Discover and list all available Skills in the system. Supports filtering by category, source, and search keyword.',
      inputSchema: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            description: 'Filter by skill category (e.g., "bioinformatics", "visualization")',
          },
          source: {
            type: 'string',
            enum: ['built-in', 'installed', 'marketplace'],
            description: 'Filter by skill source',
          },
          search: {
            type: 'string',
            description: 'Search keyword to match against skill name, description, or tags',
          },
        },
      },
    },
    {
      name: 'skill_get',
      description: 'Get detailed information about a specific Skill including its prompts, parameters, and capabilities.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Skill ID (e.g., "bioinformatics-sequence-analysis")',
          },
        },
        required: ['id'],
      },
    },
    {
      name: 'skill_execute',
      description: 'Execute a Skill with given parameters. Returns execution result including artifacts and outputs.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Skill ID to execute',
          },
          params: {
            type: 'object',
            description: 'Execution parameters matching the Skill\'s parameter schema',
          },
          context: {
            type: 'object',
            description: 'Execution context (user context, workflow variant, etc.)',
            properties: {
              workflowName: { type: 'string', description: 'Workflow variant to execute' },
              userContext: { type: 'object', description: 'User context information' },
            },
          },
        },
        required: ['id'],
      },
    },
  ];
}

/**
 * Skill discover 实现
 */
async function _skillDiscover(args = {}) {
  const registry = getSkillRegistry();
  if (!registry) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: 'SkillRegistry not available' }) }],
      isError: true,
    };
  }

  try {
    let skills = registry.discover();

    // 按 source 过滤
    if (args.source) {
      skills = skills.filter(s => s.source === args.source);
    }

    // 按 category 过滤
    if (args.category) {
      const cat = args.category.toLowerCase();
      skills = skills.filter(s =>
        s.category.toLowerCase() === cat ||
        s.category.toLowerCase().startsWith(cat + '/')
      );
    }

    // 按 search 关键词过滤
    if (args.search) {
      const q = args.search.toLowerCase();
      skills = skills.filter(s =>
        s.id.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.tags.some(tag => tag.toLowerCase().includes(q))
      );
    }

    // 返回不含 prompts 详情的列表
    const result = skills.map(skill => ({
      id: skill.id,
      name: skill.name,
      version: skill.version,
      source: skill.source,
      category: skill.category,
      tags: skill.tags,
      description: skill.description,
      capabilities: skill.capabilities,
      plugins: skill.plugins,
      parameters: {
        required: skill.parameters.required,
        optional: Object.keys(skill.parameters.optional),
      },
      outputs: skill.outputs,
      metadata: skill.metadata,
    }));

    return {
      content: [{ type: 'text', text: JSON.stringify({ skills: result, total: result.length }, null, 2) }],
      isError: false,
    };
  } catch (e) {
    console.error('[mcp-registry] skill_discover error:', e);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: e.message }) }],
      isError: true,
    };
  }
}

/**
 * Skill get 实现
 */
async function _skillGet(args = {}) {
  const registry = getSkillRegistry();
  if (!registry) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: 'SkillRegistry not available' }) }],
      isError: true,
    };
  }

  try {
    const skill = registry.get(args.id);
    if (!skill) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Skill not found: ${args.id}` }) }],
        isError: true,
      };
    }

    // 返回完整信息（含 prompts）
    return {
      content: [{ type: 'text', text: JSON.stringify(skill, null, 2) }],
      isError: false,
    };
  } catch (e) {
    console.error('[mcp-registry] skill_get error:', e);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: e.message }) }],
      isError: true,
    };
  }
}

/**
 * Skill execute 实现
 */
async function _skillExecute(args = {}) {
  const registry = getSkillRegistry();
  const createRuntime = getSkillRuntimeFactory();
  if (!registry || !createRuntime) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: 'Skill runtime not available' }) }],
      isError: true,
    };
  }

  try {
    const skill = registry.get(args.id);
    if (!skill) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Skill not found: ${args.id}` }) }],
        isError: true,
      };
    }

    // 创建 SkillRuntime 实例
    const runtime = createRuntime(skill, {
      registry,
    });

    // 执行
    const result = await runtime.execute(args.params || {}, {
      workflowName: args.context?.workflowName,
      userContext: args.context?.userContext,
    });

    // 返回执行结果
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      isError: result.status === 'failed',
    };
  } catch (e) {
    console.error('[mcp-registry] skill_execute error:', e);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: e.message }) }],
      isError: true,
    };
  }
}

// 路径解析（dev/pack 两种模式）
// 下沉后 biof3-server 自己 require 自己，路径变简单：
//   dev: __dirname = biof3-server/mcp → resolveRSserver = biof3-server 根
//   pack: biof3-server 在 resources/biof3-server，__dirname = resources/biof3-server/mcp → resolveRSserver = resources/biof3-server
function resolveRSserver() {
  // dev 模式：biof3-server/mcp/ → biof3-server 根
  const devPath = path.resolve(__dirname, '..');
  try {
    require('fs').accessSync(path.join(devPath, 'plugin-loader.js'));
    return devPath;
  } catch {
    // 打包模式：biof3-server 在 resources/biof3-server 下
    return path.join(process.resourcesPath || '', 'biof3-server');
  }
}

function resolveSharedBackend() {
  // dev 模式：biof3-server/mcp/ → 仓库根/shared-backend
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
const { resolveRLibsForPlugin } = require(path.join(SHARED_BACKEND, 'r-libs-resolver.js'));
const { ensureBundlesForPlugin } = require(path.join(SHARED_BACKEND, 'capability-bundles.js'));
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
// 桌面版 mcp-server 子进程跑本文件，不经 biof3-server/server.js 的注入，必须自己注入。
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
// 失败不致命（无 installed.json = 没装过插件，正常），built-in 插件仍会在下方加载。
try {
  pluginLoader.loadPluginsFromDisk();
} catch (e) {
  console.warn('[mcp-registry] loadPluginsFromDisk failed:', e.message);
}

// 自动发现 built-in 插件（resources/built-in-plugins/），不依赖 install。
// 让外部 agent 即使没装任何插件也能看到/调用 built-in 工具（volcano-plot 等）。
// 已装版本优先（loadBuiltInPlugins 内部去重）。
function resolveBuiltInPluginsDir() {
  if (process.env.BIOF3_BUILT_IN_PLUGINS_DIR) {
    return path.resolve(process.env.BIOF3_BUILT_IN_PLUGINS_DIR);
  }
  // 去 submodule 后：core 直接内嵌在 desktop 仓根 core/ 下，built-in-plugins 在 desktop 仓根 resources/
  // biof3-server/mcp/ → biof3-server → core → desktop 仓根 → resources/built-in-plugins/
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
  // BLOCK-84：已装领域包源并入每次刷新（pack-registry 记录制；零包=零追加）
  const packSources = [];
  try {
    const dataDir = process.env.BIOF3_LOCAL_DATA_DIR;
    if (dataDir) {
      const packRegistry = require('../../shared-backend/pack-registry');
      for (const installedPack of packRegistry.readInstalledPacks(dataDir)) {
        const packPluginsDir = path.join(installedPack.packRoot, 'plugins');
        if (fs.existsSync(path.join(packPluginsDir, 'installed.json'))) {
          packSources.push({ type: 'installed', root: packPluginsDir });
        }
      }
    }
  } catch (e) {
    console.warn('[mcp-registry] pack sources read failed:', e.message);
  }
  const sources = [
    { type: 'builtin', root: builtInDir },
    { type: 'installed', root:
      process.env.BIOF3_PLUGINS_DIR ||
      path.join(os.homedir(), 'Documents', 'BioF3-Local', 'plugins') },
    ...developmentDirs.map((root) => ({ type: 'development', root })),
    ...packSources,
  ];
  return pluginLoader.loadFromSourcesArray(sources);
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
    localRoot: localRoot || _localRootFromEnv(),
    canonicalRoot: canonicalRoot || _canonicalRootFromEnv(),
  });
}

/**
 * IDE MCP 工具分发（Phase 1：文件 + 终端）。
 * 加载失败时降级到 unknown_tool 形式。
 */
async function _callIdeTool(name, args) {
  try {
    const { callIdeTool } = require('./ide-tools');
    const result = await callIdeTool(name, args || {});
    // 把内部 { ok, ... } 输出转换为 MCP 标准 { content, isError }
    const text = JSON.stringify(result);
    return {
      content: [{ type: 'text', text }],
      isError: result && result.ok === false,
    };
  } catch (e) {
    return {
      content: [{ type: 'text', text: `ide_tool_error: ${e.message}` }],
      isError: true,
    };
  }
}

/**
 * MCP Resources（Phase 1.5）— IDE 资源入口。
 * - listIdeMcpResources(): 给 MCP resources/list 用
 * - readIdeMcpResource(uri): 给 MCP resources/read 用
 */
function listIdeMcpResources() {
  try {
    const { listIdeResources } = require('./ide-tools');
    return listIdeResources();
  } catch (e) {
    console.warn('[mcp-registry] IDE resources list failed:', e.message);
    return [];
  }
}

function readIdeMcpResource(uri) {
  try {
    const { readIdeResource } = require('./ide-tools');
    return readIdeResource(uri);
  } catch (e) {
    return { ok: false, error: `ide_resource_error: ${e.message}` };
  }
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

  // 合并插件工具、Skill 工具与 IDE MCP 工具
  const pluginTools = pluginLoader.listToolsForMCP();
  const skillTools = getSkillToolDefinitions();
  const ideTools = getIdeToolDefinitionsSafe();
  return [...skillTools, ...ideTools, ...pluginTools];
}

// IDE 工具加载封装：失败时降级为空数组（不阻塞 listTools）
let _ideTools = null;
function getIdeToolDefinitionsSafe() {
  if (_ideTools !== null) return _ideTools;
  try {
    const { getIdeToolDefinitions } = require('./ide-tools');
    _ideTools = getIdeToolDefinitions();
  } catch (e) {
    console.warn('[mcp-registry] IDE tools load failed:', e.message);
    _ideTools = [];
  }
  return _ideTools;
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

function _resolveStagedInputPath(jobDir, inputId, sourcePath) {
  const id = typeof inputId === 'string' ? inputId.trim() : '';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || !isSafeFlatFilename(id)) {
    return { ok: false, error: 'plugin_input_id_unsafe' };
  }
  const extension = typeof sourcePath === 'string' ? path.extname(sourcePath) : '';
  const name = `${id}${extension}`;
  if (!isSafeFlatFilename(name) || isInternalArtifactName(name)) {
    return { ok: false, error: 'plugin_input_name_reserved' };
  }
  const root = path.resolve(jobDir);
  const stagedPath = path.resolve(root, name);
  if (path.dirname(stagedPath) !== root) {
    return { ok: false, error: 'plugin_input_path_escaped' };
  }
  return { ok: true, name, stagedPath };
}

/**
 * 执行插件 R 脚本（local 模式）。
 * 复刻 biof3-server/helpers/tools-executor.js:384-407 的执行约定：
 *   - R 工具脚本约定 commandArgs(trailingOnly=TRUE)[1] = job_dir
 *   - 不用 buildSpawnCommand（那是 figcode 的 --args params.json 约定）
 *   - 调用方写 jobDir/params.json，脚本 setwd(jobDir) 后 fromJSON 读
 *   - 插件包注入 R_LIBS_USER（pluginDir/packages/r 优先）
 *   - 结果读 jobDir/manifest.json（脚本写）+ 列 jobDir 下输出文件
 */
async function _runPluginScript(
  plugin,
  scriptPath,
  args,
  userId = 'agent',
  projectId = null,
  existingToolJobId = null,
  resultStudioInputLineage = null,
  conversationId = null
) {
  // Stage 3 B2 part2: auto-provision required capability bundle(s) before
  // assembling R_LIBS_USER, so a freshly-downloaded bundle is visible to the
  // resolveRLibsForPlugin readiness check below. Best-effort only: an
  // unpublished/unknown bundle (or any provisioning failure) MUST NOT fail the
  // job — resolveRLibsForPlugin simply won't find the lib and we run on the
  // base runtime, identical to today's behavior.
  if (plugin && plugin.language === 'r' && plugin.requiresBundle) {
    try {
      const ensureResult = await ensureBundlesForPlugin(plugin);
      if (ensureResult && !ensureResult.ok) {
        console.warn(
          `[mcp-registry] capability bundle(s) not ready for ${plugin.id}, running on base runtime:`,
          JSON.stringify(ensureResult.results)
        );
      }
    } catch (e) {
      console.warn(`[mcp-registry] ensureBundlesForPlugin failed for ${plugin.id}:`, e.message);
    }
  }
  return new Promise((resolve) => {
    // Phase 3: 先创建/准备正式 tool_job，再以 tool_job.id 创建物理目录。
    // 方案 C（agent-led Task 1）：跑前建 tool_jobs 记录，跑完更新状态。
    // user_id 用调用方传入的 userId（agent 登录态下跑 = 真实用户 id，
    // 这样用户能在 history 看到，客户端能按 jobId 加载）。
    let toolJobId = existingToolJobId || null;
    if (db) {
      try {
        if (existingToolJobId) {
          const existing = typeof db.getToolJob === 'function' ? db.getToolJob(existingToolJobId) : null;
          const existingProjectId = existing && (existing.project_id || existing.projectId || null);
          const existingConversationId = existing && (existing.conversation_id || existing.conversationId || null);
          const existingUserId = existing && (existing.user_id || existing.userId || null);
          if (!existing
              || existingUserId !== userId
              || (existing.tool_id || existing.toolId) !== plugin.id
              || existingProjectId !== (projectId || null)
              || existingConversationId !== (conversationId || null)) {
            throw new Error('tool_job_identity_mismatch');
          }
        }
        const job = existingToolJobId
          ? db.prepareToolJobForRun(existingToolJobId, {
              toolName: plugin.id,
              projectId,
              conversationId,
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
              conversationId,
            });
        if (!job || !job.id) throw new Error('tool_job_create_failed');
        toolJobId = job && job.id;
      } catch (e) {
        console.warn('[mcp-registry] prepare/create toolJob failed:', e.message);
        const failureLabel = existingToolJobId ? '身份校验失败' : '持久化校验失败';
        return resolve({
          content: [{ type: 'text', text: `执行失败: tool_job ${failureLabel}: ${e.message}` }],
          isError: true,
          ...(existingToolJobId ? { toolJobId: existingToolJobId } : {}),
        });
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

    // 1. 写 params.json（脚本从 args[1]=jobDir 读它）。
    // BLOCK-57：executionTargetId 为会话保留键（composer/模型显式指定），剥离后
    // 不进脚本参数面；仅在远程分派分支消费。
    const sessionExecutionTargetId = args && typeof args.executionTargetId === 'string' && args.executionTargetId.trim()
      ? args.executionTargetId.trim()
      : null;
    const scriptParams = { ...(args || {}) };
    if (sessionExecutionTargetId) delete scriptParams.executionTargetId;
    fs.writeFileSync(path.join(jobDir, 'params.json'), JSON.stringify(scriptParams));

    // 1b. file 类型输入：复制文件到 jobDir/<input_id>。
    // BioF3 工具脚本有两种读文件约定：
    //   (a) volcano-plot: 从 params$deg_table 读绝对路径
    //   (b) deseq2: list.files(job_dir, pattern="^counts") 在 jobDir 找文件
    // 为兼容两者，file input 既保留在 params（路径），又复制到 jobDir/<id>。
    // 复刻 tools-executor.js:572-578 的 files 写入约定（文件名 = input id）。
    const toolDef = pluginLoader.getToolDefinition(plugin.id);
    const stagedInputFiles = [];
    if (toolDef && Array.isArray(toolDef.inputs)) {
      for (const inp of toolDef.inputs) {
        if (inp.type !== 'file' || !inp.id) continue;
        const srcPath = args && args[inp.id];
        if (typeof srcPath !== 'string' || !fs.existsSync(srcPath)) continue;
        // 文件名 = input id（+ 原扩展名），deseq2 的 list.files("^counts") 才能命中。
        // Descriptor id is still untrusted plugin data, so contain it before writing.
        const staged = _resolveStagedInputPath(jobDir, inp.id, srcPath);
        if (!staged.ok) {
          const errText = `执行失败: 插件文件输入定义无效 (${staged.error})`;
          if (db && toolJobId) {
            try {
              db.updateToolJob(toolJobId, {
                status: 'failed',
                error: errText,
                completedAt: Date.now(),
              });
            } catch {}
          }
          return resolve({
            content: [{ type: 'text', text: errText }],
            isError: true,
            toolJobId,
          });
        }
        fs.copyFileSync(srcPath, staged.stagedPath);
        stagedInputFiles.push(staged.stagedPath);
      }
    }
    let stagedInputSnapshots;
    try {
      stagedInputSnapshots = captureStagedInputSnapshots(stagedInputFiles);
    } catch (error) {
      const errText = `执行失败: 暂存输入快照失败 (${error.message})`;
      if (db && toolJobId) {
        try {
          db.updateToolJob(toolJobId, {
            status: 'failed',
            error: errText,
            completedAt: Date.now(),
          });
        } catch {}
      }
      return resolve({
        content: [{ type: 'text', text: errText }],
        isError: true,
        toolJobId,
      });
    }

    // 2. 复制脚本到 jobDir（run-script.R），避免污染插件原脚本目录
    const scriptExt = plugin.language === 'r' ? '.R' : '.py';
    const runScript = path.join(jobDir, 'run-script' + scriptExt);
    fs.copyFileSync(scriptPath, runScript);

    // 2b. R 工具：复制 _biof3-theme.R 到 jobDir（脚本顶部 source 它）。
    // 复刻 tools-executor.js:361-374：插件脚本目录优先（build-plugin.sh 已复制），
    // 其次 biof3-server/tool-scripts/。漏这步会导致 source("_biof3-theme.R") 找不到文件。
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
    const runtimeVersion = runtimeReady.ready && typeof executor.getRuntimeVersion === 'function'
      ? executor.getRuntimeVersion()
      : null;
    const { context: initialExecutionContext, canonicalizePath } = _createMcpExecutionContext({
      jobDir,
      outputDir,
      runtime: plugin.language || null,
      runtimeCommand: executor && executor.binPath,
      runtimeReady,
    });
    const provenanceFor = ({ artifacts = [], command = null, startedAt: provenanceStartedAt = null, completedAt = new Date().toISOString() } = {}) => {
      const scientificTask = db && toolJobId && typeof db.getScientificTaskByToolJob === 'function'
        ? db.getScientificTaskByToolJob(toolJobId)
        : null;
      const provenance = createExecutionProvenance({
        toolJobId,
        projectId,
        scientificTask,
        plugin: pluginLoader.getPluginManifest(plugin.id) || plugin,
        params: args || {},
        inputs: collectExecutionInputs({
          inputDefinitions: toolDef && Array.isArray(toolDef.inputs) ? toolDef.inputs : [],
          params: args || {},
          jobDir,
          inputLineage: resultStudioInputLineage,
        }),
        runtime: { name: plugin.language || null, command: executor && executor.binPath, version: runtimeVersion, ready: runtimeReady.ready },
        runScriptPath: runScript,
        command,
        artifacts,
        startedAt: provenanceStartedAt,
        completedAt,
      });
      const provenancePath = path.join(jobDir, 'provenance.json');
      fs.writeFileSync(provenancePath, JSON.stringify(provenance, null, 2));
      return { provenance, provenancePath };
    };
    if (!runtimeReady.ready) {
      const errText = `执行失败: ${runtimeReady.reason}`;
      const failedProvenance = provenanceFor();
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
              failure: { phase: 'runtime', reason: runtimeReady.reason },
              executionProvenance: failedProvenance.provenance,
              provenanceRef: { provenanceHash: failedProvenance.provenance.provenanceHash, path: failedProvenance.provenancePath, toolJobId },
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
      // 插件包注入 R_LIBS_USER（provisioned bundle → pluginDir/packages/r → R home）。
      // 三段式组装逻辑抽到 shared-backend/r-libs-resolver.js（与 tools-executor.js 共用）。
      const resolvedEnv = resolveRLibsForPlugin(plugin);
      if (resolvedEnv) runEnv = resolvedEnv;
    } else {
      // Harness Python 插件与 R 插件统一使用第一个位置参数传 job_dir。
      // 旧的 --params 约定属于 FigCode/非插件执行，不得混入插件协议。
      runCmd = [executor.binPath, runScript, jobDir];
      const spawnCmd = executor.buildSpawnCommand(runScript, jobDir, args || {});
      if (spawnCmd.env) runEnv = spawnCmd.env;
    }

    // 4. 执行 — BLOCK-10 S-001: enforce plugin → downstream side-effect
    // policy at the execFile boundary. Plugins may only spawn their
    // declared runner (Rscript / python); chaining into `shell` is
    // refused here so a malicious plugin cannot bypass commandVerdict.
    const downstream = plugin && plugin.language === 'r'
      ? 'r-runner'
      : (plugin && plugin.language === 'python') ? 'python-runner' : 'shell';
    if (!checkAllowedDownstream({ allowedDownstream: ['r-runner', 'python-runner'] }, downstream)) {
      return resolve({
        ok: false,
        error: 'policy_denied',
        message: 'Plugin execution path is not whitelisted for downstream side effects.',
      });
    }
    const startedAt = new Date().toISOString();
    // BLOCK-57：插件执行收尾统一入口——本地 execFile 与远程直跑共用同一条
    // 产物/清单/状态落库链路（Artifact Truth 单一真相）。
    const finalizePluginRun = async (err, stdout, stderr) => {
        if (err) {
          const errText = `执行失败: ${err.killed ? '超时（>300s）' : stderr || err.message}\n\nSTDOUT:\n${stdout || ''}`;
          const blockedManifestPath = [
            path.join(outputDir, 'artifact-manifest.json'),
            path.join(jobDir, 'artifact-manifest.json'),
          ].find((candidate) => fs.existsSync(candidate));
          let blockedManifest = null;
          if (blockedManifestPath) {
            try {
              const parsed = JSON.parse(fs.readFileSync(blockedManifestPath, 'utf8'));
              if (parsed && parsed.status === 'blocked') blockedManifest = parsed;
            } catch (manifestError) {
              console.warn('[mcp-registry] blocked artifact manifest parse failed:', manifestError.message);
            }
          }
          const failedProvenance = provenanceFor({
            command: { executable: runCmd[0], args: runCmd.slice(1), cwd: jobDir },
          });
          const structuredFailureMode = blockedManifest?.failureMode || null;
          const failureResult = {
            toolJobId,
            jobDir,
            outputDir,
            tool: { id: plugin.id, version: plugin.version || null, language: plugin.language || null },
            status: blockedManifest ? 'blocked' : 'failed',
            failureMode: structuredFailureMode,
            manifest: blockedManifest,
            failure: {
              phase: blockedManifest ? 'plugin_validation' : 'execution',
              reason: structuredFailureMode || (err.killed ? 'timeout' : 'nonzero_exit'),
              exitCode: err.code ?? null,
              stderr: String(stderr || '').slice(-2000),
              stdout: String(stdout || '').slice(-2000),
            },
            executionProvenance: failedProvenance.provenance,
            provenanceRef: { provenanceHash: failedProvenance.provenance.provenanceHash, path: failedProvenance.provenancePath, toolJobId },
          };
          // 失败：更新 tool_jobs 状态
          if (db && toolJobId) {
            try {
              db.updateToolJob(toolJobId, {
                status: 'failed',
                error: errText,
                resultJson: failureResult,
                completedAt: Date.now(),
              });
              // 同步 plan step 状态（方案 C，agent-led Task 2）
              if (plans) plans.syncPlanStepStatusFromToolJob(toolJobId, 'failed', errText);
            } catch (e) {
              console.warn('[mcp-registry] updateToolJob(failed) failed:', e.message);
            }
          }
          return resolve({
            content: [{ type: 'text', text: JSON.stringify(failureResult) }],
            isError: true,
            _jobDir: jobDir,
            toolJobId,
          });
        }
        // 5. 读 manifest.json + 列输出文件。
        // 产物位置有两种约定：(a) output/ 子目录（deseq2，tools-executor 标准）
        // (b) jobDir 根（volcano-plot 等独立插件脚本，setwd(jobDir) 后直接写）。
        // 先查 output/，再查 jobDir 根。
        const manifestCandidates = [
          path.join(outputDir, 'manifest.json'),
          path.join(outputDir, 'artifact-manifest.json'),
          path.join(jobDir, 'manifest.json'),
          path.join(jobDir, 'artifact-manifest.json'),
        ];
        const manifestPath = manifestCandidates.find((candidate) => fs.existsSync(candidate)) || manifestCandidates[0];
        const resultDir = path.dirname(manifestPath);
        const runtimeToolDefinition = pluginLoader.getToolDefinition(plugin.id) || {};
        const archiveArtifact = Array.isArray(runtimeToolDefinition.outputs)
          ? runtimeToolDefinition.outputs.find((item) => item && item.id === 'zip' && item.required !== false)
          : null;
        if (archiveArtifact) {
          try {
            await createResultArchive(
              resultDir,
              archiveArtifact.filename || archiveArtifact.name || 'all_results.zip'
            );
          } catch (archiveError) {
            return resolve({
              content: [{ type: 'text', text: `执行失败: 结果归档失败: ${archiveError.message}` }],
              isError: true,
              _jobDir: jobDir,
              toolJobId,
            });
          }
        }
        let manifest = null;
        try {
          if (fs.existsSync(manifestPath)) {
            manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
          }
        } catch {}
        // manifest 有两种格式：(a) {outputs:[{id,filename,...}]} (b) {files:[{name,type,...}]}
        const manifestItems = Array.isArray(manifest?.artifacts)
          ? manifest.artifacts
          : Array.isArray(manifest?.outputs)
            ? manifest.outputs
            : Array.isArray(manifest?.files)
              ? manifest.files
              : [];
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
        const toolDefinition = runtimeToolDefinition;
        const truth = reconcileArtifactTruth({
          result: rawSummary,
          resultDir,
          expectedArtifacts: Array.isArray(toolDefinition.outputs) ? toolDefinition.outputs : [],
          canonicalizePath,
          excludedArtifactPaths: stagedInputFiles,
          stagedInputSnapshots,
        });
        const successfulProvenance = provenanceFor({
          artifacts: truth.artifacts,
          command: { executable: runCmd[0], args: runCmd.slice(1), cwd: jobDir },
          startedAt,
        });
        const provenance = successfulProvenance.provenance;
        const provenancePath = successfulProvenance.provenancePath;
        const summary = attachProvenanceToResult(truth.result, provenance, provenancePath);
        writeArtifactManifest({
          outputDir: resultDir,
          result: summary,
          provenance,
          plugin: pluginLoader.getPluginManifest(plugin.id) || plugin,
        });
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
    };

    // BLOCK-57：会话执行目标 → 远程直跑。对话内插件工具的本地语义本就是同步
    // 执行（≤300s），远程沿用同一预算：提交 → 轮询节点真相 → 拉回对账 →
    // 共用收尾。超预算：尽力取消节点侧作业并诚实失败（不悬挂模型回合）。
    if (sessionExecutionTargetId) {
      return (async () => {
        // 远程分派前重写 file 型输入为 jobDir 内文件名（bundled copy 命名约定：
        // <input_id><原扩展名>，与 1b 拷贝步骤一致）。启发式：字符串参数值指向
        // 本机真实存在的文件 → 即为 bundled 输入（不依赖 tool-definition 声明，
        // 部分 插件 的 inputs 为空数组）。脚本侧 cwd=jobDir，绝对本地路径在节点上
        // 不存在（macOS 路径 ≠ Linux 路径）。
        try {
          const rewritten = { ...scriptParams };
          for (const [key, value] of Object.entries(rewritten)) {
            if (typeof value === 'string' && value.trim()) {
              try {
                if (path.isAbsolute(value) && fs.existsSync(value) && fs.statSync(value).isFile()) {
                  rewritten[key] = key + path.extname(value);
                }
              } catch {}
            }
          }
          fs.writeFileSync(path.join(jobDir, 'params.json'), JSON.stringify(rewritten));
        } catch (e) {
          console.warn('[mcp-registry] remote file-input rewrite failed:', e.message);
        }
        const remoteOutcome = await runPluginToolRemote({
          sessionExecutionTargetId,
          jobDir,
          plugin,
          language: plugin.language,
          toolJobId,
          startedAt,
          budgetMs: 280000,
          resolve,
          plans,
          outputDir,
        });
        // BLOCK-76 P3 — 直跑终态：ssh 作业 result_json 直记服务器真值（已由
        // runPluginToolSshDirect 持久化），不经本地 finalizePluginRun、无拉回。
        if (remoteOutcome.directSummary) {
          if (db && toolJobId) {
            try {
              db.updateToolJob(toolJobId, {
                status: 'completed',
                resultJson: remoteOutcome.directSummary,
                completedAt: Date.now(),
              });
              if (plans) plans.syncPlanStepStatusFromToolJob(toolJobId, 'completed');
            } catch (e) {
              console.warn('[mcp-registry] direct summary persistence failed:', e.message);
            }
          }
          resolve({
            content: [{ type: 'text', text: JSON.stringify(remoteOutcome.directSummary, null, 2) }],
            isError: false,
            _jobDir: jobDir,
            toolJobId,
          });
          return undefined;
        }
        const finalizeErr = remoteOutcome.err;
        await finalizePluginRun(finalizeErr, remoteOutcome.stdout, remoteOutcome.stderr);
        if (!finalizeErr && remoteOutcome.executionTarget) {
        try {
          const provPath = path.join(jobDir, 'provenance.json');
          if (fs.existsSync(provPath)) {
            const prov = JSON.parse(fs.readFileSync(provPath, 'utf8'));
            prov.executionTarget = remoteOutcome.executionTarget;
            fs.writeFileSync(provPath, JSON.stringify(prov, null, 2));
          }
          } catch (e) {
            console.warn('[mcp-registry] executionTarget provenance merge failed:', e.message);
          }
        }
        return undefined;
      })();
    }

    execFile(
      runCmd[0],
      runCmd.slice(1),
      { timeout: 300000, maxBuffer: 10 * 1024 * 1024, env: runEnv },
      async (err, stdout, stderr) => {
        await finalizePluginRun(err, stdout, stderr);
      }
    );
  });
}

/**
 * BLOCK-57 — 插件工具远程直跑（同步预算内）：部署 agent → 探测运行时 →
 * 上传 bundle → detached start → 轮询节点真相 → 拉回产物 + sha256 对账。
 * 返回与本地 execFile 同形的 (err, stdout, stderr) 三元组，交由共用收尾。
 */
async function runPluginToolRemote({ sessionExecutionTargetId, jobDir, plugin, language, toolJobId, startedAt, budgetMs, resolve, plans, outputDir }) {
  const failWith = (message) => ({ err: Object.assign(new Error(message), { code: 1 }), stdout: '', stderr: message });

  try {
    const dbModule = require('../db');
    const runner = createRemoteJobRunner();
    const registry = createTargetRegistry({ db: dbModule.getAsyncDatabase(), ensureAgent: (dep) => runner.ensureAgent({ alias: dep.alias }) });
    const target = await registry.getById({ id: sessionExecutionTargetId });
    if (!target) return failWith('执行目标不存在或已被移除');

    // BLOCK-76 P3/P5 — 作业归属 SSH 项目 → 直跑内核（产物留服务器 results/jobs/），
    // 终态由 runPluginToolSshDirect 直构 ssh 语义 summary 并持久化（directSummary 标记）。
    let sshProjectRow = null;
    try {
      sshProjectRow = dbModule.getAsyncDatabase()
        .prepare('SELECT p.id, p.workspace_kind, p.ssh_host, p.remote_path FROM projects p JOIN tool_jobs t ON t.project_id = p.id WHERE t.id = ?')
        .get(toolJobId) || null;
    } catch { /* project_id 为 null 时走退役分支 */ }
    if (sshProjectRow && sshProjectRow.workspace_kind === 'ssh' && sshProjectRow.ssh_host) {
      return await runPluginToolSshDirect({ sshProjectRow, jobDir, plugin, language, toolJobId, budgetMs, target, registry, runner, resolve, plans, outputDir });
    }

    // BLOCK-76 P5 — 非 SSH 项目的显式远程执行目标已随 BLOCK-57 作业机制退役：
    // 作业上传/产物拉回通道不复存在，远程算力统一走 SSH 项目（D7 自动钉定）。
    // BLOCK-96 F6 — 该分支只保留诚实失败守卫（历史远程目标行绝不落本地执行），
    // 冗余的 prepare().run 真值检查已清。
    try {
      dbModule.getAsyncDatabase().prepare('UPDATE tool_jobs SET status=?, error=? WHERE id=?')
        .run('failed', '远程执行目标已退役（BLOCK-76）：远程算力请创建 SSH 项目', toolJobId);
    } catch {}
    return failWith('远程执行目标已退役（BLOCK-76）：远程算力请创建 SSH 项目（执行面自动钉定节点）');
  } catch (error) {
    return failWith(`远程执行异常：${error.message}`);
  }
}

async function runPluginToolSshDirect({ sshProjectRow, jobDir, plugin, language, toolJobId, budgetMs, target, registry, runner: legacyRunner }) {
  const failWith = (message) => ({ err: Object.assign(new Error(message), { code: 1 }), stdout: '', stderr: message });
  const { createSshDirectRunner } = require('../helpers/remote-execution/ssh-direct-runner');
  try {
    const dbModule = require('../db');
    const runner = createSshDirectRunner({ project: sshProjectRow });
    // 运行时解析：复用 target registry 探测（与主链同源）
    const probe = await registry.probe({ id: target.id });
    if (!probe.ok) return failWith(`执行目标探测失败（${probe.error}）：${probe.detail || ''}`);
    const runtime = legacyRunner.resolveRuntime(probe.info, language);
    if (!runtime.ready) return failWith(`${runtime.reason}（目标 ${target.alias}）`);

    const jobId = 'rjob_' + String(toolJobId || ('t' + Date.now())).replace(/[^A-Za-z0-9._-]/g, '').slice(0, 40) + '_' + String(Date.now()).slice(-6);
    const staged = await runner.stage({ jobId, localJobDir: jobDir });
    if (!staged.ok) return failWith(`SSH 直跑编排面上传失败：${(staged.error && staged.error.detail) || ''}`);
    const started = await runner.start({ jobId, lang: language, runtimeBin: runtime.runtimeBin });
    if (!started.ok) return failWith(`SSH 直跑启动失败：${(started.error && started.error.detail) || ''}`);

    const deadline = Date.now() + budgetMs;
    let exit = null;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      exit = await runner.poll({ jobId, pid: started.pid });
      if (exit.kind === 'terminal') break;
    }
    if (!exit || exit.kind !== 'terminal') {
      await runner.cancel({ pid: started.pid }).catch(() => {});
      return failWith(`远程执行超出同步预算（${Math.round(budgetMs / 1000)}s）；已请求取消节点侧进程。长任务请拆分或使用异步路径（候选）。`);
    }
    const code = Number.isFinite(exit.code) ? exit.code : 1;

    let fullLog = '';
    try {
      fullLog = (await runner.pullLog({ jobId, offset: 0 })).chunk.toString('utf8');
    } catch {}

    const executionTarget = {
      kind: 'ssh-native',
      targetId: target.id,
      alias: target.alias,
      hostname: (probe.info && probe.info.hostname) || null,
      nodeOs: (probe.info && probe.info.os) || null,
      runtime: { name: language, version: runtime.version, command: runtime.runtimeBin },
      remoteJobDir: `results/jobs/${jobId}`,
      argmode: 'jobdir',
      agentVersion: AGENT_SCRIPT_HASH,
      transport: 'gateway-ssh-direct',
      environment: null,
    };
    if (language === 'r') {
      // BLOCK-76 P3 — provenance 环境留痕平移：服务器 R 包清单（gateway exec 采集）
      try {
        const gwResolved = require('../helpers/workspace-gateway').resolveWorkspaceBackend(sshProjectRow);
        if (gwResolved.backend) {
          const envRes = await gwResolved.backend.exec('Rscript -e "writeLines(rownames(installed.packages()))"', gwResolved.root, 90);
          if (envRes.code === 0 && envRes.stdout.trim()) {
            const crypto = require('crypto');
            const packagesText = envRes.stdout.trim();
            executionTarget.environment = {
              packagesCount: packagesText.split('\n').filter(Boolean).length,
              packagesSha256: crypto.createHash('sha256').update(packagesText).digest('hex'),
              packagesText,
            };
          }
        }
      } catch (e) {
        console.warn('[mcp-registry] ssh-direct renv capture failed:', e.message);
      }
    }
    const scriptErr = code !== 0
      ? Object.assign(new Error(`remote script exited ${code}`), { code })
      : null;

    // BLOCK-76 P3 — 直跑终态 summary：result_json 直记 ssh 语义，聊天卡经
    // /api/tools/file（Gateway 读面）取服务器产物，不再拉回本地（过渡拉回已拆除）。
    const outputs = await runner.listOutputs({ jobId }).catch(() => ({ ok: false, outputs: [] }));
    let manifest = null;
    try {
      const gwRead = require('../helpers/workspace-gateway').resolveWorkspaceBackend(sshProjectRow).backend;
      const mb = await gwRead.read(`results/jobs/${jobId}/output/manifest.json`);
      manifest = JSON.parse(mb.toString('utf8'));
    } catch {}
    const directSummary = {
      workspaceKind: 'ssh',
      ssh: { alias: target.alias, path: sshProjectRow.remote_path },
      outputPath: `results/jobs/${jobId}/output`,
      transport: 'gateway-ssh-direct',
      tool: { id: plugin.id, version: plugin.version || null, language: language || null },
      manifest: manifest || undefined,
      files: (outputs.ok ? outputs.outputs : []).map((f) => ({
        name: f.name,
        filename: f.name,
        type: f.name.endsWith('.png') ? 'plot' : f.name.endsWith('.csv') ? 'table' : 'file',
        url: `/api/tools/file/${encodeURIComponent(toolJobId)}/${encodeURIComponent(f.name)}`,
        size: f.size,
      })),
      stdout: String(fullLog || '').slice(-2000),
      executionTarget,
    };
    return {
      err: scriptErr,
      stdout: fullLog,
      stderr: '',
      executionTarget,
      directSummary,
    };
  } catch (error) {
    return failWith(`SSH 直跑异常：${error.message}`);
  }
}



/**
 * 执行已注册插件工具。
 * @returns {Promise<{content: Array, isError: boolean}>}
 */
function resolveResultStudioScriptOverride({ override, plugin, projectId, dbModule = db } = {}) {
  if (!projectId || !dbModule || typeof dbModule.getProject !== 'function') throw new Error('project_context_required');
  const project = dbModule.getProject(projectId);
  if (!project || !project.workspace_path) throw new Error('project_not_found');
  const changeSetId = String(override && override.changeSetId || '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(changeSetId)) throw new Error('change_set_id_invalid');

  const inputPath = String(override && override.path || '');

  // SEC-001: Symlink attack prevention - detect symlinks before realpathSync
  let lstat;
  try {
    lstat = fs.lstatSync(inputPath);
  } catch {
    throw new Error('materialized_script_not_accessible');
  }
  if (lstat.isSymbolicLink()) {
    throw new Error('materialized_script_symlink_rejected');
  }

  // SEC-001: Timeout-protected realpathSync using child_process with timeout
  const SAFE_REALPATH_TIMEOUT_MS = 5000;
  const { spawnSync } = require('child_process');

  // 路径必须经 argv 传递：内嵌进 -e 字符串时 Windows 反斜杠会被 JS 转义吃掉
  // （\1/\r/\t 等），realpath 在 Windows 上恒失败——ChangeSet 脚本桥整体不可用。
  const realpathResult = spawnSync(
    process.execPath,
    [
      '-e',
      "try{console.log(require('fs').realpathSync(process.argv[1]))}catch(e){process.exit(1)}",
      inputPath,
    ],
    { timeout: SAFE_REALPATH_TIMEOUT_MS, encoding: 'utf8' }
  );
  if (realpathResult.status !== 0 || realpathResult.error) {
    throw new Error('realpath_timeout');
  }
  const resolved = realpathResult.stdout.trim();

  // SEC-001: Path traversal validation after resolution
  const allowedRoot = path.join(project.workspace_path, '.biof3', 'revision', changeSetId);
  let allowedRootResolved;
  try {
    const allowedLstat = fs.lstatSync(allowedRoot);
    if (allowedLstat.isSymbolicLink()) {
      throw new Error('changeset_root_symlink_rejected');
    }
    const allowedRealpathResult = spawnSync(
      process.execPath,
      [
        '-e',
        "try{console.log(require('fs').realpathSync(process.argv[1]))}catch(e){process.exit(1)}",
        allowedRoot,
      ],
      { timeout: SAFE_REALPATH_TIMEOUT_MS, encoding: 'utf8' }
    );
    if (allowedRealpathResult.status !== 0 || allowedRealpathResult.error) {
      throw new Error('changeset_root_realpath_timeout');
    }
    allowedRootResolved = allowedRealpathResult.stdout.trim();
  } catch {
    throw new Error('changeset_root_not_accessible');
  }

  if (resolved !== allowedRootResolved && !resolved.startsWith(`${allowedRootResolved}${path.sep}`)) {
    throw new Error('materialized_script_outside_changeset');
  }
  const expectedExtension = plugin.language === 'python' ? '.py' : '.R';
  if (path.extname(resolved) !== expectedExtension) throw new Error('materialized_script_language_mismatch');
  const actualHash = crypto.createHash('sha256').update(fs.readFileSync(resolved)).digest('hex');
  if (!override.sha256 || actualHash !== override.sha256) throw new Error('materialized_script_hash_mismatch');
  return resolved;
}

async function callTool(name, args, opts = {}) {
  try {
    refreshPluginSources();
  } catch (e) {
    console.warn('[mcp-registry] refresh plugins before callTool failed:', e.message);
  }
  // opts.userId：归属用户（agent 在登录态下跑，写进 tool_jobs.user_id，
  // 这样用户能在 history 看到，客户端能按 jobId 加载结果）。
  // 兜底 'agent'（无用户上下文，如 MCP 直连场景）。
  const userId = (opts && opts.userId) || 'agent';
  const projectId = (opts && opts.projectId) || null;
  const toolJobId = (opts && opts.toolJobId) || null;

  // Skill 工具路由
  if (name === 'skill_discover') {
    return _skillDiscover(args);
  }
  if (name === 'skill_get') {
    return _skillGet(args);
  }
  if (name === 'skill_execute') {
    return _skillExecute(args);
  }

  // IDE MCP 工具路由（P0：文件 + 终端）
  if (name && name.startsWith('ide_')) {
    return _callIdeTool(name, args);
  }

  // 插件分支
  const plugin = pluginLoader.getPlugin(name);
  if (plugin) {
    // PL-001: callTool 入口在 _runPluginScript 之前对 args 跑 inputSchema 校验
    // 极简 validator (无 ajv) 覆盖 required / type / minimum / maximum / enum
    // 错误统一为 McpValidationError，返回 MCP 标准 isError 响应
    try {
      const inputSchema = pluginLoader.getInputSchema(name);
      const validation = validateToolArgs(name, inputSchema, args);
      if (!validation.ok) {
        return {
          content: [
            {
              type: 'text',
              text: `mcp_input_validation_failed: ${validation.errors
                .map((e) => `${e.path || '<root>'}: ${e.message}`)
                .join('; ')}`,
            },
          ],
          isError: true,
        };
      }
    } catch (validatorError) {
      if (validatorError instanceof McpValidationError) {
        return {
          content: [{ type: 'text', text: validatorError.message }],
          isError: true,
        };
      }
      // 校验器自身异常 → fail-closed：拒绝调用并记录
      console.error('[mcp-registry] input validator crashed:', validatorError);
      return {
        content: [
          {
            type: 'text',
            text: `mcp_input_validator_crashed: ${validatorError.message || 'unknown'}`,
          },
        ],
        isError: true,
      };
    }

    let scriptPath = pluginLoader.getScriptForTool(name);
    if (opts && opts.resultStudioMaterializedScript) {
      try {
        scriptPath = resolveResultStudioScriptOverride({
          override: opts.resultStudioMaterializedScript,
          plugin,
          projectId,
        });
      } catch (error) {
        return {
          content: [{ type: 'text', text: `result_studio_script_rejected: ${error.message}` }],
          isError: true,
        };
      }
    }
    if (!scriptPath || !fs.existsSync(scriptPath)) {
      return {
        content: [{ type: 'text', text: `插件 ${name} 脚本未找到: ${scriptPath}` }],
        isError: true,
      };
    }
    return _runPluginScript(
      plugin,
      scriptPath,
      args,
      userId,
      projectId,
      toolJobId,
      opts && opts.resultStudioInputLineage ? opts.resultStudioInputLineage : null,
      opts && typeof opts.conversationId === 'string' && opts.conversationId.trim()
        ? opts.conversationId.trim()
        : null
    );
  }

  // Scientific analysis is exposed only through installed plugin tools so all
  // execution follows run_tool → tool_job → artifact truth.

  return {
    content: [{ type: 'text', text: `unknown_tool: ${name}` }],
    isError: true,
  };
}

module.exports = {
  listTools,
  callTool,
  listIdeMcpResources,
  readIdeMcpResource,
  _test: {
    canonicalizePath: _canonicalizePath,
    createMcpExecutionContext: _createMcpExecutionContext,
    normalizeArtifacts: _normalizeArtifacts,
    resolveBuiltInPluginsDir,
    resolveStagedInputPath: _resolveStagedInputPath,
    resolveMcpJobLayout: _resolveMcpJobLayout,
    resolveResultStudioScriptOverride,
    GLOBAL_JOBS_DIR,
  },
};

'use strict';

/**
 * BLOCK-146 A 轨（审视发现 #9 / #4）契约测试——HK-01 红绿先行。
 *
 * #9 结构化失败归因：插件「必需」capability bundle（plugin.json requiresBundle
 * 声明 = ensureBundlesForPlugin 语义下的必需依赖）未就绪时，{bundleId, status,
 * error} 与可行动中文指引必须并入 job 失败文案（tool_jobs.error + agent 可见
 * content），不再只进 console.warn 后裸跑 base runtime（审视发现：Windows 上
 * 归因缺失，最终以晦涩的 R library 报错收场）。
 *
 * #4 required file 输入 fail-fast：file 型输入声明 required 且路径在本机不存在
 * 时，run-plugin-script.js 必须以「输入 X 路径不存在: <path>（需本地绝对路径）」
 * 形态 fail-fast；非 required 维持静默跳过。
 *
 * 零网络：#8 根修后 win32 宿主上 r-enrichment resolve 为 unknown（resolve 阶段
 * fail-closed，不触 provisioning）；测试另以 monkeypatch deriveHostPlatform 钉住
 * 宿主平台，保证在任意宿主（含 macOS）上都不发起真实下载。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PLUGIN_BUNDLE = 'block146bundle'; // #9：R 插件 + requiresBundle
const PLUGIN_PLAIN = 'block146plain'; // #9 对照：R 插件无 bundle 声明
const PLUGIN_REQFILE = 'block146reqfile'; // #4：python 插件 + file 输入

async function waitUntil(fn, label, timeoutMs = 20000, debugFn = null) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let value;
    try { value = await fn(); } catch { value = null; }
    if (value) return value;
    if (Date.now() > deadline) {
      let observed = '';
      if (debugFn) {
        try { observed = ' | observed=' + JSON.stringify(await debugFn()); } catch (e) { observed = ' | observed-err=' + e.message; }
      }
      throw new Error('waitUntil 超时: ' + label + observed);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

// ── 共享 harness（形态与 test/block141-cancel-classification.test.mjs 同构）──
// BIOF3_DB_PATH → 生产 migration 链 → db.js 异步 facade；BIOF3_LOCAL_DATA_DIR
// 钉到临时目录，隔离真实 ~/Documents/BioF3-Local 的 provisioning ledger。
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-block146-'));
process.env.BIOF3_DB_PATH = path.join(tempDir, 'biof3.db');
process.env.BIOF3_LOCAL_DATA_DIR = path.join(tempDir, 'local-data');
const { runMigrations } = require('../src/migration-runner');
await runMigrations(process.env.BIOF3_DB_PATH, path.join(ROOT, 'src', 'migrations'));
const dbMod = require('../core/biof3-server/db.js');
const db = dbMod.getAsyncDatabase();

function makePlugin(id, pluginJsonExtra, toolDefinition, scriptExt, scriptLines) {
  const pluginDir = path.join(tempDir, 'plugins', id);
  fs.mkdirSync(path.join(pluginDir, 'scripts'), { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, 'plugin.json'),
    JSON.stringify({ id, name: id, version: '0.0.1', ...pluginJsonExtra }),
  );
  fs.writeFileSync(path.join(pluginDir, 'tool-definition.json'), JSON.stringify(toolDefinition));
  const scriptPath = path.join(pluginDir, 'scripts', id + scriptExt);
  fs.writeFileSync(scriptPath, scriptLines.join('\n') + '\n');
  return { pluginDir, scriptPath };
}

// 脚本以 JS 内容落地（执行器钉 node 自身，扩展名不影响执行）：写 started 标记
// 后正常退出——若 #9/#4 缺失，作业会走到 completed（红）。
const RUN_SCRIPT = [
  "const fs = require('fs');",
  "const path = require('path');",
  "const jobDir = process.argv[2];",
  "try { fs.mkdirSync(path.join(jobDir, 'output'), { recursive: true }); } catch {}",
  "fs.writeFileSync(path.join(jobDir, 'output', 'started.marker'), 'ran');",
  '',
];

const bundlePlugin = makePlugin(
  PLUGIN_BUNDLE,
  { language: 'r', requiresBundle: 'r-enrichment', requiresBundleVersion: '1.0.0' },
  { id: PLUGIN_BUNDLE, name: PLUGIN_BUNDLE, version: '0.0.1', language: 'r', inputs: [], outputs: [] },
  '.R',
  RUN_SCRIPT,
);
const plainPlugin = makePlugin(
  PLUGIN_PLAIN,
  { language: 'r' },
  { id: PLUGIN_PLAIN, name: PLUGIN_PLAIN, version: '0.0.1', language: 'r', inputs: [], outputs: [] },
  '.R',
  RUN_SCRIPT,
);
const reqFilePlugin = makePlugin(
  PLUGIN_REQFILE,
  { language: 'python' },
  {
    id: PLUGIN_REQFILE,
    name: PLUGIN_REQFILE,
    version: '0.0.1',
    language: 'python',
    inputs: [
      { id: 'counts', type: 'file', required: true, label: 'counts 矩阵' },
      { id: 'extra', type: 'file', required: false, label: '可选附加表' },
    ],
    outputs: [],
  },
  '.py',
  RUN_SCRIPT,
);

globalThis._biof3Plugins = new Map();
for (const [id, meta] of [
  [PLUGIN_BUNDLE, { ...bundlePlugin, language: 'r', requiresBundle: 'r-enrichment', requiresBundleVersion: '1.0.0' }],
  [PLUGIN_PLAIN, { ...plainPlugin, language: 'r' }],
  [PLUGIN_REQFILE, { ...reqFilePlugin, language: 'python' }],
]) {
  globalThis._biof3Plugins.set(id, {
    id,
    ...meta,
    // plugin-loader 契约：scriptPath = scripts 目录（getScriptForTool /
    // computePluginFingerprint 都按目录消费）；脚本文件路径单独放 scriptFile。
    scriptPath: path.dirname(meta.scriptPath),
  });
}

// 执行器注册表钉 node 自身：binPath 存在 → runtime preflight 通过（BLOCK-66 门）。
const executorsMod = require('../core/shared-backend/executors');
executorsMod.getExecutor = (lang) => ({
  name: lang,
  binPath: process.execPath,
  buildSpawnCommand: (script, jobDir) => ({ cmd: process.execPath, args: [script, jobDir] }),
  checkPackageInstalled: () => ({ checked: true, missing: [] }),
  getRuntimeVersion: () => 'block146-test-node',
});

const bundles = require('../core/shared-backend/capability-bundles.js');

/** 钉宿主平台为 windows-x64（任意物理宿主上语义一致，且绝不触网）。 */
async function withWin32Host(fn) {
  const original = bundles.deriveHostPlatform;
  bundles.deriveHostPlatform = () => 'windows-x64';
  try {
    return await fn();
  } finally {
    bundles.deriveHostPlatform = original;
  }
}

const agentSeams = () => ({
  resolveJobLayout: ({ toolJobId }) => {
    const jobDir = path.join(tempDir, 'tool-jobs', toolJobId);
    fs.mkdirSync(path.join(jobDir, 'output'), { recursive: true });
    return { jobDir, outputDir: path.join(jobDir, 'output') };
  },
  createMcpExecutionContext: () => ({ context: {}, canonicalizePath: (p) => p }),
  runPluginToolRemote: async () => { throw new Error('remote seam must not be used'); },
});

async function runAgent(plugin, args, userId) {
  const { _runPluginScript } = require('../core/biof3-server/mcp/registry/run-plugin-script.js');
  const result = await _runPluginScript(
    dbMod, null, plugin, plugin.scriptFile, args, userId,
    null, null, null, null, agentSeams(),
  );
  const row = result.toolJobId
    ? await db.prepare('SELECT status, error FROM tool_jobs WHERE id = ?').get(result.toolJobId)
    : null;
  return { result, row };
}

// ── #9 unit：formatRequiredBundleFailure 单源格式化器 ─────────────────────────

test('#9 formatRequiredBundleFailure：provision_failed 携带 bundleId/status/error 与可行动指引', () => {
  const msg = bundles.formatRequiredBundleFailure('gsea', {
    ok: false,
    results: [
      { bundleId: 'r-enrichment', ok: false, status: 'provision_failed', error: 'sha256_mismatch', message: 'sha256 mismatch' },
    ],
  });
  assert.ok(msg.includes('gsea'), '失败文案点名工具');
  assert.ok(msg.includes('r-enrichment'), '失败文案携带 bundleId');
  assert.ok(msg.includes('provision_failed'), '失败文案携带 status');
  assert.ok(msg.includes('sha256_mismatch'), '失败文案携带 error');
  assert.ok(msg.includes('指引') || msg.includes('请'), '失败文案附可行动指引（missingPackagesMessage 范式）');
});

test('#9 formatRequiredBundleFailure：平台不匹配（unknown）点名宿主平台与受支持平台', () => {
  const original = bundles.deriveHostPlatform;
  bundles.deriveHostPlatform = () => 'windows-x64';
  try {
    const msg = bundles.formatRequiredBundleFailure('go-kegg', {
      ok: false,
      results: [{ bundleId: 'r-enrichment', ok: false, status: 'unknown' }],
    });
    assert.ok(msg.includes('unknown'), '携带 status');
    assert.ok(msg.includes('windows-x64'), '点名当前宿主平台');
    assert.ok(msg.includes('macos-arm64'), '点名注册表内受支持平台');
  } finally {
    bundles.deriveHostPlatform = original;
  }
});

// ── #9 agent 路径：必需 bundle 未就绪 → job 失败文案携带结构化归因 ────────────

test('#9 agent 路径：win32 宿主必需 r-enrichment 未就绪 → fail-fast 并入 job 失败文案（不再只 console.warn）', async () => {
  await withWin32Host(async () => {
    const plugin = {
      id: PLUGIN_BUNDLE,
      language: 'r',
      pluginDir: bundlePlugin.pluginDir,
      scriptFile: bundlePlugin.scriptPath,
      requiresBundle: 'r-enrichment',
      requiresBundleVersion: '1.0.0',
    };
    const { result, row } = await runAgent(plugin, {}, 'b9bundle');

    assert.equal(result.isError, true,
      '必需 bundle 未就绪必须 isError（当前裸跑 base runtime 走到 completed——审视发现 #9）');
    const text = result.content && result.content[0] && result.content[0].text || '';
    assert.ok(text.includes('r-enrichment'), 'agent 可见文案携带 bundleId');
    assert.ok(text.includes('unknown'), 'agent 可见文案携带 status');
    assert.ok(text.includes('windows-x64'), 'agent 可见文案点名宿主平台');
    assert.equal(row.status, 'failed', 'tool_jobs 必须落 failed');
    assert.ok(String(row.error || '').includes('r-enrichment'), 'tool_jobs.error 携带 bundleId');
    // fail-fast：不得派生执行进程（started.marker 不出现）。
    const marker = path.join(tempDir, 'tool-jobs', result.toolJobId, 'output', 'started.marker');
    assert.equal(fs.existsSync(marker), false, '必需 bundle 未就绪时不得派生脚本进程');
  });
});

test('#9 对照：无 requiresBundle 声明的 R 插件不受影响（合法无 bundle 语义保持）', async () => {
  const plugin = {
    id: PLUGIN_PLAIN,
    language: 'r',
    pluginDir: plainPlugin.pluginDir,
    scriptFile: plainPlugin.scriptPath,
  };
  const { result, row } = await runAgent(plugin, {}, 'b9plain');
  assert.equal(result.isError, false, '无 bundle 声明的插件照常执行');
  assert.equal(row.status, 'completed', '对照插件必须 completed');
});

// ── #9 HTTP 路径：executeJob 内必需 bundle 未就绪 → markJobFailed('dependencies') ─

test('#9 HTTP 路径：win32 宿主必需 bundle 未就绪 → 作业 failed 且 error 携带结构化归因', async () => {
  const { createToolsExecutor } = require('../core/biof3-server/helpers/tools-executor.js');
  const jobsDir = path.join(tempDir, 'tool-jobs-http');
  fs.mkdirSync(jobsDir, { recursive: true });
  const scriptsDir = path.join(tempDir, 'tool-scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  const executor = createToolsExecutor({
    db,
    dbMod,
    config: {
      localResultsDir: tempDir,
      mkdirSandbox: (p) => fs.mkdirSync(p, { recursive: true }),
    },
    notify: { toolJobFailed() {}, toolJobCompleted() {} },
    jobsDir,
    scriptsDir,
    publicDemoJobIds: new Set(),
    safeJoinUnder: (root, p) => path.join(root, p),
    getUserId: () => 'block146-user',
    isSmokeTestRequest: () => true,
  });

  let response = null;
  await withWin32Host(async () => {
    await executor.handleToolRun(
      { body: { toolId: PLUGIN_BUNDLE, params: {} }, headers: {}, isInternal: false, requestId: 'block146-http' },
      {
        json(obj) { response = obj; return this; },
        status(code) { this.statusCode = code; return this; },
      },
    );
  });
  assert.ok(response && response.jobId, 'HTTP 作业受理（jobId 返回）');
  const row = await waitUntil(async () => {
    const current = await db.prepare('SELECT status, error FROM tool_jobs WHERE id = ?').get(response.jobId);
    return ['cancelled', 'failed', 'completed'].includes(current.status) ? current : null;
  }, 'HTTP 路径终态收敛', 20000, async () => ({
    row: await db.prepare('SELECT status, error FROM tool_jobs WHERE id = ?').get(response.jobId),
  }));
  assert.equal(row.status, 'failed',
    '必需 bundle 未就绪 HTTP 作业必须 failed（当前裸跑 completed——审视发现 #9）；error=' + String(row.error || '').slice(0, 160));
  assert.ok(String(row.error || '').includes('r-enrichment'), 'HTTP 失败 error 携带 bundleId');
  assert.ok(String(row.error || '').includes('unknown'), 'HTTP 失败 error 携带 status');
});

// ── #4：required file 输入路径不存在 → fail-fast；非 required 维持跳过 ─────────

test('#4 agent 路径：required file 输入路径不存在 → fail-fast「输入 X 路径不存在」', async () => {
  const plugin = {
    id: PLUGIN_REQFILE,
    language: 'python',
    pluginDir: reqFilePlugin.pluginDir,
    scriptFile: reqFilePlugin.scriptPath,
  };
  const missingPath = path.join(tempDir, 'definitely-missing-input.csv');
  const { result, row } = await runAgent(plugin, { counts: missingPath }, 'b4missing');

  assert.equal(result.isError, true,
    'required file 输入路径不存在必须 fail-fast（当前静默 continue 裸跑——审视发现 #4）');
  const text = result.content && result.content[0] && result.content[0].text || '';
  assert.ok(text.includes('输入 counts 路径不存在'), '失败文案形态「输入 X 路径不存在」');
  assert.ok(text.includes(missingPath), '失败文案携带原始路径');
  assert.ok(text.includes('需本地绝对路径'), '失败文案提示需本地绝对路径');
  assert.equal(row.status, 'failed', 'tool_jobs 落 failed');
  const marker = path.join(tempDir, 'tool-jobs', result.toolJobId, 'output', 'started.marker');
  assert.equal(fs.existsSync(marker), false, 'required 输入缺失时不得派生脚本进程');
});

test('#4 agent 路径：required file 输入完全缺席 → 同样 fail-fast（不造默认路径）', async () => {
  const plugin = {
    id: PLUGIN_REQFILE,
    language: 'python',
    pluginDir: reqFilePlugin.pluginDir,
    scriptFile: reqFilePlugin.scriptPath,
  };
  const { result } = await runAgent(plugin, {}, 'b4absent');
  assert.equal(result.isError, true, 'required file 输入缺席必须 fail-fast');
  const text = result.content && result.content[0] && result.content[0].text || '';
  assert.ok(text.includes('输入 counts 路径不存在'), '失败文案形态一致');
});

test('#4 agent 路径：非 required file 输入路径不存在 → 维持跳过照常执行（合法回退不变）', async () => {
  const plugin = {
    id: PLUGIN_REQFILE,
    language: 'python',
    pluginDir: reqFilePlugin.pluginDir,
    scriptFile: reqFilePlugin.scriptPath,
  };
  const existing = path.join(tempDir, 'present-input.csv');
  fs.writeFileSync(existing, 'gene,s1\nA,1\n');
  const { result, row } = await runAgent(
    plugin,
    { counts: existing, extra: path.join(tempDir, 'optional-missing.csv') },
    'b4optional',
  );
  assert.equal(result.isError, false, '非 required 输入缺失不得阻断执行');
  assert.equal(row.status, 'completed', '可选输入缺失照常 completed');
});

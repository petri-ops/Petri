// MCP 工具注册表测试（Task 2）—— 产线合一
// 运行：cd desktop-app && node --test test/mcp-tool-registry.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const path = { join };
const __dirname = dirname(fileURLToPath(import.meta.url));
// desktop-app/test → 仓库根/r-server
const R_SERVER = resolve(__dirname, '..', '..', 'r-server');

const pluginLoader = await import(R_SERVER + '/plugin-loader.js');
const taskScripts = await import(R_SERVER + '/task-scripts-gen/index.js');
const { listTools, callTool } = await import(resolve(__dirname, '..', 'src', 'mcp-tool-registry.js'));

// helper：注册一个 mock 插件到 globalThis._biof3Plugins
function mockPlugin(id, def) {
  if (!globalThis._biof3Plugins) globalThis._biof3Plugins = new Map();
  globalThis._biof3Plugins.set(id, {
    id,
    version: '1.0.0',
    language: 'r',
    pluginDir: `/mock/${id}`,
    scriptPath: `/mock/${id}/scripts`,
  });
  // mock getToolDefinition 返回的 def 直接塞 pluginDir 下
  // 通过 monkey-patch getToolDefinition 避免读磁盘
}

test('_inputsToInputSchema 把 inputs[] 转 JSON Schema', () => {
  const schema = pluginLoader._inputsToInputSchema([
    { id: 'fc_threshold', label: '|log2FC| 阈值', type: 'number', default: 1 },
    { id: 'deg_table', label: 'DEG 表', type: 'file', required: true },
  ]);
  assert.equal(schema.type, 'object');
  assert.deepEqual(schema.required, ['deg_table']);
  assert.equal(schema.properties.fc_threshold.type, 'number');
  assert.equal(schema.properties.deg_table.type, 'string');
  assert.equal(schema.properties.fc_threshold.default, 1);
});

test('listStepTools 返回 10 个单细胞步骤', () => {
  const steps = taskScripts.listStepTools();
  assert.equal(steps.length, 10);
  const names = steps.map((s) => s.name);
  assert.ok(names.includes('scrna-standard'));
  assert.ok(names.includes('deg'));
  assert.ok(names.includes('doublet'));
  for (const s of steps) {
    assert.equal(s._isStep, true);
    assert.equal(s.inputSchema.type, 'object');
  }
});

test('listTools 合并插件工具 + 单细胞步骤', async () => {
  // 清空 + 注册一个 mock 插件（pluginDir 指向临时目录，放真实 tool-definition.json）
  const os = await import('node:os');
  const fs = await import('node:fs');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-mcp-test-'));
  const pluginDir = path.join(tmpDir, 'volcano-plot');
  fs.mkdirSync(path.join(pluginDir, 'scripts'), { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, 'tool-definition.json'),
    JSON.stringify({
      id: 'volcano-plot',
      description: '从差异分析结果绘制火山图',
      inputs: [
        { id: 'deg_table', type: 'file', required: true },
        { id: 'fc_threshold', type: 'number', default: 1 },
      ],
      outputs: [{ id: 'volcano', type: 'plot' }],
    }),
  );
  globalThis._biof3Plugins = new Map();
  globalThis._biof3Plugins.set('volcano-plot', {
    id: 'volcano-plot',
    version: '1.0.0',
    language: 'r',
    pluginDir,
    scriptPath: path.join(pluginDir, 'scripts'),
  });
  try {
    const tools = await listTools();
    const names = tools.map((t) => t.name);
    // 插件工具
    assert.ok(names.includes('volcano-plot'), '应含插件工具 volcano-plot');
    const vol = tools.find((t) => t.name === 'volcano-plot');
    assert.equal(vol.inputSchema.required[0], 'deg_table');
    assert.equal(vol.inputSchema.properties.fc_threshold.default, 1);
    // 10 个单细胞步骤
    assert.ok(names.includes('scrna-standard'));
    assert.ok(names.includes('deg'));
    const stepCount = tools.filter((t) => t._isStep).length;
    assert.equal(stepCount, 10, '应含 10 个单细胞步骤');
    // 合计：1 插件 + 10 步骤 = 11
    assert.equal(tools.length, 11);
  } finally {
    globalThis._biof3Plugins = new Map();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('callTool 对未知工具返回 isError', async () => {
  globalThis._biof3Plugins = new Map(); // 清空，确保 volcano-plot 未注册
  const result = await callTool('nonexistent_tool_xyz', {});
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /unknown_tool/i);
});

// 真实跑 volcano-plot（需本地 R + ggplot2/ggrepel）。
// 无 R 环境时跳过（RUN_MCP_LIVE=1 才跑，与项目 RUN_LIVE_AI 模式一致）。
const RUN_LIVE = process.env.RUN_MCP_LIVE === '1';
test('callTool 跑通 volcano-plot 出 PNG（live）', { skip: !RUN_LIVE }, async () => {
  // 注册 built-in volcano-plot 插件（指向 resources/built-in-plugins/volcano-plot）
  const builtInDir = resolve(__dirname, '..', 'resources', 'built-in-plugins', 'volcano-plot');
  const demoCsv = path.join(builtInDir, 'demo-data', 'demo_deg.csv');
  globalThis._biof3Plugins = new Map();
  globalThis._biof3Plugins.set('volcano-plot', {
    id: 'volcano-plot',
    version: '1.0.0',
    language: 'r',
    pluginDir: builtInDir,
    scriptPath: path.join(builtInDir, 'scripts'),
  });
  try {
    const result = await callTool('volcano-plot', {
      deg_table: demoCsv,
      fc_threshold: 1,
      pval_threshold: 1.3,
      top_n: 10,
    });
    assert.equal(result.isError, false, `应成功，实际: ${result.content[0].text}`);
    const summary = JSON.parse(result.content[0].text);
    assert.ok(summary.jobDir, '应返回 jobDir');
    // manifest 应含 volcano 图输出
    const outputs = summary.outputs || [];
    const volcano = outputs.find((o) => o.id === 'volcano');
    assert.ok(volcano, 'manifest 应含 volcano 输出');
    // PNG 文件应真实存在
    const fs2 = await import('node:fs');
    assert.ok(fs2.existsSync(volcano.path), `PNG 应存在: ${volcano.path}`);
    // manifest summary 应有 up/down 计数
    assert.ok(summary.manifest?.summary?.up >= 0, 'manifest.summary.up 应存在');
  } finally {
    globalThis._biof3Plugins = new Map();
  }
});

// 真实跑已装的 deseq2（需本地 R + DESeq2 + deseq2 插件已装）。
// 验证 file-input 复制到 jobDir 约定 + output/ 子目录 manifest 读取。
test('callTool 跑通 deseq2 全流程出图（live）', { skip: !RUN_LIVE }, async () => {
  const os = await import('node:os');
  const demoDir = path.join(os.homedir(), 'Documents', 'BioF3-Local', 'plugins', 'deseq2', 'demo-data');
  const fs2 = await import('node:fs');
  const hasDemo = fs2.existsSync(path.join(demoDir, 'demo-counts.csv'));
  if (!hasDemo) {
    console.log('跳过：deseq2 demo 数据不存在');
    return;
  }
  // 用真实已装的 deseq2 插件（loadPluginsFromDisk 已注册到 globalThis）
  globalThis._biof3Plugins = new Map();
  const pluginLoaderFresh = await import(R_SERVER + '/plugin-loader.js');
  pluginLoaderFresh.loadPluginsFromDisk();
  try {
    const result = await callTool('deseq2', {
      counts: path.join(demoDir, 'demo-counts.csv'),
      coldata: path.join(demoDir, 'demo-coldata.csv'),
      design: 'condition',
      contrast_ref: 'Control',
      contrast_treat: 'Treatment',
    });
    assert.equal(result.isError, false, `应成功，实际: ${result.content[0].text.slice(0, 500)}`);
    const summary = JSON.parse(result.content[0].text);
    assert.ok(summary.outputDir, '应返回 outputDir');
    // deseq2 manifest 用 files[] 格式（name 字段）
    const outputs = summary.outputs || [];
    const volcano = outputs.find((o) => (o.name || o.id) === 'volcano' || (o.filename || o.name) === 'volcano.png');
    assert.ok(volcano, '应含 volcano 图');
    assert.ok(fs2.existsSync(volcano.path), `volcano PNG 应存在: ${volcano.path}`);
    // manifest.summary 应有差异基因计数
    assert.ok(summary.manifest?.summary?.sig_genes >= 0, 'manifest.summary.sig_genes 应存在');
  } finally {
    globalThis._biof3Plugins = new Map();
  }
});

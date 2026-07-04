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

test('callTool 在 Task 2 阶段是 stub（抛 not_implemented）', async () => {
  await assert.rejects(
    () => callTool('volcano-plot', {}),
    (err) => /not_implemented|未实现/i.test(err.message ?? String(err)),
  );
});

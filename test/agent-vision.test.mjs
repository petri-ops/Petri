// agent-led 阶段2 Task4 测试：agent 看图（read_image → qwen-vl-max）
// 运行：cd desktop-app && RUN_VISION_LIVE=1 BIOF3_DB_PATH=... node --test test/agent-vision.test.mjs
// 需：DashScope API key（用户设置或 DASHSCOPE_API_KEY env）+ 已有完成的 volcano-plot tool_job
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const R_SERVER = resolve(__dirname, '..', 'core', 'r-server');
const req = createRequire(import.meta.url);

const db = req(R_SERVER + '/db.js');
const { tool_read_image } = req(R_SERVER + '/agent-tools/vision-tools.js');
const { callTool } = await import(resolve(__dirname, '..', 'core', 'r-server', 'mcp', 'registry.js'));

const RUN_LIVE = process.env.RUN_VISION_LIVE === '1';

// 先跑一个 volcano-plot 拿到 toolJobId（live，需 R）
test('跑 volcano-plot 拿 toolJobId（live 前置）', { skip: !RUN_LIVE }, async () => {
  const builtInDir = resolve(__dirname, '..', 'resources', 'built-in-plugins', 'volcano-plot');
  const demoCsv = resolve(builtInDir, 'demo-data', 'demo_deg.csv');
  globalThis._biof3Plugins = new Map();
  globalThis._biof3Plugins.set('volcano-plot', {
    id: 'volcano-plot', version: '1.0.0', language: 'r',
    pluginDir: builtInDir, scriptPath: resolve(builtInDir, 'scripts'),
  });
  try {
    const r = await callTool('volcano-plot', { deg_table: demoCsv, fc_threshold: 1, pval_threshold: 1.3, top_n: 10 }, { userId: 'local-user' });
    assert.equal(r.isError, false);
    assert.ok(r.toolJobId);
    // 存到全局供下一个测试用
    globalThis.__visionJobId = r.toolJobId;
  } finally {
    globalThis._biof3Plugins = new Map();
  }
});

test('read_image 用 qwen-vl-max 解读火山图（live）', { skip: !RUN_LIVE }, async () => {
  const jobId = globalThis.__visionJobId;
  if (!jobId) { console.log('跳过：前置 volcano-plot 未跑'); return; }
  const r = await tool_read_image(
    { toolJobId: jobId, question: '这是火山图吗？描述图的横轴纵轴和差异基因分布。' },
    { userId: 'local-user' }
  );
  assert.equal(r.ok, true, `应成功: ${JSON.stringify(r)}`);
  assert.ok(r.description, '应返回图描述');
  assert.ok(r.description.length > 20, '描述应有一定长度');
  console.log('=== vision 描述 ===');
  console.log(r.description.slice(0, 300));
});

// 非 live：验证错误处理（job 不存在）
test('read_image job 不存在返回 job_not_found', async () => {
  const r = await tool_read_image({ toolJobId: 'tj_nonexistent' }, { userId: 'local-user' });
  assert.equal(r.ok, undefined);
  assert.equal(r.error, 'job_not_found');
});

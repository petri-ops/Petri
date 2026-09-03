// agent-led 阶段2 Task4 测试：agent 看图（read_image → qwen-vl-max）
// 运行：cd desktop-app && RUN_VISION_LIVE=1 BIOF3_DB_PATH=... node --test test/agent-vision.test.mjs
// 需：DashScope API key（用户设置或 DASHSCOPE_API_KEY env）+ 已有完成的 volcano-plot tool_job
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const R_SERVER = resolve(__dirname, '..', 'core', 'biof3-server');
const req = createRequire(import.meta.url);

// BLOCK-52 P2：自举临时 DB（src/migrations 全量）——default biof3.db 可能缺最新
// schema；显式 BIOF3_DB_PATH 隔离，require db.js 前生效（CommonJS require 顺序执行）。
{
  const fs = req('fs');
  const os = req('os');
  const dbPath = req('path');
  const Database = req(R_SERVER + '/node_modules/better-sqlite3');
  const tempDbDir = fs.mkdtempSync(dbPath.join(os.tmpdir(), 'biof3-agent-vision-db-'));
  const boot = new Database(dbPath.join(tempDbDir, 'biof3.db'));
  const migrationsDir = resolve(__dirname, '..', 'src', 'migrations');
  for (const f of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(fs.readFileSync(dbPath.join(migrationsDir, f), 'utf8'));
  }
  boot.close();
  process.env.BIOF3_DB_PATH = dbPath.join(tempDbDir, 'biof3.db');
  process.on('exit', () => {
    try { fs.rmSync(tempDbDir, { recursive: true, force: true }); } catch {}
  });
}

const db = req(R_SERVER + '/db.js');
const { tool_read_image } = req(R_SERVER + '/agent-tools/vision-tools.js');
// 动态 import 必须用 file:// URL（Windows 绝对路径 D:/... 不被 ESM loader 接受）
const { callTool } = await import(pathToFileURL(resolve(__dirname, '..', 'core', 'biof3-server', 'mcp', 'registry.js')).href);

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

// ============================================================
// BLOCK-52 P2 — read_image filePath（workspace 静态图）边界校验
// ============================================================
const fsSync = req('fs');
const pathSync = req('path');
const osSync = req('os');
const { resolveWorkspaceImagePath } = req(R_SERVER + '/agent-tools/vision-tools.js');

// 建临时工作区：一张真 PNG + 一个指向工作区外的符号链接
const wsDir = fsSync.mkdtempSync(pathSync.join(osSync.tmpdir(), 'biof3-p2-ws-'));
fsSync.mkdirSync(pathSync.join(wsDir, 'figures'), { recursive: true });
// 1x1 PNG（最小合法 PNG 字节）
const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082',
  'hex',
);
fsSync.writeFileSync(pathSync.join(wsDir, 'figures', 'umap.png'), PNG_BYTES);
fsSync.writeFileSync(pathSync.join(wsDir, 'notes.txt'), 'not an image');
fsSync.symlinkSync('/etc/hosts', pathSync.join(wsDir, 'figures', 'evil.png'));
const p2Project = db.createProject({ name: 'BLOCK-52-P2-boundary', workspacePath: wsDir });
const p2Ctx = { userId: 'local-user', projectId: p2Project.id };

test('resolveWorkspaceImagePath: 正常路径解析到 workspace 内真实文件', () => {
  const r = resolveWorkspaceImagePath(p2Ctx, 'figures/umap.png');
  assert.equal(r.error, undefined);
  assert.equal(r.fileName, 'umap.png');
  assert.ok(r.imgPath.startsWith(fsSync.realpathSync(wsDir)), '解析结果必须落在工作区内');
});

test('resolveWorkspaceImagePath: 路径穿越 / 符号链接逃逸 / 非图片 / 缺文件逐项拦截', () => {
  // 无项目上下文
  assert.equal(resolveWorkspaceImagePath({ userId: 'u' }, 'figures/umap.png').error, 'project_required');
  // 词法穿越
  assert.equal(resolveWorkspaceImagePath(p2Ctx, '../../etc/hosts.png').error, 'path_escape');
  assert.equal(resolveWorkspaceImagePath(p2Ctx, '/etc/hosts.png').error, 'path_escape');
  // 非图片扩展名
  assert.equal(resolveWorkspaceImagePath(p2Ctx, 'notes.txt').error, 'not_an_image');
  // 符号链接指向工作区外
  assert.equal(resolveWorkspaceImagePath(p2Ctx, 'figures/evil.png').error, 'symlink_escape');
  // 文件不存在
  assert.equal(resolveWorkspaceImagePath(p2Ctx, 'figures/missing.png').error, 'file_not_found');
});

test('read_image filePath 模式无 toolJobId 也可走通错误分支（边界不触网）', async () => {
  const r = await tool_read_image({ filePath: '../../etc/hosts.png' }, p2Ctx);
  assert.equal(r.error, 'path_escape');
  const r2 = await tool_read_image({}, { userId: 'local-user' });
  assert.equal(r2.error, 'missing_toolJobId');
});


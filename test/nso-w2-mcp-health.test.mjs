/**
 * nso-w2-mcp-health.test.mjs — BLOCK-360（NSO-W2-6）MCP registry 初始化降级可见。
 *
 * 缺口（评估 §2.5/蓝图 W2-9）：registry 八处 try/catch 仅 console.warn——SkillRegistry /
 * SkillRuntime / db.js / plans.js / initSharedBackend / shared-backend configure /
 * loadPluginsFromDisk / pack sources 初始化失败后 listTools/callTool 照常对外宣称完整可用，
 * 设置货架与外部 agent 都看不到降级。
 * 契约：失败按「关键=degraded / 非关键=warning」汇总进 getRegistryHealth()；关键缺失时
 * listTools 输出携带 executionMetadata.health.degraded=true + reasons（不中断工具列表）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 与 agent-workspace-exec-* 同款环境自举：迁移过的临时库（db.js 依赖真实 schema）。
// 不设 PETRI_DB_PATH 时 db.js 会打开仓库内残留库并以 `no such table: projects` 失败——
// 那正是本门要暴露的降级（此前仅 console.warn）；干净基线必须给它一个真实库。
{
  const fssync = require('node:fs');
  const os = require('node:os');
  const Database = require('better-sqlite3');
  const tempDbDir = fssync.mkdtempSync(path.join(os.tmpdir(), 'petri-w2-mcp-health-db-'));
  const db = new Database(path.join(tempDbDir, 'petri.db'));
  const migrationsDir = path.join(ROOT, 'src', 'migrations');
  for (const file of fssync.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(fssync.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  db.close();
  process.env.PETRI_DB_PATH = path.join(tempDbDir, 'petri.db');
  process.on('exit', () => {
    try { fssync.rmSync(tempDbDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });
}
const registryPath = path.join(ROOT, 'core', 'petri-server', 'mcp', 'registry.js');

/** 注入加载失败（含延迟 require：补丁保持到 restore()，覆盖 listTools 期间的懒加载）。 */
function loadRegistryWithFailures(failures) {
  const Module = require('node:module');
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    const hit = failures.find((f) => typeof request === 'string' && request.endsWith(f.suffix));
    if (hit) throw new Error(`simulated failure: ${hit.suffix}`);
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[registryPath];
  const registry = require(registryPath);
  return { registry, restore: () => { Module._load = originalLoad; } };
}

test('W2-6 健康面在干净环境下 degraded=false', () => {
  const { registry, restore } = loadRegistryWithFailures([]);
  try {
    const health = registry.getRegistryHealth();
    assert.equal(health.degraded, false, JSON.stringify(health));
    assert.deepEqual(health.reasons, []);
  } finally { restore(); }
});

test('W2-6 负测：SkillRegistry 加载失败 → degraded=true 且原因可见；listTools 条目携带降级元数据', async () => {
  const { registry, restore } = loadRegistryWithFailures([{ suffix: 'shared-backend/skill-registry' }]);
  try {
    const tools = await registry.listTools();
    const health = registry.getRegistryHealth();
    assert.equal(health.degraded, true, JSON.stringify(health));
    assert.ok(health.reasons.some((r) => /skill-registry|SkillRegistry/i.test(r.detail)), JSON.stringify(health.reasons));
    assert.ok(Array.isArray(tools) && tools.length > 0);
    for (const tool of tools) {
      assert.equal(tool.executionMetadata?.health?.degraded, true, '关键缺失必须逐工具可见，不得宣称完整可用');
    }
  } finally { restore(); }
});

test('W2-6 非关键失败（plans.js 同步面）只记 warning 不降级', () => {
  const { registry, restore } = loadRegistryWithFailures([{ suffix: path.join('helpers', 'plans.js') }]);
  try {
    const health = registry.getRegistryHealth();
    assert.equal(health.degraded, false, JSON.stringify(health));
    assert.ok(health.warnings.some((w) => /plans/i.test(w)), JSON.stringify(health.warnings));
  } finally { restore(); }
});

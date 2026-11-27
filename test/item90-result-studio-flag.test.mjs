/**
 * item 90 阶段一 HK-01 — Result Studio flag 门控（可逆下架）。
 * ①resultStudio flag 默认 off（decision-config RUNTIME_POINTS + config-schema 登记）；
 * ②flag off 时 RS 后端全部入口不可达（404 result_studio_disabled）；
 * ③PETRI_RESULT_STUDIO=1 或设置页显式开启 → 入口恢复（可逆）；
 * ④双表面覆盖断言：清理影响面清单的每个查看场景都有双表面映射或显式缺口标记。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const requireFrom = (rel) => require(path.join(ROOT, rel));

// 隔离 decision-config 的落盘文档（不碰真实用户配置）
const isolatedConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'item90-decision-')), 'decision-config.json');
process.env.PETRI_DECISION_CONFIG_PATH = isolatedConfig;
delete process.env.PETRI_RESULT_STUDIO;

// RS 路由加载链会 prepare projects 表——同 mcp-tool-registry 临时库+全量迁移自举（真修不 skip）
const { bootstrapTestDb } = requireFrom('test/helpers/bootstrap-db.mjs');
bootstrapTestDb('item90-rs-flag-');

const decisionConfig = requireFrom('core/petri-server/helpers/decision-config.js');
const registerResultStudioRoutes = requireFrom('core/petri-server/routes/result-studio.js');

function freshApp() {
  const app = express();
  app.use(express.json({ limit: '1kb' }));
  // 模拟桌面 localIdentityMiddleware：req.user 恒在（与 bootstrap.js 同语义）
  app.use((req, _res, next) => { req.user = { id: 'local', role: 'admin' }; next(); });
  registerResultStudioRoutes(app);
  return app;
}

function call(app, method, url, body) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      fetch(`http://127.0.0.1:${port}${url}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      }).then(async (res) => {
        const text = await res.text();
        server.close();
        resolve({ status: res.status, text });
      }).catch((error) => { server.close(); resolve({ status: -1, text: String(error) }); });
    });
  });
}

test('HK-90-1：result-studio 决策点默认 off（注册表 + config-schema 登记）', () => {
  const runtime = decisionConfig.getPointRuntime('result-studio');
  assert.ok(runtime, 'result-studio 决策点应已注册');
  assert.equal(runtime.enabled, false, '默认必须 off（可逆下架语义）');
  assert.equal(runtime.point, 'result-studio');
  const all = decisionConfig.getAllPointConfigs().map((p) => p.point);
  assert.ok(all.includes('result-studio'), '设置页全量配置应含该点');
  // config-schema 登记防漂移
  const schemaSource = fs.readFileSync(path.join(ROOT, 'core', 'packages', 'shared-config', 'config-schema.js'), 'utf8');
  assert.ok(schemaSource.includes('point.result-studio.enabled'), 'config-schema 应登记 point.result-studio.enabled');
});

test('HK-90-2（钉①）：flag off 时 RS 后端全部入口不可达（404 result_studio_disabled）', async () => {
  const app = freshApp();
  for (const [method, url] of [
    ['GET', '/api/result-studio/annotations'],
    ['POST', '/api/result-studio/annotations'],
    ['GET', '/api/result-studio/changesets'],
    ['GET', '/api/result-studio/context'],
    ['GET', '/api/result-studio/lineage'],
    ['GET', '/api/result-studio/revisions'],
  ]) {
    const res = await call(app, method, url, method === 'POST' ? {} : undefined);
    assert.equal(res.status, 404, `${method} ${url} flag off 必须 404（实际 ${res.status}）`);
    assert.match(res.text, /result_studio_disabled/);
  }
});

test('HK-90-3（可逆）：env 种子开启后入口恢复（不再 404）', async () => {
  process.env.PETRI_RESULT_STUDIO = '1';
  try {
    const app = freshApp();
    const res = await call(app, 'GET', '/api/result-studio/annotations');
    assert.notEqual(res.status, 404, 'flag on 后不得再 404（可逆下架语义）');
    assert.equal(/result_studio_disabled/.test(res.text), false);
  } finally {
    delete process.env.PETRI_RESULT_STUDIO;
  }
});

test('HK-90-4（钉②）：双表面覆盖断言——影响面清单每个查看场景都有映射或显式缺口', () => {
  const docPath = path.join(ROOT, 'acceptance', 'item90-result-studio-phase1', 'IMPACT-INVENTORY.md');
  assert.ok(fs.existsSync(docPath), '《清理影响面清单》应存在');
  const doc = fs.readFileSync(docPath, 'utf8');
  // 清单必备五节（引用面全量核查的契约形状）
  for (const section of ['代码引用面', '插件与领域包契约', '数据流（写 RS 表/目录）', '验收测试锚点', '文档与 README']) {
    assert.ok(doc.includes(section), `清单应含「${section}」节`);
  }
  // 双表面映射表：每个场景行必须带 ✅ 已补位 或 ⚠️ 缺口（缺口的须标「报备」）
  const rows = doc.split('\n').filter((line) => /^\| 场景\d+/.test(line));
  assert.ok(rows.length >= 6, `双表面映射场景应 ≥6 行（实际 ${rows.length}）`);
  for (const row of rows) {
    assert.ok(/✅ 已补位|⚠️ 缺口（已报备/.test(row), `场景行缺映射判定：${row.slice(0, 80)}`);
  }
  // 关键补位面真实存在（双表面断言锚点：文件面板与产物卡的承接文件在仓）
  for (const rel of [
    'frontend/src/components/copilot/ChatArtifactCard.tsx',
    'frontend/src/components/work-surface/GeneratedFilesSurface.tsx',
  ]) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `补位面应存在：${rel}`);
  }
});

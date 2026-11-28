/**
 * item 90 阶段二「退役钉」—— Result Studio 物理删除验收契约：
 * ① RS 路由物理删除：/api/result-studio/*（原 9 子域全入口）全部 404 不可达；
 * ② RS flag 与门控全套清理：decision-config 无 result-studio 点、config-schema 无 point.result-studio.enabled、resultStudioFlag.ts 已删；
 * ③ 共享批注迁出保留：/api/annotations 正常挂载并读写 result_annotations 表（PDF/工作区/速记批注零回归），028 迁移 DROP 其余 10 张 RS 表；
 * ④ 前端独占入口清理 + 共享组件仍在：ResultsSurface/EvidenceSurface 已删、workSurface registry 无 results tab、
 *    ResultView / ResultArtifactShell / ResultsLibrary / ChatArtifactCard / GeneratedFilesSurface / WorkbenchOverviewSurface / AnnotatablePdfPane 均保留；
 * ⑤ 退役影响面清单（IMPACT-INVENTORY.md）与五节映射结构完好。
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

const isolatedConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'item90-p2-decision-')), 'decision-config.json');
process.env.PETRI_DECISION_CONFIG_PATH = isolatedConfig;
delete process.env.PETRI_RESULT_STUDIO;

const { bootstrapTestDb } = requireFrom('test/helpers/bootstrap-db.mjs');
const dbPath = bootstrapTestDb('item90-p2-retired-');

const decisionConfig = requireFrom('core/petri-server/helpers/decision-config.js');
const registerRoutes = requireFrom('core/petri-server/routes/index.js');

async function freshRegisteredApp() {
  const app = express();
  app.use(express.json({ limit: '16kb' }));
  app.use((req, _res, next) => { req.user = { id: 'local', role: 'admin' }; next(); });
  await registerRoutes(app);
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

test('HK-90-P2-1：RS flag 门控与配置登记已物理清除（不存在）', () => {
  assert.equal(decisionConfig.getPointRuntime('result-studio'), null, 'decision-config 不得再注册 result-studio');
  const all = decisionConfig.getAllPointConfigs().map((p) => p.point);
  assert.equal(all.includes('result-studio'), false, 'getAllPointConfigs 不得含 result-studio');

  const schemaSource = fs.readFileSync(path.join(ROOT, 'core', 'packages', 'shared-config', 'config-schema.js'), 'utf8');
  assert.equal(schemaSource.includes('point.result-studio.enabled'), false, 'config-schema 不得含 point.result-studio.enabled');
  assert.equal(schemaSource.includes('PETRI_RESULT_STUDIO'), false, 'config-schema 不得含 PETRI_RESULT_STUDIO');

  assert.equal(
    fs.existsSync(path.join(ROOT, 'frontend', 'src', 'lib', 'resultStudioFlag.ts')),
    false,
    'resultStudioFlag.ts 应已删除',
  );
  assert.equal(
    fs.existsSync(path.join(ROOT, 'core', 'petri-server', 'routes', 'result-studio.js')),
    false,
    'routes/result-studio.js 应已物理删除',
  );
  assert.equal(
    fs.existsSync(path.join(ROOT, 'core', 'petri-server', 'routes', 'result-studio')),
    false,
    'routes/result-studio/ 目录应已物理删除',
  );
});

test('HK-90-P2-2：RS 全域路由 404 不可达（即使 PETRI_RESULT_STUDIO=1 也不可恢复）', async () => {
  process.env.PETRI_RESULT_STUDIO = '1';
  try {
    const app = await freshRegisteredApp();
    for (const [method, url] of [
      ['GET', '/api/result-studio/annotations'],
      ['POST', '/api/result-studio/annotations'],
      ['GET', '/api/result-studio/changesets'],
      ['GET', '/api/result-studio/context'],
      ['GET', '/api/result-studio/context-envelope'],
      ['GET', '/api/result-studio/interaction'],
      ['GET', '/api/result-studio/lineage'],
      ['GET', '/api/result-studio/revisions'],
      ['GET', '/api/result-studio/selection/current'],
      ['POST', '/api/result-studio/table/query'],
      ['GET', '/api/result-studio/workspace/status'],
      ['GET', '/api/result-studio/history'],
    ]) {
      const res = await call(app, method, url, method === 'POST' ? {} : undefined);
      assert.equal(res.status, 404, `${method} ${url} 必须 404（实际 ${res.status}）`);
    }
  } finally {
    delete process.env.PETRI_RESULT_STUDIO;
  }
});

test('HK-90-P2-3：共享批注路由 /api/annotations 独立挂载并读写 result_annotations（028 已 DROP 10 张 RS 表）', async () => {
  const Database = requireFrom('core/petri-server/node_modules/better-sqlite3');
  const sqlite = new Database(dbPath);
  try {
    const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    for (const dropped of [
      'results', 'result_tags', 'result_versions',
      'result_workflow_graphs', 'result_ref_transactions',
      'git_repository_bindings', 'scientific_change_sets',
      'artifact_revisions', 'result_selection_contexts',
      'workspace_revision_checkpoints',
    ]) {
      assert.equal(tables.includes(dropped), false, `028 迁移后应已 DROP 表 ${dropped}`);
    }
    assert.equal(tables.includes('result_annotations'), true, '共享批注表 result_annotations 必须保留');

    sqlite.prepare(
      'INSERT OR IGNORE INTO projects (id, name, workspace_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('proj-ann', 'Ann Project', '/tmp/ann', Date.now(), Date.now());
  } finally {
    sqlite.close();
  }

  const app = await freshRegisteredApp();
  const created = await call(app, 'POST', '/api/annotations', {
    projectId: 'proj-ann',
    surface: 'workspace-file',
    filePath: 'reports/qc.pdf',
    kind: 'region',
    page: 1,
    rect: [0.1, 0.2, 0.3, 0.4],
    comment: 'PDF 共享批注零回归验证',
    color: 'amber',
  });
  assert.equal(created.status, 200, `POST /api/annotations 应返回 200（实际 ${created.status}: ${created.text}）`);
  const parsedCreate = JSON.parse(created.text);
  assert.equal(parsedCreate.annotation.comment, 'PDF 共享批注零回归验证');

  const listed = await call(app, 'GET', '/api/annotations?projectId=proj-ann&surface=workspace-file&filePath=reports%2Fqc.pdf');
  assert.equal(listed.status, 200);
  const parsedList = JSON.parse(listed.text);
  assert.equal(parsedList.annotations.length, 1);
  assert.equal(parsedList.annotations[0].annotationId, parsedCreate.annotation.annotationId);
});

test('HK-90-P2-4：共享组件仍在、RS 独占入口已清、影响面清单结构完好', () => {
  // RS 独占前端面已物理删除
  for (const removedRel of [
    'frontend/src/components/work-surface/ResultsSurface.tsx',
    'frontend/src/components/work-surface/EvidenceSurface.tsx',
    'frontend/src/components/result-studio/ResultStudioSurface.tsx',
    'frontend/src/components/result-studio/ResultAgentComposer.tsx',
    'frontend/src/components/result-studio/ResultEditPanel.tsx',
    'frontend/src/pages/project-workspace/useResultStudioEditContext.ts',
  ]) {
    assert.equal(fs.existsSync(path.join(ROOT, removedRel)), false, `RS 独占文件应已删除：${removedRel}`);
  }

  // workSurface 注册表已撤回 results tab
  const registrySrc = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'lib', 'workSurface', 'registry.ts'), 'utf8');
  assert.equal(registrySrc.includes("coreSurface('results'"), false, 'CORE_WORK_SURFACES 不得再包含 results');

  // 红线共享组件 + 承接面 + 总览 + PDF 批注均完整保留
  for (const keptRel of [
    'frontend/src/components/workspace-panels/ResultView.tsx',
    'frontend/src/components/workspace-panels/ResultArtifactShell.tsx',
    'frontend/src/components/workspace-panels/ResultsLibrary.tsx',
    'frontend/src/components/copilot/ChatArtifactCard.tsx',
    'frontend/src/components/work-surface/GeneratedFilesSurface.tsx',
    'frontend/src/components/work-surface/WorkbenchOverviewSurface.tsx',
    'frontend/src/components/annotations/AnnotatablePdfPane.tsx',
    'frontend/src/components/annotations/AnnotatableImagePane.tsx',
  ]) {
    assert.ok(fs.existsSync(path.join(ROOT, keptRel)), `红线/共享组件必须保留：${keptRel}`);
  }

  // 影响面清单仍在案
  const docPath = path.join(ROOT, 'acceptance', 'item90-result-studio-phase1', 'IMPACT-INVENTORY.md');
  assert.ok(fs.existsSync(docPath), '《清理影响面清单》应存在');
  const doc = fs.readFileSync(docPath, 'utf8');
  for (const section of ['代码引用面', '插件与领域包契约', '数据流（写 RS 表/目录）', '验收测试锚点', '文档与 README']) {
    assert.ok(doc.includes(section), `清单应含「${section}」节`);
  }
});

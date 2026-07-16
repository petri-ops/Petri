/**
 * test/project-sandbox-artifacts.test.mjs
 *
 * Phase 4: Artifact 路由、报告与导出可发现性测试
 *
 * 验证：
 * - resolver 目录契约新增 results/exports（跨 job 共享导出目录），ensureDirs 时创建
 * - 最终报告在 job 的 output/ 生成（materializeFinalReport 自包含内嵌图片）
 * - 用户主动导出的副本进入 results/exports/（自包含 HTML，可从项目文件树发现）
 * - safeJoin containment：拒绝 ../ 逃逸出 output/ 边界
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const SHARED_BACKEND = path.join(__dirname, '..', 'vendor', 'biof3-core', 'shared-backend');
const R_HELPERS = path.join(__dirname, '..', 'vendor', 'biof3-core', 'r-server', 'helpers');

const { resolveProjectRunLayout, isPathContained, safeJoinUnder } = require(
  path.join(SHARED_BACKEND, 'project-run-layout.js')
);
const { materializeFinalReport } = require(path.join(R_HELPERS, 'final-report.js'));

let tmpRoot;
let workspaceRoot;
const projectId = 'p_artitest';
const toolJobId = 'tj_artitest_0001';

function stubDb(workspacePath, status = 'active') {
  return {
    getProject: (id) =>
      id === projectId
        ? { id, name: 'Arti Test', status, user_id: 'u_arti', workspace_path: workspacePath }
        : null,
  };
}

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-arti-sandbox-'));
  workspaceRoot = path.join(tmpRoot, 'arti-workspace');
  fs.mkdirSync(workspaceRoot, { recursive: true });
});

after(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {}
});

describe('Phase 4: 目录契约 — results/exports', () => {
  it('resolver 返回 exportsDir = <workspace>/results/exports 并在 ensureDirs 时创建', () => {
    const layout = resolveProjectRunLayout({
      projectId,
      toolJobId,
      db: stubDb(workspaceRoot),
      userId: 'u_arti',
      ensureDirs: true,
    });
    assert.equal(
      path.resolve(layout.exportsDir),
      path.resolve(path.join(workspaceRoot, 'results', 'exports'))
    );
    assert.ok(fs.existsSync(layout.jobRoot), 'jobRoot 应创建');
    // exports 是结果根级共享目录
    assert.equal(path.dirname(layout.exportsDir), path.resolve(layout.resultsRoot));
  });
});

describe('Phase 4: 最终报告在 output/ 生成 + 导出副本进 results/exports/', () => {
  it('materializeFinalReport 在 output/ 写 final-report.html 并内嵌图片', () => {
    const layout = resolveProjectRunLayout({
      projectId,
      toolJobId: 'tj_artitest_report',
      db: stubDb(workspaceRoot),
      userId: 'u_arti',
      ensureDirs: true,
    });
    // 造一张图 + 一个引用它的报告模板
    fs.writeFileSync(path.join(layout.outputDir, 'plot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    fs.writeFileSync(
      path.join(layout.outputDir, 'report.html'),
      '<html><head></head><body><img src="plot.png"/></body></html>'
    );

    const report = materializeFinalReport({ outputDir: layout.outputDir });
    const finalPath = path.join(layout.outputDir, report.fileName);
    assert.ok(fs.existsSync(finalPath), 'final-report.html 应在 output/ 生成');
    const html = fs.readFileSync(finalPath, 'utf8');
    assert.match(html, /data:image\/png;base64,/, '图片应内嵌为 data URI（自包含）');
    assert.doesNotMatch(html, /src="plot\.png"/, '不应再有外部相对引用');
  });

  it('导出副本落到 results/exports/ 且可从项目文件树路径发现', () => {
    const layout = resolveProjectRunLayout({
      projectId,
      toolJobId: 'tj_artitest_export',
      db: stubDb(workspaceRoot),
      userId: 'u_arti',
      ensureDirs: true,
    });
    fs.writeFileSync(
      path.join(layout.outputDir, 'report.html'),
      '<html><head></head><body>ok</body></html>'
    );
    const report = materializeFinalReport({ outputDir: layout.outputDir });

    // 模拟 handleGenerateFinalReport 的导出副本逻辑
    fs.mkdirSync(layout.exportsDir, { recursive: true });
    const exportName = `tj_artitest_export-${report.fileName}`;
    const exportTarget = safeJoinUnder(layout.exportsDir, exportName);
    assert.ok(exportTarget, '导出目标应通过 containment');
    fs.copyFileSync(path.join(layout.outputDir, report.fileName), exportTarget);

    assert.ok(fs.existsSync(exportTarget), '导出副本应存在于 results/exports/');
    // 相对项目根的路径（文件树可发现）
    const rel = path.relative(workspaceRoot, exportTarget);
    assert.equal(rel, path.join('results', 'exports', exportName));
  });
});

describe('Phase 4: 路径 containment 防护', () => {
  it('safeJoinUnder 拒绝 ../ 逃逸出 output/ 边界', () => {
    const layout = resolveProjectRunLayout({
      projectId,
      toolJobId: 'tj_artitest_guard',
      db: stubDb(workspaceRoot),
      userId: 'u_arti',
      ensureDirs: true,
    });
    assert.equal(
      safeJoinUnder(layout.outputDir, '../../../../etc/passwd'),
      null,
      '路径遍历应被拒绝'
    );
    const ok = safeJoinUnder(layout.outputDir, 'plot.png');
    assert.ok(ok && isPathContained(layout.outputDir, ok), '正常文件名应通过并 contained');
  });
});

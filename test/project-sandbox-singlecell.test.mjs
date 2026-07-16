/**
 * test/project-sandbox-singlecell.test.mjs
 *
 * Phase 5b: 单细胞 step 引擎收敛测试
 *
 * 验证 helpers/step-tool-job.js 的 materializeStepArtifactsToProject：
 * - 项目作用域 step 运行（__harness 带 projectId + toolJobId）：ephemeral workDir 里的
 *   已声明产物被物化到项目沙盒 <workspace>/results/jobs/<toolJobId>/output/
 * - 非项目运行（无 projectId/toolJobId）：返回 null（保持旧行为）
 * - workDir 不存在：返回 null
 * - 只物化已声明产物 + summary.json，且经 safeJoin containment
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

const R_SERVER = path.join(__dirname, '..', 'core', 'r-server');
const db = require(path.join(R_SERVER, 'db.js'));
const { materializeStepArtifactsToProject } = require(
  path.join(R_SERVER, 'helpers', 'step-tool-job.js')
);

let tmpRoot;
let workspaceRoot;
const projectId = 'p_sctest';
let savedGetProject;

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-sc-sandbox-'));
  workspaceRoot = path.join(tmpRoot, 'sc-workspace');
  fs.mkdirSync(workspaceRoot, { recursive: true });
  savedGetProject = db.getProject;
  db.getProject = (id) =>
    id === projectId
      ? { id, name: 'SC Test', status: 'active', user_id: 'u_sc', workspace_path: workspaceRoot }
      : null;
});

after(() => {
  db.getProject = savedGetProject;
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {}
});

function makeWorkDir(taskId) {
  const workDir = path.join(tmpRoot, 'tmp', `task-${taskId}`);
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(path.join(workDir, 'plot_1_umap.png'), 'PNG');
  fs.writeFileSync(path.join(workDir, 'deg.csv'), 'gene,logfc\nA,1\n');
  fs.writeFileSync(path.join(workDir, 'summary.json'), '{"clusters":5}');
  // 中间态大文件不应被物化（未在 results 声明）
  fs.writeFileSync(path.join(workDir, 'result.rds'), 'RDSBLOB');
  fs.writeFileSync(path.join(workDir, 'run_task.R'), '# script');
  return workDir;
}

describe('Phase 5b: 单细胞 step 产物物化到项目沙盒', () => {
  it('项目作用域运行：已声明产物物化到 <workspace>/results/jobs/<toolJobId>/output/', () => {
    const taskId = 'sc_task_1';
    const toolJobId = 'tj_sc_1';
    const workDir = makeWorkDir(taskId);
    const task = { taskId, workDir, params: { __harness: { projectId, toolJobId } } };
    const results = {
      plots: [{ filename: 'plot_1_umap.png', name: 'umap' }],
      files: [{ name: 'deg.csv' }],
    };

    const out = materializeStepArtifactsToProject({ task, results });
    assert.ok(out, '应返回物化结果');

    const expectedOutput = path.join(workspaceRoot, 'results', 'jobs', toolJobId, 'output');
    assert.equal(path.resolve(out.outputDir), path.resolve(expectedOutput));
    assert.ok(fs.existsSync(path.join(expectedOutput, 'plot_1_umap.png')), 'plot 应被物化');
    assert.ok(fs.existsSync(path.join(expectedOutput, 'deg.csv')), 'csv 应被物化');
    assert.ok(fs.existsSync(path.join(expectedOutput, 'summary.json')), 'summary 应被物化');
    // 未声明的中间态/脚本不应物化
    assert.ok(!fs.existsSync(path.join(expectedOutput, 'result.rds')), '未声明的 rds 不物化');
    assert.ok(!fs.existsSync(path.join(expectedOutput, 'run_task.R')), '脚本不物化');
    assert.deepEqual(out.copied.sort(), ['deg.csv', 'plot_1_umap.png', 'summary.json']);
  });

  it('非项目运行（无 projectId/toolJobId）→ 返回 null（保持旧行为）', () => {
    const taskId = 'sc_task_2';
    const workDir = makeWorkDir(taskId);
    const task = { taskId, workDir, params: {} };
    const results = { plots: [{ filename: 'plot_1_umap.png' }], files: [] };
    assert.equal(materializeStepArtifactsToProject({ task, results }), null);
  });

  it('workDir 不存在 → 返回 null', () => {
    const task = {
      taskId: 'sc_task_3',
      workDir: path.join(tmpRoot, 'nope'),
      params: { __harness: { projectId, toolJobId: 'tj_sc_3' } },
    };
    assert.equal(materializeStepArtifactsToProject({ task, results: { plots: [], files: [] } }), null);
  });
});

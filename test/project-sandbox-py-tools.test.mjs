/**
 * test/project-sandbox-py-tools.test.mjs
 *
 * Phase 2: Python 工具入口收敛真实临时目录测试
 *
 * 验证 py-server/tools-router.js 的路径解析：
 * - 带 projectId → 结果落在 <workspace>/results/jobs/<jobId>（项目沙盒）
 * - 无 projectId → 兜底全局 JOBS_DIR
 * - 已存在 job 的读取/清理三层回退（项目 → 全局 → 历史 result_json）
 * - 路径遍历防护
 *
 * 通过 stub rdb.getProject 提供项目记录，不依赖真实 DB。
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

const PY_SERVER_DIR = path.join(
  __dirname,
  '..',
  'vendor',
  'biof3-core',
  'py-server'
);

const rdb = require(path.join(PY_SERVER_DIR, 'r-server-db.js'));
const toolsRouter = require(path.join(PY_SERVER_DIR, 'tools-router.js'));
const { resolveRunLayout, resolveExistingJobDir, resolveJobFilePath, JOBS_DIR } =
  toolsRouter._test;

let tmpRoot;
let workspaceRoot;
const projectId = 'p_pytest_project';
let savedGetProject;

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-py-sandbox-'));
  workspaceRoot = path.join(tmpRoot, 'my-workspace');
  fs.mkdirSync(workspaceRoot, { recursive: true });

  savedGetProject = rdb.getProject;
  rdb.getProject = (id) => {
    if (id === projectId) {
      return {
        id: projectId,
        name: 'Py Test Project',
        status: 'active',
        user_id: 'u_pytest',
        workspace_path: workspaceRoot,
      };
    }
    if (id === 'p_archived') {
      return {
        id: 'p_archived',
        name: 'Archived',
        status: 'archived',
        user_id: 'u_pytest',
        workspace_path: workspaceRoot,
      };
    }
    return null;
  };
});

after(() => {
  rdb.getProject = savedGetProject;
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {}
});

describe('Phase 2: Python 工具路径解析', () => {
  it('带 projectId 时结果落在项目 workspace 沙盒', () => {
    const jobId = 'job_pytest0001';
    const layout = resolveRunLayout({ jobId, projectId, userId: 'u_pytest' });

    const expectedJobRoot = path.join(workspaceRoot, 'results', 'jobs', jobId);
    assert.equal(path.resolve(layout.jobDir), path.resolve(expectedJobRoot));
    assert.equal(
      path.resolve(layout.outputDir),
      path.resolve(path.join(expectedJobRoot, 'output'))
    );
    // resolver 创建了目录结构
    assert.ok(fs.existsSync(layout.outputDir), 'output 目录应被创建');
  });

  it('无 projectId 时兜底到全局 JOBS_DIR', () => {
    const jobId = 'job_pytest0002';
    const layout = resolveRunLayout({ jobId });
    assert.equal(path.resolve(layout.jobDir), path.resolve(path.join(JOBS_DIR, jobId)));
  });

  it('拒绝已归档项目', () => {
    assert.throws(
      () => resolveRunLayout({ jobId: 'job_x', projectId: 'p_archived', userId: 'u_pytest' }),
      /archived/i
    );
  });

  it('拒绝不存在的 projectId', () => {
    assert.throws(
      () => resolveRunLayout({ jobId: 'job_x', projectId: 'p_missing', userId: 'u_pytest' }),
      /not found/i
    );
  });

  it('resolveExistingJobDir 优先返回项目沙盒目录', () => {
    const jobId = 'job_pytest0003';
    // 先创建项目沙盒目录
    resolveRunLayout({ jobId, projectId, userId: 'u_pytest' });
    const job = { id: jobId, project_id: projectId };
    const resolved = resolveExistingJobDir(job);
    const expected = path.join(workspaceRoot, 'results', 'jobs', jobId);
    assert.equal(path.resolve(resolved), path.resolve(expected));
  });

  it('resolveJobFilePath 返回项目沙盒中的文件并防止路径遍历', () => {
    const jobId = 'job_pytest0004';
    const layout = resolveRunLayout({ jobId, projectId, userId: 'u_pytest' });
    fs.writeFileSync(path.join(layout.outputDir, 'plot.png'), 'x');
    const job = { id: jobId, project_id: projectId };

    const ok = resolveJobFilePath(job, 'plot.png');
    assert.equal(path.resolve(ok), path.resolve(path.join(layout.outputDir, 'plot.png')));

    // 路径遍历应被拒绝（返回 null）
    const escape = resolveJobFilePath(job, '../../../../etc/passwd');
    assert.equal(escape, null, '路径遍历应被拒绝');
  });

  it('历史 job（无 project_id）从 result_json 记录的旧路径回读', () => {
    const jobId = 'job_pytest_legacy';
    const legacyOutput = path.join(tmpRoot, 'legacy', jobId, 'output');
    fs.mkdirSync(legacyOutput, { recursive: true });
    const job = {
      id: jobId,
      project_id: null,
      result_json: JSON.stringify({ outputDir: legacyOutput }),
    };
    const resolved = resolveExistingJobDir(job);
    assert.equal(
      path.resolve(resolved),
      path.resolve(path.dirname(legacyOutput))
    );
  });
});

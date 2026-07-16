/**
 * test/project-sandbox-mcp-tools.test.mjs
 *
 * Phase 3: MCP/Agent 工具入口收敛测试
 *
 * 验证 r-server/mcp/registry.js 的物理目录解析：
 * - 物理目录主键统一使用正式 tool_job.id（不再用 mcp_* 身份）
 * - 带 projectId → 结果落在 <workspace>/results/jobs/<toolJobId>（项目沙盒）
 * - 无 projectId → 落共享全局 tool-jobs/<toolJobId>（不再是独立 mcp-tool-jobs）
 * - 归档/无权限项目 → 硬失败（throw），不静默写全局
 *
 * 通过 stub db.getProject 提供项目记录，不依赖真实 project 数据。
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

const R_SERVER = path.join(__dirname, '..', 'vendor', 'biof3-core', 'r-server');
const db = require(path.join(R_SERVER, 'db.js'));
const registry = require(path.join(R_SERVER, 'mcp', 'registry.js'));
const { resolveMcpJobLayout, GLOBAL_JOBS_DIR } = registry._test;

let tmpRoot;
let workspaceRoot;
const projectId = 'p_mcptest_project';
let savedGetProject;
const createdDirs = [];

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-mcp-sandbox-'));
  workspaceRoot = path.join(tmpRoot, 'mcp-workspace');
  fs.mkdirSync(workspaceRoot, { recursive: true });

  savedGetProject = db.getProject;
  db.getProject = (id) => {
    if (id === projectId) {
      return {
        id: projectId,
        name: 'MCP Test Project',
        status: 'active',
        user_id: 'u_mcptest',
        workspace_path: workspaceRoot,
      };
    }
    if (id === 'p_archived') {
      return {
        id: 'p_archived',
        name: 'Archived',
        status: 'archived',
        user_id: 'u_mcptest',
        workspace_path: workspaceRoot,
      };
    }
    return null;
  };
});

after(() => {
  db.getProject = savedGetProject;
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {}
  for (const d of createdDirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {}
  }
});

describe('Phase 3: MCP/Agent 工具物理目录解析', () => {
  it('带 projectId + toolJobId 时结果落在项目沙盒（以 tool_job.id 为主键）', () => {
    const toolJobId = 'tj_mcptest_0001';
    const layout = resolveMcpJobLayout({ toolJobId, projectId, userId: 'u_mcptest' });

    const expectedJobRoot = path.join(workspaceRoot, 'results', 'jobs', toolJobId);
    assert.equal(path.resolve(layout.jobDir), path.resolve(expectedJobRoot));
    assert.equal(
      path.resolve(layout.outputDir),
      path.resolve(path.join(expectedJobRoot, 'output'))
    );
    assert.ok(fs.existsSync(layout.outputDir), 'output 目录应被创建');
  });

  it('无 projectId 时落共享全局 tool-jobs（以 tool_job.id 为主键，不是 mcp-tool-jobs）', () => {
    const toolJobId = 'tj_mcptest_0002';
    const layout = resolveMcpJobLayout({ toolJobId, userId: 'u_mcptest' });
    createdDirs.push(layout.jobDir);

    assert.equal(
      path.resolve(layout.jobDir),
      path.resolve(path.join(GLOBAL_JOBS_DIR, toolJobId))
    );
    // 收敛证据：全局根是 tool-jobs，不再是独立的 mcp-tool-jobs
    assert.ok(GLOBAL_JOBS_DIR.endsWith(`${path.sep}tool-jobs`), 'GLOBAL_JOBS_DIR 应为 tool-jobs');
    assert.ok(!GLOBAL_JOBS_DIR.includes('mcp-tool-jobs'), '不应再默认写 mcp-tool-jobs');
  });

  it('归档项目 → 抛错（硬失败，不静默写全局）', () => {
    assert.throws(
      () => resolveMcpJobLayout({ toolJobId: 'tj_x', projectId: 'p_archived', userId: 'u_mcptest' }),
      /archived/i
    );
  });

  it('不存在的 projectId → 抛错', () => {
    assert.throws(
      () => resolveMcpJobLayout({ toolJobId: 'tj_x', projectId: 'p_missing', userId: 'u_mcptest' }),
      /not found/i
    );
  });

  it('db 不可用（无 toolJobId、无 projectId）→ 回退临时 mcp_ 身份，仅保证不崩', () => {
    const layout = resolveMcpJobLayout({ userId: 'u_mcptest' });
    createdDirs.push(layout.jobDir);
    assert.ok(path.dirname(layout.jobDir) === path.resolve(GLOBAL_JOBS_DIR));
    assert.match(path.basename(layout.jobDir), /^mcp_/);
  });
});

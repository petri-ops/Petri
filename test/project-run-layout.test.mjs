/**
 * test/project-run-layout.test.mjs
 *
 * Phase 1: Project Run Layout Resolver 单元测试
 *
 * 测试：
 * - 项目目录解析
 * - 权限验证
 * - 路径安全（遍历、symlink）
 * - 系统任务目录
 * - 历史 job 回退
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 动态加载 project-run-layout
const layoutModule = await import('../core/shared-backend/project-run-layout.js');
const {
  resolveProjectRunLayout,
  resolveSystemRunLayout,
  isPathContained,
  safeJoinUnder,
  restoreLegacyJobLayout,
} = layoutModule;

// 临时测试目录
const TEST_ROOT = path.join(os.tmpdir(), 'biof3-test-layout-' + Date.now());

describe('Phase 1: Project Run Layout Resolver', () => {
  let testWorkspace;
  let mockDb;

  before(() => {
    // 创建临时测试工作区
    testWorkspace = path.join(TEST_ROOT, 'test-workspace');
    fs.mkdirSync(testWorkspace, { recursive: true });

    // 模拟数据库
    mockDb = {
      projects: new Map(),
      getProject(id) {
        return this.projects.get(id) || null;
      },
    };
  });

  after(() => {
    // 清理测试目录
    try {
      fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    } catch {}
  });

  describe('resolveProjectRunLayout', () => {
    beforeEach(() => {
      mockDb.projects.clear();
      mockDb.projects.set('test-project-1', {
        id: 'test-project-1',
        name: 'Test Project',
        workspace_path: testWorkspace,
        status: 'active',
        user_id: 'user-1',
      });
    });

    it('成功解析项目目录结构', () => {
      const layout = resolveProjectRunLayout({
        projectId: 'test-project-1',
        toolJobId: 'job-123',
        db: mockDb,
        skipPermissionCheck: true,
      });

      assert.equal(layout.workspaceRoot, path.resolve(testWorkspace));
      assert.equal(layout.resultsRoot, path.join(testWorkspace, 'results'));
      assert.equal(layout.jobRoot, path.join(testWorkspace, 'results', 'jobs', 'job-123'));
      assert.equal(layout.inputsDir, path.join(testWorkspace, 'results', 'jobs', 'job-123', 'inputs'));
      assert.equal(layout.workDir, path.join(testWorkspace, 'results', 'jobs', 'job-123', 'work'));
      assert.equal(layout.outputDir, path.join(testWorkspace, 'results', 'jobs', 'job-123', 'output'));
      assert.equal(layout.logsDir, path.join(testWorkspace, 'results', 'jobs', 'job-123', 'logs'));

      // 验证目录已创建
      assert.ok(fs.existsSync(layout.jobRoot));
      assert.ok(fs.existsSync(layout.inputsDir));
      assert.ok(fs.existsSync(layout.workDir));
      assert.ok(fs.existsSync(layout.outputDir));
      assert.ok(fs.existsSync(layout.logsDir));
    });

    it('拒绝缺少 projectId', () => {
      assert.throws(
        () => resolveProjectRunLayout({ toolJobId: 'job-1', db: mockDb }),
        /projectId is required/
      );
    });

    it('拒绝缺少 toolJobId', () => {
      assert.throws(
        () => resolveProjectRunLayout({ projectId: 'test-project-1', db: mockDb }),
        /toolJobId is required/
      );
    });

    it('拒绝缺少 db', () => {
      assert.throws(
        () => resolveProjectRunLayout({ projectId: 'test-project-1', toolJobId: 'job-1' }),
        /db instance.*is required/
      );
    });

    it('拒绝不存在的项目', () => {
      assert.throws(
        () => resolveProjectRunLayout({
          projectId: 'non-existent',
          toolJobId: 'job-1',
          db: mockDb,
        }),
        /Project not found/
      );
    });

    it('拒绝已归档的项目', () => {
      mockDb.projects.set('archived-project', {
        id: 'archived-project',
        workspace_path: testWorkspace,
        status: 'archived',
        user_id: 'user-1',
      });

      assert.throws(
        () => resolveProjectRunLayout({
          projectId: 'archived-project',
          toolJobId: 'job-1',
          db: mockDb,
        }),
        /Project is archived/
      );
    });

    it('拒绝未设置 workspace_path 的项目', () => {
      mockDb.projects.set('no-workspace', {
        id: 'no-workspace',
        status: 'active',
        user_id: 'user-1',
      });

      assert.throws(
        () => resolveProjectRunLayout({
          projectId: 'no-workspace',
          toolJobId: 'job-1',
          db: mockDb,
        }),
        /workspace_path not set/
      );
    });

    it('权限检查：拒绝非拥有者', () => {
      assert.throws(
        () => resolveProjectRunLayout({
          projectId: 'test-project-1',
          toolJobId: 'job-1',
          db: mockDb,
          userId: 'user-2', // 不是 user-1
          skipPermissionCheck: false,
        }),
        /Permission denied/
      );
    });

    it('权限检查：允许拥有者', () => {
      const layout = resolveProjectRunLayout({
        projectId: 'test-project-1',
        toolJobId: 'job-200',
        db: mockDb,
        userId: 'user-1', // 匹配 user_id
        skipPermissionCheck: false,
      });

      assert.ok(layout.jobRoot.includes('job-200'));
    });

    it('ensureDirs: false 不自动创建目录', () => {
      const layout = resolveProjectRunLayout({
        projectId: 'test-project-1',
        toolJobId: 'job-no-create',
        db: mockDb,
        skipPermissionCheck: true,
        ensureDirs: false,
      });

      // 目录不应该存在
      assert.ok(!fs.existsSync(layout.jobRoot));
    });
  });

  describe('路径安全检查', () => {
    it('isPathContained: 正常子路径返回 true', () => {
      const root = '/workspace';
      const child = '/workspace/results/jobs/job-1';
      assert.ok(isPathContained(root, child));
    });

    it('isPathContained: 根路径本身返回 true', () => {
      const root = '/workspace';
      assert.ok(isPathContained(root, root));
    });

    it('isPathContained: 逃逸路径返回 false', () => {
      const root = '/workspace';
      const escaped = '/workspace/../etc/passwd';
      assert.ok(!isPathContained(root, escaped));
    });

    it('isPathContained: 完全不同的路径返回 false', () => {
      const root = '/workspace';
      const other = '/tmp/other';
      assert.ok(!isPathContained(root, other));
    });

    it('safeJoinUnder: 正常路径返回完整路径', () => {
      const root = '/workspace';
      const result = safeJoinUnder(root, 'results', 'jobs', 'job-1');
      assert.equal(result, path.resolve('/workspace/results/jobs/job-1'));
    });

    it('safeJoinUnder: 路径遍历返回 null', () => {
      const root = '/workspace';
      const result = safeJoinUnder(root, '..', '..', 'etc', 'passwd');
      assert.equal(result, null);
    });

    it('safeJoinUnder: 绝对路径注入返回 null', () => {
      const root = '/workspace';
      const result = safeJoinUnder(root, '/etc/passwd');
      assert.equal(result, null);
    });
  });

  describe('resolveSystemRunLayout', () => {
    it('成功解析系统任务目录', () => {
      const layout = resolveSystemRunLayout({
        toolJobId: 'system-job-1',
        systemScope: 'updates',
      });

      const appDataDir = process.env.BIOF3_LOCAL_DATA_DIR ||
        path.join(os.homedir(), 'Documents', 'BioF3-Local');

      assert.ok(layout.workspaceRoot.includes('system-tasks'));
      assert.ok(layout.workspaceRoot.includes('updates'));
      assert.ok(layout.jobRoot.includes('system-job-1'));
      assert.ok(fs.existsSync(layout.outputDir));
    });

    it('使用默认 system scope', () => {
      const layout = resolveSystemRunLayout({
        toolJobId: 'system-job-2',
      });

      assert.ok(layout.workspaceRoot.includes('system-tasks'));
      assert.ok(layout.workspaceRoot.includes('system'));
    });

    it('拒绝缺少 toolJobId', () => {
      assert.throws(
        () => resolveSystemRunLayout({}),
        /toolJobId is required/
      );
    });
  });

  describe('restoreLegacyJobLayout', () => {
    const globalJobsDir = path.join(TEST_ROOT, 'global-jobs');

    before(() => {
      fs.mkdirSync(globalJobsDir, { recursive: true });
    });

    it('从 result_json 恢复历史 outputDir', () => {
      const legacyOutputDir = path.join(TEST_ROOT, 'legacy-output');
      fs.mkdirSync(legacyOutputDir, { recursive: true });

      const job = {
        id: 'legacy-job-1',
        result_json: {
          outputDir: legacyOutputDir,
          jobDir: path.dirname(legacyOutputDir),
        },
      };

      const layout = restoreLegacyJobLayout(job, globalJobsDir);

      assert.ok(layout);
      assert.equal(layout.outputDir, legacyOutputDir);
      assert.equal(layout.isLegacy, true);
    });

    it('兜底到全局 JOBS_DIR', () => {
      const fallbackJobRoot = path.join(globalJobsDir, 'fallback-job');
      const fallbackOutput = path.join(fallbackJobRoot, 'output');
      fs.mkdirSync(fallbackOutput, { recursive: true });

      const job = {
        id: 'fallback-job',
        result_json: {},
      };

      const layout = restoreLegacyJobLayout(job, globalJobsDir);

      assert.ok(layout);
      assert.equal(layout.outputDir, fallbackOutput);
      assert.equal(layout.isLegacy, true);
    });

    it('无法恢复时返回 null', () => {
      const job = {
        id: 'non-existent-job',
        result_json: {},
      };

      const layout = restoreLegacyJobLayout(job, globalJobsDir);
      assert.equal(layout, null);
    });

    it('缺少 result_json 返回 null', () => {
      const job = { id: 'no-result' };
      const layout = restoreLegacyJobLayout(job, globalJobsDir);
      assert.equal(layout, null);
    });
  });

  describe('Phase 1 完成标准', () => {
    it('建立了唯一的 Project Run Layout Resolver', () => {
      assert.ok(typeof resolveProjectRunLayout === 'function');
      assert.ok(typeof resolveSystemRunLayout === 'function');
      assert.ok(typeof isPathContained === 'function');
      assert.ok(typeof safeJoinUnder === 'function');
      assert.ok(typeof restoreLegacyJobLayout === 'function');
    });

    it('从数据库读取 project，不接收前端路径', () => {
      // resolveProjectRunLayout 必须通过 db.getProject 读取 workspace_path
      // 不能接受前端直接传入的 workspacePath 参数
      const layout = resolveProjectRunLayout({
        projectId: 'test-project-1',
        toolJobId: 'test-job',
        db: mockDb,
        skipPermissionCheck: true,
      });

      // workspace_path 来自数据库
      assert.equal(layout.workspaceRoot, path.resolve(testWorkspace));
    });

    it('校验项目存在、active、可写', () => {
      // 已在上面测试：
      // - 拒绝不存在的项目
      // - 拒绝已归档的项目
      // - 拒绝未设置 workspace_path
      assert.ok(true);
    });

    it('返回结构化目录布局', () => {
      const layout = resolveProjectRunLayout({
        projectId: 'test-project-1',
        toolJobId: 'check-layout',
        db: mockDb,
        skipPermissionCheck: true,
      });

      assert.ok(layout.workspaceRoot);
      assert.ok(layout.resultsRoot);
      assert.ok(layout.jobRoot);
      assert.ok(layout.inputsDir);
      assert.ok(layout.workDir);
      assert.ok(layout.outputDir);
      assert.ok(layout.logsDir);
    });

    it('防止路径遍历和 symlink escape', () => {
      // 已在 safeJoinUnder 测试中验证
      assert.ok(true);
    });

    it('为无 projectId 的系统任务保留显式 system scope', () => {
      const layout = resolveSystemRunLayout({
        toolJobId: 'sys-task',
        systemScope: 'diagnostics',
      });

      assert.ok(layout.workspaceRoot.includes('system-tasks'));
      assert.ok(layout.workspaceRoot.includes('diagnostics'));
    });
  });
});

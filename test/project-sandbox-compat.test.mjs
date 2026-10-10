/**
 * test/project-sandbox-compat.test.mjs
 *
 * Phase 5: 兼容性、workspace 变更、系统作用域测试
 *
 * 验证：
 * - 历史 job 不自动搬迁：优先从 result_json 记录的旧路径回读（restoreLegacyJobLayout）
 * - 历史 job result_json 路径不存在时兜底全局 JOBS_DIR，仍不搬迁
 * - 更换 workspace 后：新 job 写新 workspace，旧 job 按各自持久化路径继续可读
 * - 系统任务显式 system scope，不静默回退项目/全局目录
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

const SHARED_BACKEND = path.join(__dirname, '..', 'core', 'shared-backend');
const { resolveProjectRunLayout, resolveSystemRunLayout, restoreLegacyJobLayout } = require(
  path.join(SHARED_BACKEND, 'project-run-layout.js')
);

let tmpRoot;
const projectId = 'p_compat';

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-compat-sandbox-'));
});

after(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {}
});

function stubDb(workspacePath) {
  return {
    getProject: (id) =>
      id === projectId
        ? { id, name: 'Compat', status: 'active', user_id: 'u_c', workspace_path: workspacePath }
        : null,
  };
}

describe('Phase 5: 历史 job 不自动搬迁', () => {
  it('优先从 result_json 记录的旧路径回读', () => {
    const legacyJobDir = path.join(tmpRoot, 'legacy-global', 'tool-jobs', 'tj_old_1');
    const legacyOutput = path.join(legacyJobDir, 'output');
    fs.mkdirSync(legacyOutput, { recursive: true });
    fs.writeFileSync(path.join(legacyOutput, 'plot.png'), 'x');

    const job = {
      id: 'tj_old_1',
      result_json: JSON.stringify({ jobDir: legacyJobDir, outputDir: legacyOutput }),
    };
    const restored = restoreLegacyJobLayout(job, null);
    assert.ok(restored, '应能从 result_json 恢复');
    assert.equal(restored.isLegacy, true);
    assert.equal(path.resolve(restored.outputDir), path.resolve(legacyOutput));
    assert.equal(path.resolve(restored.jobRoot), path.resolve(legacyJobDir));
  });

  it('result_json 路径不存在时兜底全局 JOBS_DIR（仍不搬迁）', () => {
    const globalJobsDir = path.join(tmpRoot, 'global2', 'tool-jobs');
    const globalOutput = path.join(globalJobsDir, 'tj_old_2', 'output');
    fs.mkdirSync(globalOutput, { recursive: true });

    const job = {
      id: 'tj_old_2',
      result_json: JSON.stringify({ outputDir: '/nonexistent/path/output' }),
    };
    const restored = restoreLegacyJobLayout(job, globalJobsDir);
    assert.ok(restored, '应兜底到全局 JOBS_DIR');
    assert.equal(path.resolve(restored.outputDir), path.resolve(globalOutput));
  });

  it('无 result_json 且全局无目录 → 返回 null（不臆造路径）', () => {
    const restored = restoreLegacyJobLayout({ id: 'tj_none' }, path.join(tmpRoot, 'empty'));
    assert.equal(restored, null);
  });
});

describe('Phase 5: 更换 workspace 不移动历史结果', () => {
  it('新 job 写新 workspace；旧 job 按持久化路径继续可读', () => {
    const oldWorkspace = path.join(tmpRoot, 'ws-old');
    const newWorkspace = path.join(tmpRoot, 'ws-new');
    fs.mkdirSync(oldWorkspace, { recursive: true });
    fs.mkdirSync(newWorkspace, { recursive: true });

    // 旧 job 在旧 workspace 落地
    const oldLayout = resolveProjectRunLayout({
      projectId,
      toolJobId: 'tj_ws_old',
      db: stubDb(oldWorkspace),
      userId: 'u_c',
      ensureDirs: true,
    });
    fs.writeFileSync(path.join(oldLayout.outputDir, 'old.png'), 'x');
    const oldJob = {
      id: 'tj_ws_old',
      result_json: JSON.stringify({ jobDir: oldLayout.jobRoot, outputDir: oldLayout.outputDir }),
    };

    // workspace 变更后，新 job 用新 workspace
    const newLayout = resolveProjectRunLayout({
      projectId,
      toolJobId: 'tj_ws_new',
      db: stubDb(newWorkspace),
      userId: 'u_c',
      ensureDirs: true,
    });
    assert.ok(
      newLayout.jobRoot.startsWith(path.resolve(newWorkspace)),
      '新 job 应落在新 workspace'
    );

    // 旧 job 仍按持久化的旧路径可读（未被搬迁）
    const restoredOld = restoreLegacyJobLayout(oldJob, null);
    assert.ok(fs.existsSync(path.join(restoredOld.outputDir, 'old.png')), '旧结果仍在旧 workspace');
    assert.ok(
      restoredOld.outputDir.startsWith(path.resolve(oldWorkspace)),
      '旧 job 路径仍指向旧 workspace，未搬迁'
    );
  });
});

describe('Phase 5: 系统任务显式 system scope', () => {
  it('resolveSystemRunLayout 落 system-tasks/<scope>，不落项目/全局 tool-jobs', () => {
    const prevDataDir = process.env.PETRI_LOCAL_DATA_DIR;
    process.env.PETRI_LOCAL_DATA_DIR = path.join(tmpRoot, 'appdata');
    try {
      const layout = resolveSystemRunLayout({ toolJobId: 'tj_sys_1', systemScope: 'updates' });
      const expectedRoot = path.join(tmpRoot, 'appdata', 'system-tasks', 'updates');
      assert.equal(path.resolve(layout.workspaceRoot), path.resolve(expectedRoot));
      assert.ok(layout.jobRoot.includes(path.join('system-tasks', 'updates')));
      assert.ok(fs.existsSync(layout.outputDir), 'system 任务 output 目录应创建');
      // 不得落在项目 results 或全局 tool-jobs
      assert.ok(!layout.jobRoot.includes(`${path.sep}tool-jobs${path.sep}`));
    } finally {
      if (prevDataDir === undefined) delete process.env.PETRI_LOCAL_DATA_DIR;
      else process.env.PETRI_LOCAL_DATA_DIR = prevDataDir;
    }
  });

  it('系统任务缺 toolJobId → 抛错（不静默回退）', () => {
    assert.throws(() => resolveSystemRunLayout({ systemScope: 'diagnostics' }), /toolJobId is required/);
  });
});

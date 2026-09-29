import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import resultFiles from '../core/biof3-server/helpers/tools-executor/result-files.js';

const { resolveToolJobExportDirs } = resultFiles;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const toolsPlatformSource = fs.readFileSync(
  path.join(repoRoot, 'core', 'biof3-server', 'routes', 'tools-platform.js'),
  'utf8',
);

function makeJob(overrides = {}) {
  return { id: 'job-abc123', project_id: null, ...overrides };
}

// C-21：批量导出只扫全局 tool-jobs 目录，有 project_id 的 job 产物在项目布局
// jobRoot（<workspace>/results/jobs/<id>）被 existsSync 静默跳过。本契约钉死
// resolveToolJobExportDirs 的候选链语义（纯函数不做 IO）与路由接线守卫。
describe('block135 export layout fallback (C-21)', () => {
  it('C21-1 有 project_id 且 workspace_path 可得 → 候选首项为项目布局 jobRoot，全局目录兜底其后', () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'block135-ws-'));
    try {
      const candidates = resolveToolJobExportDirs({
        job: makeJob({ project_id: 'proj-1' }),
        jobsDir: path.join('global-root', 'tool-jobs'),
        getProjectWorkspacePath: (projectId) => {
          assert.strictEqual(projectId, 'proj-1');
          return workspaceRoot;
        },
      });
      assert.deepStrictEqual(candidates, [
        path.join(workspaceRoot, 'results', 'jobs', 'job-abc123'),
        path.join('global-root', 'tool-jobs', 'job-abc123'),
      ]);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('C21-2 无 project_id → 仅全局目录（getter 不被调用）', () => {
    const candidates = resolveToolJobExportDirs({
      job: makeJob(),
      jobsDir: path.join('global-root', 'tool-jobs'),
      getProjectWorkspacePath: () => {
        throw new Error('无 project_id 时不应查询 workspace_path');
      },
    });
    assert.deepStrictEqual(candidates, [
      path.join('global-root', 'tool-jobs', 'job-abc123'),
    ]);
  });

  it("C21-3 项目行缺 workspace_path（getter 返回 null/undefined/''）→ 仅全局目录", () => {
    for (const missing of [null, undefined, '']) {
      const candidates = resolveToolJobExportDirs({
        job: makeJob({ project_id: 'proj-2' }),
        jobsDir: path.join('global-root', 'tool-jobs'),
        getProjectWorkspacePath: () => missing,
      });
      assert.deepStrictEqual(candidates, [
        path.join('global-root', 'tool-jobs', 'job-abc123'),
      ]);
    }
  });

  it('C21-4 非法 job.id（路径穿越/空）→ 空候选链，不产出目录', () => {
    for (const badId of ['../escape', 'a/b', '', null]) {
      const candidates = resolveToolJobExportDirs({
        job: makeJob({ id: badId, project_id: 'proj-3' }),
        jobsDir: path.join('global-root', 'tool-jobs'),
        getProjectWorkspacePath: () => path.join('ws', 'root'),
      });
      assert.deepStrictEqual(candidates, []);
    }
  });

  it('C21-5 源码守卫：tools-platform.js 导出循环引用 resolveToolJobExportDirs（防回归漏接线）', () => {
    assert.ok(
      toolsPlatformSource.includes("require('../helpers/tools-executor/result-files')"),
      'export 处理器必须 require result-files',
    );
    assert.ok(
      toolsPlatformSource.includes('resolveToolJobExportDirs'),
      'export 处理器必须使用 resolveToolJobExportDirs 解析候选目录链',
    );
  });

  it('C21-6 行为测：项目与全局目录同时存在时按序取第一个存在的（项目布局优先）', () => {
    // 候选选择语义=resolveToolJobExportDirs 顺序 + 调用方 find(existsSync)。
    // 用真实临时目录复现「两处都有」形态，锁定首选=项目布局。
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'block135-c216-'));
    try {
      const job = { id: 'job_c216', project_id: 'p_c216' };
      const projectDir = path.join(root, 'ws', 'results', 'jobs', job.id);
      fs.mkdirSync(projectDir, { recursive: true });
      fs.writeFileSync(path.join(projectDir, 'deg_table.csv'), ['gene', 'X'].join(String.fromCharCode(10)));
      const dirs = resolveToolJobExportDirs({
        job,
        jobsDir: path.join(root, 'global-jobs'),
        getProjectWorkspacePath: () => path.join(root, 'ws'),
      });
      const picked = dirs.find((candidate) => fs.existsSync(candidate));
      assert.strictEqual(picked, projectDir, '两处都存在时必须选项目布局目录');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('C21-7 源码守卫：导出循环必须打包 output/ 子目录（复核 F4 防回归）', () => {
    assert.ok(
      /output/.test(toolsPlatformSource.slice(toolsPlatformSource.indexOf('resolveToolJobExportDirs'))),
      '导出循环必须处理 output/ 子目录（产物与 run.log 所在）',
    );
  });
});

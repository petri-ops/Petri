import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const express = require('express');
const { createToolsMetadataRoutes } = require('../core/biof3-server/routes/tools-metadata.js');
const resultFiles = require('../core/biof3-server/helpers/tools-executor/result-files.js');

const { resolveToolJobExportDirs } = resultFiles;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const toolsMetadataSource = fs.readFileSync(
  path.join(repoRoot, 'core', 'biof3-server', 'routes', 'tools-metadata.js'),
  'utf8',
);

// C-22（BLOCK-144 技术债清尾批）：tool-jobs 布局拼接第三处收敛契约。
//
// 主提名现场 = core/biof3-server/routes/tools-metadata.js:254 —— /api/tools/log/:id
// 日志端点 UI-454 layout 解析失败兜底分支：
//   dirs.push(path.join(projectRow.workspace_path, 'results', 'jobs', job.id, 'output'))
// 其全局兜底孪生 = tools-metadata.js:259：
//   dirs.push(path.join(jobsDir, job.id, 'output'))
// 这是 resolveToolJobExportDirs 候选链（C-21，result-files.js）与
// resolveProjectRunLayout 权威函数之外唯一用字面量手拼项目布局契约的现场，
// 且自拼 /output 后缀（形态与 resolver 产出的 jobRoot 不同）。
//
// 本文件是「收敛前现状锚定」：把两端点的拼接结果（探测目录链 + 命中顺序）
// 用行为快照钉死。后续清偿批若按「收敛单源」把 254/259 纳入
// resolveToolJobExportDirs / resolveProjectRunLayout 复用面，本契约必须
// 零变化通过（回归锚）——拼接产物不变，只换生产方式。

const JOB_ID = 'jobc22anchor';
const PROJECT_ID = 'proj-c22';
const USER_ID = 'user-1';
const PROJECT_FALLBACK_LOG = 'C22-LOG-FROM-PROJECT-FALLBACK';
const GLOBAL_TWIN_LOG = 'C22-LOG-FROM-GLOBAL-TWIN';

// 布局解析失败兜底分支拼接的项目侧目录（tools-metadata.js:254 字面量形态）
function stitchedProjectFallbackDir(workspacePath) {
  return path.join(workspacePath, 'results', 'jobs', JOB_ID, 'output');
}
// 全局兜底孪生目录（tools-metadata.js:259 字面量形态）
function stitchedGlobalTwinDir(jobsDir) {
  return path.join(jobsDir, JOB_ID, 'output');
}

function writeRunLog(dir, content) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'run.log'), content);
}

/**
 * 构造挂了真实 /api/tools/log/:id 路由的 express app。
 *
 * mock db 故意不提供 getProject：resolveProjectRunLayout 的参数校验
 * （project-run-layout.js:63-65）会即抛
 * '[project-run-layout] db instance with getProject method is required'，
 * 从而确定性进入 UI-454 兜底分支（tools-metadata.js:244-257）——
 * 与生产「项目行在但布局解析失败」的现场同构，且不依赖具体报错文案。
 * result_json 为 null + workspace_kind 'local' 使 SSH 直读分支
 * （createJobOutputReader，job-output-reader.js:53 返回 null）被干净跳过。
 */
function buildLogRouteApp({ workspacePath, jobsDir, jobOverrides = {} }) {
  const job = {
    id: JOB_ID,
    tool_id: 'deseq2',
    user_id: USER_ID,
    project_id: PROJECT_ID,
    status: 'completed',
    result_json: null,
    ...jobOverrides,
  };
  const sshProbeRow = { id: PROJECT_ID, workspace_kind: 'local', ssh_host: null, remote_path: null };
  const db = {
    prepare(sql) {
      return {
        get: () => {
          if (sql.includes('FROM tool_jobs')) return job;
          if (sql.includes('FROM projects')) {
            return sql.includes('workspace_kind') ? sshProbeRow : { workspace_path: workspacePath };
          }
          return undefined;
        },
        all: () => [],
        run: () => {},
      };
    },
  };
  const app = express();
  createToolsMetadataRoutes({ db, getUserId: () => USER_ID, jobsDir })(app);
  return app;
}

async function getLogResponse(app) {
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/tools/log/${JOB_ID}`);
    assert.equal(response.status, 200);
    return await response.json();
  } finally {
    server.close();
  }
}

async function withTempRoot(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'block144-c22-'));
  try {
    // 必须 await：否则 finally 会在用例异步体（fetch）完成前就删掉临时目录
    return await run({
      root,
      workspacePath: path.join(root, 'workspace'),
      jobsDir: path.join(root, 'global', 'tool-jobs'),
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('block144 C-22 log endpoint layout convergence contract (tools-metadata.js:254/259)', () => {
  it('C22-1 主提名现状锚定：布局解析失败兜底拼接 <workspace>/results/jobs/<id>/output，且先于全局孪生命中', async () => {
    await withTempRoot(async ({ workspacePath, jobsDir }) => {
      writeRunLog(stitchedProjectFallbackDir(workspacePath), PROJECT_FALLBACK_LOG);
      writeRunLog(stitchedGlobalTwinDir(jobsDir), GLOBAL_TWIN_LOG);
      const body = await getLogResponse(buildLogRouteApp({ workspacePath, jobsDir }));
      // 命中的是项目兜底目录的 run.log（内容精确相等 ⇒ 探测路径逐字符等于字面量拼接结果）
      assert.equal(body.source, 'run.log');
      assert.equal(body.live, false);
      assert.equal(body.truncated, false);
      assert.equal(body.log, PROJECT_FALLBACK_LOG);
      // 响应 note 透出兜底分支标记（tools-metadata.js:299）：证明走的是 UI-454 兜底而非权威解析
      assert.ok(
        String(body.note || '').startsWith('布局解析失败已按项目目录约定兜底（'),
        `响应必须携带 UI-454 兜底 note，实得：${JSON.stringify(body.note)}`,
      );
    });
  });

  it('C22-2 孪生现状锚定：仅全局目录有日志时命中 <jobsDir>/<id>/output', async () => {
    await withTempRoot(async ({ workspacePath, jobsDir }) => {
      writeRunLog(stitchedGlobalTwinDir(jobsDir), GLOBAL_TWIN_LOG);
      const body = await getLogResponse(buildLogRouteApp({ workspacePath, jobsDir }));
      assert.equal(body.source, 'run.log');
      assert.equal(body.log, GLOBAL_TWIN_LOG);
      // 项目兜底目录未被创建 ⇒ 命中只可能来自 :259 全局孪生
      assert.equal(fs.existsSync(stitchedProjectFallbackDir(workspacePath)), false);
      assert.ok(
        String(body.note || '').startsWith('布局解析失败已按项目目录约定兜底（'),
        '兜底 note 不依赖项目侧命中，只要走了兜底分支就应透出',
      );
    });
  });

  it('C22-3 双目录皆空：诚实 no_log 语义 + note 透出布局解析失败原因（tools-metadata.js:297 形态）', async () => {
    await withTempRoot(async ({ workspacePath, jobsDir }) => {
      const body = await getLogResponse(buildLogRouteApp({ workspacePath, jobsDir }));
      assert.equal(body.ok, true);
      assert.equal(body.source, null);
      assert.equal(body.live, false);
      assert.equal(body.log, '');
      assert.ok(
        String(body.note || '').startsWith('该作业没有可用日志文件')
          && body.note.includes('布局解析失败：'),
        `no_log note 必须拼入布局解析失败原因，实得：${JSON.stringify(body.note)}`,
      );
    });
  });

  it('C22-4 无 project_id 作业：只探全局孪生，项目侧兜底路径即使存在也不读且无兜底 note', async () => {
    await withTempRoot(async ({ workspacePath, jobsDir }) => {
      writeRunLog(stitchedProjectFallbackDir(workspacePath), PROJECT_FALLBACK_LOG);
      writeRunLog(stitchedGlobalTwinDir(jobsDir), GLOBAL_TWIN_LOG);
      const body = await getLogResponse(
        buildLogRouteApp({ workspacePath, jobsDir, jobOverrides: { project_id: null } }),
      );
      assert.equal(body.source, 'run.log');
      assert.equal(body.log, GLOBAL_TWIN_LOG);
      assert.equal(body.note, undefined, '无 project_id 不进布局分支，不得出现兜底 note');
    });
  });

  it('C22-5 收敛快照：日志端点探测链 ≡ resolveToolJobExportDirs 候选链逐项 + output 后缀（收敛替换零变化锚）', async () => {
    await withTempRoot(async ({ workspacePath, jobsDir }) => {
      const job = { id: JOB_ID, project_id: PROJECT_ID };
      const exportDirs = resolveToolJobExportDirs({
        job,
        jobsDir,
        getProjectWorkspacePath: () => workspacePath,
      });
      // resolver 候选链（jobRoot 形态，无 /output 后缀）——C-21 已钉，复述作对照
      assert.deepEqual(exportDirs, [
        path.join(workspacePath, 'results', 'jobs', JOB_ID),
        path.join(jobsDir, JOB_ID),
      ]);
      // 收敛快照本体：现状字面量拼接的探测链 == resolver 链逐项 join 'output'。
      // C-23 收敛批按此式替换 254/259 即零行为变化。
      const expectedProbeChain = exportDirs.map((root) => path.join(root, 'output'));
      assert.deepEqual(expectedProbeChain, [
        stitchedProjectFallbackDir(workspacePath),
        stitchedGlobalTwinDir(jobsDir),
      ]);
      // 行为侧证明首项等价：只在 resolver 派生目录（jobRoot+output）放日志，端点必须命中
      writeRunLog(expectedProbeChain[0], PROJECT_FALLBACK_LOG);
      const body = await getLogResponse(buildLogRouteApp({ workspacePath, jobsDir }));
      assert.equal(body.log, PROJECT_FALLBACK_LOG);
    });
  });

  it('C22-6 源码守卫（收敛稳定不变量）：日志端点必须继续先经 resolveProjectRunLayout 权威解析', () => {
    assert.ok(
      toolsMetadataSource.includes('resolveProjectRunLayout'),
      '/api/tools/log/:id 必须保留 resolveProjectRunLayout 权威解析在前；'
        + '兜底/收敛实现只能是其失败后的等价候选链，不得绕过权威函数',
    );
  });
});

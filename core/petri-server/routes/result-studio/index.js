'use strict';

/**
 * routes/result-studio/index.js — 子域注册中心（PHASE 2.1b）
 *
 * PHASE 2.1a：本文件只占位 + 显式 require 9 个子域 stub。
 * PHASE 2.1b：把主文件的 27 个端点全部下沉到 9 个子域文件，并提供
 *   共享闭包变量 + projectContext / changeSetContext 工厂函数给子模块使用。
 *
 * 共享闭包变量（与原 routes/result-studio.js 初始化时同语义）：
 *   - repositoryInstance（懒创建 via options.repo()）
 *   - replayService（createControlledReplayService）
 *   - baselineWork / workspaceInspectionWork（createDeduplicatedBackgroundRunner）
 *   - databasePath（sqldb path，':memory:' 时为 null）
 *
 * 端点声明顺序（与原文件相同，决定路由顺序敏感性）：
 *   repository → interaction → selection → context → changesets
 *   → revisions → storage → workspace → preview-budget
 */

const path = require('path');
const db = require('../../db');
const {
  createResultStudioRepository,
} = require('../../../shared-backend/result-studio-repository');
const {
  createControlledReplayService,
} = require('../../../shared-backend/result-replay-service');
const {
  createDeduplicatedBackgroundRunner,
  runResultStudioBackground,
} = require('../../../shared-backend/result-studio-background');
const {
  bindProjectRepository,
} = require('../../../shared-backend/git-repository-binding');
const { canAccessProject } = require('../_helpers/validate');

const sqlite = db.db;

/**
 * PHASE 2.1b register(app, options) 注册全部 8 个子域文件
 * （原 repository 子域已随 UI-462「自有仓库接入退役」删除）。
 *
 * 注意：原 routes/result-studio.js 作为 thin facade，会 require('./index').register 并
 * 透传给 routes/index.js 的 routes 列表。register(app) 不需要 options 参数——所有共享
 * 闭包变量在内部创建，对外只暴露 app。
 */
module.exports = {
  register(app) {
    if (typeof app.get !== 'function') {
      throw new Error('result-studio/index register requires an Express app');
    }

    // 共享闭包变量（与原 routes/result-studio.js 第 233-247 行同语义）
    let repositoryInstance = null;
    const replayService = createControlledReplayService();
    const baselineWork = createDeduplicatedBackgroundRunner(runResultStudioBackground);
    const workspaceInspectionWork = createDeduplicatedBackgroundRunner(runResultStudioBackground);
    const configuredDatabasePath = sqlite.name || process.env.PETRI_DB_PATH || null;
    const databasePath = configuredDatabasePath && configuredDatabasePath !== ':memory:'
      ? path.resolve(configuredDatabasePath)
      : null;

    function repo() {
      // Production migrations own schema creation. A GET must never execute DDL
      // merely because this module is serving its first request.
      if (!repositoryInstance) repositoryInstance = createResultStudioRepository(sqlite, { ensureSchema: false });
      return repositoryInstance;
    }

    function projectContext(req, projectId, { write = false, git = true } = {}) {
      const project = db.getProject(projectId);
      if (!project) return { error: { status: 404, code: 'project_not_found' } };
      if (!canAccessProject(req, project)) return { error: { status: 403, code: 'forbidden' } };
      if (!git) return { project, binding: null, repository: repo(), gitPathPrefix: '' };
      const repository = repo();
      const binding = bindProjectRepository({
        workspaceRoot: project.workspace_path,
        projectId,
        // Read-only history/compare/status requests must not initialize
        // .petri/git as a side effect.
        createManagedIfMissing: write,
      });
      if (!binding?.adapter || (write && binding.status !== 'ready')) {
        return {
          error: {
            status: 409,
            code: binding?.reason || binding?.status || 'repository_binding_failed',
            bindingStatus: binding?.status || null,
          },
        };
      }
      // 只在写路径记录绑定。此前无视自己声明的 `write` 标志无条件写入，
      // 于是纯 GET（含只读查看历史 Revision）也会 upsert 一行并盖上 updated_at，
      // 违反「查看不写入」契约。生产代码没有任何一处读回该行
      // （`getRepositoryBinding` 仅被测试消费），因此它是审计记录：
      // 在真正用到 git 的时候记录才有意义。
      if (write) {
        repository.saveRepositoryBinding({
          projectId,
          mode: binding.mode,
          workspaceRoot: binding.workspaceRoot,
          gitDir: binding.adapter.gitDir,
          workTree: binding.adapter.workTree,
          managedPaths: binding.managedPaths,
          status: binding.status,
          reason: binding.reason,
          gitVersion: binding.inspection?.runtime?.versionRaw || null,
        });
      }
      return {
        project,
        binding,
        repository,
        gitPathPrefix: '',
      };
    }

    function changeSetContext(req, changeSetId, options = {}) {
      const changeSet = repo().getChangeSet(changeSetId);
      if (!changeSet) return { error: { status: 404, code: 'change_set_not_found' } };
      const context = projectContext(req, changeSet.projectId, options);
      return context.error ? context : { ...context, changeSet };
    }

    const sharedOptions = {
      app,
      repo,
      replayService,
      baselineWork,
      workspaceInspectionWork,
      databasePath,
      projectContext,
      changeSetContext,
    };

    // 子模块注册（顺序与原 routes/result-studio.js 端点声明顺序一致）
    require('./lineage').register(app, { repo, sqlite });
    require('./interaction').register(app, {
      repo, baselineWork, databasePath,
    });
    require('./selection').register(app, { repo });
    require('./context').register(app, { repo });
    require('./changesets').register(app, { repo, projectContext, changeSetContext });
    require('./revisions').register(app, { repo, projectContext, replayService });
    require('./storage').register(app, { projectContext });
    require('./workspace').register(app, { projectContext, workspaceInspectionWork, databasePath });
    require('./preview-budget').register(app, { repo, projectContext });
    // Silence unused warning: sharedOptions is kept as documentation.
    void sharedOptions;
  },

  // 子模块引用（PHASE 2.1b 主文件降 thin facade 后会用到）
  _submodules: {
      interaction: () => require('./interaction'),
    selection: () => require('./selection'),
    context: () => require('./context'),
    changesets: () => require('./changesets'),
    revisions: () => require('./revisions'),
    storage: () => require('./storage'),
    workspace: () => require('./workspace'),
    'preview-budget': () => require('./preview-budget'),
  },

  // 共享 helpers（兼容既有测试 + PHASE 2.1b 主文件 facade 拉取）
  _helpers: {
    validate: () => require('../_helpers/validate'),
    repository: () => require('../_helpers/repository'),
    format: () => require('../_helpers/format'),
    context: () => require('../_helpers/context'),
    storage: () => require('../_helpers/storage'),
    workflow: () => require('../_helpers/workflow'),
  },
};

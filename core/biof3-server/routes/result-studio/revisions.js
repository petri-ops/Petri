'use strict';

/**
 * routes/result-studio/revisions.js — revisions 子域（PHASE 2.1b）
 *
 * 下沉的端点（来自 routes/result-studio.js 多处）：
 *   GET  /api/result-studio/revisions/:revisionId/source      （第 838-866 行）
 *   POST /api/result-studio/revisions/:revisionId/replay      （第 875-972 行 ~98 行）
 *   GET  /api/result-studio/revisions/:revisionId/table-page  （第 1121-1138 行）
 *   POST /api/result-studio/revisions/:revisionId/restore     （第 1179-1210 行）
 *   GET  /api/result-studio/revisions/:revisionId/artifact     （第 1212-1232 行）
 *
 * 关键跨子文件依赖：
 *   - projectContext 由 result-studio/index.js 通过 options.projectContext 工厂
 *     函数提供
 *   - replayService（controlled replay）由 options.replayService 提供
 *   - userId / resolveWorkspaceFileForRevision / openVerifiedRevisionArtifact
 *     来自 _helpers/{validate,storage}
 *   - guardContextOperation / persistedToolJobConversation 来自 agent-tools 和 _helpers/repository
 */

const fs = require('fs');
const db = require('../../db');
const pluginLoader = require('../../plugin-loader');
const mcpRegistry = require('../../mcp/registry');
const { artifactContentTypeHint } = require('../../helpers/artifact-truth');
// BLOCK-76 P2 — SSH 项目 Revision 产物走 Gateway 读远程真值（R3）
const crypto = require('crypto');
const path = require('path');
const os = require('os');
const { safeRemoteJoin, resolveWorkspaceBackend } = require('../../helpers/workspace-gateway');

/** ssh 项目的 Revision 读取上下文；非 ssh 返回 null（本地链不变）。 */
function sshRevisionReadContext(project, revision) {
  if (!project || project.workspace_kind !== 'ssh' || !project.ssh_host || !project.remote_path) return null;
  if (!revision || !revision.outputPath) return null;
  const resolved = resolveWorkspaceBackend(project);
  if (resolved.error || !resolved.backend || resolved.backend.kind !== 'ssh') return null;
  const artifactPath = safeRemoteJoin(resolved.root, revision.outputPath);
  if (!artifactPath) return null;
  return { backend: resolved.backend, artifactPath, maxBytes: 64 * 1024 * 1024 };
}
const {
  createVerifiedSnapshotReadStream,
  pipeVerifiedSnapshotToResponse,
} = require('../../helpers/verified-file-snapshot');
const {
  ResultRevisionSourceError,
  projectRevisionSource,
} = require('../../../shared-backend/result-revision-source');
const {
  restoreArtifactRevision,
} = require('../../../shared-backend/result-compare-service');
const {
  ResultReplayError,
} = require('../../../shared-backend/result-replay-service');
const { readTablePage } = require('../../../shared-backend/result-studio-lifecycle');
const { userId, canAccessProject } = require('../_helpers/validate');
const {
  resolveWorkspaceFileForRevision,
  openVerifiedRevisionArtifact,
} = require('../_helpers/storage');
const { persistedToolJobConversation } = require('../_helpers/repository');
const { guardContextOperation } = require('../../agent-tools/result-context-tools');

const TABLE_EXTENSIONS = /\.(csv|tsv)$/i;

module.exports = {
  register(app, options) {
    if (typeof app.get !== 'function') {
      throw new Error('result-studio/revisions register requires an Express app');
    }
    if (!options || typeof options.repo !== 'function'
      || typeof options.projectContext !== 'function'
      || !options.replayService) {
      throw new Error('result-studio/revisions register requires options.repo / projectContext / replayService');
    }

    /**
     * Project the exact source for one persisted Revision. This is deliberately
     * separate from the Job snapshot route: candidate/history scripts live in
     * virtual Git commits and the current worktree is not an authoritative
     * source. The route is read-only and requires the caller to name the
     * project, so a known Revision id cannot be used to cross project boundaries.
     */
    app.get('/api/result-studio/revisions/:revisionId/source', (req, res) => {
      const projectId = String(req.query.projectId || '').trim();
      if (!projectId) return res.status(400).json({ error: 'project_required' });
      const context = options.projectContext(req, projectId, { write: false, git: true });
      if (context.error) return res.status(context.error.status).json({ error: context.error.code });
      try {
        const projection = projectRevisionSource({
          projectId,
          revisionId: String(req.params.revisionId || '').trim(),
          expectSha256: String(req.query.expectSha256 || '').trim() || null,
        }, {
          repository: context.repository,
          adapter: context.binding.adapter,
          gitPathPrefix: context.gitPathPrefix,
          workspaceRoot: context.project.workspace_path,
          getToolJob: db.getToolJob,
        });
        if (String(req.query.download || '') === '1') {
          const entryPoint = String(projection.entryPoint || 'revision-source.R').replace(/[^A-Za-z0-9._-]/g, '_');
          res.type('text/plain').set('Content-Disposition', `attachment; filename="${entryPoint}"`).send(projection.content);
          return;
        }
        return res.json(projection);
      } catch (error) {
        const status = error instanceof ResultRevisionSourceError ? error.status : 500;
        const code = error instanceof ResultRevisionSourceError ? error.code : 'revision_source_failed';
        return res.status(status).json({ error: code, message: error instanceof ResultRevisionSourceError ? error.message : 'Revision source projection failed.' });
      }
    });

    /**
     * P4R-5 controlled replay: preflight and confirmation share one endpoint,
     * but neither accepts a caller-authored tool id, parameter map, script,
     * command or workflow plan.  Both phases re-bind the current context token;
     * confirmation reprojects source/params/inputs again immediately before the
     * canonical registered-tool execution and only creates a candidate Revision.
     */
    app.post('/api/result-studio/revisions/:revisionId/replay', async (req, res) => {
      const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
      const projectId = String(body.projectId || '').trim();
      const revisionId = String(req.params.revisionId || '').trim();
      const phase = String(body.phase || 'preflight').trim();
      if (!projectId || !revisionId) return res.status(400).json({ error: 'project_and_revision_required' });
      if (!['preflight', 'confirm'].includes(phase)) return res.status(400).json({ error: 'replay_phase_invalid' });
      const context = options.projectContext(req, projectId, { write: phase === 'confirm', git: true });
      if (context.error) return res.status(context.error.status).json({ error: context.error.code });

      // Scoped sources keep their persisted conversation. A legacy unscoped
      // source may create a new replay Job in the current conversation only when
      // that conversation is authenticated by the context token below.
      const sourceRevision = context.repository.getRevision(revisionId);
      const sourceJob = sourceRevision ? db.getToolJob(sourceRevision.toolJobId) : null;
      const persistedConversationId = persistedToolJobConversation(sourceJob);
      const requestedConversationId = String(body.conversationId || '').trim() || null;
      if (persistedConversationId !== null
          && requestedConversationId !== null
          && requestedConversationId !== persistedConversationId) {
        return res.status(409).json({ error: 'replay_conversation_mismatch' });
      }
      const conversationId = persistedConversationId || requestedConversationId;

      const guarded = guardContextOperation({
        projectId,
        userId: userId(req),
        conversationId,
        activeArtifact: { revisionId },
      }, {
        contextToken: String(body.contextToken || '').trim() || null,
      }, {
        repository: context.repository,
        getToolJob: db.getToolJob,
        getPluginManifest: pluginLoader.getPluginManifest,
      });
      if (!guarded.ok) {
        return res.status(409).json({
          error: guarded.response.error,
          message: guarded.response.message,
          diagnostics: guarded.response.diagnostics,
        });
      }

      const dependencies = {
        repository: context.repository,
        adapter: context.binding.adapter,
        gitPathPrefix: context.gitPathPrefix,
        workspaceRoot: context.project.workspace_path,
        getToolJob: db.getToolJob,
        getPlugin: pluginLoader.getPlugin,
        getResultStudioDescriptor: (toolId) => pluginLoader.getPluginManifest(toolId)?.resultStudio || null,
        activePreviewJobs: context.repository.listChangeSets({ projectId, status: 'running', limit: 500 }).length,
        executeJob: async ({
          toolId,
          params,
          materializedScriptPath,
          materializedScriptSha256,
          changeSetId,
          resultStudioInputLineage = null,
        }) => {
          const result = await mcpRegistry.callTool(toolId, params, {
            userId: userId(req) || 'local-user',
            projectId,
            conversationId,
            resultStudioMaterializedScript: {
              path: materializedScriptPath,
              sha256: materializedScriptSha256,
              changeSetId,
            },
            resultStudioInputLineage,
          });
          const toolJobId = result && result.toolJobId;
          return { result, toolJobId, job: toolJobId ? db.getToolJob(toolJobId) : null };
        },
      };
      const input = {
        ...body,
        projectId,
        revisionId,
        phase,
        conversationId,
        request: { ...body, conversationId },
      };
      try {
        const result = phase === 'confirm'
          ? await options.replayService.confirm(input, dependencies)
          : options.replayService.prepare(input, dependencies);
        return res.status(phase === 'confirm' ? 201 : 200).json(result);
      } catch (error) {
        const status = error instanceof ResultReplayError ? error.status : 500;
        return res.status(status).json({
          error: error instanceof ResultReplayError ? error.code : 'replay_failed',
          message: error instanceof ResultReplayError ? error.message : 'Controlled replay failed.',
          detail: error instanceof ResultReplayError ? error.detail : null,
        });
      }
    });

    app.get('/api/result-studio/revisions/:revisionId/table-page', async (req, res) => {
      const revision = options.repo().getRevision(String(req.params.revisionId || '').trim());
      if (!revision) return res.status(404).json({ error: 'revision_not_found' });
      const context = options.projectContext(req, revision.projectId, { git: false });
      if (context.error) return res.status(context.error.status).json({ error: context.error.code });
      if (!TABLE_EXTENSIONS.test(revision.outputPath)) return res.status(415).json({ error: 'revision_not_table' });
      // BLOCK-76 P2 — ssh 项目：远程表格读入临时文件，复用本地分页解析器（自算 sha 对账）
      const sshCtx = sshRevisionReadContext(context.project, revision);
      if (sshCtx) {
        let tmpPath = null;
        try {
          const st = await sshCtx.backend.stat(sshCtx.artifactPath).catch(() => null);
          if (!st) return res.status(404).json({ error: 'revision_artifact_unavailable' });
          if (Number(st.size || 0) > 64 * 1024 * 1024) {
            return res.status(409).json({ error: 'revision_artifact_unavailable', message: 'artifact exceeds remote read budget' });
          }
          const buf = await sshCtx.backend.read(sshCtx.artifactPath);
          const sha = crypto.createHash('sha256').update(buf).digest('hex');
          if (revision.outputHash && sha !== revision.outputHash) {
            return res.status(409).json({ error: 'artifact_hash_mismatch' });
          }
          tmpPath = path.join(os.tmpdir(), `b76-table-${crypto.randomBytes(6).toString('hex')}${path.extname(revision.outputPath) || '.csv'}`);
          fs.writeFileSync(tmpPath, buf);
          return res.json(readTablePage({
            filePath: tmpPath,
            expectedSha256: sha,
            cursor: Number(req.query.cursor || 0),
            limit: Number(req.query.limit || 100),
          }));
        } catch (error) {
          return res.status(409).json({ error: error.code || 'table_page_failed', message: error.message });
        } finally {
          if (tmpPath) { try { fs.rmSync(tmpPath, { force: true }); } catch {} }
        }
      }
      try {
        const filePath = resolveWorkspaceFileForRevision(context.project.workspace_path, revision);
        return res.json(readTablePage({
          filePath,
          expectedSha256: revision.outputHash,
          cursor: Number(req.query.cursor || 0),
          limit: Number(req.query.limit || 100),
        }));
      } catch (error) {
        return res.status(409).json({ error: error.code || 'table_page_failed', message: error.message });
      }
    });

    app.post('/api/result-studio/revisions/:revisionId/restore', (req, res) => {
      const revision = options.repo().getRevision(String(req.params.revisionId || '').trim());
      if (!revision) return res.status(404).json({ error: 'revision_not_found' });
      const context = options.projectContext(req, revision.projectId, { write: true });
      if (context.error) return res.status(context.error.status).json({ error: context.error.code, bindingStatus: context.error.bindingStatus });
      const sourceJob = db.getToolJob(revision.toolJobId);
      const conversationId = persistedToolJobConversation(sourceJob);
      const requestedConversationId = String(req.body?.conversationId || '').trim() || null;
      if (conversationId !== null
          && requestedConversationId !== null
          && requestedConversationId !== conversationId) {
        return res.status(409).json({ error: 'restore_conversation_mismatch' });
      }
      try {
        const result = restoreArtifactRevision({
          projectId: context.project.id,
          workspaceRoot: context.project.workspace_path,
          revisionId: revision.revisionId,
          conversationId,
          createdBy: 'user',
        }, {
          repository: context.repository,
          adapter: context.binding.adapter,
          gitPathPrefix: context.gitPathPrefix,
          getToolJob: db.getToolJob,
          getResultStudioDescriptor: (toolId) => pluginLoader.getPluginManifest(toolId)?.resultStudio || null,
        });
        return res.json({ ok: true, ...result });
      } catch (error) {
        return res.status(409).json({ error: error.code || 'restore_failed', message: error.message, detail: error.detail || null });
      }
    });

    app.get('/api/result-studio/revisions/:revisionId/artifact', async (req, res) => {
      const revision = options.repo().getRevision(String(req.params.revisionId || '').trim());
      if (!revision) return res.status(404).json({ error: 'revision_not_found' });
      const context = options.projectContext(req, revision.projectId, { git: false });
      if (context.error) return res.status(context.error.status).json({ error: context.error.code });
      try {
        // BLOCK-76 P2 — ssh 项目：Gateway 读远程产物 + sha256 对账（Buffer 等价发送）
        const sshCtx = sshRevisionReadContext(context.project, revision);
        if (sshCtx) {
          const st = await sshCtx.backend.stat(sshCtx.artifactPath).catch(() => null);
          if (!st) return res.status(404).json({ error: 'revision_artifact_unavailable' });
          if (Number(st.size || 0) > sshCtx.maxBytes) {
            return res.status(409).json({ error: 'revision_artifact_unavailable', message: 'artifact exceeds remote read budget' });
          }
          const buf = await sshCtx.backend.read(sshCtx.artifactPath);
          if (revision.outputHash) {
            const sha = crypto.createHash('sha256').update(buf).digest('hex');
            if (sha !== revision.outputHash) {
              return res.status(409).json({ error: 'revision_artifact_unavailable', message: 'artifact_hash_mismatch' });
            }
          }
          return res
            .type(artifactContentTypeHint(sshCtx.artifactPath))
            .set('Cache-Control', 'private, no-store')
            .set('Content-Length', String(buf.length))
            .send(buf);
        }
        const opened = await openVerifiedRevisionArtifact(context.project.workspace_path, revision);
        const stream = createVerifiedSnapshotReadStream(opened);
        stream.once('error', (error) => {
          if (!res.headersSent) res.status(404).json({ error: 'revision_artifact_unavailable' });
          else res.destroy(error);
        });
        res
          .type(artifactContentTypeHint(opened.artifactPath))
          .set('Cache-Control', 'private, no-store')
          .set('Content-Length', String(opened.stat.size));
        return pipeVerifiedSnapshotToResponse(stream, req, res);
      } catch (error) {
        return res.status(404).json({ error: 'revision_artifact_unavailable', message: error.message });
      }
    });
  },
};

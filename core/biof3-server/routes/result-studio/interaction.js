'use strict';

/**
 * routes/result-studio/interaction.js — interaction 子域（PHASE 2.1b）
 *
 * 下沉的端点（来自 routes/result-studio.js 第 362-605 行）：
 *   GET  /api/result-studio/interaction  （205 行最复杂端点）
 *   POST /api/result-studio/table/query
 *
 * 共享 helper 走 `routes/_helpers/*`：
 *   - readTableSample / detectDelimiter / backingArtifactName / resolveInteractionDescriptor
 *     来自 _helpers/{storage,workflow}
 *   - resolveArtifactPath / verifyArtifactRecordBytes 来自 _helpers/{workflow,repository}
 *   - sendArtifactResolutionError 来自 _helpers/format
 *
 * 行为 100% 兼容：try/catch 顺序、status code、response shape 保持不变。
 */

const fs = require('fs');
const pluginLoader = require('../../plugin-loader');
const { isPathContained } = require('../../../shared-backend/project-run-layout');
const {
  buildTableInteractionManifest,
  buildPlotInteractionManifest,
} = require('../../../shared-backend/artifact-interaction');
const {
  queryResultTable,
  ResultStudioTableQueryError,
} = require('../../../shared-backend/result-studio-table-query');
require('../_helpers/validate');
const {
  loadJobAndProject,
  findArtifactRecord: _unusedFindArtifactRecord,
  verifyArtifactRecordBytes,
} = require('../_helpers/repository');
const { readTableSample } = require('../_helpers/storage');
const { sendArtifactResolutionError } = require('../_helpers/format');
const {
  resolveArtifactPath,
  resolveInteractionBaselineRevision,
  resolveInteractionDescriptor,
  backingArtifactName,
  baselineFailureDiagnostic,
} = require('../_helpers/workflow');

const TABLE_EXTENSIONS = /\.(csv|tsv)$/i;
const PLOT_EXTENSIONS = /\.(png|jpe?g|gif|svg|webp)$/i;

module.exports = {
  register(app, options) {
    if (typeof app.get !== 'function') {
      throw new Error('result-studio/interaction register requires an Express app');
    }
    if (!options || typeof options.repo !== 'function'
      || !options.baselineWork || typeof options.baselineWork.run !== 'function'
      || !('databasePath' in options)) {
      throw new Error('result-studio/interaction register requires options.repo / baselineWork / databasePath');
    }

    /**
     * 交互清单：告诉前端这个 artifact 能怎么选、哪一列是稳定实体 ID。
     */
    app.get('/api/result-studio/interaction', async (req, res) => {
      const jobId = String(req.query.jobId || '').trim();
      const artifactName = String(req.query.artifact || '').trim();
      if (!jobId) return res.status(400).json({ error: 'jobId_required' });

      const loaded = loadJobAndProject(req, jobId);
      if (loaded.error) return res.status(loaded.error.status).json({ error: loaded.error.code });

      const resolved = resolveArtifactPath({ req, job: loaded.job, project: loaded.project, artifactName });
      if (resolved.error) {
        return sendArtifactResolutionError(res, resolved.error);
      }
      if (!TABLE_EXTENSIONS.test(artifactName) && !PLOT_EXTENSIONS.test(artifactName)) {
        return res.status(415).json({ error: 'artifact_kind_not_interactive' });
      }
      const artifactRecord = resolved.artifactRecord;
      const interaction = resolveInteractionDescriptor(loaded.job.tool_id, artifactRecord, artifactName);

      let revision = null;
      let revisionDiagnostic = null;
      const explicitRevisionId = String(req.query.revisionId || '').trim() || null;
      try {
        if (explicitRevisionId) {
          const candidate = options.repo().getRevision(explicitRevisionId);
          if (candidate && candidate.projectId === loaded.project.id
            && candidate.toolJobId === loaded.job.id && candidate.artifactId === artifactRecord.id) {
            revision = candidate;
          } else {
            revisionDiagnostic = { code: 'revision_not_bound_to_artifact', message: 'Requested revision is not bound to this Job.' };
          }
        } else {
          const result = loaded.job.result || {};
          const pluginManifest = pluginLoader.getPluginManifest(loaded.job.tool_id);
          const pluginDescriptor = pluginManifest?.resultStudio || null;
          const baseline = resolveInteractionBaselineRevision({
            repository: options.repo(),
            projectId: loaded.project.id,
            sourceJob: loaded.job,
            artifactId: artifactRecord.id,
            pluginDescriptor,
          });
          if (!baseline.requiresEnsure) {
            revision = baseline.revision;
          } else {
            const snapshot = result.executionProvenance?.script;
            if (!snapshot?.snapshotPath || !snapshot.sha256) {
              throw Object.assign(new Error('Execution script snapshot is unavailable.'), { code: 'source_script_missing' });
            }
            if (!fs.existsSync(snapshot.snapshotPath) || !fs.statSync(snapshot.snapshotPath).isFile()) {
              throw Object.assign(new Error('Execution script snapshot is unavailable.'), { code: 'source_script_missing' });
            }
            const realWorkspace = fs.realpathSync(loaded.project.workspace_path);
            const sourceScriptPath = fs.realpathSync(snapshot.snapshotPath);
            if (!isPathContained(realWorkspace, sourceScriptPath)) {
              throw Object.assign(new Error('Execution script snapshot escaped the project.'), { code: 'source_script_outside_project' });
            }
            const baselineInput = {
              projectId: loaded.project.id,
              workspaceRoot: loaded.project.workspace_path,
              sourceJob: loaded.job,
              artifactId: artifactRecord.id,
              pluginId: loaded.job.tool_id,
              language: result.tool?.language || (/\.py$/i.test(sourceScriptPath) ? 'python' : 'r'),
              sourceScriptContent: fs.readFileSync(sourceScriptPath, 'utf8'),
              sourceScriptSha256: snapshot.sha256,
              pluginDescriptor,
            };
            const baselineKey = `${loaded.project.id}\0${loaded.job.id}\0baseline-cohort`;
            const ensured = await options.baselineWork.run(
              baselineKey,
              'ensure-baseline',
              {
                databasePath: options.databasePath,
                projectId: loaded.project.id,
                workspaceRoot: loaded.project.workspace_path,
                input: baselineInput,
              },
            );
            revision = ensured.revision;
          }
        }
      } catch (error) {
        revisionDiagnostic = baselineFailureDiagnostic(error);
      }
      const revisionId = revision?.revisionId || null;
      const stableArtifactId = artifactRecord.id;
      let activeReadArtifact = resolved;

      try {
        if (TABLE_EXTENSIONS.test(artifactName)) {
          const beforeRead = verifyArtifactRecordBytes(artifactRecord, resolved.absolutePath);
          if (beforeRead.error) return sendArtifactResolutionError(res, beforeRead.error);
          const sample = readTableSample(resolved.absolutePath, artifactName);
          const afterRead = verifyArtifactRecordBytes(artifactRecord, resolved.absolutePath);
          if (afterRead.error) return sendArtifactResolutionError(res, afterRead.error);
          const mapping = interaction.mapping;
          let backingTable = null;
          if (mapping?.mode === 'matrix') {
            const backingName = backingArtifactName(interaction) || artifactName;
            const backing = backingName === artifactName
              ? resolved
              : resolveArtifactPath({ req, job: loaded.job, project: loaded.project, artifactName: backingName });
            if (backing.error) return sendArtifactResolutionError(res, backing.error);
            activeReadArtifact = backing;
            backingTable = queryResultTable({
              filePath: backing.absolutePath,
              expectedSha256: backing.expectedSha256,
              idField: mapping.rowIdField || null,
              limit: 100,
            });
            const backingAfterRead = verifyArtifactRecordBytes(backing.artifactRecord, backing.absolutePath);
            if (backingAfterRead.error) return sendArtifactResolutionError(res, backingAfterRead.error);
          }
          const manifest = buildTableInteractionManifest({
            artifactId: stableArtifactId,
            revisionId,
            columns: backingTable ? backingTable.columns.map((column) => column.field) : sample.columns,
            rows: backingTable ? backingTable.rows : sample.rows,
            rowCount: backingTable?.totalRows ?? (sample.rowCount === null ? undefined : sample.rowCount),
            declaredIdField: mapping?.idField || mapping?.rowIdField || null,
            declaredEntityType: mapping?.entityType || mapping?.rowEntityType || null,
          });
          manifest.interactionMode = mapping?.mode || 'read_only';
          manifest.mapping = mapping || null;
          if (!mapping) {
            manifest.capabilities = [];
            manifest.selectionDurable = false;
            manifest.diagnostics = [...manifest.diagnostics, {
              code: 'plugin_interaction_mapping_missing',
              message: 'Plugin descriptor does not declare a stable interaction mapping; artifact is read-only.',
            }];
          }
          if (sample.truncated) {
            manifest.diagnostics = [
              ...manifest.diagnostics,
              {
                code: 'artifact_read_truncated',
                message: 'File exceeded the read limit; row count and uniqueness were assessed on a prefix only.',
              },
            ];
          }
          manifest.artifactFamilyId = revision?.artifactFamilyId || null;
          if (revisionDiagnostic) manifest.diagnostics = [...manifest.diagnostics, revisionDiagnostic];
          return res.json({
            manifest,
            revision,
            backingTable,
            sampledRows: backingTable?.rows.length || sample.rows.length,
            truncated: backingTable ? !!backingTable.nextOffset : sample.truncated,
          });
        }

        if (PLOT_EXTENSIONS.test(artifactName)) {
          const currentPlot = verifyArtifactRecordBytes(artifactRecord, resolved.absolutePath);
          if (currentPlot.error) return sendArtifactResolutionError(res, currentPlot.error);
          const mapping = interaction.mapping;
          const manifest = buildPlotInteractionManifest({
            artifactId: stableArtifactId,
            revisionId,
            declaredIdField: mapping?.idField || mapping?.rowIdField || null,
            declaredEntityType: mapping?.entityType || mapping?.rowEntityType || null,
            axes: { x: mapping?.xField || null, y: mapping?.yField || null },
            legendField: mapping?.legendField || null,
          });
          manifest.interactionMode = mapping?.mode || 'read_only';
          manifest.mapping = mapping || null;
          if (mapping?.mode === 'matrix') {
            manifest.artifactKind = 'matrix';
            manifest.capabilities = ['row_select', 'column_select'];
          }
          manifest.artifactFamilyId = revision?.artifactFamilyId || null;
          if (revisionDiagnostic) manifest.diagnostics = [...manifest.diagnostics, revisionDiagnostic];
          let backingTable = null;
          const backingName = backingArtifactName(interaction);
          if (mapping && backingName) {
            const backing = resolveArtifactPath({
              req, job: loaded.job, project: loaded.project, artifactName: backingName,
            });
            if (backing.error) return sendArtifactResolutionError(res, backing.error);
            activeReadArtifact = backing;
            backingTable = queryResultTable({
              filePath: backing.absolutePath,
              expectedSha256: backing.expectedSha256,
              idField: mapping.idField || mapping.rowIdField || null,
              // UI-454（G0-BIO BIO-2）：plot backing 有界窗口 250→600（前端 SVG
              // 可承受；仍按文件顺序取，非显著性排序——top-N 排序需插件
              // descriptor 声明排序字段，登记 BIO-3 契约候选）。
              limit: 600,
            });
            const backingAfterRead = verifyArtifactRecordBytes(backing.artifactRecord, backing.absolutePath);
            if (backingAfterRead.error) return sendArtifactResolutionError(res, backingAfterRead.error);
          }
          if (mapping?.mode === 'matrix' && !backingTable) {
            manifest.capabilities = [];
            manifest.selectionDurable = false;
          }
          return res.json({ manifest, revision, backingTable, sampledRows: backingTable?.rows?.length || 0, truncated: !!backingTable?.nextOffset });
        }
      } catch (error) {
        const currentTruth = verifyArtifactRecordBytes(
          activeReadArtifact.artifactRecord,
          activeReadArtifact.absolutePath,
        );
        if (currentTruth.error) return sendArtifactResolutionError(res, currentTruth.error);
        return res.status(500).json({ error: 'interaction_manifest_failed', message: error && error.message });
      }
    });

    /** 权威完整表查询；排序/过滤永远不基于浏览器中的前缀预览。 */
    app.post('/api/result-studio/table/query', (req, res) => {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const jobId = String(body.jobId || '').trim();
      const artifactName = String(body.artifact || '').trim();
      if (!jobId || !artifactName) return res.status(400).json({ error: 'job_and_artifact_required' });
      const loaded = loadJobAndProject(req, jobId);
      if (loaded.error) return res.status(loaded.error.status).json({ error: loaded.error.code });
      const resolved = resolveArtifactPath({ req, job: loaded.job, project: loaded.project, artifactName });
      if (resolved.error) return sendArtifactResolutionError(res, resolved.error);
      const artifactRecord = resolved.artifactRecord;
      const interaction = resolveInteractionDescriptor(loaded.job.tool_id, artifactRecord, artifactName);
      const mapping = interaction.mapping;
      if (!mapping) return res.status(409).json({ error: 'plugin_interaction_mapping_missing' });
      const queryName = backingArtifactName(interaction) || artifactName;
      const queryPath = queryName === artifactName
        ? resolved
        : resolveArtifactPath({ req, job: loaded.job, project: loaded.project, artifactName: queryName });
      if (queryPath.error) return sendArtifactResolutionError(res, queryPath.error);
      try {
        const result = queryResultTable({
          filePath: queryPath.absolutePath,
          expectedSha256: queryPath.expectedSha256,
          idField: mapping.idField || mapping.rowIdField || null,
          filterExpression: body.filterExpression,
          sort: body.sort,
          offset: Number(body.offset),
          limit: Number(body.limit),
        });
        const afterRead = verifyArtifactRecordBytes(queryPath.artifactRecord, queryPath.absolutePath);
        if (afterRead.error) return sendArtifactResolutionError(res, afterRead.error);
        return res.json(result);
      } catch (error) {
        const currentTruth = verifyArtifactRecordBytes(queryPath.artifactRecord, queryPath.absolutePath);
        if (currentTruth.error) return sendArtifactResolutionError(res, currentTruth.error);
        const status = error instanceof ResultStudioTableQueryError ? 400 : 500;
        return res.status(status).json({ error: error.code || 'table_query_failed', message: error.message, detail: error.detail || null });
      }
    });
  },
};

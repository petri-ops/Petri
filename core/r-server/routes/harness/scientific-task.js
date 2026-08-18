'use strict';

/**
 * routes/harness/scientific-task.js — scientific-task 子域（PHASE 2.2a）
 *
 * 下沉的端点（来自 routes/harness.js 第 757-902 + 923-966 行）：
 *   POST /api/harness/scientific-task/plan
 *   POST /api/harness/scientific-task/confirmation-preview
 *   POST /api/harness/scientific-task/confirm
 *   GET  /api/harness/scientific-task/:taskId
 *   GET  /api/harness/scientific-task-by-job/:toolJobId
 *   GET  /api/harness/scientific-task-by-job/:toolJobId/script
 *   POST /api/harness/scientific-task/:taskId/bind-job
 *   POST /api/harness/scientific-task/:taskId/delivery-manifest
 *   POST /api/harness/scientific-task-by-job/:toolJobId/replay-package
 *
 * 共享 helper 走 `routes/_helpers/harness-shared`：
 *   - userId / isAdminOrInternal / canAccessProject / canAccessJob
 *   - authorizeAndResolveOptions / loadHarnessModule
 *   - availableHarnessManifests / jobsDir / parseJsonMaybe
 *
 * 行为 100% 兼容：try/catch 顺序、status code、response shape 保持不变。
 */

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const express = require('express');
const db = require('../../db');
const { planScientificTaskFromIndex } = require('../../../shared-backend/scientific-task-planner');
const {
  createScientificTaskConfirmationPreview,
  confirmScientificTask,
} = require('../../../shared-backend/scientific-task-confirmation');
const { createDeliveryManifest, writeDeliveryManifest } = require('../../../shared-backend/delivery-manifest');
const {
  buildScientificReplayPackage,
  relativeInside,
  selectReplayContextCheckpoint,
} = require('../../../shared-backend/scientific-replay-package');
const {
  validateContextCheckpoint,
  validateCheckpointSupersession,
} = require('../../../shared-backend/scientific-task-spec');
const { resolveProjectRunLayout } = require('../../../shared-backend/project-run-layout');
const { isRealPathInsideRoot } = require('../../helpers/chat-file-references');
const {
  userId,
  isAdminOrInternal,
  canAccessProject,
  canAccessJob,
  authorizeAndResolveOptions,
  loadHarnessModule,
  availableHarnessManifests,
  parseJsonMaybe,
} = require('../_helpers/harness-shared');

module.exports = {
  register(app) {
    // HRT-2: evidence-first scientific planning. This endpoint only indexes,
    // discovers manifests and returns a plan; it never creates a tool_job.
    app.post('/api/harness/scientific-task/plan', express.json({ limit: '1mb' }), async (req, res) => {
      try {
        const options = authorizeAndResolveOptions(req, res);
        if (!options) return;
        const taskSpec = req.body && req.body.taskSpec;
        if (!taskSpec || typeof taskSpec !== 'object') {
          return res.status(400).json({ ok: false, error: 'missing_task_spec' });
        }
        const harness = await loadHarnessModule();
        const scoped = harness.indexHarnessScope({ ...options, hash: true });
        const plan = planScientificTaskFromIndex({
          taskSpec,
          index: scoped.index,
          manifests: availableHarnessManifests(),
          runtime: req.body.runtime || null,
        });
        res.json({ ok: true, scope: scoped.scope, index: scoped.promptSummary, plan });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    });

    app.post('/api/harness/scientific-task/confirmation-preview', express.json({ limit: '1mb' }), (req, res) => {
      try {
        const taskSpec = req.body?.taskSpec;
        const project = taskSpec?.projectId ? db.getProject(taskSpec.projectId) : null;
        if (!taskSpec) return res.status(400).json({ ok: false, error: 'missing_task_spec' });
        if (!project || !canAccessProject(req, project)) return res.status(project ? 403 : 404).json({ ok: false, error: project ? 'forbidden' : 'project_not_found' });
        const result = createScientificTaskConfirmationPreview({
          taskSpec,
          plan: req.body.plan,
          evidence: req.body.evidence || [],
          estimatedResources: req.body.estimatedResources || null,
        });
        res.status(result.ok ? 200 : 422).json(result);
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    });

    app.post('/api/harness/scientific-task/confirm', express.json({ limit: '1mb' }), (req, res) => {
      try {
        const taskSpec = req.body?.taskSpec;
        const project = taskSpec?.projectId ? db.getProject(taskSpec.projectId) : null;
        if (!taskSpec) return res.status(400).json({ ok: false, error: 'missing_task_spec' });
        if (!project || !canAccessProject(req, project)) return res.status(project ? 403 : 404).json({ ok: false, error: project ? 'forbidden' : 'project_not_found' });
        const confirmation = { ...(req.body.confirmation || {}), userId: userId(req) || 'local-user' };
        const result = confirmScientificTask({ taskSpec, plan: req.body.plan, confirmation });
        if (!result.ok) return res.status(422).json(result);
        const persisted = db.saveScientificTaskSpec({
          spec: result.spec,
          specHash: result.taskSpecHash,
          confirmation: result.confirmation,
          version: Number(req.body.version || 1),
        });
        res.json({ ...result, persisted: { taskId: persisted.task_id, version: persisted.version, status: persisted.status } });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    });

    app.get('/api/harness/scientific-task/:taskId', (req, res) => {
      try {
        const task = db.getScientificTaskSpec(req.params.taskId, req.query.version ? Number(req.query.version) : null);
        if (!task) return res.status(404).json({ ok: false, error: 'scientific_task_not_found' });
        const project = db.getProject(task.project_id);
        if (!canAccessProject(req, project)) return res.status(403).json({ ok: false, error: 'forbidden' });
        res.json({ ok: true, task });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    });

    app.get('/api/harness/scientific-task-by-job/:toolJobId', (req, res) => {
      try {
        const task = db.getScientificTaskByToolJob(req.params.toolJobId);
        if (!task) return res.status(404).json({ ok: false, error: 'scientific_task_not_found' });
        const project = db.getProject(task.project_id);
        if (!canAccessProject(req, project)) return res.status(403).json({ ok: false, error: 'forbidden' });
        res.json({ ok: true, task });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    });

    app.get('/api/harness/scientific-task-by-job/:toolJobId/script', (req, res) => {
      try {
        const task = db.getScientificTaskByToolJob(req.params.toolJobId);
        const job = db.getToolJob(req.params.toolJobId);
        if (!task || !job) return res.status(404).json({ ok: false, error: 'scientific_task_not_found' });
        const project = db.getProject(task.project_id);
        if (!project || !canAccessProject(req, project)) return res.status(project ? 403 : 404).json({ ok: false, error: project ? 'forbidden' : 'project_not_found' });
        const result = parseJsonMaybe(job.result_json || job.result, {});
        const scriptPath = result.executionProvenance?.script?.snapshotPath;
        const layout = resolveProjectRunLayout({ projectId: project.id, toolJobId: job.id, db, skipPermissionCheck: true, ensureDirs: false });
        if (!scriptPath || !isRealPathInsideRoot(layout.jobRoot, scriptPath) || !fs.existsSync(scriptPath)) {
          return res.status(404).json({ ok: false, error: 'script_snapshot_not_found' });
        }
        const expectedHash = result.executionProvenance?.script?.sha256;
        const actualHash = createHash('sha256').update(fs.readFileSync(scriptPath)).digest('hex');
        if (!expectedHash || actualHash !== expectedHash) {
          return res.status(409).json({ ok: false, error: 'script_snapshot_hash_drift' });
        }
        return res.sendFile(path.resolve(scriptPath));
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    });

    app.post('/api/harness/scientific-task/:taskId/bind-job', express.json({ limit: '64kb' }), (req, res) => {
      try {
        const task = db.getScientificTaskSpec(req.params.taskId, Number(req.body?.version || 1));
        if (!task) return res.status(404).json({ ok: false, error: 'scientific_task_not_found' });
        const project = db.getProject(task.project_id);
        if (!canAccessProject(req, project)) return res.status(403).json({ ok: false, error: 'forbidden' });
        const job = db.getToolJob(req.body?.toolJobId);
        if (!job || !canAccessJob(req, job)) return res.status(job ? 403 : 404).json({ ok: false, error: job ? 'forbidden' : 'tool_job_not_found' });
        const bound = db.bindScientificTaskToolJob({ taskId: req.params.taskId, version: Number(req.body?.version || 1), toolJobId: req.body?.toolJobId });
        res.json({ ok: true, task: bound });
      } catch (error) {
        res.status(422).json({ ok: false, error: error.message });
      }
    });

    app.post('/api/harness/scientific-task/:taskId/delivery-manifest', express.json({ limit: '256kb' }), (req, res) => {
      try {
        const version = Number(req.body?.version || 1);
        const task = db.getScientificTaskSpec(req.params.taskId, version);
        if (!task) return res.status(404).json({ ok: false, error: 'scientific_task_not_found' });
        const project = db.getProject(task.project_id);
        if (!project || !canAccessProject(req, project)) return res.status(project ? 403 : 404).json({ ok: false, error: project ? 'forbidden' : 'project_not_found' });
        if (!task.tool_job_id) return res.status(422).json({ ok: false, error: 'scientific_task_job_not_bound' });
        const job = db.getToolJob(task.tool_job_id);
        if (!job) return res.status(404).json({ ok: false, error: 'tool_job_not_found' });
        const layout = resolveProjectRunLayout({ projectId: project.id, toolJobId: job.id, db, userId: userId(req), skipPermissionCheck: isAdminOrInternal(req), ensureDirs: true });
        const manifest = createDeliveryManifest({ taskRecord: task, job, projectRoot: layout.workspaceRoot, findings: req.body?.findings || {} });
        const target = path.join(layout.outputDir, 'delivery-manifest.json');
        const written = writeDeliveryManifest({ manifest, outputPath: target, projectRoot: layout.workspaceRoot });
        const currentResult = parseJsonMaybe(job.result_json || job.result, {});
        db.updateToolJob(job.id, { resultJson: { ...currentResult, deliveryManifest: manifest, deliveryManifestRef: written } });
        res.status(manifest.status === 'blocked' ? 422 : 200).json({ ok: manifest.status !== 'blocked', manifest, written });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    });

    app.post('/api/harness/scientific-task-by-job/:toolJobId/replay-package', express.json({ limit: '256kb' }), (req, res) => {
      try {
        const task = db.getScientificTaskByToolJob(req.params.toolJobId);
        const job = db.getToolJob(req.params.toolJobId);
        if (!task || !job) return res.status(404).json({ ok: false, error: 'scientific_task_not_found' });
        const project = db.getProject(task.project_id);
        if (!project || !canAccessProject(req, project)) return res.status(project ? 403 : 404).json({ ok: false, error: project ? 'forbidden' : 'project_not_found' });
        const explicitCheckpointId = req.body?.checkpointId
          ? String(req.body.checkpointId)
          : null;
        const checkpointCandidates = explicitCheckpointId
          ? [db.getContextCheckpoint(explicitCheckpointId)].filter(Boolean)
          : db.listContextCheckpoints(task.project_id, task.conversation_id);
        if (explicitCheckpointId && checkpointCandidates.length === 0) {
          return res.status(404).json({ ok: false, error: 'context_checkpoint_not_found' });
        }
        const checkpoint = selectReplayContextCheckpoint(checkpointCandidates);
        if (explicitCheckpointId && !checkpoint) {
          return res.status(422).json({ ok: false, error: 'context_checkpoint_incompatible' });
        }
        const layout = resolveProjectRunLayout({ projectId: project.id, toolJobId: job.id, db, userId: userId(req), skipPermissionCheck: isAdminOrInternal(req), ensureDirs: true });
        const packageDir = path.join(layout.outputDir, 'replay-package');
        const built = buildScientificReplayPackage({
          taskRecord: task,
          job,
          projectRoot: layout.workspaceRoot,
          packageDir,
          contextCheckpoint: checkpoint,
          workflowPlan: req.body?.workflowPlan || null,
          includeFixtureInputs: false,
          privacyMode: 'references_only',
        });
        const currentResult = parseJsonMaybe(job.result_json || job.result, {});
        const replayPackageRef = {
          relativePath: relativeInside(layout.workspaceRoot, packageDir),
          packageDigest: built.packageManifest.packageDigest,
          status: built.packageManifest.status,
        };
        db.updateToolJob(job.id, { resultJson: { ...currentResult, replayPackageRef } });
        return res.json({ ok: true, replayPackageRef, packageManifest: built.packageManifest, replay: built.replay });
      } catch (error) {
        res.status(422).json({ ok: false, error: error.message });
      }
    });
  },
};

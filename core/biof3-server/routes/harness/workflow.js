'use strict';

/**
 * routes/harness/workflow.js — workflow 子域（PHASE 2.2a）
 *
 * 下沉的端点（来自 routes/harness.js 第 503-622 + 690-753 行）：
 *   POST /api/harness/workflow/action/:jobId
 *   GET  /api/harness/workflow/status/:jobId
 *   POST /api/harness/workflow/plan
 *
 * 共享闭包变量：`recoveryConfirmations` Map（TTL 5min）保留在本子域闭包内，
 * 跨 workflow/action 与 workflow/status 两端点共享。
 *
 * 共享 helper 走 `routes/_helpers/harness-shared`：
 *   - userId / canAccessJob / authorizeAndResolveOptions
 *   - loadHarnessModule / availableHarnessManifests
 *   - jobsDir
 *
 * 行为 100% 兼容：try/catch 顺序、status code、response shape 保持不变。
 */

const { randomUUID } = require('crypto');
const express = require('express');
const db = require('../../db');
const { projectHarnessWorkflowJob } = require('../../helpers/harness-workflow-state');
const {
  appendWorkflowRecoveryAudit,
  createRecoveryConfirmationStore,
  validateWorkflowRecoveryAction,
} = require('../../helpers/harness-workflow-recovery');
const { reconcileToolJobArtifacts } = require('../tools-metadata');
const {
  userId,
  canAccessJob,
  authorizeAndResolveOptions,
  loadHarnessModule,
  availableHarnessManifests,
  jobsDir,
} = require('../_helpers/harness-shared');

const RECOVERY_CONFIRMATION_TTL_MS = 5 * 60 * 1000;
const recoveryConfirmations = createRecoveryConfirmationStore({
  ttlMs: RECOVERY_CONFIRMATION_TTL_MS,
});

module.exports = {
  register(app) {
    app.post('/api/harness/workflow/action/:jobId', express.json({ limit: '32kb' }), async (req, res) => {
      try {
        const job = await db.getToolJob(req.params.jobId);
        if (!job) return res.status(404).json({ ok: false, error: 'not_found' });
        if (!canAccessJob(req, job)) {
          return res.status(403).json({ ok: false, error: 'forbidden' });
        }
        const actionId = String(req.body?.actionId || '');
        const validation = validateWorkflowRecoveryAction(job, actionId);
        if (!validation.ok) {
          return res.status(409).json({ ok: false, error: validation.error });
        }

        const confirmationToken = req.body?.confirmationToken
          ? String(req.body.confirmationToken)
          : '';
        if (!confirmationToken) {
          const confirmation = recoveryConfirmations.issue({
            actionId,
            jobId: job.id,
            userId: userId(req),
          });
          return res.json({
            ok: true,
            needsConfirmation: true,
            confirmationToken: confirmation.token,
            expiresAt: confirmation.expiresAt,
            actionId,
            jobId: job.id,
          });
        }

        const consumed = recoveryConfirmations.consume(confirmationToken, {
          jobId: job.id,
          actionId,
          userId: userId(req),
        });
        if (!consumed.ok) {
          return res.status(409).json({ ok: false, error: 'confirmation_invalid_or_expired' });
        }
        if (req.body?.confirm !== true) {
          return res.json({ ok: true, cancelled: true, actionId, jobId: job.id });
        }

        const auditEntry = {
          id: `recovery_${randomUUID()}`,
          actionId,
          confirmedAt: new Date().toISOString(),
          requestedBy: userId(req),
          source: 'workflow_ui',
        };
        const nextParams = appendWorkflowRecoveryAudit(job.params || {}, auditEntry);
        await db.updateToolJobParams(job.id, nextParams);

        if (actionId === 'reconcile_artifacts') {
          const reconciled = await reconcileToolJobArtifacts({
            job: { ...job, params: nextParams },
            db,
            jobsDir: jobsDir(),
          });
          return res.json({
            ok: true,
            actionId,
            jobId: job.id,
            workflow: projectHarnessWorkflowJob({
              ...job,
              params: nextParams,
              status: reconciled.status,
              error: reconciled.error,
              result: reconciled.result,
            }),
          });
        }

        const registry = require('../../mcp/registry');
        const pluginLoader = require('../../plugin-loader');
        if (!pluginLoader.getPlugin(job.tool_id)) {
          return res.status(409).json({ ok: false, error: 'tool_not_available' });
        }
        registry.callTool(job.tool_id, nextParams, {
          userId: userId(req),
          projectId: job.project_id || null,
          conversationId: job.conversation_id || job.conversationId || null,
          toolJobId: job.id,
        }).catch((error) => {
          console.warn('[harness] workflow retry failed:', error.message);
        });
        const runningJob = await db.getToolJob(job.id);
        return res.json({
          ok: true,
          actionId,
          jobId: job.id,
          workflow: projectHarnessWorkflowJob(runningJob || job),
        });
      } catch (error) {
        return res.status(500).json({ ok: false, error: error.message });
      }
    });

    app.get('/api/harness/workflow/status/:jobId', async (req, res) => {
      try {
        const job = await db.getToolJob(req.params.jobId);
        if (!job) return res.status(404).json({ ok: false, error: 'not_found' });
        if (!canAccessJob(req, job)) {
          return res.status(403).json({ ok: false, error: 'forbidden' });
        }
        const reconciled = await reconcileToolJobArtifacts({ job, db, jobsDir: jobsDir() });
        return res.json({
          ok: true,
          workflow: projectHarnessWorkflowJob({
            ...job,
            status: reconciled.status,
            error: reconciled.error,
            result: reconciled.result,
          }),
        });
      } catch (error) {
        return res.status(500).json({ ok: false, error: error.message });
      }
    });

    app.post('/api/harness/workflow/plan', express.json({ limit: '1mb' }), async (req, res) => {
      try {
        const options = authorizeAndResolveOptions(req, res);
        if (!options) return;
        const harness = await loadHarnessModule();
        const platform = harness.createLocalHarnessPlatform(options);
        const scoped = harness.indexHarnessScope({ ...options, platform });
        const requestText = req.body.requestText || '';
        const manifests = availableHarnessManifests();
        const explicitManifest = req.body && req.body.manifest;
        const taskPack = harness.selectHarnessTaskPack?.(requestText) || null;
        const rankedTools = explicitManifest
          ? null
          : harness.rankHarnessToolsForRequest(requestText, manifests, scoped.index);
        const rankedTaskToolId = taskPack
          ? rankedTools?.find((ranked) => taskPack.toolIds.includes(ranked.toolId))?.toolId
          : null;
        const manifest =
          explicitManifest ||
          (rankedTaskToolId && manifests.find((item) => item.id === rankedTaskToolId)) ||
          null;
        if (!manifest || typeof manifest !== 'object') {
          return res.status(422).json({
            ok: false,
            error: 'no_matching_tool',
            taskPack,
            rankedTools: rankedTools || [],
          });
        }
        const executionContext = harness.createHarnessExecutionContext({
          ...options,
          platform,
          scopeInfo: scoped.scope,
          manifest,
        });
        const preferredPaths = req.body.activeArtifactName
          ? [String(req.body.activeArtifactName)]
          : [];
        const plan = harness.createHarnessWorkflowPlan({
          requestText,
          manifest,
          manifests,
          rankedTools: rankedTools || undefined,
          index: scoped.index,
          params: req.body.params || {},
          preferredPaths,
          useAbsolutePaths: true,
          executionContext,
        });
        res.json({
          ok: true,
          scope: scoped.scope,
          index: scoped.promptSummary,
          selection: {
            source: explicitManifest ? 'explicit' : 'deterministic',
            taskPack,
            rankedTools: rankedTools || [],
          },
          plan,
        });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    });
  },
};

/**
 * core/r-server/routes/ai-loop.js
 * HLE-C3: Loop REST API — durable query and recovery.
 *
 * Provides:
 *   GET  /api/loop/runs/:loopRunId           — single LoopRun with compact projection
 *   GET  /api/loop/runs?conversationId=&projectId=&limit=  — list runs for conversation
 *   GET  /api/loop/iterations/:loopRunId    — all iterations for a LoopRun
 *   GET  /api/loop/actions/:loopRunId       — all actions for a LoopRun
 *   GET  /api/loop/evidence/:loopRunId      — all evidence for a LoopRun
 *   GET  /api/loop/recovery/:loopRunId      — recovery projection with next action hint
 *
 * Auth: requires valid session userId.
 * Isolation: users can only see runs for projects they own.
 */

const express = require('express');

const db = require('../db');
const {
  getLoopRun,
  listLoopRunsForConversation,
} = db;

// HLE-C3R: project-ownership isolation. A LoopRun belongs to a project; a user
// may only read runs for projects they own (or public / ownerless legacy
// projects, or as admin). Returns true when access is allowed.
function userMayAccessProject(req, projectId) {
  if (!projectId) return true; // legacy runs without a project ref
  if (req.user && req.user.role === 'admin') return true;
  let project = null;
  try { project = db.getProject(projectId); } catch { project = null; }
  if (!project) return false;
  return Boolean(project.is_public) || !project.user_id || project.user_id === req.userId;
}

function registerAiLoopRoutes(app) {
  const router = express.Router();

  // Auth middleware — ensure userId is available
  function requireUser(req, res, next) {
    if (!req.userId) return res.status(401).json({ ok: false, error: 'unauthenticated' });
    next();
  }

  // Load a run and enforce ownership. Sends 404 when missing, 403 when the
  // requesting user does not own the run's project. Returns the run or null.
  function loadRunAuthorized(req, res, loopRunId) {
    const run = getLoopRun(loopRunId);
    if (!run) {
      res.status(404).json({ ok: false, error: 'loop_run_not_found' });
      return null;
    }
    if (!userMayAccessProject(req, run.projectId)) {
      res.status(403).json({ ok: false, error: 'forbidden' });
      return null;
    }
    return run;
  }

  /**
   * GET /api/loop/runs/:loopRunId
   * Returns a single LoopRun with compact projection.
   * Does NOT return unbounded logs or raw full tool_results.
   */
  router.get('/runs/:loopRunId', requireUser, (req, res) => {
    const { loopRunId } = req.params;
    if (!loopRunId) return res.status(400).json({ ok: false, error: 'missing loopRunId' });

    try {
      const run = loadRunAuthorized(req, res, loopRunId);
      if (!run) return undefined;

      // Compact projection: strip raw unbounded fields
      const compact = {
        loopRunId: run.loopRunId,
        projectId: run.projectId,
        conversationId: run.conversationId,
        taskSpecRef: run.taskSpecRef,
        automationMode: run.automationMode,
        loopStatus: run.loopStatus,
        hash: run.hash,
        isPartial: Boolean(run.isPartial),
        partialReason: run.partialReason || null,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      };

      // HLE-C3R: optional expanded projection with durable recovery detail.
      if (req.query.expanded === '1' || req.query.expanded === 'true') {
        let iterations = [];
        let evidenceCount = 0;
        try {
          iterations = (db.listLoopIterations(loopRunId, { limit: 20 }) || []).map((it) => ({
            iterationId: it.iterationId,
            sequence: it.sequence,
            decision: it.decision,
            decisionReasonCode: it.decisionReasonCode,
            status: it.status,
            publicConclusion: it.publicConclusion,
            createdAt: it.createdAt,
          }));
        } catch {}
        try { evidenceCount = (db.listLoopEvidence(loopRunId, { limit: 500 }) || []).length; } catch {}
        const record = run.record && typeof run.record === 'object' ? run.record : {};
        compact.recoveryRequired = Boolean(record.recovery_required);
        compact.recoveryReason = record.recovery_reason || null;
        compact.abortedByUser = Boolean(record.abortedByUser);
        compact.recentIterations = iterations;
        compact.evidenceCount = evidenceCount;
      }

      res.json({ ok: true, run: compact });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  /**
   * GET /api/loop/runs
   * Query runs by conversationId or projectId.
   * ?conversationId=...&projectId=...&limit=10
   */
  router.get('/runs', requireUser, (req, res) => {
    const { conversationId, projectId, limit = 20 } = req.query;
    const parsedLimit = Math.min(Math.max(1, parseInt(limit, 10) || 20), 100);

    if (!conversationId && !projectId) {
      return res.status(400).json({ ok: false, error: 'conversationId or projectId required' });
    }

    try {
      const runs = listLoopRunsForConversation(projectId || null, conversationId || null, { limit: parsedLimit })
        .filter((run) => userMayAccessProject(req, run.projectId));
      const compact = runs.map((run) => ({
        loopRunId: run.loopRunId,
        projectId: run.projectId,
        conversationId: run.conversationId,
        taskSpecRef: run.taskSpecRef,
        automationMode: run.automationMode,
        loopStatus: run.loopStatus,
        hash: run.loopStatusHash || run.hash,
        isPartial: Boolean(run.isPartial),
        partialReason: run.partialReason || null,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      }));
      res.json({ ok: true, runs: compact, count: compact.length });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  /**
   * GET /api/loop/iterations/:loopRunId
   * Returns all iterations for a LoopRun, compact projection.
   */
  router.get('/iterations/:loopRunId', requireUser, (req, res) => {
    const { loopRunId } = req.params;
    if (!loopRunId) return res.status(400).json({ ok: false, error: 'missing loopRunId' });
    if (!loadRunAuthorized(req, res, loopRunId)) return undefined;

    try {
      const { listLoopIterations } = require('../db');
      if (!listLoopIterations) {
        // Fallback: return empty list if function not exported yet
        return res.json({ ok: true, iterations: [], count: 0 });
      }
      const iterations = listLoopIterations(loopRunId, { limit: 200 });
      const compact = iterations.map((iter) => ({
        iterationId: iter.iterationId,
        loopRunId: iter.loopRunId,
        sequence: iter.sequence,
        decision: iter.decision,
        decisionReasonCode: iter.decisionReasonCode,
        status: iter.status,
        publicConclusion: iter.publicConclusion,
        hash: iter.hash,
        createdAt: iter.createdAt,
      }));
      res.json({ ok: true, iterations: compact, count: compact.length });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  /**
   * GET /api/loop/actions/:loopRunId
   * Returns all actions for a LoopRun, compact projection.
   */
  router.get('/actions/:loopRunId', requireUser, (req, res) => {
    const { loopRunId } = req.params;
    if (!loopRunId) return res.status(400).json({ ok: false, error: 'missing loopRunId' });
    if (!loadRunAuthorized(req, res, loopRunId)) return undefined;

    try {
      const { listLoopActions } = require('../db');
      if (!listLoopActions) {
        return res.json({ ok: true, actions: [], count: 0 });
      }
      const actions = listLoopActions(loopRunId, { limit: 200 });
      const compact = actions.map((a) => ({
        actionId: a.actionId,
        loopRunId: a.loopRunId,
        sequence: a.sequence,
        actionKey: a.actionKey,
        actionType: a.actionType,
        toolId: a.toolId,
        attempt: a.attempt,
        hash: a.hash,
        createdAt: a.createdAt,
      }));
      res.json({ ok: true, actions: compact, count: compact.length });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  /**
   * GET /api/loop/evidence/:loopRunId
   * Returns all evidence for a LoopRun, compact projection.
   */
  router.get('/evidence/:loopRunId', requireUser, (req, res) => {
    const { loopRunId } = req.params;
    if (!loopRunId) return res.status(400).json({ ok: false, error: 'missing loopRunId' });
    if (!loadRunAuthorized(req, res, loopRunId)) return undefined;

    try {
      const { listLoopEvidence } = require('../db');
      if (!listLoopEvidence) {
        return res.json({ ok: true, evidence: [], count: 0 });
      }
      const evidence = listLoopEvidence(loopRunId, { limit: 500 });
      const compact = evidence.map((e) => ({
        evidenceId: e.evidenceId,
        loopRunId: e.loopRunId,
        iterationId: e.iterationId,
        kind: e.kind,
        ref: e.ref,
        summaryDigest: e.summaryDigest,
        hash: e.hash,
        createdAt: e.createdAt,
      }));
      res.json({ ok: true, evidence: compact, count: compact.length });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  /**
   * GET /api/loop/recovery/:loopRunId
   * Returns a recovery projection:
   *   - Current loop state
   *   - Last iteration summary
   *   - Failed/pending jobs needing recovery
   *   - Next recommended action hint
   *   - Whether the loop can be safely resumed
   */
  router.get('/recovery/:loopRunId', requireUser, (req, res) => {
    const { loopRunId } = req.params;
    if (!loopRunId) return res.status(400).json({ ok: false, error: 'missing loopRunId' });

    try {
      const run = loadRunAuthorized(req, res, loopRunId);
      if (!run) return undefined;

      // getLoopRun() returns the parsed status JSON under `record` (NOT
      // loopStatusJson — that field does not exist on the projection).
      const statusJson = (run.record && typeof run.record === 'object') ? run.record : {};

      // Determine recovery state. A server restart marks an interrupted run
      // failed(recovery_required=true); surface that as needing recovery even
      // though the status is terminal, but do NOT report it as safely resumable.
      const isTerminal = ['completed', 'failed', 'cancelled'].includes(run.loopStatus);
      const recoveryRequired = Boolean(statusJson.recovery_required);
      const needsRecovery = run.loopStatus === 'running' || recoveryRequired;

      // Get last iteration
      let lastIteration = null;
      try {
        const { listLoopIterations } = require('../db');
        if (listLoopIterations) {
          const iters = listLoopIterations(loopRunId, { limit: 1 });
          lastIteration = iters.length > 0 ? {
            iterationId: iters[0].iterationId,
            sequence: iters[0].sequence,
            decision: iters[0].decision,
            decisionReasonCode: iters[0].decisionReasonCode,
            status: iters[0].status,
            publicConclusion: iters[0].publicConclusion,
          } : null;
        }
      } catch {}

      const recovery = {
        loopRunId: run.loopRunId,
        projectId: run.projectId,
        conversationId: run.conversationId,
        loopStatus: run.loopStatus,
        automationMode: run.automationMode,
        isTerminal,
        needsRecovery,
        recoveryRequired,
        canResume: run.loopStatus === 'running' && !recoveryRequired,
        lastIteration,
        statusJson,
        recoveryHint: _buildRecoveryHint(run, lastIteration, statusJson),
      };

      res.json({ ok: true, recovery });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  /**
   * POST /api/loop/runs/:loopRunId/abort
   * Signal the loop to abort on next pre-turn check.
   * Writes abort flag to loop_status_json.
   */
  router.post('/runs/:loopRunId/abort', requireUser, (req, res) => {
    const { loopRunId } = req.params;
    if (!loopRunId) return res.status(400).json({ ok: false, error: 'missing loopRunId' });

    try {
      const run = loadRunAuthorized(req, res, loopRunId);
      if (!run) return undefined;
      if (['completed', 'failed', 'cancelled'].includes(run.loopStatus)) {
        return res.status(409).json({ ok: false, error: 'loop_already_terminal' });
      }

      const { updateLoopRunStatus } = require('../db');
      const statusJson = { ...(run.record || {}), abortedByUser: true, abortedAt: new Date().toISOString() };
      updateLoopRunStatus(loopRunId, {
        loopStatus: run.loopStatus, // keep running
        hash: run.hash,
        json: JSON.stringify(statusJson),
        updatedAt: new Date().toISOString(),
      });
      res.json({ ok: true, loopRunId, aborted: true, updatedAt: statusJson.abortedAt });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Mount at /api/loop
  app.use('/api/loop', router);
}

function _buildRecoveryHint(run, lastIteration, statusJson) {
  if (['completed', 'cancelled'].includes(run.loopStatus)) {
    return 'Loop 已终止，无恢复必要。';
  }
  if (run.loopStatus === 'failed') {
    return 'Loop 失败，请查看 iterations 和 evidence 了解失败原因。';
  }
  if (statusJson.abortedByUser) {
    return '用户已终止，可重新发起新的任务。';
  }
  if (lastIteration) {
    if (lastIteration.decision === 'block') {
      return `上一轮决策为 block（${lastIteration.decisionReasonCode}）：${lastIteration.publicConclusion || '请修复问题后重试。'}`;
    }
    if (lastIteration.decision === 'retry') {
      return `上一轮决策为 retry（${lastIteration.decisionReasonCode}）：${lastIteration.publicConclusion || '系统将自动重试。'}`;
    }
    return `上一轮决策：${lastIteration.decision}（${lastIteration.decisionReasonCode}）。`;
  }
  return 'Loop 处于 running 状态，可安全恢复。';
}

module.exports = { registerAiLoopRoutes };

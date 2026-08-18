'use strict';

/**
 * routes/harness/loop.js — loop（HLE-1）子域（PHASE 2.2a）
 *
 * 下沉的端点（来自 routes/harness.js 第 1217-1365 行）：
 *   POST /api/loop/iterate
 *   GET  /api/loop/:loopRunId
 *   POST /api/loop/snapshot
 *
 * 共享 helper 走 `routes/_helpers/harness-shared`：
 *   - canAccessProject
 *
 * 行为 100% 兼容：try/catch 顺序、status code、response shape 保持不变。
 */

const express = require('express');
const db = require('../../db');
const loopContract = require('../../../shared-backend/loop-contract');
const { canAccessProject } = require('../_helpers/harness-shared');

module.exports = {
  register(app) {
    // ============================================================
    // HLE-1 Loop ledger routes
    // ============================================================
    // The Loop is the durable record of how an agent advanced a
    // conversation. /api/loop/iterate appends an Iteration (and its
    // Action/Evidence/Decision) atomically, with idempotent actionKey
    // dedupe and FSM-checked status transitions. Cross-project queries
    // are gated by `authorizeAndResolveOptions` (see scientific-task
    // routes above for the canonical pattern).
    app.post('/api/loop/iterate', express.json({ limit: '256kb' }), (req, res) => {
      try {
        const body = req.body || {};
        if (!body.projectId || !body.conversationId) {
          return res.status(400).json({ ok: false, error: 'missing_project_or_conversation' });
        }
        const project = db.getProject(body.projectId);
        if (!project) return res.status(404).json({ ok: false, error: 'project_not_found' });
        if (!canAccessProject(req, project)) return res.status(403).json({ ok: false, error: 'forbidden' });

        const loopRunInput = body.loopRun || {};
        if (!loopRunInput.loopRunId || !loopRunInput.loopStatus) {
          return res.status(400).json({ ok: false, error: 'loop_run_required' });
        }
        const existing = db.getLoopRun(loopRunInput.loopRunId);
        if (existing && existing.projectId !== body.projectId) {
          return res.status(403).json({ ok: false, error: 'cross_project_isolation' });
        }
        if (existing) {
          const transition = loopContract.checkLoopStatusTransition(
            existing.loopStatus,
            loopRunInput.loopStatus,
          );
          if (transition instanceof Error) {
            return res.status(422).json({ ok: false, error: transition.message });
          }
        }

        const builtRun = loopContract.buildLoopRun({
          ...loopRunInput,
          projectId: body.projectId,
          conversationId: body.conversationId,
        });

        const iterationInput = body.iteration;
        if (!iterationInput || typeof iterationInput !== 'object') {
          return res.status(400).json({ ok: false, error: 'iteration_required' });
        }
        if (existing && existing.loopStatus !== 'planned') {
          if (
            !Number.isInteger(iterationInput.sequence) ||
            iterationInput.sequence <= 0
          ) {
            return res.status(400).json({ ok: false, error: 'iteration_sequence_invalid' });
          }
          const lastSeq = db.listLoopIterations(existing.loopRunId || builtRun.loopRunId, { limit: 1 })[0];
          const targetSeq = lastSeq ? lastSeq.sequence + 1 : 1;
          if (iterationInput.sequence !== targetSeq) {
            return res.status(409).json({
              ok: false,
              error: 'iteration_sequence_out_of_order',
              expected: targetSeq,
              received: iterationInput.sequence,
            });
          }
        }
        const builtIteration = loopContract.buildIteration({
          ...iterationInput,
          loopRunId: builtRun.loopRunId,
        });

        const txResult = db.transaction(() => {
          const persistedRun = db.persistLoopRun(builtRun);
          if (existing) {
            db.updateLoopRunStatus(builtRun.loopRunId, {
              loopStatus: builtRun.loopStatus,
              hash: builtRun.hash,
              json: JSON.stringify(builtRun),
              updatedAt: builtRun.updatedAt,
            });
          }
          const persistedIteration = db.persistLoopIteration(builtIteration);
          let persistedAction = null;
          if (builtIteration.proposedAction && builtIteration.proposedAction.actionId) {
            try {
              persistedAction = db.persistLoopAction({
                ...builtIteration.proposedAction,
                loopRunId: builtRun.loopRunId,
                sequence: builtIteration.sequence,
                iterationId: builtIteration.iterationId,
              });
            } catch (e) {
              if (e.message === 'loop_action_duplicate_action_key') {
                const existing2 = db.getLoopActionByKey(builtIteration.proposedAction.actionKey);
                return { persistedRun, persistedIteration, persistedAction: existing2, deduped: true };
              }
              throw e;
            }
          }
          return { persistedRun, persistedIteration, persistedAction, deduped: false };
        })();

        res.json({
          ok: true,
          loopRun: txResult.persistedRun,
          iteration: txResult.persistedIteration,
          action: txResult.persistedAction,
          deduped: !!txResult.deduped,
        });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    });

    app.get('/api/loop/:loopRunId', (req, res) => {
      try {
        const loopRun = db.getLoopRun(req.params.loopRunId);
        if (!loopRun) return res.status(404).json({ ok: false, error: 'loop_run_not_found' });
        const project = db.getProject(loopRun.projectId);
        if (!project || !canAccessProject(req, project)) {
          return res.status(project ? 403 : 404).json({ ok: false, error: project ? 'forbidden' : 'project_not_found' });
        }
        const iterations = db.listLoopIterations(loopRun.loopRunId, { limit: 200 });
        const evidence = db.listLoopEvidence(loopRun.loopRunId, { limit: 100 });
        const latestSnapshot = db.getLatestLoopSnapshot(loopRun.loopRunId);
        res.json({
          ok: true,
          loopRun,
          iterations,
          evidence,
          latestSnapshot,
        });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    });

    app.post('/api/loop/snapshot', express.json({ limit: '256kb' }), (req, res) => {
      try {
        const body = req.body || {};
        const loopRun = db.getLoopRun(body.loopRunId);
        if (!loopRun) return res.status(404).json({ ok: false, error: 'loop_run_not_found' });
        const project = db.getProject(loopRun.projectId);
        if (!project || !canAccessProject(req, project)) {
          return res.status(project ? 403 : 404).json({ ok: false, error: project ? 'forbidden' : 'project_not_found' });
        }
        const persisted = db.persistLoopSnapshot({
          snapshotId: body.snapshotId || `snap_${Math.random().toString(36).slice(2, 14)}`,
          loopRunId: body.loopRunId,
          sequenceAt: Number(body.sequenceAt || 0),
          payload: body.payload || {},
          sourceHash: body.sourceHash,
          createdAt: new Date().toISOString(),
        });
        res.json({ ok: true, snapshot: persisted });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    });
  },
};

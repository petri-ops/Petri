'use strict';

/**
 * routes/harness/context.js — context 子域（PHASE 2.2a）
 *
 * 下沉的端点（来自 routes/harness.js 第 903-921 行）：
 *   POST /api/harness/context-checkpoint
 *
 * 共享 helper 走 `routes/_helpers/harness-shared`：
 *   - canAccessProject
 *
 * 行为 100% 兼容：try/catch 顺序、status code、response shape 保持不变。
 */

const express = require('express');
const db = require('../../db');
const {
  validateContextCheckpoint,
  validateCheckpointSupersession,
} = require('../../../shared-backend/scientific-task-spec');
const { canAccessProject } = require('../_helpers/harness-shared');

module.exports = {
  register(app) {
    app.post('/api/harness/context-checkpoint', express.json({ limit: '256kb' }), (req, res) => {
      try {
        const validated = validateContextCheckpoint(req.body?.checkpoint);
        if (!validated.ok) return res.status(422).json({ ok: false, error: 'context_checkpoint_invalid', issues: validated.issues });
        const checkpoint = validated.checkpoint;
        const project = db.getProject(checkpoint.projectId);
        if (!project || !canAccessProject(req, project)) return res.status(project ? 403 : 404).json({ ok: false, error: project ? 'forbidden' : 'project_not_found' });
        if (checkpoint.supersedes) {
          const previous = db.getContextCheckpoint(checkpoint.supersedes);
          if (!previous) return res.status(422).json({ ok: false, error: 'context_checkpoint_supersedes_not_found' });
          const supersession = validateCheckpointSupersession(checkpoint, previous);
          if (!supersession.ok) return res.status(422).json({ ok: false, error: supersession.error, issues: supersession.issues || [] });
        }
        const stored = db.saveContextCheckpoint(checkpoint);
        return res.json({ ok: true, checkpoint: stored });
      } catch (error) {
        return res.status(422).json({ ok: false, error: error.message });
      }
    });
  },
};

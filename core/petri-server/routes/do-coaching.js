'use strict';

/**
 * routes/do-coaching.js — item 87 第二波：教练循环只读/记录面。
 *
 * 全部端点经 PILOT_DOMAINS 白名单（只 bio 试点域激活），引擎侧二次校验。
 * 端点：
 *   POST /api/do/coaching/runs      { goalId, taskId?, domain, userId, accepted?, total? }
 *   POST /api/do/coaching/decisions { runId, taskId?, explanation{decision,why,domainConvention,forkOptions?} }
 *   POST /api/do/coaching/reviews   { runId, userId?, divergences[五字段] }
 *   POST /api/do/coaching/samples/seed {}   ← bio 品味样本草稿 md 结构化入库（幂等）
 *   GET  /api/do/coaching/samples?domain=
 *   GET  /api/do/coaching/summary?projectId=  ← 总览面消费（按项目聚合 runs/分歧数）
 *
 * 只读/记录纪律：不写 wb_* 表；分歧/讲解走各自 append-only 表与 task_events。
 */

const fs = require('fs');
const path = require('path');
const {
  createCoachingRun,
  recordDecisionExplanation,
  recordReview,
  compareAgainstSamples,
  seedBioTasteSamplesFromMarkdown,
  PILOT_DOMAINS,
} = require('../../shared-backend/do-coaching');

const TASTE_MD_PATH = path.resolve(__dirname, '..', '..', '..', 'resources', 'domain-onboarding', 'petri-pack-bio', 'taste-samples.md');

function registerDoCoachingRoutes(app) {
  const bodyJson = require('express').json({ limit: '256kb' });

  app.post('/api/do/coaching/runs', bodyJson, (req, res) => {
    const { goalId, taskId, domain, userId, accepted, total } = req.body || {};
    const result = createCoachingRun(require('../db').getDatabase(), {
      goalId, taskId, domain, userId, accepted, total,
    });
    return res.status(result.ok ? 200 : 400).json({ ...result });
  });

  app.post('/api/do/coaching/decisions', bodyJson, (req, res) => {
    const { runId, taskId, explanation } = req.body || {};
    const result = recordDecisionExplanation(require('../db').getDatabase(), { runId, taskId, explanation });
    return res.status(result.ok ? 200 : 400).json({ ...result });
  });

  app.post('/api/do/coaching/reviews', bodyJson, (req, res) => {
    const { runId, userId, divergences } = req.body || {};
    const result = recordReview(require('../db').getDatabase(), { runId, userId, divergences });
    return res.status(result.ok ? 200 : 400).json({ ...result });
  });

  app.post('/api/do/coaching/samples/seed', bodyJson, (req, res) => {
    if (!fs.existsSync(TASTE_MD_PATH)) {
      return res.status(404).json({ ok: false, error: 'taste_samples_md_not_found' });
    }
    const db = require('../db').getDatabase();
    try {
      const result = seedBioTasteSamplesFromMarkdown(db, fs.readFileSync(TASTE_MD_PATH, 'utf8'));
      return res.json({ ...result, domain: PILOT_DOMAINS[0] });
    } catch (error) {
      return res.status(400).json({ ok: false, error: String(error.message) });
    }
  });

  app.get('/api/do/coaching/samples', (req, res) => {
    const domain = typeof req.query.domain === 'string' ? req.query.domain : PILOT_DOMAINS[0];
    const db = require('../db').getDatabase();
    const rows = db.prepare('SELECT * FROM do_sample_libraries WHERE domain = ? ORDER BY dimension').all(domain);
    return res.json({
      ok: true,
      samples: rows.map((row) => ({
        sampleId: row.sample_id,
        dimension: row.dimension,
        good: JSON.parse(row.good_json),
        bad: JSON.parse(row.bad_json),
        rationale: row.rationale,
        sourceRef: row.source_ref,
        status: row.status,
      })),
    });
  });

  app.get('/api/do/coaching/compare', (req, res) => {
    let observations;
    try {
      observations = JSON.parse(String(req.query.observations || '[]'));
    } catch {
      return res.status(400).json({ ok: false, error: 'observations_parse_failed' });
    }
    const domain = typeof req.query.domain === 'string' ? req.query.domain : PILOT_DOMAINS[0];
    const result = compareAgainstSamples(require('../db').getDatabase(), { domain, artifactObservations: observations });
    return res.status(result.ok ? 200 : 400).json({ ...result });
  });

  app.get('/api/do/coaching/summary', (req, res) => {
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId.trim() : '';
    if (!projectId) return res.status(400).json({ ok: false, error: 'project_id_required' });
    const db = require('../db').getDatabase();
    const runs = db.prepare(`
      SELECT r.run_id, r.goal_id, r.task_id, r.domain, r.user_id, r.phase,
             r.handover_ratio, r.decision_count, r.accepted_count, r.total_count, r.updated_at
      FROM do_coaching_runs r
      JOIN wb_goals g ON g.id = r.goal_id
      WHERE g.project_id = ?
      ORDER BY r.updated_at DESC
    `).all(projectId);
    const divergenceRows = db.prepare(`
      SELECT p.profile_id, p.run_id, p.divergences_json, p.created_at
      FROM do_competence_profiles p
      JOIN do_coaching_runs r ON r.run_id = p.run_id
      JOIN wb_goals g ON g.id = r.goal_id
      WHERE g.project_id = ?
      ORDER BY p.created_at DESC
    `).all(projectId);
    return res.json({
      ok: true,
      projectId,
      pilotDomains: PILOT_DOMAINS,
      runs: runs.map((run) => ({ ...run, divergences_json: undefined })),
      divergences: divergenceRows.map((row) => ({
        profileId: row.profile_id,
        runId: row.run_id,
        divergences: JSON.parse(row.divergences_json),
        createdAt: row.created_at,
      })),
    });
  });
}

module.exports = { registerDoCoachingRoutes };

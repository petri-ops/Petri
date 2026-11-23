'use strict';

/**
 * routes/skill-suggestions.js — QODER-J2 技能自进化建议（2026-11-23）。
 *
 * 读：GET /api/harness/skill-suggestions —— 从 lessons 表（本地审计）经 J2 投影器生成建议，
 *     叠加独立忽略账本；只读、零外发。
 * 写：POST /api/harness/skill-suggestions/ignore —— 忽略/取消忽略（独立 JSON 账本，
 *     不写 lessons.status，避免下次 distill 覆盖）。
 * 一键建任务不在本路由：建议 prompt 由客户端显式触发既有 POST /api/ai/agent 创建链（D2 默认否）。
 */
module.exports = function registerSkillSuggestionRoutes(app) {
  const db = require('../db').getDatabase();
  const { projectSkillSuggestions } = require('../../shared-backend/skill-suggestion-projector');
  const { loadIgnored, ignoreSuggestion, unignoreSuggestion } = require('../../shared-backend/skill-suggestion-prefs');
  const { discoverSkills } = require('../../shared-backend/skill-registry');

  function availableSkillIds() {
    try {
      const found = discoverSkills();
      const skills = Array.isArray(found) ? found : (Array.isArray(found && found.skills) ? found.skills : []);
      return skills.map((skill) => skill && (skill.id || skill.skillId))
        .filter((id) => typeof id === 'string');
    } catch {
      return [];
    }
  }

  app.get('/api/harness/skill-suggestions', (_req, res) => {
    try {
      const lessons = db.prepare(
        `SELECT source_fingerprint, title, action, scope, confidence, status,
                occurrences_before, occurrences_after
         FROM lessons ORDER BY last_seen_at DESC LIMIT 200`
      ).all().map((row) => ({
        sourceFingerprint: row.source_fingerprint,
        title: row.title,
        action: row.action,
        scope: row.scope,
        confidence: row.confidence,
        status: row.status,
        before: Number(row.occurrences_before) || 0,
        after: Number(row.occurrences_after) || 0,
        verdict: null,
      }));
      const result = projectSkillSuggestions({
        lessons,
        availableSkillIds: availableSkillIds(),
        ignored: loadIgnored(),
      });
      return res.json(result);
    } catch (error) {
      return res.status(500).json({ ok: false, error: String(error && error.message || error).slice(0, 200) });
    }
  });

  app.post('/api/harness/skill-suggestions/ignore', (req, res) => {
    const fingerprint = String((req.body && req.body.fingerprint) || '');
    const action = String((req.body && req.body.action) || 'ignore');
    if (action === 'unignore') return res.json(unignoreSuggestion(fingerprint));
    return res.json(ignoreSuggestion(fingerprint, req.body && req.body.reason));
  });
};

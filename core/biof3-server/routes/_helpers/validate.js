'use strict';

/**
 * routes/_helpers/validate.js — 输入校验共享 helper
 *
 * 抽自 `core/biof3-server/routes/result-studio.js` PHASE 2.1a 拆分 commit。
 * 类别：auth/request 侧的归属与边界校验。
 *   - userId(req)             → req.user.id / req.user.userId 兜底
 *   - isAdminOrInternal(req)  → admin / internal 标记
 *   - canAccessProject(req, project) → 项目归属校验
 */

function userId(req) {
  return (req.user && (req.user.id || req.user.userId)) || null;
}

function isAdminOrInternal(req) {
  return req.isInternal || (req.user && req.user.role === 'admin');
}

function canAccessProject(req, project) {
  if (!project) return false;
  if (isAdminOrInternal(req)) return true;
  const uid = userId(req);
  return !!(project.is_public || !project.user_id || project.user_id === uid);
}

module.exports = {
  userId,
  isAdminOrInternal,
  canAccessProject,
};

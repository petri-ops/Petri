'use strict';

/**
 * routes/svg.js — BLOCK-342 W1：SVG 编辑器 REST 面（受治理编辑桥的前端入口）。
 *
 * 与 model3d/scene/apply 同形（projectId + path + ops + expectedHash），差异只有载体：
 *   - 真值 = 工作区 .svg 文件本身（span 改写引擎，零操作零 diff）；
 *   - 冲突 = svg_hash_mismatch（409），人的修正天然不被覆盖；
 *   - 审计快照 = .petri/svg-revisions/（非第二真值）。
 *
 * 路由只做鉴权/本地项目前置/错误码→HTTP 语义映射，业务全在 agent-tools/svg-tools（与 agent 同一套实现）。
 */

const db = require('../db');
const { authorizeProject } = require('../agent-tools/workspace-tools/internals');
const { tool_svg_inspect, tool_svg_edit } = require('../agent-tools/svg-tools');

const PATH_REJECT_ERRORS = ['sensitive_path', 'path_escape', 'symlink_escape', 'workspace_unavailable'];

/** 工具错误码 → HTTP 状态（404/409/413/403 各归其类，其余 400）。 */
function statusForError(error) {
  if (error === 'file_not_found' || error === 'project_not_found') return 404;
  if (error === 'svg_hash_mismatch') return 409;
  if (error === 'file_too_large') return 413;
  if (PATH_REJECT_ERRORS.includes(error)) return 403;
  if (error === 'project_required') return 400;
  return 400;
}

function requestUserId(req) {
  return req.userId || (req.user && req.user.id) || null;
}

/** 本地项目授权前置（ssh 工作区不支持：编辑器在本机文件上工作）。 */
function loadLocalProject(req, res, projectId) {
  const id = String(projectId || '');
  if (!id) {
    res.status(400).json({ ok: false, error: 'project_id_required', message: '需要 projectId' });
    return null;
  }
  const project = db.getProject(id);
  if (!project) {
    res.status(404).json({ ok: false, error: 'project_not_found', message: '项目不存在' });
    return null;
  }
  const userId = requestUserId(req);
  try {
    authorizeProject(project, userId, db);
  } catch (error) {
    res.status(error.code === 'unauthorized' ? 401 : 403)
      .json({ ok: false, error: error.code || 'permission_denied', message: error.message });
    return null;
  }
  if (project.workspace_kind === 'ssh') {
    res.status(400).json({
      ok: false,
      error: 'local_project_required',
      message: 'SVG 编辑器在本机文件上工作，仅支持本地项目工作区。',
    });
    return null;
  }
  return { project, userId };
}

/** 工具结果 → HTTP 响应（成功透传，失败按 error 码映射状态并附 requireAck）。 */
function respondTool(res, result) {
  if (result && result.ok) return res.json(result);
  const error = (result && result.error) || 'svg_error';
  const status = statusForError(error);
  return res.status(status).json({ ok: false, ...result, error });
}

module.exports = function registerSvgRoutes(app) {
  // 只读结构清单（编辑器打开时 + agent 编辑前摸结构）
  app.post('/api/svg/inspect', (req, res) => {
    const auth = loadLocalProject(req, res, req.body && req.body.projectId);
    if (!auth) return;
    const result = tool_svg_inspect({
      filePath: req.body.path,
      target: req.body.target,
      tag: req.body.tag,
      limit: req.body.limit,
    }, { projectId: auth.project.id });
    return respondTool(res, result);
  });

  // 白名单 op：apply 缺省 false = 只校验（propose）；apply:true 须带 beforeSha256
  app.post('/api/svg/edit', (req, res) => {
    const auth = loadLocalProject(req, res, req.body && req.body.projectId);
    if (!auth) return;
    const result = tool_svg_edit({
      filePath: req.body.path,
      ops: req.body.ops,
      apply: req.body.apply === true,
      beforeSha256: req.body.beforeSha256,
    }, { projectId: auth.project.id });
    return respondTool(res, result);
  });
};

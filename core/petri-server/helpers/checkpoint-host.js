'use strict';

/**
 * helpers/checkpoint-host.js — BLOCK-335 P1 checkpoint 宿主原语生产实现。
 *
 * 复用 shared-backend/workspace-checkpoint（BLOCK-176 CP-17，git 无副作用快照），
 * 不建第二快照机制。授权镜像 recipe 原语（authorizeProject）；ssh 项目无本地工作树
 * → 诚实拒绝。ref 由调用方（workflow journal / REST 响应）持久化，跨进程回滚
 * 因进程内登记表缺席而 fail-closed（诚实边界，不伪造可回滚）。
 */

const workspaceCheckpoint = require('../../shared-backend/workspace-checkpoint');

const CHECKPOINT_ACTIONS = Object.freeze(['create', 'rollback', 'list']);

/**
 * @param {{dbMod?: object, authorizeProject?: function}} deps
 * @returns {(payload: {projectId: string, action?: string, ref?: string}) => Promise<object>}
 */
function createCheckpointHost({ dbMod, authorizeProject } = {}) {
  return async function checkpoint(options = {}) {
    const action = CHECKPOINT_ACTIONS.includes(options.action) ? options.action : 'create';
    const projectId = options.projectId ? String(options.projectId).slice(0, 80) : '';
    if (!projectId) return { ok: false, error: 'project_required' };
    const db = dbMod || require('../db');
    let project = null;
    try {
      const lookup = typeof db.getProject === 'function' ? db.getProject : null;
      project = lookup ? lookup(projectId) : null;
    } catch (error) {
      return { ok: false, error: 'project_lookup_failed', message: String((error && error.message) || error).slice(0, 200) };
    }
    if (!project || !project.workspace_path) {
      return { ok: false, error: 'workspace_required', message: 'checkpoint 仅支持本地工作区项目' };
    }
    const auth = authorizeProject && typeof authorizeProject === 'function'
      ? (() => { try { return authorizeProject(project, options.userId, db) || { ok: true }; } catch (error) { return { ok: false, error: error.code || 'permission_denied', message: error.message }; } })()
      : { ok: true };
    if (auth && auth.ok === false) {
      return { ok: false, error: auth.error || 'permission_denied', message: auth.message };
    }
    const ws = project.workspace_path;
    if (action === 'list') {
      return { ok: true, action, checkpoints: workspaceCheckpoint.listCheckpoints(ws) };
    }
    if (action === 'create') {
      // force：闭环的 checkpoint 先于 agent 改动——干净树也要拿到 HEAD 回滚锚点
      const created = await workspaceCheckpoint.createCheckpoint(ws, { force: true });
      return { ok: created.ok, action, created: created.created === true, ref: created.ref || null, code: created.code, message: created.message };
    }
    // rollback —— 显式传 ref（计划红线：回滚显式传 ref，不静默取最新）
    const ref = options.ref ? String(options.ref).slice(0, 80) : '';
    if (!ref) return { ok: false, error: 'ref_required', message: '回滚必须显式携带 checkpoint ref' };
    const rolled = await workspaceCheckpoint.rollbackToCheckpoint(ws, ref);
    return { ok: rolled.ok, action, ref: rolled.ref || ref, code: rolled.code, message: rolled.message };
  };
}

module.exports = {
  CHECKPOINT_ACTIONS,
  createCheckpointHost,
};

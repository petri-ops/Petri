'use strict';

/**
 * helpers/session-workspace.js — BLOCK-337 P2 会话侧治理上下文装载（调用侧接线）。
 *
 * context.workspacePath 的唯一可信来源是 projects 表（workspace_path），不从客户端
 * 请求体采信——客户端传值一律覆盖/剥除，防止伪造路径骗挂治理规则包。
 * ssh 项目 workspace_path 为 null（远程唯一真值）→ 无治理上下文，动态段自然缺席。
 * 失败语义：任何失败 = 无治理上下文，绝不阻断对话（与 system-prompt 注入侧 try/catch 对称）。
 */

/**
 * 从 context.projectId 派生 workspace_path（同步；db 懒取，测试可注入 getProject）。
 * @returns {string|undefined} 有本地工作目录时返回路径，否则 undefined。
 */
function resolveSessionWorkspacePath(context, { getProject } = {}) {
  if (!context || typeof context !== 'object') return undefined;
  const projectId = context.projectId ? String(context.projectId) : '';
  if (!projectId) return undefined;
  try {
    const lookup = typeof getProject === 'function' ? getProject : require('../db').getProject;
    const project = typeof lookup === 'function' ? lookup(projectId) : null;
    const workspacePath = project && typeof project.workspace_path === 'string' ? project.workspace_path : '';
    return workspacePath || undefined;
  } catch {
    return undefined;
  }
}

/**
 * 原地补全 context.workspacePath：服务端派生值覆盖客户端值；派生不出（无 projectId /
 * ssh 项目 / 查询失败）时剥掉客户端传值——缺省即零治理注入，绝不信任请求体路径。
 * @returns {object} 同一个 context（便于链式）。
 */
function applySessionWorkspacePath(context, deps) {
  if (!context || typeof context !== 'object') return context;
  const derived = resolveSessionWorkspacePath(context, deps);
  if (derived) context.workspacePath = derived;
  else delete context.workspacePath;
  return context;
}

module.exports = { resolveSessionWorkspacePath, applySessionWorkspacePath };

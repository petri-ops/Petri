/**
 * QODER-J4 P1 — MCP agent 侧 authenticate 请求校验 + 项目级默认策略（2026-11-23）。
 *
 * 零新依赖；不读写 token（mcp-oauth-store 已封装加密链）；authorizationUrl 不进日志/审计。
 * D1 默认=ask（现状零变化）/ D2 needsApproval=true（发起 OAuth 会开外部授权页，事前声明）。
 */
'use strict';

const VALID_DEFAULTS = new Set(['ask', 'allow']);

/** 仅远程（http/sse）MCP 服务可发起 OAuth；stdio 无 OAuth 流程。 */
function validateAuthRequest({ serverId, transport, redirectBase } = {}) {
  const id = String(serverId || '').trim();
  const kind = String(transport || '').toLowerCase();
  if (!id) return { ok: false, error: 'server_id_required' };
  if (kind !== 'http' && kind !== 'sse') return { ok: false, error: 'oauth_requires_remote' };
  if (redirectBase !== undefined) {
    try {
      const parsed = new URL(String(redirectBase));
      if (!['http:', 'https:'].includes(parsed.protocol)) return { ok: false, error: 'invalid_redirect_base' };
    } catch {
      return { ok: false, error: 'invalid_redirect_base' };
    }
  }
  return { ok: true, serverId: id, transport: kind, needsApproval: true };
}

/** 对外投影：只含 serverId/status，绝不回传 authorizationUrl/token（防泄漏到日志/状态面）。 */
function publicAuthOutcome(outcome = {}) {
  return {
    serverId: typeof outcome.serverId === 'string' ? outcome.serverId : null,
    status: typeof outcome.status === 'string' ? outcome.status.slice(0, 64) : 'unknown',
  };
}

/** 项目级 MCP 默认信任：缺省/非法一律 ask（与现状 EMPTY_POLICY 一致，零行为变化）。 */
function resolveProjectMcpDefault(config) {
  const value = config && typeof config === 'object' ? config.mcpDefaultTrust : undefined;
  return VALID_DEFAULTS.has(value) ? value : 'ask';
}

module.exports = { validateAuthRequest, publicAuthOutcome, resolveProjectMcpDefault };

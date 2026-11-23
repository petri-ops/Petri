/**
 * QODER-J4 — mcp_authenticate agent 工具 handler（2026-11-23）。
 *
 * 委托既有 `mcp/client-manager.beginAuthorization`（OAuth 发起链单源），不读写 token。
 * P1 核心 `mcp-agent-auth-request.js` 做请求校验 + 对外投影（authorizationUrl/token 不回传）。
 * 零新依赖；manager/settings 注入以便单测；生产由 factory 默认注入模块单例。
 */
'use strict';

const defaultManager = require('../mcp/client-manager');
const defaultSettings = require('../helpers/mcp-settings');
const { validateAuthRequest, publicAuthOutcome } = require('../../shared-backend/mcp-agent-auth-request');

const DEFAULT_REDIRECT_BASE = 'http://127.0.0.1:3000';

function createMcpAuthTools(options = {}) {
  const manager = options.manager || defaultManager;
  const settings = options.settings || defaultSettings;

  async function mcpAuthenticate(args = {}, ctx = {}) {
    const serverId = String(args.serverId || '').trim();
    const cfg = (typeof settings.getMcpServer === 'function') ? settings.getMcpServer(serverId) : null;
    if (!cfg) return { ok: false, error: 'server_not_found' };
    const redirectBase = args.redirectBase || ctx.redirectBase || DEFAULT_REDIRECT_BASE;
    const checked = validateAuthRequest({
      serverId,
      transport: cfg.transport,
      redirectBase,
    });
    if (!checked.ok) return { ok: false, error: checked.error };

    let outcome;
    try {
      outcome = await manager.beginAuthorization(serverId, { redirectBase });
    } catch (error) {
      return { ok: false, error: 'authorization_failed', message: String(error && error.message || error).slice(0, 200) };
    }
    if (!outcome || !outcome.ok) return { ok: false, error: (outcome && outcome.error) || 'authorization_failed' };

    // P1 投影：只回 serverId/status，绝不回传 authorizationUrl/token（防泄漏到工具结果/审计）。
    // serverId 以本工具入参为准（manager  outcomes 未必回带）。
    const view = publicAuthOutcome({ ...outcome, serverId });
    return {
      ok: true,
      ...view,
      ...(outcome.status === 'connected' && Number.isFinite(outcome.toolCount)
        ? { toolCount: outcome.toolCount } : {}),
    };
  }

  return { mcpAuthenticate };
}

const defaultTools = createMcpAuthTools();

module.exports = { createMcpAuthTools, tool_mcp_authenticate: defaultTools.mcpAuthenticate };

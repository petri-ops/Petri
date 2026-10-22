'use strict';

/**
 * mcp/oauth-provider.js — BLOCK-239 逐 server OAuth 客户端 provider。
 *
 * 实现 MCP SDK 的 OAuthClientProvider 契约；发现/动态注册/PKCE/换 token/刷新
 * 都由 SDK（auth.js）完成，本模块只负责：
 *   - 生成 loopback redirect URL；
 *   - 把 clientInformation / tokens / codeVerifier / pending state 交给密文 store；
 *   - 把授权 URL 暂存给路由返回（不自己开浏览器）。
 *
 * 安全边界：token/verifier 只经 store 加密落盘；provider 自身不打印、不返回状态面。
 */

const crypto = require('node:crypto');
const store = require('../helpers/mcp-oauth-store');

let _getBackendPort = null;
function backendPort() {
  if (!_getBackendPort) {
    try {
      ({ getBackendPort: _getBackendPort } = require('../../../src/main/env-coordinator'));
    } catch {
      _getBackendPort = () => Number(process.env.R_SERVER_PORT) || 3001;
    }
  }
  return _getBackendPort('r');
}

function defaultRedirectBase() {
  const override = process.env.PETRI_MCP_OAUTH_REDIRECT_BASE;
  if (typeof override === 'string' && override.trim()) return override.trim().replace(/\/$/, '');
  return `http://127.0.0.1:${backendPort()}`;
}

function callbackPathFor(serverId) {
  return `/api/mcp/oauth/callback/${encodeURIComponent(String(serverId))}`;
}

function createOAuthProvider(serverId, options = {}) {
  const id = String(serverId || '');
  if (!id) throw new Error('serverId required');
  const redirectBase = (options.redirectBase || defaultRedirectBase()).replace(/\/$/, '');
  const redirectUrl = `${redirectBase}${callbackPathFor(id)}`;
  const clientMetadata = {
    client_name: 'Petri Desktop',
    redirect_uris: [redirectUrl],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: 'mcp:tools',
  };

  return {
    get redirectUrl() {
      return redirectUrl;
    },
    get clientMetadata() {
      return clientMetadata;
    },
    clientInformation() {
      return store.readEntry(id).clientInformation || undefined;
    },
    saveClientInformation(clientInformation) {
      store.updateEntry(id, (current) => ({ ...current, clientInformation }));
    },
    tokens() {
      return store.readEntry(id).tokens || undefined;
    },
    saveTokens(tokens) {
      store.updateEntry(id, (current) => {
        const next = { ...current, tokens };
        delete next.pending;
        delete next.codeVerifier;
        return next;
      });
    },
    redirectToAuthorization(authorizationUrl) {
      const url = authorizationUrl instanceof URL ? authorizationUrl.toString() : String(authorizationUrl);
      store.updateEntry(id, (current) => ({
        ...current,
        pending: {
          state: current.pending?.state || '',
          redirectBase,
          authorizationUrl: url,
          createdAt: current.pending?.createdAt || Date.now(),
        },
      }));
    },
    saveCodeVerifier(codeVerifier) {
      store.updateEntry(id, (current) => ({ ...current, codeVerifier }));
    },
    codeVerifier() {
      const value = store.readEntry(id).codeVerifier;
      if (!value) throw new Error('No code verifier saved');
      return value;
    },
    state() {
      const state = crypto.randomBytes(24).toString('hex');
      store.updateEntry(id, (current) => ({
        ...current,
        pending: { state, redirectBase, authorizationUrl: null, createdAt: Date.now() },
      }));
      return state;
    },
    invalidateCredentials(scope) {
      store.updateEntry(id, (current) => {
        const next = { ...current };
        if (scope === 'all' || scope === 'tokens') delete next.tokens;
        if (scope === 'all' || scope === 'client') delete next.clientInformation;
        if (scope === 'all' || scope === 'verifier') delete next.codeVerifier;
        if (scope === 'all') delete next.pending;
        return next;
      });
    },
  };
}

/** 路由/管理器读取授权 URL 与 pending state 的只读入口。 */
function pendingFor(serverId) {
  return store.pendingFor(serverId);
}

function authorizationUrlFor(serverId) {
  return store.pendingFor(serverId)?.authorizationUrl || null;
}

function clearPending(serverId) {
  return store.clearPending(serverId);
}

module.exports = {
  createOAuthProvider,
  pendingFor,
  authorizationUrlFor,
  clearPending,
};

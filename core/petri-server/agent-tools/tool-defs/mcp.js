'use strict';

/**
 * QODER-J4 — MCP agent 侧 authenticate 工具 Schema（2026-11-23）。
 * 由 tool-defs.js facade 汇编，勿直接 require。执行元数据见 ../tool-metadata.js。
 * 发起 OAuth 会打开外部授权页（needsApproval=true）；本工具不读写 token、
 * 不回传 authorizationUrl（只回 serverId/status），凭据链由 mcp-oauth-store 单源封装。
 */
module.exports = [
  {
    type: 'function',
    function: {
      name: 'mcp_authenticate',
      description: '为已配置的远程（http/sse）MCP 服务发起 OAuth 授权流程。仅"发起"——不读写 token、不返回授权 URL（结果只含 serverId/status），浏览器授权页由既有流程打开。stdio 服务不接受 OAuth。此动作会打开外部授权页，需用户批准。',
      parameters: {
        type: 'object',
        properties: {
          serverId: { type: 'string', description: '已配置的 MCP 服务 id' },
          redirectBase: { type: 'string', description: 'OAuth 回调基址（可选，缺省使用本机 loopback 默认）' },
        },
        required: ['serverId'],
      },
    },
  },
];

'use strict';

/**
 * routes/ai-agent/tools.js — tools 子域（PHASE 2.2b）
 *
 * 占位子域：原 routes/ai-agent.js 的 tools 逻辑保留在 chat.js（execute/reject）。
 * 工具注册走 agent-tools/index.js，不由独立路由端点暴露。
 *
 * 本文件保留作子域对齐（与 harness 模式一致），不注册额外端点。
 */
module.exports = { register() {} };

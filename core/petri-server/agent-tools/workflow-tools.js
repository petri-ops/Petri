'use strict';

/**
 * agent-tools/workflow-tools.js — NEXT-01 run_workflow Agent 工具。
 *
 * 通过本机既有 workflow REST 进入 workflow-runner（automation-runner 同姿势），
 * 不在 registry 工具面静态依赖 route/spawn，避免 registry→route→spawn→registry 环。
 * agent() 唯一执行路径仍是 launchSubAgent；本模块不建第二执行器。
 */

const AUTH_TOKEN = 'desktop-local';

function baseUrl() {
  return process.env.PETRI_WORKFLOW_BASE_URL
    || `http://127.0.0.1:${process.env.R_SERVER_PORT || 3001}`;
}

async function tool_run_workflow(args = {}) {
  if (process.env.PETRI_WORKFLOW_ENABLED !== '1') {
    return { ok: false, error: 'workflow_disabled', message: '工作流功能未启用（PETRI_WORKFLOW_ENABLED 未开启）。' };
  }
  try {
    const response = await fetch(`${baseUrl()}/api/ai/agent/workflow/run`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        script: args.script,
        args: args.args,
        dryRun: Boolean(args.dryRun),
        resumeFromRunId: typeof args.resumeFromRunId === 'string' ? args.resumeFromRunId : null,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = await response.json().catch(() => null);
    if (!body) return { ok: false, error: 'workflow_http_error', message: `HTTP ${response.status}` };
    if (!response.ok || body.ok === false) return body;
    return {
      ...body,
      message: body.dryRun
        ? '工作流已通过校验并完成 dryRun 预估；零执行。确认后再以 dryRun=false 启动。'
        : `工作流已启动（${body.runId}）；运行状态与 journal 可在右侧「工作流」面查看。`,
    };
  } catch (error) {
    return {
      ok: false,
      error: 'workflow_request_failed',
      message: error && error.message ? error.message : String(error),
    };
  }
}

module.exports = { tool_run_workflow };

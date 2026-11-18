'use strict';

/**
 * agent-tools/video-tools.js — BLOCK-482 / C-55 VIDEO-P0 视频成片消费面。
 *
 * tool_compose_video：VideoProjectSpec → 真实 MP4 + 旁白/字幕/讲稿/来源/QA/manifest。
 * 复用 helpers/video-compose.composeVideo（零新依赖）；TTS 在此窄口内授权开启
 * （不翻转全局 speech-config 默认关）。产物只写工作区 `.petri/video/<runId>/` 影子目录。
 *
 * 诚实边界：ffmpeg/云 TTS 缺席或失败均返回结构化原因，不产出「成功但不可用」MP4；
 * 观感终审（pending_human_eye）由用户签字，本工具不代签。
 */
const path = require('path');
const dbMod = require('../db');
require('../config');

function resolveWorkspace(ctx) {
  const projectId = ctx && ctx.projectId;
  if (!projectId) return { error: { ok: false, code: 'project_required', message: '视频工具需要有效项目工作区' } };
  const project = dbMod.getProject(String(projectId));
  if (!project || !project.workspace_path) {
    return { error: { ok: false, code: 'workspace_required', message: '视频工具需要本地工作区项目' } };
  }
  return { workspaceRoot: path.resolve(project.workspace_path) };
}

function safeRunId(raw) {
  const id = String(raw || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
  return id || `run-${Date.now()}`;
}

/**
 * tool_compose_video
 * @param {{spec:object, runId?:string, ttsConfig?:object}} args
 * @param {object} ctx - { projectId, ... }
 * @param {object} deps - 测试注入 {composeFn}
 */
async function tool_compose_video(args, ctx, deps = {}) {
  const spec = args && args.spec;
  if (!spec || typeof spec !== 'object') {
    return { ok: false, code: 'missing_spec', message: '需要 spec（VideoProjectSpec 对象）' };
  }
  const resolved = resolveWorkspace(ctx);
  if (resolved.error) return resolved.error;
  const runId = safeRunId(args.runId);
  const outDir = path.join(resolved.workspaceRoot, '.petri', 'video', runId);
  const composeFn = deps.composeFn || require('../helpers/video-compose').composeVideo;
  try {
    const result = await composeFn({
      spec,
      workspaceRoot: resolved.workspaceRoot,
      outDir,
      deps: deps.composeDeps,
    });
    if (!result.ok) return result;
    return {
      ok: true,
      runId,
      products: result.products,
      timeline: result.qa && result.qa.timeline ? { totalMs: result.qa.timeline.totalMs, sceneCount: result.qa.timeline.scenes.length } : undefined,
      qaStatus: result.qa && result.qa.status,
      bundleSha256: result.manifest && result.manifest.bundleSha256,
      _note: '成片产物落 .petri/video/<runId>/（MP4/旁白/字幕/讲稿/来源/spec/QA/manifest，全部 sha256+血缘）。成片观感与科学专业性属 pending_human_eye，终审由用户签字。',
    };
  } catch (error) {
    return { ok: false, code: 'compose_failed', message: String((error && error.message) || error).slice(0, 300) };
  }
}

module.exports = { tool_compose_video };

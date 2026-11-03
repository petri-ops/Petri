'use strict';

/**
 * agent-tools/godot-tools.js — BLOCK-341 P2/P3 受治理 Godot 桥工具。
 *
 * godot_run（P2）：headless=false 跑项目 ≤N 渲染帧，截图序列走 --write-movie PNG 输出；
 *   manifest（stdout 尾巴/退出码/截图 sha256 清单）落 .petri/godot-runs/<runId>/。
 *   截图序列可直接被 read_image 逐帧解读（BLOCK-340 帧→vision 管线）。
 * godot_scene_apply（P3）：propose/apply 两步——propose 校验白名单 + beforeSha256；
 *   apply 执行 + 语义 diff；白名单外一律 require-ack（拦截器坡道），绝不静默放行。
 * 不开放任意 shell 参数与路径逃逸；引擎缺席诚实 unavailable。
 */

const path = require('path');
const { probeGodot } = require('../helpers/godot-provider');
const { godotRun, validateSceneApply, applySceneEdit } = require('../helpers/godot-tools');

/**
 * tool_godot_run — 运行 Godot 项目 ≤N 渲染帧并采集截图序列。
 * @param {object} args - { projectPath?, frames?, captureFrames?, scene? }
 * @param {object} ctx - { projectId, ... }
 */
async function tool_godot_run(args, ctx) {
  const projectId = ctx && ctx.projectId;
  if (!projectId) return { error: 'project_required', message: 'godot_run 需要有效项目工作区' };
  const dbMod = require('../db');
  const project = dbMod.getProject(String(projectId));
  if (!project || !project.workspace_path) {
    return { error: 'workspace_required', message: 'godot_run 需要本地工作区项目' };
  }
  const probe = probeGodot();
  if (!probe.ok) {
    return { error: probe.code || 'capability_unavailable', message: probe.message };
  }
  const result = await godotRun({
    workspaceRoot: project.workspace_path,
    projectPath: args ? args.projectPath : undefined,
    frames: args ? args.frames : undefined,
    captureFrames: args ? args.captureFrames !== false : true,
    scene: args ? args.scene : undefined,
  });
  if (!result.ok && result.code) {
    return { error: result.code, message: result.message || 'godot_run 失败' };
  }
  const frameLines = (result.screenshots || []).slice(0, 8).map((f, i) => `  帧 ${i + 1}: ${f.file}（${Math.round(f.sizeBytes / 1024)}KB）`);
  const description = [
    `Godot 运行${result.timedOut ? '（超时中止）' : ''}：exit=${result.exitCode}，${result.durationMs}ms，${result.frames} 渲染帧`,
    result.captureFrames ? `截图序列 ${result.screenshotCount} 帧落 ${result.screenshotsDir}/` : '未采集截图',
    ...frameLines,
    `日志=${result.logFile}`,
    '',
    result.screenshotCount > 0
      ? '可用 read_image 逐帧解读截图（filePath 传上方帧路径）判断画面是否符合预期。'
      : '无截图产出——检查项目主场景是否定义（project.godot run/main_scene 或 --scene 参数）。',
  ].join('\n');
  return {
    ok: true,
    runId: result.runId,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
    screenshotCount: result.screenshotCount,
    screenshots: result.screenshots,
    manifestPath: path.join(result.screenshotsDir, 'manifest.json'),
    description,
  };
}

/**
 * tool_godot_scene_apply — P3 propose/apply：白名单场景/脚本编辑（before/after sha + 语义 diff）。
 * @param {object} args - { filePath, op, payload, apply?: boolean }
 *   apply 缺省=false（propose：只校验 + 返回 beforeSha256）；apply=true 执行写盘。
 */
function tool_godot_scene_apply(args, ctx) {
  const projectId = ctx && ctx.projectId;
  if (!projectId) return { error: 'project_required', message: 'godot_scene_apply 需要有效项目工作区' };
  const dbMod = require('../db');
  const project = dbMod.getProject(String(projectId));
  if (!project || !project.workspace_path) {
    return { error: 'workspace_required', message: 'godot_scene_apply 需要本地工作区项目' };
  }
  const proposal = validateSceneApply({
    workspaceRoot: project.workspace_path,
    filePath: args ? args.filePath : undefined,
    op: args ? args.op : undefined,
    payload: args ? args.payload : undefined,
  });
  if (!proposal.ok) {
    // 白名单外 = require-ack 语义（拦截器/模型据 require-ack code 走审批）
    return { error: proposal.code, message: proposal.message, requireAck: proposal.code === 'op_not_whitelisted' };
  }
  if (!args || args.apply !== true) {
    return {
      ok: true,
      propose: true,
      filePath: proposal.filePath,
      op: proposal.op,
      beforeSha256: proposal.beforeSha256,
      next: '确认无误后再次调用并携带 apply:true 与相同 beforeSha256 执行写盘。',
    };
  }
  const applied = applySceneEdit({
    workspaceRoot: project.workspace_path,
    filePath: proposal.filePath,
    op: proposal.op,
    payload: proposal.payload,
    beforeSha256: proposal.beforeSha256,
  });
  if (!applied.ok) {
    return { error: applied.code, message: applied.message || 'apply 失败' };
  }
  return {
    ok: true,
    apply: true,
    filePath: applied.filePath,
    op: applied.op,
    beforeSha256: applied.beforeSha256,
    afterSha256: applied.afterSha256,
    changed: applied.changed,
    semanticDiff: applied.semanticDiffHead,
    description: applied.changed
      ? `已应用 ${applied.op} 到 ${applied.filePath}。语义 diff：${applied.semanticDiffHead}`
      : `${applied.op} 未产生变化（内容与修改后一致）`,
  };
}

module.exports = { tool_godot_run, tool_godot_scene_apply };

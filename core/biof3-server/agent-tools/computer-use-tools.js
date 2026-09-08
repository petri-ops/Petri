'use strict';

// ============================================================
// BLOCK-48/BLOCK-63 P3 — computer_* agent 工具面（8 工具，macOS + Windows）。
// 协议参数平台无关：app → target{frontmost|pid|bundleId}（Windows sidecar
// 把 bundleId 语义映射为进程名）；其余 ref/text/key+modifiers/direction+amount/
// out/role+textContains+timeoutMs 双平台同形。不支持的平台由 host
// unsupported_platform 诚实报错。
//
// 授权门三件（plan §3，与既有安全体系同构，不新建第二套权限）：
//   1. policy 契约：控制类（click/type/press/scroll）= action/execution/R2
//      → 只读模式、计划模式、项目写模式由 agent-tool-policy 自动拒绝，
//      仅完全访问档可用；snapshot/authorize/wait 为只读零副作用；
//      screenshot = vision/workspace-write（产物落项目内，项目写档即可用）。
//   2. 独立确认授权步骤：控制类两段式 ackToken 协议（对标 run_tool 重操作）——
//      首调建可审计 pending tool_job + ackToken 返回 needApproval；用户在前端
//      确认卡批准后模型携 ackToken+confirm 重调，核验通过才执行。
//   3. 路径白名单：screenshot 产物仅允许写入当前项目工作区的
//      computer-use/ 目录（文件名 basename 化，拒绝任意路径写）。
// ============================================================

const crypto = require('crypto');
const path = require('path');
const dbMod = require('../db');
const { getComputerUseHost } = require('../helpers/computer-use-host');

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;
const CONTROL_TOOLS = new Set([
  'computer_click',
  'computer_type',
  'computer_press',
  'computer_scroll',
]);

function hostErrorToResult(e) {
  return { ok: false, error: e.code || 'computer_use_error', message: e.message };
}

/** sidecar 成功载荷无 ok 字段，统一包一层（工具结果契约要求 ok 布尔）。 */
function okWrap(result) {
  return { ok: true, ...(result || {}) };
}

/** args.app：'frontmost'（默认）| bundleId 字符串 | 数字 pid；args.hwnd（Windows 直投，
 * P4 实机教训：Win11 打包记事本一窗多顶层 hwnd，frontmost 不可靠）。 */
function buildTarget(args) {
  const app = args && args.app;
  const hwnd = args && args.hwnd;
  if (Number.isInteger(hwnd) && hwnd > 0) return { hwnd };
  if (!app || app === 'frontmost') return { frontmost: true };
  const asPid = Number(app);
  if (Number.isInteger(asPid) && asPid > 0 && String(asPid) === String(app).trim()) {
    return { pid: asPid };
  }
  return { bundleId: String(app) };
}

function trustedUserId(ctx) {
  return String((ctx && ctx.userId) || 'agent');
}

/**
 * 独立确认授权步骤（两段式）。返回：
 *   { needApproval } → 首调，需前端确认后重调
 *   { denial }       → 确认无效/被拒
 *   { jobId }        → 确认通过，放行执行
 */
function ensureControlConfirmation(args, ctx, { toolId, summary }) {
  const ackToken = args && args.ackToken;
  if (args && args.confirm === true && ackToken) {
    const job = dbMod.getToolJobByAckToken(ackToken, {
      userId: trustedUserId(ctx),
      projectId: (ctx && ctx.projectId) || null,
      conversationId: (ctx && ctx.conversationId) || null,
    });
    if (!job || job.tool_id !== toolId) {
      return { denial: { ok: false, error: 'approval_invalid', message: '确认 token 无效或不属于该工具。' } };
    }
    if (job.ack_status === 'rejected') {
      return { denial: { ok: false, error: 'user_rejected', message: '用户拒绝了该操作。' } };
    }
    if (job.ack_status !== 'approved') {
      return {
        denial: {
          ok: false,
          error: 'approval_pending',
          message: '确认尚未被用户批准：请在前端确认卡点「开始」后重调。',
        },
      };
    }
    return { jobId: job.id };
  }
  const job = dbMod.createToolJob({
    toolId,
    userId: trustedUserId(ctx),
    params: { summary },
    status: 'pending',
    name: `${toolId} 待确认`,
    projectId: (ctx && ctx.projectId) || null,
    conversationId: (ctx && ctx.conversationId) || null,
  });
  if (!job || !job.id) {
    return {
      denial: { ok: false, error: 'tool_job_create_failed', message: '无法建立可审计的确认任务。' },
    };
  }
  const token = `ack_${crypto.randomBytes(6).toString('hex')}`;
  dbMod.setToolJobApproval(job.id, token, Date.now() + APPROVAL_TIMEOUT_MS);
  return {
    needApproval: {
      ok: true,
      needApproval: true,
      ackToken: token,
      toolJobId: job.id,
      toolId,
      message:
        `${toolId}（${summary}）需要用户确认：前端确认卡点「开始」后，`
        + `携带 ackToken=${token} 与 confirm=true 重调。`
        + `${Math.round(APPROVAL_TIMEOUT_MS / 1000)} 秒未确认将自动取消。`,
    },
  };
}

/** 控制类工具统一入口：确认门 → sidecar。执行后回写审计 job 终态。 */
async function runControlTool(toolId, args, ctx, verb, extra = {}) {
  const summary = String(args && args.summary) || `${toolId}`;
  const gate = ensureControlConfirmation(args, ctx, { toolId, summary });
  if (gate.denial) return gate.denial;
  if (gate.needApproval) return gate.needApproval;

  let result;
  try {
    result = await getComputerUseHost().requestWithRecovery(verb, {
      target: buildTarget(args),
      ...extra,
    });
  } catch (e) {
    result = hostErrorToResult(e);
  }
  if (gate.jobId) {
    try {
      dbMod.updateToolJob(gate.jobId, {
        status: result.ok === false ? 'failed' : 'done',
        resultJson: result,
        completedAt: new Date().toISOString(),
        error: result.ok === false ? result.error || 'failed' : null,
      });
    } catch { /* 审计回写失败不影响结果返回 */ }
  }
  return result.ok === false ? result : okWrap(result);
}

/** screenshot 产物路径白名单：<workspace>/computer-use/<basename>。 */
function resolveScreenshotOutPath(args, ctx) {
  const projectId = String((ctx && ctx.projectId) || '').trim();
  if (!projectId) {
    return { denial: { ok: false, error: 'project_required', message: 'screenshot 需要在有效项目中使用（产物落项目工作区）。' } };
  }
  const project = dbMod.getProject(projectId);
  if (!project || !project.workspace_path) {
    return { denial: { ok: false, error: 'project_not_found', message: '项目不存在或缺少工作区路径。' } };
  }
  const rawName = String((args && args.filename) || 'screenshot.png');
  const base = path.basename(rawName).replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_');
  const name = /\.png$/i.test(base) ? base : `${base}.png`;
  return { out: path.join(project.workspace_path, 'computer-use', name) };
}

// ── 工具处理器 ─────────────────────────────────────────────────

async function tool_computer_snapshot(args = {}, ctx = {}) {
  const extra = {};
  if (Number.isFinite(args.maxElements)) extra.maxElements = args.maxElements;
  if (args.axManual === true) extra.axManual = true;
  try {
    return okWrap(
      await getComputerUseHost().requestWithRecovery('snapshot', {
        target: buildTarget(args),
        ...extra,
      }),
    );
  } catch (e) {
    return hostErrorToResult(e);
  }
}

async function tool_computer_click(args = {}, ctx = {}) {
  return runControlTool('computer_click', args, ctx, 'click', { ref: args.ref });
}

async function tool_computer_type(args = {}, ctx = {}) {
  const extra = { text: String(args.text ?? '') };
  if (args.ref) extra.ref = args.ref;
  if (args.activate === true) extra.activate = true;
  return runControlTool('computer_type', args, ctx, 'type', extra);
}

async function tool_computer_press(args = {}, ctx = {}) {
  const extra = { key: String(args.key ?? '') };
  if (args.ref) extra.ref = args.ref;
  if (Array.isArray(args.modifiers)) extra.modifiers = args.modifiers;
  if (args.activate === true) extra.activate = true;
  return runControlTool('computer_press', args, ctx, 'press', extra);
}

async function tool_computer_scroll(args = {}, ctx = {}) {
  const extra = { direction: String(args.direction ?? '') };
  if (Number.isFinite(args.amount)) extra.amount = args.amount;
  if (args.ref) extra.ref = args.ref;
  return runControlTool('computer_scroll', args, ctx, 'scroll', extra);
}

async function tool_computer_screenshot(args = {}, ctx = {}) {
  const resolved = resolveScreenshotOutPath(args, ctx);
  if (resolved.denial) return resolved.denial;
  try {
    return okWrap(
      await getComputerUseHost().requestWithRecovery('screenshot', {
        target: buildTarget(args),
        out: resolved.out,
      }),
    );
  } catch (e) {
    return hostErrorToResult(e);
  }
}

async function tool_computer_wait(args = {}, ctx = {}) {
  const extra = {};
  if (args.role) extra.role = String(args.role);
  if (args.textContains) extra.textContains = String(args.textContains);
  if (args.ref) extra.ref = String(args.ref);
  if (Number.isFinite(args.timeoutMs)) extra.timeoutMs = args.timeoutMs;
  try {
    return okWrap(
      await getComputerUseHost().requestWithRecovery('wait', {
        target: buildTarget(args),
        ...extra,
      }, 40000),
    );
  } catch (e) {
    return hostErrorToResult(e);
  }
}

async function tool_computer_authorize(args = {}, ctx = {}) {
  try {
    return okWrap(await getComputerUseHost().requestWithRecovery('probe', {}));
  } catch (e) {
    return hostErrorToResult(e);
  }
}

module.exports = {
  tool_computer_snapshot,
  tool_computer_click,
  tool_computer_type,
  tool_computer_press,
  tool_computer_scroll,
  tool_computer_screenshot,
  tool_computer_wait,
  tool_computer_authorize,
  CONTROL_TOOLS,
};

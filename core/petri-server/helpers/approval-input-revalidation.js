'use strict';

/**
 * helpers/approval-input-revalidation.js — 审批编辑参数的重校验（BLOCK-243 Q1 A4）。
 *
 * 用户在审批卡编辑参数后，决策路由必须先重新走完整执行门，再登记批准：
 * schema → workspace preflight → policy（只把**本次审批的 guardKey** 放进 ack 集，
 * 编辑引入的新风险维度一律拒绝）→ 返回生效参数。缺执行上下文快照、工具已断开
 * 等情形 fail-closed（用户可放弃编辑后按原参数批准）。
 *
 * 依赖注入与 agent-tool-interceptor 同款，便于测试钉住接线而不拉真实项目上下文。
 */

const { getToolEntry: defaultGetToolEntry } = require('../agent-tools/registry');
const {
  validateToolArguments: defaultValidate,
  resolveMcpApprovalContext: defaultResolveMcp,
} = require('../agent-tools/agent-tool-interceptor');
const { preflightWorkspaceTool: defaultPreflight } = require('../agent-tools/workspace-tools');
const { decideAgentToolCall: defaultDecide } = require('../agent-tools/agent-tool-policy');
const { loadUserRules: defaultLoadUserRules } = require('./agent-user-rules');

function createApprovalInputRevalidator(options = {}) {
  const getToolEntry = options.getToolEntry || defaultGetToolEntry;
  const validateToolArguments = options.validateToolArguments || defaultValidate;
  const preflightWorkspaceTool = options.preflightWorkspaceTool || defaultPreflight;
  const decideAgentToolCall = options.decideAgentToolCall || defaultDecide;
  const loadUserRules = options.loadUserRules || defaultLoadUserRules;
  const resolveMcpApprovalContext = options.resolveMcpApprovalContext || defaultResolveMcp;

  return async function revalidateUpdatedInput({ request, updatedInput }) {
    if (!request || !request.toolName) {
      return { ok: false, error: 'request_required', message: '审批请求缺失。' };
    }
    const snapshot = request.ctxSnapshot;
    if (!snapshot || typeof snapshot !== 'object') {
      return {
        ok: false,
        error: 'updated_input_unavailable',
        message: '该审批请求缺少执行上下文快照，无法校验编辑后的参数；请重新触发该调用。',
      };
    }
    if (!updatedInput || typeof updatedInput !== 'object' || Array.isArray(updatedInput)) {
      return { ok: false, error: 'updated_input_invalid', message: 'updatedInput 必须是对象。' };
    }
    const entry = getToolEntry(request.toolName);
    if (!entry || !entry.definition || !entry.definition.function) {
      return {
        ok: false,
        error: 'tool_unavailable',
        message: '工具当前不可用（可能已断开或已卸载）；请放弃编辑后重试原调用。',
      };
    }
    const errors = validateToolArguments(updatedInput, entry.definition.function.parameters);
    if (errors.length > 0) {
      return {
        ok: false,
        error: 'updated_input_invalid',
        message: '编辑后的参数不符合工具 schema。',
        details: errors,
      };
    }

    const ctx = {
      accessMode: snapshot.accessMode,
      planMode: snapshot.planMode,
      allowExecution: snapshot.allowExecution,
      projectId: snapshot.projectId,
      userId: snapshot.userId,
      // 只放行本次审批的维度；编辑引入的新 guardKey 不在集合内 → policy deny。
      dynamicGuardAcks: new Set(request.guardKey ? [request.guardKey] : []),
      userRules: loadUserRules(),
      approvedFingerprints: new Set(),
    };
    const mcpApproval = resolveMcpApprovalContext(entry);
    if (mcpApproval) ctx.mcpApproval = mcpApproval;

    let preflight = null;
    if (entry.contract && entry.contract.category === 'workspace') {
      preflight = await preflightWorkspaceTool(request.toolName, updatedInput, ctx);
    }
    const decision = decideAgentToolCall({
      name: request.toolName,
      args: updatedInput,
      ctx,
      contract: entry.contract,
      preflight,
    });
    if (decision.decision === 'deny') {
      return {
        ok: false,
        error: 'updated_input_denied',
        message: decision.message || '编辑后的参数未通过安全策略。',
        decision,
      };
    }
    return { ok: true, args: updatedInput };
  };
}

const revalidateUpdatedInput = createApprovalInputRevalidator();

module.exports = {
  createApprovalInputRevalidator,
  revalidateUpdatedInput,
};

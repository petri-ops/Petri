'use strict';

/**
 * item88 第二波：工作台三档交互路由（设计稿 §4.3）。
 * 纯函数决定档位；实际审批/咨询仍走既有 approval-request-store / user-question-store，
 * 本模块不新建 IPC、不绕开 loop-orchestrator 的 promise 等待。
 */

function resolveInteractionMode({ flagEnabled = false, automationMode = 'automatic', source = 'main' } = {}) {
  // flag 关 = 完全回到 v1.0 行为：不新增任何交互面。
  if (!flagEnabled) return 'autonomous';
  if (automationMode === 'approval' || source === 'approval') return 'approval';
  if (automationMode === 'consult') return 'consult';
  if (automationMode === 'autonomous') return 'autonomous';
  return 'consult'; // 未知档位保守落咨询，不静默自批
}

function routeInteraction(mode) {
  if (mode === 'approval') return { store: 'approval', eventType: 'guard_ack' };
  if (mode === 'consult') return { store: 'question', eventType: 'workbench.consult' };
  return { store: 'none', eventType: null };
}

function isWorkbenchEnabled() {
  const { getPointRuntime } = require('./decision-config');
  return getPointRuntime('workbench').enabled === true;
}

module.exports = { resolveInteractionMode, routeInteraction, isWorkbenchEnabled };

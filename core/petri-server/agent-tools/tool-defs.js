'use strict';

/**
 * agent-tools/tool-defs.js — 工具 Schema facade（BLOCK-109-CORE-ARCH P2-1 按域拆分）
 *
 * 物理目录即域：tool-defs/<domain>.js（workspace/computer/knowledge/result-studio/
 * agent-orchestration/browser/resident/remote/session）。本文件只做汇编与导出，
 * Schema 内容与拆分前零变化（71 工具集合恒等，深度对账见 block109-p2 契约测试）；
 * TOOL_DEFS 顺序按域归并——与原交错序不同属清单顺序归一（plan §1 P2-1 登记）。
 * 消费方统一 require 本 facade，勿直接 require 域文件。
 */

const domainModules = {
  'agent-orchestration': require('./tool-defs/agent-orchestration'),
  'browser': require('./tool-defs/browser'),
  'computer': require('./tool-defs/computer'),
  'knowledge': require('./tool-defs/knowledge'),
  'remote': require('./tool-defs/remote'),
  'resident': require('./tool-defs/resident'),
  'result-studio': require('./tool-defs/result-studio'),
  'session': require('./tool-defs/session'),
  'skill': require('./tool-defs/skill'),
  'web': require('./tool-defs/web'),
  'workspace': require('./tool-defs/workspace'),
};

const TOOL_DEFS = [
  ...domainModules['agent-orchestration'],
  ...domainModules['browser'],
  ...domainModules['computer'],
  ...domainModules['knowledge'],
  ...domainModules['remote'],
  ...domainModules['resident'],
  ...domainModules['result-studio'],
  ...domainModules['session'],
  ...domainModules['skill'],
  ...domainModules['web'],
  ...domainModules['workspace'],
];

// WORKSPACE_TOOL_DEFS = workspace-provider 评估子集（26 工具，**原顺序**；BLOCK-109-CORE-ARCH
// P2-1 起由全集按有序名单派生——原独立数组与 TOOL_DEFS 成员深度重复，重复定义已收编）
const WORKSPACE_SUBSET_NAMES = ["workspace_list","workspace_find","workspace_search","workspace_read","workspace_write","workspace_replace","workspace_exec","workspace_exec_background","process_status","delegate_to_petri_node","resident_task_create","resident_task_list","resident_task_read","process_stop","system_info","computer_snapshot","computer_click","computer_type","computer_press","computer_scroll","computer_screenshot","computer_wait","computer_authorize","interrupt_agent","send_message","followup_task"];
// BLOCK-113 W1-3 — 域→工具 defs 映射（additive 导出；两跳预路由的收窄器数据源）。
// 深度恒等红线：⋃ DOMAIN_TOOL_DEFS 必须与 TOOL_DEFS 逐引用一致（契约测试钉住）。
const DOMAIN_TOOL_DEFS = Object.freeze({ ...domainModules });

const toolByName = new Map(TOOL_DEFS.map((t) => [t.function.name, t]));
const WORKSPACE_TOOL_DEFS = WORKSPACE_SUBSET_NAMES.map((n) => toolByName.get(n));

function getToolDefs() {
  // Lazy require avoids a module-initialization cycle: registry consumes these
  // schema constants, while callers receive only fresh Provider-safe projections.
  return require('./registry').getProviderToolDefs();
}

module.exports = { TOOL_DEFS, WORKSPACE_TOOL_DEFS, DOMAIN_TOOL_DEFS, getToolDefs };

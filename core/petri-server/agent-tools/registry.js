'use strict';

/**
 * Agent tool registry — the runtime source of truth for model-visible schemas,
 * handlers, and internal execution contracts.
 *
 * Provider adapters must consume getProviderToolDefs(), which deliberately
 * projects definitions without exposing internal contract metadata.
 */

const { TOOL_DEFS } = require('./tool-defs');
const { tool_query, tool_read_page, tool_search } = require('./query-tools');
const { tool_act } = require('./act-tools');
const { listPackUiActions } = require('../helpers/pack-contributions');
const { tool_plan } = require('./plan-ui-tools');
const { tool_todo_write } = require('./todo-tools');
const { tool_decision_summary, tool_decision_recent } = require('./decision-tools');
const { tool_result_summary } = require('./result-summary-tools');
// BLOCK-254 A-2（Q6-REM）— 批注旁路元数据只读读取（scope 定界 / 项目隔离 fail-closed）
const { tool_result_annotations_list } = require('./result-annotation-tools');
// BLOCK-264（C-40）— 浏览器连接器垂直切片（会话/白名单/审批门在 helpers/browser-connector）
const browserTools = require('./browser-tools');
// BLOCK-256 Q7 — 目标状态机三工具（create/get/update；用量来自 ai_usage 真账本）
const { tool_create_goal, tool_get_goal, tool_update_goal } = require('./goal-tools');
// NEXT-01 — 工作流唯一 Agent 编排入口（复用 workflow runner，不建第二执行器）
const { tool_run_workflow } = require('./workflow-tools');
// BLOCK-157 W1 P1（KNW-1）— 产品 Skills 会话台只读工具（渐进披露：discover 无正文 / get 有界手册）
const { tool_skill_discover, tool_skill_get, tool_skill_preflight } = require('./skill-tools');
// BLOCK-124（C-13）— 符号图只读查询（内核单源 helpers/code-graph）
const { tool_codegraph_who_imports, tool_codegraph_classify_edges } = require('./codegraph-tools');
const {
  tool_run_tool,
  tool_generate_methods,
} = require('./learning');
const { tool_verify_state } = require('./verify-dispatch');
const { tool_read_image } = require('./vision-tools');
const {
  tool_model3d_inspect,
  tool_model3d_validate,
  tool_model3d_propose,
  tool_model3d_apply,
  tool_model3d_render,
  tool_model3d_export,
  tool_model3d_visual_qa,
  tool_model3d_recipe,
  tool_model3d_bom,
  tool_model3d_asset,
  tool_model3d_share,
} = require('./model3d-tools');
const {
  tool_result_edit_plan,
  tool_result_changeset_create,
  tool_result_changeset_status,
  tool_result_changeset_compare,
  tool_result_changeset_adopt,
  tool_result_changeset_revert,
  tool_artifact_revision_list,
  tool_artifact_revision_restore,
} = require('./result-edit-tools');
const { tool_result_selection_run } = require('./result-selection-tools');
const { tool_result_studio_context } = require('./result-context-tools');
const { tool_delegate_to_petri_node, tool_federation_list_peers } = require('./federation-tools');
const {
  tool_result_edit_plan_in_context,
  tool_result_changeset_create_in_context,
  tool_result_changeset_status_in_context,
  tool_result_changeset_compare_in_context,
  tool_result_changeset_adopt_in_context,
  tool_result_changeset_revert_in_context,
  tool_result_enrichment_from_context,
} = require('./result-context-edit-tools');
const {
  tool_workspace_list,
  tool_workspace_find,
  tool_workspace_search,
  tool_workspace_read,
  tool_workspace_write,
  tool_workspace_replace,
  tool_workspace_exec,
  tool_workspace_exec_background,
  tool_process_status,
  tool_process_stop,
  tool_resident_task_create,
  tool_resident_task_list,
  tool_resident_task_read,
} = require('./workspace-tools');
const { tool_system_info } = require('./system-info-tools');
// BLOCK-247（Q2b）— 联网检索与抓取：唯一出网入口（策略层见 helpers/web-fetch-policy）
const { tool_web_search, tool_web_fetch } = require('./web-tools');
// BLOCK-244 Q1-REM — 结构化提问（C19）：暂停等用户回答，回答回传同一 tool 结果
const { tool_ask_user_question } = require('./ask-user-tools');
const { tool_knowledge_search, tool_knowledge_status, tool_knowledge_read } = require('./knowledge-tools');
const {
  tool_knowledge_space_list,
  tool_knowledge_space_impact,
  tool_knowledge_doc_list,
  tool_knowledge_space_create,
  tool_knowledge_space_rename,
  tool_knowledge_space_enable,
  tool_knowledge_space_bind,
  tool_knowledge_doc_move,
  tool_knowledge_doc_reindex,
  tool_knowledge_space_delete,
  tool_knowledge_space_clear,
  tool_knowledge_doc_delete,
} = require('./knowledge-console-tools');
const {
  tool_computer_snapshot,
  tool_computer_click,
  tool_computer_type,
  tool_computer_press,
  tool_computer_scroll,
  tool_computer_screenshot,
  tool_computer_wait,
  tool_computer_authorize,
} = require('./computer-use-tools');
const {
  interrupt_agent,
  send_message,
  followup_task,
} = require('./spawn-agent-tools');
const { spawn_agent, list_agents, wait_agent, read_agent_journal } = require('./spawn-agent-tools');

const CONTRACT_VERSION = '1.0.0';
const RISK_TIERS = Object.freeze(['R0', 'R1', 'R2', 'R3']);
const RISK_TIER_SET = new Set(RISK_TIERS);
const CATEGORIES = new Set([
  'workspace',
  'retrieval',
  'action',
  'planning',
  'analysis',
  'vision',
  'reporting',
  'verification',
  'result-studio',
  'agent-management',
]);
const SIDE_EFFECTS = new Set([
  'none',
  'state-write',
  'workspace-write',
  'execution',
  'external-request',
]);

const HANDLERS = {
  workspace_list: tool_workspace_list,
  workspace_find: tool_workspace_find,
  workspace_search: tool_workspace_search,
  workspace_read: tool_workspace_read,
  workspace_write: tool_workspace_write,
  workspace_replace: tool_workspace_replace,
  workspace_exec: tool_workspace_exec,
  workspace_exec_background: tool_workspace_exec_background,
  process_status: tool_process_status,
  process_stop: tool_process_stop,
  resident_task_create: tool_resident_task_create,
  resident_task_list: tool_resident_task_list,
  resident_task_read: tool_resident_task_read,
  system_info: tool_system_info,
  web_search: tool_web_search,
  web_fetch: tool_web_fetch,
  ask_user_question: tool_ask_user_question,
  computer_snapshot: tool_computer_snapshot,
  computer_click: tool_computer_click,
  computer_type: tool_computer_type,
  computer_press: tool_computer_press,
  computer_scroll: tool_computer_scroll,
  computer_screenshot: tool_computer_screenshot,
  computer_wait: tool_computer_wait,
  computer_authorize: tool_computer_authorize,
  interrupt_agent,
  send_message,
  followup_task,
  query: tool_query,
  // BLOCK-264（C-40）浏览器连接器垂直切片（会话/白名单/审批门在 helpers/browser-connector）
  browser_connect: browserTools.browser_connect,
  browser_act: browserTools.browser_act,
  browser_status: browserTools.browser_status,
  browser_disconnect: browserTools.browser_disconnect,
  read_page: tool_read_page,
  search: tool_search,
  act: tool_act,
  plan: tool_plan,
  // BLOCK-256 Q7 — 目标状态机（持久 goal；projectId 上下文注入/fail-closed）
  create_goal: tool_create_goal,
  get_goal: tool_get_goal,
  update_goal: tool_update_goal,
  run_workflow: tool_run_workflow,
  model3d_inspect: tool_model3d_inspect,
  model3d_validate: tool_model3d_validate,
  model3d_propose: tool_model3d_propose,
  model3d_apply: tool_model3d_apply,
  model3d_render: tool_model3d_render,
  model3d_export: tool_model3d_export,
  model3d_visual_qa: tool_model3d_visual_qa,
  model3d_recipe: tool_model3d_recipe,
  model3d_bom: tool_model3d_bom,
  model3d_asset: tool_model3d_asset,
  model3d_share: tool_model3d_share,
  // BLOCK-97 — 任务清单维护（整单幂等替换；快照经 task_todo 事件广播）
  todo_write: tool_todo_write,
  // BLOCK-116 W2（BK-04）— 决策台账只读观测面（数据源 helpers/decision-log 单源直调）
  decision_summary: tool_decision_summary,
  decision_recent: tool_decision_recent,
  run_tool: tool_run_tool,
  // BLOCK-121 P2（B1）— 结果内容只读读取（跨轮引用断点的修复面）
  result_summary: tool_result_summary,
  // BLOCK-254 A-2 — 批注只读读取（跨轮回读「我在图上标了什么」的唯一入口）
  result_annotations_list: tool_result_annotations_list,
  // BLOCK-124（C-13）— 符号图只读查询（根解析走 withWorkspace 双闸，同 workspace_* 家族）
  codegraph_who_imports: tool_codegraph_who_imports,
  codegraph_classify_edges: tool_codegraph_classify_edges,
  delegate_to_petri_node: tool_delegate_to_petri_node,
  federation_list_peers: tool_federation_list_peers,
  read_image: tool_read_image,
  generate_methods: tool_generate_methods,
  verify_state: tool_verify_state,
  result_edit_plan: tool_result_edit_plan,
  result_changeset_create: tool_result_changeset_create,
  result_changeset_status: tool_result_changeset_status,
  result_changeset_compare: tool_result_changeset_compare,
  result_changeset_adopt: tool_result_changeset_adopt,
  result_changeset_revert: tool_result_changeset_revert,
  artifact_revision_list: tool_artifact_revision_list,
  artifact_revision_restore: tool_artifact_revision_restore,
  result_selection_run: tool_result_selection_run,
  // G0-RS-P3: context-bound tools. The model never hand-writes internal ids;
  // every coordinate is re-projected from backend truth on each call.
  result_studio_context: tool_result_studio_context,
  result_edit_plan_in_context: tool_result_edit_plan_in_context,
  result_changeset_create_in_context: tool_result_changeset_create_in_context,
  result_changeset_status_in_context: tool_result_changeset_status_in_context,
  result_changeset_compare_in_context: tool_result_changeset_compare_in_context,
  result_changeset_adopt_in_context: tool_result_changeset_adopt_in_context,
  result_changeset_revert_in_context: tool_result_changeset_revert_in_context,
  result_enrichment_from_context: tool_result_enrichment_from_context,
  // BLOCK-49 — 多 Agent 派生（进程内复用 subagent 执行链；spawn fail-closed 于 policy 层）
  spawn_agent,
  list_agents,
  read_agent_journal,
  wait_agent,
  // BLOCK-69 — 知识空间（双通道混合检索；只读，所有访问档位可用）
  knowledge_search: tool_knowledge_search,
  knowledge_status: tool_knowledge_status,
  // BLOCK-94 F5 — 按文档深读（只读；配合 knowledge_search 命中结果溯源全文）
  knowledge_read: tool_knowledge_read,
  // BLOCK-99 G4 — 空间管理会话台工具族（只读+非破坏全开；破坏性三件走 D4 确认门）
  knowledge_space_list: tool_knowledge_space_list,
  knowledge_space_impact: tool_knowledge_space_impact,
  knowledge_doc_list: tool_knowledge_doc_list,
  knowledge_space_create: tool_knowledge_space_create,
  knowledge_space_rename: tool_knowledge_space_rename,
  knowledge_space_enable: tool_knowledge_space_enable,
  knowledge_space_bind: tool_knowledge_space_bind,
  knowledge_doc_move: tool_knowledge_doc_move,
  knowledge_doc_reindex: tool_knowledge_doc_reindex,
  knowledge_space_delete: tool_knowledge_space_delete,
  knowledge_space_clear: tool_knowledge_space_clear,
  knowledge_doc_delete: tool_knowledge_doc_delete,
  // BLOCK-157 W1 P1（KNW-1）— 产品 Skills 会话台（只读；执行面不投影，plan §2 裁决）
  skill_discover: tool_skill_discover,
  skill_get: tool_skill_get,
  // BLOCK-176 W7 CP-21 — 依赖自检（which/where 只读探测；安装指引走既有 cmd 审批链）
  skill_preflight: tool_skill_preflight,
};

function contract(category, sideEffect, riskTier, resources, estimatedDurationMs, cancellable = false) {
  return {
    contractVersion: CONTRACT_VERSION,
    category,
    sideEffect,
    riskTier,
    resources,
    estimatedDurationMs,
    // BLOCK-171 CP-1 — cancellable 语义收敛为「协作取消已贯通」：true = handler
    // 检查 toolCtx.toolCancelSignal 且 loop 侧注册表可精确取消该 callId。
    // P7-B 的全量 false 形态由显式声明位取代（未声明仍为 false，零行为变化）。
    cancellable: cancellable === true,
  };
}

const CONTRACTS = {
  workspace_list: contract('workspace', 'none', 'R0', ['project.files'], 100),
  workspace_find: contract('workspace', 'none', 'R0', ['project.files'], 500),
  workspace_search: contract('workspace', 'none', 'R0', ['project.files'], 1000, true),
  workspace_read: contract('workspace', 'none', 'R0', ['project.files'], 100),
  workspace_write: contract('workspace', 'workspace-write', 'R2', ['project.files'], 200),
  workspace_replace: contract('workspace', 'workspace-write', 'R2', ['project.files'], 200),
  workspace_exec: contract('workspace', 'execution', 'R2', ['project.files', 'local.process'], 30000),
  // BLOCK-33 P4 — 后台进程：启动即返回（估时短），实际进程时长不占用工具执行预算
  workspace_exec_background: contract('workspace', 'execution', 'R2', ['project.files', 'local.process'], 5000),
  process_status: contract('workspace', 'none', 'R0', ['local.process'], 500),
  process_stop: contract('workspace', 'execution', 'R2', ['local.process'], 5000),
  // BLOCK-77 P1 — 驻留任务：create 为执行类（R2，启动即返回）；list/read 只读
  resident_task_create: contract('workspace', 'execution', 'R2', ['project.files', 'local.process'], 5000),
  resident_task_list: contract('workspace', 'none', 'R0', ['project.files'], 1000),
  resident_task_read: contract('workspace', 'none', 'R0', ['project.files'], 1000),
  // BLOCK-33 P1 — 环境自省：只读零副作用，不依赖项目工作区（category 非 workspace → 不走 preflight）
  system_info: contract('verification', 'none', 'R0', ['local.process'], 1000),
  // BLOCK-247（Q2b）— 联网只读：external-request/R1，资源面 `network.egress`（新词，
  // 用于审计与后续出网预算挂钩）；估时按搜索 8s / 抓取 12s（含一次重定向）。
  web_search: contract('retrieval', 'external-request', 'R1', ['network.egress'], 8000),
  web_fetch: contract('retrieval', 'external-request', 'R1', ['network.egress'], 12000),
  // BLOCK-264（C-40）浏览器连接器：会话面 R0；act=external-request R2（mutating 无 ackToken 在 connector 层硬拒）
  browser_connect: contract('action', 'none', 'R0', ['ui.session'], 3000),
  browser_status: contract('retrieval', 'none', 'R0', [], 1000),
  browser_disconnect: contract('action', 'none', 'R0', [], 1000),
  browser_act: contract('action', 'external-request', 'R2', ['network.egress'], 15000),
  // BLOCK-244 Q1-REM — 结构化提问：无副作用但会暂停等待用户（UI 会话资源）
  ask_user_question: contract('action', 'none', 'R0', ['ui.session'], 300000),
  // BLOCK-48 P3 — Computer Use（macOS）：快照/授权/等待为只读面；控制类
  // action/execution/R2（仅完全访问档，read/planMode/ws-write 由 policy 自动拒）；
  // screenshot 产物落项目工作区（vision/workspace-write，项目写档即可用）。
  computer_snapshot: contract('verification', 'none', 'R0', ['ui.session', 'local.process'], 1000),
  computer_authorize: contract('verification', 'none', 'R0', [], 500),
  computer_wait: contract('verification', 'none', 'R1', ['ui.session'], 35000),
  computer_click: contract('action', 'execution', 'R2', ['ui.session'], 8000),
  computer_type: contract('action', 'execution', 'R2', ['ui.session'], 8000),
  computer_press: contract('action', 'execution', 'R2', ['ui.session'], 4000),
  computer_scroll: contract('action', 'execution', 'R2', ['ui.session'], 4000),
  computer_screenshot: contract('vision', 'workspace-write', 'R1', ['ui.session', 'local.process'], 8000),
  // BLOCK-49 二期 —— 多智能体协作三件套
  interrupt_agent: contract('agent-management', 'state-write', 'R2', ['ui.session'], 2000),
  send_message: contract('agent-management', 'state-write', 'R1', ['ui.session'], 1000),
  followup_task: contract('agent-management', 'state-write', 'R2', ['ui.session', 'local.process'], 5000),
  query: contract('retrieval', 'none', 'R0', ['project.database'], 250),
  read_page: contract('retrieval', 'external-request', 'R1', ['plugin.content', 'network.remote'], 15000),
  search: contract('retrieval', 'external-request', 'R1', ['project.database', 'plugin.content', 'llm.provider'], 30000),
  act: contract('action', 'execution', 'R2', ['user.account', 'project.database', 'ui.session', 'local.process'], 30000),
  plan: contract('planning', 'state-write', 'R1', ['project.database'], 500),
  // BLOCK-256 Q7 — 目标：查询只读 R0；创建/更新写 project.database（R1）
  create_goal: contract('planning', 'state-write', 'R1', ['project.database'], 300),
  get_goal: contract('planning', 'none', 'R0', ['project.database'], 200),
  update_goal: contract('planning', 'state-write', 'R1', ['project.database'], 300),
  // NEXT-01 — dryRun 只校验；真跑经 runner 启动子代理/写 journal，属执行类 R2
  run_workflow: contract('agent-management', 'execution', 'R2', ['agent_tasks', 'local.process'], 60000),
  model3d_inspect: contract('analysis', 'none', 'R1', ['project.files'], 500),
  model3d_validate: contract('analysis', 'none', 'R1', ['project.files', 'local.process'], 3000),
  model3d_propose: contract('analysis', 'none', 'R1', ['project.files'], 1000),
  model3d_apply: contract('result-studio', 'workspace-write', 'R2', ['project.files', 'artifacts'], 2000),
  model3d_render: contract('result-studio', 'execution', 'R2', ['project.files', 'local.process'], 180000),
  model3d_export: contract('result-studio', 'execution', 'R2', ['project.files', 'local.process', 'artifacts'], 180000),
  model3d_visual_qa: contract('vision', 'execution', 'R2', ['project.files', 'local.process', 'llm.provider'], 180000),
  model3d_recipe: contract('result-studio', 'execution', 'R2', ['project.files', 'local.process', 'artifacts'], 180000),
  model3d_bom: contract('result-studio', 'execution', 'R2', ['project.files', 'local.process', 'artifacts'], 180000),
  model3d_asset: contract('result-studio', 'workspace-write', 'R2', ['project.files', 'artifacts'], 20000),
  model3d_share: contract('result-studio', 'workspace-write', 'R2', ['project.files', 'artifacts'], 30000),
  // BLOCK-97 — 任务清单：任务运行内的临时 UI 态（事件流承载，非用户数据表），
  // 与 plan 同族 state-write/R1；不设 userId 门（访客会话可用，见 todo-tools.js 头注）
  todo_write: contract('planning', 'state-write', 'R1', ['ui.session'], 200),
  // BLOCK-116 W2（BK-04）— 决策台账只读观测：只读查询/R1/无外部资源写
  decision_summary: contract('analysis', 'none', 'R1', ['project.database'], 500),
  decision_recent: contract('analysis', 'none', 'R1', ['project.database'], 500),
  run_tool: contract('analysis', 'execution', 'R2', ['tool_jobs', 'artifacts', 'local.process'], 300000),
  // BLOCK-121 P2（B1）— 结果内容只读读取：tool_jobs/产物文件，无写面
  result_summary: contract('analysis', 'none', 'R1', ['tool_jobs', 'artifacts', 'project.files'], 500),
  // BLOCK-254 A-2 — 批注只读：只查旁路表，无写面、无文件读取
  result_annotations_list: contract('analysis', 'none', 'R1', ['project.database'], 500),
  // BLOCK-124（C-13）— 符号图只读查询：读项目源文件建 AST 图（estMs 按 1604 文件≈1.8s 实测 + 上限 5000 定界）
  codegraph_who_imports: contract('workspace', 'none', 'R0', ['project.files'], 5000),
  codegraph_classify_edges: contract('workspace', 'none', 'R0', ['project.files'], 5000),
  // BLOCK-85 P3 — 联邦委托：外部请求（对端格物执行），预算 15 分钟（轮询等待）
  delegate_to_petri_node: contract('agent-management', 'external-request', 'R2', ['project.files'], 900000),
  // BLOCK-164 W1 — 节点清单：只读聚合（本地真值 + 对端 granted-projects 尽力探测），无写面
  federation_list_peers: contract('agent-management', 'external-request', 'R1', [], 8000),
  read_image: contract('vision', 'external-request', 'R1', ['artifacts', 'llm.provider'], 30000),
  generate_methods: contract('reporting', 'external-request', 'R1', ['project.database', 'llm.provider'], 30000),
  verify_state: contract('verification', 'none', 'R0', ['project.database', 'ui.session'], 500),
  result_edit_plan: contract('result-studio', 'none', 'R0', ['tool_jobs', 'artifacts', 'project.database'], 500),
  result_changeset_create: contract('result-studio', 'execution', 'R2', ['tool_jobs', 'artifacts', 'project.database', 'project.files', 'local.process'], 300000),
  result_changeset_status: contract('result-studio', 'none', 'R0', ['tool_jobs', 'artifacts', 'project.database'], 500),
  result_changeset_compare: contract('result-studio', 'none', 'R0', ['artifacts', 'project.database', 'project.files'], 1500),
  result_changeset_adopt: contract('result-studio', 'state-write', 'R2', ['artifacts', 'project.database', 'project.files'], 1000),
  result_changeset_revert: contract('result-studio', 'state-write', 'R2', ['artifacts', 'project.database', 'project.files'], 1000),
  artifact_revision_list: contract('result-studio', 'none', 'R0', ['artifacts', 'project.database'], 500),
  artifact_revision_restore: contract('result-studio', 'state-write', 'R2', ['artifacts', 'project.database', 'project.files'], 1500),
  result_selection_run: contract('result-studio', 'execution', 'R2', ['tool_jobs', 'artifacts', 'project.database', 'project.files', 'local.process'], 300000),
  result_studio_context: contract('result-studio', 'none', 'R0', ['tool_jobs', 'artifacts', 'project.database'], 500),
  result_edit_plan_in_context: contract('result-studio', 'none', 'R0', ['tool_jobs', 'artifacts', 'project.database'], 700),
  result_changeset_create_in_context: contract('result-studio', 'execution', 'R2', ['tool_jobs', 'artifacts', 'project.database', 'project.files', 'local.process'], 300000),
  result_enrichment_from_context: contract('result-studio', 'execution', 'R2', ['tool_jobs', 'artifacts', 'project.database', 'project.files', 'local.process'], 300000),
  result_changeset_status_in_context: contract('result-studio', 'none', 'R0', ['tool_jobs', 'artifacts', 'project.database'], 700),
  result_changeset_compare_in_context: contract('result-studio', 'none', 'R0', ['artifacts', 'project.database', 'project.files'], 1700),
  result_changeset_adopt_in_context: contract('result-studio', 'state-write', 'R2', ['artifacts', 'project.database', 'project.files'], 1200),
  result_changeset_revert_in_context: contract('result-studio', 'state-write', 'R2', ['artifacts', 'project.database', 'project.files'], 1200),
  // BLOCK-49 — spawn 立即返回（子 agent 时长不占工具执行预算）；wait 阻塞等待终态
  spawn_agent: contract('agent-management', 'state-write', 'R2', ['agent_tasks', 'loop_runs'], 2000),
  list_agents: contract('agent-management', 'none', 'R0', ['agent_tasks'], 500),
  // BLOCK-249（Q4a）— 运行级 journal 只读（本地文件，无写面）
  read_agent_journal: contract('agent-management', 'none', 'R0', ['agent_journal'], 500),
  wait_agent: contract('agent-management', 'none', 'R1', ['agent_tasks', 'loop_runs'], 300000, true),
  // BLOCK-69 — 知识空间：只读检索（搜索走 embedding 供应商；status 零外部依赖）
  knowledge_search: contract('retrieval', 'none', 'R0', ['knowledge.index', 'llm.provider'], 2500),
  knowledge_status: contract('retrieval', 'none', 'R0', ['knowledge.index'], 100),
  knowledge_read: contract('retrieval', 'none', 'R0', ['knowledge.index'], 800),
  // BLOCK-99 G4 — 空间管理会话台：只读 R0；非破坏写 state-write/R1；
  // 破坏性三件 state-write/R2（D4 确认门在工具层服务端硬闸，policy 层照常拦执行档）
  knowledge_space_list: contract('retrieval', 'none', 'R0', ['knowledge.index'], 100),
  knowledge_space_impact: contract('retrieval', 'none', 'R0', ['knowledge.index'], 100),
  knowledge_doc_list: contract('retrieval', 'none', 'R0', ['knowledge.index'], 100),
  knowledge_space_create: contract('action', 'state-write', 'R1', ['knowledge.index'], 200),
  knowledge_space_rename: contract('action', 'state-write', 'R1', ['knowledge.index'], 200),
  knowledge_space_enable: contract('action', 'state-write', 'R1', ['knowledge.index'], 200),
  knowledge_space_bind: contract('action', 'state-write', 'R1', ['knowledge.index'], 200),
  knowledge_doc_move: contract('action', 'state-write', 'R1', ['knowledge.index'], 500),
  knowledge_doc_reindex: contract('action', 'state-write', 'R1', ['knowledge.index', 'local.process'], 5000),
  knowledge_space_delete: contract('action', 'state-write', 'R2', ['knowledge.index'], 2000),
  knowledge_space_clear: contract('action', 'state-write', 'R2', ['knowledge.index'], 2000),
  knowledge_doc_delete: contract('action', 'state-write', 'R2', ['knowledge.index'], 2000),
  // BLOCK-157 W1 P1（KNW-1）— 技能台只读两件：注册表在应用级目录（非项目资源，resources 留空），
  // retrieval/none/R0 → 全档可用（read/plan 亦可，与知识检索同族）
  skill_discover: contract('retrieval', 'none', 'R0', [], 500),
  skill_get: contract('retrieval', 'none', 'R0', [], 500),
  skill_preflight: contract('retrieval', 'none', 'R0', [], 2000),
};

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function getDefinitionName(definition) {
  return definition && definition.function && definition.function.name;
}

function projectProviderDefinition(definition) {
  return {
    type: 'function',
    function: {
      name: definition.function.name,
      description: definition.function.description || '',
      parameters: cloneJson(definition.function.parameters),
    },
  };
}

function validateContract(name, metadata, errors) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    errors.push(`${name}: missing contract metadata`);
    return;
  }
  if (typeof metadata.contractVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(metadata.contractVersion)) {
    errors.push(`${name}: invalid contractVersion`);
  }
  if (!CATEGORIES.has(metadata.category)) errors.push(`${name}: invalid category`);
  if (!SIDE_EFFECTS.has(metadata.sideEffect)) errors.push(`${name}: invalid sideEffect`);
  if (!RISK_TIER_SET.has(metadata.riskTier)) errors.push(`${name}: invalid riskTier`);
  if (
    !Array.isArray(metadata.resources) ||
    metadata.resources.some((resource) => typeof resource !== 'string' || resource.length === 0)
  ) {
    errors.push(`${name}: invalid resources`);
  }
  if (!Number.isInteger(metadata.estimatedDurationMs) || metadata.estimatedDurationMs < 0) {
    errors.push(`${name}: invalid estimatedDurationMs`);
  }
  if (typeof metadata.cancellable !== 'boolean') errors.push(`${name}: invalid cancellable`);
}

function buildToolRegistry(definitions, handlers = {}, contracts = {}) {
  const errors = [];
  const seen = new Set();
  const definitionNames = new Set();

  if (!Array.isArray(definitions)) {
    throw new Error('Invalid agent tool registry:\n- definitions must be an array');
  }
  if (!handlers || typeof handlers !== 'object' || Array.isArray(handlers)) {
    throw new Error('Invalid agent tool registry:\n- handlers must be an object');
  }
  if (!contracts || typeof contracts !== 'object' || Array.isArray(contracts)) {
    throw new Error('Invalid agent tool registry:\n- contracts must be an object');
  }

  for (const definition of definitions) {
    const name = getDefinitionName(definition);
    if (
      !definition ||
      definition.type !== 'function' ||
      !definition.function ||
      typeof name !== 'string' ||
      name.length === 0 ||
      !definition.function.parameters ||
      typeof definition.function.parameters !== 'object'
    ) {
      errors.push('definition: invalid OpenAI-compatible function schema');
      continue;
    }
    if (seen.has(name)) errors.push(`${name}: duplicate definition`);
    seen.add(name);
    definitionNames.add(name);
    if (typeof handlers[name] !== 'function') errors.push(`${name}: definition has no handler`);
    validateContract(name, contracts[name], errors);
  }

  for (const name of Object.keys(handlers || {})) {
    if (!definitionNames.has(name)) errors.push(`${name}: handler has no definition`);
  }
  for (const name of Object.keys(contracts || {})) {
    if (!definitionNames.has(name)) errors.push(`${name}: contract has no definition`);
  }

  if (errors.length) {
    throw new Error(`Invalid agent tool registry:\n- ${errors.join('\n- ')}`);
  }

  return Object.freeze(
    definitions.map((definition) => {
      const name = getDefinitionName(definition);
      const metadata = Object.freeze({
        ...contracts[name],
        resources: Object.freeze([...contracts[name].resources]),
      });
      return Object.freeze({
        definition: deepFreeze(cloneJson(definition)),
        handler: handlers[name],
        contract: metadata,
      });
    })
  );
}

// Module-load construction is the startup consistency check. A mismatch in a
// model definition, handler, or contract fails before an agent request starts.
const TOOL_REGISTRY = buildToolRegistry(TOOL_DEFS, HANDLERS, CONTRACTS);
const TOOL_BY_NAME = new Map(
  TOOL_REGISTRY.map((entry) => [entry.definition.function.name, entry])
);

// BLOCK-156 P3 — MCP 工具动态投影层（require 置后避免装载序耦合；投影自身零连接=零追加）
const mcpProjection = require('./mcp-projection');

function getProviderToolDefs() {
  // 静态注册表 + 已连接 MCP server 工具投影（R1：投影失败不影响静态面）
  let projected = [];
  try {
    projected = mcpProjection.projectMcpToolDefs();
  } catch {
    projected = [];
  }
  const defs = TOOL_REGISTRY.map((entry) => projectProviderDefinition(entry.definition)).concat(projected);
  // BLOCK-217 — 领域包 UI actions 动态追加到 act 描述：不新增工具、不改 enum；
  // pack 缺失/停用 → 清单为空，模型看不到动作。执行侧仍会再次校验（fail-closed）。
  try {
    const { actions, viewIds } = listPackUiActions();
    const usable = actions
      .filter((action) => action.surfaceId && viewIds.has(action.surfaceId))
      .slice(0, 40);
    if (usable.length > 0) {
      const actDef = defs.find((def) => def && def.function && def.function.name === 'act');
      if (actDef) {
        const list = usable.map((action) => `${action.id}（${action.label}）`).join('；');
        actDef.function.description = `${actDef.function.description}\n已安装领域包 UI actions（用 type="ui_action", actionId 调用）：${list}`;
      }
    }
  } catch { /* 贡献投影失败不阻断工具面 */ }
  return defs;
}

function getToolEntry(name) {
  // 静态优先（内建永不被 MCP 投影遮蔽）；mcp_* 前缀走投影兜底
  const entry = TOOL_BY_NAME.get(name);
  if (entry) return entry;
  if (typeof name === 'string' && name.startsWith('mcp_')) {
    try {
      return mcpProjection.getMcpToolEntry(name);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function getToolHandler(name) {
  const entry = getToolEntry(name);
  return entry && entry.handler;
}

function getToolContract(name) {
  const entry = TOOL_BY_NAME.get(name);
  return entry && entry.contract;
}

function getToolRegistry() {
  return TOOL_REGISTRY;
}

module.exports = {
  CONTRACT_VERSION,
  RISK_TIERS,
  buildToolRegistry,
  getProviderToolDefs,
  getToolEntry,
  getToolHandler,
  getToolContract,
  getToolRegistry,
};

/**
 * agent-tools/tool-metadata.js — 工具执行元数据注册表（BLOCK-109-CORE-ARCH P2，附录 A 后的调度分组地基）
 *
 * 每工具六个字段（plan §1 P2-2）：
 *   - readOnly       纯读取，不改变任何状态（文件系统/DB/OS/外部服务）
 *   - destructive    不可逆破坏（删除/清空/回滚/覆盖语义）
 *   - concurrentSafe 可与其他调用并行执行（调度器只并行 readOnly && concurrentSafe 组）
 *   - needsApproval  需要审批门/权限策略门（与 agent-tool-policy 的事后分类互补，
 *                    元数据是事前声明；policy 层仍是权威执行闸）
 *   - riskLevel      'low' | 'medium' | 'high'
 *   - timeoutMs      执行预算（v1 全部 null=未定预算——不虚构数字，真实预算随
 *                    实测另行补齐；字段存在性由完备性门禁保证）
 *
 * 分类原则（保守缺省）：
 *   - 只有明确纯读的工具才 readOnly && concurrentSafe；拿不准一律串行。
 *   - OS 自动化（computer_*）即使只读也不并发（单一输入设备）。
 *   - spawn 系工具 concurrentSafe=false 是**硬组合语义**（P2-5）：派发并行度软上限
 *     （SPAWN_CONCURRENCY_LIMIT，UI-432 P2）管父任务级子智能体并发，调度分组并行
 *     管单轮内工具执行——spawn 族永不进并行组，两层不得互相绕过。
 *   - 值为族级保守声明，个别工具如需放宽（如纯读改并发）须连同契约测试修订。
 */

const TOOL_METADATA = {
  // ---- workspace 域：读四件（纯读并发）----
  workspace_list: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: null },
  workspace_find: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: null },
  workspace_search: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: null },
  workspace_read: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: null },
  // ---- workspace 域：写/执行（串行）----
  workspace_write: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: true, riskLevel: 'medium', timeoutMs: null },
  workspace_replace: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: true, riskLevel: 'medium', timeoutMs: null },
  workspace_exec: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: true, riskLevel: 'high', timeoutMs: null },
  workspace_exec_background: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: true, riskLevel: 'high', timeoutMs: null },
  process_status: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: null },
  process_stop: { readOnly: false, destructive: true, concurrentSafe: false, needsApproval: true, riskLevel: 'high', timeoutMs: null },

  // ---- 知识空间域：读（纯读并发）----
  knowledge_read: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: null },
  knowledge_search: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: null },
  knowledge_status: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: null },
  knowledge_space_list: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: null },
  knowledge_doc_list: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: null },
  knowledge_space_impact: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: null },
  // ---- 知识空间域：写/结构变更（串行）----
  knowledge_doc_move: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: true, riskLevel: 'medium', timeoutMs: null },
  knowledge_doc_reindex: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: true, riskLevel: 'medium', timeoutMs: null },
  knowledge_space_bind: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: true, riskLevel: 'medium', timeoutMs: null },
  knowledge_space_create: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: true, riskLevel: 'medium', timeoutMs: null },
  knowledge_space_enable: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: true, riskLevel: 'medium', timeoutMs: null },
  knowledge_space_rename: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: true, riskLevel: 'medium', timeoutMs: null },
  // ---- 知识空间域：破坏性（串行 + 审批）----
  knowledge_doc_delete: { readOnly: false, destructive: true, concurrentSafe: false, needsApproval: true, riskLevel: 'high', timeoutMs: null },
  knowledge_space_clear: { readOnly: false, destructive: true, concurrentSafe: false, needsApproval: true, riskLevel: 'high', timeoutMs: null },
  knowledge_space_delete: { readOnly: false, destructive: true, concurrentSafe: false, needsApproval: true, riskLevel: 'high', timeoutMs: null },

  // ---- Result Studio / changeset 域：读（纯读并发）----
  result_studio_context: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: null },
  result_changeset_status: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: null },
  result_changeset_status_in_context: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: null },
  result_changeset_compare: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: null },
  result_changeset_compare_in_context: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: null },
  // ---- Result Studio / changeset 域：写（受信 Composer 通道，串行）----
  result_changeset_create: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: true, riskLevel: 'medium', timeoutMs: null },
  result_changeset_create_in_context: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: true, riskLevel: 'medium', timeoutMs: null },
  result_changeset_adopt: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: true, riskLevel: 'medium', timeoutMs: null },
  result_changeset_adopt_in_context: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: true, riskLevel: 'medium', timeoutMs: null },
  result_edit_plan: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: true, riskLevel: 'medium', timeoutMs: null },
  result_edit_plan_in_context: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: true, riskLevel: 'medium', timeoutMs: null },
  result_selection_run: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: true, riskLevel: 'high', timeoutMs: null },
  result_enrichment_from_context: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: true, riskLevel: 'high', timeoutMs: null },
  generate_methods: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: true, riskLevel: 'medium', timeoutMs: null },
  // ---- Result Studio 域：破坏性（串行 + 审批）----
  result_changeset_revert: { readOnly: false, destructive: true, concurrentSafe: false, needsApproval: true, riskLevel: 'high', timeoutMs: null },
  result_changeset_revert_in_context: { readOnly: false, destructive: true, concurrentSafe: false, needsApproval: true, riskLevel: 'high', timeoutMs: null },
  artifact_revision_list: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: null },
  artifact_revision_restore: { readOnly: false, destructive: true, concurrentSafe: false, needsApproval: true, riskLevel: 'high', timeoutMs: null },

  // ---- 子智能体编排域（P2-5 组合语义：永不并行，软上限在执行器内）----
  spawn_agent: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: true, riskLevel: 'high', timeoutMs: null },
  wait_agent: { readOnly: true, destructive: false, concurrentSafe: false, needsApproval: false, riskLevel: 'medium', timeoutMs: null },
  list_agents: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: null },
  // BLOCK-249（Q4a）— journal 只读（诊断摘要；事件真相仍在 task_events）
  read_agent_journal: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: null },
  interrupt_agent: { readOnly: false, destructive: true, concurrentSafe: false, needsApproval: true, riskLevel: 'high', timeoutMs: null },
  send_message: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: true, riskLevel: 'medium', timeoutMs: null },
  followup_task: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: true, riskLevel: 'medium', timeoutMs: null },
  // BLOCK-244 Q1-REM C19 — 结构化提问：暂停本轮等用户回答（超时如实降级），
  // 非只读（写提问资源 + task 事件）、不可并发（阻塞本轮）、风险低（无副作用面）。
  ask_user_question: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: false, riskLevel: 'low', timeoutMs: 300000 },

  // ---- 联网域（BLOCK-247 / Q2b）----
  // 只读外部请求：读并发、无写面，但**受配置授权闸门管**（默认关；
  // 未开启时 handler 返回 web_access_disabled）。needsApproval=false 的理由：
  // 授权已在设置面完成（一次性显式开启），逐次弹审批会把「查一次资料」变成打断流。
  web_search: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: null },
  web_fetch: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: null },
  // BLOCK-264（C-40）— 浏览器连接器：connect/status/disconnect 只读会话面；
  // act 逐动作分层（click/fill 写操作 → needsApproval；navigate/read/screenshot 只读）
  browser_connect: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: 5000 },
  browser_status: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: 2000 },
  browser_disconnect: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: 2000 },
  browser_act: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: true, riskLevel: 'medium', timeoutMs: 20000 },

  // ---- 会话/工具栏域 ----
  system_info: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: null },
  todo_write: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: false, riskLevel: 'low', timeoutMs: null },
  // BLOCK-150 ④ 漂移修齐：plan 真身写 copilot_plans/plan_steps/plan_revisions
  // （plan-ui-tools.js INSERT/UPDATE，契约 state-write/R1）——曾误标 readOnly=true
  // 会被调度器放进只读并行组；改非只读串行（concurrentSafe 随只读轴一并收串行）。
  plan: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: false, riskLevel: 'low', timeoutMs: null },
  // ---- 目标状态机（BLOCK-256 Q7）：get 只读；create/update 写 agent_goals ----
  create_goal: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: false, riskLevel: 'low', timeoutMs: null },
  get_goal: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: null },
  update_goal: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: false, riskLevel: 'low', timeoutMs: null },
  // NEXT-01 — 工作流会启动子代理并写 journal；dryRun 也走同一工具面，保守串行+审批
  run_workflow: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: true, riskLevel: 'high', timeoutMs: null },
  model3d_inspect: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: 2000 },
  model3d_validate: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: 5000 },
  model3d_propose: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: 3000 },
  model3d_apply: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: true, riskLevel: 'medium', timeoutMs: 5000 },
  model3d_render: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: true, riskLevel: 'high', timeoutMs: 180000 },
  model3d_export: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: true, riskLevel: 'high', timeoutMs: 180000 },
  model3d_visual_qa: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: true, riskLevel: 'medium', timeoutMs: 180000 },
  model3d_recipe: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: true, riskLevel: 'medium', timeoutMs: 180000 },
  // ---- 决策观测域（BLOCK-116 W2 / BK-04）：只读台账查询（纯读并发；变更面不对模型开放）----
  decision_summary: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: null },
  decision_recent: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: null },
  verify_state: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: null },
  resident_task_create: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: true, riskLevel: 'medium', timeoutMs: null },
  resident_task_list: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: null },
  resident_task_read: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: null },

  // ---- OS 自动化域（computer_*：只读也不并发——单一输入设备）----
  // BLOCK-150 ④ 漂移修齐：screenshot 产物落 <workspace>/computer-use/（契约
  // vision/workspace-write，computer-use-tools.js resolveScreenshotOutPath 白名单），
  // 曾误标 readOnly=true 与「不改变文件系统」字段定义相抵。
  computer_screenshot: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: false, riskLevel: 'medium', timeoutMs: null },
  computer_snapshot: { readOnly: true, destructive: false, concurrentSafe: false, needsApproval: false, riskLevel: 'medium', timeoutMs: null },
  computer_wait: { readOnly: true, destructive: false, concurrentSafe: false, needsApproval: false, riskLevel: 'low', timeoutMs: null },
  computer_click: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: true, riskLevel: 'high', timeoutMs: null },
  computer_type: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: true, riskLevel: 'high', timeoutMs: null },
  computer_press: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: true, riskLevel: 'high', timeoutMs: null },
  computer_scroll: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: true, riskLevel: 'high', timeoutMs: null },
  computer_authorize: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: true, riskLevel: 'high', timeoutMs: null },

  // ---- 浏览器/检索域 ----
  search: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: null },
  query: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: null },
  read_page: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: null },
  read_image: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: null },
  act: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: true, riskLevel: 'high', timeoutMs: null },

  // ---- 远程执行/通用执行域（高风险串行）----
  delegate_to_petri_node: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: true, riskLevel: 'high', timeoutMs: null },
  // BLOCK-164 W1 — 节点清单只读聚合
  federation_list_peers: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: 8000 },
  run_tool: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: true, riskLevel: 'high', timeoutMs: null },
  // BLOCK-121 P2（B1）— 结果内容只读读取
  result_summary: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: null },
  // BLOCK-254 A-2 — 批注只读读取（旁路表查询，无写面、并发安全）
  result_annotations_list: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: null },
  // BLOCK-124（C-13）— 符号图只读查询（全图建在临时内存，无写面；并发安全——只读 fs）
  codegraph_who_imports: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: 30000 },
  codegraph_classify_edges: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: 30000 },

  // ---- skill 元工具（mcp/registry 注册）----
  skill_discover: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: null },
  skill_get: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: null },
  // BLOCK-176 W7 CP-21 — 只读探测（which/where）；安装动作本身走 cmd 工具审批链
  skill_preflight: { readOnly: true, destructive: false, concurrentSafe: true, needsApproval: false, riskLevel: 'low', timeoutMs: 5000 },
  skill_execute: { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: true, riskLevel: 'high', timeoutMs: null },
};

const RISK_LEVELS = ['low', 'medium', 'high'];
const METADATA_KEYS = ['readOnly', 'destructive', 'concurrentSafe', 'needsApproval', 'riskLevel', 'timeoutMs'];

/** 取工具元数据；未知工具返回保守缺省（串行非只读——拿不准不并行）。 */
function getToolMetadata(name) {
  const meta = TOOL_METADATA[name];
  if (meta) return { ...meta, known: true };
  return { readOnly: false, destructive: false, concurrentSafe: false, needsApproval: true, riskLevel: 'high', timeoutMs: null, known: false };
}

/**
 * MCP/插件工具元数据投影（P2-4）：动态插件工具无静态声明，一律保守缺省
 * （串行非只读需审批）——消除第二套执行语义：MCP 工具与内置工具走同一元数据形状。
 */
function getMcpToolMetadata(name) {
  return { ...getToolMetadata(null), known: false, name };
}

module.exports = { TOOL_METADATA, METADATA_KEYS, RISK_LEVELS, getToolMetadata, getMcpToolMetadata };

import type {
  ToolCallEvent,
  ToolOutputEvent,
  ToolResultEvent,
  ToolSideEffects,
  ToolApproval,
  UserQuestion,
} from './copilotClient';
import type { IconName } from '@/components/icons/Icon';

export type ToolActivityStatus = 'running' | 'awaiting_confirmation' | 'success' | 'error' | 'denied';

/** BLOCK-33 P3 — 流式输出尾部（内存态，不随会话持久化）。 */
export interface ToolActivityOutput {
  tail: string;
  truncated: boolean;
}

/** UI-273 增补 — 写操作（workspace_write / workspace_replace）的逐行改动，随活动落库。 */
export type ToolChangeDiffLineType = 'ctx' | 'add' | 'del';

export interface ToolChangeDiffHunk {
  oldStart: number;
  newStart: number;
  lines: Array<{ type: ToolChangeDiffLineType; text: string }>;
}

export interface ToolActivityChangeDiff {
  added: number;
  removed: number;
  truncated?: boolean;
  hunks: ToolChangeDiffHunk[];
}

function parseChangeDiff(value: unknown): ToolActivityChangeDiff | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const added = typeof raw.added === 'number' && Number.isFinite(raw.added) ? raw.added : 0;
  const removed = typeof raw.removed === 'number' && Number.isFinite(raw.removed) ? raw.removed : 0;
  const hunks = Array.isArray(raw.hunks)
    ? raw.hunks.flatMap((hunk) => {
        if (!hunk || typeof hunk !== 'object') return [];
        const h = hunk as Record<string, unknown>;
        const lines = Array.isArray(h.lines)
          ? h.lines.flatMap((line) => {
              if (!line || typeof line !== 'object') return [];
              const l = line as Record<string, unknown>;
              if (typeof l.text !== 'string' || typeof l.type !== 'string') return [];
              const type: ToolChangeDiffLineType = l.type === 'add' || l.type === 'del' ? l.type : 'ctx';
              return [{ type, text: l.text }];
            })
          : [];
        return [{
          oldStart: typeof h.oldStart === 'number' ? h.oldStart : 1,
          newStart: typeof h.newStart === 'number' ? h.newStart : 1,
          lines,
        }];
      })
    : [];
  return {
    added,
    removed,
    truncated: raw.truncated === true,
    hunks,
  };
}

export interface ToolActivityItem {
  key: string;
  toolJobId?: string;
  toolId?: string;
  callId?: string;
  traceId?: string;
  iteration?: number;
  name: string;
  status: ToolActivityStatus;
  durationMs?: number;
  sourceTruncated?: boolean;
  previewTruncated?: boolean;
  truncated?: boolean;
  terminationReason?: string;
  sideEffects?: ToolSideEffects;
  changeDiff?: ToolActivityChangeDiff;
  summary?: string;
  actionLabel: string;
  actionDetail?: string;
  output?: ToolActivityOutput;
  /** UI-315 — exec 类工具的完整命令（bounded 400 字符），驱动对话流内
   *  终端块（$ 命令 + 输出）的渲染；历史消息经 meta.toolActivities 恢复。 */
  command?: string;
  /** UI-315 优化 — 实际使用的 shell（powershell/cmd/bash…），头行展示 */
  shellLabel?: string;
  /** BLOCK-59 P4 — agent 管理工具（spawn/wait/list）结果携带的子 agent
   *  任务 id；活动行据此提供「详情窗」入口（弹出 agent 独立窗）。 */
  agentRunId?: string;
  /** UI-437 v5.6 — 工具返回数据本体（后端 publicData 已界定的 bounded 版本）；
   *  活动行展开时渲染「返回」详情。 */
  resultData?: unknown;
  /** BLOCK-243 — 审批卡载荷（toolResult 顶层，独立于 data 截断）。 */
  approval?: ToolApproval;
  /** BLOCK-244 — 结构化提问载荷（toolResult 顶层）。 */
  question?: UserQuestion;
  /** BLOCK-247（Q2b）— 联网结果的来源标签（域名/来源主机名）。
   *  治理透明：结论从哪个网来的必须一眼可见，不能只留一句「已检索」。 */
  sourceLabel?: string;
}

const ACTIVITY_STATUSES: ToolActivityStatus[] = [
  'running',
  'awaiting_confirmation',
  'success',
  'error',
  'denied',
];

function parseToolApproval(value: unknown): ToolApproval | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.guardKey !== 'string' || raw.guardKey === '') return undefined;
  // 后端单一构造（tool-events.approvalPayload），前端只做存在性边界检查。
  return { ...(value as ToolApproval), guardKey: raw.guardKey };
}

function parseUserQuestion(value: unknown): UserQuestion | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.questionId !== 'string' || raw.questionId === '') return undefined;
  return value;
}

/** Restore only the safe, bounded activity shape persisted with a message. */
export function restoreToolActivities(value: unknown): ToolActivityItem[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((item, index) => {
    if (!item || typeof item !== 'object') return [];
    const raw = item as Record<string, unknown>;
    const name = typeof raw.name === 'string' ? raw.name : '';
    const status = typeof raw.status === 'string' && ACTIVITY_STATUSES.includes(raw.status as ToolActivityStatus)
      ? raw.status as ToolActivityStatus
      : null;
    if (!name || !status) return [];
    const durationMs = typeof raw.durationMs === 'number' && Number.isFinite(raw.durationMs)
      ? raw.durationMs
      : undefined;
    const sideEffects = raw.sideEffects && typeof raw.sideEffects === 'object'
      ? raw.sideEffects as ToolSideEffects
      : undefined;
    return [{
      key: typeof raw.key === 'string' ? raw.key : `restored:${index}:${name}`,
      toolJobId: typeof raw.toolJobId === 'string' ? raw.toolJobId : undefined,
      toolId: typeof raw.toolId === 'string' ? raw.toolId : undefined,
      callId: typeof raw.callId === 'string' ? raw.callId : undefined,
      traceId: typeof raw.traceId === 'string' ? raw.traceId : undefined,
      iteration: typeof raw.iteration === 'number' && Number.isFinite(raw.iteration)
        ? raw.iteration
        : undefined,
    name,
    status,
    durationMs,
    sourceTruncated: typeof raw.sourceTruncated === 'boolean' ? raw.sourceTruncated : undefined,
    previewTruncated: typeof raw.previewTruncated === 'boolean' ? raw.previewTruncated : undefined,
    truncated: typeof raw.truncated === 'boolean' ? raw.truncated : undefined,
    terminationReason: typeof raw.terminationReason === 'string' ? raw.terminationReason : undefined,
    sideEffects,
    changeDiff: parseChangeDiff(raw.changeDiff),
    summary: typeof raw.summary === 'string' ? raw.summary : undefined,
    actionLabel: typeof raw.actionLabel === 'string' ? raw.actionLabel : '已调用',
    actionDetail: typeof raw.actionDetail === 'string' ? raw.actionDetail : undefined,
    // UI-315 — 终端块恢复：完整命令 + 流式输出尾部（均为有界形状）
    command: typeof raw.command === 'string' ? raw.command.slice(0, COMMAND_MAX_CHARS) : undefined,
    output: (() => {
      const out = raw.output;
      if (!out || typeof out !== 'object') return undefined;
      const tail = typeof (out as Record<string, unknown>).tail === 'string'
        ? (out as Record<string, unknown>).tail as string
        : '';
      if (!tail) return undefined;
      return {
        tail: tail.slice(0, OUTPUT_TAIL_CHARS),
        truncated: (out as Record<string, unknown>).truncated === true,
      };
    })(),
    shellLabel: typeof raw.shellLabel === 'string' ? raw.shellLabel.slice(0, 24) : undefined,
    // BLOCK-247（Q2b）— 联网结果的来源标签（历史恢复时随 meta 一起回来；
    // 旧记录没有该字段时按 resultData 重新派生，避免重载后来源标签消失）
    sourceLabel: (typeof raw.sourceLabel === 'string' ? raw.sourceLabel.slice(0, 160) : undefined)
      || deriveSourceLabel(name, 'resultData' in raw ? raw.resultData : undefined),
    agentRunId: typeof raw.agentRunId === 'string' ? raw.agentRunId : undefined,
    // UI-437 v5.6 — 结果数据本体（后端 publicData 已界定的有界形状）随 meta 恢复
    resultData: 'resultData' in raw ? raw.resultData : undefined,
    approval: parseToolApproval(raw.approval),
    question: parseUserQuestion(raw.question),
    }];
  });
}

function legacyKey(name: string, traceId?: string): string {
  return `${traceId || 'legacy'}:${name}`;
}

function callKey(event: ToolCallEvent): string {
  return event.callId || legacyKey(event.name, event.traceId);
}

function compactDetail(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  return normalized.length > 140 ? `${normalized.slice(0, 137)}…` : normalized;
}

/** UI-315 — exec 类工具名单（对话流内以终端块呈现：$ 命令 + 输出）。 */
export const EXEC_TOOL_NAMES: ReadonlySet<string> = new Set([
  'workspace_exec',
  'workspace_exec_background',
]);

const COMMAND_MAX_CHARS = 400;

function execCommand(name: string, args: Record<string, unknown> = {}): string | undefined {
  if (!EXEC_TOOL_NAMES.has(name)) return undefined;
  const command = typeof args.command === 'string' ? args.command.trim() : '';
  if (!command) return undefined;
  return command.length > COMMAND_MAX_CHARS ? `${command.slice(0, COMMAND_MAX_CHARS)}…` : command;
}

/** Convert tool arguments into a safe, user-facing Codex-style activity line. */
/** UI-437 v5.4 — 未登记工具的参数摘要兜底：key=值 · …（单键截 40 字，最多 3 键）。 */
function summarizeArgsDetail(args: Record<string, unknown> = {}): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    let rendered: string;
    if (typeof value === 'string') {
      rendered = value.replace(/\s+/g, ' ').trim();
    } else if (value == null) {
      rendered = '';
    } else {
      try {
        rendered = JSON.stringify(value).replace(/\s+/g, ' ');
      } catch {
        rendered = '';
      }
    }
    if (!rendered) continue;
    parts.push(`${key}=${rendered.slice(0, 40)}`);
    if (parts.length >= 3) break;
  }
  return parts.join(' · ');
}

/** UI-437 v5.18 — 工具动词注册表（全量 71 静态工具，与后端
 *  tool-events.js TOOL_ACTIVITY_VERBS 同构；契约测试经
 *  test/fixtures/tool-activity-labels.json 双侧逐工具钉住）。 */
const TOOL_ACTIVITY_VERBS: Readonly<Record<string, string>> = {
  "act": "已变更",
  "decision_summary": "已统计",
  "decision_recent": "已回放",
  "codegraph_who_imports": "已查引用",
  "codegraph_classify_edges": "已盘点依赖",
  "artifact_revision_list": "已列出",
  "artifact_revision_restore": "已恢复",
  "ask_user_question": "已提问",
  "computer_authorize": "已授权",
  "computer_click": "已点击",
  "computer_press": "已按键",
  "computer_screenshot": "已截屏",
  "computer_scroll": "已滚动",
  "computer_snapshot": "已取快照",
  "computer_type": "已输入",
  "computer_wait": "已等待",
  "delegate_to_petri_node": "已委派",

  "federation_list_peers": "已查询协作节点",
  "skill_discover": "已列技能",
  "skill_get": "已读技能",
  "skill_preflight": "已检技能依赖",
  "followup_task": "已派发",
  "generate_methods": "已生成",
  "interrupt_agent": "已中断",
  "knowledge_doc_delete": "已删除",
  "knowledge_doc_list": "已列出",
  "knowledge_doc_move": "已移动",
  "knowledge_doc_reindex": "已重建索引",
  "knowledge_read": "已读取",
  "knowledge_search": "已检索",
  "knowledge_space_bind": "已绑定",
  "knowledge_space_clear": "已清空",
  "knowledge_space_create": "已创建",
  "knowledge_space_delete": "已删除",
  "knowledge_space_enable": "已启用",
  "knowledge_space_impact": "已评估影响",
  "knowledge_space_list": "已列出",
  "knowledge_space_rename": "已重命名",
  "knowledge_status": "已查询",
  "list_agents": "已列出",
  "read_agent_journal": "已读 journal",
  "plan": "已规划",
  "create_goal": "已创建目标",
  "get_goal": "已查询目标",
  "update_goal": "已更新目标",
  "run_workflow": "已运行工作流",
  "model3d_inspect": "已检查 3D 场景",
  "model3d_validate": "已校验 3D 场景",
  "model3d_propose": "已生成 3D 提案",
  "model3d_apply": "已写入 3D 场景",
  "model3d_render": "已渲染 3D 视图",
  "model3d_export": "已导出 3D 模型",
  "model3d_visual_qa": "已做 3D 视觉检查",
  "model3d_recipe": "已生成 3D recipe",
  "model3d_bom": "已生成 BOM",
  "model3d_asset": "已处理 3D 资产",
  "model3d_share": "已生成 3D 分享包",
  "process_status": "已查询",
  "process_stop": "已停止",
  "query": "已查询",
  "read_image": "已读取",
  "read_page": "已读取",
  "resident_task_create": "已创建",
  "resident_task_list": "已列出",
  "resident_task_read": "已读取",
  "result_changeset_adopt": "已采纳",
  "result_changeset_adopt_in_context": "已采纳",
  "result_changeset_compare": "已比对",
  "result_changeset_compare_in_context": "已比对",
  "result_changeset_create": "已创建",
  "result_changeset_create_in_context": "已创建",
  "result_changeset_revert": "已恢复",
  "result_changeset_revert_in_context": "已恢复",
  "result_changeset_status": "已查询",
  "result_changeset_status_in_context": "已查询",
  "result_edit_plan": "已规划",
  "result_edit_plan_in_context": "已规划",
  "result_enrichment_from_context": "已充实",
  "result_selection_run": "已运行",
  "result_studio_context": "已查询",
  "result_annotations_list": "已读取批注",
  "result_summary": "已读取结果",
  "run_tool": "已运行",
  "search": "已搜索",
  "send_message": "已发送",
  "spawn_agent": "已派发",
  "system_info": "已查询",
  "todo_write": "已记录",
  "verify_state": "已校验",
  "wait_agent": "已等待",
  "web_fetch": "已抓取",
  // BLOCK-264（C-40）浏览器连接器
  "browser_connect": "已连接浏览器",
  "browser_act": "浏览器操作",
  "browser_status": "浏览器状态",
  "browser_disconnect": "已断开浏览器",
  "web_search": "已检索",
  "workspace_exec": "已运行",
  "workspace_exec_background": "后台运行",
  "workspace_find": "已查找",
  "workspace_list": "已列出",
  "workspace_read": "已读取",
  "workspace_replace": "已替换",
  "workspace_search": "已搜索",
  "workspace_write": "已写入",
};

/** UI-437 v5.18 — 工具分类图标（域感知：检索/知识空间/清单/系统/结果/网络/
 *  屏幕操作/产物版本…），terminal/write/agent 三类仍由行为集合优先。 */
export const TOOL_ACTIVITY_ICONS: Readonly<Record<string, IconName>> = {
  "act": "settings",
  "decision_recent": "clock",
  "decision_summary": "settings",
  "codegraph_who_imports": "git-branch",
  "codegraph_classify_edges": "git-branch",
  "artifact_revision_list": "archive",
  "artifact_revision_restore": "archive",
  "ask_user_question": "message-circle",
  "computer_authorize": "eye",
  "computer_click": "eye",
  "computer_press": "eye",
  "computer_screenshot": "eye",
  "computer_scroll": "eye",
  "computer_snapshot": "eye",
  "computer_type": "eye",
  "computer_wait": "eye",
  "delegate_to_petri_node": "globe",
  "federation_list_peers": "globe",
  "followup_task": "bot",
  "generate_methods": "table",
  "interrupt_agent": "bot",
  "knowledge_doc_delete": "book",
  "knowledge_doc_list": "book",
  "knowledge_doc_move": "book",
  "knowledge_doc_reindex": "book",
  "knowledge_read": "book",
  "knowledge_search": "search",
  "knowledge_space_bind": "book",
  "knowledge_space_clear": "book",
  "knowledge_space_create": "book",
  "knowledge_space_delete": "book",
  "knowledge_space_enable": "book",
  "knowledge_space_impact": "book",
  "knowledge_space_list": "book",
  "knowledge_space_rename": "book",
  "knowledge_status": "book",
  "list_agents": "bot",
  "read_agent_journal": "list-details",
  "plan": "list-details",
  "create_goal": "flag",
  "get_goal": "bar-chart",
  "update_goal": "pencil",
  "run_workflow": "layers",
  "model3d_inspect": "layers",
  "model3d_validate": "shield",
  "model3d_propose": "sparkles",
  "model3d_apply": "pencil",
  "model3d_render": "layers",
  "model3d_export": "download",
  "model3d_visual_qa": "shield",
  "model3d_recipe": "layers",
  "model3d_bom": "file",
  "model3d_asset": "layers",
  "model3d_share": "download",
  "process_status": "cpu",
  "process_stop": "cpu",
  "query": "database",
  "read_image": "image",
  "read_page": "globe",
  "resident_task_create": "list-details",
  "resident_task_list": "list-details",
  "resident_task_read": "list-details",
  "result_changeset_adopt": "table",
  "result_changeset_adopt_in_context": "table",
  "result_changeset_compare": "table",
  "result_changeset_compare_in_context": "table",
  "result_changeset_create": "table",
  "result_changeset_create_in_context": "table",
  "result_changeset_revert": "table",
  "result_changeset_revert_in_context": "table",
  "result_changeset_status": "table",
  "result_changeset_status_in_context": "table",
  "result_edit_plan": "table",
  "result_edit_plan_in_context": "table",
  "result_enrichment_from_context": "table",
  "result_selection_run": "play",
  "result_studio_context": "table",
  "result_annotations_list": "table",
  "result_summary": "table",
  "run_tool": "play",
  "search": "globe",
  "send_message": "bot",
  "spawn_agent": "bot",
  "system_info": "cpu",
  "todo_write": "list-details",
  "verify_state": "shield",
  "wait_agent": "bot",
  "web_fetch": "globe",
  "browser_connect": "globe",
  "browser_act": "bot",
  "browser_status": "globe",
  "browser_disconnect": "globe",
  "web_search": "globe",
  "workspace_exec": "terminal",
  "workspace_exec_background": "terminal",
  "workspace_find": "search",
  "workspace_list": "folder",
  "workspace_read": "file",
  "workspace_replace": "pencil",
  "workspace_search": "search",
  "workspace_write": "pencil",
};

export function summarizeToolCall(
  name: string,
  args: Record<string, unknown> = {}
): { actionLabel: string; actionDetail?: string } {
  const result = summarizeToolCallSwitch(name, args);
  // UI-437 v5.18 — 标签唯一真源 = TOOL_ACTIVITY_VERBS（与后端注册表同构）
  const verb = TOOL_ACTIVITY_VERBS[name];
  return verb ? { ...result, actionLabel: verb } : result;
}

/**
 * BLOCK-247（Q2b）— 从工具结果派生来源标签（前端兜底；后端顶层 sourceLabel 优先）。
 * 只取主机名，不取正文：来源要可核，内容要看「返回」详情。
 */
export function deriveSourceLabel(name: string, data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const record = data as Record<string, unknown>;
  if (name === 'web_fetch') {
    const source = typeof record.source === 'string' ? record.source.trim() : '';
    return source ? source.slice(0, 120) : undefined;
  }
  if (name === 'web_search') {
    if (!Array.isArray(record.results)) return undefined;
    const hosts: string[] = [];
    for (const row of record.results) {
      const host = row && typeof row === 'object' && typeof (row as Record<string, unknown>).source === 'string'
        ? String((row as Record<string, unknown>).source).trim()
        : '';
      if (host && !hosts.includes(host)) hosts.push(host);
      if (hosts.length >= 3) break;
    }
    return hosts.length > 0 ? hosts.join('、').slice(0, 160) : undefined;
  }
  return undefined;
}

function summarizeToolCallSwitch(
  name: string,
  args: Record<string, unknown> = {}
): { actionLabel: string; actionDetail?: string } {
  switch (name) {
    case 'workspace_exec':
      return { actionLabel: '已运行', actionDetail: compactDetail(args.command) || '命令' };
    // UI-437 v5.18 — 高频工具定制宾语（参数摘要太噪的工具给固定宾语）：
    case 'knowledge_search':
      return { actionLabel: TOOL_ACTIVITY_VERBS.knowledge_search, actionDetail: compactDetail(args.query) || '知识空间' };
    case 'todo_write':
      return { actionLabel: TOOL_ACTIVITY_VERBS.todo_write, actionDetail: '任务清单' };
    case 'spawn_agent':
      return { actionLabel: TOOL_ACTIVITY_VERBS.spawn_agent, actionDetail: compactDetail(args.task) || '子智能体' };
    case 'followup_task':
      return { actionLabel: TOOL_ACTIVITY_VERBS.followup_task, actionDetail: compactDetail(args.task) || '后续任务' };
    case 'send_message':
      return { actionLabel: TOOL_ACTIVITY_VERBS.send_message, actionDetail: compactDetail(args.agentId) || '子智能体' };
    case 'wait_agent':
    case 'interrupt_agent':
      return { actionLabel: TOOL_ACTIVITY_VERBS[name], actionDetail: compactDetail(args.agentId) || '子智能体' };
    case 'list_agents':
      return { actionLabel: TOOL_ACTIVITY_VERBS.list_agents, actionDetail: '子智能体' };
    case 'resident_task_create':
      return { actionLabel: TOOL_ACTIVITY_VERBS.resident_task_create, actionDetail: compactDetail(args.command) || '常驻任务' };
    case 'search':
      return { actionLabel: TOOL_ACTIVITY_VERBS.search, actionDetail: compactDetail(args.q) || '网络' };
    case 'read_page':
      return { actionLabel: TOOL_ACTIVITY_VERBS.read_page, actionDetail: compactDetail(args.url) || '网页' };
    // BLOCK-247（Q2b）— 联网两件：宾语带来源线索（检索词 / 目标 URL）
    case 'web_search':
      return { actionLabel: TOOL_ACTIVITY_VERBS.web_search, actionDetail: compactDetail(args.query) || '网络' };
    case 'web_fetch':
      return { actionLabel: TOOL_ACTIVITY_VERBS.web_fetch, actionDetail: compactDetail(args.url) || '网页' };
    case 'read_image':
      return { actionLabel: TOOL_ACTIVITY_VERBS.read_image, actionDetail: compactDetail(args.filePath || args.toolJobId) || '图像' };
    case 'delegate_to_petri_node':
      return { actionLabel: TOOL_ACTIVITY_VERBS.delegate_to_petri_node, actionDetail: compactDetail(args.task) || '协作节点' };
      case 'federation_list_peers':
        return { actionLabel: TOOL_ACTIVITY_VERBS.federation_list_peers, actionDetail: '联邦节点' };
      case 'skill_discover':
        return { actionLabel: TOOL_ACTIVITY_VERBS.skill_discover, actionDetail: compactDetail(args?.categoryFilter) || '技能台' };
      case 'skill_get':
        return { actionLabel: TOOL_ACTIVITY_VERBS.skill_get, actionDetail: compactDetail(args?.name) || '技能手册' };
    case 'workspace_read': {
      const path = compactDetail(args.path) || '文件';
      const start = Number.isInteger(args.startLine) ? ` · 第 ${Number(args.startLine)} 行起` : '';
      return { actionLabel: '已读取', actionDetail: `${path}${start}` };
    }
    case 'workspace_list':
      return { actionLabel: '已读取', actionDetail: `目录 ${compactDetail(args.path) || '.'}` };
    case 'workspace_find':
      return { actionLabel: '已查找', actionDetail: compactDetail(args.pattern) || '文件' };
    case 'workspace_search':
      return { actionLabel: '已搜索', actionDetail: compactDetail(args.query) || '文本' };
    case 'workspace_write':
    case 'workspace_replace':
      return { actionLabel: '已修改', actionDetail: compactDetail(args.path) || '文件' };
    case 'run_tool':
      return { actionLabel: '已运行', actionDetail: compactDetail(args.toolId) || '分析工具' };
    case 'system_info':
      // BLOCK-33 P1 — 环境自省：只读、无参数
      return { actionLabel: '已查询', actionDetail: '系统环境' };
    default: {
      // UI-437 v5.18 — 已登记工具：动词取注册表、detail 用参数摘要（无工具名
      // 前缀，与登记工具同构）；未登记（MCP/插件动态工具）保持
      // 「已调用 name（参数摘要）」兜底。
      const verb = TOOL_ACTIVITY_VERBS[name];
      const detail = summarizeArgsDetail(args);
      if (verb) return { actionLabel: verb, actionDetail: detail || name };
      return { actionLabel: '已调用', actionDetail: detail ? `${name}（${detail}）` : name };
    }
  }
}

function nextLegacyCallKey(current: ToolActivityItem[], event: ToolCallEvent): string {
  const base = callKey(event);
  const occurrence = current.filter((item) => item.key === base || item.key.startsWith(`${base}:`)).length + 1;
  return `${base}:${occurrence}`;
}

function resultKey(event: ToolResultEvent): string {
  const result = event.toolResult;
  return result?.callId || legacyKey(result?.tool || event.name, result?.traceId);
}

export function mergeToolCallActivity(
  current: ToolActivityItem[],
  event: ToolCallEvent
): ToolActivityItem[] {
  const baseKey = callKey(event);
  const index = current.findIndex((item) => item.key === baseKey);
  if (index >= 0) {
    // Structured task-mode SSE can replay a call after its result. Never
    // downgrade a terminal item back to running when that happens.
    if (event.callId && current[index].status !== 'running') return current;
    if (current[index].status === 'running') {
      const next = current.slice();
      next[index] = {
        ...current[index],
        callId: event.callId || current[index].callId,
        traceId: event.traceId || current[index].traceId,
        name: event.name,
        command: execCommand(event.name, event.args) || current[index].command,
        ...summarizeToolCall(event.name, event.args),
      };
      return next;
    }
  }
  const key = event.callId ? baseKey : nextLegacyCallKey(current, event);
  return [
    ...current,
    {
      key,
      callId: event.callId,
      traceId: event.traceId,
      iteration: event.iteration,
      name: event.name,
      status: 'running',
      command: execCommand(event.name, event.args),
      ...summarizeToolCall(event.name, event.args),
    },
  ];
}

function inferLegacyStatus(event: ToolResultEvent): ToolActivityStatus {
  return /^错误[:：]/.test(event.summary || '') || Boolean(event.actError)
    ? 'error'
    : 'success';
}

// BLOCK-33 P3 — 活动条内保留的输出尾部上限；更早内容折叠为前导省略号。
const OUTPUT_TAIL_CHARS = 2000;

/**
 * 把 tool_output 增量并入对应工具活动项（按 callId 关联）。
 * 无匹配活动项时挂到最新的同工具 running 项；仍无则忽略（迟到/乱序输出）。
 */
export function mergeToolOutputActivity(
  current: ToolActivityItem[],
  event: ToolOutputEvent
): ToolActivityItem[] {
  if (!event.text) return current;
  const baseKey = event.callId || legacyKey(event.name, event.traceId);
  let index = current.findIndex((item) => item.key === baseKey);
  if (index < 0) {
    for (let i = current.length - 1; i >= 0; i -= 1) {
      if (current[i].name === event.name && current[i].status === 'running') {
        index = i;
        break;
      }
    }
  }
  if (index < 0) return current;
  const existing = current[index];
  const previous = existing.output?.tail || '';
  let tail = previous + event.text;
  if (tail.length > OUTPUT_TAIL_CHARS) {
    tail = `…${tail.slice(-(OUTPUT_TAIL_CHARS - 1))}`;
  }
  const next = current.slice();
  next[index] = {
    ...existing,
    output: {
      tail,
      truncated: Boolean(existing.output?.truncated) || event.truncated === true,
    },
  };
  return next;
}

export function mergeToolResultActivity(
  current: ToolActivityItem[],
  event: ToolResultEvent
): ToolActivityItem[] {
  const result = event.toolResult;
  const name = result?.tool || event.name;
  const key = resultKey(event);
  let index = current.findIndex((item) => item.key === key);

  // Legacy events have no callId. Correlate them with the newest running call
  // of the same tool instead of creating duplicate rows.
  if (!result?.callId && index < 0) {
    for (let i = current.length - 1; i >= 0; i -= 1) {
      if (current[i].name === name && current[i].status === 'running') {
        index = i;
        break;
      }
    }
  }

  const fallbackAction = summarizeToolCall(name);
  // BLOCK-59 P4 — agent 管理工具结果携带 agentId（子 agent 任务 id），
  // 提取供活动行「详情窗」入口；其余工具 / 既有值原样保留。
  const resultData = result?.data as Record<string, unknown> | undefined;
  // UI-315 优化 — exec 结果携带实际使用的 shell 可执行路径，派生短标签
  const resultShellLabel = (() => {
    const shell = resultData && typeof resultData.shell === 'string' ? resultData.shell : '';
    if (!shell) return undefined;
    const base = shell.split(/[\\/|]/).pop() || shell;
    const lower = base.toLowerCase().replace(/\.exe$/, '');
    if (lower === 'cmd') return 'cmd';
    if (lower.startsWith('powershell') || lower === 'pwsh') return 'powershell';
    if (lower === 'wsl') return 'wsl';
    return lower.slice(0, 16);
  })();
  const resultAgentRunId =
    (name === 'spawn_agent' || name === 'wait_agent' || name === 'list_agents') &&
    resultData &&
    typeof resultData.agentId === 'string'
      ? resultData.agentId
      : undefined;
  const item: ToolActivityItem = {
    key: index >= 0 ? current[index].key : key,
    toolJobId: event.toolJobId || (index >= 0 ? current[index].toolJobId : undefined),
    toolId: event.toolId || (index >= 0 ? current[index].toolId : undefined),
    callId: result?.callId || (index >= 0 ? current[index].callId : undefined),
    traceId: result?.traceId || (index >= 0 ? current[index].traceId : undefined),
    iteration: event.iteration || (index >= 0 ? current[index].iteration : undefined),
    name,
    status: result?.terminationReason === 'approval_required'
      ? 'awaiting_confirmation'
      : result?.status || inferLegacyStatus(event),
    durationMs: result?.durationMs,
    sourceTruncated: result?.sourceTruncated,
    previewTruncated: result?.previewTruncated,
    truncated: result?.truncated,
    terminationReason: result?.terminationReason,
    sideEffects: result?.sideEffects,
    changeDiff: parseChangeDiff(result?.changeDiff),
    summary: event.summary,
    // BLOCK-33 P3 — tool_result 合并时保留运行期累积的流式输出尾部
    output: index >= 0 ? current[index].output : undefined,
    // UI-315 优化 — exec 终端块：完整命令 + shell 标签（result 事件 data.shell 派生）
    command: index >= 0 ? current[index].command : undefined,
    shellLabel: (result && result.shellLabel) || resultShellLabel || (index >= 0 ? current[index].shellLabel : undefined),
    // BLOCK-247（Q2b）— 联网来源标签：后端顶层下发（结果多时被 publicData 换 preview 也不丢）
    sourceLabel: (result && typeof result.sourceLabel === 'string' ? result.sourceLabel : undefined)
      || deriveSourceLabel(name, result?.data)
      || (index >= 0 ? current[index].sourceLabel : undefined),
    actionLabel: index >= 0 ? current[index].actionLabel : fallbackAction.actionLabel,
    actionDetail: index >= 0 ? current[index].actionDetail : fallbackAction.actionDetail,
    agentRunId: resultAgentRunId || (index >= 0 ? current[index].agentRunId : undefined),
    // UI-437 v5.6 — 结果数据本体（后端 publicData 已界定的 bounded 版本），供展开详情
    // UI-437 v5.6 修复 — resultData 是本次结果新到的数据，不能走「保留旧值」分支
    resultData: result?.data,
    // BLOCK-243 — 审批卡载荷（顶层，独立于 data 截断）；旧事件无该字段时保留既有值
    approval: parseToolApproval(result?.approval) ?? (index >= 0 ? current[index].approval : undefined),
    // BLOCK-244 — 结构化提问载荷（回答事件会用同一 callId 覆盖）
    question: parseUserQuestion(result?.question) ?? (index >= 0 ? current[index].question : undefined),
  };

  if (index < 0) return [...current, item];
  const next = current.slice();
  next[index] = { ...current[index], ...item };
  return next;
}

export function formatToolDuration(durationMs?: number): string | null {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) return null;
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(durationMs < 10_000 ? 1 : 0)} s`;
  const roundedSeconds = Math.round(seconds);
  const minutes = Math.floor(roundedSeconds / 60);
  const remainingSeconds = roundedSeconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function formatToolSideEffects(sideEffects?: ToolSideEffects): string | null {
  if (!sideEffects || sideEffects.type === 'none') return null;
  const resources = sideEffects.resources.length > 0
    ? ` · ${sideEffects.resources.join(', ')}`
    : '';
  return `${sideEffects.type} · ${sideEffects.riskTier}${resources}`;
}

/** UI-383 — 常规只读工具：成功时折叠为汇总行（错误/运行中/等待确认仍独立可见）。 */
const ROUTINE_READ_TOOLS: ReadonlySet<string> = new Set([
  'workspace_read',
  'workspace_list',
  'workspace_find',
  'workspace_search',
  'system_info',
]);

function isRoutineReadActivity(activity: ToolActivityItem): boolean {
  return ROUTINE_READ_TOOLS.has(activity.name) && activity.status === 'success';
}

export interface ToolActivityGroup {
  kind: 'activity' | 'routine';
  items: ToolActivityItem[];
}

/**
 * UI-383 — 连续的常规只读成功项归并为一组（同迭代内；跨迭代/遇非常规项即断开）。
 * 折叠渲染阈值（≥3 项）由视图层决定。
 */
export function groupToolActivities(activities: ToolActivityItem[]): ToolActivityGroup[] {
  const groups: ToolActivityGroup[] = [];
  let current: ToolActivityGroup | null = null;
  let currentIteration: number | undefined;
  for (const activity of activities) {
    const routine = isRoutineReadActivity(activity);
    const iterChanged = activity.iteration !== currentIteration;
    if (routine && current && current.kind === 'routine' && !iterChanged) {
      current.items.push(activity);
      continue;
    }
    currentIteration = activity.iteration;
    current = { kind: routine ? 'routine' : 'activity', items: [activity] };
    groups.push(current);
  }
  return groups;
}

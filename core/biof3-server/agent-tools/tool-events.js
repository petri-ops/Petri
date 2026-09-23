'use strict';

const { redactSensitiveValue } = require('../../shared-backend/redaction');

const PUBLIC_DATA_LIMIT = 1600;

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function publicData(data) {
  const redacted = redactSensitiveValue(data);
  const serialized = safeJson(redacted);
  if (serialized.length <= PUBLIC_DATA_LIMIT) return { data: redacted, truncated: false };
  return {
    data: { preview: `${serialized.slice(0, PUBLIC_DATA_LIMIT)}…` },
    truncated: true,
  };
}

// UI-273 增补 — 写操作的逐行改动（统计 + 截断 hunks）。挂在 toolResult 顶层而非 data 内：
// data 受 PUBLIC_DATA_LIMIT 截断，超限会被整体替换为 preview 字符串，diff 必须独立存活。
const CHANGE_DIFF_LIMIT = 4000;

function boundedChangeDiff(result) {
  if (!result || typeof result !== 'object') return undefined;
  const raw = result.changeDiff;
  if (!raw || typeof raw !== 'object') return undefined;
  const added = Number.isFinite(raw.added) ? raw.added : 0;
  const removed = Number.isFinite(raw.removed) ? raw.removed : 0;
  const hunks = Array.isArray(raw.hunks) ? raw.hunks : [];
  const base = { added, removed, truncated: raw.truncated === true, hunks };
  if (safeJson(base).length <= CHANGE_DIFF_LIMIT) return base;
  // 超限：保留诚实统计，丢弃精细 hunks
  return { added, removed, truncated: true, hunks: [] };
}

function buildToolCallEvent({ name, args, traceId, callId, iteration }) {
  return {
    event: 'tool_call',
    name,
    args: redactSensitiveValue(args || {}),
    traceId,
    callId,
    ...(Number.isFinite(iteration) ? { iteration } : {}),
  };
}

/** UI-437 v5.5 — 对象结果摘要（top-3 键）：数组=「N 条」/字符串=截 24 字/原始值=字面。
 *  ok/error 是执行回执样板不是内容，剔除。取代对象结果一律 'ok' 的旧口径。 */
function summarizeResultObject(obj) {
  const parts = [];
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'ok' || key === 'error' || typeof value === 'function') continue;
    let rendered;
    if (Array.isArray(value)) rendered = `${value.length} 条`;
    else if (typeof value === 'string') rendered = value.replace(/\s+/g, ' ').trim().slice(0, 24) || '""';
    else if (typeof value === 'number' || typeof value === 'boolean') rendered = String(value);
    else rendered = '{…}';
    parts.push(`${key} ${rendered}`);
    if (parts.length >= 3) break;
  }
  return parts.join(' · ');
}

function buildToolResultEvent(envelope, args = {}, options = {}) {
  const result = envelope.data;
  const published = publicData(result);
  const summary = result && typeof result === 'object'
    ? Array.isArray(result)
      ? `返回 ${result.length} 条`
      : result.error
        ? `错误: ${result.error}`
        : summarizeResultObject(result) || 'ok'
    : String(result);
  const evt = {
    event: 'tool_result',
    name: envelope.tool,
    summary,
    ...(Number.isFinite(options.iteration) ? { iteration: options.iteration } : {}),
    toolResult: {
      contractVersion: envelope.contractVersion,
      traceId: envelope.traceId,
      callId: envelope.callId,
      tool: envelope.tool,
      status: envelope.status,
      terminationReason: envelope.terminationReason,
      durationMs: envelope.durationMs,
      // `status` is the execution outcome. These flags describe bounded
      // representations of a result and must not be treated as a tool failure
      // by clients.
      sourceTruncated: Boolean(envelope.truncated),
      previewTruncated: Boolean(published.truncated),
      truncated: Boolean(envelope.truncated || published.truncated),
      sideEffects: envelope.sideEffects,
      data: published.data,
      // UI-273 — 写操作逐行改动（独立于 data，规避 publicData 截断）
      ...(boundedChangeDiff(result) ? { changeDiff: boundedChangeDiff(result) } : {}),
      // UI-315 优化 — exec 实际使用的 shell 短标签（独立于 data，规避
      // publicData 把 data 换成 preview 后丢失；前端头行展示）
      ...(result && typeof result.shell === 'string'
        ? { shellLabel: shellLabelFromPath(result.shell) }
        : {}),
    },
  };

  if (envelope.tool === 'act' && result && typeof result === 'object') {
    if (result.undoToken) evt.undoToken = result.undoToken;
    if (result.undoableUntil) evt.undoableUntil = result.undoableUntil;
    if (result.message) evt.message = result.message;
    if (result.error) evt.actError = result.error;
    if (args.type) evt.actType = args.type;
    if (result.analysisId) evt.analysisId = result.analysisId;
    if (result.taskId) evt.taskId = result.taskId;
    if (result.ackToken) evt.ackToken = result.ackToken;
    if (result.type === 'update_figcode_editor' && result.code) {
      evt.figcodeCode = result.code;
      evt.figcodeAutoRun = result.autoRun !== false;
    }
    if (result.type === 'switch_result_tab') evt.scTab = result.tab;
    if (result.type === 'focus_cluster') evt.scCluster = result.cluster;
    if (result.type === 'highlight_gene') evt.scGene = result.gene;
    if (['select_cells', 'filter_table', 'label_cells'].includes(result.type) && result.columnFilters) {
      evt.scColumnFilters = result.columnFilters;
    }
    if (result.type === 'select_cells') evt.scSubsetName = result.subsetName || null;
    if (result.type === 'label_cells') {
      evt.scLabelKey = result.labelKey;
      evt.scLabelValue = result.labelValue;
    }
    if (result.type === 'merge_datasets') {
      evt.scDatasetIds = result.datasetIds;
      evt.scMergeName = result.mergeName || null;
    }
    if (result.type === 'open_replot') evt.scOpenReplotForAnalysis = result.analysisId;
    if (result.type === 'upload_data_hint') evt.scUploadHint = true;
    if (result.type === 'open_figcode_plot') evt.figcardId = result.figcardId;
    if (result.type === 'open_tool' && result.toolId) evt.toolId = result.toolId;
  }

  if (envelope.tool === 'run_tool' && result && typeof result === 'object') {
    if (result.needApproval) {
      evt.needApproval = true;
      if (result.ackToken) evt.ackToken = result.ackToken;
      if (result.toolJobId) evt.toolJobId = result.toolJobId;
      if (result.toolId) evt.toolId = result.toolId;
      if (result.message) evt.message = result.message;
      if (result.params) evt.params = redactSensitiveValue(result.params);
    } else if (result.toolJobId) {
      evt.toolJobId = result.toolJobId;
      if (result.toolId) evt.toolId = result.toolId;
      if (result.message || result.error) evt.message = String(result.message || result.error);
    }
  }

  return redactSensitiveValue(evt);
}

function compactActivityDetail(value) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  return normalized.length > 140 ? `${normalized.slice(0, 137)}…` : normalized;
}

// ===== BLOCK-33 P3 — workspace_exec 流式输出（tool_output SSE 事件） =====

const TOOL_OUTPUT_INTERVAL_MS = 200;
// 单次工具调用流式输出的总字符封顶；超出后发一次 truncated 标记并丢弃后续增量。
const TOOL_OUTPUT_MAX_CHARS = 16000;

/**
 * 构造 tool_output SSE 事件（callId 关联到对应 tool_call / tool_result）。
 * text 已经过脱敏；事件本身再整体脱敏一次，与 tool_call/tool_result 对齐。
 */
function buildToolOutputEvent({ name, callId, traceId, iteration, text, truncated }) {
  return redactSensitiveValue({
    event: 'tool_output',
    name,
    callId,
    traceId,
    ...(Number.isFinite(iteration) ? { iteration } : {}),
    text: String(text || ''),
    ...(truncated ? { truncated: true } : {}),
  });
}

/**
 * 创建工具输出流式发射器：聚合增量、按 TOOL_OUTPUT_INTERVAL_MS 节流、
 * 总量封顶 TOOL_OUTPUT_MAX_CHARS。返回 onOutput(chunk) 回调（chunk 形如
 * { stream: 'stdout' | 'stderr', text }) 与 flush()（命令结束后冲刷剩余缓冲）。
 * 非 workspace_exec 工具或未提供 emit 时返回 no-op。
 */function createToolOutputStream({ name, callId, traceId, iteration, emit, intervalMs = TOOL_OUTPUT_INTERVAL_MS, maxChars = TOOL_OUTPUT_MAX_CHARS }) {
  if (!emit || name !== 'workspace_exec' || !callId) {
    return { onOutput: () => {}, flush: () => {} };
  }
  const limit = Math.max(256, Number(maxChars) || TOOL_OUTPUT_MAX_CHARS);
  const interval = Math.max(50, Number(intervalMs) || TOOL_OUTPUT_INTERVAL_MS);
  let buffer = '';
  let emittedChars = 0;
  let truncatedSent = false;
  let timer = null;

  const send = (text, truncated) => {
    if (!text) return;
    try {
      emit(buildToolOutputEvent({ name, callId, traceId, iteration, text, truncated }));
    } catch {
      // SSE 发送失败不阻塞工具执行
    }
  };

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (truncatedSent) return;
    if (buffer) {
      send(buffer, false);
      buffer = '';
    }
  };

  const onOutput = (chunk) => {
    if (truncatedSent || !chunk || typeof chunk.text !== 'string' || !chunk.text) return;
    if (emittedChars >= limit) return;
    buffer += chunk.text;
    emittedChars += chunk.text.length;
    if (emittedChars >= limit) {
      // 封顶：本次冲刷后发 truncated 标记，后续增量丢弃
      const room = Math.max(0, limit - (emittedChars - buffer.length));
      send(buffer.slice(0, room), false);
      buffer = '';
      truncatedSent = true;
      send('…（输出超出流式上限，已截断）', true);
      return;
    }
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (truncatedSent || !buffer) return;
      send(buffer, false);
      buffer = '';
    }, interval);
  };

  return { onOutput, flush };
}

// ===== UI-384 — 只读工具结果内容镜像 =====
// workspace_read/list/find/search 是一次性返回（无流式增量），此前行详情输出块
// 恒空——模型收到了内容但前端没有任何渲染。这里把结果格式化为有界纯文本尾部，
// 由 loop-orchestrator 走与 exec 相同的 tool_output 事件 + 活动快照镜像
// （recordOutput），前端零改动点亮行详情输出块，历史会话可回放。

const RESULT_OUTPUT_TOOLS = new Set(['workspace_read', 'workspace_list', 'workspace_find', 'workspace_search']);
const RESULT_OUTPUT_MAX_CHARS = 1500;

function formatResultBytes(sizeBytes) {
  const n = Number(sizeBytes);
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function truncateResultText(text) {
  if (text.length <= RESULT_OUTPUT_MAX_CHARS) return { text, truncated: false };
  return { text: `${text.slice(0, RESULT_OUTPUT_MAX_CHARS)}\n…（内容已截断）`, truncated: true };
}

/**
 * 把只读工具的一次性结果格式化为用户可读的输出尾部文本。
 * 返回 { text, truncated }；非目标工具 / 错误结果返回 undefined。
 */
function buildResultOutputText(name, result) {
  if (!RESULT_OUTPUT_TOOLS.has(name)) return undefined;
  if (!result || typeof result !== 'object' || result.ok !== true) return undefined;
  let body = '';
  if (name === 'workspace_read') {
    const total = Number.isFinite(result.totalLines) ? result.totalLines : '?';
    const head = `[读取 ${result.path || ''} · 第 ${result.startLine ?? '?'}-${result.endLine ?? '?'} 行 / 共 ${total} 行]`;
    const content = String(result.content ?? '');
    body = content.length > 0 ? `${head}\n${content}` : `${head}\n（空文件或空区间）`;
  } else if (name === 'workspace_list') {
    const entries = Array.isArray(result.entries) ? result.entries : [];
    const lines = entries.map((e) => {
      if (!e || typeof e !== 'object') return '';
      const size = e.type === 'file' && Number.isFinite(e.sizeBytes) ? `（${formatResultBytes(e.sizeBytes)}）` : '';
      return `- ${e.name || e.path || '?'}${e.type === 'directory' ? '/' : ''}${size}`;
    }).filter(Boolean);
    body = `[目录 ${result.path || '.'}${result.truncated ? ' · 已截断' : ''}]\n${lines.length > 0 ? lines.join('\n') : '（空目录）'}`;
  } else if (name === 'workspace_find') {
    const matches = Array.isArray(result.matches) ? result.matches : [];
    const lines = matches.map((m) => {
      if (!m || typeof m !== 'object') return '';
      const size = Number.isFinite(m.sizeBytes) ? `（${formatResultBytes(m.sizeBytes)}）` : '';
      return `- ${m.path || '?'}${size}`;
    }).filter(Boolean);
    const scanned = Number.isFinite(result.filesScanned) ? ` · 扫描 ${result.filesScanned} 个文件` : '';
    body = `[查找 ${result.pattern || '*'} · 命中 ${matches.length}${result.truncated ? '（已截断）' : ''}${scanned}]\n${lines.length > 0 ? lines.join('\n') : '（无匹配）'}`;
  } else if (name === 'workspace_search') {
    const matches = Array.isArray(result.matches) ? result.matches : [];
    const lines = matches.map((m) => {
      if (!m || typeof m !== 'object') return '';
      return `${m.path || '?'}:${m.line ?? '?'}: ${String(m.text || '').slice(0, 200)}`;
    }).filter(Boolean);
    const scanned = Number.isFinite(result.filesScanned) ? ` · 扫描 ${result.filesScanned} 个文件` : '';
    body = `[搜索 "${result.query || ''}" · 命中 ${matches.length}${result.truncated ? '（已截断）' : ''}${scanned}]\n${lines.length > 0 ? lines.join('\n') : '（无匹配）'}`;
  }
  if (!body) return undefined;
  return truncateResultText(body);
}

/**
 * UI-384 — 只读结果内容镜像发射器：buildResultOutputText 的结果走 tool_output
 * 事件 + recordOutput 快照镜像（与 exec 流式输出同一管道；前端行详情输出块
 * 点亮，随 meta 落库历史可回放）。内部 fail-safe：任何异常不阻塞工具结果下发。
 * 返回 true 表示已发射。
 */
function emitReadOnlyResultOutput({ name, result, callId, traceId, iteration, emit, recordOutput }) {
  try {
    const output = buildResultOutputText(name, result);
    if (!output || !output.text) return false;
    const evt = buildToolOutputEvent({
      name,
      callId,
      traceId,
      ...(Number.isFinite(iteration) ? { iteration } : {}),
      text: output.text,
      truncated: output.truncated === true,
    });
    emit(evt);
    if (typeof recordOutput === 'function') {
      recordOutput({ name, callId, traceId, text: evt.text, truncated: evt.truncated === true });
    }
    return true;
  } catch {
    return false;
  }
}

/** UI-437 v5.18 — 工具动词注册表（全量 71 静态工具，契约测试
 *  test/tool-activity-labels.test.mjs 经 test/fixtures/tool-activity-labels.json
 *  逐工具钉住）。行头动词 = 「已×」规范态，宾语由 actionDetail 承载；
 *  未登记（MCP/插件动态工具）回退「已调用」。 */
const TOOL_ACTIVITY_VERBS = Object.freeze({
  "act": "已变更",
  "artifact_revision_list": "已列出",
  "artifact_revision_restore": "已恢复",
  "computer_authorize": "已授权",
  "computer_click": "已点击",
  "computer_press": "已按键",
  "computer_screenshot": "已截屏",
  "computer_scroll": "已滚动",
  "computer_snapshot": "已取快照",
  "computer_type": "已输入",
  "computer_wait": "已等待",
  "delegate_to_gewu_node": "已委派",
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
  "plan": "已规划",
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
  "run_tool": "已运行",
  "search": "已搜索",
  "send_message": "已发送",
  "spawn_agent": "已派发",
  "system_info": "已查询",
  "todo_write": "已记录",
  "verify_state": "已校验",
  "wait_agent": "已等待",
  "workspace_exec": "已运行",
  "workspace_exec_background": "后台运行",
  "workspace_find": "已查找",
  "workspace_list": "已列出",
  "workspace_read": "已读取",
  "workspace_replace": "已替换",
  "workspace_search": "已搜索",
  "workspace_write": "已写入",
});

/** Safe, compact activity details suitable for conversation metadata. */
function summarizeToolCallSwitch(name, args = {}) {
  switch (name) {
    case 'workspace_exec':
      return { actionLabel: '已运行', actionDetail: compactActivityDetail(args.command) || '命令' };
    // BLOCK-33 P4 — 后台进程三件套
    case 'workspace_exec_background':
      return { actionLabel: '后台运行', actionDetail: compactActivityDetail(args.command) || '命令' };
    case 'process_status':
      return { actionLabel: '查询后台进程', actionDetail: compactActivityDetail(args.processId) || '全部' };
    case 'process_stop':
      return { actionLabel: '停止后台进程', actionDetail: compactActivityDetail(args.processId) || '进程' };
    case 'workspace_read': {
      const path = compactActivityDetail(args.path) || '文件';
      const start = Number.isInteger(args.startLine) ? ` · 第 ${args.startLine} 行起` : '';
      return { actionLabel: '已读取', actionDetail: `${path}${start}` };
    }
    case 'workspace_list':
      return { actionLabel: '已读取', actionDetail: `目录 ${compactActivityDetail(args.path) || '.'}` };
    case 'workspace_find':
      return { actionLabel: '已查找', actionDetail: compactActivityDetail(args.pattern) || '文件' };
    case 'workspace_search':
      return { actionLabel: '已搜索', actionDetail: compactActivityDetail(args.query) || '文本' };
    case 'workspace_write':
    case 'workspace_replace':
      return { actionLabel: '已修改', actionDetail: compactActivityDetail(args.path) || '文件' };
    case 'run_tool':
      return { actionLabel: '已运行', actionDetail: compactActivityDetail(args.toolId) || '分析工具' };
    // UI-437 v5.18 — 高频工具的定制宾语（default 参数摘要对这些太噪）：
    case 'knowledge_search':
      return { actionLabel: TOOL_ACTIVITY_VERBS.knowledge_search, actionDetail: compactActivityDetail(args.query) || '知识空间' };
    case 'todo_write':
      return { actionLabel: TOOL_ACTIVITY_VERBS.todo_write, actionDetail: '任务清单' };
    case 'spawn_agent':
      return { actionLabel: TOOL_ACTIVITY_VERBS.spawn_agent, actionDetail: compactActivityDetail(args.task) || '子智能体' };
    case 'followup_task':
      return { actionLabel: TOOL_ACTIVITY_VERBS.followup_task, actionDetail: compactActivityDetail(args.task) || '后续任务' };
    case 'send_message':
      return { actionLabel: TOOL_ACTIVITY_VERBS.send_message, actionDetail: compactActivityDetail(args.agentId) || '子智能体' };
    case 'wait_agent':
    case 'interrupt_agent':
      return { actionLabel: TOOL_ACTIVITY_VERBS[name], actionDetail: compactActivityDetail(args.agentId) || '子智能体' };
    case 'list_agents':
      return { actionLabel: TOOL_ACTIVITY_VERBS.list_agents, actionDetail: '子智能体' };
    case 'resident_task_create':
      return { actionLabel: TOOL_ACTIVITY_VERBS.resident_task_create, actionDetail: compactActivityDetail(args.command) || '常驻任务' };
    case 'search':
      return { actionLabel: TOOL_ACTIVITY_VERBS.search, actionDetail: compactActivityDetail(args.q) || '网络' };
    case 'read_page':
      return { actionLabel: TOOL_ACTIVITY_VERBS.read_page, actionDetail: compactActivityDetail(args.url) || '网页' };
    case 'read_image':
      return { actionLabel: TOOL_ACTIVITY_VERBS.read_image, actionDetail: compactActivityDetail(args.filePath || args.toolJobId) || '图像' };
    case 'delegate_to_gewu_node':
      return { actionLabel: TOOL_ACTIVITY_VERBS.delegate_to_gewu_node, actionDetail: compactActivityDetail(args.task) || '协作节点' };
    default: {
      // UI-437 v5.18 — 已登记工具：动词取注册表、detail 用参数摘要（无工具名
      // 前缀，与登记工具同构）；未登记（MCP/插件动态工具）保持
      // 「已调用 name（参数摘要）」兜底。
      const verb = TOOL_ACTIVITY_VERBS[name];
      const parts = [];
      for (const [key, value] of Object.entries(args || {})) {
        let rendered;
        if (typeof value === 'string') rendered = compactActivityDetail(value) || '';
        else if (value == null) rendered = '';
        else {
          try {
            rendered = compactActivityDetail(JSON.stringify(value)) || '';
          } catch {
            rendered = '';
          }
        }
        if (!rendered) continue;
        parts.push(`${key}=${rendered}`);
        if (parts.length >= 3) break;
      }
      if (verb) return { actionLabel: verb, actionDetail: parts.join(' · ') || name };
      return { actionLabel: '已调用', actionDetail: parts.length ? `${name}（${parts.join(' · ')}）` : name };
    }
  }
}

/** UI-437 v5.18 — 标签唯一真源 = TOOL_ACTIVITY_VERBS：switch 只负责 detail
 *  构造，动词统一由注册表覆盖（switch 内联 label 仅为注册表缺项时的兜底）。 */
function summarizeToolCallForActivity(name, args = {}) {
  const result = summarizeToolCallSwitch(name, args);
  const verb = TOOL_ACTIVITY_VERBS[name];
  return verb ? { ...result, actionLabel: verb } : result;
}


function shellLabelFromPath(executable) {
  const base = String(executable || '').split(/[\\/|]/).pop() || '';
  const lower = base.toLowerCase().replace(/\.exe$/, '');
  if (lower === 'cmd') return 'cmd';
  if (lower.startsWith('powershell') || lower === 'pwsh') return 'powershell';
  if (lower === 'wsl') return 'wsl';
  return lower.slice(0, 16);
}

function createToolActivityRecorder() {
  const items = [];

  // UI-315 — exec 类工具的完整命令（bounded），随活动快照落库供历史会话
  // 的终端块回放；非 exec 工具不记录（体积/隐私边界）。
  const EXEC_TOOL_NAMES = new Set(['workspace_exec', 'workspace_exec_background']);
  const COMMAND_SNAPSHOT_CHARS = 400;
  const OUTPUT_SNAPSHOT_CHARS = 2000;

  function recordCall({ name, args, traceId, callId, iteration }) {
    const summary = summarizeToolCallForActivity(name, args);
    const command = EXEC_TOOL_NAMES.has(name)
      && args && typeof args.command === 'string' && args.command.trim()
      ? args.command.trim().slice(0, COMMAND_SNAPSHOT_CHARS)
      : undefined;
    items.push({
      key: callId || `${traceId || 'legacy'}:${name}:${items.length + 1}`,
      callId,
      traceId,
      ...(Number.isFinite(iteration) ? { iteration } : {}),
      name,
      status: 'running',
      ...(command ? { command } : {}),
      ...summary,
    });
  }

  /**
   * UI-315 — exec 输出尾部随活动快照落库（前端 tool_output 增量的服务端
   * 镜像，cap 2000 字符对齐前端 tail）。按 callId 关联；无匹配项时忽略
   * （迟到/乱序输出）。
   */
  function recordOutput({ name, callId, text, truncated }) {
    if (!text) return;
    let index = callId ? items.findIndex((item) => item.callId === callId) : -1;
    if (index < 0) {
      for (let i = items.length - 1; i >= 0; i -= 1) {
        if (items[i].name === name && items[i].status === 'running') {
          index = i;
          break;
        }
      }
    }
    if (index < 0) return;
    const existing = items[index];
    const previous = existing.output && existing.output.tail ? existing.output.tail : '';
    let tail = previous + text;
    if (tail.length > OUTPUT_SNAPSHOT_CHARS) {
      tail = `…${tail.slice(-(OUTPUT_SNAPSHOT_CHARS - 1))}`;
    }
    existing.output = {
      tail,
      truncated: Boolean(existing.output && existing.output.truncated) || truncated === true,
    };
  }

  function recordResult(event) {
    const result = event && event.toolResult ? event.toolResult : {};
    const name = result.tool || event.name || 'tool';
    let index = result.callId
      ? items.findIndex((item) => item.callId === result.callId)
      : -1;
    if (index < 0) {
      for (let i = items.length - 1; i >= 0; i -= 1) {
        if (items[i].name === name && items[i].status === 'running') {
          index = i;
          break;
        }
      }
    }
    const existing = index >= 0 ? items[index] : null;
    // UI-382 — spawn/wait/list agent 结果携带 agentId：随活动快照落库，
    // 历史重建（5s 对账/重载）后内联实况卡与「详情窗」入口才能恢复。
    const resultAgentData = result.data && typeof result.data === 'object' ? result.data : null;
    const resultAgentRunId =
      (name === 'spawn_agent' || name === 'wait_agent' || name === 'list_agents')
      && resultAgentData && typeof resultAgentData.agentId === 'string'
        ? resultAgentData.agentId
        : undefined;
    const next = {
      key: existing ? existing.key : (result.callId || `${result.traceId || 'legacy'}:${name}:${items.length + 1}`),
      toolJobId: event.toolJobId || (existing && existing.toolJobId),
      toolId: event.toolId || (existing && existing.toolId),
      callId: result.callId || (existing && existing.callId),
      traceId: result.traceId || (existing && existing.traceId),
      iteration: Number.isFinite(event.iteration)
        ? event.iteration
        : (existing && existing.iteration),
      name,
      status: result.terminationReason === 'approval_required'
        ? 'awaiting_confirmation'
        : result.status || (event.summary && /^错误[:：]/.test(event.summary) ? 'error' : 'success'),
      durationMs: result.durationMs,
      sourceTruncated: result.sourceTruncated,
      previewTruncated: result.previewTruncated,
      truncated: result.truncated,
      terminationReason: result.terminationReason,
      sideEffects: result.sideEffects,
      // UI-273 — 写操作逐行改动随活动快照落库（历史会话展开执行记录可回看）
      changeDiff: result.changeDiff && typeof result.changeDiff === 'object'
        ? {
            added: Number.isFinite(result.changeDiff.added) ? result.changeDiff.added : 0,
            removed: Number.isFinite(result.changeDiff.removed) ? result.changeDiff.removed : 0,
            truncated: result.changeDiff.truncated === true,
            hunks: Array.isArray(result.changeDiff.hunks) ? result.changeDiff.hunks.slice(0, 20) : [],
          }
        : undefined,
      // UI-315 优化 — exec 实际使用的 shell 标签（头行展示）
      shellLabel: result.shellLabel || (existing ? existing.shellLabel : undefined),
      agentRunId: resultAgentRunId || (existing ? existing.agentRunId : undefined),
      // UI-437 v5.6 — 结果数据本体（publicData bounded）随活动快照落库，历史展开可回看
      resultData: result.data,
      summary: event.summary,
      actionLabel: existing ? existing.actionLabel : summarizeToolCallForActivity(name).actionLabel,
      actionDetail: existing ? existing.actionDetail : summarizeToolCallForActivity(name).actionDetail,
      // UI-315 — 终端块：recordCall 捕获的完整命令 + recordOutput 累积的输出尾部
      command: existing ? existing.command : undefined,
      output: existing ? existing.output : undefined,
    };
    if (index < 0) items.push(next);
    else items[index] = next;
  }

  return {
    recordCall,
    recordOutput,
    recordResult,
    snapshot: () => items.slice(0, 100),
  };
}

module.exports = {
  TOOL_OUTPUT_INTERVAL_MS,
  TOOL_OUTPUT_MAX_CHARS,
  RESULT_OUTPUT_TOOLS,
  TOOL_ACTIVITY_VERBS,
  buildToolCallEvent,
  buildToolOutputEvent,
  buildToolResultEvent,
  buildResultOutputText,
  emitReadOnlyResultOutput,
  createToolOutputStream,
  summarizeToolCallForActivity,
  createToolActivityRecorder,
};

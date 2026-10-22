// ============================================================
// contextSources.ts — BLOCK-245 P3「`@` 候选同源聚合」纯函数层
//
// 八类候选（文件·文件夹 / 技能 / MCP 连接器 / Agent·子任务 / 结果产物 /
// 知识空间 / 历史会话）在**同一张表**里产出同一种东西：`ContextCandidate`，
// 它只包一个 `ComposerContextItem`——即 P2 收敛后的唯一注入形状。
//
// 纪律（写在类型里，不写在注释里）：
//   ① 本层不碰 React、不碰 fetch、不碰事件——调用方（hooks/useContextSources）
//      负责装载真实数据面，本层只做「原始行 → 候选 + 逐项上限 + 不可用原因」；
//   ② **不建第四注入通道**：候选只产 ComposerContextItem，不产文本模板；
//      （`slashSources.slashIntentTemplate` 那种文本注入属斜杠通道，不复用）；
//   ③ 源不可用必须留下**可读原因**，绝不静默吞成空列表（与 P5 超限诚实化同旨）。
// ============================================================

import type { ComposerContextItem } from './contextItems';

/** 八类候选源里可由 `@` 菜单提供的那七类（selection/image/attachment 走既有事件面）。 */
export type ContextSourceId =
  | 'file'
  | 'skill'
  | 'connector'
  | 'agent'
  | 'artifact'
  | 'knowledge'
  | 'conversation';

/** 展示与键盘导航的固定次序（分组顺序=本数组顺序，不随装载完成先后漂移）。 */
export const CONTEXT_SOURCE_ORDER: ContextSourceId[] = [
  'file',
  'skill',
  'connector',
  'agent',
  'artifact',
  'knowledge',
  'conversation',
];

/** 来源标签（菜单分组头 + 候选行右侧的源标记，一条真相）。 */
export const CONTEXT_SOURCE_LABELS: Record<ContextSourceId, string> = {
  file: '文件',
  skill: '技能',
  connector: '连接器',
  agent: '智能体',
  artifact: '结果',
  knowledge: '知识空间',
  conversation: '会话',
};

/** 逐项上限（「逐源有界」的可见形态：超出即截断并报条数，不静默丢）。 */
export const CONTEXT_SOURCE_CAPS: Record<ContextSourceId, number> = {
  file: 12,
  skill: 6,
  connector: 6,
  agent: 6,
  artifact: 6,
  knowledge: 4,
  conversation: 6,
};

/** 单源绝对硬上限（装载面防御：即便端点返回上万行也不进内存无限膨胀）。 */
export const CONTEXT_SOURCE_HARD_LIMIT = 200;

export interface ContextCandidate {
  /** 全局唯一键：`<sourceId>:<rawId>`（React key / 键盘导航定位）。 */
  id: string;
  sourceId: ContextSourceId;
  /** chip 主标题。 */
  label: string;
  /** 次行细节（类型/状态/大小/消息数…）。 */
  detail: string;
  /** 选中后进入 composer 的唯一形状。 */
  item: ComposerContextItem;
}

export interface ContextSourceResult {
  sourceId: ContextSourceId;
  label: string;
  /** 已装载的候选（未过滤；长度 ≤ CONTEXT_SOURCE_HARD_LIMIT）。 */
  candidates: ContextCandidate[];
  /** 源整体不可用时的可读原因；null = 可用（可能是真零结果）。 */
  unavailableReason: string | null;
  /** 源可用但结果有界时的提示（如工作区树 500 条上限被根层耗尽）；null = 无提示。 */
  note: string | null;
  /** 过滤后因逐项上限被藏的条数（0 = 全展示）。 */
  truncated: number;
}

/** 全角【】引用头（服务端 cleanContent 会剥行首半角 `[...]`，见 P1 基线纪律）。 */
function referenceLines(title: string, rows: Array<[string, string]>): string[] {
  return [
    `【引用${title}】`,
    ...rows.filter(([, value]) => value !== '').map(([key, value]) => `> ${key}：${value}`),
  ];
}

function clampHard(list: ContextCandidate[]): ContextCandidate[] {
  return list.length > CONTEXT_SOURCE_HARD_LIMIT ? list.slice(0, CONTEXT_SOURCE_HARD_LIMIT) : list;
}

function sourceResult(
  sourceId: ContextSourceId,
  candidates: ContextCandidate[],
  unavailableReason: string | null = null,
  note: string | null = null,
): ContextSourceResult {
  return {
    sourceId,
    label: CONTEXT_SOURCE_LABELS[sourceId],
    candidates: clampHard(candidates),
    unavailableReason,
    note,
    truncated: 0,
  };
}

/** 源不可用的统一造法（hook 的 catch 分支与「未配置」分支共用）。 */
export function unavailableContextSource(sourceId: ContextSourceId, reason: string): ContextSourceResult {
  return sourceResult(sourceId, [], reason || '来源不可用');
}

/** 源可用但结果有界：保留候选 + 一条可读提示（不谎称全量）。 */
export function noteContextSource(
  sourceId: ContextSourceId,
  candidates: ContextCandidate[],
  note: string | null,
): ContextSourceResult {
  return sourceResult(sourceId, candidates, null, note);
}

// ── 文件 / 文件夹 ─────────────────────────────────────────────
/** 工作区树行（`GET /api/workspaces/:id/tree`，recursive=1 时带 workspace 相对 path）。 */
export interface WorkspaceTreeRow {
  name: string;
  type: 'dir' | 'file';
  size?: number;
  modifiedAt?: number;
  path?: string;
}

export function buildFileCandidates(
  rows: WorkspaceTreeRow[],
  options: { prefix?: string; includeHidden?: boolean; treeTruncated?: boolean } = {},
): ContextSourceResult {
  const prefix = options.prefix ?? '';
  const candidates: ContextCandidate[] = [];
  for (const row of rows) {
    if (!row || typeof row.name !== 'string' || !row.name) continue;
    // 隐藏项（含 `.chat-attachments`）默认不进候选：它们是内部落点，不是用户的上下文。
    if (!options.includeHidden && row.name.startsWith('.')) continue;
    const path = row.path ?? `${prefix}${row.name}`;
    const isDir = row.type === 'dir';
    const title = isDir ? '目录' : '文件';
    const sizeLabel = !isDir && typeof row.size === 'number' && row.size >= 0
      ? `${(row.size / 1024).toFixed(1)}KB`
      : '';
    candidates.push({
      id: `file:${path}`,
      sourceId: 'file',
      label: path,
      detail: isDir ? '目录' : (sizeLabel || '文件'),
      item: {
        id: `ctx-file-${path}`,
        kind: 'file',
        group: 'reference',
        label: path,
        source: CONTEXT_SOURCE_LABELS.file,
        lines: referenceLines(title, [['path', path]]),
        dedupeKey: `file|${path}`,
        payload: { path, type: isDir ? 'dir' : 'file', size: row.size ?? 0 },
      },
    });
  }
  // 服务端 recursive 面有 500 条上限（根层优先消耗）：被截断就如实说明，不装作全量。
  return noteContextSource(
    'file',
    candidates,
    options.treeTruncated ? '工作区较大：候选只覆盖前 500 项（根层优先），更深文件可用 @ 加路径前缀缩小范围' : null,
  );
}

// ── 产品 Skills ───────────────────────────────────────────────
/** 技能行（来源=slashSources 的 SlashEntry，kind 固定 'skill'）。 */
export interface SkillRow {
  kind: string;
  id: string;
  label: string;
  description: string;
}

export function buildSkillCandidates(rows: SkillRow[]): ContextSourceResult {
  const candidates: ContextCandidate[] = [];
  for (const row of rows) {
    if (!row || row.kind !== 'skill' || !row.id) continue;
    candidates.push({
      id: `skill:${row.id}`,
      sourceId: 'skill',
      label: row.label || row.id,
      detail: row.description || '产品技能',
      item: {
        id: `ctx-skill-${row.id}`,
        kind: 'skill',
        group: 'reference',
        label: row.label || row.id,
        source: CONTEXT_SOURCE_LABELS.skill,
        lines: referenceLines('技能', [
          ['技能', row.id],
          ['说明', row.description || ''],
        ]),
        dedupeKey: `skill|${row.id}`,
        payload: { id: row.id },
      },
    });
  }
  return sourceResult('skill', candidates);
}

// ── MCP 连接器 ────────────────────────────────────────────────
export interface ConnectorRow {
  id: string;
  status: string;
  toolCount: number;
  transport?: string;
  error?: string | null;
}

const CONNECTOR_STATUS_TEXT: Record<string, string> = {
  connected: '已连接',
  connecting: '连接中',
  authorizing: '授权中',
  disconnected: '未连接',
  auth_required: '需授权',
  error: '连接失败',
};

export function buildConnectorCandidates(rows: ConnectorRow[]): ContextSourceResult {
  const candidates: ContextCandidate[] = [];
  for (const row of rows) {
    if (!row || !row.id) continue;
    const status = CONNECTOR_STATUS_TEXT[row.status] ?? row.status;
    candidates.push({
      id: `connector:${row.id}`,
      sourceId: 'connector',
      label: row.id,
      detail: `${status} · ${row.toolCount} 个工具`,
      item: {
        id: `ctx-connector-${row.id}`,
        kind: 'connector',
        group: 'reference',
        label: row.id,
        source: CONTEXT_SOURCE_LABELS.connector,
        lines: referenceLines('连接器', [
          ['服务', row.id],
          ['状态', status],
          ['工具', `${row.toolCount}`],
          ['传输', row.transport ?? ''],
        ]),
        dedupeKey: `connector|${row.id}`,
        payload: { id: row.id, status: row.status },
      },
    });
  }
  return sourceResult('connector', candidates);
}

// ── Agent / 子任务（subagent profile） ────────────────────────
export interface AgentProfileRow {
  name: string;
  role?: string;
  model?: string;
  concurrency?: number;
}

/** profile 是派发缺省（不是权限面）；零 profile = 未配置，如实报原因而不是给空列表。 */
export function buildAgentCandidates(rows: AgentProfileRow[]): ContextSourceResult {
  const candidates: ContextCandidate[] = [];
  for (const row of rows) {
    if (!row || !row.name) continue;
    candidates.push({
      id: `agent:${row.name}`,
      sourceId: 'agent',
      label: row.name,
      detail: [row.role, row.model].filter(Boolean).join(' · ') || '子智能体 profile',
      item: {
        id: `ctx-agent-${row.name}`,
        kind: 'agent',
        group: 'reference',
        label: row.name,
        source: CONTEXT_SOURCE_LABELS.agent,
        lines: referenceLines('智能体', [
          ['profile', row.name],
          ['角色', row.role ?? ''],
          ['模型', row.model ?? ''],
        ]),
        dedupeKey: `agent|${row.name}`,
        payload: { name: row.name },
      },
    });
  }
  if (candidates.length === 0) return unavailableContextSource('agent', '尚未配置子智能体 profile');
  return sourceResult('agent', candidates);
}

// ── 结果产物（项目工具任务） ──────────────────────────────────
export interface ResultJobRow {
  id: string;
  tool_id: string;
  status: string;
  name?: string;
  created_at?: number;
  completed_at?: number;
}

/** 只有已完成的 job 才有可引用的产物；其余状态如实计数（不混进候选）。 */
export function buildResultCandidates(rows: ResultJobRow[]): ContextSourceResult {
  const candidates: ContextCandidate[] = [];
  for (const row of rows) {
    if (!row || !row.id || row.status !== 'done') continue;
    const title = row.name || row.tool_id || row.id;
    const finished = typeof row.completed_at === 'number' && row.completed_at > 0
      ? new Date(row.completed_at).toLocaleString()
      : '';
    candidates.push({
      id: `artifact:${row.id}`,
      sourceId: 'artifact',
      label: title,
      detail: `已完成 · ${row.tool_id}`,
      item: {
        id: `ctx-artifact-${row.id}`,
        kind: 'artifact',
        group: 'reference',
        label: title,
        source: CONTEXT_SOURCE_LABELS.artifact,
        lines: referenceLines('结果', [
          ['jobId', row.id],
          ['工具', row.tool_id ?? ''],
          ['完成于', finished],
        ]),
        dedupeKey: `artifact|${row.id}`,
        payload: { jobId: row.id, toolId: row.tool_id },
      },
    });
  }
  return sourceResult('artifact', candidates);
}

// ── 知识空间 ──────────────────────────────────────────────────
export interface KnowledgeSpaceRow {
  id: string;
  name: string;
  enabled?: boolean;
  documents?: number;
  chunks?: number;
}

export function buildKnowledgeCandidates(rows: KnowledgeSpaceRow[]): ContextSourceResult {
  const candidates: ContextCandidate[] = [];
  for (const row of rows) {
    if (!row || !row.id) continue;
    const status = row.enabled === false ? '已停用' : '已启用';
    candidates.push({
      id: `knowledge:${row.id}`,
      sourceId: 'knowledge',
      label: row.name || row.id,
      detail: `${status} · ${row.documents ?? 0} 个文档`,
      item: {
        id: `ctx-knowledge-${row.id}`,
        kind: 'knowledge',
        group: 'reference',
        label: row.name || row.id,
        source: CONTEXT_SOURCE_LABELS.knowledge,
        lines: referenceLines('知识空间', [
          ['名称', row.name || row.id],
          ['spaceId', row.id],
          ['状态', status],
          ['文档', `${row.documents ?? 0}`],
        ]),
        dedupeKey: `knowledge|${row.id}`,
        payload: { id: row.id },
      },
    });
  }
  return sourceResult('knowledge', candidates);
}

// ── 历史会话 ──────────────────────────────────────────────────
export interface ConversationRow {
  id: string;
  title: string;
  message_count?: number;
  updated_at?: string;
  status?: string;
}

/** 当前会话自身不进候选（"引用自己"没有语义）。 */
export function buildConversationCandidates(
  rows: ConversationRow[],
  currentConversationId?: string | null,
): ContextSourceResult {
  const candidates: ContextCandidate[] = [];
  for (const row of rows) {
    if (!row || !row.id || row.id === currentConversationId) continue;
    const title = row.title || '未命名对话';
    const updated = row.updated_at ? new Date(row.updated_at).toLocaleString() : '';
    candidates.push({
      id: `conversation:${row.id}`,
      sourceId: 'conversation',
      label: title,
      detail: `${row.message_count ?? 0} 条消息${updated ? ` · ${updated}` : ''}`,
      item: {
        id: `ctx-conversation-${row.id}`,
        kind: 'conversation',
        group: 'reference',
        label: title,
        source: CONTEXT_SOURCE_LABELS.conversation,
        lines: referenceLines('会话', [
          ['标题', title],
          ['conversationId', row.id],
          ['消息', `${row.message_count ?? 0}`],
        ]),
        dedupeKey: `conversation|${row.id}`,
        payload: { id: row.id },
      },
    });
  }
  return sourceResult('conversation', candidates);
}

// ── 过滤 / 上限 / 扁平化 ─────────────────────────────────────

/** 候选是否命中 query（label/detail/sourceId 三面，大小写不敏感）。 */
export function matchContextCandidate(candidate: ContextCandidate, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return candidate.label.toLowerCase().includes(q)
    || candidate.detail.toLowerCase().includes(q)
    || candidate.sourceId.toLowerCase().includes(q);
}

/**
 * 按 query 过滤并施加逐项上限：
 * - 空 query = 全源展示（每源按上限截断，`truncated` 报被藏条数）；
 * - 有 query = 只留有命中的源（无命中且可用的源**不出行**，避免噪声），
 *   不可用的源**永远出行**（它的原因本身就是信息）；
 * - 过滤先于截断：上限藏的是「命中的结果」，不是「前 N 条原始行」。
 */
export function filterContextSources(
  sources: ContextSourceResult[],
  query: string,
): ContextSourceResult[] {
  const q = query.trim();
  const out: ContextSourceResult[] = [];
  for (const source of sources) {
    const cap = CONTEXT_SOURCE_CAPS[source.sourceId];
    const matched = source.candidates.filter((candidate) => matchContextCandidate(candidate, q));
    const visible = matched.slice(0, cap);
    const truncated = Math.max(0, matched.length - visible.length);
    if (q && matched.length === 0 && source.unavailableReason === null) continue;
    out.push({ ...source, candidates: visible, truncated });
  }
  return out;
}

/** 键盘导航用的扁平序（与视觉分组同序：源顺序 × 组内顺序）。 */
export function flattenContextCandidates(sources: ContextSourceResult[]): ContextCandidate[] {
  return sources.flatMap((source) => source.candidates);
}

/** 可用候选总数（「空结果」判定与菜单计数用）。 */
export function countContextCandidates(sources: ContextSourceResult[]): number {
  return sources.reduce((total, source) => total + source.candidates.length, 0);
}

/** 不可用源清单（菜单底部的原因区按此渲染）。 */
export function listUnavailableSources(sources: ContextSourceResult[]): ContextSourceResult[] {
  return sources.filter((source) => source.unavailableReason !== null);
}

// ── `@` 触发解析（光标处 token） ─────────────────────────────

export interface MentionTrigger {
  /** 光标前是否处于 `@` token 内。 */
  active: boolean;
  /** `@` 之后的查询串（可能为空 = 刚敲下 @）。 */
  query: string;
  /** `@` 在文本中的下标（替换/删除用）。 */
  start: number;
  /** token 结束下标（= 光标位置）。 */
  end: number;
}

/** 未触发时的单例（避免每轮新建对象打乱 React 依赖比较）。 */
export const INACTIVE_MENTION: MentionTrigger = { active: false, query: '', start: -1, end: -1 };

/** query 的最大长度：超过即视为普通文本（防止长句里一个 @ 就弹菜单）。 */
const MENTION_QUERY_MAX = 40;

/**
 * 从 `(text, caret)` 解析 `@` 触发：只认「行首或空白之后」的 `@`，
 * 且 `@` 与光标之间不能有空白（空格即结束 token）。
 */
export function parseMentionTrigger(text: string, caret: number): MentionTrigger {
  if (!Number.isFinite(caret) || caret < 0 || caret > text.length) return INACTIVE_MENTION;
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return INACTIVE_MENTION;
  const query = before.slice(at + 1);
  if (query.length > MENTION_QUERY_MAX) return INACTIVE_MENTION;
  if (/[\s@]/.test(query)) return INACTIVE_MENTION;
  if (at > 0 && !/\s/.test(before[at - 1])) return INACTIVE_MENTION;
  return { active: true, query, start: at, end: caret };
}

/** 选中候选后把 `@query` token 从正文里摘掉（保留光标两侧文本与一个分隔空行以外的原样）。 */
export function removeMentionToken(text: string, trigger: MentionTrigger): { text: string; caret: number } {
  if (!trigger.active) return { text, caret: trigger.end < 0 ? text.length : trigger.end };
  const head = text.slice(0, trigger.start);
  const tail = text.slice(trigger.end);
  const next = `${head}${tail}`;
  return { text: next, caret: head.length };
}

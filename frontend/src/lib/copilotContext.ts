// ============================================================
// Copilot context — pub/sub for current page state
// Used to feed system prompt with page-specific info.
// ============================================================

export type CopilotPage =
  // W3-C: 空间组学云平台 4 页面
  | 'spatial-projects'
  | 'spatial-project'
  | 'spatial-dataset'
  | 'spatial-result'
  | 'figcode'
  | 'tools'
  | 'docs'
  | 'blog'
  | 'home'
  // 6.3 — desktop 项目工作台
  | 'desktop-project'
  | 'desktop-home'
  // BLOCK-99 G4 — 知识空间管理台（/knowledge 页内嵌会话面）
  | 'knowledge'
  | 'unknown';

export interface HarnessContextSummary {
  fileCount: number;
  truncated?: boolean;
  byKind?: Record<string, number>;
  byRole?: Record<string, number>;
  entries?: {
    relativePath: string;
    kind: string;
    role: string;
    readable?: boolean;
    table?: {
      headers?: string[];
      columnCount?: number;
      rowSampleCount?: number;
      matrixOrientation?: string;
    };
  }[];
}

export interface CopilotContext {
  page: CopilotPage;
  pageTitle?: string;
  /** Current full URL (for citation) */
  pageUrl?: string;
  /** Excerpted main content from the page (~2K chars), for docs/blog/figcode etc. */
  pageContent?: string;
  /** Headings outline of current page, for "where am I in the document" awareness */
  pageOutline?: string[];
  /** Heading currently in viewport (closest one above the fold) */
  visibleHeading?: string;
  // 当前云平台模块（决定 petri-server system-prompt 的云平台分支）
  currentModule?: 'spatial';
  // single-cell + spatial 共享字段（同结构）
  projectId?: string;
  datasetId?: string;
  datasetName?: string;
  analysisId?: string;
  analysisType?: string;
  analysisName?: string;
  summary?: unknown;
  /** Available cluster ids on the current result, for action suggestions */
  clusterIds?: (string | number)[];
  // figcode
  plotName?: string;
  codeContent?: string;
  // tools page
  toolId?: string;
  toolName?: string;
  toolResult?: unknown;
  availableTools?: string[];
  // 6.3 — desktop project workspace context
  /** Current project name (desktop workspace) */
  projectName?: string;
  /** Agent workspace permission selected in the chat input. UI-303 — 'plan' 为第四档（Spec 门计划模式）。 */
  accessMode?: 'full' | 'workspace-write' | 'plan' | 'read';
  /** BLOCK-55 P1 — Spec 门计划模式：只读探索 + 起草计划，写类工具被 policy 拒绝。UI-303 起由 accessMode='plan' 派生。 */
  planMode?: boolean;
  /** BLOCK-57 UI-290 — 会话级执行目标（composer 选择器；null/缺省 = 本机）。 */
  executionTargetId?: string | null;
  /** BLOCK-55 P1 — 已批准计划的执行期提示（plan 模式关闭后随首 turn 传给后端）。 */
  approvedPlanId?: string;
  /** BLOCK-55 P1 — 批准并清上下文执行：本 turn 消息数组仅含 spec 自包含首条。 */
  approvedPlanFresh?: boolean;
  /** Project modality: single-cell / spatial / genome / etc. */
  projectModality?: string;
  /** Dataset summaries in current project (id + name + type + rows) */
  projectDatasets?: { id: string; name: string; type?: string; rows?: number }[];
  /** Recent job summaries in current project (id + tool + status + time) */
  projectJobs?: { id: string; toolId: string; status: string; name?: string; createdAt: number }[];
  /** Compact project-scope Harness file-index summary for agent parameter planning. */
  projectHarnessSummary?: HarnessContextSummary;
  /** Compact active job/artifact-scope Harness summary for result-aware follow-up. */
  activeJobHarnessSummary?: HarnessContextSummary;
  /** Current active job id being viewed */
  activeJobId?: string;
  /** Current artifact/file being viewed inside the project result panel */
  activeArtifact?: {
    jobId: string;
    toolId: string;
    name: string;
    type: string;
    label?: string;
    url?: string;
    revisionId?: string | null;
    artifactFamilyId?: string | null;
    entityType?: string | null;
    idField?: string | null;
    selectionId?: string | null;
    selectionCompatibility?: 'compatible' | 'stale' | 'invalid' | null;
    /** P4R-3 opaque binding; sent in request context, never rendered in chat text. */
    contextToken?: string | null;
    selection?: {
      artifactId: string;
      revisionId: string | null;
      entityType: string;
      origin: string;
      entityIdCount: number;
      truncated: boolean;
      durable: boolean;
      sampleEntityIds: string[];
      entityIdsHash: string | null;
      fields: string[];
      hasFilter: boolean;
      filterDescription: string | null;
      sort: Array<{ field: string; direction: 'asc' | 'desc' }>;
    } | null;
  } | null;
  /**
   * P4R-3 structured result-edit request. The visible user message remains the
   * user's own outcome; orchestration instructions are rendered by the backend
   * system prompt instead of being persisted as a fake user utterance.
   */
  resultEditRequest?: {
    origin: 'manual' | 'agent';
    completionExpectation: 'candidate' | 'result_action' | 'none';
    parameterPatch: Record<string, unknown>;
    scientificConfirmed: boolean;
  } | null;
  /**
   * BLOCK-99 G4 — 会话台工具子集标记：'knowledge-console' 时后端只下发 knowledge
   * 白名单工具（agent-tools/knowledge-console-tools.js resolveToolDefsForContext）。
   * 缺省/其他值维持全量工具（现状行为）。
   */
  toolSubset?: string;
}

let current: CopilotContext = { page: 'unknown' };

export function setCopilotContext(patch: Partial<CopilotContext>): void {
  current = { ...current, ...patch };
}

export function getCopilotContext(): CopilotContext {
  return current;
}

// UI-627（BLOCK-321）— subscribeCopilotContext 退役：唯一消费者曾是页内侧聊
// 悬浮面（「copilotAsk 归属不在悬挂面」订阅守卫），悬浮面随独立窗化删除。


// ============================================================
// types.ts — SimpleChat shared types + slash commands + system opener
//
// Extracted from SimpleChat.tsx by BLOCK-9.2 PHASE 4. Pure data + type
// declarations; no React component logic lives here so no React-specific
// runtime imports needed (types are erased by the compiler).
// ============================================================

import { restoreResultEditProgressEvents } from '../copilotClient';
import type { ResultEditProgressEvent } from '../copilotClient';
import type { ToolActivityItem } from '../toolActivity';
import { restoreToolActivities } from '../toolActivity';
import { resolveToolSummaryPresentation } from '../toolSummaryPresentation';
import { parseAssistantResultNodes } from '../extraRenderers';
import type { AccessMode } from './hooks/useModelAccessMenus';
import type { ConversationMessage } from '../copilotConversationsClient';
import type { ResultNode } from '../types';
import type { ConversationLoopState } from '../conversationRunStore';
import type { ConversationPendingApproval } from '../conversationRunStore';

/**
 * Slash command definitions
 */
export interface SlashCommand {
  id: string;
  label: string;
  description: string;
  shortcut: string | null;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { id: 'new', label: '新建对话', description: '开始一个新的对话', shortcut: null },
  { id: 'clear', label: '清空对话', description: '清除当前对话历史', shortcut: null },
  { id: 'model', label: '切换模型', description: '选择 AI 模型', shortcut: null },
  { id: 'export', label: '导出对话', description: '导出当前对话为 Markdown', shortcut: null },
  { id: 'help', label: '帮助', description: '显示所有命令', shortcut: null },
];

/**
 * Files that cannot be inlined in the right Files panel trigger the system
 * opener alongside the in-app preview. Office/iWork files that we now parse
 * (docx/xlsx/pptx/odt/ods/odp) and simple text/code files are intentionally
 * excluded so the user only sees one window per click. R / scanpy data
 * formats (rds, RData, h5ad, h5, hdf5, loom, mtx) are excluded because no
 * default macOS app can open them — auto-opening would just pop the
 * "Choose Application" dialog, which is more disruptive than helpful. Users
 * who actually want to open them in RStudio / scanpy can still use the
 * "Open with system app" button in the preview card.
 */
const SYSTEM_OPEN_FILE_EXTENSIONS = new Set([
  'doc', 'dot', 'xls', 'xlt', 'ppt', 'pps', 'pot',
  'pages', 'numbers', 'keynote',
  'rtf', 'epub', 'tif', 'tiff', 'heic', 'heif',
]);

export function shouldOpenWithSystemApp(name: string): boolean {
  const extension = name.split('.').pop()?.toLowerCase() || '';
  return SYSTEM_OPEN_FILE_EXTENSIONS.has(extension);
}

export interface SimpleMessage {
  role: 'user' | 'assistant';
  content: string;
  pending?: boolean;
  error?: boolean;
  ts?: string;
  /** BLOCK-95 A1 — 持久化消息的 DB id（msg_*）；run 投影的临时消息无此字段。 */
  id?: string;
  toolActivities?: ToolActivityItem[];
  processingDurationMs?: number;
  statusMessage?: string;
  summaryUnavailable?: boolean;
  retryToolJobId?: string;
  progressUpdates?: Array<{ iteration: number; content: string }>;
  resultEditProgress?: ResultEditProgressEvent[];
  /** HLE-C4R: live durable-loop projection for the running assistant turn. */
  loop?: ConversationLoopState | null;
  /** T83: model used to produce this assistant message (per-message). */
  modelName?: string;
  /**
   * UI-AGENTWB-### / chat-error-rendering: when assistantContent comes from a
   * backend error (tool exec failure / Python worker crash / harness
   * validation issue / harness repair failure), conversationRunStore keeps the
   * raw stack trace in this field so the ErrorBanner can show a "查看详情"
   * disclosure — without it the user only ever sees "发生未知错误" even when
   * the root cause is `ModuleNotFoundError: No module named 'numpy'`.
   */
  technicalDetails?: string;
  /**
   * UI-AGENTWB-### / chat-error-rendering: classifier code emitted by
   * classifyError (e.g. UNKNOWN / TOOL_ERROR / INTERNAL_ERROR). Lets
   * downstream consumers surface a stable error category without re-running
   * the classifier on every render.
   */
  errorCode?: string;
  /**
   * UI-AGENTWB-004: A4 bridge — typed list of ResultNodes parsed from
   * `meta.resultNodes`. Populated only when the optional payload is a
   * well-formed array of well-formed nodes; otherwise left undefined so
   * the assistant message falls through to the existing markdown path
   * without any visible error.
   */
  resultNodes?: ResultNode[];
  /** UI-272 — 按迭代聚合的模型思考段（reasoning_content），展开执行记录时展示工具衔接思路。 */
  reasoningByIteration?: Record<number, string>;
  /** BLOCK-38 P2 / UI-275 — 服务中断可续跑（SSE error 事件 resumable 标记），显示「继续执行」入口。 */
  resumable?: boolean;
  /** BLOCK-38 P2 / UI-275 — 服务中断时间（后端清扫写入 interrupted_at）。 */
  interruptedAt?: string;
  /** BLOCK-38 P2 / UI-275 — 本 run 的 agent task id（续跑预览/执行的目标）。 */
  taskId?: string;
  /** BLOCK-56 P1 — 模型降级提示（请求级/任务级首次发生时记录），任务条持久显示「已降级到 X 模型」。 */
  modelFallbackNotice?: string;
  /** BLOCK-49 加映 — 子 agent 终态通知（proactive，会话级累计）。 */
  childFinishedNotices?: Array<{ childTaskId: string; status: string; summaryHead: string }>;
}

/**
 * UI-272 — 恢复 meta.reasoningByIteration 白名单：数字迭代键 + 字符串值，
 * 单段 8K / 最多 24 段封顶，异常形状静默丢弃。
 */
function restoreReasoningByIteration(
  raw: unknown
): Record<number, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<number, string> = {};
  let count = 0;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const iteration = Number(key);
    if (!Number.isInteger(iteration) || iteration < 1 || typeof value !== 'string') continue;
    if (!value.trim()) continue;
    if (count >= 24) break;
    out[iteration] = value.slice(0, 8192);
    count += 1;
  }
  return count > 0 ? out : undefined;
}

export function restoreSimpleMessage(message: ConversationMessage): SimpleMessage {
  const meta = message.meta || {};
  const toolActivities = restoreToolActivities(meta.toolActivities);
  const finalization = meta.finalization && typeof meta.finalization === 'object'
    ? meta.finalization as Record<string, unknown>
    : null;
  const incident = meta.incident && typeof meta.incident === 'object';
  const presentation = resolveToolSummaryPresentation({
    assistantContent: message.content,
    assistantError: message.role === 'assistant' && Boolean(incident),
    summaryFailureReason: typeof finalization?.failureReason === 'string'
      ? finalization.failureReason
      : undefined,
    toolActivities,
  });
  return {
    role: message.role === 'system' ? 'assistant' : message.role,
    content: presentation.content,
    error: presentation.error,
    summaryUnavailable: presentation.summaryUnavailable,
    retryToolJobId: presentation.retryToolJobId,
    ts: message.ts,
    id: message.id,
    toolActivities,
    progressUpdates: restoreProgressUpdates(meta.progressUpdates),
    resultEditProgress: restoreResultEditProgressEvents(meta.resultEditProgress),
    processingDurationMs: typeof meta.processingDurationMs === 'number'
      ? meta.processingDurationMs
      : undefined,
    resultNodes: parseAssistantResultNodes(meta.resultNodes) ?? undefined,
    reasoningByIteration: restoreReasoningByIteration(meta.reasoningByIteration),
  };
}

export interface AgentProgressUpdate {
  iteration: number;
  content: string;
}

function restoreProgressUpdates(value: unknown): Array<{ iteration: number; content: string }> {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).flatMap((item, index) => {
    if (!item || typeof item !== 'object') return [];
    const raw = item as Record<string, unknown>;
    const content = typeof raw.content === 'string' ? raw.content.trim().slice(0, 4000) : '';
    if (!content) return [];
    return [{
      iteration: typeof raw.iteration === 'number' ? raw.iteration : index + 1,
      content,
    }];
  });
}

export interface ExamplePrompt {
  icon: import('@/components/icons/Icon').IconName;
  title: string;
  description: string;
  prompt: string;
}

// 2026-09-18 历史残留清理（用户裁决「要有通用性 领域提示……可以直接修复」）：
// 默认示例卡领域中立——「分析单细胞数据」是 biof3 生信时代遗留，生信能力已
// 领域包化（BLOCK-86），领域示例卡改由「已装领域包」动态追加（见
// DOMAIN_EXAMPLE_PROMPTS + helpers.useDomainExamplePrompts），无包不提领域。
export const DEFAULT_EXAMPLE_PROMPTS: ExamplePrompt[] = [
  {
    icon: 'folder',
    title: '解释项目结构',
    description: '了解项目的文件组织与数据构成',
    prompt: '解释一下这个项目的结构和数据',
  },
  {
    icon: 'zap',
    title: '快速开始',
    description: '查看 AI 能帮你做什么',
    prompt: 'Gewu Desktop 能帮我完成哪些任务？',
  },
  {
    icon: 'list-details',
    title: '规划一个任务',
    description: '说出目标，我来拆解成可执行的步骤',
    prompt: '我想完成一个分析任务，帮我把它拆解成可执行的步骤',
  },
];

// 领域示例卡注册表（v1 静态映射：包 id → 示例卡；包 manifest 支持示例声明后
// 迁移到包侧数据）。仅当对应领域包「已安装」时由 useDomainExamplePrompts 追加。
export const DOMAIN_EXAMPLE_PROMPTS: Record<string, ExamplePrompt[]> = {
  'gewu-pack-bio': [
    {
      icon: 'bar-chart',
      title: '分析单细胞数据',
      description: '生信分析包：上传表达矩阵，我来做降维可视化',
      prompt: '帮我分析这个单细胞RNA数据集',
    },
  ],
};

export interface ExamplePromptsProps {
  prompts: ExamplePrompt[];
  onSelect: (prompt: string) => void;
}

export interface SimpleChatHandle {
  newConversation: () => void;
}

export interface SimpleChatProps {
  projectId: string;
  conversationId: string | null;
  onConversationChange: (id: string | null) => void;
  inputHeight?: number;
  /**
   * Whether this instance handles the copilotAsk event. Exactly one mounted
   * instance may, so it defaults to false and the owner opts in explicitly.
   */
  ownsCopilotAsk?: boolean;
  /**
   * UI-341 加映 — 欢迎页专用变体：只渲染 composer（输入框 + 控件行），跳过
   * 消息流/空态/建议卡/滚动条。宿主（欢迎页）自带项目切换与快捷 chips，
   * 无会话内容可展示。默认 false，工作区/右栏用法零变化。
   */
  composerOnly?: boolean;
  /**
   * UI-373 — 发送前置守卫：返回非空字符串 = 拦截本次发送（Enter 与
   * copilotAsk 快捷 chips 均覆盖）；展开项目选择器等侧效应由守卫自身负责。
   * 缺省不拦截，工作区/右栏用法零变化。
   */
  sendGuard?: () => string | null;
  /**
   * UI-448 — 窄面 compact 档（380px 悬浮聊天面）：占位符改短提示，
   * 完整键位提示在窄面内会折两行。缺省 false，中栏用法零变化。
   */
  compact?: boolean;
  /**
   * UI-448 加映 v2 — 档位锁定（悬挂聊天面仅聊天）：实例的访问档位被锁死
   * （悬挂面传 'read'），档位选择器禁用。缺省不锁定，中栏用法零变化。
   * 工具放行口径由后端 agent-tool-policy 权威门禁裁决。
   */
  lockedAccessMode?: AccessMode;
  /**
   * UI-448 加映 v3 — composer 删减（悬挂面纯聊天）：隐藏导出/知识空间开关/
   * 上下文用量环/模型与供应商/思考档位，只留档位锁定徽标 + 发送键。
   * 缺省 false，中栏用法零变化。
   */
  slimComposer?: boolean;
}

export type PendingApproval = ConversationPendingApproval;

export interface ErrorBannerProps {
  message: string;
  severity: 'error' | 'warning' | 'info';
  showDetails: boolean;
  technicalDetails?: string;
}
// UI-305 P0.1 — Harness 自动校正状态机（原 SimpleChat.tsx 内联声明，随
// ApprovalCard/ApprovalRepairHint 外迁而移入共享 types）。
import type {
  HarnessParamRepair,
  HarnessRunDiagnostics,
} from '@/lib/harness-client';

export type ApprovalRepairState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; repair: HarnessParamRepair; diagnostics?: HarnessRunDiagnostics | null }
  | { status: 'skipped'; message: string }
  | { status: 'error'; message: string };

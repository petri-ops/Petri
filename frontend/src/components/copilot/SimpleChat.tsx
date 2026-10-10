// ============================================================
// SimpleChat — lightweight conversation-only chat component.
// Replaces the complex CopilotChat for the desktop workspace.
// Pure message list + input, driven by projectId/conversationId.
//
// BLOCK-9.2 PHASE 4: extracted to ./SimpleChat/{types.ts,helpers.tsx,attachments.ts,ImagePreviewModal.tsx,formatHarness.ts,hooks/useChatStream.ts}.
//   • 189-line types.ts holds 14 type/const declarations.
//   • 108-line helpers.ts holds MessageMeta + ExamplePrompts + compactStageConclusion.
//   • attachments.ts holds AttachmentFile type + drag/drop/paste/remove/open/close helpers.
//   • ImagePreviewModal.tsx holds the image preview modal component (~110 lines).
//   • formatHarness.ts holds the 5 pure harness payload formatting helpers
//     (stringifyParamValue / shortValue / formatHarnessRepair / formatHarnessWarning /
//     formatHarnessDiagnosticIssue).
//   • hooks/useChatStream.ts owns the 5 stream-related callbacks
//     (send / stop / regenerate / queue / runInBackground) plus the
//     `starting` state, `messagesRef` / `sendRef` indirection, the
//     `copilotAsk` event subscription, and the queue drain effect.
//   • The main component drops from ~2115 → ~1965 lines after this
//     commit; send/stop/regenerate/queue/runInBackground + 9 hooks
//     now live in the custom hook, called once at the position the
//     inline `send` useCallback used to occupy. Hook order is fixed
//     and documented at the top of useChatStream.ts.
//
// Pure code organization change; 0 behavior difference. All public exports
// re-exported from main file to keep `import { ... } from '@/components/copilot/SimpleChat'` working.
// ============================================================

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';

// ── BLOCK-9.2 PHASE 4: types + helpers + attachments re-exports for backward compat ──
import {
  SLASH_COMMANDS,
  shouldOpenWithSystemApp,
  restoreSimpleMessage,
  type SlashCommand,
  type SimpleMessage,
  type AgentProgressUpdate,
  type ExamplePrompt,
  type ExamplePromptsProps,
  type SimpleChatHandle,
  type SimpleChatProps,
  type ErrorBannerProps,
  type PendingApproval,
} from './SimpleChat/types';
// BLOCK-160 W2 P3（KNW-3）— 斜杠菜单动态数据源（产品 Skills + run_tool 模板；
// 选中注入执行意图文本模板，v1 不跳页不自动执行）
import { fetchSlashEntries, filterSlashEntries, slashIntentTemplate, type SlashEntry } from './SimpleChat/slashSources';
import {
  useDomainExamplePrompts,
  ExamplePrompts,
  compactStageConclusion,
} from './SimpleChat/helpers';
import {
  type AttachmentFile,
  onDragOver,
  onDragLeave,
  onDrop,
  onPaste,
  removeAttachmentById,
  openImagePreview,
  closeImagePreview,
} from './SimpleChat/attachments';
import {
  composeAttachmentReferenceLines,
  uploadAttachment,
} from './SimpleChat/attachmentUpload';
import { ImagePreviewModal } from './SimpleChat/ImagePreviewModal';
// BLOCK-92 三波拆分 — 思考档位/滚动守卫两簇外迁 hooks/（原样平移）
import { useThinkingLevel } from './SimpleChat/hooks/useThinkingLevel';
import { useScrollGuard } from './SimpleChat/hooks/useScrollGuard';
// UI-268: 「后台进程」浮窗（持久输出独立小窗口）；工具活动记录改为内联手风琴
import { ToolActivityDock } from './ToolActivityDock';
import { MessageRail } from './MessageRail';
import { ChatScrollbar } from './ChatScrollbar';
// UI-305 P0.1 — 尾部内联渲染组件外迁（LoopStatusPanel / AgentProgressList /
// ResultEditProgressList / ErrorBanner / ApprovalCard+ApprovalRepairHint），
// 零行为变化；ResultEditProgressList 按惯例在此再导出保持导入路径兼容。
import { LoopStatusPanel } from './SimpleChat/LoopStatusPanel';
import { ApprovalCard } from './SimpleChat/ApprovalCard';
import { ResultEditProgressList } from './SimpleChat/ResultEditProgressList';
// BLOCK-154 波次 3 — 消息行组件（memo 渲染边界，契约见该文件头与 SimpleChatMessageRow.test.tsx）。
import { SimpleChatMessageRow } from './SimpleChat/SimpleChatMessageRow';
import { useSummaryRetry } from './SimpleChat/hooks/useSummaryRetry';
import { useModelAccessMenus } from './SimpleChat/hooks/useModelAccessMenus';
import { useConversationResume } from './SimpleChat/hooks/useConversationResume';
import { useAutoFileReferenceRefresh } from './SimpleChat/hooks/useAutoFileReferenceRefresh';
import { useKnowledgeSpaceToggle } from './SimpleChat/hooks/useKnowledgeSpace';
// BLOCK-92 Wave A-3 — 状态/派生簇外迁（纯搬运，调用点见组件内标注）。
import { applyConversationNotices, buildBaseDisplayMessages, buildRailItems } from './SimpleChat/displayMessages';
import { useApprovalFlow } from './SimpleChat/hooks/useApprovalFlow';
import { useComposerFocus } from './SimpleChat/hooks/useComposerFocus';
import { useForkConversation } from './SimpleChat/hooks/useForkConversation';
import { usePlanApprovalFlow } from './SimpleChat/hooks/usePlanApprovalFlow';
import { useTokenBudgetState } from './SimpleChat/hooks/useTokenBudgetState';
export { ResultEditProgressList };

// Re-export helpers (so `import { restoreSimpleMessage } from './SimpleChat'` keeps working)
export {
  shouldOpenWithSystemApp,
  restoreSimpleMessage,
  compactStageConclusion,
};
export type {
  SlashCommand,
  SimpleMessage,
  AgentProgressUpdate,
  ExamplePrompt,
  ExamplePromptsProps,
  SimpleChatHandle,
  SimpleChatProps,
  ErrorBannerProps,
  PendingApproval,
  AttachmentFile,
};

import { useCopilotContext } from '@/lib/copilotContextProvider';
import { useConversations } from '@/hooks/useConversations';
import { petriEvents, dispatchPetriEvent, subscribePetriEvent } from '@/lib/events';
import '@/lib/chat-file-references';
import type { ExtractContext, FileReferenceClickDetail } from '@/lib/chat-file-references';

// SYSTEM_OPEN_FILE_EXTENSIONS + shouldOpenWithSystemApp moved to ./SimpleChat/types.ts (BLOCK-9.2 PHASE 4).

import { useAiSettings } from '@/hooks/useAiSettings';
// BLOCK-81 P2 — 思考档位（会话级持久化 + 词表）；载入/持久化 helper 已随
// useThinkingLevel 簇迁至 SimpleChat/hooks/useThinkingLevel.ts
import {
  THINKING_LEVEL_LABELS,
  THINKING_LEVELS,
  nextThinkingLevel,
  saveThinkingLevel,
} from './thinkingLevel';
import { buildConversationSegments } from './conversationSegments';
import type { ConversationSegment } from './conversationSegments';
import {
  useConversationRun,
  useSubAgentTasksForConversation,
  resumeOrphanAgentTasks,
} from './conversationRunStore';
import { useErrorFormatter } from './useErrorFormatter';
import { useDurableConversationLoop } from '@/hooks/useDurableConversationLoop';
import { useExtraRenderersFlag } from './extraRenderers';
import './simple-chat.css';
import { Icon } from '@/components/icons/Icon';

// BLOCK-154 波次 3 — 无 timeline 分段消息的共享空数组（行 memo 的 segments prop
// 需要稳定引用；`?? []` 每次新建会击穿 memo）。
const EMPTY_ROW_SEGMENTS: ConversationSegment[] = [];
import { getBridge } from '@/lib/desktopBridge';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';
import { INITIAL_NAV_STATE, stepHistoryNavigation } from './chatHistoryNav';
import {
  clearConversationDraft,
  loadConversationDraft,
  saveConversationDraft,
} from './conversationDraft';
// BLOCK-9.2 PHASE 4: stream control extracted from this file.
// The hook owns send/stop/regenerate/queue/runInBackground plus the
// `starting` state, messagesRef/sendRef indirection, the copilotAsk
// event subscription, and the queue drain effect.
import { useChatStream, type QueuedPrompt } from './SimpleChat/hooks/useChatStream';
// BLOCK-52 P1（选中即引用）: 引用块纯函数助手（状态管理 + 发送渲染）。
import {
  appendSelectionReference,
  composeMessageWithSelectionReferences,
  selectionReferenceChipLabel,
  selectionReferenceLocation,
  type SelectionReference,
} from './SimpleChat/selectionReferences';
// BLOCK-52 P2（图片/结果图引用）: 图片引用卡纯函数助手（状态管理 + 发送渲染）。
import {
  appendImageReference,
  composeMessageWithImageReferences,
  imageReferenceSourceLine,
  type ImageReference,
} from './SimpleChat/imageReferences';
// BLOCK-20: orphaned helpers (8/21, commit 9cbf8e3) wired into
// the SimpleChat consumption side. The two helpers below are pure
// UI utilities and safe to import from the renderer:
//   • accessModeValidator — provides a defensive pre-send guard that
//     mirrors the backend agent-tool-policy. The backend is the
//     authoritative enforcer (test/accessmode-validation.test.mjs);
//     the validator here is a UI feedback hook (validateToolCall
//     throws synchronously before any network IO). Used inside the
//     read-only auto-approve gate below.
//   • ContextBudgetBar — renders a passive ring + popover for the
//     active turn's token budget. Backed today by the 3 backend
//     helpers (token-estimator / model-context-windows /
//     message-trimmer); until those land a tiktoken dep + an SSE
//     event we render in idle mode with no live `budget`, which
//     surfaces the placeholder (`—`) instead of fake numbers.
// BLOCK-55 P1/P2/P3 — Spec 门：计划模式开关 + 批准三选一 + 修订批准
import { PlanApprovalCard } from './SimpleChat/PlanApprovalCard';
import { composerPlaceholder } from './SimpleChat/ComposerYield';
import { ContextBudgetButton } from './ContextBudgetBar';

// SimpleMessage + restoreSimpleMessage + AgentProgressUpdate + restoreProgressUpdates + MessageMeta moved to
// ./SimpleChat/{types,helpers}.ts (BLOCK-9.2 PHASE 4).

// ExamplePrompt interface + DEFAULT_EXAMPLE_PROMPTS + ExamplePromptsProps + ExamplePrompts moved to
// ./SimpleChat/{types,helpers}.ts (BLOCK-9.2 PHASE 4).
// SimpleChatHandle + SimpleChatProps moved to ./SimpleChat/types.ts (BLOCK-9.2 PHASE 4).

// AttachmentFile type moved to ./SimpleChat/attachments.ts (BLOCK-9.2 PHASE 4).
// The type is imported at the top of the file alongside the handler helpers
// and re-exported from this file's header for any consumer that previously
// reached for AttachmentFile via the SimpleChat path.

// UI-386 — spawn 自动唤起去重表（模块级：跨 SimpleChat 实例/重挂载每 task 只切一次）
const autoOpenedSubAgents = new Set<string>();

export function SimpleChat({
  projectId,
  conversationId,
  onConversationChange,
  inputHeight: _inputHeight = 120,
  ownsCopilotAsk = false,
  composerOnly = false,
  sendGuard,
  compact = false,
  lockedAccessMode,
  slimComposer = false,
}: SimpleChatProps): React.ReactElement {
  const [messages, setMessages] = useState<SimpleMessage[]>([]);
  const [copiedMessageKey, setCopiedMessageKey] = useState<string | null>(null);
  const [input, setInput] = useState('');
  // BLOCK-102 P2 — 队列条目带会话归属（修复排队追问跨会话注入竞态）
  const [queuedPrompts, setQueuedPrompts] = useState<QueuedPrompt[]>([]);
  const [attachments, setAttachments] = useState<AttachmentFile[]>([]);
  // BLOCK-91 — 附件发送失败/守卫提示（诚实可见，不再静默丢弃）。
  const [attachmentNotice, setAttachmentNotice] = useState<string | null>(null);
  // BLOCK-150 加映 — 识图能力位：后端 /ai/settings vision_configured=false 时图片输入
  // 前置阻断（贴图/拖图即提示配置去向，替代发出去之后的 vision_failed）。缺省 true：
  // 仅在后端明确回报不可用时才阻断（取数失败/旧后端无字段 → 维持旧行为）。
  // BLOCK-155 放宽 — 本位不再是图片输入的唯一放行条件：聊天渠道自身声明视觉能力
  // （chatVisionCapable，见 useAiSettings 解构之后）时同样放行，合并判据单源
  // imageInputAllowed（两者皆无才阻断）。
  const [visionConfigured, setVisionConfigured] = useState(true);
  useEffect(() => {
    // 能力位必须问「将执行识图的聊天后端」——dev 双后端形态下 rApiBase 才是执行方
    // （BLOCK-85 端口纪律①：跨进程状态同源；问错侧=能力位与执行位脑裂）。
    const rApiBase = (window as unknown as { petriDesktop?: { backendConfig?: { rApiBase?: string } } })
      ?.petriDesktop?.backendConfig?.rApiBase;
    const apiBase = rApiBase || (import.meta.env.DEV ? 'http://localhost:3001/api' : '/api');
    let cancelled = false;
    fetch(`${apiBase}/ai/settings`)
      .then((resp) => (resp.ok ? resp.json() as Promise<{ settings?: { vision_configured?: boolean } } | null> : Promise.resolve(null)))
      .then((data) => {
        if (!cancelled && data?.settings && typeof data.settings.vision_configured === 'boolean') {
          setVisionConfigured(data.settings.vision_configured);
        }
      })
      .catch(() => { /* 保守：取数失败不阻断 */ });
    return () => { cancelled = true; };
  }, []);
  // CK-01（C-06）— 运行中发送自动 steer 的行内回执提示（几秒自动消退）
  const [steerNotice, setSteerNotice] = useState<string | null>(null);

  // UI-444 加映（用户反馈「点击了下载但没有窗口出来」）——改为原生另存为：
  // fetch 后端组合的 Markdown → files.saveTextFile（原生保存对话框，位置可控、
  // 确认后写入）→ 行内回执告知路径；浏览器（非桌面）回退 blob 锚点下载。
  const handleExportConversation = useCallback((): void => {
    if (!conversationId) return;
    void (async () => {
      const url = `${getPlatformApiPrefix()}/ai/conversations/${encodeURIComponent(conversationId)}/export.md`;
      const token = getToken();
      let content: string | null = null;
      try {
        const resp = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
        if (resp.ok) content = await resp.text();
      } catch { content = null; }
      if (content == null) {
        setSteerNotice('会话导出失败：无法读取会话内容');
        return;
      }
      const name = `会话导出-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}.md`;
      const bridge = getBridge('files');
      if (bridge?.saveTextFile) {
        const r = await bridge.saveTextFile(name, content);
        if (r && r.ok && r.path) setSteerNotice(`已导出：${r.path}`);
        else if (r && r.ok && r.canceled) { /* 用户取消，不打扰 */ }
        else setSteerNotice('会话导出失败：' + ((r && r.error) || '未知原因'));
        return;
      }
      const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
    })();
  }, [conversationId]);
  useEffect(() => {
    if (!steerNotice) return undefined;
    const t = window.setTimeout(() => setSteerNotice(null), 4000);
    return () => window.clearTimeout(t);
  }, [steerNotice]);
  // BLOCK-52 P1（选中即引用）: 右栏预览选中文字 → 引用块，随下一条消息发送。
  const [selectionRefs, setSelectionRefs] = useState<SelectionReference[]>([]);
  const selectionRefsRef = useRef<SelectionReference[]>([]);
  useEffect(() => {
    selectionRefsRef.current = selectionRefs;
  }, [selectionRefs]);
  // 订阅右栏 WorkspaceFilePreview 的「引用到对话」事件。仅 copilotAsk 拥有者
  // （中央会话）消费，避免右栏 chat tab 与中央会话重复入列；跨项目载荷丢弃。
  useEffect(() => {
    if (!ownsCopilotAsk) return undefined;
    return subscribePetriEvent(petriEvents.selectionQuote, (detail) => {
      if (detail.projectId && detail.projectId !== projectId) return;
      setSelectionRefs((prev) => appendSelectionReference(prev, detail));
    });
  }, [ownsCopilotAsk, projectId]);
  const removeSelectionRef = useCallback((id: string) => {
    setSelectionRefs((prev) => prev.filter((ref) => ref.id !== id));
  }, []);
  // BLOCK-52 P2（图片/结果图引用）: 右栏图片预览/结果面板图片 → 引用卡，随下一条消息发送。
  const [imageRefs, setImageRefs] = useState<ImageReference[]>([]);
  const imageRefsRef = useRef<ImageReference[]>([]);
  useEffect(() => {
    imageRefsRef.current = imageRefs;
  }, [imageRefs]);
  // 订阅 imageQuote 事件（WorkspaceFilePreview 静态图 / ResultView 结果图）。
  // 与 P1 同策略：仅 copilotAsk 拥有者消费；跨项目载荷丢弃。
  useEffect(() => {
    if (!ownsCopilotAsk) return undefined;
    return subscribePetriEvent(petriEvents.imageQuote, (detail) => {
      if (detail.projectId && detail.projectId !== projectId) return;
      setImageRefs((prev) => appendImageReference(prev, detail));
    });
  }, [ownsCopilotAsk, projectId]);
  const removeImageRef = useCallback((id: string) => {
    setImageRefs((prev) => prev.filter((ref) => ref.id !== id));
  }, []);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [previewImage, setPreviewImage] = useState<AttachmentFile | null>(null);
  const [loading, setLoading] = useState(false);
  // BLOCK-57：远程执行目标——确认卡选择器数据（仅当存在已注册目标时渲染，本机永远是默认）
  // BLOCK-60 — composer 工具栏容器查询窄态（ResizeObserver 只读宽度，不影响弹性宽度逻辑）
  const composerBarRef = useRef<HTMLDivElement | null>(null);
  const [composerNarrow, setComposerNarrow] = useState(false);
  // BLOCK-81 P2 — 思考档位：会话级态（随会话恢复），默认「标准」＝不发任何上游参数。
  // BLOCK-92 三波拆分 — 296-308 连续簇抽入 useThinkingLevel（调用点原位保持 hook
  // 顺序；Ctrl+T 循环 effect 与簇不连续，仍在下方原位经 setThinkingLevel 驱动）。
  const { thinkingLevel, setThinkingLevel, thinkingMenuOpen, setThinkingMenuOpen, applyThinkingLevel } =
    useThinkingLevel(projectId, conversationId);
  useEffect(() => {
    const el = composerBarRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setComposerNarrow(entry.contentRect.width < 680);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // BLOCK-57 UI-290 — 执行目标：composer 选择器（本机永远默认；选择持久化，
  // 页面刷新/重启后保留——用户测试反馈会话态易丢失，跑错本机）。

  // Note: backend runtime flags (rRuntime / pyRuntime) are diagnostic
  // channels for the desktop bridge and MUST stay invisible to the chat
  // surface. Surfacing them here mixes IPC-failure null cases with genuine
  // runtime-missing cases (see lib/electron.d.ts L7-9 "must use === false")
  // and also mis-promotes a backend flag into a user-facing product signal.
  // Tool-level Python runtime issues (e.g. scanpy missing) are surfaced by
  // the tool-execution error path inside conversationRunStore, not here.
  const taRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Slash command state
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  // BLOCK-160 W2 P3（KNW-3）— 斜杠动态条目（Skills+模板；面板打开时拉取，模块级 60s 缓存）
  const [dynamicSlashEntries, setDynamicSlashEntries] = useState<SlashEntry[]>([]);
  const [slashFocusedIndex, setSlashFocusedIndex] = useState(0);
  const slashPanelRef = useRef<HTMLDivElement>(null);
  const slashListRef = useRef<HTMLDivElement>(null);
  // Filtered commands based on query
  const combinedSlashEntries = useMemo(
    () => [
      ...SLASH_COMMANDS.map((cmd) => ({ kind: 'action' as const, id: cmd.id, label: cmd.label, description: cmd.description })),
      ...dynamicSlashEntries,
    ],
    [dynamicSlashEntries]
  );
  const filteredCommands = useMemo(() => filterSlashEntries(combinedSlashEntries, slashQuery), [combinedSlashEntries, slashQuery]);
  // 输入框 ↑/↓ 历史回溯的导航态（null = 未进入导航，输入框即实时草稿）。
  const historyNavRef = useRef<typeof INITIAL_NAV_STATE>(INITIAL_NAV_STATE);
  const activeRun = useConversationRun(conversationId);
  // AGENT-CONCURRENCY A-5: 会话挂载/切换时恢复崩溃或刷新前仍在跑的后台任务
  // （sub-agent 走后端 loop_runs，主 agent 走 localStorage resumable task）。
  // 幂等：已追踪的 sub-agent 会被跳过，已有活跃主 run 时不重复恢复。
  useEffect(() => {
    if (!conversationId) return;
    void resumeOrphanAgentTasks(conversationId, projectId);
  }, [conversationId, projectId]);
  // UI-386 — spawn 自动唤起（自已退役的聊天区聚合条迁入）：
  // 新运行中子 agent → 派发 agentOpenInRail，右栏「智能体」tab 自动切过去。
  // 模块级 Set 保证每 task 只切一次（多 SimpleChat 实例/重挂载不重复）。
  const subTasksForAutoOpen = useSubAgentTasksForConversation(conversationId);
  useEffect(() => {
    for (const t of subTasksForAutoOpen) {
      if (t.status !== 'running') continue;
      const id = t.taskId || '';
      if (!id || autoOpenedSubAgents.has(id)) continue;
      autoOpenedSubAgents.add(id);
      dispatchPetriEvent(petriEvents.agentOpenInRail, { runId: id });
    }
  }, [subTasksForAutoOpen]);
  const durableLoop = useDurableConversationLoop(projectId, conversationId, activeRun?.loop);
  const pendingApproval = activeRun?.pendingApproval || null;

  // Plan 1.6 §4.2 — read Copilot context from React Context, not the
  // module-scope singleton. Captured into a ref so the latest value is
  // always reachable from the latest send callback without re-binding.
  // The ref is shared with useChatStream (which calls `send` from a
  // stable closure) so the activeArtifact / contextToken / etc. used
  // at send time stay correct even when the React Context updates
  // between send scheduling and execution.
  const copilotCtx = useCopilotContext();
  const copilotCtxRef = useRef(copilotCtx);
  useEffect(() => {
    copilotCtxRef.current = copilotCtx;
  }, [copilotCtx]);

  // Plan 1.6 §4.3 — subscribe to the shared SWR conversation cache so
  // the chat header / future list UI stays in sync with sidebar mutations
  // without polling. The hook loads once on mount; `refresh` is invoked
  // after server-driven onConversation events append a new conv.
  const {
    list: conversationList,
    refresh: refreshConversations,
    create: createConversationForRun,
  } = useConversations(projectId);

  // Plan 1.6 §4.5 — read presets + activeId from the shared SWR
  // hook (module-scope cache). The settings panel and this chat
  // panel both subscribe, so a CRUD in one propagates to the
  // other without re-fetching.
  const {
    presets: modelPresets,
    activeId: activeModelId,
    activePreset: activeModel,
    setActive: setActiveModelId,
  } = useAiSettings();

  // BLOCK-69 / UI-318 — 知识空间大脑开关（启用真相在 DB；无 key 禁用不假启用）
  const knowledgeSpace = useKnowledgeSpaceToggle();

  // UI-305 P0.3 — 模型菜单 + 访问档位菜单状态簇（原 322-330 useState/派生 +
  // 1322-1371 分组与 selectModel）整簇抽入 useModelAccessMenus，簇内 hook 相对
  // 顺序保持原样、零行为变化；调用点在 useAiSettings 解构之后。
  const {
    modelMenuOpen,
    setModelMenuOpen,
    setModelSupplierKey,
    accessMenuOpen,
    setAccessMenuOpen,
    accessMode,
    setAccessMode,
    planMode,
    prePlanAccessModeRef,
    accessModeLabel,
    modelGroups,
    activeSupplierGroup,
    selectedSupplierGroup,
    preferredPresetForSupplier,
    selectModel,
  } = useModelAccessMenus({ modelPresets, activeModelId, setActiveModelId, lockedAccessMode });

  // BLOCK-92 Wave A-3 — 焦点管理簇外迁（挂载聚焦 + 窗口获焦/可打印击键兜底，
  // 仅 copilotAsk 拥有者执行；见 ./SimpleChat/hooks/useComposerFocus.ts）。
  useComposerFocus({ taRef, ownsCopilotAsk, accessMenuOpen, modelMenuOpen });

  // 能力位门控（D3 双保险①的 UI 侧）：仅当当前渠道声明 reasoning 才渲染档位控件，
  // 避免对不支持的渠道出现「假开关」。后端仍会二次门控。
  const reasoningSupported = Array.isArray(activeModel?.capabilities)
    && activeModel.capabilities.includes('reasoning');
  // BLOCK-155 真·单通道 vision — 聊天渠道自身视觉能力位（同源读 activeModel.capabilities，
  // 对齐上方 reasoning 能力位读取先例）：渠道声明 vision 时当前轮图片直接内联进聊天请求体，
  // 识图角色未配置（vision_configured=false）也不必前置阻断贴图/拖图。合并放行判据
  // （vision_configured || 渠道视觉能力）单源在 attachments.ts 的 imageInputAllowed。
  const chatVisionCapable = Array.isArray(activeModel?.capabilities)
    && activeModel.capabilities.includes('vision');
  // Ctrl+T 循环档位（对齐 ZCode 习惯）；未声明能力的渠道不响应
  useEffect(() => {
    if (!reasoningSupported) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== 't') return;
      e.preventDefault();
      setThinkingLevel((current) => {
        const next = nextThinkingLevel(current);
        saveThinkingLevel(projectId, conversationId, next);
        return next;
      });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [reasoningSupported, projectId, conversationId]);

  // UI-305 P0.2 — summary retry 状态簇（原 297-303 的 5 个 useState +
  // retrySummary useCallback + UX1H 冷却 tick effect）整簇抽入 useSummaryRetry，
  // 簇内 hook 相对顺序保持原样、零行为变化；调用点在全部依赖声明之后。
  const {
    retrySummary,
    summaryRetryState,
    summaryRetryErrors,
    summaryRetryAttempts,
    summaryRetryCooldownUntil,
    MAX_SUMMARY_RETRIES,
    retryTick,
  } = useSummaryRetry({
    conversationId,
    projectId,
    activeModel,
    activeModelId,
    refreshConversations,
    appendAssistantMessage: (message) => setMessages((current) => [...current, message]),
  });

  // BLOCK-154 波次 3 — 冷却计时采样：retryTick 变化时刷新采样点，行组件以
  // cooldownNow 计算「冷却中 Ns」。tick 调度点（minUntil）不变，标签刷新精度等价；
  // 四个 retry record 的身份不因 tick 变化，行 memo 不被冷却期 tick 击穿。
  const cooldownNow = useMemo(() => Date.now(), [retryTick]);

  // Error formatter hook for user-friendly error display
  const { formatError, getTechnicalDetails } = useErrorFormatter();

  // UI-AGENTWB-004 A4 bridge: opt-in switch for routing
  // assistant messages that carry `meta.resultNodes` through the
  // ResultCard pipeline. Defaults to false so existing users see
  // no change; flip via `localStorage.petri.simplechat.extraRenderers='true'`.
  const extraRenderersFlag = useExtraRenderersFlag();

  // Resolve file references only after a message is fully settled —
  // streaming deltas would otherwise hammer the resolver and we never want
  // to surface a clickable artifact on half-rendered text. We snapshot the
  // latest Copilot context once per settled message and let CopilotMarkdown
  // drive the resolution effect.
  const [settledContext, setSettledContext] = useState<ExtractContext | null>(null);
  const [resolveNonce, setResolveNonce] = useState(0);
  const settledConvRef = useRef<string | null>(conversationId);
  useEffect(() => {
    // Conv switch: clear until the new history finishes loading.
    if (settledConvRef.current !== conversationId) {
      settledConvRef.current = conversationId;
      setSettledContext(null);
    }
  }, [conversationId]);
  useEffect(() => {
    if (loading) return;
    // A page-level active job can belong to another conversation. Settled
    // history therefore resolves only against this project's workspace;
    // explicit petri artifact URIs still carry and verify their own job ID.
    setSettledContext({ projectId });
  }, [loading, projectId]);

  // BLOCK-22 P4.5: line/column forwarding note.
  // FileReferenceClickDetail currently carries no line/column — we default to 1.
  // Future enhancement: extract from the raw URI if it contains a line anchor (e.g. /path#L10).
  const handleFileReferenceClick = useCallback((detail: FileReferenceClickDetail) => {
    const resolved = detail.resolved;
    if (!resolved || resolved.projectId !== projectId) return;
    if (resolved.kind === 'artifact') {
      dispatchPetriEvent(petriEvents.projectOpenArtifact, {
        jobId: resolved.jobId,
        artifactName: resolved.artifactName,
        projectId,
      });
      return;
    }
    dispatchPetriEvent(petriEvents.projectOpenWorkspaceFile, {
      projectId,
      relativePath: resolved.relativePath,
      name: resolved.name,
      openWithSystemApp: shouldOpenWithSystemApp(resolved.name || resolved.relativePath),
      // BLOCK-22 P4.5: default line/column — future: parse from raw URI anchor
      line: 1,
      column: 0,
    });
  }, [projectId]);

  const copyMessage = useCallback(async (messageKey: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageKey(messageKey);
      window.setTimeout(() => {
        setCopiedMessageKey((current) => current === messageKey ? null : current);
      }, 1500);
    } catch {
      // Clipboard may be unavailable in an embedded or non-secure preview.
    }
  }, []);

  // UI-305 P0.4 — 会话恢复/对账簇（原 609-668 三个 effect：消息重载、
  // 隐藏期完结对账、T82 resumable 重连）整簇抽入 useConversationResume，
  // 零行为变化。
  const { reconciledRunRef, older, compaction } = useConversationResume({
    conversationId,
    projectId,
    activeRun,
    refreshConversations,
    setMessages,
    setLoading,
  });

  // BLOCK-92 Wave A-3 — 消息列表派生纯函数外迁（./SimpleChat/displayMessages.ts）：
  // baseDisplayMessages（run/loop 投影合并）→ displayMessages（会话级降级/子 agent
  // 终态 notice 附着），语义与拆分前的两个渲染期 IIFE 逐行一致。
  // BLOCK-95 A2 — 派生链 useMemo 化：此前每次 render（含 composer 输入 keystroke、
  // 菜单开合等无关 state 变化）都全量重拼 250+ 条历史；useMemo 后仅
  // messages/activeRun/durableLoop 变化（真数据变化）才重算。
  const baseDisplayMessages = useMemo(
    () => buildBaseDisplayMessages({ activeRun, conversationId, messages, durableLoop }),
    [activeRun, conversationId, messages, durableLoop]
  );
  const displayMessages = useMemo(
    () => applyConversationNotices({ base: baseDisplayMessages, activeRun, conversationId }),
    [baseDisplayMessages, activeRun, conversationId]
  );

  // BLOCK-107 P1c — 每条 assistant 消息的时间线分段（D1=c：思考/工具按 iteration
  // 交错）。纯派生且与 displayMessages 同一 useMemo 语义：仅在消息真数据变化时
  // 重算，composer keystroke 等无关 state 不触发（沿用 BLOCK-95 A2 的教训）。
  // BLOCK-154 波次 3 — WeakMap 身份缓存：displayMessages 数组每个流式 tick 重建
  // （尾消息替换/推送致新数组），本 map 随之重建；历史消息对象引用恒定，WeakMap
  // 命中即复用原分段数组——行 memo 的 segments prop 身份稳定，未变行零重算零重渲染。
  const timelineSegmentsCacheRef = useRef(new WeakMap<SimpleMessage, ConversationSegment[]>());
  const timelineSegmentsByMessage = useMemo(() => {
    const segmentsCache = timelineSegmentsCacheRef.current;
    const map = new Map<string, ConversationSegment[]>();
    displayMessages.forEach((message, index) => {
      if (message.role !== 'assistant') return;
      let messageSegments = segmentsCache.get(message);
      if (!messageSegments) {
        messageSegments = buildConversationSegments({
          content: message.content,
          toolActivities: message.toolActivities,
          reasoningByIteration: message.reasoningByIteration,
          // D5（P2c）：阶段进度一并入模，由 ConversationTimeline 按 iteration 上轴。
          progressUpdates: message.progressUpdates,
        });
        segmentsCache.set(message, messageSegments);
      }
      map.set(message.id ?? `idx:${index}`, messageSegments);
    });
    return map;
  }, [displayMessages]);
  const standaloneDurableLoop = durableLoop.loop && !displayMessages.some((message) => message.loop)
    ? durableLoop.loop
    : null;

  // T83: does the latest AI reply contain any file references? Drives the
  // fade of the file-reference refresh button when there's nothing to refresh.

  // BLOCK-95 A3 — 自动滚底守卫：用户上翻离开底部后不再强制跟随，浮标一键回底；
  // 发送消息 / 切换会话视为「回到底部」意图，恢复跟随。
  const atBottomRef = useRef(true);
  // BLOCK-95 A1+A3 — 滚动守卫簇（591-642 连续段）抽入 useScrollGuard：
  // 调用点原位保持 hook 顺序；atBottomRef 仍由组件持有（send 路径也写它），
  // prependAnchorRef/olderRef 为簇内私有随簇迁移。
  const { showJumpToBottom, setShowJumpToBottom, scrollToBottom, handleMessagesScroll } = useScrollGuard({
    scrollRef,
    atBottomRef,
    older,
    activeRun,
    durableLoop,
    messages,
    conversationId,
  });

  // BLOCK-95 A4 — 话题转移小节分隔：持久真值=DB last_topic_shift_at（会话列表行），
  // 运行中 SSE onTopicShift 经事件总线即时补充并触发 refreshConversations 固化。
  const [liveTopicShift, setLiveTopicShift] = useState<{ at: string; reason: string } | null>(null);
  useEffect(() => {
    setLiveTopicShift(null);
  }, [conversationId]);
  useEffect(() => {
    return subscribePetriEvent(petriEvents.conversationTopicShift, (detail) => {
      if (detail.conversationId !== conversationId) return;
      setLiveTopicShift({ at: detail.at, reason: detail.reason });
      void refreshConversations();
    });
  }, [conversationId, refreshConversations]);

  // UI-262 — 左缘用户消息导航条（构建逻辑外迁至 ./SimpleChat/displayMessages.ts）。
  const railItems = useMemo(() => buildRailItems(displayMessages), [displayMessages]);

  // BLOCK-95 A4 — 话题小节分隔位置：转移时刻之后的第一条 user 消息。仅持久化
  // 消息（有 id）参与判断——run 投影的临时 user 消息 ts 是发送时刻，晚于检测
  // 完成时刻，会被误标；index 以 displayMessages 计，与渲染 map 直接对齐。
  const activeConversationMeta = conversationList.find((c) => c.id === conversationId);
  const topicShiftAt = liveTopicShift?.at || activeConversationMeta?.last_topic_shift_at || null;
  const topicShiftReason = liveTopicShift?.reason || activeConversationMeta?.last_topic_shift_reason || '';
  const topicShiftIndex = useMemo(() => {
    if (!topicShiftAt) return -1;
    const atMs = Date.parse(topicShiftAt);
    if (Number.isNaN(atMs)) return -1;
    return displayMessages.findIndex(
      (m) => m.role === 'user' && m.id && m.ts && Date.parse(m.ts) >= atMs
    );
  }, [displayMessages, topicShiftAt]);

  const handleRailJump = useCallback((index: number) => {
    const container = scrollRef.current;
    if (!container) return;
    const nodes = container.querySelectorAll<HTMLElement>('.sc-msg-user');
    nodes[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const inputLength = input.trim().length;
  const composerWidth = Math.min(980, Math.max(720, 720 + Math.sqrt(inputLength) * 42));

  // Auto-resize textarea height. Width is handled by the composer CSS var.
  const resizeTextarea = useCallback((ta: HTMLTextAreaElement | null) => {
    if (!ta) return;
    ta.style.height = 'auto';
    const nextHeight = Math.min(Math.max(ta.scrollHeight, 52), 220);
    ta.style.height = `${nextHeight}px`;
  }, []);

  useEffect(() => {
    resizeTextarea(taRef.current);
  }, [input, resizeTextarea]);

  useEffect(() => {
    setInput(loadConversationDraft(projectId, conversationId) || '');
    setQueuedPrompts([]);
    historyNavRef.current = INITIAL_NAV_STATE;
  }, [conversationId, projectId]);

  const onInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);
    saveConversationDraft(projectId, conversationId, value);
    historyNavRef.current = INITIAL_NAV_STATE;
    resizeTextarea(e.target);

    // Slash command detection
    if (value.startsWith('/')) {
      const query = value.slice(1);
      setSlashQuery(query);
      setSlashOpen(true);
      setSlashFocusedIndex(0);
      void fetchSlashEntries().then((entries) => setDynamicSlashEntries(entries));
    } else {
      setSlashOpen(false);
      setSlashQuery('');
    }
  };

  // Drag/drop handlers for file attachments (logic lives in ./SimpleChat/attachments.ts;
  // these wrappers just bind the host component's setters per React's stable-identity rules).
  const handleDragOver = useCallback((e: React.DragEvent) => {
    onDragOver(e, setIsDraggingOver);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    onDragLeave(e, setIsDraggingOver);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    // BLOCK-150 加映 / BLOCK-155 放宽 — 图片前置门（放行判据单源 imageInputAllowed：
    // vision_configured || 聊天渠道视觉能力，两者皆无才阻断；返回提示文案则落 attachmentNotice）
    const notice = onDrop(e, setAttachments, setIsDraggingOver, { visionEnabled: visionConfigured, chatVisionCapable });
    if (notice) setAttachmentNotice(notice);
  }, [visionConfigured, chatVisionCapable]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const notice = onPaste(e, setAttachments, { visionEnabled: visionConfigured, chatVisionCapable });
    if (notice) setAttachmentNotice(notice);
  }, [visionConfigured, chatVisionCapable]);

  const removeAttachment = useCallback((id: string) => {
    removeAttachmentById(id, setAttachments);
  }, []);

  const openPreview = useCallback((attachment: AttachmentFile) => {
    openImagePreview(attachment, setPreviewImage);
  }, []);

  const closePreview = useCallback(() => {
    closeImagePreview(setPreviewImage);
  }, []);

  // BLOCK-9.2 PHASE 4: extracted the 5 stream-related callbacks
  // (send / stop / regenerate / queue / runInBackground) plus the
  // `starting` state, `messagesRef` / `sendRef` indirection, the
  // `copilotAsk` event subscription, and the queue drain effect
  // into useChatStream(). The hook owns the same hooks in the
  // same order they appeared inline here before — see the comment
  // block at the top of useChatStream.ts for the canonical hook
  // sequence. The parent must still surface `streaming` for the
  // JSX rendering (send/stop buttons, copy/regenerate disabled
  // gates, CopilotMarkdown resolveContext) and for the
  // approve/reject/auto-approve callbacks that wrap `send`.
  const {
    send,
    regenerate,
    streaming,
  } = useChatStream({
    projectId,
    conversationId,
    onConversationChange,
    ownsCopilotAsk,
    taRef,
    historyNavRef,
    copilotCtxRef,
    reconciledRunRef,
    setMessages,
    setInput,
    setQueuedPrompts,
    input,
    messages,
    queuedPrompts,
    displayMessages,
    activeRun,
    activeModel,
    activeModelId,
    accessMode,
    planMode,
    createConversationForRun,
    thinkingLevel,
    // UI-373 — 未选项目等宿主侧发送拦截（欢迎页）
    sendGuard,
    // CK-01 — 运行中发送自动 steer 回执（行内轻提示 + 自动消退）
    onSteer: (info) => {
      if (info.ok) {
        const preview = info.text.length > 24 ? info.text.slice(0, 24) + '…' : info.text;
        setSteerNotice('已转向当前任务' + (typeof info.depth === 'number' && info.depth > 1 ? '（排队第 ' + info.depth + ' 位）' : '') + '：' + preview);
      } else {
        setSteerNotice('转向失败：' + (info.error || '未知原因') + '（输入已保留）');
      }
    },
  });

  // BLOCK-92 Wave A-3 — 审批流状态簇外迁（参数草稿同步/harness 修复/自动批准门，
  // 见 ./SimpleChat/hooks/useApprovalFlow.ts）+ 计划批准状态簇外迁（BLOCK-55，
  // 见 ./SimpleChat/hooks/usePlanApprovalFlow.ts）。调用点依赖 send/streaming，
  // 故置于 useChatStream 之后。
  const {
    approvalRepair,
    approvePending,
    rejectPending,
  } = useApprovalFlow({
    pendingApproval,
    streaming,
    accessMode,
    copilotCtxRef,
    projectId,
    conversationId,
    send,
  });
  const {
    pendingPlan,
    setPendingPlan,
    pendingRevision,
    planCardBusy,
    handlePlanApprove,
    handleRevisionApprove,
  } = usePlanApprovalFlow({
    conversationId,
    streaming,
    send,
    setAccessMode,
    prePlanAccessModeRef,
  });

  // BLOCK-52 P1（选中即引用）：带引用块的发送包装——发送前把引用块渲染进
  // 消息正文，接受成功后清空引用块；被守卫拦截（空文本 / 运行中）时保留待重试。
  // BLOCK-52 P2：图片引用卡同管道——artifact 元数据合成进正文，成功后一并清空。
  const sendWithRefs = useCallback(async (text: string): Promise<boolean> => {
    // BLOCK-91 — 附件真实接入：发送前上传到工作区 .chat-attachments/，
    // 消息追加引用行（模型按路径读取，与 imageRefs 同构）。无项目（欢迎页）
    // 诚实报错——不再静默丢弃附件。
    let attachmentBlock = '';
    if (attachments.length > 0) {
      if (!projectId) {
        setAttachmentNotice('附件需在项目工作区中使用；请先选择项目再发送附件');
        return false;
      }
      try {
        const refs = [];
        for (const att of attachments) {
          refs.push(await uploadAttachment(projectId, att));
        }
        attachmentBlock = composeAttachmentReferenceLines(refs);
      } catch (error) {
        setAttachmentNotice((error as Error).message || '附件上传失败');
        return false;
      }
    }
    const composed = composeMessageWithImageReferences(
      composeMessageWithSelectionReferences(text, selectionRefsRef.current),
      imageRefsRef.current,
    ) + attachmentBlock;
    // A3 — 用户主动发送 = 回到底部意图，恢复自动跟随。
    atBottomRef.current = true;
    setShowJumpToBottom(false);
    const ok = await send(composed);
    if (ok) {
      setSelectionRefs([]);
      setImageRefs([]);
      if (attachments.length > 0) {
        for (const att of attachments) {
          if (att.previewUrl && !att.dataUrl) URL.revokeObjectURL(att.previewUrl);
        }
        setAttachments([]);
        setAttachmentNotice(null);
      }
    }
    return ok;
  }, [send, attachments, projectId]);

  // BLOCK-68 / UI-317 —— 「刷新文件链接」入口删除后改自动化（hook 外迁可单测）：
  // 订阅 agent 写档/数据导入信号，debounce 后清解析缓存并 bump resolveNonce。
  useAutoFileReferenceRefresh(() => setResolveNonce((value) => value + 1));

  // BLOCK-92 Wave A-3 — fork 状态簇（./SimpleChat/hooks/useForkConversation.ts）
  // 与 token 预算事件状态（./SimpleChat/hooks/useTokenBudgetState.ts）外迁。
  const { forkingAtIndex, handleForkAt } = useForkConversation({
    conversationId,
    projectId,
    refreshConversations,
    onConversationChange,
  });
  const tokenBudget = useTokenBudgetState();

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Handle slash command navigation
    if (slashOpen) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashFocusedIndex((prev) => Math.max(0, prev - 1));
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashFocusedIndex((prev) => Math.min(filteredCommands.length - 1, prev + 1));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = filteredCommands[slashFocusedIndex];
        if (cmd) executeSlashCommand(cmd.id);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashOpen(false);
        setSlashQuery('');
        return;
      }
      // If user types something other than part of query (like space after /), close panel
      if (e.key === ' ' && input === '/') {
        e.preventDefault();
        setSlashOpen(false);
        setSlashQuery('');
        return;
      }
    }

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const direction = e.key === 'ArrowUp' ? 'up' : 'down';
      // 历史源：本会话已发送的用户消息，最新在前（反序）。
      const history = messages
        .filter((m) => m.role === 'user')
        .map((m) => m.content ?? '')
        .filter((c) => c.trim() !== '')
        .reverse();
      const { state, value } = stepHistoryNavigation(
        history,
        historyNavRef.current,
        direction,
        input,
      );
      historyNavRef.current = state;
      const changed = value !== input;
      if (changed) setInput(value);
      // 仅在真正切换了历史时才拦截默认行为，避免空历史/最旧处打断多行光标移动。
      if (changed) e.preventDefault();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const trimmed = input.trim();
      if (!trimmed) return;
      if (streaming) {
        // BLOCK-52 P1：排队消息同样携带当前引用块，入列后清空。
        const queuedWithRefs = composeMessageWithSelectionReferences(trimmed, selectionRefsRef.current);
        // BLOCK-102 P2 — 归属标记与 queue() 同款
        setQueuedPrompts((current) => [...current, { conversationId, text: queuedWithRefs }].slice(-5));
        setInput('');
        historyNavRef.current = INITIAL_NAV_STATE;
        clearConversationDraft(projectId, conversationId);
        if (taRef.current) taRef.current.style.height = 'auto';
        setSelectionRefs([]);
      } else {
        void sendWithRefs(trimmed);
      }
    }
  };

  // BLOCK-28.8 — 移除排队/停止生成按钮（用户裁决）：
  // 流式期间仅保留禁用态发送按钮；stop/queue 能力保留在 useChatStream 内，
  // 需要时可经事件或快捷键恢复。

  // Create new conversation
  const newConversation = useCallback(() => {
    onConversationChange(null);
    setMessages([]);
    setQueuedPrompts([]);
  }, [onConversationChange]);

  // Slash command handler
  const executeSlashCommand = useCallback((commandId: string) => {
    switch (commandId) {
      case 'new':
        void newConversation();
        break;
      case 'clear':
        setMessages([]);
        clearConversationDraft(projectId, conversationId);
        break;
      case 'model':
        setModelMenuOpen((current) => current ? null : 'model');
        break;
      case 'export': {
        const markdown = displayMessages
          .map((m) => `### ${m.role === 'user' ? '用户' : 'AI'}\n\n${m.content}\n`)
          .join('\n---\n\n');
        const blob = new Blob([`# 对话导出\n\n> 导出时间: ${new Date().toLocaleString()}\n\n---\n\n${markdown}`], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `conversation-${Date.now()}.md`;
        a.click();
        URL.revokeObjectURL(url);
        break;
      }
      case 'help':
        setSlashQuery('');
        break;
    }
    // BLOCK-160 W2 P3（KNW-3）— 执行意图条目：注入文本模板而非执行 UI 动作
    if (commandId.startsWith('skill:') || commandId.startsWith('template:')) {
      const kind = commandId.startsWith('skill:') ? 'skill' : 'template';
      const id = commandId.slice(kind.length + 1);
      const template = slashIntentTemplate({ kind, id, label: '', description: '' });
      setInput(template);
      saveConversationDraft(projectId, conversationId, template);
      setSlashOpen(false);
      setSlashQuery('');
      historyNavRef.current = INITIAL_NAV_STATE;
      requestAnimationFrame(() => {
        if (taRef.current) {
          taRef.current.focus();
          taRef.current.setSelectionRange(template.length, template.length);
          resizeTextarea(taRef.current);
        }
      });
      return;
    }
    // Close panel and clear input
    setSlashOpen(false);
    setSlashQuery('');
    setInput('');
    historyNavRef.current = INITIAL_NAV_STATE;
    clearConversationDraft(projectId, conversationId);
    if (taRef.current) taRef.current.style.height = 'auto';
  }, [newConversation, projectId, conversationId, displayMessages, resizeTextarea]);

  // Close slash panel on outside click
  useEffect(() => {
    if (!slashOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (slashPanelRef.current && !slashPanelRef.current.contains(e.target as Node)) {
        setSlashOpen(false);
        setSlashQuery('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [slashOpen]);

  // Handle example prompt selection
  const handleExampleSelect = useCallback((prompt: string) => {
    setInput(prompt);
    saveConversationDraft(projectId, conversationId, prompt);
    taRef.current?.focus();
  }, [projectId, conversationId]);

  // 2026-09-18 历史残留清理 — 领域感知示例卡（通用卡兜底 + 已装领域包动态追加）
  const examplePrompts = useDomainExamplePrompts();

  const examplePromptsToShow = displayMessages.length === 0 ? examplePrompts : [];

  return (
    <div className={`sc-outer${composerOnly ? ' sc-outer-composer-only' : ''}`} data-rail-body>
      <div className={`sc-root${composerOnly ? ' sc-root-composer-only' : ''}`}>
        <div className="sc-body">
          <div className="sc-messages" ref={scrollRef} onScroll={handleMessagesScroll}>
          {older.loadingMore && <div className="sc-loading-older">加载更早消息…</div>}
          {/* BLOCK-95 B2/A5 — 压缩诚实可见：LLM 视图中更早上下文已折叠为摘要（本界面仍显示原文） */}
          {compaction && !composerOnly && displayMessages.length > 0 && (
            <div className="sc-compaction-notice" role="status" title={compaction.summary}>
              <Icon name="layers" size={13} />
              <span>
                上下文压缩视图：更早的 {compaction.coversCount} 条消息已折叠为摘要参与对话
                <span className="sc-compaction-notice-sub">（此处仍显示原文 · {compaction.sourceTokens} tokens 已压缩）</span>
              </span>
            </div>
          )}
          {loading && <div className="sc-loading">加载会话…</div>}
          {!loading && displayMessages.length === 0 && (
            <div className="sc-empty">
              <div className="sc-empty-icon">
                <Icon name="message-circle" size={32} />
              </div>
              <p>开始新的对话</p>
              <span>在下方输入框中提问</span>
              {examplePromptsToShow.length > 0 && (
                <ExamplePrompts prompts={examplePromptsToShow} onSelect={handleExampleSelect} />
              )}
            </div>
          )}
          {/* BLOCK-154 波次 3 — 行渲染走 memo 化 SimpleChatMessageRow：历史消息对象
              引用恒定（派生链 slice+尾替换）+ 回调/记录身份稳定 → 流式 tick 只重渲染
              实际变化的行；topicShift 分隔与行 DOM 结构逐行保留在行组件内。 */}
          {displayMessages.map((m, i) => {
            const key = m.ts ? `${m.role}-${m.ts}-${i}` : `${m.role}-${i}`;
            return (
              <SimpleChatMessageRow
                key={key}
                m={m}
                messageKey={key}
                isTopicShiftStart={i === topicShiftIndex}
                topicShiftReason={topicShiftReason}
                segments={timelineSegmentsByMessage.get(m.id ?? `idx:${i}`) ?? EMPTY_ROW_SEGMENTS}
                streaming={streaming}
                settledContext={settledContext}
                resolveNonce={resolveNonce}
                extraRenderersFlag={extraRenderersFlag}
                conversationId={conversationId}
                projectId={projectId}
                copiedMessageKey={copiedMessageKey}
                forkingAtIndex={forkingAtIndex}
                forkAbsoluteIndex={older.windowOffset + i}
                summaryRetryState={summaryRetryState}
                summaryRetryErrors={summaryRetryErrors}
                summaryRetryAttempts={summaryRetryAttempts}
                summaryRetryCooldownUntil={summaryRetryCooldownUntil}
                cooldownNow={cooldownNow}
                maxSummaryRetries={MAX_SUMMARY_RETRIES}
                formatError={formatError}
                getTechnicalDetails={getTechnicalDetails}
                onFileReferenceClick={handleFileReferenceClick}
                onCopyMessage={copyMessage}
                onRegenerate={regenerate}
                onForkAt={handleForkAt}
                onRetrySummary={retrySummary}
              />
            );
          })}
          {standaloneDurableLoop && (
            <div className="sc-msg sc-msg-assistant" aria-label="历史任务循环">
              <div className="sc-msg-avatar">
                <Icon name="cpu" size={16} />
              </div>
              <div className="sc-msg-body">
                <LoopStatusPanel loop={standaloneDurableLoop} pending={false} />
              </div>
            </div>
          )}
          {pendingApproval && accessMode !== 'full' && (
            <ApprovalCard
              approval={pendingApproval}
              repairState={approvalRepair}
              onApprove={() => void approvePending()}
              onReject={() => void rejectPending()}
              busy={streaming}
            />
          )}
        </div>

        {/* BLOCK-55 P1/P3 — 计划批准卡 + 修订批准条（仅在有待批准内容时渲染） */}
        {pendingPlan && (
          <PlanApprovalCard
            plan={pendingPlan}
            busy={planCardBusy}
            onApprove={(action) => void handlePlanApprove(action)}
            onDismiss={() => setPendingPlan(null)}
          />
        )}
        {pendingRevision && !pendingPlan && (
          <div className="sc-plan-revision-banner" role="status">
            <Icon name="git-branch" size={14} />
            <span className="sc-plan-revision-text">
              计划「{pendingRevision.title}」有待批准修订案 #{pendingRevision.revNo}
            </span>
            <button
              type="button"
              className="sc-plan-approval-btn sc-plan-approval-btn-primary"
              disabled={planCardBusy}
              onClick={() => void handleRevisionApprove()}
            >
              批准修订
            </button>
          </div>
        )}

        {/* UI-386 — 聊天区子智能体聚合条退役：聚合/历史图标化进摘要卡「智能体」节，
            实时状态由时间线内联卡 + 右栏「智能体」tab 承载 */}
        <div
          className="sc-input-area"
          style={{ ['--sc-composer-width' as string]: `${composerWidth}px` }}
        >
          {/* BLOCK-95 A3 — 回到底部浮标：锚定输入区顶缘（bottom:100%），用户上翻且
              距底 >600px 时出现，点击回底并恢复自动跟随 */}
          {showJumpToBottom && !composerOnly && (
            <button
              type="button"
              className="sc-jump-bottom"
              onClick={() => scrollToBottom(true)}
              aria-label="回到底部"
            >
              <Icon name="chevron-down" size={14} />
              回到底部
            </button>
          )}
          {/* Slash command panel */}
          {slashOpen && (
            <div className="sc-slash-panel" ref={slashPanelRef}>
              <div className="sc-slash-header">
                <span className="sc-slash-title">命令</span>
                <span className="sc-slash-hint">↑↓ 导航 · Enter 执行 · Esc 关闭</span>
              </div>
              <div className="sc-slash-list" ref={slashListRef}>
                {filteredCommands.length === 0 ? (
                  <div className="sc-slash-empty">未找到匹配命令</div>
                ) : (
                  filteredCommands.map((cmd, index) => (
                    <button
                      key={`${cmd.kind}:${cmd.id}`}
                      type="button"
                      className={`sc-slash-item ${index === slashFocusedIndex ? 'sc-slash-item-focused' : ''}`}
                      onClick={() => executeSlashCommand(cmd.kind === 'action' ? cmd.id : `${cmd.kind}:${cmd.id}`)}
                      onMouseEnter={() => setSlashFocusedIndex(index)}
                    >
                      {cmd.kind !== 'action' && (
                        <span
                          className="sc-slash-item-label"
                          style={{ marginRight: 6, fontSize: 'var(--petri-font-size-caption, 12px)', color: 'var(--petri-accent, #3b82f6)' }}
                        >
                          {cmd.kind === 'skill' ? '技能' : '模板'}
                        </span>
                      )}
                      <span className="sc-slash-item-label">{cmd.label}</span>
                      <span className="sc-slash-item-desc">{cmd.description}</span>
                    </button>
                  ))
                )}
              </div>
              {slashQuery === '' && filteredCommands.length > 0 && (
                <div className="sc-slash-help-hint">输入 / 或命令名称搜索</div>
              )}
            </div>
          )}
          <div
            ref={composerBarRef}
            className={`sc-composer${isDraggingOver ? ' sc-composer-dragging' : ''}${slimComposer ? ' sc-composer-slim' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onPaste={handlePaste}
          >
            {/* BLOCK-91 — 附件守卫/失败提示 */}
            {attachmentNotice && (
              <div className="sc-attachment-notice" role="alert">{attachmentNotice}</div>
            )}
            {steerNotice && (
              <div className="sc-attachment-notice" role="status">{steerNotice}</div>
            )}
            {/* Attachments preview */}
            {attachments.length > 0 && (
              <div className="sc-attachments">
                {attachments.map((att) => (
                  <div key={att.id} className="sc-attachment">
                    {att.previewUrl ? (
                      <button
                        type="button"
                        className="sc-attachment-preview-btn"
                        onClick={() => openPreview(att)}
                        title={`预览 ${att.name}`}
                        aria-label={`预览 ${att.name}`}
                      >
                        <img
                          src={att.previewUrl}
                          alt={att.name}
                          className="sc-attachment-thumb"
                        />
                        <span className="sc-attachment-overlay">
                          <Icon name="eye" size={16} />
                        </span>
                      </button>
                    ) : (
                      <div className="sc-attachment-file">
                        <Icon name="file" size={20} />
                      </div>
                    )}
                    {/* UI-477 加映（用户裁决「直接是个缩小的图就行」）：图片附件
                        不再显示文件名（缩略图即语义）；非图片文件保留文件名。 */}
                    {!att.previewUrl && (
                      <span className="sc-attachment-name" title={att.name}>
                        {att.name}
                      </span>
                    )}
                    <button
                      type="button"
                      className="sc-attachment-remove"
                      onClick={() => removeAttachment(att.id)}
                      title="移除"
                      aria-label="移除"
                    >
                      <Icon name="x" size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {/* BLOCK-52 P1 — 选中即引用条：右栏预览选中的文字块，随下一条消息发送 */}
            {selectionRefs.length > 0 && (
              <div className="sc-selection-refs">
                {selectionRefs.map((ref) => (
                  <div
                    key={ref.id}
                    className="sc-selection-ref"
                    title={`${selectionReferenceLocation(ref)}\n${ref.text}`}
                  >
                    <Icon name="file" size={12} />
                    <span className="sc-selection-ref-loc">{selectionReferenceLocation(ref)}</span>
                    <span className="sc-selection-ref-text">{selectionReferenceChipLabel(ref)}</span>
                    <button
                      type="button"
                      className="sc-selection-ref-remove"
                      onClick={() => removeSelectionRef(ref.id)}
                      title="移除引用"
                      aria-label="移除引用"
                    >
                      <Icon name="x" size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {/* BLOCK-52 P2 — 图片引用卡：右栏图片预览选中的图片，随下一条消息发送 */}
            {imageRefs.length > 0 && (
              <div className="sc-image-refs">
                {imageRefs.map((ref) => (
                  <div
                    key={ref.id}
                    className="sc-image-ref"
                    title={imageReferenceSourceLine(ref)}
                  >
                    <img
                      src={ref.url}
                      alt={ref.name}
                      className="sc-image-ref-thumb"
                      draggable={false}
                    />
                    <span className="sc-image-ref-name" title={ref.name}>{ref.name}</span>
                    <span className="sc-image-ref-source">{imageReferenceSourceLine(ref)}</span>
                    <button
                      type="button"
                      className="sc-image-ref-remove"
                      onClick={() => removeImageRef(ref.id)}
                      title="移除图片引用"
                      aria-label="移除图片引用"
                    >
                      <Icon name="x" size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="sc-composer-body">
              <textarea
                ref={taRef}
                className="sc-input"
                rows={1}
                value={input}
                placeholder={composerPlaceholder(compact)}
                onChange={onInputChange}
                onKeyDown={onKeyDown}
              />
            </div>
            <div className="sc-composer-bar">
              <div className="sc-composer-left">
                {/* BLOCK-60：死控件 + 已移除；刷新/I-O 收进 ⋯ 溢出菜单 */}
                <div className="sc-access-picker">
                  {conversationId && !slimComposer ? (
                    <button
                      type="button"
                      className="sc-access-btn"
                      onClick={handleExportConversation}
                      title="导出会话为 Markdown"
                    >
                      <Icon name="download" size={14} />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="sc-access-btn"
                    onClick={() => setAccessMenuOpen((value) => !value)}
                    disabled={Boolean(lockedAccessMode)}
                    title={lockedAccessMode
                      ? '此面板仅聊天（只读档）：如需修改文件请回中栏输入'
                      : '选择访问模式'}
                  >
                    <Icon name="shield" size={14} />
                    <span>{accessModeLabel}</span>
                    {!lockedAccessMode && <Icon name="chevron-down" size={12} />}
                  </button>
                  {accessMenuOpen && (
                    <>
                      <div className="sc-access-overlay" onClick={() => setAccessMenuOpen(false)} />
                      <div className="sc-access-menu">
                        <button
                          type="button"
                          className={`sc-access-option ${accessMode === 'full' ? 'sc-access-option-active' : ''}`}
                          onClick={() => {
                            setAccessMode('full');
                            setAccessMenuOpen(false);
                          }}
                        >
                          <span className="sc-access-option-title">完全访问</span>
                          <span className="sc-access-option-sub">允许命令行、文件修改与工具调用</span>
                        </button>
                        <button
                          type="button"
                          className={`sc-access-option ${accessMode === 'workspace-write' ? 'sc-access-option-active' : ''}`}
                          onClick={() => {
                            setAccessMode('workspace-write');
                            setAccessMenuOpen(false);
                          }}
                        >
                          <span className="sc-access-option-title">项目写</span>
                          <span className="sc-access-option-sub">允许项目内文件修改与前台命令；后台进程与插件执行不可用</span>
                        </button>
                        {/* UI-303 — 计划模式并入档位菜单（BLOCK-55 Spec 门）：只读探索 + 起草计划 */}
                        <button
                          type="button"
                          className={`sc-access-option ${accessMode === 'plan' ? 'sc-access-option-active' : ''}`}
                          onClick={() => {
                            if (accessMode !== 'plan') prePlanAccessModeRef.current = accessMode;
                            setAccessMode('plan');
                            setAccessMenuOpen(false);
                          }}
                        >
                          <span className="sc-access-option-title">计划模式</span>
                          <span className="sc-access-option-sub">只读探索并起草计划，获批后再执行</span>
                        </button>
                        <button
                          type="button"
                          className={`sc-access-option ${accessMode === 'read' ? 'sc-access-option-active' : ''}`}
                          onClick={() => {
                            setAccessMode('read');
                            setAccessMenuOpen(false);
                          }}
                        >
                          <span className="sc-access-option-title">只读模式</span>
                          <span className="sc-access-option-sub">仅浏览、解释和建议</span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
                {/* UI-303 — 独立「计划模式」开关已并入左侧档位菜单第四档，composer 不再承载 */}
                {/* BLOCK-57 UI-290 + BLOCK-60 — 执行目标选择已迁至 设置→计算与数据（默认执行目标），composer 不再承载 */}
                {/* BLOCK-69 / UI-318 — 知识空间大脑开关（独立 icon 开关，不挂已移除的 ⋯ 菜单） */}
                <button
                  type="button"
                  className={`sc-knowledge-toggle${knowledgeSpace.enabled ? ' sc-knowledge-toggle-on' : ''}`}
                  onClick={() => void knowledgeSpace.toggle()}
                  disabled={knowledgeSpace.busy || !knowledgeSpace.embeddingAvailable}
                  title={
                    !knowledgeSpace.embeddingAvailable
                      ? '知识空间不可用：请先在设置中配置 DashScope key'
                      : knowledgeSpace.enabled
                        ? '知识空间已启用：对话自动检索知识库（点击关闭）'
                        : '启用知识空间：对话自动检索知识库'
                  }
                  data-testid="knowledge-composer-toggle"
                >
                  <Icon name="brain" size={14} />
                </button>
              </div>
              <div className="sc-composer-right">
                {/* BLOCK-68 / UI-317 —— ⋯ 工具菜单整体移除：刷新文件链接改自动化
                    （订阅 projectWorkspaceChanged），模型 I/O 迁右栏 tab；不预留空壳 */}
                {/* BLOCK-20: live context-budget ring — UI-301 加映：移到供应商左侧；
                    UI-448 加映 v3 — slimComposer 悬挂面不渲染 */}
                {!slimComposer && <ContextBudgetButton budget={tokenBudget} activeContextWindow={undefined} />}
                <div className="sc-model-picker-pair">
                  <div className="sc-model-picker sc-model-picker-footer">
                    <button
                      type="button"
                      className="sc-model-btn sc-model-provider-btn"
                      onClick={() => {
                        setModelSupplierKey(activeSupplierGroup?.key || null);
                        setModelMenuOpen((current) => current === 'supplier' ? null : 'supplier');
                      }}
                      title={activeSupplierGroup?.supplier || activeModel?.label || '选择供应商'}
                    >
                      {composerNarrow
                        ? <Icon name="cpu" size={14} />
                        : <span>{activeSupplierGroup?.supplier || activeModel?.label || '供应商'}</span>}
                      <Icon name="chevron-down" size={12} />
                    </button>
                  </div>
                  <div className="sc-model-picker sc-model-picker-footer">
                    <button
                      type="button"
                      className="sc-model-btn sc-model-name-btn"
                      onClick={() => {
                        setModelSupplierKey(selectedSupplierGroup?.key || null);
                        setModelMenuOpen((current) => current === 'model' ? null : 'model');
                      }}
                      title={activeModel?.model || '选择会话模型'}
                    >
                      {composerNarrow
                        ? <Icon name="zap" size={14} />
                        : <span>{activeModel?.model || '选择模型'}</span>}
                      <Icon name="chevron-down" size={12} />
                    </button>
                  </div>
                  {reasoningSupported && (
                    <div className="sc-model-picker sc-model-picker-footer">
                      <button
                        type="button"
                        className="sc-model-btn sc-thinking-btn"
                        onClick={() => setThinkingMenuOpen((current) => !current)}
                        title={`思考档位：${THINKING_LEVEL_LABELS[thinkingLevel]}（Ctrl+T 循环切换）`}
                        aria-label={`思考档位：${THINKING_LEVEL_LABELS[thinkingLevel]}`}
                        aria-expanded={thinkingMenuOpen}
                        data-testid="thinking-level-trigger"
                        data-level={thinkingLevel}
                      >
                        <Icon name="brain" size={14} />
                        {!composerNarrow && <span>{THINKING_LEVEL_LABELS[thinkingLevel]}</span>}
                        <Icon name="chevron-down" size={12} />
                      </button>
                    </div>
                  )}
                  {thinkingMenuOpen && (
                    <>
                      <div className="sc-model-overlay" onClick={() => setThinkingMenuOpen(false)} />
                      <div className="sc-model-menu" role="menu" aria-label="思考档位">
                        {THINKING_LEVELS.map((level) => (
                          <button
                            type="button"
                            key={level}
                            className="sc-model-option"
                            role="menuitemradio"
                            aria-checked={level === thinkingLevel}
                            data-testid={`thinking-level-option-${level}`}
                            onClick={() => applyThinkingLevel(level)}
                            title={level === 'standard' ? '不发任何思考参数（默认）' : undefined}
                          >
                            <span className="sc-model-option-title">{THINKING_LEVEL_LABELS[level]}</span>
                            <span className="sc-model-option-meta">
                              {level === thinkingLevel ? '当前使用' : level === 'standard' ? '默认·不发参数' : '点击切换'}
                            </span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  {modelMenuOpen && (
                    <>
                      <div className="sc-model-overlay" onClick={() => setModelMenuOpen(null)} />
                      <div className="sc-model-menu">
                        {modelMenuOpen === 'supplier' ? modelGroups.map((group) => (
                          <button
                            type="button"
                            key={group.key}
                            className={`sc-model-option ${group.key === selectedSupplierGroup?.key ? 'sc-model-option-active' : ''}`}
                            onClick={() => {
                              setModelSupplierKey(group.key);
                              const preferred = preferredPresetForSupplier(group);
                              if (preferred) void selectModel(preferred);
                            }}
                          >
                            <span className="sc-model-option-title">{group.supplier}</span>
                            <span className="sc-model-option-meta">{group.presets.length} 个模型</span>
                          </button>
                        )) : selectedSupplierGroup?.presets.map((preset) => (
                          <button
                            type="button"
                            key={preset.id}
                            className={`sc-model-option ${preset.id === activeModelId ? 'sc-model-option-active' : ''}`}
                            onClick={() => void selectModel(preset)}
                          >
                            <span className="sc-model-option-title">{preset.model}</span>
                            <span className="sc-model-option-meta">
                              {preset.id === activeModelId ? '当前使用' : '点击切换'}
                            </span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                <button
                  className="sc-send-cta sc-send-cta-send"
                  onClick={() => void sendWithRefs(input)}
                  disabled={!input.trim() || streaming}
                  title={streaming ? '任务进行中…' : activeRun?.status === 'running' ? '发送 · 将转向当前任务' : '发送消息'}
                >
                  <Icon name="arrow-up" size={12} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>

      {/* UI-262 — 聊天区左缘用户消息导航条：锚定 sc-outer（会话栏最左边界），
          会话内容卡片（sc-root）固定宽度居中时 rail 仍贴列缘；悬浮预览、点击跳转对应消息。
          UI-448 加映 v5 — 悬挂面（slimComposer）不渲染：300px 面板内刻度条挤占正文宽度 */}
      {!slimComposer && railItems.length > 0 && <MessageRail items={railItems} onJump={handleRailJump} />}

      {/* UI-269 — 右缘自定义滚动条：锚定 sc-outer（会话栏最右边界），与 rail 左右对称；
          隐藏系统原生 thumb，常驻纤细 thumb + 轨道线 */}
      {!composerOnly && <ChatScrollbar containerRef={scrollRef} />}

      {/* UI-268: 「后台进程」浮窗（持久输出独立小窗口） */}
      <ToolActivityDock conversationId={conversationId} projectId={projectId} />

      {/* Image Preview Modal */}
      {previewImage && (
        <ImagePreviewModal
          attachment={previewImage}
          onClose={closePreview}
        />
      )}
    </div>
  );
}

// ImagePreviewModal (and ImagePreviewModalProps) moved to ./SimpleChat/ImagePreviewModal.tsx (BLOCK-9.2 PHASE 4).
// The canonical component is imported at the top of this file and re-exported from
// the header for any consumer reaching it via the SimpleChat path.


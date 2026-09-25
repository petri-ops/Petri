import { useCallback, useSyncExternalStore } from 'react';
import type { CopilotContext } from '@/lib/copilotContext';
import { gewuEvents, dispatchGewuEvent } from '@/lib/events';
import {
  cancelAgentTask,
  fetchInFlightPrimaryTasks,
  resumeAgentTask,
  streamChat,
  subscribeAgentTask,
  type AgentTaskTodoItem,
  type KnowledgeCitation,
  type ChatMessage,
  type ToolCallEvent,
  type ToolOutputEvent,
  type ToolResultEvent,
  type ResultEditProgressEvent,
  type StreamChatOptions,
} from './copilotClient';
export type { AgentTaskTodoItem, KnowledgeCitation } from './copilotClient';
import {
  mergeToolCallActivity,
  mergeToolOutputActivity,
  mergeToolResultActivity,
} from './toolActivity';
import { formatErrorForUser } from './errorMessages';
import { recordConversationFileChange } from './conversationChangesStore';
import {
  clearConversationNotices,
  pushChildFinishedNotice,
  setFallbackNotice,
} from './conversationRunStore/conversationNotices';
import {
  clearConversationTodo,
  clearConversationTodosForTests,
  getConversationTodoList,
  setConversationTodoList,
  subscribeConversationTodo,
} from './conversationRunStore/conversationTodos';
import {
  clearConversationCitations,
  clearConversationCitationsForTests,
  getConversationCitations,
  setConversationCitations,
  subscribeConversationCitations,
} from './conversationRunStore/conversationCitations';
export { getConversationTodoList } from './conversationRunStore/conversationTodos';
export { getConversationCitations } from './conversationRunStore/conversationCitations';
export { clearConversationTodosForTests as __resetConversationTodosForTests };
export { clearConversationCitationsForTests as __resetConversationCitationsForTests };
import {
  clearConversationRunListeners,
  emitConversationRun as emit,
  subscribeConversationRun,
} from './conversationRunStore/runListeners';
import { mergeLoopIteration, mergeLoopPhase } from './conversationRunStore/loopProjection';
import {
  __resetSubAgentTaskStoresForTests,
  recordModelSubAgent,
  resumeSubAgentTasks,
  settleModelSubAgent,
} from './conversationRunStore/subAgentTasks';
import type { ConversationRunSnapshot } from './conversationRunStore/types';

// BLOCK-92 家法：原 import 路径保留 re-export 兼容层——消费方与测试零改动。
// 类型与子 agent 子系统的实现分别在 conversationRunStore/ 子模块中。
export type {
  ChildFinishedNotice,
  ConversationLoopState,
  ConversationPendingApproval,
  ConversationRunSnapshot,
  ConversationRunStatus,
} from './conversationRunStore/types';
export {
  getConversationFallbackNotice,
  getChildFinishedNotices,
} from './conversationRunStore/conversationNotices';
export { subscribeConversationRun } from './conversationRunStore/runListeners';
export {
  getSubAgentTaskSnapshot,
  listSubAgentTasksForConversation,
  resumeSubAgentTasks,
  startSubAgentTask,
  stopSubAgentTask,
  subscribeSubAgentTask,
  useSubAgentTasksForConversation,
} from './conversationRunStore/subAgentTasks';
export type { StartSubAgentTaskOptions } from './conversationRunStore/subAgentTasks';

interface StartConversationRunOptions {
  conversationId: string;
  projectId: string;
  userContent: string;
  historyLastUserTs?: string;
  messages: ChatMessage[];
  context: CopilotContext;
  modelPresetId?: string;
  modelName?: string;
  /**
   * AGENT-CONCURRENCY A-5: 恢复模式。提供则跳过重新提交，直接订阅该已存在
   * 的 task 事件流（崩溃/刷新前仍在跑的主 agent），用于 app 启动/会话重开时
   * 避免主 run 孤儿化。userContent 退化为占位提示。
   */
  resumeTaskId?: string;
  /**
   * BLOCK-38 P2 — 被续跑的原 taskId（审计链）。续跑 run 的快照携带此字段，
   * 供 UI 展示「续跑自 xxx」；不影响事件流订阅逻辑。
   */
  resumeOfTaskId?: string;
  /** BLOCK-81 P1 — 思考档位（缺省不发参；P2 起由 composer 档位控件提供） */
  thinkingLevel?: 'off' | 'standard' | 'high';
}

const runs = new Map<string, ConversationRunSnapshot>();
const controllers = new Map<string, AbortController>();

// BLOCK-49 加映二 —— 模型 spawn_agent 派生的子 agent 登记（活动面板数据源）。
// spawn 的 task 文本从 tool_call args 捕获（tool_result 只有 agentId），
// 按 callId 关联到 tool_result。BLOCK-93 P2：args.role 一并捕获（显式角色）。
const pendingSpawnTaskText = new Map<string, { taskText: string; role?: string }>();

// BLOCK-56 P1 / UI-287 — 模型降级提示按会话保留（会话级独立存储，
// 见 conversationRunStore/conversationNotices.ts）。
// BLOCK-49 加映 — 子 agent 终态通知同理（同模块）。

function replaceRun(
  conversationId: string,
  update: (current: ConversationRunSnapshot) => ConversationRunSnapshot
): void {
  const current = runs.get(conversationId);
  if (!current) return;
  runs.set(conversationId, update(current));
  emit(conversationId);
}

export function getConversationRunSnapshot(
  conversationId: string | null | undefined
): ConversationRunSnapshot | null {
  return conversationId ? runs.get(conversationId) || null : null;
}

export function useConversationRun(
  conversationId: string | null | undefined
): ConversationRunSnapshot | null {
  const subscribe = useCallback(
    (listener: () => void) => subscribeConversationRun(conversationId, listener),
    [conversationId]
  );
  const getSnapshot = useCallback(
    () => getConversationRunSnapshot(conversationId),
    [conversationId]
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** BLOCK-97 — 当前会话任务清单（会话级存储订阅；task_todo 实时勾选数据源）。 */
export function useConversationTodoList(
  conversationId: string | null | undefined
): AgentTaskTodoItem[] {
  const subscribe = useCallback(
    (listener: () => void) => subscribeConversationTodo(conversationId, listener),
    [conversationId]
  );
  const getSnapshot = useCallback(
    () => getConversationTodoList(conversationId),
    [conversationId]
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** BLOCK-94 / UI-402 — 当前会话知识溯源（会话级存储订阅；knowledge_citations 数据源）。 */
export function useConversationCitations(
  conversationId: string | null | undefined
): KnowledgeCitation[] {
  const subscribe = useCallback(
    (listener: () => void) => subscribeConversationCitations(conversationId, listener),
    [conversationId]
  );
  const getSnapshot = useCallback(
    () => getConversationCitations(conversationId),
    [conversationId]
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function isConversationRunning(conversationId: string | null | undefined): boolean {
  return getConversationRunSnapshot(conversationId)?.status === 'running';
}

export function resultEditProgressForContext(
  snapshot: ConversationRunSnapshot | null | undefined,
  contextToken: string | null | undefined,
): ResultEditProgressEvent[] {
  if (!snapshot || !contextToken || snapshot.resultContextToken !== contextToken) return [];
  return snapshot.resultEditProgress;
}

export function shouldClearReconciledConversationRun(
  snapshot: Pick<ConversationRunSnapshot, 'status' | 'pendingApproval'>
): boolean {
  return (snapshot.status === 'done' || snapshot.status === 'stopped') && !snapshot.pendingApproval;
}

export function startConversationRun(options: StartConversationRunOptions): boolean {
  const { conversationId } = options;
  if (!conversationId || isConversationRunning(conversationId)) return false;

  // 新 run 开始，上一轮降级提示与子 agent 终态通知自然消失（BLOCK-56 / BLOCK-49）；
  // 任务清单同清除（BLOCK-97 生命周期=单次任务运行）
  clearConversationNotices(conversationId);
  clearConversationTodo(conversationId);
  // BLOCK-94 / UI-402 — 知识溯源同生命周期（单次任务运行）
  clearConversationCitations(conversationId);

  const startedAt = Date.now();
  const ctrl = new AbortController();
  controllers.get(conversationId)?.abort();
  controllers.set(conversationId, ctrl);
  let assistantAcc = '';
  // UI-272 — 当前迭代号（onIter 更新），思考段按迭代分桶
  let currentIter = 1;

  runs.set(conversationId, {
    conversationId,
    projectId: options.projectId,
    status: 'running',
    userContent: options.userContent,
    userTs: new Date(startedAt).toISOString(),
    historyLastUserTs: options.historyLastUserTs,
    assistantContent: '',
    assistantTs: new Date(startedAt + 1).toISOString(),
    assistantPending: true,
    assistantError: false,
    progressUpdates: [],
    resultEditProgress: [],
    resultContextToken: typeof options.context.activeArtifact?.contextToken === 'string'
      ? options.context.activeArtifact.contextToken
      : undefined,
    toolActivities: [],
    reasoningByIteration: {},
    pendingApproval: null,
    startedAt,
    taskId: options.resumeTaskId ?? undefined,
    resumeOfTaskId: options.resumeOfTaskId,
  });
  emit(conversationId);

  const finish = (
    status: 'done' | 'error',
    error?: Error,
    errorInfo?: {
      resumable?: boolean;
      interruptedAt?: string | null;
      fallbackTaskId?: string | null;
      fallbackLabel?: string | null;
    }
  ) => {
    if (runs.get(conversationId)?.status !== 'running') return;
    // BLOCK-56 P1 — 任务级降级：后端已自动切备用 profile 新建续跑 task（原 task
    // 保持 failed 不可变）。前端不进入 error 终态，原地切换订阅新 task 继续渲染，
    // 用户只看到一条「已降级」提示，任务无缝续跑。
    if (status === 'error' && errorInfo?.fallbackTaskId) {
      const previousTaskId = runs.get(conversationId)?.taskId;
      const noticeText = errorInfo.fallbackLabel
        ? `模型服务异常，已自动降级到「${errorInfo.fallbackLabel}」继续执行`
        : '模型服务异常，已自动降级到备用模型继续执行';
      // BLOCK-56 P1 — 任务级降级：续跑任务完成、run 快照被对账清理后提示仍可见
      setFallbackNotice(conversationId, noticeText);
      replaceRun(conversationId, (current) => ({
        ...current,
        taskId: errorInfo.fallbackTaskId || current.taskId,
        resumeOfTaskId: previousTaskId || current.resumeOfTaskId,
        modelFallbackNotice: current.modelFallbackNotice || noticeText,
        statusMessage: errorInfo.fallbackLabel
          ? `已降级到「${errorInfo.fallbackLabel}」继续执行`
          : '已降级到备用模型继续执行',
        assistantPending: true,
      }));
      void subscribeAgentTask(
        errorInfo.fallbackTaskId,
        { messages: [], conversationId, signal: ctrl.signal, ...callbacks },
        0
      )
        .catch((switchErr: unknown) => {
          if ((switchErr as Error)?.name === 'AbortError') return;
          finish('error', switchErr instanceof Error ? switchErr : new Error('降级续跑订阅失败'));
        })
        .finally(() => {
          if (controllers.get(conversationId) === ctrl) controllers.delete(conversationId);
        });
      return;
    }
    const completedAt = Date.now();
    const formattedError = error ? formatErrorForUser(error) : null;
    // UI-AGENTWB-### / chat-error-rendering: persist the raw stack + error
    // code alongside the humanised userMessage. Without this, the user only
    // ever sees "发生未知错误" with no way to reach the underlying
    // ModuleNotFoundError / worker exit code / harness validation failure
    // that triggered it. ErrorBanner reads these via SimpleMessage.
    const rawStack = error?.stack || (error ? String(error) : undefined);
    const errorCode = formattedError?.code;
    replaceRun(conversationId, (current) => ({
      ...current,
      status,
      assistantContent: error && formattedError
        ? formattedError.userMessage
        : current.assistantContent,
      assistantPending: false,
      assistantError: status === 'error',
      statusMessage: undefined,
      technicalDetails: status === 'error' ? rawStack : undefined,
      errorCode: status === 'error' ? errorCode : undefined,
      // BLOCK-38 P2 — 仅服务中断（resumable 标记 + 已知 taskId）允许续跑
      resumable: status === 'error' && errorInfo?.resumable === true && Boolean(current.taskId),
      interruptedAt: status === 'error' && errorInfo?.interruptedAt ? errorInfo.interruptedAt : undefined,
      processingDurationMs: Math.max(0, completedAt - current.startedAt),
      completedAt,
    }));
  };

  const callbacks: Pick<
    StreamChatOptions,
    | 'onIter'
    | 'onTaskStarted'
    | 'onAgentStatus'
    | 'onAgentProgress'
    | 'onResultEditProgress'
    | 'onDelta'
    | 'onReasoning'
    | 'onToolCall'
    | 'onToolOutput'
    | 'onToolResult'
    | 'onTaskTodo'
    | 'onKnowledgeCitations'
    | 'onInputQueued'
    | 'onLoopPhase'
    | 'onLoopIteration'
    | 'onTopicShift'
    | 'onConversation'
    | 'onDone'
    | 'onError'
    | 'onStreamReconnecting'
    | 'onChildFinished'
    | 'onModelFallback'
  > = {
    // BLOCK-56 P1 — 请求级降级（loop 中途 gateway 切备用模型）：记录一次性提示，
    // 任务条显示「已降级到 X 模型」；后续进度不清除 notice 字段（statusMessage 会被正常覆盖）。
    onChildFinished: (info) => {
      if (!info.childTaskId) return;
      settleModelSubAgent(conversationId, options.projectId, info);
      pushChildFinishedNotice(conversationId, {
        childTaskId: info.childTaskId,
        status: info.status,
        summaryHead: info.summaryHead,
        ts: new Date().toISOString(),
      });
    },
    onModelFallback: (info) => {
      const noticeText = info.message
        || (info.toProfileLabel ? `已降级到「${info.toProfileLabel}」继续` : '已降级到备用模型继续');
      // BLOCK-56 P1 — 请求级降级：run 快照记录（statusMessage 等进度字段会被正常
      // 覆盖），同时写会话级 notice（run 终态对账清 run 后仍持久可见）。
      setFallbackNotice(conversationId, noticeText);
      replaceRun(conversationId, (current) => ({
        ...current,
        modelFallbackNotice: current.modelFallbackNotice || noticeText,
        statusMessage: info.message || '模型服务异常，已自动降级到备用模型继续',
        assistantPending: true,
      }));
    },
    onIter: (iteration) => {
      // UI-272 — 先更新迭代号再走原有重置逻辑
      currentIter = Math.max(1, iteration);
      if (iteration <= 1) return;
      assistantAcc = '';
      replaceRun(conversationId, (current) => ({
        ...current,
        assistantContent: '',
        assistantPending: true,
        statusMessage: undefined,
      }));
    },
    onTaskStarted: (taskId) => {
      replaceRun(conversationId, (current) => ({ ...current, taskId }));
    },
    onAgentStatus: (status) => {
      replaceRun(conversationId, (current) => ({
        ...current,
        statusMessage: status.message,
        assistantPending: true,
      }));
    },
    onAgentProgress: (progress) => {
      assistantAcc = '';
      replaceRun(conversationId, (current) => {
        const duplicate = current.progressUpdates.some(
          (item) => item.iteration === progress.iteration && item.content === progress.content
        );
        return {
          ...current,
          progressUpdates: duplicate
            ? current.progressUpdates
            : [...current.progressUpdates, progress].slice(-50),
          assistantContent: '',
          assistantPending: true,
          statusMessage: undefined,
        };
      });
    },
    onResultEditProgress: (progress) => {
      const labels: Record<string, string> = {
        change_set: '正在创建隔离修改',
        materialize: '正在生成独立脚本与参数',
        commit: '已保存候选版本',
        job: '正在运行结果重绘/重算',
        revision: '正在验证并登记结果版本',
        preview: '候选结果已就绪',
        cancelled: '结果修改已取消',
        failed: '结果修改未完成',
      };
      replaceRun(conversationId, (current) => {
        const withoutSameSequence = current.resultEditProgress.filter(
          (item) => item.changeSetId !== progress.changeSetId || item.sequence !== progress.sequence
        );
        return {
          ...current,
          resultEditProgress: [...withoutSameSequence, progress]
            .sort((a, b) => a.sequence - b.sequence)
            .slice(-30),
          statusMessage: labels[progress.stage] || '正在处理结果修改',
          assistantPending: true,
        };
      });
    },
    onDelta: (delta) => {
      assistantAcc += delta;
      replaceRun(conversationId, (current) => ({
        ...current,
        assistantContent: assistantAcc,
        assistantPending: false,
        statusMessage: undefined,
      }));
    },
    // UI-272 — 思考段增量按迭代累积（单迭代 24K 封顶，防 meta 膨胀）
    onReasoning: (delta) => {
      replaceRun(conversationId, (current) => {
        const prev = current.reasoningByIteration?.[currentIter] || '';
        if (prev.length >= 24576) return current;
        const merged = (prev + delta).slice(0, 24576);
        return {
          ...current,
          reasoningByIteration: {
            ...(current.reasoningByIteration || {}),
            [currentIter]: merged,
          },
        };
      });
    },
    onToolCall: (event: ToolCallEvent) => {
      // BLOCK-49 加映二 —— spawn_agent 的 task 文本按 callId 缓存（面板行标题）
      // BLOCK-93 P2 — args.role 一并缓存（显式角色 → 快照 → 内联卡图标）
      if (event.name === 'spawn_agent' && event.callId) {
        const taskText = typeof event.args?.task === 'string' ? event.args.task : '';
        const role = typeof event.args?.role === 'string' ? event.args.role : undefined;
        if (taskText || role) pendingSpawnTaskText.set(event.callId, { taskText, role });
      }
      replaceRun(conversationId, (current) => ({
        ...current,
        toolActivities: mergeToolCallActivity(current.toolActivities, event),
      }));
    },
    onToolOutput: (event: ToolOutputEvent) => {
      replaceRun(conversationId, (current) => ({
        ...current,
        toolActivities: mergeToolOutputActivity(current.toolActivities, event),
      }));
    },
    onToolResult: (event: ToolResultEvent) => {
      // BLOCK-49 加映二 —— 模型 spawn_agent 派生：登记 running 快照（活动面板）
      if (
        event.name === 'spawn_agent' &&
        event.toolResult?.status === 'success' &&
        !event.needApproval
      ) {
        const spawnData = event.toolResult?.data as { agentId?: unknown } | undefined;
        const agentId = spawnData && typeof spawnData.agentId === 'string' ? spawnData.agentId : null;
        const callKey = event.toolResult?.callId || '';
        const pending = pendingSpawnTaskText.get(callKey);
        const taskText = pending?.taskText || '子 agent';
        if (agentId) {
          recordModelSubAgent(conversationId, options.projectId, agentId, taskText, pending?.role);
          pendingSpawnTaskText.delete(callKey);
          // UI-382 — 把子智能体 id 回写到 spawn_agent 工具行：行展开后内联
          // 子智能体实况卡（ToolActivityList 按 activity.agentRunId 渲染），
          // 让「派了谁」紧挨「派发动作」本身。
          replaceRun(conversationId, (current) => ({
            ...current,
            toolActivities: current.toolActivities.map((activityItem) =>
              activityItem.callId && event.toolResult?.callId && activityItem.callId === event.toolResult.callId
                ? { ...activityItem, agentRunId: agentId }
                : activityItem,
            ),
          }));
        }
      }
      replaceRun(conversationId, (current) => ({
        ...current,
        toolActivities: mergeToolResultActivity(current.toolActivities, event),
        pendingApproval:
          event.name === 'run_tool' && event.needApproval && event.ackToken
            ? {
                ackToken: event.ackToken,
                toolJobId: event.toolJobId,
                toolId: event.toolId,
                message: event.message,
                params: event.params,
              }
            : current.pendingApproval,
      }));
      if (
        event.toolResult?.status === 'success' &&
        ['workspace_write', 'workspace_replace', 'workspace_exec'].includes(event.toolResult.tool || event.name)
      ) {
        // BLOCK-31 P2: 实时登记本会话改动文件（收尾时由权威清单对账合并）
        const writeData = event.toolResult?.data as
          | { path?: unknown; created?: unknown; dryRun?: unknown }
          | undefined;
        if (
          (event.toolResult?.tool === 'workspace_write' || event.toolResult?.tool === 'workspace_replace') &&
          writeData &&
          typeof writeData.path === 'string' &&
          writeData.dryRun !== true
        ) {
          recordConversationFileChange(
            conversationId,
            writeData.path,
            writeData.created === true ? 'created' : 'modified',
            // UI-273 — 执行步骤归属：tool_result 事件携带迭代号与工具名
            {
              iteration: typeof event.iteration === 'number' ? event.iteration : undefined,
              tool: event.toolResult?.tool,
            }
          );
        }
        dispatchGewuEvent(gewuEvents.projectWorkspaceChanged, {
          projectId: options.projectId,
          source: 'agent',
        });
      }
      if (
        event.name === 'run_tool' &&
        event.toolResult?.status === 'success' &&
        !event.needApproval &&
        event.toolJobId
      ) {
        dispatchGewuEvent(gewuEvents.projectOpenResult, {
          toolJobId: event.toolJobId,
          projectId: options.projectId,
        });
      }
      // BLOCK-34 P3: 后台进程启动成功 → 通知浮窗自动弹出并轮询日志
      if (
        event.toolResult?.tool === 'workspace_exec_background' &&
        event.toolResult?.status === 'success'
      ) {
        const bgData = event.toolResult?.data as { processId?: unknown } | undefined;
        const processId =
          bgData && typeof bgData.processId === 'string' ? bgData.processId : null;
        if (processId) {
          try {
            dispatchGewuEvent(gewuEvents.agentBackgroundProcess, {
              processId,
              conversationId,
            });
          } catch {
            // 事件总线失败不阻塞工具结果处理
          }
        }
      }
    },
    // BLOCK-95 A4 — 话题转移检测命中 → 事件总线广播（SimpleChat 插小节分隔 +
    // refreshConversations 固化到 DB 真值）。store 不持有该状态（低频一次性信号）。
    onTopicShift: (info) => {
      try {
        dispatchGewuEvent(gewuEvents.conversationTopicShift, {
          conversationId,
          reason: info.reason,
          at: new Date().toISOString(),
        });
      } catch {
        // 事件总线失败不阻塞流处理
      }
    },
    // 会话创建 SSE 事件（后端 getOrCreateActiveConversation 新建时发）→ 广播给
    // 左栏项目树即时刷新（子 agent / copilotAsk / 联邦委托等后端建会话路径）。
    onConversation: (info) => {
      try {
        dispatchGewuEvent(gewuEvents.conversationCreated, {
          conversationId: info.conversationId,
          title: info.title,
          projectId: options.projectId ?? null,
        });
      } catch {
        // 事件总线失败不阻塞流处理
      }
    },
    onLoopPhase: (info) => {
      replaceRun(conversationId, (current) => ({
        ...current,
        loop: mergeLoopPhase(current.loop, info),
      }));
    },
    onLoopIteration: (info) => {
      replaceRun(conversationId, (current) => ({
        ...current,
        loop: mergeLoopIteration(current.loop, info),
      }));
    },
    // BLOCK-98 M4 — 插队入队通知 → 状态条诚实可见
    onInputQueued: (info) => {
      replaceRun(conversationId, (current) => ({
        ...current,
        statusMessage: `已排队 ${info.depth} 条补充输入，将在当前步骤结束后加入`,
      }));
    },
    // BLOCK-97 — 任务清单整单快照（task_todo 事件；单真值在会话级
    // conversationTodos 存储——run 终态对账清快照后「完成态」仍可见，
    // 下一轮 run 开始清除；摘要卡经 useConversationTodoList 订阅实时勾选）
    onTaskTodo: (items) => {
      setConversationTodoList(conversationId, items);
    },
    // BLOCK-94 / UI-402 — 知识溯源条（注入块清单；会话级存储，run 终态后仍可见）。
    // 防御：条目必须能标识文档（docName/docId 之一为字符串），否则过滤掉不炸流。
    onKnowledgeCitations: (info) => {
      const citations = (Array.isArray(info && info.citations) ? info.citations : []).filter(
        (c) =>
          c &&
          typeof c === 'object' &&
          (typeof (c as { docName?: unknown }).docName === 'string' ||
            typeof (c as { docId?: unknown }).docId === 'string')
      );
      setConversationCitations(conversationId, citations);
    },
    onDone: () => finish('done'),
    onError: (error, info) => finish('error', error, info),
    // BLOCK-39: 断线重连期间在摘要条显示重连提示（后续 delta/finish 既有清理会置 undefined）
    onStreamReconnecting: (info) => {
      replaceRun(conversationId, (current) => ({
        ...current,
        statusMessage: `与任务失去连接，正在重连（第 ${info.attempt} 次）…`,
      }));
    },
  };

  if (options.resumeTaskId) {
    // AGENT-CONCURRENCY A-5: 恢复模式 — 直接订阅已存在的 task 事件流，不重新提交。
    void subscribeAgentTask(
      options.resumeTaskId,
      { messages: [], conversationId, signal: ctrl.signal, ...callbacks },
      0
    )
      .catch((err: unknown) => {
        // BLOCK-39: 透传真实错误（含 AgentStreamDisconnectedError 重试耗尽），中止不算失败
        if ((err as Error)?.name === 'AbortError') return;
        finish('error', err instanceof Error ? err : new Error('订阅失败'));
      })
      .finally(() => {
        if (controllers.get(conversationId) === ctrl) controllers.delete(conversationId);
      });
  } else {
    void streamChat({
      messages: options.messages,
      context: options.context,
      conversationId,
      modelPresetId: options.modelPresetId,
      thinkingLevel: options.thinkingLevel,
      modelName: options.modelName,
      signal: ctrl.signal,
      ...callbacks,
    }).finally(() => {
      if (controllers.get(conversationId) === ctrl) controllers.delete(conversationId);
    });
  }

  return true;
}

export function clearConversationPendingApproval(conversationId: string): void {
  replaceRun(conversationId, (current) => ({ ...current, pendingApproval: null }));
}

export function clearConversationRun(conversationId: string): void {
  controllers.get(conversationId)?.abort();
  controllers.delete(conversationId);
  if (runs.delete(conversationId)) emit(conversationId);
}

export function stopConversationRun(conversationId: string): void {
  const current = runs.get(conversationId);
  if (!current || current.status !== 'running') return;
  const completedAt = Date.now();
  replaceRun(conversationId, (snapshot) => ({
    ...snapshot,
    status: 'stopped',
    assistantContent: snapshot.assistantContent.trim()
      ? snapshot.assistantContent
      : '任务已停止，已完成的阶段结论和工具记录已保留。',
    assistantPending: false,
    assistantError: false,
    statusMessage: undefined,
    processingDurationMs: Math.max(0, completedAt - snapshot.startedAt),
    completedAt,
  }));
  if (current.taskId) {
    void cancelAgentTask(current.taskId).catch((error) => {
      replaceRun(conversationId, (snapshot) => ({
        ...snapshot,
        statusMessage: `后台停止请求未确认：${error instanceof Error ? error.message : String(error)}`,
      }));
    });
  }
  controllers.get(conversationId)?.abort();
  controllers.delete(conversationId);
}

export function __resetConversationRunsForTests(): void {
  controllers.forEach((controller) => controller.abort());
  controllers.clear();
  runs.clear();
  clearConversationRunListeners();
  __resetSubAgentTaskStoresForTests();
}

/**
 * AGENT-CONCURRENCY A-5: 重订阅一个崩溃/刷新前仍在跑的主 agent task（来自
 * 后端在途清单的 fetchInFlightPrimaryTasks，P1.2 起 localStorage 双轨已退役）。不重新提交，直接订阅其后端事件流
 * 并写入主 run 状态，避免主 run 孤儿化。taskId 已在 run 快照中登记。
 */
export function resumeConversationRun(
  resumeTaskId: string,
  conversationId: string,
  projectId?: string,
  resumeOfTaskId?: string
): boolean {
  return startConversationRun({
    conversationId,
    projectId: projectId || '',
    userContent: '（恢复后台任务）',
    messages: [],
    context: { page: 'desktop-project', projectId: projectId || '' },
    resumeTaskId,
    resumeOfTaskId,
  });
}

/**
 * BLOCK-38 P2 — 用户点击「继续执行」：对服务中断（resumable）的主 run 调 resume
 * 端点，新建关联 task（原 task 保持 failed 不可变）并立即订阅新 task 事件流，
 * 走既有流式渲染链路。返回新 taskId；失败抛错（由 UI 弹层展示）。
 */
export async function resumeInterruptedConversation(
  conversationId: string,
  projectId?: string
): Promise<string> {
  const snapshot = getConversationRunSnapshot(conversationId);
  if (!snapshot || !snapshot.resumable || !snapshot.taskId) {
    throw new Error('当前会话没有可续跑的中断任务');
  }
  if (isConversationRunning(conversationId)) {
    throw new Error('任务仍在运行，无需续跑');
  }
  const result = await resumeAgentTask(snapshot.taskId);
  // 续跑已受理：新 run 直接以 resumeOfTaskId 携带审计链（原 taskId 保持 failed 不可变）
  resumeConversationRun(result.taskId, conversationId, projectId, snapshot.taskId);
  return result.taskId;
}

/**
 * AGENT-CONCURRENCY A-5 → BLOCK-109-CORE-ARCH P1.2/P1.3: app 启动 / 会话重开时的
 * 孤儿恢复**单一入口**（恢复同源：全部问后端，localStorage 双轨已退役）。
 * - sub-agent：后端 loop_runs 投影（fetchLoopRuns）。
 * - 主 agent：后端在途清单（/ai/agent/tasks/inflight，status='running' 即权威）。
 * 仅当当前会话没有活跃主 run 时才恢复主 agent，避免重复订阅。
 */
export async function resumeOrphanAgentTasks(
  conversationId: string,
  projectId?: string
): Promise<void> {
  if (!conversationId) return;
  // 1) sub-agent：后端 loop_runs 投影。
  await resumeSubAgentTasks(conversationId, projectId);
  // 2) 主 agent：后端在途清单（仅当当前会话无活跃主 run；并发桶语义下单会话至多一个）。
  if (isConversationRunning(conversationId)) return;
  try {
    const inFlight = await fetchInFlightPrimaryTasks(conversationId);
    for (const taskId of inFlight) {
      if (isConversationRunning(conversationId)) break;
      resumeConversationRun(taskId, conversationId, projectId);
    }
  } catch {
    /* 恢复查询失败静默：下次会话挂载重试（后端真相不灭） */
  }
}

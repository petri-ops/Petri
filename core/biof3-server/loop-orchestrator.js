'use strict';

/**
 * loop-orchestrator.js
 *
 * Pure agent loop state machine extracted from agent-runner.js.
 * Contains:
 * - 5 _loop* closures (_loopInit, _loopEmitIterationEvent, _loopPersistPhase,
 *   _loopSaveCheckpoint, _loopPersistProgressIteration)
 * - Loop body for-loop (MAX_AGENT_ITERS iterations)
 * - 6 loop state variables (loopState, loopRunId, loopSequence, loopIterations,
 *   loopAbortedByController, loopPublicConclusion)
 *
 * PHASE 3.1 split:
 * - NO harness-workflow-state references (avoids circular dependency)
 * - Receives dependencies via constructor/parameters
 * - Pure state machine, no system prompt or LLM client logic
 */

const {
  buildLoopRun,
  buildIteration,
  stableHash,
  REASON_CODES,
  normalizeLoopAutomationMode,
} = require('../shared-backend/loop-contract');
const {
  deriveObservedStateDigest,
  mapDecisionToIterationStatus,
} = require('../shared-backend/loop-controller');
const {
  persistLoopRun,
  updateLoopRunStatus,
  getLoopRun,
  listLoopIterations,
  persistLoopIteration,
  saveContextCheckpoint,
  getToolJob,
} = require('./db');
const {
  buildIterationCheckpoint,
} = require('../shared-backend/loop-checkpoint');
const {
  validateArtifact,
} = require('../shared-backend/loop-validator-registry');
const {
  diagnoseFailure,
} = require('../shared-backend/loop-failure-diagnoser');
const {
  selectRepairStrategy,
} = require('../shared-backend/loop-repair-strategy');
const {
  MAX_AGENT_ITERS,
  MAX_FINALIZATION_ATTEMPTS,
  MAX_CONTINUATION_CHAINS,
  MAX_CONTINUATION_TOKENS,
  shouldFinalizeAgentIteration,
  assessFinalizationResult,
  createAgentProgressRecorder,
  createContinuationGuard,
  runAgentToolCallBatch,
  buildToolCallEvent,
  buildToolResultEvent,
  emitReadOnlyResultOutput,
  createToolOutputStream,
  replaceToolResultData,
  serializeToolResultForModel,
  createAgentToolCallController,
  createModelResultState,
  executeToolCall,
  createRejectedToolResult,
  createCallId,
  createTraceId,
  createResultEditCompletionGuard,
} = require('./agent-tools');
// localizeToolResult 定义在 helpers/system-prompt（agent-tools 不导出它）。
// 此处曾错误地从 ./agent-tools 解构，得到 undefined，导致任何工具调用
// 在 localizeToolResult(envelope.data) 处抛 "not a function"，agent task 整体 failed。
const { localizeToolResult } = require('./helpers/system-prompt');
const { isUserInputRequiredError } = require('../shared-backend/task-confirmation-hooks');
const {
  createResultEditProgressRecorder,
  finalizeResultEditProgress,
} = require('./agent-tools/result-context-binding');
// BLOCK-51 P2 — 上下文熔断：预算估算 + 超窗修剪
const { estimateRequestTokens } = require('./helpers/token-estimator');
const { trimMessagesToBudget } = require('./helpers/message-trimmer');
const { createFreshnessTracker, applyFreshnessMark } = require('./helpers/context-freshness');

/**
 * Run the agent loop state machine.
 *
 * @param {object} opts
 * @param {Array} opts.messages - Full messages array (with system prompt at index 0)
 * @param {object} opts.toolCtx - Tool context
 * @param {function} opts.shouldAbort - Abort check function
 * @param {function} opts.emitToolResult - Callback for tool result events
 * @param {function} opts.emitAssistant - Callback for assistant events
 * @param {function} opts.emitDone - Callback for done event
 * @param {function} opts.callChatProvider - LLM provider call function
 * @param {object} opts.config - Configuration
 * @param {object} opts.conversationState - Conversation state from adapter
 * @returns {Promise<{assistantText: string, loopRunId: string|null, loopState: string|null}>}
 */
async function runLoop({
  messages,
  toolCtx,
  shouldAbort,
  emitAssistant,
  emitDone,
  callChatProvider,
  config,
}) {
  const {
    userId,
    _activeConv,
    apiKey,
    providerName,
    modelName,
    profileId,
    baseUrl,
    kind,
    parentLoopRunId,
    context,
    executionPolicy,
    contextWindow,
    thinkingLevel,
  } = config;

  // ---------- Loop state variables (6 closures) ----------
  let loopState = null;
  let loopRunId = null;
  let loopSequence = 0;
  let loopIterations = [];
  let loopAbortedByController = false;
  let loopPublicConclusion = null;

  // ---------- Internal state ----------
  // BLOCK-51 P2 — 上下文熔断：agent-runner 已把 safeCtx（>0）放入 config.contextWindow；
  // 这里做兜底归一（0/undefined → 64000），与 agent-runner 的 token_budget 口径一致。
  const loopContextWindow = (typeof contextWindow === 'number' && contextWindow > 0) ? contextWindow : 64000;
  let contextBudgetTrimmed = false;
  const assistantProgress = createAgentProgressRecorder();
  const toolResultEventsByCallId = {};
  const loopArtifactCache = {};
  // BLOCK-56 P1 — 本次任务生命周期内是否发生过请求级模型降级
  // （gateway 内 primary→备用切换）。任务级降级以此判定「单级不连环」。
  let modelFallbackOccurred = false;
  // BLOCK-56 P3 — 上下文保鲜：loop 生命周期内的内存 map（path → hash/readAt/iteration），
  // workspace_read 重复读取同文件时附 unchanged/changedSinceLastRead 标记（不自动重读）。
  const freshnessTracker = createFreshnessTracker();

  // ---------- Event emitter proxy ----------
  const _emit = (obj) => {
    emitAssistant(obj);
  };

  // ---------- Helper functions (mirror from agent-runner) ----------

  function _extractArtifactFiles(parsed) {
    if (!parsed || typeof parsed !== 'object') return [];
    const out = new Set();
    const INTERNAL_FILES = new Set([
      '.tool_manifest.json', '.params.json', '.log', '.lock',
      '__MACOSX', '.DS_Store', 'Thumbs.db',
    ]);
    const sources = [parsed.artifacts, parsed.outputs, parsed.files];
    for (const list of sources) {
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (!item) continue;
        const name = typeof item === 'string' ? item : item.name || item.filename;
        if (!name) continue;
        const base = typeof name === 'string' ? require('path').basename(name) : String(name);
        if (base && !INTERNAL_FILES.has(base)) out.add(base);
      }
    }
    return Array.from(out);
  }

  function _pushUniqueResultCard(cards, card) {
    if (!card || !card.jobId) return;
    if (cards.some((item) => item.jobId === card.jobId)) return;
    cards.push(card);
  }

  function _buildResultCardFromRunTool(result, ctx) {
    if (!result || typeof result !== 'object' || !result.toolJobId || result.needApproval) return null;
    const toolId = String(result.toolId || 'analysis');
    const payload = result.result && typeof result.result === 'object' ? result.result : {};
    const artifacts = Array.isArray(payload.artifacts)
      ? payload.artifacts.slice(0, 50).map((item) => {
          if (!item || typeof item !== 'object') return { name: String(item), type: 'file' };
          return {
            id: item.id ? String(item.id) : undefined,
            name: item.name ? String(item.name) : item.filename ? String(item.filename) : undefined,
            filename: item.filename ? String(item.filename) : item.name ? String(item.name) : undefined,
            type: item.type ? String(item.type) : 'file',
            label: item.label ? String(item.label) : item.title ? String(item.title) : undefined,
            title: item.title ? String(item.title) : item.label ? String(item.label) : undefined,
          };
        })
      : [];
    const files = Array.isArray(payload.files)
      ? payload.files.slice(0, 50).map((f) => {
          if (typeof f === 'string') return f;
          if (f && typeof f === 'object') return String(f.name || f.filename || '');
          return String(f);
        }).filter(Boolean)
      : [];
    const outputs = Array.isArray(payload.outputs)
      ? payload.outputs.slice(0, 50).map((item) => {
          if (!item || typeof item !== 'object') return { name: String(item) };
          return {
            id: item.id ? String(item.id) : undefined,
            name: item.name ? String(item.name) : undefined,
            filename: item.filename ? String(item.filename) : undefined,
            type: item.type ? String(item.type) : undefined,
            label: item.label ? String(item.label) : undefined,
          };
        })
      : [];
    return {
      jobId: String(result.toolJobId),
      toolId,
      title: `${toolId} 分析结果`,
      status: result.error || result.ok === false ? 'failed' : 'done',
      projectId: ctx && ctx.projectId ? String(ctx.projectId) : null,
      error: result.error || result.message ? String(result.message || result.error).slice(0, 1200) : undefined,
      artifacts,
      files,
      outputs,
    };
  }

  // ---------- 5 _loop* closures ----------

  function _loopInit(projectId, conversationId) {
    if (loopRunId) return;
    const pid = String(projectId || '');
    const cid = String(conversationId || '');
    const executionIntent = executionPolicy.allowExecution ? 'task_execute' : 'task_draft';
    const automationMode = normalizeLoopAutomationMode(
      context && context.automationMode,
      toolCtx.accessMode === 'full' ? 'trusted' : 'guided',
    );

    let resumed = null;
    if (kind !== 'subagent') {
      try {
        resumed = require('./db').getActiveLoopRunForConversation(pid, cid);
      } catch { resumed = null; }
    }

    if (resumed && resumed.loopRunId) {
      loopRunId = resumed.loopRunId;
      loopState = resumed.loopStatus === 'planned' ? 'running' : resumed.loopStatus;
      try {
        const prior = listLoopIterations(loopRunId, { limit: 500 }) || [];
        loopIterations = prior.slice().sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
        loopSequence = loopIterations.reduce((m, it) => Math.max(m, it.sequence || 0), 0);
      } catch {
        loopIterations = [];
        loopSequence = 0;
      }
      if (resumed.loopStatus === 'planned' && executionPolicy.allowExecution) {
        try {
          updateLoopRunStatus(loopRunId, {
            loopStatus: 'running',
            hash: resumed.hash,
            json: JSON.stringify(resumed.record || {}),
            updatedAt: new Date().toISOString(),
          });
        } catch {}
      }
      _emit({
        event: 'loop_phase',
        phase: 'resumed',
        loopRunId,
        automationMode: resumed.automationMode || automationMode,
        executionIntent: resumed.executionIntent || executionIntent,
        resumedFromSequence: loopSequence,
      });
      return;
    }

    const taskSpecHash = stableHash({
      projectId: pid,
      conversationId: cid,
      executionIntent,
    });
    const run = buildLoopRun({
      projectId: pid,
      conversationId: cid,
      taskSpecRef: taskSpecHash,
      automationMode,
      executionIntent,
      loopStatus: 'running',
      kind,
      parentLoopRunId,
      metadata: { taskSpecHash },
    });
    loopRunId = run.loopRunId;
    loopState = 'running';
    persistLoopRun(run);
    _emit({
      event: 'loop_phase',
      phase: 'started',
      loopRunId,
      automationMode,
      executionIntent,
    });
  }

  function _loopEmitIterationEvent(iteration, decision, actionKey) {
    _emit({
      event: 'loop_iteration',
      loopRunId,
      iterationId: iteration.iterationId,
      sequence: iteration.sequence,
      decision: iteration.decision,
      decisionReasonCode: iteration.decisionReasonCode,
      publicConclusion: iteration.publicConclusion,
      status: iteration.status,
      proposedActionKey: actionKey || null,
      actionKeyHash: actionKey ? stableHash(actionKey) : null,
    });
  }

  function _loopPersistPhase(nextStatus, publicConclusion) {
    if (!loopRunId || !nextStatus || nextStatus === 'running') return;
    try {
      const current = getLoopRun(loopRunId);
      if (!current || current.loopStatus === nextStatus) return;
      updateLoopRunStatus(loopRunId, {
        loopStatus: nextStatus,
        hash: current.hash,
        json: JSON.stringify({
          ...(current.record || {}),
          loopStatus: nextStatus,
          publicConclusion: publicConclusion || null,
          completedAt: ['completed', 'failed', 'cancelled'].includes(nextStatus)
            ? new Date().toISOString()
            : null,
        }),
        updatedAt: new Date().toISOString(),
      });
      _emit({
        event: 'loop_phase',
        phase: nextStatus,
        loopRunId,
        publicConclusion: publicConclusion || undefined,
        automationMode: current.automationMode,
        executionIntent: current.executionIntent,
      });
    } catch (error) {
      console.warn('[harness-loop] failed to persist phase:', error && error.message);
    }
  }

  function _loopSaveCheckpoint(iteration, projectId, conversationId, extra = {}) {
    if (!loopRunId || !iteration || !iteration.iterationId) return;
    try {
      const cp = buildIterationCheckpoint({
        loopRunId,
        loopRunHash: iteration.hash,
        sequence: iteration.sequence,
        observedStateDigest: iteration.observedStateDigest || iteration.hash,
        goalGapIds: iteration.goalGapIds || [],
        decision: iteration.decision,
        decisionReasonCode: iteration.decisionReasonCode,
        publicConclusion: iteration.publicConclusion,
        status: iteration.status,
        proposedActionHash: extra.proposedActionHash || null,
        validatorResults: extra.validatorResults || [],
        repairAttempt: extra.repairAttempt || null,
        toolJobId: extra.toolJobId || null,
        artifactIds: extra.artifactIds || [],
        costSnapshot: extra.costSnapshot || null,
      });
      saveContextCheckpoint({
        ...cp,
        projectId: String(projectId || ''),
        conversationId: String(conversationId || ''),
        sourceDigest: cp.observedStateDigest || cp.checkpointId,
      });
    } catch {}
  }

  function _loopPersistProgressIteration(providerIteration, assistantToolActivities, toolResultEventsByCallIdRef) {
    if (!loopRunId) return null;
    const batch = assistantToolActivities
      .snapshot()
      .filter((activity) => activity.iteration === providerIteration);
    if (batch.length === 0) return null;

    const runToolJobs = batch
      .filter((activity) => activity.name === 'run_tool' && activity.callId)
      .map((activity) => {
        const event = toolResultEventsByCallIdRef[activity.callId];
        const resultData = event?.toolResult?.data || {};
        const toolJobId = event?.toolJobId || resultData.toolJobId || null;
        let job = null;
        if (toolJobId) {
          try { job = getToolJob(toolJobId) || null; } catch {}
        }
        const resultFailed = resultData.ok === false || Boolean(resultData.error);
        return {
          id: toolJobId || activity.callId,
          toolJobId,
          toolId: job?.tool_id || resultData.toolId || null,
          status: job?.status || (
            resultFailed
              ? 'failed'
              : activity.status === 'success'
              ? 'completed'
              : activity.status === 'awaiting_confirmation'
                ? 'pending'
                : 'failed'
          ),
          error: job?.error || resultData.error || resultData.message || null,
          requiresUserInput: isUserInputRequiredError(resultData.error),
          finished_at: job?.completed_at || null,
        };
      });
    const failedCount = runToolJobs.filter((job) => ['failed', 'blocked'].includes(job.status)).length;
    const pendingCount = runToolJobs.filter((job) => ['pending', 'queued', 'running'].includes(job.status)).length;
    const completedTools = [...new Set(runToolJobs
      .filter((job) => job.status === 'completed')
      .map((job) => job.toolId)
      .filter(Boolean))];
    const latestProgress = assistantProgress
      .snapshot()
      .filter((progress) => progress.iteration === providerIteration)
      .slice(-1)[0]?.content;

    let decision = 'continue';
    let reasonCode = REASON_CODES.TOOL_SUCCEEDED;
    let publicConclusion = latestProgress || `本阶段已完成 ${batch.length} 项操作，继续推进。`;
    if (failedCount > 0) {
      const requiresUserInput = runToolJobs.some((job) => job.requiresUserInput);
      decision = requiresUserInput ? 'wait' : 'retry';
      reasonCode = requiresUserInput
        ? REASON_CODES.USER_INPUT_REQUIRED
        : REASON_CODES.TRANSIENT_RUNTIME_RETRY;
      publicConclusion = requiresUserInput
        ? '执行前置条件不完整，未创建非法 Job；需要补齐关键输入或科学确认。'
        : `本阶段有 ${failedCount} 个工具任务未成功，已保留 Job 证据并进入自动诊断。`;
    } else if (pendingCount > 0) {
      decision = 'wait';
      publicConclusion = `本阶段有 ${pendingCount} 个工具任务仍在执行或等待，继续监控。`;
    } else if (completedTools.length > 0) {
      publicConclusion = `${completedTools.join('、')} 已生成真实 Job/Artifact，继续验证下游目标。`;
    }

    loopSequence += 1;
    const parentHash = loopIterations.length > 0
      ? loopIterations[loopIterations.length - 1].hash
      : null;
    const iteration = buildIteration({
      loopRunId,
      sequence: loopSequence,
      observedStateDigest: deriveObservedStateDigest({
        toolJobs: runToolJobs,
        conversationSummary: publicConclusion,
        dagProgress: { providerIteration, persistedIterations: loopIterations.length },
      }),
      goalGapIds: [],
      proposedAction: null,
      decision,
      decisionReasonCode: reasonCode,
      publicConclusion,
      status: mapDecisionToIterationStatus(decision),
      parentIterationHash: parentHash,
      createdAt: new Date().toISOString(),
    }, {
      validatorResults: [],
      repairAttempt: null,
      costSnapshot: null,
    });
    persistLoopIteration(iteration);
    loopIterations.push(iteration);
    _loopSaveCheckpoint(iteration, toolCtx.projectId, toolCtx.conversationId, {
      toolJobId: runToolJobs.slice(-1)[0]?.toolJobId || null,
    });
    _loopEmitIterationEvent(iteration, decision, null);
    return iteration;
  }

  // ---------- Pre-loop setup ----------
  const aborted = () => (typeof shouldAbort === 'function' ? shouldAbort() : false);
  const resultEditProgress = createResultEditProgressRecorder();
  const traceId = createTraceId();
  const toolCallController = createAgentToolCallController({ maxToolCalls: config.MAX_AGENT_TOOL_CALLS || 50 });
  const latestUserMessage = [...messages].reverse().find((message) => message && message.role === 'user');
  const resultEditCompletionGuard = createResultEditCompletionGuard({
    expectation: toolCtx.resultStudioCompletionExpectation,
    requestedOutcome: typeof latestUserMessage?.content === 'string' ? latestUserMessage.content : '',
  });
  const modelResultState = createModelResultState({
    projectId: toolCtx.projectId,
    traceId,
  });

  let assistantAcc = '';
  let providerFailureReason = null;
  let finalizationAttempts = 0;
  let finalizationFailureReason = null;
  let pendingApprovalEmitted = false;
  let cancellationObserved = false;
  let modelFinalized = false;
  let fatalAgentError = null;
  const assistantResultCards = [];
  const assistantToolActivities = require('./agent-tools').createToolActivityRecorder();
  // UI-272 — 按迭代聚合模型思考段（reasoning_content），随结果返回供落库
  const reasoningByIteration = Object.create(null);
  const continuationGuard = createContinuationGuard({
    maxChains: MAX_CONTINUATION_CHAINS,
    maxTokens: MAX_CONTINUATION_TOKENS,
  });

  // ---------- Loop body ----------
  try {
    for (let iter = 0; iter < MAX_AGENT_ITERS && !aborted(); iter++) {
      _emit({ event: 'iter', n: iter + 1 });

      // Pre-turn controller check
      if (loopRunId && loopState && loopState !== 'running') {
        _emit({
          event: 'loop_phase',
          phase: loopState,
          loopRunId,
          publicConclusion: loopPublicConclusion,
          reason: 'controller_aborted',
        });
        loopAbortedByController = true;
        cancellationObserved = true;
        assistantAcc = loopPublicConclusion || '任务已被 Loop Controller 终止。已完成工作已保留。';
        break;
      }

      // Finalization check
      const finalizing = shouldFinalizeAgentIteration(iter, toolCallController);
      if (finalizing) {
        messages.push({
          role: 'system',
          content: toolCallController.capHit()
            ? '已达到显式配置的工具调用保护上限。请基于已收到的工具结果直接说明停止原因、已完成工作和未执行步骤，不要再调用工具，也不得声称尚未启动的工作正在执行。'
            : '检测到相同工具和参数反复调用，任务可能陷入异常循环。请停止调用工具，直接说明异常、已完成工作和未执行步骤；不得声称尚未启动的工作正在执行。',
        });
      }

      // BLOCK-51 P2 — 上下文熔断：每轮请求构造前预算检查，超过 ctxWindow*0.85 时
      // 用既有 trimMessagesToBudget 一次性修剪（保近期+工具结果/压缩历史/摘要提示）。
      // system prompt 不参与 trim（trimmer 语义本就如此）；就地替换内容保持数组引用稳定。
      if (!contextBudgetTrimmed) {
        try {
          const hasSystem = messages.length > 0 && messages[0].role === 'system';
          const est = estimateRequestTokens({
            systemPrompt: hasSystem ? (messages[0].content || '') : '',
            messages: hasSystem ? messages.slice(1) : messages,
            maxTokens: 16384, // 与下方 reqBody.max_tokens 一致
          });
          if (est.total > loopContextWindow * 0.85) {
            const result = trimMessagesToBudget({
              fullMessages: messages,
              contextWindow: loopContextWindow,
              headroom: 16384, // 与 reqBody.max_tokens 一致，预算 = ctx - system - headroom
              systemPromptTokens: est.systemPromptTokens,
            });
            if (result.stats && result.stats.trimmed) {
              contextBudgetTrimmed = true;
              const trimmed = result.messages;
              messages.length = 0;
              for (const m of trimmed) messages.push(m);
              _emit({
                event: 'token_budget',
                contextWindow: loopContextWindow,
                messagesTokensUsed: result.stats.messagesTokensUsed,
                systemPromptTokens: est.systemPromptTokens,
                messagesTokens: result.stats.messagesTokensUsed,
                pct: Math.min(100, Math.round((result.stats.messagesTokensUsed / loopContextWindow) * 100)),
                trimmed: true,
                messagesDropped: result.stats.messagesDropped,
              });
              console.log(`[context-breaker] iter ${iter + 1} trimmed ${result.stats.messagesDropped} messages: ${est.total} → ${result.stats.messagesTokensUsed} tokens (ctx ${loopContextWindow})`);
            }
          }
        } catch (e) {
          console.log('[context-breaker-error]', e && e.message);
        }
      }

      const reqBody = {
        ...(modelName ? { model: modelName } : {}),
        messages,
        temperature: 0.4,
        max_tokens: 16384, // 方案 B：用足够大的值让模型自然停止，而不是物理截断
        tools: finalizing ? undefined : config.tools,
        tool_choice: finalizing
          ? undefined
          : (resultEditCompletionGuard.requiresToolExecution()
            ? resultEditCompletionGuard.requiredToolChoice()
            : 'auto'),
      };

      let streamedText = '';
      let upJson;
      const attemptLimit = finalizing ? MAX_FINALIZATION_ATTEMPTS : 1;
      for (let attempt = 1; attempt <= attemptLimit && !aborted(); attempt++) {
        streamedText = '';
        const protocolRecoveryAttempt = finalizing && attempt > 1;
        upJson = await callChatProvider(
          providerName,
          apiKey,
          reqBody,
          {
            userId,
            conversationId: _activeConv && _activeConv.id,
            kind: attempt > 1 ? 'agent_finalization_retry' : 'agent_iter',
          },
          protocolRecoveryAttempt ? undefined : (event) => {
            // BLOCK-56 P1 — 请求级降级事件透传：gateway 内 primary→备用切换时
            // 发出 model_fallback；此前该事件被吞掉用户不可见。_emit 落
            // task_events + SSE，前端任务条显示「已降级到 X 模型」。
            if (event && event.type === 'model_fallback') {
              modelFallbackOccurred = true;
              _emit({
                event: 'model_fallback',
                scope: 'request_level',
                role: event.role || null,
                fromProfileId: event.fromProfileId || null,
                toProfileId: event.toProfileId || null,
                reason: event.reason || null,
                message: '模型服务异常，本次调用已自动降级到备用模型继续',
              });
              return;
            }
            if (event.type === 'content_delta' && event.content && !aborted()) {
              streamedText += event.content;
              if (!resultEditCompletionGuard.required) {
                _emit({ choices: [{ delta: { content: event.content } }] });
              }
            }
            // UI-272 — 思考段增量：按迭代聚合（截断 6K）并实时下发前端
            if (event.type === 'reasoning_delta' && event.content && !aborted()) {
              const key = String(iter + 1);
              const prev = reasoningByIteration[key] || '';
              if (prev.length < 6144) {
                reasoningByIteration[key] = (prev + event.content).length > 6144
                  ? (prev + event.content).slice(0, 6144) + '\n…（思考段已截断）'
                  : prev + event.content;
              }
              if (!resultEditCompletionGuard.required) {
                _emit({ choices: [{ delta: { reasoning_content: event.content } }] });
              }
            }
          },
          {
            baseUrl,
            profileId,
            modelOverride: modelName,
            // BLOCK-56 P1 — 降级续跑任务关闭请求级 fallback（单级不连环）
            ...(config.disableProviderFallback ? { disableFallback: true } : {}),
            // BLOCK-81 P1 — 思考档位透传（未设置＝undefined＝不发任何思考参数）
            ...(thinkingLevel ? { thinkingLevel } : {}),
            ...(protocolRecoveryAttempt ? { fallbackWhen: require('./agent-tools').finalizationFallbackReason } : {}),
          }
        );
        // BLOCK-56 P1 — finalization 档不传 onEvent，modelRouting 兜底追踪
        if (upJson && upJson.modelRouting && upJson.modelRouting.fallbackFrom) {
          modelFallbackOccurred = true;
        }
        if (!finalizing) break;
        finalizationAttempts = Math.max(finalizationAttempts, attempt);
        const assessment = assessFinalizationResult(upJson, streamedText);
        finalizationFailureReason = assessment.usable ? null : assessment.reason;
        if (protocolRecoveryAttempt && assessment.usable && assessment.content) {
          _emit({ choices: [{ delta: { content: assessment.content } }] });
        }
        if (assessment.usable || !assessment.retryable || attempt >= attemptLimit) break;
        _emit({
          event: 'agent_status',
          phase: 'finalization_retry',
          attempt: attempt + 1,
          maxAttempts: attemptLimit,
          reason: assessment.reason,
          message: '模型未返回可展示的最终说明，正在自动重试整理…',
        });
      }

      if (!finalizing && (!upJson || upJson.error || !upJson.choices)) {
        if (finalizing && finalizationAttempts > 0) break;
        providerFailureReason = String(
          (upJson && (upJson.message || upJson.error || (upJson.choices ? 'no choice' : 'bad response')))
          || 'upstream error'
        );
        break;
      }

      const choice = upJson.choices[0];
      const msg = choice.message || {};
      const toolCalls = msg.tool_calls || [];

      if (finalizing) {
        const assessment = assessFinalizationResult(upJson, streamedText);
        assistantAcc = assessment.content;
        finalizationFailureReason = assessment.usable ? null : assessment.reason;
        modelFinalized = assessment.usable;
        break;
      }

      if (toolCalls.length === 0) {
        let assessment = assessFinalizationResult(upJson, streamedText);
        
        // 方案 B complete：截断自动续写时受 continuationGuard 硬保护。
        // 任务完整性仍由模型自描述（finish_reason）决定；但若同一任务内
        // 连续截断到上限，主动收尾 + 提示用户继续，避免无限续写。
        if (assessment.usable && assessment.truncated && !finalizing) {
          continuationGuard.recordTruncation(reqBody && reqBody.max_tokens);
          if (continuationGuard.capHit()) {
            _emit({
              event: 'agent_status',
              phase: 'continuation_cap_hit',
              reason: 'continuation_cap',
              snapshot: continuationGuard.snapshot(),
              message: '检测到连续多次回答被截断，已自动收尾当前任务。请基于以上内容继续追问，或在模型设置中调整单次输出上限。',
            });
            assistantAcc = assessment.content;
            modelFinalized = true;
            break;
          }
          messages.push({ role: 'assistant', content: assessment.content });
          messages.push({ role: 'user', content: '继续' });
          _emit({
            event: 'agent_status',
            phase: 'continuation',
            reason: 'truncated_at_limit',
            message: '检测到回答被截断，正在自动续写…',
          });
          continue;
        }
        if (assessment.usable && !assessment.truncated) continuationGuard.recordStop();
        
        const editCompletion = resultEditCompletionGuard.assessTerminal();
        if (editCompletion.action === 'retry') {
          messages.push({ role: 'assistant', content: assessment.content || msg.content || '' });
          messages.push({ role: 'system', content: editCompletion.prompt });
          _emit({
            event: 'agent_status',
            phase: 'result_edit_completion_retry',
            attempt: 1,
            maxAttempts: 1,
            reason: editCompletion.reason,
            message: editCompletion.message,
          });
          continue;
        }
        if (editCompletion.action === 'fail') {
          assistantAcc = editCompletion.message;
          _emit({ choices: [{ delta: { content: assistantAcc } }] });
          emitDone();
          modelFinalized = true;
          break;
        }
        finalizationAttempts = 1;
        finalizationFailureReason = assessment.usable ? null : assessment.reason;
        assistantAcc = assessment.content;
        modelFinalized = assessment.usable;
        break;
      }

      const progress = assistantProgress.record(streamedText || msg.content, iter + 1);
      if (progress) _emit({ event: 'agent_progress', ...progress });

      await runAgentToolCallBatch({
        controller: toolCallController,
        toolCalls,
        createCallId,
        shouldAbort: aborted,
        onReserved: (accepted) => {
          messages.push({
            role: 'assistant',
            content: msg.content || '',
            tool_calls: accepted,
          });
        },
        execute: async ({ name, args, callId }) => {
          if (name === 'run_tool' && executionPolicy.allowExecution) {
            _loopInit(toolCtx.projectId, toolCtx.conversationId);
          }
          assistantToolActivities.recordCall({ name, args, traceId, callId, iteration: iter + 1 });
          _emit(buildToolCallEvent({ name, args, traceId, callId, iteration: iter + 1 }));
          // BLOCK-33 P3 — workspace_exec 流式输出：增量经 tool_output 事件实时下发
          // UI-315 — emit 侧镜像进活动快照（输出尾部随 meta 落库，历史终端块可回放）
          const outputStream = createToolOutputStream({
            name, callId, traceId, iteration: iter + 1,
            emit: (evt) => {
              _emit(evt);
              if (evt && evt.event === 'tool_output') {
                assistantToolActivities.recordOutput({
                  name, callId, traceId,
                  text: evt.text,
                  truncated: evt.truncated === true,
                });
              }
            },
          });
          let envelope = await executeToolCall(name, args, toolCtx, {
            traceId,
            callId,
            ...(name === 'workspace_exec' ? { onOutput: outputStream.onOutput } : {}),
          });
          outputStream.flush();
          let result = localizeToolResult(envelope.data);
          // BLOCK-56 P3 — workspace_read 附内容短指纹 + unchanged/changedSinceLastRead
          // 三态标记（内存 map 判定；不自动重读，重读与否由模型裁决）。
          if (name === 'workspace_read') {
            result = applyFreshnessMark(result, freshnessTracker, iter + 1);
          }
          resultEditCompletionGuard.recordToolResult(name, result);
          envelope = replaceToolResultData(envelope, result);

          // UI-384 — 只读结果内容镜像：read/list/find/search 结果格式化为有界
          // 文本尾部，走 exec 同款 tool_output 事件 + recordOutput 快照镜像
          // （前端行详情输出块点亮；随 meta 落库，历史会话可回放）。内部 fail-safe。
          emitReadOnlyResultOutput({
            name, result, callId, traceId, iteration: iter + 1,
            emit: _emit,
            recordOutput: assistantToolActivities.recordOutput,
          });

          let ackInfo = null;
          if (result && result.ackToken && result._ackPromise) {
            ackInfo = result._ackPromise;
            delete result._ackPromise;
          }
          if (name === 'run_tool' && result && typeof result === 'object') {
            if (result.needApproval) pendingApprovalEmitted = true;
            if (result.toolJobId && !result.needApproval) {
              _pushUniqueResultCard(assistantResultCards, _buildResultCardFromRunTool(result, context));
            }
          }
          const toolResultEvent = buildToolResultEvent(envelope, args, { iteration: iter + 1 });
          assistantToolActivities.recordResult(toolResultEvent);
          _emit(toolResultEvent);
          if (callId) toolResultEventsByCallId[callId] = toolResultEvent;

          if (ackInfo) {
            const ackResult = await ackInfo;
            if (ackResult && ackResult.timedOut) {
              result.unhandled = true;
              result.message = (result.message || '操作已记录') + '（⚠ 前端没有响应——可能当前页面没监听这个事件）';
              const ackEvent = buildToolResultEvent({ ...envelope, data: result }, args, { iteration: iter + 1 });
              ackEvent.summary = 'unhandled';
              assistantToolActivities.recordResult(ackEvent);
              _emit(ackEvent);
            } else if (ackResult && ackResult.info && ackResult.info.error) {
              result.unhandled = true;
              result.message = (result.message || '操作已记录') + '（前端报错：' + ackResult.info.error + '）';
            }
          }
          envelope = replaceToolResultData(envelope, result);
          return { envelope, result, args, name, callId };
        },
        reject: async ({ name, args, callId, error, message }) => {
          if (name === 'run_tool' && executionPolicy.allowExecution) {
            _loopInit(toolCtx.projectId, toolCtx.conversationId);
          }
          assistantToolActivities.recordCall({ name, args, traceId, callId, iteration: iter + 1 });
          _emit(buildToolCallEvent({ name, args, traceId, callId, iteration: iter + 1 }));
          let envelope = createRejectedToolResult(name, error, message, toolCtx, { traceId, callId });
          const result = localizeToolResult(envelope.data);
          envelope = replaceToolResultData(envelope, result);
          const toolResultEvent = buildToolResultEvent(envelope, args, { iteration: iter + 1 });
          assistantToolActivities.recordResult(toolResultEvent);
          _emit(toolResultEvent);
          return { envelope, result, args, name, callId };
        },
        onResult: ({ outcome }) => {
          messages.push({
            role: 'tool',
            tool_call_id: outcome.callId,
            name: outcome.name,
            content: serializeToolResultForModel(outcome.envelope, undefined, {
              state: modelResultState,
            }),
          });
        },
      });

      _loopPersistProgressIteration(iter + 1, assistantToolActivities, toolResultEventsByCallId);
    }

    cancellationObserved = aborted();

    // ---------- Post-turn loop processing ----------
    if (loopRunId) {
      const activities = assistantToolActivities.snapshot();
      const toolJobs = activities
        .filter((a) => a.name === 'run_tool' && a.callId)
        .map((a) => {
          const evt = toolResultEventsByCallId[a.callId];
          const resultData = evt && evt.toolResult && evt.toolResult.data
            ? evt.toolResult.data
            : {};
          const toolJobId = evt?.toolJobId || resultData.toolJobId || null;
          let jobTruth = null;
          if (toolJobId) {
            try {
              jobTruth = getToolJob(toolJobId) || null;
              if (jobTruth) {
                const parsed = jobTruth.result_json ? JSON.parse(jobTruth.result_json) : null;
                loopArtifactCache[toolJobId] = {
                  toolJobId,
                  job: jobTruth,
                  result_json: parsed,
                  files: _extractArtifactFiles(parsed),
                };
              }
            } catch {}
          }
          const resultFailed = resultData.ok === false || Boolean(resultData.error);
          const status = jobTruth
            ? jobTruth.status
            : resultFailed
              ? 'failed'
              : (evt && evt.toolResult && evt.toolResult.status)
                ? evt.toolResult.status
                : (a.status === 'error' ? 'failed' : a.status === 'success' ? 'completed' : 'unknown');
          return {
            toolJobId: toolJobId || null,
            toolId: jobTruth?.tool_id || resultData.toolId || evt?.toolId || null,
            callId: a.callId,
            name: a.name,
            status,
            iteration: a.iteration,
            jobTruth,
            error: jobTruth?.error || resultData.error || resultData.message || null,
            reasonCode: resultData.reasonCode || resultData.reason_code || null,
            requiresUserInput: isUserInputRequiredError(resultData.error),
          };
        });

      // Validator check
      const validatorResults = [];
      for (const job of toolJobs) {
        if (!job.toolJobId || !loopArtifactCache[job.toolJobId]) continue;
        const cache = loopArtifactCache[job.toolJobId];
        if (!cache.result_json) continue;
        const sources = [
          ...(cache.result_json.artifacts || []),
          ...(cache.result_json.outputs || []),
          ...(cache.result_json.files || []),
        ];
        for (const item of sources) {
          if (!item || typeof item !== 'object') continue;
          const artifact = {
            kind: item.type || item.kind || cache.result_json.toolId || 'unknown',
            type: item.type || item.kind || 'unknown',
            name: item.name || item.filename || 'unknown',
            url: item.url || null,
            metadata: item,
          };
          try {
            const vr = validateArtifact(artifact, {
              toolJobId: job.toolJobId,
              projectId: toolCtx.projectId,
              userId,
            });
            if (vr.overallStatus !== 'unavailable' || (vr.findings && vr.findings.length > 0)) {
              validatorResults.push({ ...vr, toolJobId: job.toolJobId, artifactName: artifact.name });
            }
          } catch {}
        }
      }

      // Failure diagnosis and repair
      let repairAttempt = null;
      let diagnosis = null;
      const failedJobs = toolJobs.filter((job) => ['failed', 'blocked'].includes(job.status));
      if (failedJobs.length > 0) {
        const primaryFailed = failedJobs.find((j) => j.toolJobId) || failedJobs[0];
        try {
          diagnosis = diagnoseFailure(
            {
              tool_id: primaryFailed.jobTruth ? primaryFailed.jobTruth.tool_id : null,
              error: primaryFailed.jobTruth ? primaryFailed.jobTruth.error : primaryFailed.error,
              reason_code: primaryFailed.reasonCode,
              status: primaryFailed.jobTruth ? primaryFailed.jobTruth.status : primaryFailed.status,
            },
            {
              toolId: primaryFailed.jobTruth ? primaryFailed.jobTruth.tool_id : null,
              artifactValidationResults: validatorResults.filter((vr) => vr.toolJobId === primaryFailed.toolJobId),
            }
          );
        } catch (e) {
          diagnosis = {
            faultType: 'unknown_failure',
            defaultBehavior: 'require_user',
            strategies: ['ask_user_design'],
            message: `诊断失败: ${e.message}`,
            confidence: 0.1,
          };
        }
        if (diagnosis) {
          try {
            const repairCtx = {
              parentJobId: primaryFailed.toolJobId,
              originalToolId: primaryFailed.jobTruth ? primaryFailed.jobTruth.tool_id : null,
              originalParams: primaryFailed.jobTruth && primaryFailed.jobTruth.params_json
                ? JSON.parse(primaryFailed.jobTruth.params_json)
                : null,
              originalInputs: null,
              parentArtifactIds: [],
              dag: null,
              fallbackProvider: null,
            };
            repairAttempt = selectRepairStrategy(diagnosis, repairCtx);
          } catch {}
        }
      }

      // State digest
      const stateDigest = deriveObservedStateDigest({
        toolJobs: toolJobs.map((job) => ({
          id: job.toolJobId || job.callId,
          status: job.status,
          error: job.jobTruth && job.jobTruth.error,
          finished_at: job.jobTruth && job.jobTruth.completed_at,
        })),
        conversationSummary: assistantProgress.snapshot().slice(-1)[0]?.content || '',
        dagProgress: {
          persistedIterations: loopIterations.length,
          toolActivities: activities.length,
        },
      });

      const activeJobs = toolJobs.filter((j) => j.status === 'running' || j.status === 'pending');
      const unresolvedFailedJobs = failedJobs.filter((_job) => !repairAttempt || !repairAttempt.repaired);

      // False success check
      const falseSuccessJobs = [];
      for (const failed of unresolvedFailedJobs) {
        if (!failed.toolJobId || !loopArtifactCache[failed.toolJobId]) continue;
        const cache = loopArtifactCache[failed.toolJobId];
        if (!cache.files || cache.files.length === 0) continue;
        const truth = cache.result_json?.artifactTruth;
        if (!truth || truth.status !== 'valid') {
          falseSuccessJobs.push(failed.toolJobId);
        }
      }

      if (cancellationObserved || loopAbortedByController) {
        loopSequence += 1;
        const parentHash = loopIterations.length > 0 ? loopIterations[loopIterations.length - 1].hash : null;
        const iteration = buildIteration({
          loopRunId,
          sequence: loopSequence,
          observedStateDigest: stateDigest,
          goalGapIds: [],
          proposedAction: null,
          decision: 'cancel',
          decisionReasonCode: REASON_CODES.TRANSIENT_RUNTIME_RETRY,
          publicConclusion: cancellationObserved
            ? '用户取消。已完成的阶段已保留。'
            : 'Loop Controller 已终止任务。',
          status: 'skipped',
          parentIterationHash: parentHash,
          createdAt: new Date().toISOString(),
        }, {
          validatorResults: validatorResults.slice(),
          repairAttempt: null,
          costSnapshot: null,
        });
        try { persistLoopIteration(iteration); loopIterations.push(iteration); } catch {}
        _loopSaveCheckpoint(iteration, toolCtx.projectId, toolCtx.conversationId, {
          validatorResults: validatorResults.slice(),
        });
        loopState = 'cancelled';
        loopPublicConclusion = iteration.publicConclusion;
        _loopEmitIterationEvent(iteration, 'cancel', null);
        _loopPersistPhase('cancelled', iteration.publicConclusion);
      } else {
        let decision = 'continue';
        let decisionReasonCode = REASON_CODES.TOOL_SUCCEEDED;
        let publicConclusion = null;

        const requiresUserDecision = unresolvedFailedJobs.some((job) => job.requiresUserInput) ||
          (diagnosis?.defaultBehavior === 'require_user' || repairAttempt?.requiresUserAuth === true);

        if (falseSuccessJobs.length > 0) {
          decision = 'block';
          decisionReasonCode = REASON_CODES.ARTIFACT_VALIDATION_FAILED;
          publicConclusion = `检测到假成功：任务失败但产生了文件（${falseSuccessJobs.length} 个）。已验证结果不完整，禁止宣称完成。`;
        } else if (requiresUserDecision) {
          decision = 'wait';
          decisionReasonCode = REASON_CODES.USER_INPUT_REQUIRED;
          publicConclusion = '关键输入或科学设计尚未确认；系统未创建非法 Job，等待补齐必要信息。';
        } else if (unresolvedFailedJobs.length > 0) {
          decision = 'retry';
          decisionReasonCode = REASON_CODES.TRANSIENT_RUNTIME_RETRY;
          publicConclusion = diagnosis && diagnosis.message
            ? `故障分类：${diagnosis.faultType}。${diagnosis.message}`
            : `工具执行失败（${unresolvedFailedJobs.length} 个）。Loop Controller 将在下一轮决策中处理。`;
        } else if (activeJobs.length > 0) {
          decision = 'continue';
          publicConclusion = `工具执行中（${activeJobs.length} 个运行中）。继续监控。`;
        } else if (modelFinalized || activities.length === 0) {
          decision = 'complete';
          decisionReasonCode = REASON_CODES.GOAL_ACHIEVED;
          publicConclusion = modelFinalized
            ? '已根据真实工具与产物状态完成本轮交付。'
            : '本轮无工具调用，已整理最终答复。';
        } else {
          publicConclusion = assistantProgress.snapshot().slice(-1)[0]?.content || '';
        }

        loopSequence += 1;
        const parentHash = loopIterations.length > 0 ? loopIterations[loopIterations.length - 1].hash : null;
        const iteration = buildIteration({
          loopRunId,
          sequence: loopSequence,
          observedStateDigest: stateDigest,
          goalGapIds: [],
          proposedAction: null,
          decision,
          decisionReasonCode,
          publicConclusion,
          status: mapDecisionToIterationStatus(decision),
          parentIterationHash: parentHash,
          createdAt: new Date().toISOString(),
        }, {
          validatorResults: validatorResults.slice(),
          repairAttempt,
          costSnapshot: null,
        });
        try { persistLoopIteration(iteration); loopIterations.push(iteration); } catch {}
        _loopSaveCheckpoint(iteration, toolCtx.projectId, toolCtx.conversationId, {
          validatorResults: validatorResults.slice(),
          repairAttempt,
        });
        _loopEmitIterationEvent(iteration, decision, null);

        if (decision === 'complete') {
          loopState = 'completed';
          loopPublicConclusion = iteration.publicConclusion;
          _loopPersistPhase('completed', iteration.publicConclusion);
        } else if (decision === 'block') {
          loopState = 'blocked';
          loopPublicConclusion = iteration.publicConclusion;
          _loopPersistPhase('blocked', iteration.publicConclusion);
        } else if (decision === 'wait') {
          loopState = 'waiting_for_user';
          loopPublicConclusion = iteration.publicConclusion;
          _loopPersistPhase('waiting_for_user', iteration.publicConclusion);
        }
      }
    }

    if (!cancellationObserved && !loopAbortedByController && modelFinalized) {
      emitDone();
    }

    if (providerFailureReason) {
      fatalAgentError = new Error(providerFailureReason);
      const final = finalizeResultEditProgress(resultEditProgress, {
        outcome: 'failed', reason: 'agent_run_failed',
      });
      if (final.terminal) _emit({ event: 'result_edit_progress', ...final.terminal });
      assistantAcc = final.assistantMessage;
      _emit({ choices: [{ delta: { content: assistantAcc } }] });
      _emit({ error: providerFailureReason });
    } else if (cancellationObserved || loopAbortedByController) {
      const final = finalizeResultEditProgress(resultEditProgress, {
        outcome: 'cancelled', reason: 'user_cancelled',
      });
      if (final.terminal) _emit({ event: 'result_edit_progress', ...final.terminal });
      assistantAcc = final.assistantMessage;
      _emit({ event: 'agent_cancelled', reason: 'user_cancelled' });
    } else if (!assistantAcc || assistantAcc.trim().length === 0) {
      const fallbackMsg = require('./agent-tools').buildFinalizationFallbackMessage({
        attempts: finalizationAttempts,
        reason: finalizationFailureReason,
        anomaly: toolCallController.anomaly,
        lastStageConclusion: assistantProgress.snapshot().slice(-1)[0]?.content,
      });
      _emit({ choices: [{ delta: { content: fallbackMsg } }] });
      assistantAcc = fallbackMsg;
    }
  } catch (e) {
    fatalAgentError = e;
    cancellationObserved = cancellationObserved || aborted();
    if (_activeConv && resultEditProgress.snapshot().length > 0) {
      const final = finalizeResultEditProgress(resultEditProgress, {
        outcome: cancellationObserved ? 'cancelled' : 'failed',
        reason: cancellationObserved ? 'user_cancelled' : 'agent_run_failed',
      });
      if (final.terminal) _emit({ event: 'result_edit_progress', ...final.terminal });
      assistantAcc = final.assistantMessage;
    }
    _emit({ error: e.message });
    if (loopRunId && !cancellationObserved) {
      _loopPersistPhase('failed', 'Harness Loop 收口失败，执行记录与已有产物已保留。');
    }
  }

  return {
    assistantText: assistantAcc,
    // BLOCK-34 P1 — 工具活动 recorder 随结果返回，供 agent-runner 落库到
    // 会话消息 meta（修复「任务完成后工具记录消失」：此前落库传 null）。
    assistantToolActivities,
    // UI-272 — 思考段随结果返回，供 agent-runner 落库到消息 meta
    reasoningByIteration,
    loopRunId,
    loopState,
    toolResultEventsByCallId,
    loopArtifactCache,
    loopIterations,
    assistantResultCards,
    cancellationObserved,
    loopAbortedByController,
    providerFailureReason,
    finalizationAttempts,
    fatalAgentError,
    pendingApprovalEmitted,
    // BLOCK-56 P1 — 任务级降级判定依据：本任务是否已发生过请求级降级
    modelFallbackOccurred,
  };
}

module.exports = { runLoop };

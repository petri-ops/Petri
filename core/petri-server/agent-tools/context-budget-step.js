'use strict';

/**
 * BLOCK-366（NSO-W5b）runLoop 首个拆分切片：上下文预算步骤（每轮估算 → 预算环事件 →
 * 越线修剪 → CP-5 摘要/增量摘要 → 修剪后事件）。逐字搬自 loop-orchestrator 迭代体
 * （BLOCK-51 P2 / BLOCK-172 CP-5/CP-7 / BLOCK-365 W1-F02/F14/F15），仅把闭包变量改为显式参数、
 * 跨轮状态（修剪次数 / 滞回锚）改为返回值——行为不变，由拆前冻结的 54 项定向基线拆后同套绿钉住。
 * 消息数组就地替换（保持调用方持有的引用稳定）。
 *
 * @returns {Promise<{ contextBudgetTrims: number, contextBudgetHysteresisUntil: number }>}
 */
const { estimateRequestTokens, computeContextBreakdown } = require('../helpers/token-estimator');
const { trimMessagesToBudget } = require('../helpers/message-trimmer');

async function runContextBudgetStep({
  messages,
  loopContextWindow,
  reqMaxTokens,
  toolDefinitionsTokens = 0,
  modelName,
  contextBudgetTrims = 0,
  contextBudgetHysteresisUntil = 0,
  callChatProvider,
  callProviderWithNetworkRetry = (fn) => fn(),
  providerName,
  apiKey,
  userId,
  activeConvId = null,
  iter = 0,
  emit = () => {},
}) {
  let summaryFailure = null;
  // W1-F02 — 滞回锚：记录最近一次估算总量，供下一轮判断是否再修剪。
  let est_last = null;
  // BLOCK-51 P2 — 上下文熔断：每轮请求构造前预算检查，超过 ctxWindow*0.85 时
  // 用既有 trimMessagesToBudget 一次性修剪（保近期+工具结果/压缩历史/摘要提示）。
  // system prompt 不参与 trim（trimmer 语义本就如此）；就地替换内容保持数组引用稳定。
  {
    try {
      const hasSystem = messages.length > 0 && messages[0].role === 'system';
      const est = estimateRequestTokens({
        systemPrompt: hasSystem ? (messages[0].content || '') : '',
        messages: hasSystem ? messages.slice(1) : messages,
        maxTokens: reqMaxTokens, // 与下方 reqBody.max_tokens 一致（CP-7 可配）
      });
      // UI-622 — 真实构成分类（系统/工具定义/消息/工具结果/其他系统/输出预留）
      const breakdown = computeContextBreakdown({
        systemPrompt: hasSystem ? (messages[0].content || '') : '',
        messages: hasSystem ? messages.slice(1) : messages,
        toolDefinitionsTokens,
        maxTokens: reqMaxTokens,
      });
      // BLOCK-163 W3 P5（MDL-2）— 按模型校准系数修正估算（cl100k 对 CJK 重度
      // 文本系统性高估；EWMA 自愈见 helpers/model-token-ratios.js）
      const { calibratedEstimate } = require('../helpers/model-token-ratios');
      const calibratedTotal = calibratedEstimate(breakdown.total, modelName);
      est_last = { calibratedTotal };
      // BLOCK-172 CP-7 — 每轮发放 token_budget（trimmed=false）：预算环全程
      // 实数（原形态=仅 0.85 危机时发一次，UI 恒占位 `—`）。事件面 additive，
      // 既有消费方（agentTaskStream→petriEvents.tokenBudget→ContextBudgetBar）
      // 零改动；UI-622 起附 breakdown 分类。
      emit({
        event: 'token_budget',
        contextWindow: loopContextWindow,
        messagesTokensUsed: breakdown.total,
        systemPromptTokens: est.systemPromptTokens,
        messagesTokens: est.messagesTokens,
        breakdown,
        pct: Math.min(100, Math.round((calibratedTotal / loopContextWindow) * 100)),
        trimmed: false,
        messagesDropped: 0,
      });
      // W1-F02 — 每轮重估（latch 已移除）。修剪目标=把总量压到触发线以下并预留本输出：
      // budget = 0.75×ctx − system − toolDefs − maxTokens（0.75 留出滞回带）。
      // 修剪目标：消息预算 = 0.75×ctx − system − 工具定义 − 本轮输出上限（0.75 留滞回带，
      // 修剪后总量低于 0.85 触发线）；trimmer 语义 budget = ctx − sys − headroom，故换算 headroom。
      // 活动轮由 trimmer 兜底保留（预算再紧也不丢本轮任务）。
      const messagesBudget = Math.max(512, Math.floor(loopContextWindow * 0.75)
        - Math.ceil(est.systemPromptTokens) - Math.ceil(toolDefinitionsTokens) - reqMaxTokens);
      const trimTargetBudget = loopContextWindow - Math.ceil(est.systemPromptTokens) - messagesBudget;
      const shouldTrimNow = calibratedTotal > loopContextWindow * 0.85
        && (contextBudgetTrims === 0 || calibratedTotal > contextBudgetHysteresisUntil);
      if (shouldTrimNow) {
        const result = trimMessagesToBudget({
          fullMessages: messages,
          contextWindow: loopContextWindow,
          headroom: trimTargetBudget,
          systemPromptTokens: est.systemPromptTokens,
        });
        if (result.stats && result.stats.trimmed) {
          contextBudgetTrims += 1;
          const trimmed = result.messages;
          // W1-F14/F15 — 上一份摘要与位置：二次压缩做增量摘要，原系统提示恒为首条不被挤出。
          let previousSummary = null;
          if (messages[0] && messages[0].role === 'system' && /自动压缩摘要/.test(String(messages[0].content || ''))) {
            previousSummary = messages[0].content;
          } else {
            const idx = messages.findIndex((m) => m.role === 'system' && /自动压缩摘要/.test(String(m.content || '')));
            if (idx > 0) previousSummary = messages[idx].content;
          }
          // BLOCK-172 CP-5 — 摘要式 auto-compact：丢弃前对将丢头部生成摘要
          // （走既有 chat 通道→io-transcript 天然留证=可审计压缩），注入摘要
          // 系统消息到保留下文头部。fail-open：摘要失败/无渠道→回退纯丢弃
          // （既有行为），不阻塞任务。dropped 太少（<4 条）不值得一跳模型调用。
          const droppedCount = messages.length - trimmed.length;
          // W1-F15 — trimmer 返回真实被丢集合（旧形态 slice(0, droppedCount) 前缀≠真实被丢集）
          const droppedReal = Array.isArray(result.dropped) ? result.dropped : messages.slice(0, droppedCount);
          let compactSummaryText = null;
          if (droppedCount >= 4) {
            try {
              // W1-F14 — 增量摘要：摘要源携带上一份摘要（二次压缩不丢既有结论）
              const droppedForSummary = droppedReal
                .slice(-24) // 摘要源窗口：最近 24 条将丢消息（更早的仪式性内容价值低）
                .map((m) => `${m.role === 'user' ? '用户' : m.role === 'assistant' ? 'AI' : m.role}: ${String(m.content || '').slice(0, 400)}`);
              const summaryBody = (previousSummary ? `${previousSummary}\n\n=== 以上为上一份摘要，合并下方新移除内容 ===\n\n` : '')
                + droppedForSummary.join('\n\n');
              const summaryInput = summaryBody.slice(-24000);
              const summaryJson = await callProviderWithNetworkRetry(() =>
                callChatProvider(
                  providerName,
                  apiKey,
                  {
                    ...(modelName ? { model: modelName } : {}),
                    messages: [
                      { role: 'system', content: '你是会话压缩器。把给定的较早对话压缩为一份事实性摘要：保留用户目标、已完成的步骤与工具、关键结论与数字、未完成事项。不新增臆测。直接输出摘要正文。' },
                      { role: 'user', content: summaryInput },
                    ],
                    temperature: 0.2,
                    max_tokens: 1200,
                  },
                  { userId, conversationId: activeConvId, kind: 'agent_context_compaction' },
                )
              );
              const summaryChoice = summaryJson && summaryJson.choices && summaryJson.choices[0];
              compactSummaryText = summaryChoice && summaryChoice.message && typeof summaryChoice.message.content === 'string'
                ? summaryChoice.message.content.trim()
                : null;
            } catch (e) {
              compactSummaryText = null;
              summaryFailure = `summary_call_failed: ${e && e.message}`;
              // BLOCK-376（S1 / G-11）——异常不再走 console 双通道：summaryFailure 已由
              // 下方 compaction_failed 事件承载（W1-F14 可见性契约），console 重复通道删除。
            }
          }
          if (droppedCount >= 4 && !compactSummaryText) {
            // W1-F14/F15 — 摘要缺席必须可见且不撒谎：事件 + 诚实告知（旧形态无条件
            // 声称「上面有摘要」，摘要失败时是对模型的不实声明）。
            summaryFailure = summaryFailure || 'empty_summary';
            emit({ event: 'compaction_failed', reason: summaryFailure, dropped: droppedCount, at: new Date().toISOString() });
          }
          const priorSystem = messages.length > 0 && messages[0].role === 'system' && !/自动压缩摘要/.test(String(messages[0].content || ''))
            ? messages[0] : null;
          messages.length = 0;
          if (priorSystem) messages.push(priorSystem);
          if (compactSummaryText) {
            messages.push({
              role: 'system',
              content: `（BLOCK-172 CP-5 自动压缩摘要 · 覆盖较早 ${droppedCount} 条对话，原文见 llm-transcripts）
${compactSummaryText}`,
            });
          } else if (previousSummary) {
            // W1-F14 — 本次未重生摘要（被丢 <4 条或摘要失败）时，上一份摘要原样延续，绝不丢失既有结论
            messages.push({ role: 'system', content: previousSummary });
          }
          if (!compactSummaryText && droppedCount > 0) {
            // 诚实告知：早期内容已移除且本次未能生成摘要
            messages.push({
              role: 'system',
              content: `（上下文修剪：较早 ${droppedCount} 条对话已移除${summaryFailure ? '，且本次未能生成摘要（' + summaryFailure + '）' : ''}。如需引用早期信息，请向用户确认。）`,
            });
          }
          for (const m of trimmed) {
            if (m !== priorSystem && !(m.role === 'system' && /自动压缩摘要/.test(String(m.content || '')))) messages.push(m);
          }
          const trimmedHasSystem = messages.length > 0 && messages[0].role === 'system';
          const trimmedBreakdown = computeContextBreakdown({
            systemPrompt: trimmedHasSystem ? (messages[0].content || '') : '',
            messages: trimmedHasSystem ? messages.slice(1) : messages,
            toolDefinitionsTokens,
            maxTokens: reqMaxTokens,
          });
          emit({
            event: 'token_budget',
            contextWindow: loopContextWindow,
            messagesTokensUsed: trimmedBreakdown.total,
            systemPromptTokens: trimmedBreakdown.systemPrompt,
            messagesTokens: trimmedBreakdown.messages + trimmedBreakdown.toolResults,
            breakdown: trimmedBreakdown,
            pct: Math.min(100, Math.round((trimmedBreakdown.total / loopContextWindow) * 100)),
            trimmed: true,
            messagesDropped: result.stats.messagesDropped,
          });
          // W1-F02 — 滞回锚=修剪后校准总量：仅当再次增长越过它（仍高于触发线）才再修剪。
          est_last = { calibratedTotal: calibratedEstimate(trimmedBreakdown.total, modelName) };
          contextBudgetHysteresisUntil = est_last.calibratedTotal;
          emit({
            event: 'context_compacted',
            dropped: droppedCount,
            summarized: Boolean(compactSummaryText),
            summaryHead: compactSummaryText ? compactSummaryText.slice(0, 300) : null,
            at: new Date().toISOString(),
          });
          console.log(`[context-breaker] iter ${iter + 1} trimmed ${result.stats.messagesDropped} messages${compactSummaryText ? ' +summary(CP-5)' : ''}: ${est.total} → ${result.stats.messagesTokensUsed} tokens (ctx ${loopContextWindow})`);
        }
      }
    } catch (e) {
      // BLOCK-376（S1 / G-11）——裁剪管线异常改发 trim_skipped{reason} 事件（轨迹面
      // 可见），console 降为运维兜底通道。
      try {
        emit({ event: 'trim_skipped', reason: `context_breaker_error: ${e && e.message}`, at: new Date().toISOString() });
      } catch { /* 观测面故障不阻塞主流程 */ }
      console.log('[context-breaker-error]', e && e.message);
    }
  }
  return { contextBudgetTrims, contextBudgetHysteresisUntil };
}

module.exports = { runContextBudgetStep };

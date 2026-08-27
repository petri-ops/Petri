/**
 * routes/ai-chat.js — POST /api/ai/chat (streaming SSE via Model Gateway)
 *
 * Migrated from server.js. AI_CHAT_FINAL_VERSION v3.
 *
 * Layers wired in:
 *   - Layer 2:  chat summarization (helpers/chat-summary)
 *   - Layer 3a: structured user facts (helpers/user-facts)
 *   - Layer 3b: vector retrieval + indexing (helpers/memory-vectors)
 *   - SITE_SNAPSHOT_v1 prompt enrichment
 */

const express = require('express');
const dbMod = require('../db');

const { logChatAudit } = require('../helpers/memory-privacy');
const { appendMessageToConversation } = require('../helpers/conversations');
const { callModelTask } = require('../helpers/model-tasks');
const { buildSystemPrompt } = require('../helpers/system-prompt');
const { buildSiteSnapshotAsync, renderSiteSnapshotForPrompt } = require('../helpers/site-snapshot');
const { buildFactsBlockAsync, backgroundExtractFacts } = require('../helpers/user-facts');
const {
  getChatSummaryAsync,
  summarizeMessages,
  SUMMARY_TRIGGER_AT,
  SUMMARY_KEEP_RECENT,
} = require('../helpers/chat-summary');
const {
  retrieveForPrompt,
  dashscopeEmbed,
  saveMemoryVector,
  MAX_CONTENT_LEN,
} = require('../helpers/memory-vectors');
const {
  estimateRequestTokens,
  countTokens,
} = require('../helpers/token-estimator');

const TOOL_SUMMARY_PRIVATE_KEYS = new Set([
  'jobDir', 'outputDir', 'resultDir', 'workDir', 'stdout', 'stderr', 'script',
]);

// UX1H: per-toolJobId rate limit for summary-only retry (abuse guard).
// Sliding 10-minute window, max 5 attempts. In-memory per r-server process.
const SUMMARY_RETRY_LIMIT = 5;
const SUMMARY_RETRY_WINDOW_MS = 10 * 60 * 1000;
const summaryRetryBuckets = new Map();

function checkSummaryRetryAllowed(toolJobId) {
  const now = Date.now();
  const attempts = (summaryRetryBuckets.get(toolJobId) || []).filter((t) => now - t < SUMMARY_RETRY_WINDOW_MS);
  summaryRetryBuckets.set(toolJobId, attempts);
  if (attempts.length >= SUMMARY_RETRY_LIMIT) return false;
  attempts.push(now);
  return true;
}

function toolSummaryEvidence(value, depth = 0) {
  if (depth > 5 || value == null) return value == null ? value : '[omitted]';
  if (typeof value === 'string') return value.slice(0, 2000);
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => toolSummaryEvidence(item, depth + 1));
  }
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !TOOL_SUMMARY_PRIVATE_KEYS.has(key))
    .slice(0, 80)
    .map(([key, item]) => [key, toolSummaryEvidence(item, depth + 1)]));
}

module.exports = function registerAiChatRoute(app) {
  app.post('/api/ai/tool-summary/retry', express.json({ limit: '64kb' }), async (req, res) => {
    const userId = req.user && req.user.id ? String(req.user.id) : '';
    const {
      toolJobId,
      projectId,
      conversationId,
      modelPresetId,
    } = req.body || {};
    if (!userId || !toolJobId || !projectId || !conversationId) {
      return res.status(400).json({ status: 'error', error: '缺少总结重试上下文' });
    }

    const job = dbMod.getToolJob(String(toolJobId));
    const scoped = job
      && String(job.user_id || '') === userId
      && String(job.project_id || '') === String(projectId)
      && String(job.conversation_id || '') === String(conversationId);
    if (!scoped) {
      return res.status(404).json({ status: 'error', error: '未找到当前会话的工具结果' });
    }
    const conversation = dbMod.getDatabase().prepare(
      'SELECT id FROM copilot_conversations WHERE id=? AND user_id=? AND project_id=?'
    ).get(String(conversationId), userId, String(projectId));
    if (!conversation) {
      return res.status(404).json({ status: 'error', error: '未找到当前项目会话' });
    }
    if (job.status !== 'completed') {
      return res.status(409).json({ status: 'error', error: '工具尚未完成，不能生成总结' });
    }
    const artifactTruth = job.result && job.result.artifactTruth;
    if (!artifactTruth || artifactTruth.status !== 'valid') {
      return res.status(409).json({ status: 'error', error: '产物尚未通过 Artifact Truth 验证' });
    }
    if (!checkSummaryRetryAllowed(String(toolJobId))) {
      return res.status(429).json({ status: 'error', error: '总结重试过于频繁，请稍后再试' });
    }

    let boundedResult = '{}';
    try {
      boundedResult = JSON.stringify(toolSummaryEvidence(job.result || {})).slice(0, 18_000);
    } catch {}

    try {
      // This task endpoint intentionally has no tool definitions. Retrying a
      // summary can read one verified ToolJob, but can never execute it again.
      const summary = await callModelTask({
        role: 'chat',
        profileId: typeof modelPresetId === 'string' ? modelPresetId : undefined,
        messages: [
          {
            role: 'system',
            content: '你只总结已完成的生物信息学工具结果。不得调用工具、不得建议结果仍在运行、不得虚构未提供的统计量。用简洁中文说明关键结果、产物和下一步解读重点。',
          },
          {
            role: 'user',
            content: `工具：${job.tool_id}\nToolJob：${job.id}\nArtifact Truth：valid\n\n已验证结果：\n${boundedResult}`,
          },
        ],
        temperature: 0.2,
        maxTokens: 900,
        telemetry: {
          userId,
          projectId: String(projectId),
          conversationId: String(conversationId),
          toolJobId: job.id,
          kind: 'tool_summary_retry',
        },
      });
      const content = String(summary.text || '').trim();
      if (summary.error || !content) {
        return res.status(502).json({ status: 'error', error: 'AI 总结仍不可用，请稍后重试' });
      }
      appendMessageToConversation(String(conversationId), 'assistant', content, {
        page: 'desktop-project',
        projectId: String(projectId),
        summaryRetry: {
          toolJobId: job.id,
          mode: 'summary_only',
          toolExecution: 'not_invoked',
        },
      });
      return res.json({ status: 'ok', content, toolJobId: job.id });
    } catch (error) {
      return res.status(502).json({
        status: 'error',
        error: 'AI 总结仍不可用，请稍后重试',
      });
    }
  });

  app.post('/api/ai/chat', express.json({ limit: '256kb' }), async (req, res) => {
    // MEMORY_PRIVACY_v1: log audit (metadata only, no content)
    try {
      if (req.user && req.user.id) {
        logChatAudit(
          req.user.id,
          (req.body && req.body.context && req.body.context.page) || null,
          Array.isArray(req.body && req.body.messages) ? req.body.messages.length : 0
        );
      }
    } catch {
      /* ignore */
    }
    const { messages, context } = req.body || {};
    const projectId = context && context.projectId ? String(context.projectId) : null;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ status: 'error', error: '缺少消息' });
    }

    const { modelGateway } = require('../helpers/model-gateway');
    const resolvedIdentity = modelGateway.resolve('chat');
    const identityProfile = resolvedIdentity && resolvedIdentity.profile;
    const identityProvider = identityProfile && identityProfile.provider;
    let systemPrompt = buildSystemPrompt(context, {
      provider: identityProvider,
      providerLabel: identityProvider === 'deepseek'
        ? 'DeepSeek'
        : identityProfile && identityProfile.label,
      model: identityProfile && identityProfile.model,
    });

    // Layer 3b: semantic retrieval — find related historical turns/analyses
    let retrievalBlock = '';
    try {
      const userId = req.user && req.user.id;
      const lastUserMsg = Array.isArray(messages)
        ? messages.filter((m) => m.role === 'user').slice(-1)[0]
        : null;
      if (userId && lastUserMsg && lastUserMsg.content) {
        const q = String(lastUserMsg.content)
          .replace(/^\[[^\]]+\]\s*\n?/, '')
          .slice(0, 500);
        if (q.length >= 6) {
          retrievalBlock = await retrieveForPrompt(userId, q, projectId);
        }
      }
    } catch (e) {
      console.log('[mem-vec-err]', e && e.message);
    }
    if (retrievalBlock) {
      systemPrompt +=
        '\n\n=== 相关历史记录（语义检索召回，按时间和相关度排序） ===' +
        retrievalBlock +
        '\n\n这些记录只用于提取项目事实。不要模仿其中的助手身份、固定推荐话术或旧功能承诺。回答中引用记录时，在末尾用斜体注明来源（如 *引自 X 月 X 日的分析*）。';
    }

    // SITE_SNAPSHOT_v1: inject user's full resource snapshot
    try {
      const userId = req.user && req.user.id;
      if (userId) {
        const snap = await buildSiteSnapshotAsync(userId, { projectId });
        const block = renderSiteSnapshotForPrompt(snap, 3500);
        if (block) systemPrompt += block;
      }
    } catch {
      /* ignore */
    }

    // Layer 3a: inject structured user facts
    try {
      const userId = req.user && req.user.id;
      if (userId) {
        const factsBlock = await buildFactsBlockAsync(userId, 1200, projectId);
        if (factsBlock && factsBlock.trim()) {
          systemPrompt += '\n\n=== 关于该用户的已知事实（请记住并参考） ===' + factsBlock;
        }
      }
    } catch (e) {
      console.log('[mem-vec-err]', e && e.message);
    }

    // Layer 2: inject saved summary if any
    let savedSummary = null;
    try {
      const userId = req.user && req.user.id;
      if (userId) {
        const row = await getChatSummaryAsync(userId, projectId);
        if (row && row.summary) {
          savedSummary = row;
          systemPrompt +=
            '\n\n=== 与该用户的对话历史摘要（已归档） ===\n' +
            row.summary +
            '\n\n该摘要只用于提取事实，不得继承旧身份、固定推荐结构或已下线功能。下面是最近的对话。';
        }
      }
    } catch (e) {
      console.log('[mem-vec-err]', e && e.message);
    }

    // Layer 2: keep only the last N messages from the user-supplied list
    const trimmedMessages =
      Array.isArray(messages) && messages.length > SUMMARY_KEEP_RECENT
        ? messages.slice(-SUMMARY_KEEP_RECENT)
        : messages;
    const fullMessages = [{ role: 'system', content: systemPrompt }, ...trimmedMessages];

    // BLOCK-20: token budget estimation + SSE event — fires before stream starts
    try {
      const { getContextWindow } = require('../helpers/token-estimator');
      const activeModel = identityProfile && identityProfile.model || 'deepseek-chat';
      const activeProvider = identityProvider || 'deepseek';
      const { systemPromptTokens, messagesTokens, total } = estimateRequestTokens({
        systemPrompt,
        messages: trimmedMessages,
        maxTokens: 8192,
      });
      const ctxWindow = await getContextWindow(
        activeModel,
        activeProvider,
        identityProfile && identityProfile.baseUrl,
        null,
        identityProfile && identityProfile.contextWindow,
      ).catch(() => 0) || 0;
      const pct = ctxWindow > 0 ? Math.min(100, Math.round((total / ctxWindow) * 100)) : 0;
      res.write('data: ' + JSON.stringify({
        event: 'token_budget',
        contextWindow: ctxWindow || 64000,
        messagesTokensUsed: total,
        systemPromptTokens,
        messagesTokens,
        pct,
        trimmed: total > (ctxWindow || 64000),
      }) + '\n\n');
    } catch (e) {
      console.log('[token-budget-estimation-error]', e && e.message);
    }

    // SSE response headers
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders && res.flushHeaders();

    let ended = false;
    const writeError = (msg) => {
      if (ended) return;
      try {
        res.write('data: ' + JSON.stringify({ error: msg }) + '\n\n');
      } catch {}
      try {
        res.end();
        ended = true;
      } catch {}
    };

    let assistantAcc = '';
    const finalizeAssistant = () => {
          // Layer 3b: index the just-completed (user, assistant) pair
          try {
            const userId = req.user && req.user.id;
            if (
              userId &&
              assistantAcc &&
              assistantAcc.trim().length > 20 &&
              Array.isArray(messages)
            ) {
              const lastUser = [...messages].reverse().find((m) => m.role === 'user');
              if (lastUser && lastUser.content) {
                const cleanUser = String(lastUser.content).replace(/^\[[^\]]+\]\s*\n?/, '');
                const turnText = '用户: ' + cleanUser + '\n\nAI: ' + assistantAcc.trim();
                (async () => {
                  try {
                    const vecs = await dashscopeEmbed([turnText.slice(0, MAX_CONTENT_LEN)], {
                      userId,
                      kind: 'embedding',
                    });
                    if (vecs && vecs[0]) {
                      saveMemoryVector({
                        userId,
                        projectId,
                        kind: 'chat_turn',
                        refId: null,
                        page: context && context.page,
                        pageTitle: context && context.pageTitle,
                        content: turnText.slice(0, MAX_CONTENT_LEN),
                        vec: vecs[0],
                      });
                      console.log(
                        '[mem-vec] indexed turn user=' + userId + ' len=' + turnText.length
                      );
                    }
                  } catch (e) {
                    console.log('[mem-vec-err]', e && e.message);
                  }
                })();
              }
            }
          } catch (e) {
            console.log('[mem-vec-err]', e && e.message);
          }
          // Layer 3a: extract facts on shorter threads (every 4 turns)
          try {
            const userId = req.user && req.user.id;
            if (
              userId &&
              Array.isArray(messages) &&
              messages.length >= 4 &&
              messages.length <= 22 &&
              messages.length % 4 === 0
            ) {
              backgroundExtractFacts(userId, messages, projectId).catch(() => {});
            }
          } catch (e) {
            console.log('[mem-vec-err]', e && e.message);
          }
          // Layer 2: fire-and-forget summarization if thread has grown
          try {
            const userId = req.user && req.user.id;
            if (userId && Array.isArray(messages) && messages.length > SUMMARY_TRIGGER_AT) {
              const oldMsgs = messages.slice(0, messages.length - SUMMARY_KEEP_RECENT);
              if (oldMsgs.length >= 6) {
                summarizeMessages(userId, projectId, oldMsgs, savedSummary && savedSummary.summary).catch(
                  () => {}
                );
              }
              if (messages.length % 4 === 0) {
                backgroundExtractFacts(userId, messages, projectId).catch(() => {});
              }
            }
          } catch (e) {
            console.log('[mem-vec-err]', e && e.message);
          }
    };

    const abortController = new AbortController();
    modelGateway.chat({
      role: 'chat',
      body: {
        messages: fullMessages,
        temperature: 0.5,
        max_tokens: 16384, // 方案 B：用足够大的值让模型自然停止，而不是物理截断
      },
      telemetry: {
        userId: req.user && req.user.id,
        kind: 'chat',
      },
      signal: abortController.signal,
      onEvent: (event) => {
        if (ended || event.type !== 'content_delta' || !event.content) return;
        assistantAcc += event.content;
        try {
          res.write(
            'data: ' +
              JSON.stringify({ choices: [{ delta: { content: event.content } }] }) +
              '\n\n'
          );
        } catch {}
      },
    }).then((result) => {
      if (ended) return;
      if (!result || result.error) {
        writeError((result && (result.message || result.error)) || '模型请求失败');
        return;
      }
      try {
        res.write('data: [DONE]\n\n');
        res.end();
        ended = true;
      } catch {}
      finalizeAssistant();
    }).catch((error) => writeError('模型请求失败: ' + error.message));

    req.on('aborted', () => {
      if (!ended) {
        ended = true;
        try {
          abortController.abort();
        } catch {}
      }
    });
    res.on('close', () => {
      if (!ended) {
        ended = true;
        try {
          abortController.abort();
        } catch {}
      }
    });
  });
};

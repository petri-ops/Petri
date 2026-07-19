/**
 * routes/ai-chat.js — POST /api/ai/chat (streaming SSE via Model Gateway)
 *
 * Migrated from server.js. AI_CHAT_FINAL_VERSION v3.
 *
 * Layers wired in:
 *   - Layer 2:  chat summarization (helpers/chat-summary)
 *   - Layer 3a: structured user facts (helpers/user-facts)
 *   - Layer 3b: vector retrieval + indexing (helpers/memory-vectors)
 *   - SITE_SNAPSHOT_v1, DOCS_INDEX_v1 prompt enrichment
 */

const express = require('express');

const { logChatAudit } = require('../helpers/memory-privacy');
const { buildSystemPrompt } = require('../helpers/system-prompt');
const { fetchDocsIndex, renderDocsIndexForPrompt } = require('../helpers/docs-index');
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

module.exports = function registerAiChatRoute(app) {
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
          retrievalBlock = await retrieveForPrompt(userId, q);
        }
      }
    } catch (e) {
      console.log('[mem-vec-err]', e && e.message);
    }
    if (retrievalBlock) {
      systemPrompt +=
        '\n\n=== 相关历史记录（语义检索召回，按时间和相关度排序） ===' +
        retrievalBlock +
        '\n\n回答用户问题时如果引用了上述记录，请在回答末尾用斜体注明来源（如 *引自 X 月 X 日的分析*）。';
    }

    // DOCS_INDEX_v1: inject docs/blog/figcode catalog
    try {
      const idx = await fetchDocsIndex();
      const block = renderDocsIndexForPrompt(idx, 2200);
      if (block) systemPrompt += block;
    } catch {
      /* ignore */
    }

    // SITE_SNAPSHOT_v1: inject user's full resource snapshot
    try {
      const userId = req.user && req.user.id;
      if (userId) {
        const snap = await buildSiteSnapshotAsync(userId);
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
        const factsBlock = await buildFactsBlockAsync(userId, 1200);
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
        const row = await getChatSummaryAsync(userId);
        if (row && row.summary) {
          savedSummary = row;
          systemPrompt +=
            '\n\n=== 与该用户的对话历史摘要（已归档） ===\n' +
            row.summary +
            '\n\n上面是之前对话的精华，下面是最近的对话。';
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
              backgroundExtractFacts(userId, messages).catch(() => {});
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
                summarizeMessages(userId, oldMsgs, savedSummary && savedSummary.summary).catch(
                  () => {}
                );
              }
              if (messages.length % 4 === 0) {
                backgroundExtractFacts(userId, messages).catch(() => {});
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
        max_tokens: 1500,
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

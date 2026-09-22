'use strict';

/**
 * routes/ai-agent/chat.js — chat 子域（POST /api/ai/agent 提交端点）
 *
 * BLOCK-109-CORE-ARCH P1（D4，2026-09-21）— legacy 直连 SSE 双轨退役：
 * 原 786 行 legacy SSE handler（自 routes/ai-agent.js 第 311-1097 行下沉）已物理
 * 删除；task 模式（history-assembly 单链组装 → createAgentTask → runAgentLoop
 * 后台跑 → 订阅重连）是唯一提交路径。?legacy=1 / USE_AGENT_TASK_MODE=false
 * 现返回 410 legacy_sse_retired。
 * 组装单链：上下文拼装唯一入口 = helpers/history-assembly.js（与 agent-runner 同源，
 * legacy require 已清零——本文件不再直 require system-prompt/knowledge-space/
 * llm-client 等拼装件）。
 */

const path = require('node:path');

const express = require('express');

// BLOCK-81 P1 — 思考档位归一（中性档位词表与映射内核同源）
const { normalizeThinkingLevel } = require('../../../shared-backend/llm-providers/thinking-level');
const dbMod = require('../../db');
const convSync = require('../../helpers/conversations');
const {
  getOrCreateActiveConversation,
  appendMessageToConversation,
  _maybeAutoTitleConversation,
  _maybeDetectTopicShift,
} = convSync;
const { _getChatSummary } = require('../../helpers/chat-summary');
// BLOCK-95 B1 — 历史拼装权收归后端（组装单链唯一入口）
const { isServerHistoryAssemblyEnabled, assembleServerHistory } = require('../../helpers/history-assembly');
// BLOCK-95 B2 — 会话级 rolling compaction（视图层投影，DB 原文不动；开关默认关）
const {
  isSessionCompactionEnabled,
  applyCompactionView,
  maybeCompactInBackground,
} = require('../../helpers/conversation-compaction');
const {
  _gatherAnalysisContextForMethods,
  _renderMethodsParagraph,
} = require('../../helpers/methods-export');

module.exports = {
  /**
   * @param {object} app   Express app (or equivalent router)
   * @param {object} deps  外部注入的依赖（来自 facade 层）
   * @param {boolean} deps.USE_AGENT_TASK_MODE  是否启用 task 模式（facade 层注入）
   */
  register(app, deps) {
    const USE_AGENT_TASK_MODE = deps?.USE_AGENT_TASK_MODE ?? true;

    // ===== 老路径：直连 SSE（fallback，BIOF3_AGENT_TASK_MODE=legacy 或 ?legacy=1）=====

    app.post('/api/ai/agent', express.json({ limit: '256kb' }), async (req, res) => {
      const { messages, context, modelPresetId, modelName: requestedModelName, thinkingLevel: rawThinkingLevel } = req.body || {};
      // BLOCK-81 P1 — 中性档位归一（非法/缺失＝null＝standard＝不发任何思考参数）
      const thinkingLevel = normalizeThinkingLevel(rawThinkingLevel);
      let explicitConvId = req.body && req.body.conversationId;

      if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ status: 'error', error: '缺少消息' });
      }

      // ===== AGENT_TASK_MODE_v1：task 模式（loop 后台跑 + 订阅重连）=====
      if (USE_AGENT_TASK_MODE && req.query.legacy !== '1') {
        const { getChatProviderName, getChatModelPreset, getChatModelCredential } = require('../../helpers/ai-settings');
        const selectedPreset = getChatModelPreset(modelPresetId);
        const providerName = (selectedPreset && selectedPreset.provider) || getChatProviderName();
        const providerLabel = providerName === 'deepseek'
          ? 'DeepSeek'
          : (selectedPreset && selectedPreset.label) || providerName;
        const modelName = typeof requestedModelName === 'string' && requestedModelName.trim()
          ? requestedModelName.trim().slice(0, 200)
          : selectedPreset && selectedPreset.model;
        const baseUrl = selectedPreset && selectedPreset.baseUrl;
        const apiKey = getChatModelCredential(selectedPreset);
        const { runAgentLoop } = require('../../agent-runner');
        const agentTaskStore = require('../../agent-task-store');
        const { aiTaskConcurrencyAcquire, aiTaskConcurrencyRelease } = require('../../helpers/runtime');

        const userId = req.user && req.user.id;
        if (!userId) {
          return res.status(401).json({ status: 'error', error: '未登录' });
        }

        // BLOCK-88 P2（D3）— 访客工程师检测：经 mobile-gateway 会话门且该会话带
        // P1 配对落档的工程师声明身份（req.mobileSession 仅网关挂载面设置，宿主
        // 本地请求恒 undefined → 行为零变化）。tasks.user_id 维持 'local-user'
        // 权限面语义（subagent 派生所有权检查/并发桶/历史拼装依赖它），归属走
        // params.federated + conversations.origin 双面标记（启动登记实现注记）。
        const fedIdentity = (req.mobileSession && req.mobileSession.identity) || null;

        const wantKind = req.body && req.body.kind === 'subagent' ? 'subagent' : 'primary';
        // BLOCK-88 P3（D4）— 项目授权边界：联邦委托指定 context.projectId 时
        // 必须在宿主 grants 清单内（默认零授权，逐项目授权可随时吊销），
        // 越界诚实 403；无 projectId 的委托不涉项目访问，放行（能力自然受限）。
        const fedProjectId = (context && typeof context.projectId === 'string' && context.projectId.trim()) || null;
        if (fedIdentity && fedProjectId && wantKind === 'primary') {
          const fedDataDir = process.env.BIOF3_LOCAL_DATA_DIR
            || process.env.LOCAL_DATA_DIR
            || path.join(process.cwd(), 'data');
          const granted = require('../../../shared-backend/federation-grants').isProjectGranted(fedDataDir, fedIdentity.displayName, fedProjectId);
          if (!granted) {
            return res.status(403).json({
              status: 'error',
              error: 'federation_project_not_granted',
              message: `工程师「${fedIdentity.displayName}」未被授权访问项目 ${fedProjectId}（宿主默认零授权，请宿主在联邦面板逐项目授权）`,
            });
          }
        }

        let parentTaskId = null;
        let parentLoopRunId = null;
        if (wantKind === 'subagent') {
          parentTaskId = req.body && req.body.parentTaskId;
          if (!parentTaskId) {
            return res.status(400).json({ status: 'error', error: 'subagent 缺少 parentTaskId' });
          }
          let parentTask = null;
          try { parentTask = agentTaskStore.getAgentTask(parentTaskId); } catch {}
          if (!parentTask) {
            return res.status(404).json({ status: 'error', error: 'parentTask 不存在' });
          }
          if (parentTask.userId && parentTask.userId !== userId) {
            return res.status(403).json({ status: 'error', error: '无权以该 parentTask 派生子 agent' });
          }
          if (parentTask.status !== 'running' || parentTask.agentStatus !== 'running') {
            return res.status(409).json({ status: 'error', error: 'parentTask 已结束，不能再派生子 agent' });
          }
          if ((parentTask.params?.kind || 'primary') !== 'primary') {
            return res.status(409).json({ status: 'error', error: 'parentTask 不是可用的主 agent 会话' });
          }
          const parentLoop = (() => { try { return dbMod.getLoopRunByTaskId(parentTaskId); } catch { return null; } })();
          if (parentLoop && parentLoop.kind !== 'primary') {
            return res.status(409).json({ status: 'error', error: 'parentTask 不是可用的主 agent 会话' });
          }
          if (
            explicitConvId &&
            parentTask.params &&
            parentTask.params.conversationId &&
            parentTask.params.conversationId !== explicitConvId
          ) {
            return res.status(409).json({ status: 'error', error: 'parentTask 与当前会话不一致' });
          }
          parentLoopRunId = parentLoop?.loopRunId || null;
          if (parentTask.params && parentTask.params.conversationId) {
            explicitConvId = parentTask.params.conversationId;
          }
        }

        let _activeConv = null;
        try {
          if (fedIdentity && !explicitConvId && wantKind === 'primary') {
            // BLOCK-88 P2（D3）— 委托独立会话：访客委托永不复用宿主活跃会话
            //（85 双真机验收登记缺口「委托未开独立会话」的修复面）。
            // BLOCK-88 P3（D4）— 授权项目的委托落项目绑定（P3 检查已放行），
            // workspace_* 等 project_required 工具自此可达（「写类委托不可达」缺口）。
            _activeConv = convSync.createFederatedDelegationConversation(
              userId, fedIdentity,
              messages[0] && messages[0].content,
              fedProjectId || null,
            );
          } else {
            const hint = {
              conversationId: explicitConvId,
              page: context && context.page,
              projectId: context && context.projectId,
              titleHint:
                messages[0] && messages[0].content
                  ? String(messages[0].content).slice(0, 40)
                  : '新对话',
            };
            _activeConv = getOrCreateActiveConversation(userId, hint);
          }
        } catch {}

        try {
          if (_activeConv) {
            const lastUser = [...messages].reverse().find((m) => m.role === 'user');
            if (lastUser) {
              const cleanContent = String(lastUser.content || '').replace(/^\[[^\]]+\]\s*\n?/, '');
              const meta = {
                page: context && context.page,
                projectId: context && context.projectId,
                datasetId: context && context.datasetId,
                analysisId: context && context.analysisId,
              };
              appendMessageToConversation(_activeConv.id, 'user', cleanContent, meta);
            }
          }
        } catch {}

        // BLOCK-95 B1 — 历史拼装权收归后端（开关灰度，默认关；实现与契约见
        // helpers/history-assembly.js）。开关开时 effectiveMessages 为 DB 拼装版，
        // createAgentTask params 与 runAgentLoop 从此同源（resume/续跑链一致）。
        // BLOCK-95 B2 — 拼装后应用会话 compaction 投影（默认关；仅拼装开时生效），
        // 并做后台增量压缩检查（不阻塞请求路径；压缩留痕经 messages 信封诚实可见）。
        let effectiveMessages = messages;
        if (isServerHistoryAssemblyEnabled(process.env) && _activeConv && _activeConv.id) {
          const _convIdForAssembly = _activeConv.id;
          const adbLocal = dbMod.getAsyncDatabase();
          effectiveMessages = await assembleServerHistory({
            conversationId: _convIdForAssembly,
            incomingMessages: messages,
            adb: adbLocal,
          });
          // BLOCK-98 M2 — resilience 总开关开启时同样进入（独立于 B2 开关；
          // 阈值/摘要/视图文案由 conversation-compaction 内部按模式切换）。
          if (isSessionCompactionEnabled(process.env) || require('../../helpers/agent-resilience').isResilienceEnabled(process.env)) {
            try {
              const sqliteLocal = dbMod.getDatabase();
              const compactionRow = sqliteLocal.prepare('SELECT * FROM conversation_compaction WHERE conversation_id=?').get(_convIdForAssembly) || null;
              if (compactionRow && Array.isArray(effectiveMessages) && effectiveMessages.length > 0) {
                // 拼装行带 rowid 用于投影切分（历史部分全部 < covers_rowid 时整体替换为摘要）
                const assembledRows = await adbLocal.prepare(
                  "SELECT rowid, role, content FROM copilot_messages WHERE conversation_id=? AND role IN ('user','assistant') ORDER BY rowid ASC"
                ).all(_convIdForAssembly);
                // 尾部本轮 user 与拼装版对齐（同 assembleServerHistory 的回填语义）
                const incomingLastUser = [...messages].reverse().find((m) => m && m.role === 'user');
                if (incomingLastUser && assembledRows.length > 0 && assembledRows[assembledRows.length - 1].role === 'user') {
                  const original = String(incomingLastUser.content || '');
                  const lastRow = assembledRows[assembledRows.length - 1];
                  if (lastRow.content !== original) lastRow.content = original;
                }
                const agentResilience = require('../../helpers/agent-resilience');
                effectiveMessages = applyCompactionView(assembledRows, compactionRow, {
                  resilienceEnabled: agentResilience.isResilienceEnabled(process.env),
                  transcriptPath: agentResilience.transcriptPathFor(_convIdForAssembly),
                });
              }
              maybeCompactInBackground({ userId, conversationId: _convIdForAssembly, sqlite: sqliteLocal, presetId: modelPresetId });
            } catch (e) {
              try { console.warn('[block95-b2] compaction view skipped:', e && e.message); } catch {}
            }
          }
        }

        let taskId;
        try {
          // BLOCK-10-audit-closeout: createAgentTask returns the FULL inserted
          // task snapshot (object) — not just the generated UUID. chat.js
          // previously captured this as `taskId`, which then propagated to
          // runAgentLoop + appendAgentTaskEvent as a non-string. SQLite TEXT
          // column silently coerces objects to '[object Object]' via toString,
          // so events were written under the wrong key while getAgentTask(taskId)
          // also missed the row. Fix: pull `.taskId` out before using.
          taskId = agentTaskStore.createAgentTask({
            status: 'running',
            agentStatus: 'running',
            userId,
            params: {
              // B1 — 开关开时为后端 DB 拼装版（resume/续跑链从此同源）
              messages: effectiveMessages,
              context,
              conversationId: _activeConv && _activeConv.id,
              providerName,
              providerLabel,
              modelName,
              kind: wantKind,
              parentTaskId: parentTaskId || null,
              // BLOCK-88 P2（D3）— 访客归属标记（俯瞰面板「来自工程师 X」数据源）
              ...(fedIdentity ? { federated: { displayName: fedIdentity.displayName || null, device: fedIdentity.device || null, sessionId: req.mobileSession.id } } : {}),
              // BLOCK-49: 派生工具精确继承模型所需（spawn-agent-tools 合成 preset 用）
              profileId: selectedPreset && selectedPreset.id,
              baseUrl: baseUrl || undefined,
              // BLOCK-81 P1 — 档位随任务参数落库：降级续跑/恢复续跑按任务参数继承
              thinkingLevel: thinkingLevel || undefined,
            },
          }).taskId;
        } catch (e) {
          return res.status(500).json({ status: 'error', error: '创建 agent task 失败: ' + e.message });
        }

        const acquired = aiTaskConcurrencyAcquire(userId, taskId, { isPrimary: wantKind === 'primary' });
        // acquire 返回 {ok:boolean,...}（对象恒真值），必须显式判 ok —— 与 resume.js 同契约修正
        if (!acquired || acquired.ok === false) {
          agentTaskStore.markAgentTaskFailed(taskId, '并发限制');
          return res.status(429).json({ status: 'error', error: '并发限制，请稍后再试' });
        }

        setImmediate(() => {
          // BLOCK-112 W1-2 — 发送前意图路由（默认关 BIOF3_JEV_INTENT_ROUTE=1）：
          // 主任务消息先经决策原语四类分类，chitchat 且 conf≥θ 走轻量直答快路径；
          // guard 关/分类失败/低置信/快路径模型失败（零事件落库）→ 一律回退现行
          // runAgentLoop，提交链其余部分逐字节等价。前置检查（联邦/subagent/并发）
          // 已全部先行，本分支不绕过任何安全面；subagent 消息不参与分流。
          const lastUserMessage = [...messages].reverse().find((m) => m && m.role === 'user');
          const userMessageText = lastUserMessage ? String(lastUserMessage.content || '') : '';
          (async () => {
            try {
              if (wantKind === 'primary' && userMessageText) {
                const { shouldUseChitchatFastPath } = require('../../helpers/intent-router');
                const decision = await shouldUseChitchatFastPath(userMessageText);
                if (decision.fastPath) {
                  const { runChitchatFastPath } = require('../../helpers/chitchat-fast-path');
                  await runChitchatFastPath({
                    taskId,
                    effectiveMessages,
                    _activeConv,
                  });
                  try { aiTaskConcurrencyRelease(userId, taskId); } catch {}
                  return;
                }
              }
            } catch (e) {
              try { console.warn('[block112] chitchat fast path failed, falling back to agent loop:', e && e.message); } catch {}
            }
            return runAgentLoop({
              // B1 — 开关开时为后端 DB 拼装版；关时与旧链路逐字同源
              messages: effectiveMessages,
              context,
              userId,
              conversationId: _activeConv && _activeConv.id,
              _activeConv,
              apiKey,
              providerName,
              providerLabel,
              modelName,
              profileId: selectedPreset && selectedPreset.id,
              baseUrl,
              taskId,
              kind: wantKind,
              parentLoopRunId: parentLoopRunId || null,
              // BLOCK-81 P1 — 思考档位进 agent loop（网关按 profile 能力位门控）
              thinkingLevel,
              onEvent: () => {},
              shouldAbort: () => agentTaskStore.isAgentTaskCancellationRequested(taskId),
            }).catch((e) => {
              try { agentTaskStore.markAgentTaskFailed(taskId, e && e.message ? e.message : String(e)); } catch {}
              try { aiTaskConcurrencyRelease(userId, taskId); } catch {}
            });
          })();
        });

        return res.json({
          taskId,
          status: 'running',
          kind: wantKind,
          parentTaskId: parentTaskId || null,
          conversationId: _activeConv && _activeConv.id,
        });
      }

      // BLOCK-109-CORE-ARCH P1（D4）— legacy 直连 SSE 双轨退役（附录 A 单一事件源）：
      // 原 786 行 legacy handler 已物理删除；task 模式（上方分支，history-assembly
      // 单链组装）是唯一提交路径。前端 VITE_AGENT_TASK_MODE=legacy / ?legacy=1
      // 逃生口一并退役（copilotClient.streamChat）。
      return res.status(410).json({
        status: 'error',
        error: 'legacy_sse_retired',
        message: 'legacy 直连 SSE 已退役（BLOCK-109-CORE-ARCH P1 单一事件源）；请使用 task 模式（默认）。',
      });
    });
  },
};

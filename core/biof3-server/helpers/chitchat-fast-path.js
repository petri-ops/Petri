/**
 * BLOCK-112 W1-2：chitchat 快路径（意图路由采纳后的轻量直答）。
 *
 * 事件契约（逐字镜像 agent-runner 已有形状，零前端改动；plan §1.1）：
 *   seq1 run_started → seq2 delta(choices[0].delta.content) → markAgentTaskDone。
 * SSE 订阅端按既有终态机制收 done+[DONE]；assistant 消息照常落库（meta 标记 fastPath）。
 *
 * 失败语义：模型直答失败（throw）发生在任何事件落库之前——调用方据此安全回退现行
 * runAgentLoop（零事件写入，无 seq 冲突）；事件落库后的收尾步骤全部 best-effort。
 */
'use strict';

const CHITCHAT_SYSTEM_PROMPT =
  '你是格物（Gewu）工作台的 AI 助手，也是用户的科研伙伴。当前消息是用户的日常闲聊、寒暄或情绪表达，'
  + '请用简洁、温暖、自然的中文回应（通常 1~3 句）。不要调用工具、不要分析数据、不要主动给出分析流程建议；'
  + '若用户话里带着新任务诉求，请温和提示「把具体任务发给我就可以开始」。';

/** 默认直答通道：callModelTask（explanation 角色走网关路由与 fallback 体系）。 */
async function _defaultModelCall({ historyMessages }) {
  const { callModelTask } = require('./model-tasks');
  const result = await callModelTask({
    role: 'explanation',
    messages: [{ role: 'system', content: CHITCHAT_SYSTEM_PROMPT }, ...historyMessages],
    maxTokens: 500,
    temperature: 0.7,
    telemetry: { kind: 'chitchat_fast_path' },
  });
  if (!result.text) throw new Error(result.error || 'chitchat 直答为空');
  return result.text;
}

/**
 * 运行 chitchat 快路径：直答 → 事件回放 → 终态 → 会话落库。
 * @param {object} args
 * @param {string} args.taskId 已创建的 agent task（调用方已过全部提交链前置检查与并发槽）
 * @param {Array} args.effectiveMessages 组装后的对话消息（取尾部 ≤8 条作轻量历史）
 * @param {object} [args._activeConv] 会话对象（assistant 落库；可空）
 * @param {object} [deps] 测试注入（store/conv/modelCall）；生产零传参
 * @returns {Promise<string>} 直答文本
 */
async function runChitchatFastPath({ taskId, effectiveMessages, _activeConv }, deps = {}) {
  const store = deps.store || require('../agent-task-store');
  const conv = deps.conv || require('./conversations');
  const modelCall = deps.modelCall || _defaultModelCall;

  // 1) 模型直答先行——失败即 throw（零事件落库，调用方可安全回退现行 loop）
  const historyMessages = (Array.isArray(effectiveMessages) ? effectiveMessages : [])
    .slice(-8)
    .map((m) => ({ role: m && m.role === 'assistant' ? 'assistant' : 'user', content: String((m && m.content) || '') }));
  const text = await modelCall({ historyMessages });

  // 2) 事件回放（镜像 agent-runner 形状；落库失败不阻塞终态）
  let seq = 0;
  const emit = (obj) => {
    seq += 1;
    try {
      store.appendAgentTaskEvent(taskId, seq, obj.event || 'delta', obj);
    } catch {}
  };
  emit({ event: 'run_started', taskId, kind: 'primary', at: new Date().toISOString() });
  emit({ choices: [{ delta: { content: text } }] });

  // 3) 终态 + 会话落库（best-effort）
  try {
    store.markAgentTaskDone(taskId, []);
  } catch {}
  try {
    if (_activeConv && _activeConv.id) {
      conv.appendMessageToConversation(_activeConv.id, 'assistant', text, { chitchatFastPath: true });
    }
  } catch {}

  return text;
}

module.exports = { runChitchatFastPath, CHITCHAT_SYSTEM_PROMPT };

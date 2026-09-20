'use strict';

/**
 * BLOCK-85 P3 — 格物联邦 Agent 委托（D4）。
 *
 * delegate_to_gewu_node：指挥席 agent 把一段工作委托给协作成员的 agent——
 * 对端 POST /api/ai/agent 开独立会话后台跑（AGENT_TASK_MODE，返回 taskId），
 * 本端轮询对端 /api/ai/agent/task/:taskId/meta 至终态，回执 = 终态状态 +
 * 对端会话最后一条 assistant 消息摘要（产物引用含其中）。真值在对端会话。
 */

const path = require('node:path');

const DELEGATE_POLL_INTERVAL_MS = 5_000;
const REQUEST_TIMEOUT_MS = 20_000;

function resolveFederationDataDir() {
  return process.env.BIOF3_LOCAL_DATA_DIR
    || process.env.LOCAL_DATA_DIR
    || path.join(require('os').homedir(), 'Documents', 'BioF3-Local');
}

async function peerFetch(peer, token, pathName, { method = 'GET', body = null, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${peer.baseUrl}${pathName}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
  } finally {
    clearTimeout(timer);
  }
}

const TERMINAL_AGENT_STATUSES = new Set(['completed', 'failed', 'cancelled', 'done', 'error']);

async function tool_delegate_to_gewu_node(args = {}) {
  const peerId = String(args.peerId || '').trim();
  const task = String(args.task || '').trim();
  const projectId = typeof args.projectId === 'string' ? args.projectId.trim() : '';
  const timeoutMs = Math.min(Math.max(Number(args.timeoutMinutes) || 10, 1), 30) * 60_000;
  if (!peerId) return { error: 'missing_peer_id', message: '缺少 peerId（协作成员 ID，联邦面板可见）' };
  if (!task) return { error: 'missing_task', message: '缺少 task（要委托给对方 agent 的工作描述）' };

  const federation = require('../../shared-backend/federation-peers');
  const dataDir = resolveFederationDataDir();
  const peer = federation.getPeer(dataDir, peerId);
  if (!peer) return { error: 'unknown_peer', message: '协作成员不存在或已移除：' + peerId };
  const token = federation.getPeerToken(dataDir, peerId) || '';

  // 0. BLOCK-88 P3（D4）— 发现面：列本工程师在对端的被授权项目（附项目名），
  // 无 projectId 但对端有授权项目时在回执中提示（写类委托需带 projectId 重发）。
  let grantedProjects = null;
  try {
    const mine = await peerFetch(peer, token, '/federation/api/granted-projects');
    if (mine.status === 200 && mine.data?.ok) grantedProjects = mine.data.projects || [];
  } catch { /* 发现失败不阻塞委托 */ }

  // 1. 发起对端 agent 会话（后台任务模式）
  let started;
  try {
    started = await peerFetch(peer, token, '/api/ai/agent', {
      method: 'POST',
      body: {
        messages: [{ role: 'user', content: task }],
        ...(projectId ? { context: { projectId } } : {}),
      },
      timeoutMs: 60_000,
    });
  } catch (error) {
    return { error: error.name === 'AbortError' ? 'peer_timeout' : 'peer_unreachable', message: `无法连接协作成员「${peer.name}」` };
  }
  if (started.status === 401) {
    return { error: 'federation_session_invalid', message: `协作成员「${peer.name}」的会话已失效，请在联邦面板重新配对` };
  }
  if (started.status === 403) {
    return {
      error: 'federation_project_not_granted',
      message: (started.data && started.data.message) || `未被授权访问对端项目 ${projectId}（宿主默认零授权，请宿主在联邦面板逐项目授权）`,
      grantedProjects: grantedProjects || [],
    };
  }
  const taskId = started.data && (started.data.taskId || (started.data.data && started.data.data.taskId));
  if (started.status !== 200 || !taskId) {
    return { error: 'delegate_start_failed', message: `协作成员「${peer.name}」未能启动委托任务`, peerStatus: started.status, detail: started.data };
  }
  const conversationId = (started.data && started.data.conversationId) || null;

  // 2. 轮询终态
  const deadline = Date.now() + timeoutMs;
  let meta = null;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, DELEGATE_POLL_INTERVAL_MS));
    try {
      const poll = await peerFetch(peer, token, `/api/ai/agent/task/${encodeURIComponent(taskId)}/meta`);
      if (poll.status === 200 && poll.data?.ok) {
        meta = poll.data;
        if (TERMINAL_AGENT_STATUSES.has(String(meta.agentStatus || '').toLowerCase())) break;
      } else if (poll.status === 404) {
        return { error: 'delegate_task_lost', message: `协作成员「${peer.name}」上找不到委托任务（可能已重启清理）`, peerTaskId: taskId };
      }
    } catch { /* 单次轮询失败容忍，继续到 deadline */ }
  }
  if (!meta || !TERMINAL_AGENT_STATUSES.has(String(meta.agentStatus || '').toLowerCase())) {
    return {
      error: 'delegate_timeout',
      message: `委托超时（${Math.round(timeoutMs / 60_000)} 分钟）。任务仍在协作成员「${peer.name}」上运行：taskId=${taskId}${conversationId ? ` conversationId=${conversationId}` : ''}`,
      peerTaskId: taskId,
    };
  }

  // 3. 回执：终态状态 + 对端会话末条 assistant 回复摘要
  let reply = null;
  try {
    const messages = await peerFetch(peer, token, `/api/ai/conversations/${encodeURIComponent(conversationId)}/messages`);
    const list = messages.data?.messages || messages.data?.data?.messages || [];
    const lastAssistant = [...list].reverse().find((m) => m.role === 'assistant' || m.sender === 'assistant');
    if (lastAssistant) reply = String(lastAssistant.content || '').slice(0, 4000);
  } catch { /* 回执内容拿不到时诚实降级为状态回执 */ }

  return {
    // 终态命名：对端 chat.js task 模式正常完成标 'done'，部分路径标 'completed'——
    // 只认 completed 会把对端正常完成误报为 error（BLOCK-85 双真机 P3 实测踩中）。
    ok: ['completed', 'done'].includes(String(meta.agentStatus || '').toLowerCase()),
    peerName: peer.name,
    peerTaskId: taskId,
    agentStatus: meta.agentStatus,
    reply,
    projectId: projectId || null,
    // BLOCK-88 P3（D4）— 未带 projectId 时回执附被授权项目（写类委托按此重发）
    ...(projectId ? {} : { grantedProjects: grantedProjects || [] }),
    note: '任务真值保存在协作成员的会话中，可在其界面中查看完整过程',
  };
}

module.exports = {
  tool_delegate_to_gewu_node,
};

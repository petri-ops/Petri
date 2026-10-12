'use strict';

/**
 * BLOCK-85 P3 — 格物联邦 Agent 委托（D4）。
 *
 * delegate_to_petri_node：指挥席 agent 把一段工作委托给协作成员的 agent——
 * 对端 POST /api/ai/agent 开独立会话后台跑（AGENT_TASK_MODE，返回 taskId），
 * 本端轮询对端 /api/ai/agent/task/:taskId/meta 至终态，回执 = 终态状态 +
 * 对端会话最后一条 assistant 消息摘要（产物引用含其中）。真值在对端会话。
 */

const path = require('node:path');

const DELEGATE_POLL_INTERVAL_MS = 5_000;
const REQUEST_TIMEOUT_MS = 20_000;
const GRANTED_FETCH_TIMEOUT_MS = 3_000;

function resolveFederationDataDir() {
  return process.env.PETRI_LOCAL_DATA_DIR
    || process.env.LOCAL_DATA_DIR
    || path.join(require('os').homedir(), 'Documents', 'Petri-Local');
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


// BLOCK-164 W1 — 委托入口可自足：列协作节点（在线态/署名/对端授权项目）与本机授权概览，
// 模型据此自取 peerId/projectId，不再要求用户提供 gpeer_* ID。只读聚合（peers/grants 本地
// 真值 + 对端 granted-projects 3s 尽力探测），无写面。
async function tool_federation_list_peers() {
  const federation = require('../../shared-backend/federation-peers');
  const grantsMod = require('../../shared-backend/federation-grants');
  const dataDir = resolveFederationDataDir();
  const { peers } = federation.loadPeers(dataDir);
  let myGrants = [];
  try {
    myGrants = grantsMod.listGrants(dataDir) || []; // listGrants 直接返回 grants 数组
  } catch { /* 授权概览拿不到时诚实空表 */ }

  const now = Date.now();
  const nodes = await Promise.all(peers.map(async (peer) => {
    const lastActiveAt = peer.lastProbeAt || peer.lastSeenAt || null;
    const staleMs = lastActiveAt ? now - new Date(lastActiveAt).getTime() : Infinity;
    const online = staleMs < 2 * 60 * 1000;
    let grantedToMe = null;
    try {
      const token = federation.getPeerToken(dataDir, peer.peerId) || '';
      const mine = await peerFetch(peer, token, '/federation/api/granted-projects', { timeoutMs: GRANTED_FETCH_TIMEOUT_MS });
      if (mine.status === 200 && mine.data?.ok) grantedToMe = mine.data.projects || [];
    } catch { grantedToMe = null; }
    return {
      peerId: peer.peerId,
      name: peer.name || null,
      identity: peer.identity || null,
      online,
      lastActiveAt,
      grantedToMe,
      ...(grantedToMe === null ? { note: '对端不可达，可授权项目未知（委托仍可尝试；纯问答类任务无需授权）' } : {}),
    };
  }));

  if (nodes.length === 0) {
    return { ok: true, nodes: [], myGrants, message: '尚未配对任何协作节点。可在桌面端左栏「联邦」面板生成配对邀请，与另一台格物配对后即可委托。' };
  }
  return { ok: true, nodes, myGrants };
}

/**
 * BLOCK-176 CP-16 — 委托期事件流回传：订阅对端任务 SSE（/api/ai/agent/task/:id，
 * 配对 token 鉴权沿用 peerFetch 同源），把关键事件镜像写入本地 task_events。
 * - 纯叠加：只写本地事件流（委托留痕/联邦面板可见），不改变委托返回语义；
 * - SSE 不可达/解析失败 → 静默返回（轮询兜底语义不变）；
 * - 跨机实测段=双机环境依赖，本机以 mock 对端契约测试分档覆盖（plan §3）。
 */
async function mirrorPeerTaskEvents(peer, token, peerTaskId, timeoutMs) {
  const agentTaskStore = require('../../agent-task-store');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const base = String(peer.baseUrl || '').replace(/\/$/, '');
    const response = await fetch(
      base + '/api/ai/agent/task/' + encodeURIComponent(peerTaskId),
      { headers: { Authorization: 'Bearer ' + token, Accept: 'text/event-stream' }, signal: controller.signal },
    );
    if (!response.ok || !response.body) return;
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          try {
            const payload = JSON.parse(line.slice(5).trim());
            const eventType = String(payload.event || '');
            if (!eventType || eventType === 'delta') continue; // 流式增量不镜像（量大）
            const events = agentTaskStore.getAgentTaskEventsSince(peerTaskId, 0, 1_000_000);
            const seq = (events.length ? events[events.length - 1].seq : 0) + 1;
            agentTaskStore.appendAgentTaskEvent(peerTaskId, seq, eventType, {
              ...payload,
              peerName: peer.name,
            });
          } catch { /* 单帧解析失败容忍（SSE 分帧边界） */ }
        }
      }
    }
  } catch { /* SSE 不可达 → 轮询兜底语义不变 */ }
  finally {
    clearTimeout(timer);
  }
}

async function tool_delegate_to_petri_node(args = {}) {
  const peerId = String(args.peerId || '').trim();
  const task = String(args.task || '').trim();
  const projectId = typeof args.projectId === 'string' ? args.projectId.trim() : '';
  const timeoutMs = Math.min(Math.max(Number(args.timeoutMinutes) || 10, 1), 30) * 60_000;
  if (!peerId) return { error: 'missing_peer_id', message: '缺少 peerId（协作成员 ID）——可先调用 federation_list_peers 工具查询协作成员清单及其授权项目' };
  if (!task) return { error: 'missing_task', message: '缺少 task（要委托给对方 agent 的工作描述）' };

  const federation = require('../../shared-backend/federation-peers');
  const dataDir = resolveFederationDataDir();
  const peer = federation.getPeer(dataDir, peerId);
  if (!peer) return { error: 'unknown_peer', message: '协作成员不存在或已移除：' + peerId + '——可先调用 federation_list_peers 查询有效清单' };
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

  // 2. 轮询终态。BLOCK-176 CP-16 — 委托期叠加对端任务 SSE 事件流订阅：
  //    关键事件镜像回本地 task_events（委托留痕/联邦面板可见）；
  //    SSE 不可达/解析失败 → 静默回退既有 5s meta 轮询（语义不变）。
  await mirrorPeerTaskEvents(peer, token, taskId, timeoutMs).catch(() => {});
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
  tool_delegate_to_petri_node,
  tool_federation_list_peers,
};

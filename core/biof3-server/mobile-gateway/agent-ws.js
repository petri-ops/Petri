'use strict';

/**
 * BLOCK-162 P2 — /m/api/ws 端点：agent 任务流单连接 WebSocket。
 *
 * 协议（与 SSE 端点 routes/ai-agent/events.js 语义对齐，差异仅传输）：
 *   C→S  {"t":"sub","taskId","afterSeq"} | {"t":"unsub","taskId"} | {"t":"ping"}
 *   S→C  {"t":"hello"}
 *        {"t":"ev","taskId","seq","eventType","payload"}     ← 形状=SSE data 帧
 *        {"t":"done","taskId","status","error"?,"resumable"?,"filesChanged"?}
 *        {"t":"pong"} | {"t":"err","message"}
 *
 * 推送双轨：进程内 taskEventBus 即时推送（appendAgentTaskEvent 落库后 emit，
 * 地板 500ms DB 轮询 → 0）+ 2s 兜底水位轮询（漏帧补齐；前端单调 seq 去重）。
 * 会话门：upgrade 时三源鉴权（cookie gw_session / Bearer / ?session）——与
 * HTTP sessionAuth 同源同门；sub 时任务越权校验同 SSE 端点。
 */

const { attachWsServer } = require('./ws');

const FALLBACK_POLL_MS = 2000;
const MAX_SUBS_PER_CONN = 8;
const TERMINAL_STATUSES = ['done', 'failed', 'cancelled'];

function tokenFromUpgradeReq(req) {
  const cookieToken = String((req.headers.cookie || '')
    .split(/;\s*/)
    .find((pair) => pair.startsWith('gw_session='))
    ?.split('=').slice(1).join('=') || '');
  if (cookieToken) return cookieToken;
  const header = String(req.headers.authorization || '');
  if (header.startsWith('Bearer ')) return header.slice(7);
  try { return String(new URL(req.url || '/', 'http://localhost').searchParams.get('session') || ''); } catch { return ''; }
}

/** 终态帧：对齐 SSE 终态语义（done/error/cancelled，含 fallback 与 filesChanged）。 */
function buildDoneFrame(taskId, task, findFallbackChild) {
  if (task.agent_status === 'failed') {
    const fb = findFallbackChild(taskId);
    return {
      t: 'done',
      taskId,
      status: 'failed',
      error: task.error || 'agent task 失败',
      resumable: Boolean(task.interruptedAt),
      interruptedAt: task.interruptedAt || null,
      ...(fb ? {
        fallbackTaskId: fb.newTaskId,
        fallbackLabel: fb.toProfileLabel || null,
        fallbackCategory: fb.category || null,
      } : {}),
    };
  }
  if (task.agent_status === 'cancelled') return { t: 'done', taskId, status: 'cancelled' };
  return { t: 'done', taskId, status: 'done', filesChanged: task.filesChanged || [] };
}

/**
 * 挂载 /m/api/ws。store 注入默认 agent-task-store（测试可注入 fake——
 * 与 tunnel.js 的注入约定同门）。
 */
function attachAgentWs(server, {
  stores,
  store = require('../agent-task-store'),
  localUserId = require('../auth').LOCAL_USER.id,
  fallbackPollMs = FALLBACK_POLL_MS,
  pingIntervalMs,
} = {}) {
  if (!stores) throw new Error('agent_ws_stores_required');

  const findFallbackChild = (taskId) => {
    try {
      const events = store.getAgentTaskEventsSince(taskId, 0, 1000000);
      for (let i = events.length - 1; i >= 0; i -= 1) {
        const ev = events[i];
        if (ev.eventType === 'model_fallback' && ev.payload && ev.payload.newTaskId) return ev.payload;
      }
    } catch { /* 找不到 fallback 诚实返回 null */ }
    return null;
  };

  const { hub, close } = attachWsServer(server, {
    path: '/m/api/ws',
    pingIntervalMs,
    authenticate(req) {
      const token = tokenFromUpgradeReq(req);
      return token && stores.sessions.authenticate(token);
    },
  });

  hub.on('connection', (conn) => {
    const subs = new Map(); // taskId -> { lastSeq, timer }

    const pollOnce = (taskId, sub) => {
      try {
        const events = store.getAgentTaskEventsSince(taskId, sub.lastSeq);
        for (const ev of events) {
          if (ev.seq <= sub.lastSeq) continue;
          sub.lastSeq = ev.seq;
          conn.send({ t: 'ev', taskId, seq: ev.seq, eventType: ev.eventType, payload: ev.payload });
        }
        const t = store.getAgentTask(taskId);
        if (t && TERMINAL_STATUSES.includes(t.agent_status)) {
          clearInterval(sub.timer);
          subs.delete(taskId);
          conn.send(buildDoneFrame(taskId, t, findFallbackChild));
        }
      } catch { /* 轮询出错不终止，下轮继续 */ }
    };

    const startSub = (msg) => {
      const taskId = String(msg.taskId || '');
      if (!taskId) { conn.send({ t: 'err', message: 'taskId_required' }); return; }
      if (subs.has(taskId)) return; // 重复 sub 幂等（不重复回放）
      if (subs.size >= MAX_SUBS_PER_CONN) { conn.send({ t: 'err', message: 'too_many_subscriptions' }); return; }
      const task = store.getAgentTask(taskId);
      if (!task) { conn.send({ t: 'err', message: 'task_not_found', taskId }); return; }
      if (task.user_id && task.user_id !== localUserId) { conn.send({ t: 'err', message: 'forbidden', taskId }); return; }
      const sub = { lastSeq: Math.max(0, parseInt(msg.afterSeq, 10) || 0), timer: null };
      subs.set(taskId, sub);
      try {
        const events = store.getAgentTaskEventsSince(taskId, sub.lastSeq);
        for (const ev of events) {
          sub.lastSeq = ev.seq;
          conn.send({ t: 'ev', taskId, seq: ev.seq, eventType: ev.eventType, payload: ev.payload });
        }
      } catch { /* 回放失败交给兜底轮询 */ }
      const fresh = store.getAgentTask(taskId);
      if (fresh && TERMINAL_STATUSES.includes(fresh.agent_status)) {
        subs.delete(taskId);
        conn.send(buildDoneFrame(taskId, fresh, findFallbackChild));
        return;
      }
      sub.timer = setInterval(() => pollOnce(taskId, sub), fallbackPollMs);
      if (sub.timer.unref) sub.timer.unref();
    };

    conn.on('message', (msg) => {
      try {
        if (msg && msg.t === 'sub') startSub(msg);
        else if (msg && msg.t === 'unsub') {
          const sub = subs.get(String(msg.taskId || ''));
          if (sub) { clearInterval(sub.timer); subs.delete(String(msg.taskId)); }
        } else if (msg && msg.t === 'ping') conn.send({ t: 'pong' });
      } catch { /* 单消息异常不杀连接 */ }
    });

    // 进程内即时推送（总线）：命中订阅即推，单调水位；连不上的帧由兜底轮询补齐。
    const onBusEvent = ({ taskId, seq, eventType, payload }) => {
      const sub = subs.get(taskId);
      if (!sub || seq <= sub.lastSeq) return;
      sub.lastSeq = seq;
      conn.send({ t: 'ev', taskId, seq, eventType, payload });
    };
    store.taskEventBus.on('event', onBusEvent);
    conn.on('close', () => {
      store.taskEventBus.off('event', onBusEvent);
      for (const sub of subs.values()) clearInterval(sub.timer);
      subs.clear();
    });
  });

  return { hub, close };
}

module.exports = { attachAgentWs, FALLBACK_POLL_MS, MAX_SUBS_PER_CONN, tokenFromUpgradeReq, buildDoneFrame };

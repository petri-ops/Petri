'use strict';

/**
 * helpers/event-bus.js — CK-03（C-02 轮询→SSE 第一批：jobs 域失效通知）。
 *
 * 语义：SSE 通道只发「数据变了」的失效信号（invalidate），不推数据本体——
 * 前端收到后按需调既有 REST 刷新（cache-invalidation 模式）。
 * 数据面零改动：REST 端点原样，轮询保留低频兜底（断线自愈）。
 *
 * 约束：
 *  - 客户端只进不出：publish 广播给所有已注册 SSE 连接（desktop 单用户形态，
 *    无按用户分流的必要；路由层已做 desktop-local 鉴权）。
 *  - 心跳 25s（穿透代理/Nginx 读超时；公网门 nginx conf 读超时 60s 量级）。
 *  - publish 永不 throw（SSE write 失败静默，断线由 heartbeat/前端重连兜）。
 */

const clients = new Set();

function sseWrite(client, obj) {
  try {
    client.res.write('data: ' + JSON.stringify(obj) + '\n\n');
  } catch { /* 连接已断：由 heartbeat 清理 */ }
}

/** 注册一条 SSE 连接（res 已写完 SSE 头）。返回 unregister 函数。 */
function registerClient(res) {
  const client = { res };
  clients.add(client);
  return () => clients.delete(client);
}

/** 广播失效信号。domain=数据域（'jobs' | 'conversations' | ...），payload 任意 JSON。 */
function publishInvalidation(domain, payload) {
  const event = { type: 'invalidate', domain, at: new Date().toISOString(), ...(payload || {}) };
  for (const client of clients) sseWrite(client, event);
}

/** 心跳：25s 一次 comment 帧（SSE 注释行，前端解析器忽略）。 */
function startHeartbeat(intervalMs) {
  const timer = setInterval(() => {
    for (const client of clients) {
      try { client.res.write(': hb\n\n'); } catch { /* 忽略 */ }
    }
  }, intervalMs || 25_000);
  if (timer.unref) timer.unref();
  return () => clearInterval(timer);
}

function clientCount() {
  return clients.size;
}

module.exports = { registerClient, publishInvalidation, startHeartbeat, clientCount };

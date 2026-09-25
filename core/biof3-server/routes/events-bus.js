'use strict';

/**
 * routes/events-bus.js — CK-03 全局失效通知 SSE 通道（第一批：jobs 域）。
 *
 * GET /api/events — desktop-local 鉴权；事件= {type:'invalidate', domain, ...}。
 * 数据面零改动：本通道只发失效信号，前端按需走既有 REST 刷新。
 */

const eventBus = require('../helpers/event-bus');

module.exports = function register(app) {
    app.get('/api/events', (req, res) => {
      const userId = req.user && req.user.id;
      if (!userId) {
        return res.status(401).json({ ok: false, error: 'unauthorized', message: '未登录' });
      }
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders && res.flushHeaders();

      const unregister = eventBus.registerClient(res);
      // 初始 hello（前端以此确认通道建立）
      try { res.write('data: ' + JSON.stringify({ type: 'hello', at: new Date().toISOString() }) + '\n\n'); } catch { /* */ }

      req.on('close', () => unregister());
    });

  // 进程级心跳：单例启动（重复注册靠模块缓存幂等）
  if (!globalThis.__ck03HbStarted) {
    globalThis.__ck03HbStarted = true;
    eventBus.startHeartbeat(25_000);
  }
};

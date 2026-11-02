/**
 * helpers/early-loop-guard.js — BLOCK-328 加载期事件循环守卫（327 取证收口的防线①）。
 *
 * 背景（acceptance/block-327/coldstart-diagnosis.json）：better-sqlite3 是同步驱动，
 * schema init（connection.js:46，db.js require 链内）遇 DB 写锁时 busy 等待最长
 * busy_timeout=10000ms 直接冻结事件循环；而内建 event-loop 监控在 server.js 后段
 * （app.listen 前）才安装——加载期阻塞是监控盲区（2026-09-30 ~10s 观测不可见的原因）。
 *
 * 本模块要求在 server.js 的 require('./db') 之前 require：记录 t0，提供
 * reportLoadBlock()——db 加载完成后调用，若 t0→now 间隔超过阈值即打印加载期阻塞告警，
 * 把 327 证明的盲区变成可观测面。零依赖、零定时器、无副作用。
 */

'use strict';

/** 加载期阻塞阈值（ms）：327 取证显示干净启动 db require 链 ~0.2s；>3s 即异常。 */
const LOAD_BLOCK_THRESHOLD_MS = Number(process.env.PETRI_LOAD_BLOCK_THRESHOLD_MS) || 3000;

/** 加载基准时刻（模块首次 require 即定格；测试可经 _setStartForTests 注入）。 */
let startedAt = Date.now();

/**
 * db 加载完成后调用：若 require 链（含 initSchema 的同步 busy 等待）耗时超阈值，
 * 打印加载期阻塞告警。返回观测结果（供测试断言）。
 */
function reportLoadBlock({ thresholdMs = LOAD_BLOCK_THRESHOLD_MS, warn = console.warn } = {}) {
  const elapsed = Date.now() - startedAt;
  const blocked = elapsed > thresholdMs;
  if (blocked) {
    // 加载期冻结最可能是 initSchema 的同步 busy 等待（另一进程持 DB 写锁）；
    // 上限=busy_timeout（默认 10000ms），孤儿/双后端争用见 dev-infra §76。
    warn(
      `[early-loop] ⚠ module-load phase took ~${elapsed}ms (threshold ${thresholdMs}ms) — ` +
      'sync busy wait during db/schema init is the prime suspect (busy_timeout caps at 10s; ' +
      'check for orphan backends holding the DB write lock).',
    );
  }
  return { elapsedMs: elapsed, thresholdMs, blocked };
}

/** 测试注入：把基准时刻回拨 ms 毫秒，模拟一段已发生的加载耗时。 */
function _setStartForTests(ms) {
  startedAt = Date.now() - ms;
}

module.exports = { reportLoadBlock, _setStartForTests, LOAD_BLOCK_THRESHOLD_MS };

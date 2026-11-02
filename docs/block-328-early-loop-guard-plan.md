---
capability: block-328-early-loop-guard
status: completed
goal: BLOCK-327 取证收口的两道防线：①加载期事件循环守卫（early-loop-guard 在 require('./db') 之前定格基准，db 加载后超阈值告警，把 initSchema 同步 busy 等待的监控盲区变成可观测面）；②initSchema SQLITE_BUSY 有界重试退避（2s/5s，仅在 busy_timeout 10s 超时后介入，fail-closed 不掩盖真实锁冲突）。零行为变化（正常启动无告警、无重试）。
acceptance:
  - 防线①：helpers/early-loop-guard.js + server.js 守卫先于 db require（源码契约）；阈值 3000ms（PETRI_LOAD_BLOCK_THRESHOLD_MS 可调）；真实持锁 3.5s 启动实证告警 `module-load phase took ~3456ms` 在监听前打出。
  - 防线②：db/schema.js initSchemaWithBusyRetry（退避表 [2000,5000]，非 BUSY 立抛）+ connection.js 走包装；循环加载安全（导出在 require('./connection') 前挂载）。
  - 契约测试 test/block328-early-loop-guard.test.mjs 5/5（含真进程持锁集成：busy_timeout 吸收等待、监听延迟≥持锁时长的可观测证据）；邻域 326/323 回归 13/13；closeout 十一门。
reopen: db/schema.js 被先 require 时的循环加载 TDZ（getCurrentG0Baseline）——存量脆弱面（HEAD 同样崩），生产顺序 db.js→connection→schema 不触发；登记 🟡 待 BLOCK-92 系收敛。
---

# BLOCK-328-EARLY-LOOP-GUARD — 加载期守卫 + initSchema busy 重试计划

- 立项裁决：用户 2026-11-02「行呀 开整」（承接 327 修复三选项中的②+①，纯加固零行为变化）
- 唯一真相域：本文件（block-328-early-loop-guard）
- 状态：completed（当日收口。证据：契约 5/5 + 守卫能见度实证（持锁 3.5s → `[early-loop] ⚠ ~3456ms` 告警在监听前）+ 邻域 13/13 + closeout 十一门 PASS。**实机抓真**：schema.js 被先 require 时循环加载 TDZ（HEAD 同样崩）——本包把自有导出前置挂载消除了 initSchema 入口的循环盲点，但 getCurrentG0Baseline 的 TDZ 属存量，登记 🟡 不扩界。G0 开发期常态 · 不外推 packaged/Provider/GA。）

## 设计

- 守卫零依赖零定时器：只记一个时间戳、只在 db 加载后比较一次——不给启动加任何开销。
- 重试只在 busy_timeout（10s）耗尽后介入：瞬态争用由 busy_timeout 自愈（同步等待，守卫可见）；持续争用给 2s/5s 两次机会后 fail-closed。
- 不动 busy_timeout 值（CK-05 契约单源），不改启动链时序。

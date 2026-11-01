---
capability: block-327-mac-coldstart-diagnosis
status: completed
goal: Mac 侧冷启动 event-loop ~10s 阻塞取证（AUDIT-LOG 🟡待评估 2026-09-30 在案；两个嫌疑机制已排除——stale-running 对账器与 tool_jobs retention sweeper 首跑均在 60s 后，时点不符）：本机复现→cpu-prof/时间线定位阻塞块→根因报告。只取证不改产品，修法定性等结论。
acceptance:
  - 冷启动复现测量：隔离后端冷启动 + event-loop 监控输出与/或 --cpu-prof 采样，阻塞块定位到模块级。
  - 根因报告（acceptance/block-327/）：阻塞点、证据（profile/日志时间线）、定性建议（修复归属与方案选项），不动产品代码。
  - 台账回写（AUDIT-LOG 🟡 条目更新取证结论）。
reopen: 修复实施=独立裁决（依根因定性决定归属）。
---

# BLOCK-327-MAC-COLDSTART-DIAGNOSIS — Mac 冷启动 event-loop 阻塞取证计划

- 立项裁决：用户 2026-11-01「可以的 继续」（队列唯一无需裁决的可行动项；本机 darwin-arm64 正是观测平台）
- 前情：AUDIT-LOG 2026-09-30 🟡「单机单次观测 ~10s 阻塞」；已排除 stale-running 对账器与 retention sweeper（均 60s 后首跑）
- 唯一真相域：本文件（block-327-mac-coldstart-diagnosis）
- 状态：completed（2026-11-01 当日收口。结论=根因定位：DB 写锁争用 × better-sqlite3 同步 busy 等待（≤busy_timeout 10s）× 模块加载期（监控不可见）；争用源=SIGTERM 孤儿（BLOCK-326 已修）→ 今日三探针不可复现；证据=acceptance/block-327/coldstart-diagnosis.json；修复实施留裁决。G0 开发期常态 · 不外推 packaged/Provider/GA。

## 方法

1. **复现**：隔离后端冷启动（临时 DB），捕获 stdout 全量——server.js 内建 event-loop 监控会打印 `blocked ~Xms`；对照启动日志时间线。
2. **定位**：`--cpu-prof` 采样冷启动 15s 后 SIGTERM（顺带 dogfood BLOCK-326 的退出修复），分析 .cpuprofile 主线程热点帧——10s 同步块必在火焰图顶部。
3. **报告**：阻塞点（模块/函数级）+ 证据 + 修复选项（不实施）。

## 非范围

不修产品；不改启动链；不外推 packaged/G1+。

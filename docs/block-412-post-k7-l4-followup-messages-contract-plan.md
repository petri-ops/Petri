---
capability: block-412-post-k7-l4-followup-messages-contract
status: completed
goal: 补腿批第一刀（L4-4/L-31 续）：messages 分页 COUNT 索引化（(ts,id) 元组走 idx_msg_conv_ts_id，弃 rowid 无索引回表）+ export 流式分块（内存有界）；K2 同族行为钉测先行（分页不丢不重逐字对齐）。零新增依赖。
acceptance:
  - 红→绿：COUNT 行为等价（20 页滚动 windowOffset 序列逐字对齐 K2 基线）且 EXPLAIN QUERY PLAN 命中 idx_msg_conv_ts_id（不再 FULL TABLE SCAN + rowid 回表）
  - export 流式：行分块组装（内存有界断言：10k 消息导出单查询 ≤ 分块行数）
  - 拆前拆后同套绿：block95-messages-cursor + K2 + block408 + block95-b2
reopen: 分页行为变化或索引失效时重开
---

# BLOCK-412 · L 程序补腿第一刀：messages 读契约（L-31 续）

> 发令来源：预授权连续工作延续（Jev no_key 未恢复——V 类补腿=用户 export TYPESAFE_API_KEY，见 L7 收口汇报）。
> 蓝图=docs/post-k7-full-audit-and-blueprint-2026-11-10.md §4-L4 L-31 续（plan §7.2 判据：K2 同族行为钉测先行）。

## 执行留痕

| # | 状态 | 关键交付 | 证据 |
| --- | --- | --- | --- |
| 红绿 | done | 红 2（rowid COUNT 回表 + export 全量 .all）→ 绿 4/4 | test/block412-messages-contract.test.mjs |
| COUNT 索引化 | done | 独立 COUNT 退役——窗口列 COUNT(*) OVER (PARTITION BY conversation_id ORDER BY rowid) 在页查询内同步算绝对偏移（rowid 语义保持=fork 同 ts 安全；EXPLAIN 非 SCAN 全表断言在档）；20 页滚动 COUNT 调用数 1→0（蓝图验收口径） | 行为基线逐字对齐（380 起 -20 步进×20 页） |
| export 流式 | done | keyset（rowid>）500 行/块增量 res.write + MAX_EXPORT_MESSAGES 上界保持 + 组合原语抽取（composeExportHeader/formatMessageBlock——composeConversationMarkdown 由其重建逐字节等价） | 导出首尾消息与 400 条行覆盖 |
| 同套绿 | done | block95-messages-cursor + block95-b2 + block408 + K2 + block412 = 35/35 | 五套单批 |

**test:changed 批跑 422/424**：P6（W 归属）+ BLOCK-87 批跑红=并发污染 flake（单跑 6/6 绿，已知隔离形态）——如实归属。

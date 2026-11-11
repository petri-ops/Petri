---
capability: block-407-post-k7-l3-error-semantics
status: completed
goal: 执行第五轮优化程序 L3（错误语义与边界）：所有失败有结构化原因码 + 可见 UI/轨迹态 + 明确可重试性；静默 catch 扩扫描根并清零真静默。承载蓝图 docs/post-k7-full-audit-and-blueprint-2026-11-10.md §4-L3 的 11 条发现（L-12~18、L-22/23/68/74）。
acceptance:
  - L3-1 L-12 SSE 终态判定 try/catch + try/finally heartbeat 清理 + close listener 提前（注入 getAgentTask 抛错：无 unhandledRejection、error 帧+[DONE]、heartbeat 归零、res.end 调用）
  - L3-2 L-13 轮询失败计数/结构化 error/3 次或 5s 熔断；L-14 两处空 catch 改具名 reasonCode（fallback_lookup_failed/event_replay_failed）
  - L3-3 L-17 projectionTerminalBridge kill 重试 + sessionByTab 清理 + onerror 有界重连
  - L3-4 L-18 SCAN_ROOTS 纳入 frontend/src + 独立基线；真静默 8 处逐件终态（呈现或具名豁免）；基线只减
  - L3-5 L-22 权限门硬失败/对账器健康事件/uncaughtException 主动退出；L-16 consumedNonces 带过期回收
  - L3-6 L-15 observe 下 ok 与 verdict 分离；L-23 64MB 单入口 budget-constants
  - L3-7 L-68 useInvalidationStream 返回 phase + 统一断线横幅；L-74 三处轻提示
  - L3 出口：gate:silent-catch 扩面后基线只减；SSE 断线注入证据；42 原因码门绿（词表扩面不破封闭类别）
reopen: 蓝图锚点源码变化或词表类别新增需求时重开
---

# BLOCK-407 · post-K7 L3 错误语义与边界（第五轮优化程序第 4 阶段）

> 发令来源：用户 2026-11-11 执行提示词预授权（连续工作）。canonical 蓝图 §4-L3。
> 红绿先行（HK-01）全适用（SSE 注入/桥接注入可单测）。

## 6. 执行留痕（当次证据，收口时逐项对账）

| # | 状态 | 关键交付 | 证据 |
| --- | --- | --- | --- |
| L3-1 | done | events.js 终态判定 try/catch（sse_task_read_failed）+ finish 单点（heartbeat/poll 清理+res.end）+ close 提前注册；注入：error 帧+[DONE]+ended | block407 5/5；block159 契约更新（finish 收单点）5/5 |
| L3-2 | done | 轮询连续 3 次失败熔断（sse_poll_failed+retryable）；负测单次瞬断自愈 | block407 2 用例 |
| L3-2b/L-14 | done | findFallbackChild→fallback_lookup_failed（显式标注不伪造）；回放→event_replay_failed（lastSeq 重置帧） | block407 2 用例 |
| L3-3 | done | terminal 桥：kill 重试 2 次+耗尽上报；exit 清 sessionByTab；onerror 有界 5 次达限 close+bridgeUnavailable 帧 | tsc 净；useTerminalTabs 侧回归绿 |
| L3-4 | done | SCAN_ROOTS+frontend/src（412 处/102 文件，_about 留因）；k6 门新语义（扩面+留因=绿）；真静默 8 处逐件终态（6 具名+2 上报+dataBridges 已由 L2-3 根修）；events.js 4→0 | silent-catch PASS 412；k6 23/23 |
| L3-5 | done | 权限门失败→DEGRADED 标记+/api/health 暴露；reconciler !db degraded+连败≥3 升 error+reconciler_unhealthy；uncaughtException exit(1)；consumedNonces Set→Map 惰性回收 | pl6a 4/4；block386+nso-s2 15/15 |
| L3-6 | done | consumeExecutionAdmission additive verdict（observe 四类 ok:true+verdict:false 可审计）；budget-constants 单入口 9 文件收编+BLOCK-322 跨语言断言对齐 | 准入 15/15；block322 8/8；负测 9 文件零字面量 |
| L3-7 | done | useInvalidationStream 返回 phase；ProjectionStreamBanner（role=status，token 合规）；4 消费方接线；JobsWall:217 具名降级（L-74） | 页面回归 158/158；tsc 净 |

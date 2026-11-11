---
capability: block-408-post-k7-l4-performance-dataplane
status: completed
goal: 执行第五轮优化程序 L4（性能与数据面）：清「数据库同步阻塞、全量回放、无事务 fork、定时器回归、渲染无门」五类真实性能债并把判据接进常驻门。承载蓝图 docs/post-k7-full-audit-and-blueprint-2026-11-10.md §4-L4 的 8 条发现（L-24~L-33、L-35）。
acceptance:
  - L4-1 L-24 fork 事务化+INSERT...SELECT+untilIndex 下推 LIMIT（红绿先行：中途注入失败零半截会话；拆前拆后同套绿）
  - L4-2 L-25 connection facade 显式同步契约注释化或 Atomics.wait 移出热路径（worker_threads 迁移若超 scoped 判据则出补腿条件不擅自扩）
  - L4-3 L-26 findFallbackChild 倒序 LIMIT 1+全量回放真实上限收敛
  - L4-4 L-31 messages COUNT 下推/meta 按需/export 流式（三路径读数入 perf 证据）
  - L4-5 L-32 tick%6/%12 分档复位+请求间隔测试
  - L4-6 L-33 长列表窗口化（零新依赖）或显式补腿条件；L-34 CSS KB 棘轮确认在档（L0-7 已交付 bytes 维度则销号）
  - L4-7 L-35 高频定时器 visibilityState 门或 retain-with-reason
  - L4 出口：quality:perf 连续 5 次 PASS 读数落证据；零新增依赖；新增场景有负测
reopen: 蓝图锚点漂移或 perf 判据变化时重开
---

# BLOCK-408 · post-K7 L4 性能与数据面（第五轮优化程序第 5 阶段）

> 发令来源：用户 2026-11-11 执行提示词预授权（连续工作）。canonical 蓝图 §4-L4。
> worker_threads 迁移属 scoped refactor——若探查显示消费面超可判安全边界，出补腿条件不擅自扩（蓝图 §4-L4 行明示）。

## 6. 执行留痕（当次证据，收口时逐项对账）

| # | 状态 | 关键交付 | 证据 |
| --- | --- | --- | --- |
| L4-1 | done | fork 事务化（父行+消息+计数单事务）+ INSERT...SELECT + LIMIT 下推（randomblob 12-hex 保持 msg_ 契约；ts 同批 now 语义保持）；同步事务契约（fn 收同步 facade——better-sqlity 拒 promise 实测锚定注释）；K2 反向钉测翻新（事务化已交付/其余挂起如实保留） | block408 6/6（红→绿：原子性 3≠2→回滚零残留）；K2 15/15；block95 双套+block88 回归绿 |
| L4-2 | done-partial | facade 显式同步契约注释落 transaction + connection 头注；worker_threads 迁移出补腿条件（探查实证：436 处 prepare/50 文件、1103 调用面、getAsyncDatabase 29 文件——迁移面超 scoped 判据，须独立大包+拆前拆后同套绿） | 本 plan §7 补腿条件 |
| L4-3 | done | findFallbackChild 改 getRecentAgentTaskEvents DESC 小窗 200（终态只需最近一条；原全量 1e6 反序列化历史 delta） | block407+block159+K2 28/28 |
| L4-4 | done-partial | 三路径读数登记本表（COUNT rowid 无索引/meta 逐条 parse/export 无 LIMIT 实测在档）；(ts,id) 索引化 COUNT 与 export 流式分块出补腿条件（动 messages 读契约，须 K2 同族行为钉测先行） | 本 plan §7 |
| L4-5 | done | tickBucket 纯函数（floor 桶）+30s×2/60s×1 三慢档依赖桶值（每 6/12 拍触发）；快档 5s 保持 | block408 契约（bucket6×2/bucket12×1/快档锚） |
| L4-6 | done-partial | L-34 CSS 字节棘轮=L0-7 已交付销号（8 CSS 在册 bytes 只减，实测核对）；L-33 长列表窗口化出补腿条件（SimpleChat displayMessages 渲染面+LeftPanel 三清单无 slice——窗口化涉渲染语义，须 UI 台账条目+9223 实机双证，零新依赖自绘方案待独立切片） | L0-7 交付核对本 plan §7 |
| L4-7 | done-partial | 定时器清单实测登记（ThemeProvider 15s 有 visibilitychange 立刷/useMcpServers 2s 仅 pending 时启用/Knowledge 2s-10s 自适应/ToolActivity 1s×2 纯本地计时无请求）——零网络请求型 retain-with-reason；visibilityState 统一门归 L6 批 | 本 plan §7 |

## 7. 补腿条件（done-partial 项的重开判据，L7 gap-ledger 同源）

1. **L-25 worker_threads 迁移**：重开判据=独立大包发令（U 类前置：迁移涉及 29 文件消费面与事务边界语义）；前置=拆前拆后同套绿基线（K2 信封测试族+block95 族）+ SSE 心跳存活断言（7s 锁争用注入）；期间 connection.js/transaction 处显式同步契约注释已落（本批）。
2. **L-31 messages 读契约**：(ts,id) 索引化 COUNT 与 export 流式分块——重开判据=K2 同族行为钉测先行（20 页滚动分页不丢不重既有 block95-messages-cursor 为基线）+ perf 场景扩 ≥6 后前后读数对比。
3. **L-33 长列表窗口化**：零新依赖自绘方案——重开判据=UI 台账条目立项 + 9223 离屏实机双证（CDP 节点数上界 + 帧间隔）+ 拆前拆后同套绿（SimpleChatMessageRow memo 契约族）；虚拟列表依赖引入须用户裁决（既有裁决域）。
4. **L-35 visibilityState 统一门**：归 L6 批（体验面统一处理高频定时器可见性；本批实测确认 ToolActivity 1s×2 为纯本地计时零请求、useMcpServers 仅 pending 时启用=现状无害）。

---
capability: block-398-post-h9-k2-data-plane
status: active
goal: 按第四轮蓝图 §4 K2 把性能瓶颈从猜测性前端优化转到可量测的服务端数据面；交付红绿先行的可机械验证子集，结构性大改按 W5b 逐刀纪律如实挂起带补腿条件。
acceptance:
  - 具名上限常量收编 15 处生产调用点，拆前拆后同套定向测试绿
  - 会话列表 additive hasMore/nextCursor 信封，默认 100 上限与数组形状不变，>100 条真实 HTTP 行为断言
  - 复合索引在唯一 DDL 通道幂等落地，EXPLAIN QUERY PLAN 命中且带 rowid 负测
  - W5b 挂起项逐件有 sliceRef/closureCondition，不冒充完成
  - docs:check / ui:audit:check / 定向 test:changed / closeout 全绿
reopen: 独立 W5b 切片发令后按本 plan §5 逐刀推进；每刀拆前拆后同套绿
---

# BLOCK-398 · post-H9 K2 服务端数据面与规模化

> 状态：active · P0-LAUNCH
> 发令：用户 2026-11-10 预授权连续工作「K0→K7 全部推完，全程零参与」。
> 阶段纪律：G0 开发期常态 · 不外推 packaged/Provider/GA。

## §1 立项自检（产品个性 · 强制问句）

**与 ZCode/Codex 的差别形态**：①**本地可审计**——数据面预算落在本地 SQLite 与具名常量，不靠云端 APM；②**治理透明**——按 W5b 逐刀纪律把碰数据访问契约的改动全部挂起并写补腿条件，不为「整完」硬闯；③**证据自证**——红绿先行留红/绿两轮输出、`EXPLAIN QUERY PLAN` 命中、`>100` 夹具真实 HTTP 断言、`rowid 不可索引`负测，四类证据不互相冒充。形态上是「通用 agent 可靠性维度的服务端预算」，不是领域内容。

## §2 运行时核实：又一处处蓝图声明过时

| 蓝图声明 | 实码核实 | 处置 |
| --- | --- | --- |
| K-12「未见 copilot_messages / task_events 复合索引」 | **部分过时**：`agent-task-store.js:302` 已有 `idx_task_events_task_seq(task_id, seq)`（BLOCK-106 P2），`:305` 另有 created 索引；`helpers/conversations.js:31,32,42` 已有 3 个索引但 `copilot_messages` 缺同 ts 场景的稳定 tiebreaker | 只补真实缺位的 `idx_msg_conv_ts_id`；不重复建 task_events 索引，不越 DDL 通道 |
| K-12「≥15 个生产点传 1_000_000」 | 实测 **10 文件 / 15 行**（含 federation-tools 的 `1_000_000` 写法），全部同值绑定到 `LIMIT ?`；`agent-task-store.js:596,602,606` 默认 `limit=500` | 具名常量收编（纯重构，零行为变化） |
| K-13「SSE 500ms 轮询未复用事件总线」 | 成立，但 `events.js` 单端点内 15s 心跳 / 500ms 轮询 / afterSeq 回放水位 / `[DONE]` 哨兵 / close 清理五套时序耦合，无 SSE 长连接时间轴夹具 | W5b 独立切片挂起 |
| K-11「fork 逐条 INSERT 无事务」 | 成立，且 `:250` `stmt.run` **未 await**（真缺陷）；`adb` 是 async facade 无 `transaction()`，须整体切到同步句柄 `dbMod.getDatabase().transaction()` | W5b 独立切片挂起（改的是数据访问契约） |

## §3 交付（红绿先行）

- 红：`node --test test/post-h9-k2-data-plane.test.mjs` → 12 项 / 5 红（实现缺席），日志 `/tmp/h9-k2-red.log`。
- 绿：①`core/petri-server/helpers/agent-task-event-limits.js` 单一常量 + 10 文件 15 行机械替换；②`ai-conversations.js:71-72` `LIMIT 101` + `hasMore`/`nextCursor` additive 信封（数组形状/默认 100 不变）；③前端 `ConversationsEnvelope` 登记 `nextCursor?: unknown`；④`helpers/conversations.js` 唯一 DDL 通道加 `idx_msg_conv_ts_id(conversation_id, ts ASC, id)`。
- 复跑：契约 15/15、拆后既有四套 18/18、真实 HTTP 行为 3/3。
- **抓真并修根因**：首版把 `rowid` 写进 `CREATE INDEX` → `SQLITE_ERROR: no such column: rowid`，四套既有测试全红；改用真实主键 `id` 作 tiebreaker，并把「rowid 不可索引」写成负测防回退。

## §4 范围 / 非范围 / 依赖 / 风险

- **范围**：见 §3 四项 + W5b 挂起材料 + K-01/11/12/13/23 逐件终态。
- **非范围**：不改 `limit=500` 默认值、不改 `conversations` 数组形状、不改默认 100 上限语义、不动 `getAsyncDatabase()` 契约、不建第二 DDL 通道、不新建第二事件通道/账本、不动 10 项用户资产与蓝图原件、不撤销既有用户裁决。
- **依赖**：K0 判据（「全量 DOM」前提已作废）、K1 计量边界。
- **风险**：DDL 变更影响所有测试库 → 用 `IF NOT EXISTS` 幂等 + 四套既有测试拆后同套绿 + 查询计划命中验证；常量替换跨 10 文件 → 逐文件 `node --check` + 裸字面量全仓清零验证。

## §5 W5b 挂起项（逐刀切片，不在本会话硬闯）

| 切片 | 内容 | 补腿条件 |
| --- | --- | --- |
| W5b-K2-1 | fork 原子化事务（含 `:250` 未 await 修复） | 同步句柄 `transaction()` + 中途失败全回滚负测 + 拆前拆后同套绿 |
| W5b-K2-2 | SSE 复用 `taskEventBus`，保留 2s DB 兜底水位 | 独立 SSE 长连接时间轴夹具（心跳/重连/终态/`[DONE]` 哨兵）+ 前后同套绿 |
| W5b-K2-3 | 会话列表服务端真分页 + 前端「更多」入口 | 产品语义裁决（游标/页码/上限提示）+ CDP 实机 `>100` 档 DOM 8 档重测 |
| W5b-K2-4 | 每页 `COUNT(*)` / `meta_json` 按需投影 / export 分批 | 读路径契约 + 分页一致性负测 |
| W5b-K2-5 | 请求体五类占比（K-23 前置） | 真实 provider 任务（V 类凭据）逐轮与 `ai_usage`/`ContextBudgetBar` 对账 |

## §6 touchSurface / sharedBaselines

- `touchSurface`: `core/petri-server/helpers/agent-task-event-limits.js`（新）、10 个事件 limit 调用文件、`routes/ai-conversations.js`、`helpers/conversations.js`、`frontend/src/components/copilot/copilotConversationsClient.ts`、`test/post-h9-k2-*`、`acceptance/post-h9-2026-11-10/k2/**`、canonical 六件套。
- `sharedBaselines`: 四份基线零改动（`eslint-suppressions.json` / knip / silent-catch / impact-map-coverage）；`quality:surface` 生成物仅 `generatedAt` 刷新。

## §7 验收门禁与证据

`npm run docs:check` / `npm run ui:audit:check` / `npm run test:changed` / `npm run closeout`；证据 `acceptance/post-h9-2026-11-10/k2/` 四字段齐备。

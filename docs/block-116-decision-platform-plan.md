# BLOCK-116-DECISION-PLATFORM 计划：决策原语平台化（决策内化弧 W2）

**Plan ID**：`BLOCK-116-DECISION-PLATFORM`
**状态**：`completed（2026-09-22 当日立项当日收口：P0 decision_log 台账（migration 011 additive 自动应用 + wrapper meta 记账：提供即记账缺省零行为）+ decision-thresholds.js 七接点注册表（阈值↔校准证据绑定，一致性契约机械承载重校准红线）→ P1 契约 7/7 + 校准共享库 calibration-common.mjs（touch-and-migrate）→ P2 观测面（GET /api/ai/decisions/summary + 设置面板 DecisionUsagePanel UI-434）+ flow 5/5（闲聊→intent-route 落账 conf 记录/degraded=0/无未知接点泄漏）；closeout 十门全绿。抓真=UI-434 台账登记 + aac13f6 双豁免（64da69b 先例）+ impact-map 双规则冲突修正 + 依赖环预防（域映射经 index 既有边）`
**立项日期**：2026-09-22
**责任轨道**：BLOCK（决策台账/阈值配置中心/校准工具化/观测面，跨 P 阶段串行）
**上游文档**：弧线 §W2 · W1 五包（111~115，全部 completed）

## 0. 立项来源与用户裁决留痕

- 弧线 W2 开门条件：W1 ≥2 点生产路径稳定（实际=五点全部当日收口、实机 flow 全绿）+ 用户裁决立项——**用户裁决（2026-09-22 原话「你能做就做下去 不要让我裁决 你可以判断的」）= 后续启动裁决权授予主 Agent 自行判断**，本包据此立项。
- 弧线 W2 目标形态五件：决策台账 / 阈值配置中心 / 校准工具化 / 观测面 /（候选）agent 可见决策工具。本包范围=前四件；候选件（决策原语暴露为 MCP 工具）仍留候选池。

## 1. 范围与非范围

### 1.1 范围

| 阶段 | 内容 | 核心落点 |
| --- | --- | --- |
| P0 | 决策台账 + 阈值配置中心 | migration `011_decision_log.sql`（additive）+ `helpers/decision-log.js`（best-effort 落库，永不 throw）+ `askDecision` 增 optional `meta`（{point, threshold}——提供即记账，缺省零行为）+ `helpers/decision-thresholds.js` 注册表（各接点阈值与校准证据版本绑定）+ 六接点传 meta |
| P1 | 契约测试 + 校准工具化 | `test/block116-decision-platform.test.mjs`（记账行/降级行/never-throw/无 meta 零行/阈值注册表与模块常量一致/证据文件在位）+ `scripts/lib/calibration-common.mjs` 共享库（并发/round/sha256/证据落盘）+ 五个校准 harness 接入共享库 |
| P2 | 观测面 + 实机收口 | `routes/ai-agent/decisions.js` GET /api/ai/decisions/summary（按接点聚 合调用量/均延迟/降级率）+ 设置面板 `DecisionUsagePanel`（BLOCK-79 用量面板同款模式）+ flow `block116-decision-platform-live` + closeout 十门 |

### 1.2 非范围（exclusions）

- agent 可见决策工具（弧线候选件）仍留候选池。
- 阈值运行时热调（v1 只集中声明+证据绑定；改阈值仍须重校准）。
- 决策台账的 UI 逐条回放面（v1 只有聚合观测；逐条回放留后续）。
- 不改变任何 W1 接点的判定行为（记账与观测为 additive；guard 语义零变化）。

## 2. 设计要点

- **单一记账咽喉**：所有接点已必经 `askDecision`——wrapper 增 optional `meta` 参数，提供 `{point, threshold}` 即自动记账（state 做 sha256 指纹 + 200 字预览，answers/latency/degraded 全记录）；记账 best-effort（内部 try/catch），决策结果永不因记账失败受影响。
- **阈值配置中心（v1 形态）**：`decision-thresholds.js` 集中声明各接点 {threshold/gates, evidence 路径}；各模块常量改为从注册表取值（re-export 兼容）；契约测试钉「注册表值=模块值」「证据文件在位」——改阈值必须先重校准的红线由测试机械承载。
- **观测面**：`GET /api/ai/decisions/summary` 按接点聚合（调用量/均延迟/降级率，近 7 天）；设置页「用量与资源」旁新增「决策原语」节（BLOCK-79 同款模式）。

## 3. 验收门禁清单

- P1：契约测试 ≥12 项（记账/降级/never-throw/无 meta 零行/阈值一致性/证据在位/聚合端点）。
- P2：flow `block116-decision-platform-live`（guard 开→闲聊消息→summary 含 intent-route 记录 degraded=0）+ closeout 十门全绿 + impact-map 登记。
- 回归：W1 五包契约测试全绿（记账为 additive）。

**预期节奏**：一次会话收口。

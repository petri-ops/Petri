# BLOCK-116-DECISION-PLATFORM 计划：决策原语平台化（决策内化弧 W2）

**Plan ID**：`BLOCK-116-DECISION-PLATFORM`
**状态**：`completed（2026-09-22 当日立项当日收口（含 P3 增量：决策台账逐条回放——GET /ai/decisions/recent + 面板回放列表可折叠，契约 9/9 + flow block116-replay-live 4/4 实机过目截图，UI-434 翻 verified）：P0 decision_log 台账（migration 011 additive 自动应用 + wrapper meta 记账：提供即记账缺省零行为）+ decision-thresholds.js 七接点注册表（阈值↔校准证据绑定，一致性契约机械承载重校准红线）→ P1 契约 7/7 + 校准共享库 calibration-common.mjs（touch-and-migrate）→ P2 观测面（GET /api/ai/decisions/summary + 设置面板 DecisionUsagePanel UI-434）+ flow 5/5（闲聊→intent-route 落账 conf 记录/degraded=0/无未知接点泄漏）；closeout 十门全绿。抓真=UI-434 台账登记 + aac13f6 双豁免（64da69b 先例）+ impact-map 双规则冲突修正 + 依赖环预防（域映射经 index 既有边）`
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
| P3（增量，2026-09-22 深夜） | 决策台账逐条回放 | GET /api/ai/decisions/recent + 面板「最近决策」回放列表 + flow `block116-replay-live` 4/4；UI-434 verified |
| P4（增量，2026-09-22 深夜，用户提出「jev 参数配置页面——默认填好、可调整」） | 决策配置中心 + 设置页「决策原语」节 | `helpers/decision-config.js`（data 目录 decision-config.json 持久化：enabled/threshold per point；env=0 杀开关最高优先；首载从 env=1 种子）+ GET/PUT /api/ai/decisions/config + 设置页新节「决策原语」（启用开关+阈值输入预填校准值+还原默认+偏离标记）|

### P4 实现完成记录（2026-09-22 深夜，closeout 十门全绿）

- `helpers/decision-config.js`：五运行时接点（topic-shift/knowledge-guard/marker-celltype/intent-route/tool-route）注册 + decision-config.json 持久化（读不落盘，仅 PUT 落盘——测试/只读零副作用）+ `BIOF3_DECISION_CONFIG_PATH` 测试隔离通道。
- 优先级（契约钉住）：env='0' 强制关（杀开关最高）> 配置文件 enabled > 默认；env='1' 仅首载种子不强制运行时（避免 UI 关不掉）。
- `routes/ai-agent/decisions.js`：GET /config（五接点全量+envOverride 如实暴露）/ PUT /config/:point（enabled/threshold 校验 [0,1]，非法 400、未知接点 404）。
- 前端 `sections/DecisionConfigPanel.tsx` + types.ts 'decisions' 节 + 设置页挂载（紧邻「用量与资源」观测节）：五卡片（说明/env 覆盖提示/双门限只读/启用开关/阈值输入预填校准值+偏离提醒+还原默认）。
- 验证：flow `block116-config-live` 6/6（GET/PUT 持久化/非法 400/未知 404/还原默认）+ flow `block116-replay-live` 4/4（设置页实机渲染面板+回放列表）+ 契约 9/9 + 面板组件测试 3/3 + 前端全量 148 文件 1192 用例全绿 + closeout 十门全绿（tsc 0/lint 0）。
- 抓真（双工具判定冲突留因）：getAllByRole 返回类型的 tsc/eslint 判定不一致——测试内定向 eslint-disable 注释留因。

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

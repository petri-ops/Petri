# BLOCK-113-TOOL-PREROUTING 计划：MCP/loop 工具两跳预路由（决策内化弧 W1-3）

**Plan ID**：`BLOCK-113-TOOL-PREROUTING`
**状态**：`completed（2026-09-22 当日立项当日收口：P0 校准 gate.passed（111 条九域语料 overall 91.9%、θ=0.80 采纳精度 98.75%/覆盖 80.8%/all 零误采纳）→ P1 tool-router 决策接点+DOMAIN_TOOL_DEFS 导出+agent-runner 挂钩（契约 12/12）→ P2 flow block113-toolroute-live 3/3（tool_route 事件 family=workspace conf=1 defs=14/71、路由后任务正常终态、all 弃权实证）；closeout 十门全绿（含 arch-cycles 断环重构后复验：域映射改经 agent-tools index 既有边，tool-router 零 agent-tools 依赖）；D-1~D-5 按推荐定版；9 个 argmax 失误多为域分类学模糊（后台进程查询 workspace/resident 跨域）非模型错，如实留痕）`
**立项日期**：2026-09-22
**责任轨道**：BLOCK（agent-runner 工具下发链挂钩 + 九域分类校准 + defs 收窄面，跨 P 阶段串行）
**上游文档**：弧线 §W1-3 · 研究底稿 §6.1 #3 · BLOCK-109-CORE-ARCH P2（tool-metadata 六字段 + tool-defs 九域拆分=本包分类学地基）

## 0. 立项来源与用户裁决留痕

- 弧线 W1-3（2026-09-21 登记）：「工具两跳预路由（若 BLOCK-110 P3 未做；依赖 BLOCK-109 P2 工具元数据交付，吃其族级分组）」——W0-P3 已裁决不执行，BLOCK-109 P2 九域拆分已交付，两前置均满足。
- **启动裁决（2026-09-22）**：用户裁决原话「开 按顺序都做完」（W1 队列 2~5 全数授权按序串行；本包=队列第 3 点）。

## 1. 范围与非范围

### 1.1 范围

agent loop 首轮模型调用前，以决策原语（choice）对最近一条用户消息做**九域+弃权**分类：`workspace / knowledge / result-studio / browser / computer / agent-orchestration / remote / resident / session / all`。采纳（特定域且 confidence ≥ θ）→ 该轮 run 的 function-calling defs 收窄为「路由域 + session 域基础件」（session=todo_write/plan/verify_state/system_info/process_status/process_stop 跨域底座）；`all` 或低置信 → 全量下发（现行为）。降低 token 与误选率（研究底稿：skill_suggestion cookbook 两跳渐进披露）。

| 阶段 | 内容 | 核心落点 |
| --- | --- | --- |
| P0 | 九域语料 + choice 校准 | 中文任务消息语料 ≥100 条（gold=主域，构建法见语料 note）+ θ 曲线；证据 `acceptance/block-113/` |
| P1 | 下发链挂钩 + 收窄器 | `helpers/tool-router.js`（决策接点+域过滤）+ `agent-tools/tool-defs.js` additive 导出 `DOMAIN_TOOL_DEFS` 域映射 + `agent-runner.js` 下发点挂钩；降级五态测试 |
| P2 | 实机验收 + 收口 | dev-verify flow `block113-toolroute-live` + closeout 十门 |

### 1.2 非范围（exclusions）

- **policy 层零变化**：agent-tool-policy / accessMode / 审批门照常全量生效——本包只收「defs 下发展示面」，不做权限面收窄。
- 既有子集路径优先：`context.toolSubset === 'knowledge-console'`（BLOCK-99 白名单）等既有收窄路径不参与路由（不叠加）。
- 仅 primary 任务参与；subagent（spawn-agent-tools 自有子集）、resume/续跑（无新用户消息语义）不路由。
- 每轮工具重选（loop 内动态重路由）、MCP 工具同轨收窄（registry 投影）留后续——v1 只收首轮 function-calling defs。
- W1-4/W1-5 独立立项。

## 2. P0 预登记裁决项（D-1~D-5）

- **D-1 类目集**：九域 + `all`（弃权=全量下发，路由永不比现行为更差的安全阀）。动作语义（推荐定版）：采纳域 → `DOMAIN_TOOL_DEFS[domain] ∪ DOMAIN_TOOL_DEFS.session`。
- **D-2 state**：最近一条用户消息 ≤600 字（同 W1-2）。
- **D-3 门控阈值**：单阈值 θ；P0 取「采纳精度 ≥0.90 且 gold=all 误采纳 ≤2」约束下覆盖最高档（预期 θ≈0.8——误路由代价=模型看不到邻域工具，任务能力受损）。
- **D-4 默认开关位**：默认关 + 显式开 `PETRI_JEV_TOOL_ROUTE=1`（误路由直接损伤任务能力面，必须保守侧；P2 实机零回归后翻默认另裁）。
- **D-5 作用面**：agent-runner `resolveToolDefsForContext` 之后一次性过滤（每 run 一次，+1 次 Jev 调用 ≈280ms 延迟成本，guard on 才发生）；routing 不改变 tools 顺序相对关系。

## 3. 关闭语义

- 正常完成：P0 证据门 → P1 → P2 + closeout 十门 → completed。
- **PoC 失败语义（诚实收缩）**：overall argmax accuracy < 0.75 或 θ 下采纳精度 < 0.85 → 收缩关闭，仅冻结 W1-3（负结果登记回 arc）。key 失效转 🟡 延期。

## 4. 验收门禁清单

| 门禁 | 预期 |
| --- | --- |
| P0 校准 | `acceptance/block-113/calibration.json`（≥100 样本，overall/采纳精度/θ 曲线）+ 语料入库 |
| P1 契约测试 | `test/block113-tool-prerouting.test.mjs`：guard 关零出站/降级五态/伪造类目拒收/采纳收窄=路由域∪session/all 弃权=全量/existing toolSubset 优先/未用导出恒等（71 工具集合零变化） |
| P2 实机 | dev-verify flow `block113-toolroute-live`：真实 Jev——workspace 类任务路由后模型仍正常完成（能力不损实证）+ `all` 类全量下发 + 杀开关全量；证据 `acceptance/block-113/` |
| 收口链 | closeout 十门全绿；impact-map 登记 `block113-tool-prerouting` |

**预期节奏**：P0+P1+P2 一次会话收口。

## 5. 红线与风险

- 决策必经 decision-api（pin jev-1.13.0）；key 不入仓；guard 关=agent-runner 下发链零变化。
- 71 工具集合恒等红线：域映射导出必须与既有 TOOL_DEFS 深度一致（契约测试钉住）。
- 风险：多域任务单选困难（`all` 弃权兜底 + 语料显式含多域→all 样本）；误路由能力受损（θ 保守 + session 底座常驻 + 实机腿「路由后任务仍完成」实证）；类目粒度（九域来自 BLOCK-109 P2 物理拆分，非本包新造）。

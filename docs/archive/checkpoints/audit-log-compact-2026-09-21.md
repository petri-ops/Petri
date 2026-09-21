# AUDIT-LOG 自动精简归档 · 2026-09-21（audit-log-compact.mjs）

> 来源声明：本档由 scripts/audit-log-compact.mjs 自动剪切生成（用户裁决「AUDIT-LOG 的规范和精简
> 应该是自动化的过程，仅保留必要的内容」）。内容=「最近处理记录」中每包最新一条之外的旧行
> 原文。canonical 状态以 roadmap/plan/DOC-REGISTRY 为准，本档仅作广播历史追溯。

| ✅ 立项登记（planned 排队，不占 active 槽位；2026-09-20，用户裁决「新开个block优化我们的项目」；同批承接 BLOCK-106 收口） | 2026-09-20 | **BLOCK-107-CONVERSATION-STREAM-UX 立项登记（会话信息流呈现时间线化）**：用户初始想法=模仿 Qoder 的会话消息呈现方式（思考/工具/改动/结论按发生顺序交错成一条线，刷新后同一条线），现状**不是**——`SimpleChat.tsx:1043-1113` 为固定模板顺序、工具/思考/进度按类型各聚成一个列表（`ToolActivityList.tsx:412/:483/:491`），真实交错被拍平；根因=历史渲染走 `copilot_messages.meta_json` 聚合快照（`conversation-adapter.js:97-175`）致跨类型时序丢失，而完整时序在 `task_events`（`agent-task-store.js:404-407` 的 seq 游标）却未被主聊天历史路径消费 → 实况（SSE）与历史（meta）双轨呈现不一致。范围：P0 度量+时序真源裁决（D1 三选）→ P1 分段模型+交错渲染（簇头一行+失败计数+运行秒表，运行展开/完成收起）→ P2 历史兼容+策略视觉+SimpleChat 体量债 → P3 实机三宿主面收口；非范围=消息虚拟化/轮询→SSE/`task_events` 数据模型改造（三者 BLOCK-106 §7 已登记独立候选包）/后端事件协议大改/新依赖/不碰 frontend lockfile（P6 源绑定）/G1+；保留资产=UI-268/272/315/382/383 零件不退化成对账。五件套同批落地：plan `docs/block-107-conversation-stream-ux-plan.md`（§0 行号级问题定义 + §7 D1–D6 预置裁决）+ DOC-REGISTRY `planned`/`P0-PLANNED` + README 139 + roadmap 首条 + 本行。**启动（转 active）需用户裁决**；P0 首要动作=补采 §0.6 量化基线（现证据为只读读码，尚无可判定数字，不得当作 BLOCK-106 §0 式实测）。G0 开发期常态 · 不外推 packaged/Provider/GA | BLOCK-107 / PLANNED |
# AUDIT-LOG 自动精简归档 · 2026-09-21（audit-log-compact.mjs）

> 来源声明：本档由 scripts/audit-log-compact.mjs 自动剪切生成（用户裁决「AUDIT-LOG 的规范和精简
> 应该是自动化的过程，仅保留必要的内容」）。内容=「最近处理记录」中每包最新一条之外的旧行
> 原文。canonical 状态以 roadmap/plan/DOC-REGISTRY 为准，本档仅作广播历史追溯。

| ✅ 治理登记（2026-09-21，用户实测三裁决：「按你的建议来」/「收敛呈现」/「终态对账立候选」） | 2026-09-21 | **BLOCK-109-CORE-ARCH plan 两轮修订 + 两项登记**：plan 修订 1=UI-432 四件套吸收为基线输入与零退化红线（P0-2/P1-6/P2-5/§0.3/§8）；plan 修订 2=实机故障证据入 P0 基线（run `80669989`：7 子智能体 3 败全为流中途 ECONNRESET，与 event-loop 冻结 10-12s×5 逐毫秒同刻；BLOCK-109 P1 重试零触发=流中断形态缺口实证，P1 重写时重试须覆盖全流轮）；roadmap 新登记「子智能体汇报收敛」排队批（呈现折入组卡 + spawn 汇报纪律——现状只读限定在、汇报形态无约束）与「清单终态对账」候选（模型申报制无系统对账门，建议随 P1 事件真相评估立项）；顺修 roadmap 槽位行存量漂移。G0 开发期常态 · 不外推 packaged/Provider/GA | BLOCK-109-CORE-ARCH / REVISED+REGISTERED |

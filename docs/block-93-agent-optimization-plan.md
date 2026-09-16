# BLOCK-93-AGENT-OPTIMIZATION — 子智能体专职化与彻底优化

最后更新：2026-09-16（**整包收口 completed（P0–P3 一次会话完成，active 槽位清空）**。P0 三裁决（用户问答）：①R1=服务端注册表 + 扩展角色集十角色；②R4=仅 prompt 软约束（硬白名单留后续候选）；③扩展清单=六基础 + test🧪/write✍️/plan🗺️/fix🔧。**交付**：`agent-roles.js` 服务端注册表（key/label/description/directive 单一事实源）；spawn_agent 可选 role 参数（枚举对齐、未知 fail-closed）→ params.role 落库 → renderRoleDirective 注入 runAgentLoop system prompt（additive roleDirective 参数，未传零注入）；followup_task/launchUserFollowup 续派角色继承（显式覆盖 > 原角色 > 通用）；list_agents/wait_agent 摘要透出 role；前端三处（内联实况卡/右栏面板头/摘要卡图标带）显式 role 第一优先、文本推断兜底（resolveAgentCategory 统一入口），agentCategories 扩展四类+关键词。**门禁**：block93-agent-roles 契约 12 断言（落库/注入/fail-closed/additive 红线/继承/透出）+ block93-role-prompt 实机级 2/2（真实 agent-runner + mock 上游捕获 system prompt 断言【角色：检索】与零注入，两轮真实链路收敛 completed）+ 邻接 block49/agent-tool 套件全绿 + 前端 vitest 89 过 + tsc 0；UI-390 同提交登记；impact-map block93 规则。提交链 62d04b68→7c9cf64a→86563e21→收口提交。G0 开发期常态 · 不外推 packaged/Provider/GA）

状态：`completed（2026-09-16 P0–P3 一次会话完成；R5 优化候选池保留——多子智能体并发观看切换、历史回放聚合条重建、角色专属验收探针等逐项另评）`

计划编号：`BLOCK-93-AGENT-OPTIMIZATION`

主模块：`P-03 Harness 与 Agent 工作流`（agent 工具面 + 子智能体 UX）

前置：UI-382（内联实况卡）、UI-385（右栏智能体 tab）、UI-386（摘要卡图标带）、UI-387（职能图标推断）已交付

## 0. 来源与裁决

- 用户复看 UI-387 时连续提案：智能体图标应有区分（形状/配色）；子智能体应分类专职（「有的是整理 搜集 检索 等等这些子智能体 让他们专职」）。
- 用户裁决「1」：图标区分（推断式）立即做并已交付为 UI-387；**专职化立本 block**，作为「针对智能体的彻底优化」的载体，启动需用户裁决。

## 1. 范围（P0 评审时逐项确认）

- **R1 角色注册表**：检索/搜集/整理/读取/分析/通用 等角色定义（key、显示名、图标、职责描述、system prompt 片段）；数据形态与存放位置（前端常量 vs 服务端注册表）P0 定。
- **R2 spawn 角色参数**：spawn_agent 增加可选 `role` 参数——prompt 级软约束（引导子智能体优先使用对应工具、更早收敛），父模型未指定时由任务文本推断兜底；落 tool_jobs/tasks 元数据供 UI 展示。
- **R3 UI 联动**：内联实况卡 / 右栏智能体面板 / 摘要卡图标带 显示角色名；`inferAgentCategory` 文本推断降级为「无显式角色时的兜底」。
- **R4 只读角色工具白名单（评估项）**：检索/读取类角色的 R0 工具子集约束——政策面（inferExecutionPolicy / accessMode）已有挂点，是否启用由 P0 评审 + 用户裁决。
- **R5 彻底优化候选池**（立项池，逐项另评）：多子智能体并发观看切换体验、子智能体历史回放（重载后聚合条条目重建）、续派角色继承、角色专属验收探针。

## 2. 非范围

- 硬工具白名单（一期仅 prompt 软约束，R4 评估后另裁）。
- 主 agent 本体的循环/编排重构（BLOCK-83 已定型架构）。
- 投影/移动端子智能体面。

## 3. 阶段草案

| 阶段 | 内容 |
| --- | --- |
| P0 | 设计评审：角色集定义（R1 表）、参数与元数据契约、UI 联动面、R4 取舍——逐项代码事实 + 用户确认 |
| P1 | 角色注册表 + spawn_agent `role` 参数 + prompt 注入 + 元数据落库 |
| P2 | UI 联动（三处图标/名称展示 + 续派角色继承） |
| P3 | 实机验收（真实 spawn 角色轮次 + 契约/组件测试）+ 收口 |

## 4. 验收门草案

- spawn 角色轮次实机：子智能体 system prompt 含角色片段、UI 三处显示角色。
- 契约测试：role 参数校验 / 未知角色拒绝（fail-closed）/ 推断兜底。
- 无角色调用零行为变化（additive 红线）。

G0 开发期常态 · 不外推 packaged/Provider/GA。

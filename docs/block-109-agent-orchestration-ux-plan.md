# BLOCK-109-AGENT-ORCHESTRATION-UX — 子智能体编排的用户呈现与韧性

- registry: BLOCK-109-AGENT-ORCHESTRATION-UX / truthDomain: block-109-agent-orchestration-ux
- 立项: 2026-09-21（用户实测「全方位梳理项目」后连续反馈：18 个智能体图标 / 结果卡刷屏无序 / 主任务 ECONNRESET 半途而废；裁决「我觉得都需要做 你系统性评估后安排 最好一次性推完」）
- UI 台账: **UI-432**（呈现类）
- 前置: 用户实测数据还原（本 plan §0）

## 0. 实测还原（2026-09-21 用户 run，本机 dev 库）

用户主任务（17 轮迭代 / 50 工具调用 / 4638 delta）**并行派发 5 个子智能体**（4 个同批：docs/core/frontend/验证链梳理；05:41 补 1 个）。结果 4 完成 1 失败（ECONNRESET），**主任务自身亦 read ECONNRESET 挂除**，任务清单 9 项只完成 3 项。用户三个体感：侧栏「18 个智能体」（实为 5 个，18=概览孤儿泄漏）、结果卡刷屏无序、主任务半途而废。

## 1. 范围（四件，P1→P4）

- **P1 主循环瞬断重试**：`loop-orchestrator` 每轮模型调用的网络瞬断（ECONNRESET/ECONNREFUSED/ETIMEDOUT/socket hang up）自动重试至多 2 次（退避 3s/8s），重试耗尽才走既有 fatal/fallback 路径。流中断即整轮重试（streamedText 每轮重置，语义安全）。
- **P2 派发并行度软上限**：`spawn_agent` 执行器在父任务活跃子任务 ≥3 时返回**软指引结果**（不派发，提示用 wait_agent 等待空位）——确定性上限 + 模型保持控制权。
- **P3 终态结果卡组化**：`useTerminalSubAgentResults` 弃 `slice(-2)` 截断，改为「最近一批」全部终态子任务收拢为**一个可折叠汇总卡**（「阶段汇总 · N 个子智能体 · 成功 X · 失败 Y」，默认展开最新失败、可收起），组内按派发序排列。
- **P4 项目概览孤儿过滤**：`useProjectAgentOverview` 的 `!t.projectId` 兜底过滤删除——无主（孤儿）任务不再计入每个项目的智能体图标带（18 = 6 真实 + 12 孤儿泄漏的根因）。

## 2. 非范围

- 子智能体结果不进主正文（保持结果卡/组卡形态，UI-382 层次不变）；不实现子智能体结果自动汇总成结论（P1 只保证主循环活到能汇总）。
- 不改 spawn/子任务的数据模型与 API 形状（组化纯前端折叠；软上限复用既有工具结果通道）。
- 不做模型侧并行策略提示词工程（软上限返回文本即模型可见的引导）。

## 3. 依赖与环境

- 后端改 loop-orchestrator（P1）与 spawn 执行器（P2）→ 改后须重启 dev 栈；前端 P3/P4 热更可见。
- 看门狗已退役（同日裁决），实机验证期间栈不会被误重启。

## 4. 证据位置

`acceptance/block-109/`；契约测试随各文件。

## 5. 验收门禁

1. 契约测试：loop-orchestrator 瞬断重试（注入连续 2 次 ECONNRESET 后第 3 次成功→不 fatal；3 次全失败→fatal 且有重试日志）；spawn 并行上限（第 4 个 spawn 返回软指引）；组卡渲染（多终态子任务→单汇总卡+展开明细）。
2. 实机：复现「全方位梳理」类任务（或最小 spawn 场景），验证运行中簇尾轮展开、结果组卡、概览计数=真实派发数。
3. 九门全绿。

## 6. 完成语义

四件全部落地 + 门禁绿 + 实机验证 + canonical 回写（本 plan/roadmap/handoff/AUDIT-LOG/UI-432 verified）→ completed。

## 7. 收口笔录（2026-09-21，一次会话四件全落地；用户裁决「都需要做 一次性推完」）

- **P1 主循环瞬断重试**：`callProviderWithNetworkRetry`（ECONNRESET/ECONNREFUSED/ETIMEDOUT/EPIPE/socket hang up/network 正则族）退避重试 ×2（3s/6s），abort 即停、非瞬断不重试、重试耗尽原样上抛走既有 fatal/fallback；finalizing 轮不叠加（其自带 attempt 循环）。重试期间经 agent_status(network_retry) 对用户可见（「模型连接瞬断，Ns 后自动重试」）。行为四态测试锚定。
- **P2 派发并行度软上限**：spawn_agent 在父任务活跃子任务 ≥3（SPAWN_CONCURRENCY_LIMIT）时返回 `concurrency_limit` 软指引（引导 wait_agent 腾位），不硬拒、模型保持控制权。
- **P3 结果卡组化**：`useTerminalSubAgentResults` 弃 slice(-2)；新增 `SubAgentResultGroup`——汇总行恒定可见（「阶段汇总 · N 个子智能体 · 成功 X · 失败 Y」），有失败默认展开、全成功默认收起，点击切换；组内按派发序明细卡。
- **P4 概览孤儿过滤**：`useProjectAgentOverview` 删 `!t.projectId` 兜底——孤儿任务不再泄漏进每个项目的智能体图标带（「18 个」= 6 真实 + 12 孤儿的根因修复）。
- **门禁**：契约 test/block109-orchestration.test.mjs 3/3（重试四态 + spawn 软上限源码契约 + 孤儿过滤源码契约）+ SubAgentResultGroup 3/3 + block93 修复后全绿 + 九门全绿。实机：spawn 场景真模型轮次通过（运行中簇头带 wait_agent 秒表=尾轮展开、完成后「阶段汇总 · 1 个子智能体 · 成功 1」组卡），截图 acceptance/block-109/spawn-live.png。
- **同批环境件**：restart-dev-stack.sh 加 CDP 端口覆盖（BIOF3_DEV_CDP_PORT，默认 9222 不变；当日 9222 幽灵端口绕行）；platform-branch-freeze BASELINE 登记 block101-startup-timeline-live.cjs（合并树存量，登记即留痕）。G0 开发期常态 · 不外推 packaged/Provider/GA。

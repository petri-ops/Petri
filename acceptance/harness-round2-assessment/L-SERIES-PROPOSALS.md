# harness 第二轮 L 系列五项立项材料（owner msg_8640320d302e：出材料逐个拍板、不出实现）

> 每项含：方案 / 成本 / 依赖 / 不做的真实代价 / 与 pending 裁决关联。证据沿用 `HARNESS-ASSESSMENT.md` 8 维核码（路径:行号），本文不重复取证。
> 状态：pending_user_ruling，逐项拍板后才立项；本批零实现代码。

## L1 · dependsOn DAG 步骤调度器
- **方案**：在 `workflow-runner.js` 现有 parallel/pipeline 之上加 `dependsOn` 步骤声明 + 拓扑排序调度（复用 `shared-backend/result-workflow-graph.js:477 topologicalComponent` 的既有环检测，但需新写"步骤级"拓扑，不与结果血缘混用）；失败隔离用 `allSettled` 替代裸 `Promise.all`（:204）。
- **成本**：高（新调度内核 + DSL 扩展 + 测试矩阵 + 与现有 tool_jobs 状态机对齐）；建议独立工作包，不动 G1 六序。
- **依赖**：workflow-script.js:30 concurrency 校验、workflow-runner.js:201/213 parallel/pipeline、结果血缘拓扑（仅参考算法）。
- **不做的真实代价**：复杂任务只能 parallel/pipeline 硬编码顺序，依赖一变就改代码；子 agent 仍强制串行（agent-loop-control.js:626 concurrentSafe=false）。当前简单需求可交付，代价随任务复杂度非线性上升。
- **pending 关联**：无直接关联；与 G1"通用 agent 内核"方向同频，建议 G1 排期时一并评估。

## L2 · 崩溃自动续跑
- **方案**：①`_loopSaveCheckpoint` 去静默 catch（M3 已做 error 留痕）②stall-resume 游标/过滤器落盘（`loop-orchestrator.js:818-852/958-983` 现为纯内存）③checkpoint 恢复消费 `context_checkpoints`（现仅 harness 路由读取）④崩溃从 failed 改 `recovery_required` + 自动续跑入口（当前 db.js:1325-1330 一律 failed、需人工 POST resume）。
- **成本**：高（状态机语义变化 + 崩溃边界测试 + 幂等重放验证）；建议先做①②（M3 已落①的一半），③④单独立项。
- **依赖**：M3（已落）、checkpoint 不可变表（schema.js:73-83）、stale-running-reconciler.js:30-99、resume.js:111-274。
- **不做的真实代价**：长任务/夜间任务崩溃即断档，依赖人在场人工 POST resume；当前有对账+人工续跑兜底，不是数据丢失，是"交付连续性"损耗。
- **pending 关联**：无直接关联；与 L1 调度器共享 checkpoint 基础设施，建议 L1 先行。

## L3 · 成本硬熔断
- **方案**：`cost-cap.js:13-15` 现明示"无强制 break/return"（超成本只发事件+system 提示）——改为在预算耗尽时强制停止该轮迭代（保留部分产物、发 `cost_cap_exceeded` 事件、写入 ai_usage），并给"继续/停止"的人机审批点。
- **成本**：高（中断语义影响用户体验 + 部分失败产物处理 + 预算单位/汇率/估算误差边界）；需 owner 裁决"硬停 vs 软提示+确认"。
- **依赖**：cost-cap.js:32 env 后门、ai_usage 字段、M5 定价扩容（已落但为估算价——硬熔断前必须 owner 校准真实账单价，否则误停风险）。
- **不做的真实代价**：极端情况 token 超支；当前 ai_usage 可事后追账、软提示已让模型收敛，代价是偶发超支而非系统性失控。
- **pending 关联**：与 M5 估算定价强关联——**Owner 若先校准价格表，L3 才能可靠硬停**（这是顺序依赖）。

## L4 · 统一工具注册面 + 插件热启停
- **方案**：合并 `mcp/registry.js listTools` 与 `agent-tools/registry.js buildToolRegistry` 两个注册表面为单一投影（消除 :606-610 的 `catch{}` 静默漂移）；插件加 `activate()/deactivate()/dispose()` 生命周期，替换 `plugin-manager.js:254` "restart app to activate"；扩展点契约收敛到单一 canonical 文档。
- **成本**：高（跨前后端契约重构 + 插件生态兼容 + G1 领域包方向强相关）；建议与 G1 领域包工作并行评估，不抢 G0 稳定性资源。
- **依赖**：mcp/registry.js:549/842、agent-tools/registry.js:599/642、pack-contributions.js:340/402、plugin-sdk.js、plugin-contract-lint.js。
- **不做的真实代价**：两 registry 长期漂移、MCP 投影失败静默（用户看不到工具缺失）、插件改完必须重启（领域包开发体验差）；当前用户功能可用，代价在开发效率与长期维护。
- **pending 关联**：与 petri-pack-create 蓝图（第三领域包）强关联——**create 包接入前需先定"统一注册面"，否则会形成第三个注册入口**（蓝图 §2.1 已写明此约束）。

## L5 · goal-verifier 接线
- **方案**：`agent-runner.js:308 decisionVerifier=null` 与 `agent-tools/goal-verifier.js:28 verifyGoalCompletion`（定义了但无调用点）接线：在 agent loop 收尾调用 verifier，失败则标 `verification_failed` 而非"完成"；默认档位需裁决（always / opt-in / 仅高风险任务）。
- **成本**：中（接线本身小，但行为裁决+误判成本大：verifier 可能把正确交付判失败，阻塞正常收口）。
- **依赖**：OB-008 已留 P2 位（第一轮 BLOCK-520 计划 :27 明确"接线保留 P2，默认值需裁决"）；goal-verifier.js 现状；artifact-truth（文件产物已有 sha256 自证兜底）。
- **不做的真实代价**："完成"由模型自判，偶发错误完成声明；当前 artifact-truth 已兜住文件产物（sha256 快照），代价主要在"结论/答复"类无文件产物的任务。
- **pending 关联**：**直接关联 pending 裁决**——OB-008 goal-verifier 行为裁决（第一轮已标"默认值需裁决"）。本项不自行翻裁决；owner 拍板默认档位后方可接线。

## 裁决建议（逐项，不捆绑）
| 项 | 建议 | 理由 |
|---|---|---|
|L1|排在 G1 内核排期时评估，暂不启动|复杂任务编排是 G1 主线能力，不抢当前资源|
|L2|先做①②（checkpoint 留痕/游标落盘），③④待 L1 后|降低状态机风险、与 L1 共享基础设施|
|L3|待 owner 校准 M5 价格表后启动|估算价硬停会误停|
|L4|与 petri-pack-create 立项同步裁决|create 包需要先有统一注册面，否则第三入口|
|L5|与 OB-008 pending 裁决一并拍板|行为默认值属产品语义，不自行翻|

status: pending_owner_ruling · 逐项拍板 · 本批零实现代码。

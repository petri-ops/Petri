# BLOCK-55 — 渐进式工程计划模式（Spec 门 + 步骤分派 + Replan）

> 状态：`completed`（2026-09-04 用户裁决「启动55 一次性搞定」；BLOCK-49 已落地，P2 前置满足；P1→P2→P3→实机→收口一次会话推进，同日收口）
> 立项日期：2026-09-03（用户裁决「渐进式 + 参考 codex 取精华」）
> truthDomain: `block-55-engineering-plan-mode`
> 来源：BioF3 计划能力现状盘点 + codex plan mode 渐进设计调研（本会话）

## 1. 背景

用户需求：无论生信分析还是通用智能体工作，长时间大工程任务需「多智能体协作 + spec 模式计划好再执行 + 建立 loop」才能完成——问当前项目是否有这种计划能力。

### 1.1 现状盘点结论：有计划，无 spec 门，单 agent 执行

| 已有设施                                                                                                                      | 位置                                                                      | 状态        |
| ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------- |
| 轻量计划工具 `tool_plan`（create/update\_step/pause/resume/cancel；步骤状态机 pending→running→done/failed/skipped；全 done 自动 completed） | `agent-tools/plan-ui-tools.js` + `copilot_plans`/`copilot_plan_steps` 表 | ✅ 在产      |
| Harness Workflow Plan（多步分析 + bind\_artifact 绑定真实产物，防 AI 自欺）                                                               | `routes/harness/workflow.js`                                            | ✅ 在产（生信域） |
| Loop 执行循环（taskSpecRef/automationMode/recovery + BLOCK-38 中断续跑）                                                            | `loop-orchestrator.js` + `routes/ai-loop.js`                            | ✅ 在产      |
| 系统提示计划纪律（多步任务先 plan create；一步 done 才发下一步；失败不硬声称）                                                                          | `routes/ai-agent/chat.js` L395-440                                      | ✅ 引导在     |

**缺口**：① 无 spec 审阅门（模型生成计划即开始执行，无「冻结→人审→批准解锁」）② 无步骤级 agent 分派（全部单 agent 串行）③ 无 replan（偏离不修订）。

### 1.2 codex plan mode 精华（已验证到行号，取四点）

| 精华                                         | codex 实现                                                               | 借鉴                               |
| ------------------------------------------ | ---------------------------------------------------------------------- | -------------------------------- |
| 二档模式（Plan/Default），渐进靠模式切换不靠档位爆炸           | `protocol/src/config_types.rs` L673-682 `enum ModeKind`                | spec 门 = 模式级开关                   |
| Plan 模式下收工具（update\_plan 被拒）——纯讨论不执行       | `core/src/tools/handlers/plan.rs` L87 `turn.mode()==ModeKind::Plan` 拒绝 | 门的技术实现                           |
| 计划完成三选一弹窗：批准执行 / 清上下文执行 / 继续留在 plan 模式     | `tui/src/chatwidget/plan_implementation.rs` L22-113                    | 用户裁决权 + 上下文管理                    |
| 指令外置 preset（可调可本地化，不硬编码）                   | `collaboration_mode_presets`（catalog\_messages.plan）                   | P1 提示词组织                         |
| 计划 = 轻量 step/status（同一时间最多一个 in\_progress） | `plan_spec.rs`                                                         | BioF3 tool\_plan 已有且更强（持久化+生命周期） |

**关键洞察**：codex 的渐进 = 模式级开关（讨论↔执行）+ 执行入口三选一裁决——**轻门而非重流程**。spec 不做成重文档系统。

## 2. 方案（渐进三阶段）

### 2.1 P1 — Spec 门（轻门，不依赖 BLOCK-49）

- **spec 阶段状态**：`copilot_plans.status` 增加 `draft` 前置态（additive，DB 列已有枚举扩展位）；新增 `spec_md` 字段（TEXT，模型生成的计划正文：目标/边界/步骤+每步验收标准）

- **plan 模式开关**（会话级 toggle，前端 copilot 区入口）：开启时收掉写类工具（对齐 codex「纯讨论不执行」——复用 agent-tool-policy 既有 accessMode 拦截机制，plan 模式视同 read 模式的写拦截 + 保留只读探索），模型可读文件/检索/起草 spec，不可执行

- **批准三选一**（计划完成时弹窗）：① 批准并执行（plan→approved，恢复工具，按步骤推进）② 批准并清上下文执行（新 turn 只带 spec\_md + 步骤表——对齐 codex "clear context and implement"，防止讨论期长上下文污染执行期）③ 继续留在 plan 模式（继续讨论修订）

- **既有资产全复用**：tool\_plan 生命周期（pause/resume/cancel）、步骤状态机、前端计划 UI、系统提示纪律（补 draft/approved 语义引导）

- 生信域联动：Harness Workflow Plan 保持独立（它有自己的 artifact 绑定语义），本包不动它

### 2.2 P2 — 步骤级 agent 分派（依赖 BLOCK-49 spawn\_agent 落地）

- `copilot_plan_steps` 增加 `assignee` 概念（可选；默认仍是主 agent 自己执行——渐进：不分派的步骤零行为变化）

- 执行到标记 assignee 的步骤时：主 agent 调 `spawn_agent`（BLOCK-49 工具）派子 agent 执行该步骤 → `wait_agent` 收结果摘要 → 写回步骤 `done/failed` + 结果引用

- 并行语义：无依赖的多个 assignee 步骤可并行派发（受 BLOCK-49 并发槽约束）

- 汇总：全部步骤终态后主 agent 汇总执行报告（复用既有最终回答链路）

### 2.3 P3 — Replan 修订（增强，二期）

- 步骤 `failed` 时：模型可提「修订案」（新步骤表 diff 呈现：删/改/增），用户批准后替换原计划继续（对齐 spec 模式的「计划是活文档」哲学）

- 修订历史保留（plan\_versions 或 json blob，最小面）

## 3. 非范围

- 重 spec 文档系统（模板/多级审批/签署流）——codex 教训：轻门不重流程

- 计划的 DAG 依赖编辑器（步骤先后靠提示词纪律维持，不做图编辑 UI）

- 跨会话「计划工作台」页面（plan 持久化已有，专用入口留候选）

- Harness Workflow Plan 的 artifact 绑定链（独立体系不动）

- 0 新 npm 依赖

## 4. 阶段

- **P0 立项**：本计划 + DOC-REGISTRY + roadmap/README + AUDIT-LOG 登记。

- **P1 Spec 门**：draft 状态 + spec\_md 字段 + plan 模式开关（工具收编）+ 批准三选一弹窗 + 系统提示补语义；定向测试（draft 不可执行/批准后解锁/三选一路径/上下文清理变体）。

- **P2 分派**（BLOCK-49 落地后）：assignee + spawn/wait 集成 + 汇总报告；定向测试（分派步骤 spawn 调用/结果回写/无 assignee 零行为变化）。

- **P3 Replan**：修订案 + 批准替换；定向测试。

- **门禁**：各阶段定向 vitest + node --test + tsc + `docs:check` + `ui:audit:check`；新 UI 编号同提交登记。

- **实机**：P1/P2 各一轮 dev Electron 实机（生信场景：PBMC 分析计划→批准→分派两步给子 agent→汇总）；证据 `acceptance/block-55/`。

## 5. 验收门

- P1：plan 模式下写类工具被拒（read 照常）；spec\_md 可生成可编辑；draft 态不可执行；批准三选一三条路径行为正确（尤其「清上下文」变体的新 turn 组装）。

- P2：无 assignee 计划行为与现状完全一致（零回归）；assignee 步骤真实 spawn 子 agent 且结果回写；并行步骤受并发槽约束超限诚实拒绝。

- P3：失败步骤提修订→批准→替换→继续执行；修订历史可查。

- 治理：`docs:check` + `docs:reconcile` 收口必跑。

- G0 开发期常态 · 不外推 packaged/Provider/GA。

## 6. 风险与对策

| 风险                          | 对策                                                         |
| --------------------------- | ---------------------------------------------------------- |
| plan 模式收工具与 accessMode 语义冲突 | 复用既有只读拦截链（policy 层加 plan-mode 维度），不新建第二套权限系统               |
| 「清上下文执行」丢关键信息               | spec\_md 自包含验收标准（起草纪律写进提示词）；执行首 turn 注入计划全文                |
| 步骤分派的子 agent 上下文漂移          | BLOCK-49 已定「干净 task prompt + spec\_md 传递」；assignee 步骤描述自包含 |
| 并行步骤结果乱序回写                  | wait\_agent 语义收齐再写回（BLOCK-49 已定摘要回传契约）                     |

## 7. 进度记录

- 2026-09-03 P0（planned 登记）：用户裁决「渐进式 + 参考 codex 取精华」立项；现状盘点（有计划无门单 agent）+ codex 四精华提取（二档模式/收工具/三选一/轻门哲学）；渐进三阶段（P1 轻门不依赖 49 / P2 依赖 49 / P3 增强）；本计划落盘并注册 DOC-REGISTRY。建议执行序：BLOCK-51 → 52/53/54 → 49 → 55。

- 2026-09-04 P0（启动登记，active）：用户裁决「启动55 一次性搞定」；当前唯一 active 工作包。前置核验：BLOCK-49 已收口（`d3b7928b`，spawn_agent/list_agents/wait_agent 在产），P2 前置满足。执行序 P1（Spec 门）→ P2（分派）→ P3（replan）→ 实机（`acceptance/block-55/`）→ 收口。

- 2026-09-04 收口（completed，P1→P3+实机一次会话）：① **P1 Spec 门**——`copilot_plans` additive 列（spec_md/approved_via/revision counter，DDL 事实源收敛至 `helpers/plan-lifecycle.js` 与 ai-bridge 共用）+ draft 前置态（plan 模式下 create 落 draft、批准前不可执行副作用）+ 会话级 plan 模式开关（`agent-tool-policy.js` plan-mode 维度：写类工具拒 `plan_mode_active`、plan 工具放行、只读探索照常）+ 批准三选一 REST（execute / execute-fresh / keep-planning，execute-fresh 合成 freshTurn 消息数组仅含 spec 自包含首条）；② **P2 分派**——`copilot_plan_steps.assignee` 可选列 + 执行到 assignee 步骤走 BLOCK-49 spawn_agent/wait_agent + 结果经 update_step 回写 + 无 assignee 零行为变化（回归用例锁定）；③ **P3 Replan**——propose_revision 修订案 + 批准整体替换（done 步骤保留）+ 修订历史可查 + 不可重复应用 + draft 走 update_spec 拒修订；④ **前端**——PlanApprovalCard（spec 折叠 + 步骤表 + 三按钮）+ 修订批准条 + plan 模式开关按钮（`simple-chat.css` 样式 + `useChatStream`/`copilotContext` 接线）+ `planApprovals.ts`（`spec_md→specMd` 映射 + steps 归一）；⑤ **实机发现并修复批准卡字段断层**——REST 返回 snake_case `spec_md` 且不带 steps（hasSpec:false/stepCount:0）→ `routes/ai-plans.js` list 接口 IN 子句批量附 steps + 前端 mapPlanRow 映射，重启 dev Electron 后复验通过；⑥ **门禁**——后端定向 `test/block55-plan-mode.test.mjs` 10/10 + PlanApprovalCard 4/4 + tsc 0 + docs:check + ui:audit:check；⑦ **实机**——`scripts/block55-ui-live.cjs` CDP 15/15 断言全 PASS（场景 A：真实模型 plan 模式起草 draft→批准卡渲染→批准并清上下文执行→assignee 步骤 spawn 子 agent→update_step 回写→汇总回复；场景 B：直构 active 计划 + proposed 修订→修订批准条→批准替换，证据 `acceptance/block-55/ui-live.json` + 截图 ×5）；UI-289 verified。G0 开发期常态 · 不外推 packaged/Provider/GA。


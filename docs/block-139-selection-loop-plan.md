---
capability: artifact-plane-selection-loop
goal: 成果面切片 D 选择回路——viewer 声明 selection schema → 前端选择总线 → composer 结构化注入；「继续分析」由真实实体列表驱动（一次收 G0-RS §22.2 #1 选择无真实入口 / #2 无 mark-to-entity / #3 Agent 上下文缺坐标 三条老账）
acceptance:
  - P0：选择总线与 composer 注入契约测试（单选择真相/结构化 SelectionContext v1 投影/实体坐标注入恒定有界）先红后绿 + 既有 selection 面（artifact-selection/interaction client/ScientificInteractionViewer）零回归 + tsc 0
  - P1：mark-to-entity 组件契约（表格行/图上点带 entityType+idField 落总线）+ 「继续分析」真实实体列表驱动组件契约绿
  - 实机（dev Electron，收口阶段）：viewer 内选中 → composer 可见结构化上下文 → 继续分析携实体列表，断言落 acceptance/block-139/
  - 门禁：closeout 十一门（主代理集成时跑）；theme 契约测试随触碰面
reopen: 切片 C 多 artifact 分屏与切片 E renderer 补课独立立项；D1 rider（空态切换器形态）仍属 BLOCK-138 台账，不在本包
status: active
---

# BLOCK-139 — 选择回路（成果面切片 D）

> 立项：2026-10-03。裁决链：BLOCK-138 收口当日主代理建议「成果面刚打通 pending 信任层，选择回路承接闭环衔接性最好」→ 用户原话「你看看呢 可以的 开冲」（/workflow 指令=发令，当日翻 active P0-LAUNCH）。切片编号按方向文档 §3 勘正：**选择回路=切片 D**（建议表述时口误作 C，以方向文档序列为准）。
> 方向父文档：[`artifact-plane-direction.md`](./artifact-plane-direction.md)（三层契约③回路层：mark-to-entity 契约 + selection→composer 注入；反目标六条全文适用）。
> 实现流水线：dynamic workflow（串行红绿 + world.run 确定性门禁 + 独立评审），**工作流内不提交**；主代理终审后集成台账与提交。
> 阶段：G0 开发期常态 · 不外推 packaged/Provider/GA。

## 1. 一句话目标

把「用户在成果上选了什么」变成 Agent 能直接使用的结构化坐标——选择不再困在 viewer 内部，而是经总线进 composer，「继续分析」由真实实体列表驱动。

## 2. 范围

### P0（回路内核收口，用户低感知）
- **选择总线**：跨 viewer 共享的单选择真相前端 store（自定义 hook + 既有 gewuEvents 事件模式延伸），产出结构化 SelectionContext v1 投影——词汇表镜像 `artifact-selection.ts` 既有契约（后端为权威），**不造第二套词汇**。
- **composer 结构化注入**：ResultAgentComposer / copilotContext 组装链携带选中实体坐标（artifactId/revisionId/entityType/样本≤12/计数≤2000，恒定有界）——Agent 上下文从此有坐标。
- **ScientificInteractionViewer 平迁接总线**：行为不变，选择出口从组件内部状态换到总线（零行为平迁可审计）。

### P1（选择显性化）
- **mark-to-entity 契约**：表格行选中/图上点选带 `entityType + idField` 落总线（§22.2 #2）。
- **「继续分析」真实实体列表驱动**：下游分析入口携带总线实体列表（§22.2 #1）；与 BIO-3 P2「继续分析显式化」（下游工具白名单）互补不重叠——本包做实体列表，白名单留 BIO-3 P2。

## 3. 非范围与红线

- 方向文档 §6 反目标六条全文适用（不引 tldraw / 不推翻 isSingleActiveMode / registry 不做第二真相 / 不预置未来领域 / 不动 IPC 面 / 不是工作台重构）。
- 后端零改动（selection API 既有：saveSelection / selection/current / tool_result_selection_run）。
- 不引 zustand（项目纪律：useState + 自定义 hooks）。
- 不做多 artifact 分屏（切片 C 另立）；pending adopt 审阅流 UI 属 RS 审阅域，不在本包。

## 4. 依赖

零新依赖。前端既有资产：`artifact-selection.ts`（474 行契约镜像）、`result-studio-interaction-client.ts`、`events.ts`（gewu:selection-quote 先例）、`ResultAgentComposer.tsx`。

## 5. 设计裁决

- **D1 总线形态**：lib 层自定义 store hook（useState + gewuEvents 广播），单选择真相=「当前活跃 artifact 的当前选择」；切换 artifact 即换选择上下文。
- **D2 注入通道**：走既有 copilotContext 组装链扩展，不另开注入通道（防第二注入真相）。
- **D3 有界不变量**：沿用后端契约 MAX_PERSISTED_ENTITY_IDS=2000 / Agent 样本 12，前端不得放宽。

## 6. 验收

frontmatter acceptance 全文有效。定向契约测试先红后绿（HK-01）；既有 RS selection 面 474+259 行模块零回归；实机三断言（选中→composer 上下文→继续分析携列表）留收口阶段取证。

## 7. 完成语义与环境

- P0/P1 各自独立可收口，P0 先行。
- 环境：纯代码 + 组件测试，零 dev 栈依赖；实机走查留收口（主代理组织）。
- 实现流水线为 dynamic workflow；workflow 内不 commit；门禁红不过夜（5 轮修复上限，如实上报）。

---
capability: artifact-plane-selection-loop
goal: 成果面切片 D 选择回路——viewer 声明 selection schema → 前端选择总线 → composer 结构化注入；「继续分析」由真实实体列表驱动（一次收 G0-RS §22.2 #1 选择无真实入口 / #2 无 mark-to-entity / #3 Agent 上下文缺坐标 三条老账）
acceptance:
  - P0：选择总线与 composer 注入契约测试（单选择真相/结构化 SelectionContext v1 投影/实体坐标注入恒定有界）先红后绿 + 既有 selection 面（artifact-selection/interaction client/ScientificInteractionViewer）零回归 + tsc 0
  - P1：mark-to-entity 组件契约（表格行/图上点带 entityType+idField 落总线）+ 「继续分析」真实实体列表驱动组件契约绿
  - 实机（dev Electron，收口阶段）：viewer 内选中 → composer 可见结构化上下文 → 继续分析携实体列表，断言落 acceptance/block-139/
  - 门禁：closeout 十一门（主代理集成时跑）；theme 契约测试随触碰面
reopen: 切片 C 多 artifact 分屏与切片 E renderer 补课独立立项；D1 rider（空态切换器形态）仍属 BLOCK-138 台账，不在本包
status: completed
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

## 8. P0/P1 实现落账（2026-10-04 · 实现完成，实机走查待）

- **P0 ✓**：selectionBus.ts（D1 单选择真相+换上下文清选+useSyncExternalStore+事件广播）+ composer 注入（copilotActiveArtifact 总线 fallback，compatibility 同口径）+ viewer 总线模式平迁（回调为主、总线镜像；生产绑定执行点=useArtifactInteractionSelection）。红门 3 文件先证红→7 文件 37 用例绿。
- **P1 ✓**：mark-to-entity（总线出口/镜像均带 idField 词汇）+「继续分析」实体驱动 prompt（如实有界三态：样本/真实规模/selectionId 通道）。
- **评审处置（独立评审员，新鲜上下文七维度）**：2 P1 真修复（生产接线+死负载/虚假声明）；P2 注入归属校验→**R-5 rider**（ActiveArtifact 缺 artifactId，竞窗一帧+rebind 清选自愈，类型涟漪留后续）；Minor#5 已修（entityIdsTruncated+MAX_AGENT_SAMPLE_IDS 导出）；Minor#6 已修（optionsRef 撤除，测试 rerender 显式传参）；Minor#7 部分补强（样本列字面量断言）；Minor#4→**R-6 rider**（matrix 行选 idField 潜伏错位，生产未触达）。
- **门禁**：quality:types 0；touch 面 eslint 错误清零（7 处 no-unsafe-return/4 断言/1 require-await 逐处修+类型化 vi.fn）后 `--suppress-all` 刷新（6 处 react-hooks/refs render 同步=有意形态，代码内理由+BK-06 先例入库）；code-size 指纹随批重打；knip 237 键 PASS；test:changed P6 门 accepted-red（集成提交刷新转绿，BLOCK-107/138 先例）。
- **流水线波折如实**：provider 流超时停滞 3h45m（token 零增长），经用户授权 TaskStop+ResumeWorkflowRun 恢复后一次跑完。
- **收口剩件**：实机三断言（acceptance/block-139/）+ closeout。

## 收口（2026-10-04）

- **P0 ✓**：selectionBus 单选择真相+composer 结构化注入（D2 既有组装链扩展），契约先红后绿；**P1 ✓**：mark-to-entity+继续分析实体驱动；独立评审 2 P1 真修（生产接线/死负载虚假声明）。集成提交 b857f467。
- **实机走查（dwfrun-332b6002，acceptance/block-139/selection-walk.json+三截图）**：S2 ✓ confirmed（继续分析 prompt 逐字携实体清单+selectionId）；S3 ✓ confirmed（总线态 entityType/idField/ids，生产链 useArtifactInteractionSelection.ts:233-235）；**S1 refuted 抓真**=被弃 prop 通道的 stale 透传给 composer → useResultStudioEditContext 双通道合成修复（compatibility 跟随实际注入通道；总线 fresh 胜 prop stale；总线 stale 仍不注入），双通道契约 4/4 红→绿。S1 画面复核并入用户过目。
- **closeout 十一门 PASS**（6569f692 后复跑；knip 238→235 棘轮自指示下调：S1 修复重构致 artifact-selection 三类型自然收缩；test:changed 首跑撞复走 run 迟到中间文件为一次性竞态，复跑 0.8s 绿）。P6 绑定门随集成提交刷新。
- **R2 独立复走（2026-10-05，本会话 dwfrun-53306943，与 R1 并行双流交叉验证）**：T1/T2/T3 全过+换眼复核 3/3 confirmed（证据=acceptance/block-139/walkthrough-r2.json+selection-r2-t1/t2/t3.png；R1 原件从 c1302bff 恢复保留，R2 覆写已各归各位）。**抓真 T2 第二 facet 修复**（与 S1 的 compatibility 透传互补）：validator fail-closed 插件（deseq2）交互 manifest 缺 revisionId 与 F1 chain revision 口径分裂→选择落库 revision_id 为空、envelope 恒 stale/revision_changed；修=fetchResultStudioContext 透出 envelope 重投影 resolvedRevision（坐标缺一即 null 绝不伪造）+useArtifactInteractionSelection 三重护栏补锚（仅缺 revisionId 且 selectionDurable 触发/artifactId 核对一致才采纳/投影不可得维持原样）+restore 链口径同步+客户端契约测试。复走实证翻转：总线镜像 revisionId=null→rev_98203ee6…、SQLite result_selection_contexts.revision_id 落值、context-envelope stale/revision_changed/usableByAgent=false→compatible/same_revision/true、composer 告警消失（selection-r2-t3.png 同帧保留修复前旧应答对照）。修复 diff 主代理终审零 P1；换眼 concerns=探针断言按 ask 约束未复跑+1 处截图低分辨率误读，无实质。
- **剩件**：UI-463 用户真窗过目翻 verified（取证≠验收）；riders R-5/R-6——2026-10-05 迁入 BLOCK-141 清尾批执行（两账注记）；pending adopt 流属 RS 审阅域未走查。G0 开发期常态 · 不外推 packaged/Provider/GA。

---
capability: artifact-plane
goal: 把 Result Studio 从「生信结果查看器」升级为「领域无关的 Agent 成果操作面（artifact plane）」——对象层/渲染层/回路层三层契约；生信是第一个入驻垂直域，通用 agent 与未来领域按「工具包+skill 包+viewer 包」配方零内核改动入驻
acceptance:
  - 方向级验收=各切片以独立工作包立项后按其 plan 验收为准（本文件不承载运行时证据）
  - 契约不变量判据：任何新领域入驻不改内核代码（以切片 A 内核与切片 E renderer 补课双向验证）
reopen: 用户裁决启动任一切片时按立项检查单开包；方向整体重估条件=用户对「通用 agent 平台+垂直领域」双视角定位改判，或切片 A/B 落地后内核契约被证伪
status: reference
---

# 成果面（Artifact Plane）方向文档

> 立项：2026-10-01。用户裁决原话：「很不错 是否可以有更明确的方向呢 毕竟我们的项目是通用agent和垂直领域的生信agent或者后期延伸为其它领域的agent 我希望这次关于这些方面的应用和扩展有灵活性 同时也确实有效」→ 方向提案（三层契约+切片序列）→「可以 接下来你就开始吧 定下来 plan完全定之后 我们再开始干活」。
> 溯源：同日 canvas/agent 工作台开源调研（ChatGPT Canvas/Open Canvas/tldraw computer/Flowise·Langflow·AutoGen Studio/bolt.diy/Galaxy/JupyterLab rendermime）+ Result Studio 现状只读探查（G0-RS plan §22.2 十缺口、§P4R.2 七用户问题在案）。
> 本文件=方向与分层不变量的 canonical 文档；**不承载运行时证据，不预设推进序**——切片启动逐个过立项检查单，全局序在 `pending-work-backlog.md`。
> 阶段：G0 开发期常态 · 不外推 packaged/Provider/GA。

## 1. 一句话定位与命名

**成果面（artifact plane）= Agent 产出的可操作一等对象的容器与操作面。**「成果（artifact）」在此统称 Agent 工具/分析/编辑产出；既有词汇「结果（result）」「产物（tool job output）」是它在具体语境下的子术语，不另立第二套真相。命名裁决（2026-10-01）：用户委托主 Agent 定名，定「成果面」，英文 capability 命名空间 `artifact-plane`。

三句判据（用户要求「灵活 + 有效」的落实）：

1. **内核领域无关**：画布与对象模型不认识 DESeq2/volcano，只认识 artifact（kind/血缘/版本/结构化数据指针）。
2. **垂直域以配方入驻**：一个垂直域 = 工具包（插件/MCP）+ skill 包（`resources/skills/` 既有契约）+ viewer 包（本方向新开的扩展位）；领域知识永远住在边缘。
3. **每个切片对着已立案痛点**：G0-RS §22.2 缺口、§P4R.2 用户问题、G0-BIO §2 差距地图——不造无锚点的画布。

## 2. 三层契约（不变量）

| 层 | 职责 | 已有资产（≈完成度） | 目标态 |
| --- | --- | --- | --- |
| ① 对象层 | 领域无关 artifact 模型：id、kind、结构化数据指针、血缘边、revision | result-manifest kinds（report/plot/table/text/data/file）、`result_workflow_graphs`、artifact_revisions（~80%） | 「生信结果」身份从模型语义中拿掉——它是某 producer 的 artifact，不是一等概念 |
| ② 渲染层 | kind → viewer 的**注册表**；viewer 自声明能力（可选/可比/可导出） | `resultSurface.ts` adapter 解析（report/image/table/json/text/binary 六类，~60%，switch 非 registry） | 固化为可插拔注册表；`ScientificInteractionViewer` 降格为第一个垂直 viewer 包；插件清单预留声明 kind+viewer 的类型位（接线不在本方向首包范围） |
| ③ 回路层 | 选择总线 + 画布布局：画布选中以结构化上下文进 composer；分屏/钉住/DAG 都是对象层之上的**视图** | 选择原语（viewer 内）、`ResultAgentComposer`、`LineageStrip`（~40%） | mark-to-entity 契约 + selection→composer 注入；DAG 画布化；多 artifact 并排 |

分层原型参照：JupyterLab rendermime（MIME→渲染器注册表）、Vercel AI SDK 生成式 UI（工具 schema→组件）、Galaxy workflow editor（一套画布跑任意工具节点）——共同教训是**灵活性来自注册表+领域盲容器，而非容器里塞领域知识**。

## 3. 切片序列（每片独立立项、独立收口）

| 切片 | 内容 | 有效性锚点（在案账目） | 建议包型 |
| --- | --- | --- | --- |
| **A 内核收口** | artifact 模型 + viewer registry 固化为稳定前端内部契约，既有 adapter 平迁；插件清单预留 viewer 声明类型位 | 用户零感知承重梁；G0-BIO §2.1「静态 CSV 仅前 24 行」等渲染面问题的统一解耦点 | BLOCK 首包（P0） |
| **B 血缘 DAG 画布** | React Flow（@xyflow/react，MIT）只读投影 `result_workflow_graphs`，节点点击打开 artifact | G0-BIO §2.3「血缘图已入库、前端零消费、数据侧零缺口」；复用 UI-456 已建 GET /lineage 端点与 listProjectWorkflowGraphs | BLOCK 首包（P1） |
| **C 多 artifact 分屏** | result 模式内左右分屏/钉住两 artifact；compare 从结构化差异报告升级为并排+联动选择 | §22.2「单焦点」+§P4R.2 导航层级失配；BIO-7 池「任意两 run 对比」的视觉前提 | 后续包 |
| **D 选择回路** | viewer 声明 selection schema → 总线 → composer 结构化注入；「继续分析」由真实实体列表驱动 | 一次收 §22.2 三条老账（#1 选择无真实入口 / #2 无 mark-to-entity / #3 Agent 上下文缺坐标）；与 BIO-3 P2「继续分析显式化」互补 | 后续包 |
| **E renderer 补课** | md 富渲染 / xlsx / pdf viewer | 纯注册表新增项，同时是切片 A 扩展性的验证用例（加 viewer 不动容器一行代码） | UI 批~轻量包 |

排序理由：A 便宜且给后面所有切片承重；B 是最便宜的可见升级且数据端零缺口；C 打体感大头；D 是 Agent 工作台灵魂；E 验证扩展性。**实际序由用户在 backlog 逐项裁决，本文件不预设。**

## 4. 与两 Goal 线及既有资产的关系（防重复开发）

- **G0-BIO**：BIO-1（信息密度）已完成、BIO-2 交互上限在案——均为渲染层/viewer 能力，直接被本方向继承不重做；**BIO-3 出口判据已由 UI-455/456 条带形态满足，DAG 形态升级归属本系列首包 BLOCK-138**（在 `g0-bio-delivery-goal-plan.md` §3 同步注记）；BIO-3 P2「继续分析显式化」与切片 D 互补不重叠（前者=selection 下游工具白名单，后者=选择上下文进 composer）；BIO-7 池「任意两 run 对比」的视觉形态依赖切片 C。
- **G0-PLATFORM**：PL-4b 结果治理（retention/批量管理）与 PL-5a result:* 数据层退役已完成——对象层后端存储面已收敛，本方向纯前端契约+视图工作，不动后端存储模型。
- **G0-RS**：§22.2 缺口 #1/#2/#3 与 §P4R.2「结果打开慢」是切片 C/D 的验收锚点；RS 整包 capability 维持 implemented_unverified/experimental 常态，本方向不触发其重开。
- **BLOCK-121/BIO-4**：2026-09-29 bulk 主链六件解冻已实机跑通——切片 B 的 DAG 有真实跨 Job 链数据可用，不再依赖「随 BIO-4 产生」的等待条件。

## 5. 通用 agent 与未来领域的入驻故事

- **通用编码 agent**：审阅 diff、测试结果、终端输出在概念上即 artifact。成果面成熟后可**增量**挂入（审阅面板零强制改造）；入驻判据=它们开始「说 artifact 语言」（kind+血缘+选择 schema），不要求重构现有工作台。
- **未来领域**（化学分子/GIS/影像等）：入驻=viewer 包+工具包+skill 包三件配方；画布、血缘、选择回路、composer 全复用。**判据：内核零改动**——若某领域入驻需要动内核，即本方向设计证伪，触发 reopen。

## 6. 反目标（钉死，防走形）

1. 不引 tldraw（SDK 生产需商业 license key + 体积重）；不做自由手绘白板——@xyflow/react + 自定义节点覆盖全部场景。
2. 不推翻 `isSingleActiveMode` 容器不变量——分屏是 result 模式**内部**的组合，不是多模式并行。
3. viewer registry 不做第二真相——manifest kinds 仍是唯一权威源，registry 只是渲染映射。
4. 不为未来领域预置一行代码——扩展位=类型与声明格式，实现在入驻时。
5. 不动 IPC 面（RS 走 loopback HTTP 现状不变）；后端仅在既有 result-studio 路由域内按需扩端点。
6. 不把本方向写成「agent OS/工作台重构」——它是结果面/成果面的分层与扩展性收敛，聊天与工作台主线各自按其 canonical plan 推进。

## 7. 开源参考基线（设计参照，非依赖）

| 参照 | 借鉴点 | 现状警示 |
| --- | --- | --- |
| Open Canvas（langchain-ai，MIT） | artifact 版本化+quick actions+selection-aware chat | 2026-02-26 已归档，只作代码参考 |
| tldraw computer | 画布即编程环境的激进形态 | tldraw SDK 生产授权+水印风险，明确不引 |
| Flowise/Langflow/AutoGen Studio | 节点画布 agent 编排（React Flow 事实标准） | 参照其画布交互，不引产品 |
| bolt.diy（MIT，有 Electron 构建） | diff+版本回滚+预览并排的工作台 UX | WebContainers 商用另需授权，只参照 UX |
| Galaxy workflow editor | 生信节点画布+版本化发布的老牌原型 | 参照其「工具=节点、数据集=边」模型 |
| JupyterLab rendermime（Lumino） | MIME→渲染器注册表+多面板 dock | 注册表模式直接借鉴 |

## 8. 切片登记现状

首包 **BLOCK-138-ARTIFACT-PLANE-KERNEL**（切片 A+B，plan=`block-138-artifact-plane-kernel-plan.md`）2026-10-01 立项，同日用户裁决「按照计划有序推进」发令翻 **active（P0-LAUNCH）**。切片 C/D/E 未立项，启动均需用户裁决+立项检查单。**更新（2026-10-03）**：切片 D 选择回路立项为 **BLOCK-139-SELECTION-LOOP**（用户发令「你看看呢 可以的 开冲」当日 active P0-LAUNCH；plan=`block-139-selection-loop-plan.md`；切片 C/E 仍未立项）。

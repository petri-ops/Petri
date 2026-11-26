# 右侧栏面板系统审计（owner msg_26327e7a3def）

> 只读核码为准（台账滞后教训）；未改任何面板功能、未改会话数据。
> 真源：`frontend/src/lib/workSurface/registry.ts` CORE_WORK_SURFACES（15 个 core）+ `useWorkspaceTitleBar.ts` host 项（2 个）+ `RightPanel.tsx` 渲染分支 + 各面板组件源码（Explore 逐面板核读）。

## §0 两个必须先纠正的事实

1. **「16 个面板」口径**：owner 截图里的终端/侧聊**不是右栏 tab**——终端是底部面板（`project-workspace.tsx:1207` BottomTerminal），侧聊是原生独立窗口（`openSideChatWindow`）。右栏本身是 **15 个 core surface**（home 工作台 + 14 个）；工具菜单里再加 2 个 host 项共 17 入口。聊天 tab 已在 UI-362 退役（RightPanel.tsx:301-302）。
2. **「默认收起」已实现**：`createWorkSurfaceState()` 初始 `tabs=[]`（model.ts:11-13），面板全部按需打开、localStorage 持久化用户实际打开过的 tab；不会一进工作区就同时显示 16 个面板。owner 的"内容很多"主要是工具菜单 17 入口平铺造成的感知负担。

**使用数据诚实边界**：本地 telemetry（funnel_events 534 条）只有 project_created/app_started/first_job_succeeded/report_generated 四类项目级事件，**无面板打开次数埋点**；唯一可用行为数据是 localStorage 的最近面板（writeLastPanel/readLastPanel）。因此本次判级基于功能真源+场景+重叠度+维护成本，**不编造使用频率**。建议（待裁决）：补面板打开事件埋点后再做数据驱动去留。

## §1 逐面板分析表（功能真源 / 场景 / 重叠 / 维护成本）

| # | 面板(id) | 真源（组件/行） | 实际功能 | 场景 | 重叠/成本 |
|---|---|---|---|---|---|
|1|工作台(home)|EmptyResult.tsx 149|导航磁贴+审阅未读徽章+最近面板|首次进入/找入口|非数据面；不可关闭（合理）|
|2|结果(results)|ResultsSurface.tsx 284|Result Studio 唯一宿主：画布/上下文/schema 编辑/修订/3D 预览门控|看产物|独占；产品身份锚点|
|3|文件(files)|RightFileTree.tsx 1079|工作区文件树+多 tab/拖拽重排/重命名/脏位图|浏览编辑工作区|独占；最大维护面|
|4|生成文件(generated)|GeneratedFilesSurface.tsx 187|会话 file-changes 投影 agent 写入文件清单|审计 agent 产物|与 files 部分重叠（子集视图）；轻量|
|5|3D 模型(model3d)|Model3DSurface.tsx 921|能力探测+SceneSpec 解析+GLB/GLTF 预览|仅 3D 场景|独占但低频；重组件|
|6|浏览器(browser)|BrowserPanel.tsx 401|内嵌 WebView+URL 校验+前进后退|看 HTML 报告/网页|独占但低频|
|7|分析(analyze)|AnalysisLaunchPanel.tsx 303|按已装插件工具目录分组、配参启动分析|领域包/工具调用|与会话工具调用入口部分重叠；G1 领域包方向关键|
|8|审阅(review)|ReviewMode.tsx 1429|git 工作树 diff 审阅+接受/拒绝+内嵌提交|改代码后核查|独占；治理透明身份；最大维护面|
|9|指挥中心(jobs)|CommandCenterJobsWall.tsx 528|项目作业瓦片墙+轮询+取消+下钻结果|看所有 job|与 workflow 部分重叠（运行/任务列表）|
|10|工作流(workflow)|WorkflowRunsPanel.tsx 239|工作流运行列表+日志+取消/续跑|工作流场景|与 jobs 高重叠；轻量|
|11|轨迹(trace)|TraceSurface.tsx 388|会话事件级执行轨迹+失败镜头分组+互链 I/O|调试/审计|与 io 互补（事件级 vs 模型调用级）|
|12|模型 I/O(io)|LlmTranscriptViewer.tsx 266|会话模型调用列表（模型/轮次/tokens/错误）+详情|成本/错误/可审计|独占；证据自证身份锚点|
|13|智能体(agent)|AgentRunPanel.tsx 513|子 agent SSE 实时详情+中断/留言/续派|仅多 agent 场景|独占但低频|
|14|计划(plan)|PlanSurface.tsx 312|计划列表+proposed/applied 修订+审批|plan 模式|独占；治理身份|
|15|证据(evidence)|EvidenceSurface.tsx 172|聚合 job/artifact/轨迹为可信状态+跳转|快速取证|与 results/trace/io 聚合重叠；轻量但身份锚点|
|host|终端(terminal)|BottomTerminal.tsx 194（底部面板）|多 tab xterm+node-pty（上限4）|命令行|非右栏；独占|
|host|侧聊(side-chat)|openSideChatWindow（独立窗）|复用会话/run 的原生侧聊窗|并行对话|非右栏；主窗不感知开关态|

## §2 分级建议（判定标准写明）

**判定标准**（四条，按优先级）：
- S1 独占性：是否无其他面板能完成同一任务？
- S2 身份性：是否承载产品身份（本地主权/治理透明/证据自证）或 G1 方向？
- S3 场景频度：是否每次会话都用（高频），还是仅特定场景（低频）？
- S4 重叠度：与另一面板功能重叠是否 >60% 且场景可统一表达？

| 判级 | 面板 | 依据（对应标准） |
|---|---|---|
|**保留（核心）**|home / results / files / analyze / review / jobs / trace / io / plan / evidence / terminal / side-chat|home=导航入口(S1)；results/files/review/io/plan 承载身份(S2+S1)；analyze=领域包方向(S2)；jobs/trace/evidence=可审计聚合(S1+S2)；terminal/side-chat 非右栏且独占(S1)|
|**默认收起（低频独占）**|model3d / browser / agent|S1 独占但 S3 低频——**当前已是按需打开**（createWorkSurfaceState 空 tabs），不需要改行为；仅在菜单分组里归入「辅助」组降低感知负担|
|**合并候选（需 owner 裁决）**|generated → files 的筛选视图（S4：会话写入文件是 files 子集）；workflow → jobs（S4：运行列表+日志+取消高度重叠）|见 §3 裁决表|
|**移除候选**|**无**|15 个 core 均有真实渲染分支与独占功能，无空壳/无被完全替代项；不因低频判为垃圾|

**整体 IA 建议**：当前 17 入口平铺是感知负担主因。建议工具菜单按四组呈现（组内保持现有 order 顺序）：①主工作区 results/files/generated/model3d/browser ②分析治理 analyze/review/jobs/workflow ③审计证据 trace/io/agent/plan/evidence ④环境入口 terminal/side-chat。home 不进菜单（常驻入口）。**这是纯呈现分组、不改任何面板去留与功能**，属无争议项已落地（见 §4）。

## §3 owner 裁决表（去留属产品语义，拍板后才动）

| # | 裁决项 | 单一建议 | 理由（证据） | 影响面 |
|---|---|---|---|---|
|1|generated 是否并入 files 筛选视图？|**建议保留独立面板**|虽是 files 子集（S4 重叠），但"会话写入文件清单"是 agent 行为审计入口，独立视图有取证价值（187 行轻量、维护成本低）|若并入，需给 files 加"仅本次会话"筛选+入口记忆迁移|
|2|workflow 是否并入 jobs？|**建议合并**|同为"运行/任务列表+日志+取消/续跑"（S4>60%），用户区分成本高；jobs 528 行可承载 workflow 239 行的能力|合并后 workflow 入口撤除、工作流运行仍可在 jobs 查看；需 owner 确认无独立入口依赖|
|3|evidence 是否并入 results？|**建议保留独立面板**|虽与 trace/io 聚合重叠（S4），但"证据自证"是产品身份锚点（S2），独立入口比藏在结果里更符合定位|无改动；若 owner 要精简，可作为第二合并候选|
|4|是否补面板打开次数埋点？|**建议补**|当前无使用数据、判级靠功能真源；补埋点后可用数据复核本次裁决|新增 funnel_events 事件（产品语义+隐私边界，需 owner 拍板）|

## §4 已落地（无争议项）

- 工具菜单四项分组：纯呈现改动（组标题+分隔），不改面板注册/去留/功能/顺序语义；HK-01 红绿先行验证分组完整性与入口不丢。
- 说明：§0 已确认"默认收起"本就实现，无需改初始值；不为"看起来少"而预先关闭用户已打开的 tab。

## §5 边界

- 只读分析为主；本次不改任何面板功能、不改去留、不改会话数据。
- owner 拍 §3 裁决前不合并/不移除任何面板；证据不足处（使用频率）如实标注不编造。

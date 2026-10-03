---
capability: artifact-plane-kernel
goal: 成果面首包两件——切片A 内核收口（artifact 模型+viewer registry 固化为前端内部契约，六类 adapter 零行为变化平迁）+ 切片B 血缘 DAG 画布（@xyflow/react 只读投影 result_workflow_graphs，节点点击打开 artifact）
acceptance:
  - P0：viewer-registry 契约测试（kind→viewer 全表解析+能力声明+未知 kind 兜底）+ 既有 RS 面测试零回归 + tsc 0 + eslint 0 error
  - P1：LineageGraph 组件测试（投影纯函数+渲染+节点交互）+ theme 门禁绿 + test:changed 定向 0 红
  - 实机（dev Electron）：真实跨 Job 链（BIO-4 解冻后 bulk 主链）DAG 渲染 + 节点点击打开 artifact + 条带/DAG 形态切换，断言落 acceptance/block-138/
  - code-size 棘轮登记 @xyflow/react 增量 + knip 棘轮新导出登记
reopen: 条带（LineageStrip）去留在 P1 实机后按体感裁决（D1）
status: completed
---

# BLOCK-138 — 成果面内核 + 血缘 DAG 画布（成果面系列首包）

> 立项：2026-10-01（planned 排队，非 active——唯一 active 槽位现被 BLOCK-128 占用，且用户流程约定「plan完全定之后 我们再开始干活」）。
> 裁决链：2026-10-01 用户原话①「很不错…毕竟我们的项目是通用agent和垂直领域的生信agent或者后期延伸为其它领域的agent 我希望这次关于这些方面的应用和扩展有灵活性 同时也确实有效」（方向要求）→②「可以 接下来你就开始吧 定下来 plan完全定之后 我们再开始干活」（立项放行，实现待发令）。
> 方向父文档：[`artifact-plane-direction.md`](./artifact-plane-direction.md)（切片 A-E 序列、三层契约不变量、反目标）。中文名「成果面」为主 Agent 受托定名（用户未指定）。
> 启动：2026-10-01 用户裁决「按照计划有序推进」（/workflow 指令）=发令，当日翻 active（P0-LAUNCH）；实现由 dynamic workflow 流水线承载（串行红绿+确定性门禁+独立评审），主代理终审后集成台账与提交，工作流内不提交。
> 阶段：G0 开发期常态 · 不外推 packaged/Provider/GA。

## 1. 一句话目标

Result Studio 的渲染面从「写死的 switch + 单血缘条带」收敛为「可插拔 viewer 注册表 + 可视化 DAG」——领域知识开始从容器里搬出去，血缘从水平条带升级为可点击的画布投影。

## 2. 范围

**P0（切片 A·内核收口，用户零感知）**

1. viewer registry 契约：新建 `frontend/src/components/result-studio/`（或 `frontend/src/lib/`，实现时按文件面归属定）注册表模块——kind→viewer 组件解析、viewer 能力声明位（canSelect/canCompare/canExport 占位）、未知 kind 兜底 binary 路径。
2. 既有六类 adapter（report/image/table/json/text/binary）零行为平迁：`resultSurface.ts` 的解析逻辑收编进 registry，行为等价以现有 RS 面测试为基线（BLOCK-92 拆前基线拆后对账先例）。
3. 插件清单 viewer 声明**类型位**预留（仅类型/注释锚点，不做插件侧接线）。

**P1（切片 B·血缘 DAG 画布）**

1. `LineageGraph` 组件：@xyflow/react 只读 DAG，数据源=UI-456 已建 GET /lineage 端点与 listProjectWorkflowGraphs 仓库方法（零后端新面；若投影字段不足，仅在 core 侧 result-studio 路由域内扩字段并重启后端验证）。
2. 节点=artifact/job，点击节点→按既有 Fast Result Path 打开对应 artifact；与 `LineageStrip` 并存提供形态切换（D1 去留后置）。
3. 真实数据：BIO-4 解冻后 bulk 主链（validator→QC→deseq2→…）已实机跑通（2026-09-29），跨 Job 链数据可现场产生。

## 3. 非范围（红线）

- 切片 C（多 artifact 分屏）/ D（selection→composer 回路）/ E（md/xlsx/pdf renderer）——后续包，不在本包夹带。
- 不做编辑型 DAG（节点改参重跑走既有 Revision/ChangeSet 面）。
- 不推翻 `isSingleActiveMode`；DAG 是 result 模式内的视图形态。
- 不做插件侧 viewer 接线运行时（只留类型位）。
- 不动通用编码 agent 工作台（审阅/终端/文件树）任何文件面。
- 不引 tldraw/Excalidraw/Konva；不新增后端依赖。

## 4. 依赖（DEPENDENCY-CHANGE-CHECKLIST）

**@xyflow/react（React Flow v12）——本包唯一新依赖，前端 dependencies。**

- 四问：①替代方案=tldraw（生产授权风险，拒）/自绘 SVG DAG（维护成本高，拒）/d3-dag（无 React 绑定与交互层，拒）——React Flow 为节点图事实标准（Flowise/Langflow/AutoGen Studio 同款底座）；②许可证 MIT，维护活跃（v12 线持续更新），无传递膨胀（零 runtime 依赖）；③影响面=前端 bundle 约 +100-150KB gz，渲染进程 only，无 native/ABI，无主进程/打包影响；④退出成本=封装边界单一目录（LineageGraph 组件+投影纯函数），库不散落直引，架构规则可后续按需登记 pathNot。
- 裁决留痕：2026-10-01 用户对方向提案放行（原话②），提案中明确「血缘 DAG 画布 React Flow（MIT）新依赖 1 个 MIT 库」。
- 版本钉扎：`^12.12.0`（当前 latest 实测），登记 frontend/package.json。
- 收口笔录如实写「1 新依赖」。

## 5. 设计裁决 D1-D3

| # | 事项 | 裁决 |
| --- | --- | --- |
| D1 | LineageStrip 条带去留 | 本包默认**并存+切换**；P1 实机后按体感定条带退役或降级（产品语义，届时单独问用户） |
| D2 | registry 契约落点 | 前端内部契约为准（P0 不做跨进程契约）；插件声明位=类型+manifest 注释锚点，接线后续包 |
| D3 | DAG 布局方向 | 自左向右（工具链时间序），实现时可按真实链形态调整，非裁决级 |

## 6. 验收（收口对账清单）

- 契约测试：viewer-registry（P0）+ LineageGraph 投影/渲染/交互（P1）——红绿先行（HK-01 姿势）。
- 门禁：tsc 0 + eslint 0 error + theme-token-contract 4/4（P1 若新增样式走 token）+ test:changed 定向 0 红 + code-size 棘轮登记 + knip 棘轮登记。
- 实机走查（dev Electron，dev 栈按 dev-infra 姿势拉起）：DAG 渲染/节点点击打开/形态切换三断言，证据落 `acceptance/block-138/`。
- 台账：实现同提交登记 UI 台账（Result Studio 面条目 UI-460+，实现时定号）。

## 7. 完成语义、节奏与环境

- 完成语义：两切片各自独立可收口；P0 先行（即使 P1 遇阻，registry 收口本身成立）。
- 节奏：预计两刀（P0 一刀/P1 一刀）或单会话连做，开工时按状态定。
- 环境：fnm Node 24；dev 栈（Vite :3000 + Electron + core 后端）按 dev-infra 脚本头注姿势；后端若扩 lineage 投影字段须重启后端再实机。
- 排队现状：2026-10-01 用户裁决「按照计划有序推进」启动本包（P0-LAUNCH）；BLOCK-128（PL-1）active 的实机三件 rider 属零代码面验收，与本包文件面（frontend result-studio 域 + frontend/package.json）零触碰并行。

## 8. P0/P1 实现落账（2026-10-01 · 实现完成，实机走查待）

- **P0 ✓**：viewerRegistry.ts（注册表+能力位+兜底，契约 18/18）+ resultSurface.ts 薄委托零行为平迁（RS 面 21 文件/195 测试基线绿）。先红证据在被接替首 run（dwfrun-2acf08eb）p0-red 记录。
- **P1 ✓**：@xyflow/react ^12.12.0 + lineageProjection.ts + LineageGraph.tsx/.module.css + LineageViewSwitch.tsx/.module.css + 组件/投影测试；挂 ResultArtifactShell result 模式（LineageStrip 位）。定向回归 36 文件/313 测试绿（含 theme 契约）。
- **门禁**：types 0/lint 0 error/code-size 棘轮重打（ResultArtifactShell 1213 指纹）/knip 238 键/test:changed=P6 绑定源门 accepted-red（fail-closed 设计，集成提交刷新后转绿——BLOCK-107 先例）。
- **评审处置**：0 P1；P2=LineageViewSwitch 假覆盖→补组件测试 3/3+impact-map tests 补登（已修）；Minor①knip -1 键（branch-db getDatabasePath）与 probe 死 require 清理=棘轮自指示收缩与死码清理，reason 本节留痕；**Minor②=切换器空态常驻**（无链/单节点时按钮组可见）——D1 未裁决形态，**登记 R-1 rider**（修法=lineage 有无上提 switch 层或回调通知，或空态隐藏切换器；属后续加映）；**Minor③=plan 验收项「code-size 棘轮登记 @xyflow/react 增量」如实降格**——code-size 台账机制只管行数/指纹，不追踪依赖 bundle 体积，本次仅 ResultArtifactShell 指纹重打；bundle 增量 ~100-150KB gz 未被任何门禁记录（**R-2**：若需真登记应另立 bundle 体积基线，属后续包）。
- **收口剩件 ✓（2026-10-03 全清）**：实机走查三断言=R2 复走全过（walkthrough-v2.json+三截图，acceptance/block-138/）；UI-460 用户真窗过目认可翻 verified（主代理会话原话「可以了 没什么问题」）→ **本包 completed**。R-4 已随 F1 修复关闭（§9）；R-1/R-2 riders 在册属后续加映。

- **R-4（2026-10-02 实机走查抓真，BIO-3 域 finding）**：血缘边硬依赖 ArtifactRevision 持久化（result-workflow-graph.js:305-313），chat/agent 分析链产物不产生 Revision → 散跑无边/plan/bind 生效不解锁/selection 拒开三条路径全断；实机三断言 reopen=F1 修复（方向待用户裁决：产物 Revision 化 vs 投影兼容 job-artifact truth）。证据=acceptance/block-138/chain-* + AUDIT-LOG 🟡 行。→ **已关闭（2026-10-03）**：用户裁决方向 1 并落地（§9，ea765eea+d3ae13a3，主代理终审 518a07fd），finding 随 UI-460 verified 销号。

## 9. 加映：F1 修复——链形成点注册 pending 信任层（2026-10-03，实现启动）

> 用户裁决「按照你的建议来推进 最终是解决这个问题」（/workflow 指令）=方向 1 放行（勘察结论见上轮：F1 根因=Revision 只在 RS changeset 生命周期创建（insertRevision 强制 changeSetId，result-studio-repository.js:139-175），chat/agent 链产物从不进入 → validateLineage（result-workflow-graph.js:291-340）验不过 → 无边；validateLineage 仅要求 revision 行存在（getRevision），pending 未 adopt 即可解锁血缘）。

- **范围**：plan/bind 与 selection 两条链形成点接入信任层注册——job 产物经 result-changeset-service 既有管线注册为 **pending ChangeSet+preview revisions**（幂等；**绝不自动 adopt**，adopt 仍是人的审阅动作）；使下游 step 解锁、血缘边可形成。契约测试红绿先行。
- **非范围**：不改 adopt 语义/审阅流；不做启发式无验证边（方向 2 拒绝）；不动 RS-P7 deferred 域其他面；前端零改动。
- **验收**：①契约测试红绿（bind→ready→2 节点 1 边 graph；幂等；零 adopt）；②门禁五门（test:changed P6 绑定门 accepted-red 沿用既定模式，集成提交刷新）；③链产验证（chat plan/bind 链 /lineage chain ≥2，后端重启加载修复后）；④实机走查三断言（补 UI-460 剩件，acceptance/block-138/）。
- **已知语义后果（用户知情）**：agent 链会在审阅队列产生 pending ChangeSet 条目（待人工 adopt）——把 RS 审阅语义自然延伸到 agent 链。
- 台账：本节即加映登记（AUDIT-LOG 同步）；实机与集成提交后 UI-460 补记。

- **§9 收口（2026-10-03）**：F1 修复两批集成提交——ea765eea（chain-preview.js pending 注册+三链形成点接线+契约 6/6〔含补刃两案：inputLineage 物化+图自动落库〕）+ d3ae13a3（走查抓真的挂载点缺陷修复：LineageViewSwitch 完成态 shellBody 同位补挂载）。链产 /lineage chain=3 实证；实机三断言 R2 复走全过+换眼复核 confirmed；P6 绑定门两次集成提交均刷新 13/13。Mac 侧域插件激活（gewu-pack-bio 本地 2f3d474，不推送——Windows 线合并对账留 BIO-4 域）。已知语义后果已兑现：agent 链 pending ChangeSet 进审阅队列（walk-attempt5-review-queue.png 实证）。

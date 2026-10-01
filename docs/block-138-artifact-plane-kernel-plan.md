---
capability: artifact-plane-kernel
goal: 成果面首包两件——切片A 内核收口（artifact 模型+viewer registry 固化为前端内部契约，六类 adapter 零行为变化平迁）+ 切片B 血缘 DAG 画布（@xyflow/react 只读投影 result_workflow_graphs，节点点击打开 artifact）
acceptance:
  - P0：viewer-registry 契约测试（kind→viewer 全表解析+能力声明+未知 kind 兜底）+ 既有 RS 面测试零回归 + tsc 0 + eslint 0 error
  - P1：LineageGraph 组件测试（投影纯函数+渲染+节点交互）+ theme 门禁绿 + test:changed 定向 0 红
  - 实机（dev Electron）：真实跨 Job 链（BIO-4 解冻后 bulk 主链）DAG 渲染 + 节点点击打开 artifact + 条带/DAG 形态切换，断言落 acceptance/block-138/
  - code-size 棘轮登记 @xyflow/react 增量 + knip 棘轮新导出登记
reopen: plan 状态 planned——实现待用户过目后发令；条带（LineageStrip）去留在 P1 实机后按体感裁决（D1）
status: planned
---

# BLOCK-138 — 成果面内核 + 血缘 DAG 画布（成果面系列首包）

> 立项：2026-10-01（planned 排队，非 active——唯一 active 槽位现被 BLOCK-128 占用，且用户流程约定「plan完全定之后 我们再开始干活」）。
> 裁决链：2026-10-01 用户原话①「很不错…毕竟我们的项目是通用agent和垂直领域的生信agent或者后期延伸为其它领域的agent 我希望这次关于这些方面的应用和扩展有灵活性 同时也确实有效」（方向要求）→②「可以 接下来你就开始吧 定下来 plan完全定之后 我们再开始干活」（立项放行，实现待发令）。
> 方向父文档：[`artifact-plane-direction.md`](./artifact-plane-direction.md)（切片 A-E 序列、三层契约不变量、反目标）。中文名「成果面」为主 Agent 受托定名（用户未指定）。
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
- 排队现状：BLOCK-128（PL-1）active 待实机三件收口；backlog 队列 PL-3 二刀/BIO-6/PL-5 等交织推进中；本包 planned，**启动=用户过目本 plan 后发令**。

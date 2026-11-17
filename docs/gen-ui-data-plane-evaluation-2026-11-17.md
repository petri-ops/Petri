---
capability: gen-ui-data-plane-evaluation
status: active
goal: Gen UI 数据面形态演进全方位评估——基于 json-render（Vercel Labs Generative UI 框架）调研与仓库只读探查，评估「HTML fragment 沙箱 → catalog 契约 + JSON spec 受控渲染」的差距、差别形态、路径选项与分阶段路线；决策材料，待用户裁决，Agent 不代答
acceptance:
  - 每个路径选项有现状依托/体量/风险/推荐理由，裁决点状态 pending_user_ruling，默认行为不变
  - 现状结论可回溯（文件:行号或 canonical 文档章节），json-render 结论带官方文档来源
  - 路径 A（推荐）在零新增依赖假设下可执行；任何依赖引入须另过 DEPENDENCY-CHANGE-CHECKLIST 并获用户裁决
  - 不触碰 Result Studio 资格线（implemented_unverified/experimental、RS-P7 deferred 语义不动，g0-result-studio-plan.md:14/1816）
---

# Gen UI 数据面方向全方位评估（json-render 形态演进 · 决策材料）

> 触发：2026-11-17 用户裁决原话：「Gen UI 数据面方向 我有这个想法了 你可以全方位评估一下 落文档」。
> 溯源：json-render 官方文档与 README 调研（json-render.dev/docs、github.com/vercel-labs/json-render，2026-11-17 时点 v0.21.0）+ 仓库双线只读探查（canonical 文档定位线 + 前端/后端渲染链现状线）。
> 本文件 = 评估决策材料（kind=reference，非 canonical 真相）；**不启动任何工作包、不改动任何运行时行为**。立项与否、路径选择、阶段取舍均为用户裁决点（§9）。

## §0 一句话结论

**方向成立，且不是从零立项**：格物已有一轮完整交付的 Gen UI 数据面（BLOCK-166/168/174/175/196 链条，竞争力纲 dim6 5.0/5 满锚）；json-render 代表的「catalog 契约 + JSON spec 受控渲染」是对现有「`::visualize` → HTML fragment 沙箱」形态的**结构化演进方向**，在审计单元、流式体验、治理契约、领域扩展四个维度有结构性升级空间，推荐以「借形不引包、自实现 mini spec 引擎」的路径 A 分阶段推进。

## §1 背景与触发

1. 2026-11-17 会话调研 [json-render](https://json-render.dev/docs)（Vercel Labs Generative UI 框架，Apache-2.0，~19.7k stars，pre-1.0），用户随即裁决对本方向做全方位评估。
2. 评估前提（探查实证，见 §3）：格物的 Gen UI 数据面在竞争力纲 W4 波（CP-11/12/13）已由 BLOCK-174 于 2026-10-12 交付并有机械证据（`test/block196-genui-data-binding.test.mjs` 7 项契约 + 棘轮基线提升，agent-competitiveness-program.md:38/145-151）。
3. 因此本评估的正确问题不是「要不要做 Gen UI」（已做过），而是「**要不要把表达面从 HTML fragment 形态演进到 JSON spec 形态、演进到什么深度、走哪条实现路径**」。

## §2 json-render 形态拆解（对标参照，非依赖提案）

json-render 的核心机制三层（来源：官方文档 Introduction/Specs 页 + GitHub README）：

1. **Catalog（目录）= 契约**：开发者声明 AI 可用的组件与动作，props 带类型约束（Zod）；`catalog.prompt()` 从 catalog 自动生成系统提示词——「AI 能用什么」是显式契约而非事后拦截。
2. **Spec（规格）= 纯数据输出**：AI 生成扁平树 JSON（`root` + `elements` map，子节点 ID 引用），只允许引用 catalog 类型；带 `$state` 数据绑定（JSON Pointer）、`visible` 可见性条件、`$cond/$template/$bindState/watch` 等动态表达；`validateSpec()` 结构校验 fail-closed。
3. **Registry（注册表）= 本地原生渲染**：catalog 类型映射到平台真实组件（React/Vue/Svelte/React Native 等），**不是 iframe、不是 markdown、不是生成的代码，无任意代码执行**。

对格物最有价值的三个设计决策：

- **扁平树而非嵌套 JSON**：为流式优化——SpecStream 编译器把增量 chunk 编译成可渲染的部分 spec，UI 随生成渐进长出。
- **spec 是纯数据**：可以落盘、diff、回放、审计——UI 本身成为一等证据对象。
- **catalog 即安全边界**：约束先于生成，而不是生成后靠沙箱兜底。

生态位参考：`@json-render/mcp` 包把 catalog 接入 MCP Apps（Claude/ChatGPT/Cursor/VS Code）——与格物已有的 BLOCK-445/447 MCP App 接入（`gen-ui:prepare-mcp-app`/`gen-ui:mcp-app-call`，src/ipc/channels.js:245-269）处于同一生态方向。

**冷读（不迷信）**：pre-1.0，README 自述含 experimental 特性并建议 pin 精确版本；~30 包 monorepo、Zod 类型依赖；这些与其「形态参照」价值和「依赖引入」风险要分开计价（§7 路径 B）。

## §3 格物现状盘点（探查实证）

### 3.1 已交付的 Gen UI 链（本评估的地基）

| 能力 | 状态 | 载荷 |
| --- | --- | --- |
| Gen UI 沙箱（`::visualize` → HTML fragment → 独立 origin iframe） | verified（UI-486，2026-10-12，BLOCK-166 P0-P3 整包） | ui-productization-audit.md:6016；规格真值源 gen-ui-migration-prompt.md |
| OOPIF 劫持加固 + 自愈 | BLOCK-168 交付 | docs/block-168-oopif-hijack-hardening-plan.md |
| 数据面绑定 CP-11（`gen-ui:get-data` job 只读投影：跨会话归属校验 + 12KB 有界投影 + prompt 注入 ≤5 最近 done jobs） | completed + BLOCK-196 补锚复测 dim6 5.0/5 | agent-competitiveness-program.md:88/149；ui-productization-audit.md:1149 |
| 场景模板库 CP-12（bar/line/kpi/table + visualize 模板节） | completed | agent-competitiveness-program.md:150 |
| accent 透传 + fragment 文件导出 CP-13 | completed | agent-competitiveness-program.md:151 |
| viewer 选择总线 + 分屏接线 CP-14/15 | completed（BLOCK-175） | agent-competitiveness-program.md:153-158 |
| widget 状态持久化（`gen_ui_widget_state` 表，widgetState ≤16KiB） | 在产 | core/petri-server/db/schema.js:536；src/ipc/channels.js:245-269 |
| MCP App 接入 | 在产（BLOCK-445/447） | src/ipc/channels.js gen-ui:* 族 |

安全底座（全部可复用）：`petri-genui://` scheme、会话归属/sender 校验、scope realpath 校验、劫持侦测自愈、主题透传、放大预览锚点迁移（src/ipc/gen-ui.js 429 行 + src/main/gen-ui/）。

### 3.2 关键发现：一个「未通电的插座」

前端已存在一条完整的「typed JSON payload → 注册表分发组件」链路：`ResultNode` 类型（text/table/chart/image）+ `ResultCardRenderer.tsx` 注册表 + `renderers/` 四实现 + `extraRenderers.tsx` 解析桥——但 localStorage flag `petri.simplechat.extraRenderers` 默认关、**后端零生产端**（core 全库 grep 零命中）。这是 spec 形态最天然的接线点：spec 引擎可以直接把它通电并升级，而不是新起炉灶（frontend/src/components/copilot/ResultCardRenderer.tsx + types.ts + renderers/）。

### 3.3 可复用机制清单（探查结论）

- **扩展惯例三条**：`meta_json` 白名单 restore（SimpleChat/types.ts:68/173）、`StructuredToolResult` 顶部扩展槽（approval/question/changeDiff/uiAction，copilotClient/types.ts:85）、通用 `::name{...}` 指令解析器（gen-ui/assistantDirectiveParser.ts——新指令零改造接入）。
- **流式管线**：conversationRunStore（useSyncExternalStore）+ `StreamChatOptions` ~20 个类型化回调 + agentTaskStream 断线续传 + SimpleChatMessageRow memo 性能边界（BLOCK-154）。
- **取数通道**：`gen-ui:get-data` 有界只读投影可直接作为 spec 数据绑定（$state 语义）的执行通道，不用新开 RPC。
- **治理先例**：svg_edit 的 propose/apply 两步 + sha256 乐观锁（受治理写面的先例）；copilotMarkdown 手写零依赖渲染器（896 行，刻意不引 react-markdown/zod——**手写校验器是本仓惯例**）。

### 3.4 治理定位红线（探查确认）

- Gen UI 数据面是**执行层产品能力**（竞争力纲 W4），**不是愿景词汇**（scientific-intelligence-os-vision.md 全文零命中「Gen UI/生成式 UI」；愿景只承诺 artifact 为科学证据对象）——本评估不拔高到愿景级。
- artifact-plane-direction.md（reference，切片 A-E 全收口）：「后续新切片仍需用户裁决 + 立项检查单」（:98）——本方向不重写该文档，若立项属其渲染层的**相邻演进新切片**。
- 当前 active 蓝图（next-work-blueprint-2026-11-16.md W1-W10）**无任何 Gen UI 波次**（:28/56/114）——立项需按蓝图治理规则另立子包 + 用户显式发令。
- 术语纪律：「数据面」在 docs/ 有三种用法（Gen UI 数据面绑定 / 服务端数据面性能 / 前端数据面），本文档专指第一种（§3.1 CP-11 语义）。
- Result Studio 整包 capability 维持 `implemented_unverified/experimental`、RS-P7 deferred——本方向不得以其引擎基础外推自身资格，反之亦然。

## §4 形态对比与差距分析

现有形态：agent 用 `workspace_write` 写 HTML fragment 到 `.petri/gen-ui/<convId>/`，发 `::visualize` 指令，宿主在沙箱 iframe 渲染（gen-ui-prompt.js 提示词契约 + visualize skill 教模型）。

| 维度 | 现状（HTML fragment 沙箱） | JSON spec 形态 | 差距性质 |
| --- | --- | --- | --- |
| 安全模型 | 沙箱隔离完备（OOPIF/劫持自愈/origin 隔离） | 无代码执行 + catalog 信任边界，宿主组件直渲 | 形态差异，非安全缺口；富交互场景仍需沙箱（并存，见 §8-R1） |
| **审计单元** | HTML 整页文件（大、难 diff、语义不透明） | spec 小 JSON：可落盘/sha256 入 truth 链/diff/回放 | **结构性差距——证据自证升级点** |
| **流式体验** | 文件写完 → `::visualize` 整卡出现 | 扁平树 patch 渐进渲染，UI 随生成长出 | 体验差距 |
| 数据绑定 | `petri.getData` 命令式 RPC（已有） | `$state` 声明式路径绑定（可复用 get-data 作执行通道） | 增强差距 |
| **治理面** | 审批在工具层（workspace_write） | catalog=用户可见契约；交互类组件可接动态审批 | **治理透明升级点** |
| 模型输出可靠性 | HTML 自由度大，错误整页可见 | catalog 枚举约束 + validateSpec fail-closed + 兜底降级 | 可靠性升级点 |
| 领域扩展 | 模板节（CP-12 已有 4 类） | 领域包自带 catalog 段（能力随包放大） | 场景锚放大点 |
| 生态互通 | 私有 HTML fragment | spec 若贴近主流格式可参考 json-render 生态语义（MCP Apps 方向） | 可选项，不承诺 |

**结论**：现状形态在「安全」维度已满分（满锚 5.0/5 评的是数据绑定闭环），结构性差距集中在**审计单元、治理契约、流式、领域扩展**四点——恰好全部落在格物的魂上（本地主权/可信透明/证据自证/场景资产）。这是「借形长魂」的教科书场景。

## §5 差别形态设计（立项自检问句回答）

问句：「这个能力的形态与 ZCode/Codex 的差别在哪？本地可审计/治理透明/证据自证体现了吗？」

对标差异：ZCode/Codex 的 artifacts 是云端生成、iframe/沙箱渲染的**黑盒产物**；格物形态的四个自有锚：

1. **本地可审计**：spec artifact 化——落 `.petri/gen-ui/<convId>/`、sha256 入 artifact truth 链（复用 artifact-truth.js）、支持 diff 与回放。UI 是本地证据，不是云端黑盒。
2. **治理透明**：catalog 是用户可见、可审查的契约（「这个 agent 在你机器上能渲染哪些组件」一张透明清单）；组件按风险分层（只读展示类直渲 / 交互动作类接动态审批面）——审批从「要不要执行工具」扩展到「AI 想渲染什么交互」。
3. **证据自证**：spec + 数据源引用（jobId 归属链）+ 校验结果三者一并留痕，渲染可复现；无效 spec 的 fail-closed 降级事件同样留痕。
4. **场景锚**：catalog 按领域包扩展——装了全组学包，catalog 多出火山图/富集表等组件段；**领域包放大能力，表达面也随包放大**（通用 agent 主线 + 场景资产放大器的双定位，不收缩主线）。

## §6 场景映射（按近远排序）

| # | 场景 | 形态 | 依托 |
| --- | --- | --- | --- |
| S1 | 聊天流内结构化卡：动态审批表单/任务进度卡/对比卡 | inline spec（completed 后渲染，沿 GenUiMessageContent 分派位） | StructuredToolResult 顶部扩展槽惯例 + ResultNode 插座通电 |
| S2 | 分析结果交互件：现有 visualize 场景的 spec 化（图表/KPI/表格由真实 job 数据驱动） | standalone 卡 + $state 绑定 | gen-ui:get-data 通道 + CP-12 模板 spec 化 |
| S3 | 审批 UX 升级：agent 生成的动态审批面板（参数可微调再批） | inline + 交互类组件审批分层 | ApprovalCard 先例 + §5 治理锚 2 |
| S4 | Result Studio 内 spec 驱动视图 | standalone（**实验性，不动 RS 资格线**） | viewerRegistry 相邻位；需单独裁决 |
| S5 | 领域包 catalog 扩展（全组学组件目录） | 领域包 manifest 带 catalog 段 | 插件体系 + §5 场景锚 4（长期，不预设具体组件） |

## §7 实现路径选项

### 路径 A：借形自实现 mini spec 引擎（推荐）

- **做法**：catalog 用手写 schema 校验器定义（沿 assistantDirectiveParser/svg_edit 零依赖先例）；spec 用扁平树模型；渲染分发**通电并升级现有 ResultNode 注册表**；数据绑定复用 gen-ui:get-data；新指令（如 `::compose{...}`）接现有 directive parser。json-render 只作形态参照，不引代码。
- **体量**：中等（§9 分阶段，P0-P2 为 MVP，估 2-3 个串行工作包）。
- **优点**：零新依赖（守住 BLOCK-454/455 以来的惯例红线）；与现有插座/通道/惯例全部咬合；校验器可按格物治理需求定制（风险分层/审计钩子是 json-render 没有的）。
- **缺点**：自实现成本（校验器/流式编译要自己写）；放弃 json-render 现成的多端渲染与 36 组件库。
- **依赖**：零新增。

### 路径 B：引入 @json-render/react + @json-render/core

- **做法**：catalog/spec/流式编译器/渲染器直接用 json-render 包，格物 catalog 对接到其 registry。
- **体量**：接入中等 + 长期维护外部依赖。
- **优点**：功能全（SpecStream/动态表达式/多端），生态活跃。
- **缺点/风险**：①pre-1.0 + experimental 特性需 pin 版本，上游漂移风险；②引入 Zod 等依赖链，与「手写校验器/零依赖」仓库惯例正面冲突；③catalog 语义与格物治理面（风险分层/审批/审计钩子）对齐有改造成本，深改后反而被上游抽象绑住。
- **依赖**：新增（须过 DEPENDENCY-CHANGE-CHECKLIST，默认答案是 no，需用户显式裁决）。

### 路径 C：维持 HTML fragment 形态内迭代

- **做法**：不做 spec 形态，在现有沙箱内扩模板库/导出/绑定。
- **体量**：最小。
- **缺点**：不解决 §4 四个结构性差距（审计单元/治理契约/流式/领域扩展点）；竞争力纲 dim6 已满锚，继续投入的边际收益递减。
- **定位**：作为「暂不立项」的默认态——现状本身就是可用的，不立项不产生任何回归。

### 推荐

**路径 A**。理由：差距全在魂上（§4 结论），而路径 A 是唯一同时满足「零新依赖惯例 + 复用全部现有底座 + 治理钩子可定制」的路径。路径 B 不排除未来在 P3 流式编译等难点上**参考其算法**（不引包）。

## §8 风险与边界

| # | 风险 | 处置 |
| --- | --- | --- |
| R1 | 双形态并存成本（HTML 沙箱 vs spec 渲染） | **并存而非替代**：富交互/MCP App 场景保留沙箱形态（QODER 吸收计划也依赖它：qoder-essence-absorption-plan.md:80）；spec 形态服务结构化展示场景。边界写进立项 plan |
| R2 | catalog 漂移（组件契约悄悄变） | catalog=契约，变更走契约测试锁定（BLOCK-196 先例：红绿先行 + 棘轮基线） |
| R3 | 模型生成无效 spec | validateSpec fail-closed + 降级为文本/模板兜底 + 降级事件留痕；visualize skill 先例教模型（skill 补章） |
| R4 | 流式渲染性能回退 | 守 BLOCK-154 memo 边界治理，新渲染分支纳入同一性能契约 |
| R5 | 范围蔓延成「通用低代码平台」 | 反目标：不做通用页面搭建、不预设未来领域组件、不引 tldraw 类画布（沿 artifact-plane-direction 反目标纪律） |
| R6 | 误触 Result Studio 资格线 | S4 场景单独裁决；本方向任何交付不改 RS capability 语义 |
| R7 | 与 artifact-plane-direction 形成第二真相 | 本文档=评估材料；立项后新切片在该方向文档「渲染层」语义下登记，不重写它 |

## §9 分阶段路线建议（advice · 开工需用户发令）

> 以下为建议形态，不是计划；每阶段立项时按 WORK-PACKAGE-LAUNCH-CHECKLIST 走。P0-P2 = MVP 闭环；P3/P4 可选拆包。

| 阶段 | 内容 | 体量 | 关键验收形状 |
| --- | --- | --- | --- |
| P0 探针 | catalog 最小集（Card/Metric/Table/Chart 4 组件）+ 手写校验器 + **ResultNode 插座通电**；HK-01 契约测试红绿先行 | S | 端到端：手写 spec JSON → 聊天流受控渲染；契约测试在册 |
| P1 内核 | 扁平树 spec 模型 + validateSpec fail-closed + `::compose` 指令接 directive parser + 聊天流渲染分支（completed 后，沿 GenUiMessageContent 分派位） | S/M | 无效 spec 降级留痕；指令解析防注入/防流式闪烁沿既有契约 |
| P2 数据面 | `$state` 绑定 → get-data 通道复用 + widgetState 持久化 + visible 条件 | M | 真实 job 数据驱动的 spec 卡（CP-11 同款实机判据：非手写数据） |
| P3 流式（可选） | spec 增量编译 + 渐进渲染（复用 agentTaskStream 事件契约扩展） | M | 流式性能契约（BLOCK-154 边界）+ 断线续传兼容 |
| P4 模板与领域扩展点（可选） | CP-12 模板 spec 化 + visualize skill 补章 + catalog 扩展点契约（领域包 manifest 段） | M | 模板命中契约；扩展点零内核改动判据（沿 artifact-plane 配方纪律） |
| P5 收口 | 实机腿 + 台账回写（每包收口随包走，此处指整体对账） | S | closeout + 实机证据 |

**裁决点（pending_user_ruling，Agent 不代答）**：

1. **U-G1 是否立项**：✅ 已裁决（2026-11-17）——用户选「排队候选登记」：入蓝图 W11 候选池（next-work-blueprint-2026-11-16.md），不占串行槽位，开工仍需发令；未正式立项。
2. **U-G2 路径选择**：**ruled（2026-11-18 用户预授权批量裁决）**——用户裁决原话「B-6 W11 路径 = A（零依赖自实现）」（=推荐 A：借形自实现 mini spec 引擎，零新依赖 + 手写校验器 + 复用既有插座）。
3. **U-G3 范围裁剪**：**ruled（2026-11-18 用户预授权批量裁决）**——用户裁决原话「B-7 W11 首包 = P0-P2」（=建议首包范围）；P3/P4 观察后再裁。开工发令见 D8（同批预置=B-8 发令开工）。

## §10 与既有治理文档的关系

- **agent-competitiveness-program.md**（dim6/W4）：本方向不是补 dim6 缺口——dim6 已满锚 5.0/5；本方向是满锚点位上的形态演进，引用其「无锚点位是下一波立项的证据入口」语义时应表述为「锚点之上的纵深」而非「补缺」。
- **artifact-plane-direction.md**（reference）：新切片语义下登记，不重写；其「内核领域无关」判据（任何新领域入驻不改内核代码）直接继承为 P4 扩展点判据。
- **next-work-blueprint-2026-11-16.md**：立项后按其治理规则登记波次；本评估不改写蓝图。
- **scientific-intelligence-os-vision.md**：不拔高到愿景层；本方向始终是执行层表达面能力。
- **qoder-essence-absorption-plan.md**：UI 插件窄桥复用 Gen UI 沙箱的默认形态不受影响；spec 引擎落地后窄桥多一个受控组件选项，属增量非冲突。

## §11 结论

1. 方向成立：四个结构性差距（审计单元/治理契约/流式/领域扩展）全部落在格物差异化定位上，且现状底座（沙箱安全层、get-data 通道、directive parser、ResultNode 插座、扩展槽惯例）使演进成本显著低于从零建设。
2. 推荐路径 A（借形自实现，零新依赖），json-render 作形态参照不作依赖。
3. 双形态并存（沙箱管富交互、spec 管结构化展示），不做替代。
4. 三个裁决点（U-G1/G2/G3）待用户裁决；本文档不启动任何工作包，默认行为不变。

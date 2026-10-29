---
capability: next-stage-experience-blueprint
goal: 将下一阶段的用户体验、可信界面、工作流闭环、提示词增强与物理世界 3D/参数化建模能力固化为统一指导蓝图，使“想法→提示词→可执行工作流→可审阅成果→导出证据”形成可重复的本地产品链路。
acceptance:
  - 方向级验收 = 各能力包独立立项后按其 plan 验收；本文件的勾选与任务清单是执行契约，不冒充运行时证据。
  - UI 方向验收 = 设计契约、布局几何、状态反馈、键盘/焦点、性能与实机断言逐波通过；不得只凭截图宣称稳定可信。
  - 建模方向验收 = SceneSpec 契约、单位/坐标/尺寸约束、Blender 可选执行后端、视觉回读、导入导出、Agent 工具链、工作流 recipe 与隔离实机证据齐备。
  - 提示词增强验收 = 显式点击触发、项目上下文有界投影、TaskSpec 与优化稿预览后才可替换、永不自动发送或自动执行、失败与超时诚实降级。
  - 交接验收 = 任一符合 AGENTS.md 的 Agent 仅依据 canonical 文档、Git 与 acceptance 证据即可定位当前包/阶段/下一项，不依赖聊天记忆。
reopen: 波次启动逐波用户发令；Three.js 与 Blender 接入按依赖清单裁决，B-rep/STEP 精确实体核、真实 Provider 能力与任何 G1+ 发布相关事项均需单独裁决。
status: completed
---

# 下一阶段体验与物理世界建模蓝图

> 立项依据：2026-10-29 用户要求「将当前规划蓝图正式固化，作为下一阶段工作的指导依据」，并纳入三层需求：①全面优化软件整体 UI 与布局，提升视觉质感、用户体验与稳定可信赖感；②为 harness 与前端引入或增强 3D 与设计建模能力，用更丰富交互支持物理世界可视化，并可精确指导、流程化落地想法；③在会话输入中增加增强提示词能力，结合项目自身情况优化用户提示词。
>
> 全量执行规划依据：2026-10-29 用户要求「做好全量规划，整好任务列表，换其它模型也能按照规划逐步推进所有工作内容」。本轮把方向评审转化为模型无关执行契约：保留本地主权与确定性底座，补齐 TaskSpec、Three.js+Blender 双层 3D、视觉回读、可复现 manifest 和逐包交接规则。
>
> 当前事实基线：`BLOCK-243/244` 已完成 MCP trust 接审批与 Q1-REM；`BLOCK-262` 已完成确定性 workflow 内核；`BLOCK-256` 已有 automation/schedule；`BLOCK-245/246/255` 已形成唯一 `ComposerContextItem` 上下文通道；`BLOCK-264` 已有模型追问建议与润色草稿；`BLOCK-138/142` 已有 artifact viewer registry；`BLOCK-166` 已有 Gen UI 沙箱；`BLOCK-167` 已有设计宪章与 token 棘轮；视觉内联/`read_image`、browser/computer 工具与第三方 MCP 策略投影已在 `core/petri-server/agent-tools/`。**Blender 当前未集成**，本文件只规划其可选本地执行后端。
>
> 本文件是下一阶段的 **planned 方向与全量执行 canonical**，不是实现完成记录，也不启动任何工作包。每个工作包仍走单工作包串行、用户发令、红绿先行、定向测试与实机证据。

## 1. 阶段总纲

### 1.1 一句话目标

把 Petri 从“功能很多但用户需要自己拼装”的开发态，推进为：

**用户看得懂、敢托付、能推进；Agent 说清楚、做得到、可回退；想法可以变成带尺寸、带约束、带证据的本地成果。**

### 1.2 四条不可丢的魂

1. **本地主权**：工作流、工具、上下文、3D 场景、审计与导出均在本地闭环；模型可按用户现有配置调用，但产品不依赖云端渲染、云端 CAD 或云端协同。
2. **可信与透明**：任何高风险动作有前置解释、范围、影响、可逆性、参数预览与审计；任何结果有来源、状态、失败原因、证据与恢复路径。
3. **确定性优先**：提示词优化可以辅助表达，但不能替代用户裁决；3D 建模必须有 schema、单位、约束、校验和可复现导出；工作流必须 dryRun、预算、血缘、恢复与取消。
4. **形可借、魂不换**：可参考通用 Agent 产品的交互质感、审批卡、预览与布局，但不复刻其云端账号、云自动化、营销化视觉或复杂游戏式 3D；继续保留海军蓝工作台身份、科研/工程信息密度与本地审计文化。

### 1.3 阶段成功判据

- 用户在欢迎页、项目工作台、聊天、工作面、设置、独立窗口中都能获得一致的层级、间距、状态、焦点和错误反馈。
- 高风险或不可逆操作不会让用户“不知道点了会发生什么”。
- 用户输入一句模糊想法，可以通过提示词增强得到更完整的目标、约束、产出物和验收标准。
- Agent 能把增强后的任务转成可 dryRun 的工作流，而不是只发散地聊天。
- Agent 能创建、校验、调整、渲染、导出带尺寸和参数的 3D 场景，并把过程变成可审阅证据。
- 3D 成果不是“只能看一个模型”，而是“需求、参数、约束、预览、变更、导出、证据”一条链。

## 2. 与既有计划的关系

| 既有资产 | 本蓝图如何复用 | 不重复做什么 |
| --- | --- | --- |
| `docs/design-charter.md` | 作为 UI 视觉、字号、色彩、线条、动效、控件的长期真值 | 不推翻海军蓝 token，不另造第二套颜色体系 |
| `docs/full-stack-benchmark-blueprint-2026-10-15.md` | 吸收其前端/harness 差距结论：时间线、工具注册表、testid、审批反馈、性能与可观测 | 不把对标清单原样搬成产品需求 |
| `docs/block-262-q4b-workflow-scripts-plan.md` | 继续做 Q4b-REM：`run_workflow`、schedule 触发、运行控制面 | 不建第二执行器、第二调度器、第二审批链 |
| `docs/artifact-plane-direction.md` | 3D 成果接入现有 artifact/viewer/work-surface 语言 | 不新建孤立的“3D 项目”真相 |
| `docs/unified-pane-model-design.md` | 先复核其 pane 契约，再决定窗口/面板统一形态 | 不把已退役的页内 SideChatDock 当现状 |
| `core/petri-server/helpers/assistant-suggestions.js` | 复用模型调用、JSON 解析、超时、失败如实回传、不自动发送原则 | 不新建第二套建议/润色模型链 |
| `frontend/src/lib/workSurface/registry.ts` | 3D 视图与模型工作面作为 core/pack surface 贡献 | 不绕过 registry 新开平行标签系统 |
| `frontend/src/components/result-studio/viewerRegistry.ts` | 增加 3D viewer adapter 与能力位 | 不把 viewer registry 再复制一份 |

## 3. 总体路线图

```text
N0 蓝图与模型无关执行契约（本文件）
  → NEXT-02A UI 状态与可信基线小切片
  → NEXT-01 Q4b-REM 工作流可用化闭环
  → NEXT-03 TaskSpec 与 Composer 提示词增强
  → NEXT-04A SceneSpec + Three.js + Blender Adapter
  → NEXT-04B 多视角视觉回读与选择修改回路
  → NEXT-05 参数化建模、五类 recipe 与可复现导出
  → NEXT-02B 全局视觉与布局收敛
  → NEXT-06 跨链集成、压力/恢复与蓝图复盘
```

### 3.1 全量串行执行表

| 序 | 工作包 | 建议体量 | 主目标 | 硬前置 | 状态 |
| --- | --- | --- | --- | --- | --- |
| 0 | 本蓝图 | 规划已完成 | 方向、范围、任务、依赖、验收与恢复契约 | 用户本轮裁决 | planned canonical |
| 1 | `NEXT-02A-UI-TRUST-CORE` | 1–1.5 周 | 统一执行/证据/能力三轴状态与高频可信 UI 基线 | N0 | **completed（UI-631 verified；closeout 13/13）** |
| 2 | `NEXT-01-Q4B-REM` | 1–2 周 | 工作流从 REST 内核变成 Agent/定时/UI 可用闭环 | NEXT-02A | **completed（UI-632 verified；closeout 13/13）** |
| 3 | `NEXT-03-PROMPT-ENHANCE` | 1 周 | TaskSpec 草稿 + 优化提示词 + 能力快照，预览后才应用 | NEXT-01 | **completed（UI-633 verified；closeout 13/13）** |
| 4 | `NEXT-04A-3D-FOUNDATION` | 2–3 周 | SceneSpec、Three.js 预览、Blender 可选执行后端与首个导出 | NEXT-03 | **completed（UI-634 verified；closeout 13/13）** |
| 5 | `NEXT-04B-3D-VISION-LOOP` | 1–2 周 | 多视角视觉 QA、批注/选择进 Composer、视觉降级 | NEXT-04A | **completed（UI-635 verified；closeout 13/13；P3-2 参数提案移入 NEXT-05）** |
| 6 | `NEXT-05-3D-PROCESS` | 2–3 周 | 参数化编辑、revision/compare、五类 recipe、完整导入导出 | NEXT-04B | **completed（UI-636 verified；closeout 13/13）** |
| 7 | `NEXT-02B-UI-VISUAL-CONVERGENCE` | 1–2 周 | 黄金路径稳定后收敛全局视觉、布局、跨窗和剩余性能面 | NEXT-05 | **completed（UI-637 verified；closeout 13/13）** |
| 8 | `NEXT-06-CONVERGENCE` | 1 周 | 跨链集成、异常/压力/恢复、证据复核与蓝图复盘 | 以上全部 | **completed（evidence-matrix/golden-path/resilience/agent-replay；closeout 13/13）** |

**单工作包串行纪律不变**：同一时间只有一个 active 工作包；包号是稳定责任边界，不代表可以跳号并行。`NEXT-02A` 先于 `NEXT-01` 是为了先统一状态语义，避免工作流与 3D 面板返工；依赖或顺序需要改变时必须先回写本节与 pending-work-backlog，再执行。逐包任务见 §11。

## 4. N1：Q4b-REM 工作流可用化闭环

### 4.1 目标

`BLOCK-262` 已有 workflow 的确定性内核，但当前主要是 REST 能力。下一阶段首先把内核接到用户和 Agent：

1. **Agent 入口**：新增 `run_workflow` 工具，支持脚本、参数、dryRun、resumeFromRunId。
2. **定时触发**：`automation` 增加 `kind="workflow"`，到点执行工作流脚本，并把 runId 与 schedule run 关联。
3. **用户控制面**：在既有工作面展示 workflow runs、步骤、journal、预算、取消、恢复、失败原因。
4. **流程化入口**：后续 3D 建模和提示词优化都可以编排为 workflow recipe。

### 4.2 具体契约

- `run_workflow` 只调用既有 workflow REST/runner，不得绕过审批、预算、journal 或 `launchSubAgent`。
- `dryRun` 返回步骤上界、agent 数上界、预算与风险预估，不执行。
- `resume` 只复用同 `scriptHash + argsHash` 的已完成步骤前缀；任何 mismatch 从首个不匹配步骤开始重跑。
- `schedule.kind="workflow"` 的运行记录必须带 `workflowRunId`、`taskId`、预算状态、最终状态与失败原因。
- 运行面板只读优先：v1 不做 DAG 可视化编辑器；先提供步骤/journal 时间线、状态、取消与恢复。

### 4.3 验收

- 红绿契约：工具注册、dryRun、resume、cancel、schedule trigger、运行投影、权限/审批继承。
- 隔离实机：mock provider 下完成「Agent 调用 → dryRun → 确认 → 执行 → journal → schedule 触发 → 取消/恢复」。
- 用户可见：workflow run 面板可以显示步骤、来源、预算、失败、恢复入口；刷新后状态可恢复。
- 红线：不建第二执行器、不建第二调度器、不建第二审批链；G0 开发期常态，不外推 packaged/Provider/GA。

## 5. N2：UI 可信赖体验与整体布局优化

### 5.1 设计目标

用户感受到的“稳定与可信赖”不是单个漂亮组件，而是以下六个体验承诺：

1. **位置稳定**：同类控件在同类位置；工具栏、输入框、弹层、状态区不随意跳动。
2. **层级稳定**：页面、面板、卡片、浮层四级层次清晰；颜色只强调当前动作、状态和风险。
3. **状态稳定**：加载、空、错误、部分成功、离线、权限不足、等待审批、运行中、完成都有明确状态。
4. **动作稳定**：高风险动作有预览、影响范围、可逆性、确认、撤销/回退和审计。
5. **数据稳定**：来源、项目、文件、任务、模型、成本、权限、时间都可追溯；不把未知状态伪装成成功。
6. **响应稳定**：长会话、长列表、弹层、独立窗口、窄窗口、高 DPI、重载、后端慢响应都保持可读、可操作、可恢复。

### 5.2 现状基线与问题定位

已具备的优点：

- `docs/design-charter.md` 已定义 6 档字号、色彩预算、线条三语义、motion token、控件单源。
- `BLOCK-167` 已把按钮、状态、空/载/错、focus ring、滚动条和部分视觉细节制度化。
- 近期 UI 反馈批已解决：中栏优先宽度、侧栏拖窄折叠、发送/停止单钮、侧聊原生独立窗、通知中心行式弹层、图片预览顶层化、模型菜单主从两卡、批注列表 portal、消息排队逐条控制等。

仍需系统化收敛的问题：

- 局部修复多、整体布局语言仍有漂移；不同面板/弹层/窗口的层级、圆角、间距、阴影、字重不完全同源。
- `docs/full-stack-benchmark-blueprint-2026-10-15.md` 指出的长会话虚拟滚动、工具 kind renderer、turn navigator、testid 单一来源、快照回归、面板框/状态栏统一等仍是体验和可信度缺口。
- 侧聊已经改为原生独立窗，`unified-pane-model-design.md` 中关于 SideChatDock 的假设需要在实现前复核，不能直接照搬。
- 许多功能状态存在但不“可理解”：审批、预算、来源、模型选择、工作流、结果、错误、恢复需要统一的状态词汇。
- 当前 UI 台账仍有较多 `in_progress` 实机腿，下一阶段不能用新 UI 覆盖旧证据债。

### 5.3 八个设计角度

#### A. 视觉语言与 token

- 继续使用海军蓝 `--petri-*` token 阶梯，不引入第二套主色。
- 字号继续遵守 6 档；正文默认 `--petri-font-size-body`，小字号只给徽标/元信息。
- accent 稀缺化：主动作、激活态、链接、焦点环、风险状态才使用；装饰和次级动作默认中性。
- 卡片层级只允许 `surface → subtle → elevated`，不得出现页面比卡片更浅的“页面上的洞”。
- 边线继续用 `border-input / border-card / divider` 三语义；新增视觉先复用 token，再考虑新 token。
- 新 3D 控件、工作流面板、提示词增强浮层必须走同一 token 体系。

#### B. 信息架构与布局

- 明确五个层级：**应用壳层 → 项目上下文 → 会话/任务 → 工作面/成果 → 明细/证据**。
- 中栏是主叙事：会话、任务、结果和证据按用户当前意图排列，左右栏提供上下文和导航，不抢主焦点。
- 右栏工作面继续使用 `workSurface` 注册表；新增“工作流运行”“3D 场景”“提示词增强”都必须是注册表贡献，不硬编码散落按钮。
- 独立窗口继续沿用 `/window/*` 真窗口路线；任何可拖出内容都要有明确宿主、恢复、关闭、状态同步语义。
- 信息密度默认高但不拥挤：重要数值可扫读，次级元信息可折叠；不为了“好看”降低工程信息量。

#### C. 聊天、任务与工具呈现

- 会话时间线以“轮次/任务”为稳定单位，运行中只展开当前活跃段，完成段收敛为可扫描摘要。
- 工具呈现使用 kind renderer 注册表：Explore / Execute / Changes 三类语义，输出按文本、JSON、图片、文件、错误、审批、结果不同形态呈现。
- 每个工具结果展示：来源、输入摘要、状态、耗时、输出大小、失败原因、可恢复动作。
- 长输出渐进披露：摘要默认，详情可展开；不把大量 raw output 无差别铺进会话。
- 工作流、子代理、后台任务、终端、浏览器和 3D 生成统一使用同一套状态徽标与颜色语义。

#### D. Composer 与输入体验

- Composer 是用户最重要的“工作入口”，必须保持稳定宽度、稳定按钮位置、稳定附件/引用/队列形态。
- 在现有 `ComposerContextItem` 通道上增加“提示词增强”浮层；不建第四条引用通道。
- `@` 菜单、斜杠菜单、附件、选区引用、图片、速记、会话拖入、计划反馈、排队、插话、发送/停止保持现有语义，但统一入口层级与键盘焦点。
- 输入内容、上下文数量、预算、当前模型、自动模型决策、当前访问档位在 composer 附近可见但不喧宾夺主。
- 所有辅助生成都只是草稿：提示词增强、润色、追问、计划建议都不能自动发送。

#### E. 可信状态与风险反馈

建立统一状态词典：

| 状态 | 用法 | 必须可见 |
| --- | --- | --- |
| `draft` | 用户输入、待优化提示词、未批准计划 | 未生效、可编辑 |
| `running` | Agent、工具、workflow、渲染、导入 | 进度/耗时/取消 |
| `waiting` | 等待审批、等待输入、等待依赖 | 卡片位置与原因 |
| `partial` | 部分步骤成功、部分失败 | 成功/失败清单 |
| `failed` | 校验、权限、网络、模型、文件失败 | 原因、重试、诊断 |
| `completed` | 任务或工作流完成 | 结果入口、来源、证据 |
| `cancelled` | 用户取消 | 取消范围与残留 |
| `degraded` | 回退、降级、无预览、无模型 | 能力边界与替代路径 |

实现时不得把上表压成一个混合状态字段，统一投影为三轴：

- **执行**：`draft / running / waiting / partial / completed / failed / cancelled`。
- **证据**：`unverified / verified / stale`；`partial` 只描述执行结果，不代替证据状态。
- **能力**：`ready / degraded / unavailable / disabled`。

例如“工作流完成但视觉校验未运行”显示为 `completed + visual QA unverified + vision unavailable`，而不是笼统显示成功或 `degraded`。审批卡继续扩展“意图/影响/可逆性/范围/参数/来源/证据”，但不伪造模型解释。高风险 3D 导出、文件写入、工作流执行、模型调用都应能回答：**它改了什么、为什么改、能否撤回、证据在哪里**。

#### F. 可访问性与跨窗口

- 所有关键交互可键盘完成：composer、审批、弹层、工作面切换、3D 基础操作、提示词增强预览。
- focus ring、Escape 关闭、Tab 顺序、`aria-live` 状态播报、对话框语义统一。
- 支持 reduced motion、高 DPI、窄窗口、左右分栏、独立窗口、屏幕阅读器基础场景；i18n 仍保持既有 deferred，不混入本阶段。
- 离屏测试不可截图时，继续用 DOM/Canvas/属性断言诚实取证，不打开可见测试窗换证据。

#### G. 性能、韧性与恢复

- 长会话采用虚拟化或渐进渲染；长工具输出采用有界折叠；长列表采用有界加载。
- 所有异步请求有 pending、失败、重试、取消和超时状态；不得出现无限 spinner。
- 后端慢、浏览器页面挂起、WebGL context 丢失、模型响应超时、文件解析失败时，界面保留可理解的降级面。
- 关键页面不留黑屏；错误边界按段落/面板/工作面隔离，不能让单个卡片失败拖垮整页。
- 3D 场景必须有复杂度上限、三角面/节点/文件大小上限和降级策略。

#### H. 内容与语言

- 动作文案用用户能预期结果的动词：优化提示词、预览结果、应用修改、创建场景、校验尺寸、导出模型、取消运行。
- 不使用“智能”“强大”“一键”这类空泛承诺；优先写清边界：“仅预览”“不会自动发送”“失败将保留原稿”“导出为本地文件”。
- 状态文案同时表达事实和下一步：例如“模型响应超时，草稿未修改，可重试”。

### 5.4 UI 工作面拆分

| 工作面 | 范围 | 证据 |
| --- | --- | --- |
| UI-A token/控件/状态词典 | 统一 token、控件、状态徽标、空载错、focus、border | theme-token-contract、组件测试、双主题实机 |
| UI-B 壳层/信息架构 | 标题栏、导航、左右栏、右栏 tab 注册表、独立窗口 chrome | 布局几何、viewport、焦点、窗口恢复 |
| UI-C 会话/工具/工作流时间线 | 虚拟化、kind renderer、任务/工具状态、来源、折叠 | 长会话、长输出、运行/失败/恢复实机 |
| UI-D composer/提示词/上下文 | 输入稳定、增强浮层、上下文 chips、队列、审批入口 | 不自动发送、上下文有界、键盘可达 |
| UI-E 成果/3D/预览 | viewer registry、3D 控件、尺寸/约束/导出、证据入口 | 3D DOM/Canvas 断言、导出文件、恢复 |
| UI-F 性能/可访问性/韧性 | 长列表、错误边界、reduced motion、窄窗、高 DPI | 自动探针、长内容三态、异常注入 |

### 5.5 UI 验收指标

- 字号、accent、无语义细线继续服从 `design-charter` 棘轮；新增 UI 不放宽既有棘轮。
- 核心页空/载/错/部分成功覆盖 100%。
- 主要高频动作按钮位置在常用视口内不漂移；弹层不遮挡关键主操作。
- 所有高风险动作都有风险说明、参数预览、确认或撤销、结果来源与失败原因。
- 关键流可键盘完成，焦点不丢失；reduced motion 下不依赖动画理解状态。
- 长内容三态必测：完整容纳、框内滚动、窄视口不越出宿主列。
- 不以截图作为唯一通过依据；视觉工作需元素级/几何/状态断言 + 必要截图/Canvas 取证。

## 6. N3：会话输入“增强提示词”

### 6.1 产品形态

在 composer 的主动作区新增“优化提示词”入口，点击后弹出**预览浮层**，不直接发送：

1. 用户输入原始提示词。
2. 点击“优化提示词”。
3. 前端把原始提示词、项目上下文摘要、当前工作面/选区/附件摘要发送到后端。
4. 后端使用当前 chat 配置的模型生成结构化优化结果。
5. 用户看到：优化后提示词、TaskSpec 草稿、改变摘要、建议约束、建议验收标准、仍需补充的信息、使用了哪些项目上下文与能力快照。
6. 用户可以选择：应用替换、插入到原文、复制、重新生成、保留原稿、取消；确认后的 TaskSpec 只能经用户再次显式动作进入 workflow dryRun，不能直接执行。

### 6.2 项目上下文边界

只投影有界、用户可理解的上下文，不读取任意文件全文：

- 项目名称、项目类型/modality、当前工作区路径相对标识。
- 当前可见工作面、当前文件/结果/3D 场景名称。
- 用户已经放入 composer 的 `ComposerContextItem` 摘要。
- 当前任务类型候选：编码、分析、结果解释、工作流、3D 建模、通用整理。
- 可用 skill/MCP 名称清单（只给名称与用途，不给凭据、不执行）。
- 用户原始提示词与明确约束。

禁止：密钥、环境变量、完整文件正文、任意远端 URL、未授权项目内容、隐藏系统提示词。

### 6.3 服务契约

建议新增 `POST /api/ai/agent/prompt-enhance`，复用 `assistant-suggestions.js` 的模型链路和失败语义：

```json
{
  "ok": true,
  "optimizedPrompt": "...",
  "taskSpec": {
    "version": "task-spec/v1",
    "goal": "...",
    "deliverables": ["..."],
    "constraints": ["不得自动发送", "只修改指定文件"],
    "assumptions": ["..."],
    "acceptance": ["测试通过", "diff 可审阅"],
    "missingInfo": ["需要明确目标格式"]
  },
  "changeSummary": ["补充了可交付文件", "明确了验收标准"],
  "contextUsed": ["project:name", "selection:file", "context:artifact"],
  "capabilitySnapshot": [
    { "id": "blender", "status": "unavailable", "reason": "not_configured" },
    { "id": "workflow", "status": "ready", "recipeIds": ["modeling/box-enclosure"] }
  ],
  "model": "current-chat-provider"
}
```

约束：

- 原始提示词不可静默丢失；必须提供“恢复原稿”。
- 优化结果不得自动替换，除非用户显式点击“应用”；TaskSpec 不得自动发送、自动 dryRun 或自动执行。
- 超时、无凭据、模型输出不可解析时，保留原稿并给出原因。
- 结果长度有界；禁止无穷扩展和隐藏指令注入。
- `capabilitySnapshot` 只含能力 id、ready/degraded/unavailable/disabled、允许用途与有界 recipeId，不含凭据、env、隐藏策略或未授权工具 schema。
- 模型调用使用当前 chat provider/credential，不新建模型路由，不做 Provider 矩阵。

### 6.4 与工作流/3D 的连接

- 识别到 3D/建模意图时，优化结果增加：单位、尺寸、材料、约束、导出格式、允许的近似、需要用户确认的假设。
- 识别到工作流意图时，优化结果增加：输入、步骤、产物、验收、失败处理、预算边界。
- 识别到编码意图时，优化结果增加：文件范围、行为契约、测试、禁止修改。
- 优化结果只是 prompt draft，不直接调用 `run_workflow` 或 3D 工具。

### 6.5 验收

- 点击才有模型请求；无自动发送、无自动改稿、无自动执行。
- 原稿、优化稿、差异摘要、使用上下文、缺失信息均可读。
- 项目切换、会话切换、发送中点击、重复点击、模型超时均不会串稿或覆盖旧输入。
- mock provider 可完整验证；真实模型调用只在用户点击时发生。
- 审计可查：优化请求只记录有界摘要与上下文类型，不记录完整秘密内容。

## 7. N4/N5：harness 与前端 3D / 设计建模能力

### 7.1 方向选择

当前项目没有现成 3D 依赖或 3D 工作面。本阶段选择的不是“游戏引擎”或“照片级渲染”，而是：

**面向物理世界表达的参数化 3D 场景与设计建模工作面**：用明确单位、坐标、尺寸、约束、材质和可导出文件，把“想法”变成可检查、可调整、可复用的本地 3D 成果。

首批目标场景：

1. 机械小件/外壳/支架/箱体/面板。
2. 家具、设备、空间布局和简单产品概念。
3. 实验装置、仪器面板、采样/放置关系的示意模型。
4. 由数据/表格驱动的三维示意图和流程装置图。
5. 后续可扩展到分子、体积、点云等科学 3D，但不在首批冒充完成。

### 7.2 SceneSpec：可计算的 3D 真相

新增版本化 JSON 契约 `scene3d/v1`，而不是把二进制 mesh 当唯一真相。

最小字段：

```json
{
  "version": "scene3d/v1",
  "units": "mm",
  "coordinateSystem": "z-up-right-handed",
  "parameters": {
    "width": 120,
    "height": 80,
    "depth": 40
  },
  "nodes": [
    {
      "id": "enclosure",
      "type": "box",
      "transform": { "position": [0, 0, 0], "rotation": [0, 0, 0] },
      "dimensions": { "width": "width", "height": "height", "depth": "depth" },
      "material": { "color": "#4c78a8", "roughness": 0.7 }
    }
  ],
  "constraints": [
    { "kind": "align", "a": "panel", "b": "enclosure", "axis": "z" }
  ],
  "metadata": {
    "title": "桌面外壳概念",
    "author": "petri",
    "sourcePromptId": null
  }
}
```

硬约束：

- v1 只接受有限、可校验的节点：box、cylinder、sphere、plane、group、mesh-reference、label、dimension。
- 参数引用只允许有限表达式或参数名，不执行任意 JavaScript。
- 单位默认 `mm`，坐标系统一 `z-up right-handed`；渲染层负责转换，不让模型文件偷偷改单位。
- 所有数值必须 finite；越界、环依赖、重复 id、非法引用 fail-closed。
- `mesh-reference` 必须带 `sourceSha256`、原始/目标单位、importer 与版本、导入变换和可恢复的项目相对路径或 Artifact ID；外部字节变化必须使校验失效。
- 来源与导出 manifest 必须能关联 `taskSpecId/taskSpecRevision`、`workflowRunId`、`recipeId/recipeVersion`、`blenderVersion/adapterVersion`、输入哈希、渲染/导出参数、几何报告、输出哈希、Artifact Revision 与 checkpoint。
- v1 约束只承诺已实现的确定性求值/校验，不冒充完整 CAD 约束求解器。
- SceneSpec 是可 diff、可 checkpoint、可审计、可 workflow 的源真相；GLB/STL/OBJ 是导出物，不是唯一真相。

### 7.3 前端 3D 工作面

新增 `Model3DSurface`，接入 `viewerRegistry` 与 `workSurface`：

- 导入：`.gltf/.glb/.stl/.obj` 只读预览；`.scene3d.json` 可参数化编辑。
- 视图：轨道、平移、缩放、透视/正交、前/顶/侧/等轴视图、网格、坐标轴、单位标尺。
- 交互：节点选择、图层/组显隐、尺寸标注、点选测量、相机书签、截图。
- 属性：尺寸、位置、旋转、材质、参数、约束状态、错误诊断。
- 比较：同项目两个 SceneSpec 并排/叠加查看，显示差异节点和尺寸变化。
- 导出：STL/OBJ/GLB + SceneSpec JSON + 预览图 + 导出清单。
- 失败态：文件过大、格式不支持、解析失败、WebGL 不可用、场景复杂度超限，都显示可恢复边界。

### 7.4 harness / Agent 工具

工具必须进现有 `core/petri-server/agent-tools` 注册体系，不另起一套 MCP 执行器：

| 工具 | 权限 | 作用 |
| --- | --- | --- |
| `model3d_inspect` | R1 只读 | 摘要 SceneSpec/导入模型的节点、尺寸、单位、约束、异常 |
| `model3d_validate` | R1 只读 | schema、单位、坐标、参数引用、约束、复杂度、网格与导出可行性校验 |
| `model3d_propose` | R1 + 模型出网审计 | 根据需求生成候选 SceneSpec/参数/变更提案，不直接写文件；模型 egress 与本地只读风险分开呈现 |
| `model3d_apply` | R2 workspace-write | 将显式批准的 operations 应用到 SceneSpec，支持 checkpoint/撤销 |
| `model3d_render` | R2 execution + workspace-write | 经能力 provider 生成前/顶/侧/等轴预览图；Blender 缺席时诚实降级 |
| `model3d_export` | R2 execution + workspace-write | 经 Three.js 或 Blender provider 导出 GLB/STL/OBJ/预览图/manifest，写入项目工作区 |

所有 recipe 统一经 `run_workflow({ recipeId, args, dryRun })`，**不新增 `model3d_recipe_run` 第二编排入口**。Blender 是 `model3d_*` 稳定工具面后的可选 capability provider，优先经现有本地 MCP/stdio 与审批链接入；Three.js 只承担交互预览与明确声明的轻量导出，不承担完整几何内核。

安全规则：

- `model3d_apply/export` 不接受任意 shell、任意网络 URL、任意 shader 或任意 JS。
- 文件路径必须落在项目可写根；超大文件、超复杂场景、越界尺寸、非法单位拒绝。
- 所有写操作显示 before/after 参数摘要，并可经 workspace checkpoint 回退。
- 审批仍走既有 tool approval / guard / policy 链，不建第二审批系统。

### 7.5 设计建模流程化

把“想法”拆成固定步骤：

```text
用户想法
  → 提示词增强（目标/约束/单位/产出物/验收）
  → 建模需求卡（尺寸、材料、约束、不确定项）
  → SceneSpec 候选 / 参数提案
  → 校验（单位、几何、约束、复杂度）
  → 3D 预览（正交/透视、尺寸、测量、选择）
  → 用户修改或批准
  → 导出（GLB/STL/OBJ + manifest + 预览图）
  → 证据（参数 diff、校验报告、journal、checkpoint）
```

推荐 recipe：

- `modeling/box-enclosure`：箱体、面板、孔位、壁厚、螺钉区。
- `modeling/bracket`：支架、加强筋、安装孔、尺寸约束。
- `modeling/room-layout`：房间、家具、设备、通道、标签。
- `modeling/experiment-rig`：平台、容器、传感器、采样位置、箭头标签。
- `modeling/from-table`：从 CSV/表格生成重复阵列或分布示意。

每个 recipe 都必须声明输入、参数、约束、输出、验收和失败回退；由 workflow 编排，而不是散落在提示词中。

### 7.6 视觉回读与选择修改回路

标准链路：草图/参考图 → 视觉模型提取可见目标与不确定项 → TaskSpec 明确尺寸/假设 → SceneSpec/Blender 场景 → 前/顶/侧/等轴多视角图 → 视觉模型检查布局、方向、标签和明显遗漏 → 确定性工具检查尺寸、约束、网格与导出可行性 → 用户审阅 proposal/diff 后修改或导出。

- 视觉报告只含 `observation / suspected_issue / uncertain`，不得覆盖几何校验；无已知尺度的图片不得推断精确尺寸。
- `read_image` 调用必须传 3D 专用问题，不沿用生信图表默认提问。
- 批注/选择进唯一 `ComposerContextItem`，上下文坐标可含 `sceneRevision + nodeId + annotationId + viewCamera`；不得新建第四引用通道。
- 视觉不可用时，TaskSpec、SceneSpec、几何校验与导出仍可完成，UI 显示 `vision unavailable / visual QA unverified`，不冒充视觉通过。
- browser/computer GUI 自动化只作外部工具特殊兜底，不作为 Blender 标准执行链。

### 7.7 依赖策略

- 默认评估 `three`（MIT）作为唯一前端 3D 渲染依赖；使用其 loader、camera、geometry、material 与明确声明的 exporter 能力，不默认引入 R3F、物理引擎或游戏引擎。
- Blender 当前未集成；规划为**可选本地执行后端**，经受限 MCP/stdio adapter 提供 `build_scene / render_views / inspect_mesh / export_scene` 等白名单能力。禁止暴露通用 `blender_python`、任意 shell、任意网络 URL、任意 shader 或任意 JS。
- Blender 不可用时，SceneSpec 与 Three.js 预览继续可用；需要 Blender 的构建、渲染、网格检查与导出明确显示 `capability_unavailable`。
- 若需要真正 STEP/B-rep 精确实体，另开依赖/许可/体积评审；本阶段先交付可解释、可参数化、可导出的 mesh/scene 层，不冒充机械 CAD。
- 依赖新增前必须走 `DEPENDENCY-CHANGE-CHECKLIST`；本蓝图只授权方向，不跳过依赖裁决。

### 7.8 3D 验收

- SceneSpec schema、单位/坐标/参数引用/约束、mesh 内容哈希与来源链校验红绿测试。
- 导入 `.gltf/.glb/.stl/.obj` 的有界解析、错误诊断、复杂度限制。
- `model3d_inspect/validate/propose/apply/render/export` 的工具注册、审批、路径安全、审计和 checkpoint；recipe 只经 `run_workflow`。
- Blender provider 的能力探测、白名单、超时/取消、版本记录与缺席降级；不得以 mock 证据冒充真实 Blender 运行。
- 隔离实机：创建一个有尺寸的简单场景 → 校验 → 修改参数 → 预览 → 多视角视觉 QA（可用时）→ 导出 GLB/STL → manifest 与 hash 可核对。
- 画布证据优先用 renderer `toDataURL` / DOM 状态 / 数值断言；隐藏窗口截图不可得时如实标注，不打开可见窗口换证据。
- 复杂场景压力测试：节点、三角面、文件大小、WebGL context 丢失、Blender 崩溃/超时、导出失败均有降级路径。

## 8. 统一治理、证据与非目标

### 8.1 每个工作包都必须满足

1. 产品个性自检：形态差别、本地可审计、治理透明、证据自证。
2. 红绿先行：新行为先有失败测试/契约，再实现。
3. 单工作包串行；不提前实现后续波次契约。
4. UI 变更同提交更新 `docs/ui-productization-audit.md`；无实机证据不得 `verified`。
5. 运行 `npm run test:changed`、相关组件测试、`quality:types`、`quality:lint`、`closeout`。
6. 证据写入 `acceptance/<block-id>/`；文档不夸大运行时事实。
7. 不在收口报告中反复写 G1+ 未做项；使用“G0 开发期常态 · 不外推 packaged/Provider/GA”。

### 8.2 明确不做

- 不做照片级真实感渲染、游戏物理、云 CAD、云端协同建模。
- 不在 v1 承诺 STEP/IGES/B-rep 精确制造；需要时另立精确内核评估包。
- 不把提示词增强做成自动发送器或“万能 prompt 魔法”。
- 不把 3D 结果写入第二套结果真相；沿用 artifact/work-surface/viewer/证据体系。
- 不绕过审批、预算、checkpoint、路径安全、模型凭据治理。
- 不重开 G1+（Provider 矩阵、packaged 公证、GA、远程发布）。
- 不因新增 3D 或 UI 能力放宽 `design-charter`、theme token、代码体积、架构边界和密钥扫描门禁。

## 9. 决策点与默认值

| 决策 | 默认值 | 裁决点 |
| --- | --- | --- |
| 3D 前端依赖 | 优先评估 `three` 单依赖 | 依赖清单、体积、许可能过 checklist |
| 3D 执行后端 | Blender 可选本地 provider，经受限 MCP/stdio | 当前未集成；禁止任意 Python/shell；缺席可降级 |
| 3D 坐标/单位 | Z-up 右手系、mm | 用户若要求 CAD 标准可在实现前改 |
| 几何能力 v1 | 参数化 mesh + 基本约束 + 明确网格检查 | B-rep/STEP 另包；导出成功不等于可制造 |
| 视觉回读 | 多视角图 + 当前 vision 角色，辅助 QA | 不替代尺寸/约束/网格事实；缺席不阻塞几何链 |
| 提示词模型 | 当前 chat provider | 不新建 provider 路由 |
| 提示词产物 | `optimizedPrompt + task-spec/v1 + capabilitySnapshot` | 显式点击、预览后应用；永不自动发送/执行 |
| UI 视觉 | 海军蓝 token + design charter | 不换色相、不换字体栈 |
| 工作流入口 | `run_workflow` + automation | 不建第二执行器/调度器/recipe 入口 |
| 3D 写操作 | R2 + checkpoint + manifest | 不接受任意脚本/网络/shader |
| pane/窗口 | 先复核现有独立窗与 workSurface 契约 | SideChatDock 旧设计不得直接照搬 |

## 10. 建议的首个执行包

本蓝图全量规划后的首个执行包建议是：

**`NEXT-02A-UI-TRUST-CORE`：执行/证据/能力三轴状态与高频可信 UI 基线。**

理由：先用小切片统一状态词典、来源/证据投影、错误与部分成功语义，再建设工作流、TaskSpec 和 3D 面板，可避免后续三类工作面各自发明状态词汇并返工。它不是全局换皮包；完整视觉收敛放在 `NEXT-02B`。启动时另行走工作包立项检查单和用户发令；本蓝图本身不是开工令。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 11. 模型无关全量执行契约

### 11.1 唯一真相与角色分工

- 本文件负责：下一阶段范围、稳定包号、串行顺序、任务分解、默认裁决、验收与完成语义。
- `docs/pending-work-backlog.md` 负责：全量队列中的本阶段入口；`docs/next-steps-roadmap.md` 与 `docs/project-workspace-handoff.md` 负责：当前 active 包、当前阶段与最近恢复点。
- `docs/DOC-REGISTRY.json` 与 `docs/README.md` 负责：发现入口；`docs/AUDIT-LOG.md` 负责：活跃阻塞、评审发现和最近处理记录。
- `acceptance/<package-id>/` 负责：运行时证据；测试、Git、SQLite、Artifact Truth 与实机结果优先于任何“已完成”文字。
- 主 Agent 负责 P0 对账、范围/架构裁决、跨模块取舍、终审与 canonical 回写。子 Agent 只承担边界清晰、可独立验证的只读勘察、定向测试或独立文件实现；不得并行开启另一个包。
- 其它模型不需要继承聊天上下文，但必须遵守 `AGENTS.md`、本文件和项目治理 skill；模型品牌、上下文长度或个人偏好不得改变契约与证据等级。

### 11.2 每包统一执行循环

每个工作包只按以下五阶段推进，同一时间只有一个阶段为进行中：

| 阶段 | 必做动作 | 出口 |
| --- | --- | --- |
| P0 对账/立项 | 读 AUDIT-LOG、Git/WIP、既有实现与本包任务；确认用户发令、范围、非范围、文件所有权、依赖、patch/refactor 判定 | 无未知 WIP 被覆盖；范围与验收无歧义；active 状态回写 |
| P1 契约/红测 | 先写失败测试或契约；冻结 schema、状态机、路径/权限边界与验收分母 | 红测因缺少本包行为而失败，不是探针自身坏 |
| P2 最小实现 | 只实现本包当前任务；复用既有 runner/registry/bridge/artifact；新生产路径同步 impact-map | 红转绿；邻域定向测试绿；无第二执行器/第二真相 |
| P3 实机/证据 | 跑本包指定 live、异常与降级链；证据写 `acceptance/<package-id>/`；UI 同批更新台账 | 证据覆盖声明，未跑/降级/unavailable 如实记录 |
| P4 收口/交接 | 定向测试 + `npm run closeout` + docs/UI 对账 + 必要决策建议器；更新本包、roadmap、handoff、AUDIT-LOG | 所有声明有当前证据；无 active 后才可建议下一包 |

补充规则：

1. 新行为与缺陷修复红绿先行；纯治理文档、纯类型或探索性 PoC 按项目豁免规则处理。
2. 默认定向测试，不以全量测试代替本包专项门；新增生产路径、探针和 acceptance 目录同批登记 impact-map。
3. UI 变更同提交更新 UI 台账；只有实机证据充分才 `verified`。截图不可得时用 DOM/几何/Canvas/文件断言，不以可见测试窗换证据。
4. 每包收口必须回写依赖后的下一可执行项，不能只写“完成”。范围变更、依赖新增、外部安装、破坏性动作、B-rep/STEP、G1+ 仍需用户显式裁决。
5. 本文件任务框只有在对应当前证据落盘后才可勾选；规划态全不勾选不代表运行时失败。

### 11.3 全阶段唯一黄金路径

所有包共同服务以下主链，不允许各自交付后无法组合：

```text
草图/参考图或一句想法
  → TaskSpec（目标/交付物/约束/假设/缺失信息/验收/能力快照）
  → 用户确认 → workflow dryRun
  → SceneSpec 候选与参数提案
  → Three.js 预览 / Blender 白名单构建
  → 确定性尺寸/约束/网格校验
  → 前/顶/侧/等轴多视角图 + 视觉辅助 QA
  → 用户批注/选择与参数 diff → checkpoint 后 apply
  → GLB/STL/OBJ + SceneSpec + 预览图 + manifest
  → Artifact Revision / journal / hash / 恢复证据
```

首个集成夹具固定为：一张外壳草图 + `120×80×40mm` + `壁厚 2mm`；首轮生成后将宽度改为 `130mm`。允许视觉模型指出不确定项，不允许其补造精确尺寸。

### 11.4 `NEXT-02A-UI-TRUST-CORE`（completed 2026-10-29）

**目标**：先统一可信 UI 的语义与高频状态，不做全局换皮。  
**证据目录**：`acceptance/next-02a-ui-trust-core/`。  
**非范围**：3D、提示词服务、全局视觉重排、G1+。

- [x] **P0-1 现状盘点**：核心状态矩阵与残留已落 `acceptance/next-02a-ui-trust-core/ui-state-inventory.md`；既有 `in_progress` 未批量翻绿。
- [x] **P1-1 三轴投影**：执行/证据/能力纯函数与红测完成，组合态有测试；未知状态保留 raw，不伪装成功。
- [x] **P1-2 状态词汇与来源**：高频面统一消费投影与 `StatusBadge`；领域专用词表保留业务语义并登记归口。
- [x] **P2-1 高频面接线**：聊天工具行/子代理、指挥中心、轨迹、证据、结果库、项目摘要接线；轨迹读取增加 15s 超时。
- [x] **P2-2 长内容基线**：会话 200 条分页、轨迹 2000 事件上限、工具输出折叠已入基线；实机验证 16 作业墙有界为 12 瓦片。
- [x] **P2-3 可访问性底线**：状态徽标 aria/detail；实机验证键盘 Tab 可到可见控件；全站 motion/跨窗矩阵由 NEXT-02B 继续。
- [x] **P3-1 实机三态**：`next02a-status-live-live.json` 9/9；真实 DOM 几何、执行轴、队列保留、列表上限与键盘焦点。
- [x] **P4-1 收口**：定向 74/74 + 静态契约 3/3 + closeout 13/13；UI-631 verified；截图 unavailable 如实登记。

**交付记录**：核心实现=`frontend/src/lib/statusProjection.ts` + `ui/controls/StatusBadge`；定向测试 74/74，实机 9/9，closeout 13/13。残留=领域专用状态词表与全站可访问性矩阵归 NEXT-02B；通用虚拟化未引入，按现有分页/上限与实测基线决策。

**完成判据**：三轴语义有单一实现，高频面状态可理解，长内容/慢响应/失败可恢复，后续 workflow 与 3D 可直接复用该投影。

### 11.5 `NEXT-01-Q4B-REM`（completed 2026-10-29）

**目标**：把既有 workflow REST 内核变成 Agent、schedule 与 UI 的单一可用闭环。  
**证据目录**：`acceptance/next-01-q4b-rem/`。  
**非范围**：DAG 编辑器、第二执行器/调度器/审批链、3D recipe 实现。

- [x] **P0-1 内核复核**：复用 BLOCK-262 runner/dryRun/journal/resume/cancel 与 BLOCK-256 schedule；未建第二执行链。
- [x] **P1-1 `run_workflow` 工具**：schema/contract/R2 审批/工具元数据齐备；经本机既有 workflow REST 进入 runner；当前 v1 只接受 script，recipeId 留给建模包扩展。
- [x] **P1-2 dryRun/resume 契约**：dryRun 零执行返回预算上界；resume 保留原 `scriptHash + argsHash` 前缀来源并从终态 `run.json` 读取 `scriptSource`。
- [x] **P2-1 schedule 接线**：`kind="workflow"` 持久脚本/args，运行行关联 `workflowRunId + taskId`；runner 回收 workflow 终态。
- [x] **P2-2 运行控制面**：core `workflow` workSurface，展示 runs、预算、来源、journal、取消与恢复；空/载/错/未启用状态。
- [x] **P2-3 单一 recipe 入口**：`run_workflow` 为后续 recipe 唯一入口；未实现 `model3d_recipe_run`。
- [x] **P3-1 隔离实机**：隔离 :3011 + 9223 完成 dryRun 零执行 → 无代理工作流 journal → workflow schedule 关联 → 控制面预算/步骤/完成状态 11/11；取消/恢复由 Node 契约覆盖。
- [x] **P4-1 收口**：工具/调度/路由/UI 邻域 + 实机 + closeout 13/13；架构环回归修复；UI-632 verified。

**交付记录**：新增 `run_workflow`、workflow schedule、resume、工作流控制面与客户端；修复终态 run.json 丢 scriptSource。证据=`next01-workflow-live-live.json` 11/11 + 后端定向/邻域 + 前端 41 项 + closeout 13/13。局限=实机脚本为无 agent 确定性链，真实子代理链沿用 BLOCK-262 mock 实机与注入契约；脚本正文不回传前端。

**完成判据**：用户与 Agent 不需要手写 REST 即可安全运行、定时、取消和恢复工作流，所有后续 recipe 只有一个编排入口。

### 11.6 `NEXT-03-PROMPT-ENHANCE`（completed 2026-10-29）

**目标**：把“优化一句话”升级为可审阅的 `task-spec/v1` 草稿与优化提示词。  
**证据目录**：`acceptance/next-03-prompt-enhance/`。  
**非范围**：自动发送、自动 dryRun/执行、第二模型路由、任意文件全文注入。

- [x] **P0-1 上下文与模型链复核**：复用当前 chat profile/credentialRef 与唯一 `ComposerContextItem`；上下文只投影有界项目标签和条目摘要。
- [x] **P1-1 服务契约**：`POST /api/ai/agent/prompt-enhance` 返回 optimizedPrompt、TaskSpec、changeSummary、contextUsed、capabilitySnapshot、model。
- [x] **P1-2 TaskSpec 校验**：`task-spec/v1`、taskType、六类数组与长度上限 fail-closed；非法输出不返回草稿。
- [x] **P2-1 能力快照**：workflow/vision/MCP/Blender/task_spec 状态有界；不含凭据、env、隐藏策略或工具 schema；Blender 如实 unavailable。
- [x] **P2-2 预览浮层**：原稿/优化稿/TaskSpec/改变摘要/缺失信息/上下文/能力全可见；替换、插入、复制、保留原稿、失败重试、Esc 与 focus trap。
- [x] **P2-3 显式后续动作**：只有用户点击替换/插入才回填 composer；未接入自动 dryRun/发送/执行（显式后续动作留 NEXT-05 recipe 入口）。
- [x] **P3-1 竞态与失败**：打开时冻结原稿；AbortController 防重复/串稿；无凭据 503、超时 504、坏 JSON 502，原稿不改。
- [x] **P3-2 黄金题集**：实际 3D 外壳提示词经真实 chat profile 生成 TaskSpec；编码/工作流题由统一 schema 覆盖，后续 NEXT-05 再补 recipe 级黄金题。
- [x] **P4-1 收口**：服务/组件/类型/真实模型实机 + closeout；对话框抽 PromptEnhanceControls 保持 SimpleChat 体积棘轮。

**交付记录**：新增 `task-spec.js` + prompt-enhance 端点 + `PromptEnhanceControls`/Dialog + 客户端。实机 13/13（点击前无请求、真实模型结果、原稿保留、Blender unavailable、零自动替换/发送、应用后仅回填）；closeout 13/13，UI-633 verified。修复自定义 Provider 按 provider 名取凭据误报 no_credential；修复 2200 输出预算截断。

**完成判据**：优化结果既可读又可结构化审阅，能诚实反映当前能力，且任何生成内容都不越过用户裁决。

### 11.7 `NEXT-04A-3D-FOUNDATION`（completed 2026-10-29）

**目标**：建立 SceneSpec、Three.js 只读工作面和 Blender 可选 provider，跑通首个简单场景导出。  
**证据目录**：`acceptance/next-04a-3d-foundation/`。  
**非范围**：五类完整 recipe、视觉 QA、B-rep/STEP、任意 Blender Python、游戏/物理引擎。

**依赖裁决记录（2026-10-29）**：用户发令「一次性搞定下一个阶段的任务」并明确选择「winget 安装 Blender（推荐）」。`three@0.186.1` MIT、无传递依赖、未压缩约 20.4MB，承载交互预览；`@types/three` 仅开发类型。Blender 4.5.10 LTS 为外部可选本地执行后端，不随产品分发、不暴露任意 Python；缺席时 Three 预览仍可用，构建/渲染/导出诚实降级。封装边界=`scene3d` 纯校验 + `blender-provider` adapter + 固定 `resources/model3d/blender_scene.py`。**实施偏航如实登记**：provider 采用受控本地 CLI（固定脚本/JSON 入参）而非 MCP 包装；MCP 封装留 NEXT-05/后续，安全边界不变。

- [x] **P0-1 依赖与安装裁决**：three 依赖清单/许可过检；Blender 4.5.10 LTS 从官方 MSI 安装，SHA256 与官方 `38a3f6ee…` 一致，无头 `--version` 与真实构建通过。
- [x] **P0-2 provider 契约**：Three 只读预览 / Blender 构建渲染导出职责分离；能力状态 ready/unavailable 与错误模型落地。
- [x] **P1-1 `scene3d/v1`**：版本/单位/坐标/有限参数/节点/约束/复杂度校验；非法数值、重复 id、未知引用 fail-closed。
- [x] **P1-2 可复现引用**：mesh-reference sourceSha256/路径校验；manifest 记录 sceneHash、providerVersion、recipe/task/workflow ids 和输出哈希；Artifact Revision 绑定由 NEXT-05 完成。
- [x] **P2-1 Three.js viewer**：core `model3d` workSurface；SceneSpec/GLB/GLTF 只读预览、轨道/缩放/平移、四视角、Z-up 网格/坐标轴/单位。
- [x] **P2-2 基础属性与失败面**：节点/尺寸/材质摘要、64MB 文件上限、解析失败/WebGL 不可用/context lost/复杂度限制可恢复提示。
- [x] **P2-3 `model3d_*` 工具**：inspect/validate/propose/apply/render/export 注册、审批、路径安全与 .bak；apply 接白名单 operations，propose 不写盘。
- [x] **P2-4 Blender adapter**：固定 build/render/inspect/export 白名单；禁任意 Python/shell/network；记录 Blender 版本、资源上限、输入与输出哈希；真实 Blender 缺席降级已测。
- [x] **P3-1 首个真实场景**：130×80×40mm 外壳（参数由 120 改 130）+ 端口；四视角 PNG、GLB 9852B/STL 6884B/OBJ 8428B、manifest hash 全部核对；网格 0 非流形、watertight、体积 416000mm³。
- [x] **P3-2 降级与异常**：Blender 缺席 `capability_unavailable`；WebGL 初始化/context lost/文件超限明确报错；Three 预览独立于 Blender。
- [x] **P4-1 收口**：SceneSpec 契约+工具宇宙+前端预览+真实 Blender 15/15+closeout 13/13；UI-634 verified。

**完成判据**：一个真实、带尺寸和来源的简单场景能在本地完成预览、Blender 构建和可复现 GLB 导出，能力缺席可解释。

### 11.8 `NEXT-04B-3D-VISION-LOOP`（**completed 2026-10-29 · UI-635 verified · closeout 13/13**）

**目标**：让视觉能力参与草图需求与多视角 QA，同时保持几何事实确定性。  
**证据目录**：`acceptance/next-04b-3d-vision-loop/`。  
**非范围**：图片直接声称精确制造、视觉替代 schema/网格校验、自动 apply。

- [x] **P1-1 多视角契约**：`blender-provider` 用固定 Python 脚本输出 front/top/side/iso 四张正交视图 + `blender-report.json`（sceneHash、相机、单位 mm、网格报告、输出哈希）；同一 SceneSpec 可重复渲染。
- [x] **P1-2 视觉报告 schema**：`model3d-review/v1` 每视角返回 observations / suspectedIssues / uncertain，附 model/usage/parseStatus；结构化失败时 `degraded` 保留原文，无凭据/无视觉配置时 `unavailable`；任何路径都不输出几何通过布尔真值。
- [x] **P2-1 视觉调用**：复用 vision 角色 `callVision`，只发送本次渲染图（QA 面不读取聊天内联图，故不存在重复计费）；无视觉配置/请求失败明确降级，渲染与几何报告不受影响。
- [x] **P2-2 QA 工作面**：`Model3DReviewPanel` 并排四视图、几何报告（对象/顶点/三角面/非流形边/水密/体积）与视觉观察；几何项按证据轴标「已核验/需要复核」，视觉结论保持辅助语义。
- [x] **P2-3 批注/选择回路**：画布点选或节点列表选择 node；观察项可勾选；Composer 提示含 `sceneRevision/nodeId/viewCamera/selectionKey`；「保存批注并引用」把整视图批注写入渲染 PNG（workspace-file 批注），提示带 `annotationId`；不自动 apply。
- [x] **P3-1 草图到需求**：`sketch-spec` 端点 +「草图转需求」对话框，草图 + 已知尺寸生成 `task-spec/v1`（modeling）；缺尺度/材料/约束进入 missingInfo/assumptions，只入草稿不自动执行。
- [ ] **P3-2 实机回读（宽度 130mm 提案/图像差异）**：QA + 选择上下文已交付；参数修改 proposal/diff 与 revision/图像对比属参数编辑与 revision/compare，按架构边界移入 NEXT-05 承接（本包不预建第二套修订模型）。
- [x] **P3-3 无视觉降级**：移除视觉配置后，几何校验、四视图渲染与导出仍完成；UI 明确 `vision unavailable`，`next04b-review-live.json` 的 `scenarioDegraded` 留证。
- [x] **P4-1 收口**：视觉契约/选择上下文/实机与降级证据（`next04b-review-live.json` 18/18、`next04b-model3d-review-ui-live-live.json` 15/15；截图按纪律标 `screenshot_unavailable`）+ closeout 13/13。

**完成判据**：视觉能加速需求理解与发现表达问题，但任何尺寸、约束和网格结论都有确定性来源。  
**证据边界**：本机无真实 vision 凭据，视觉链用本地 mock OpenAI-compatible 端点验证协议与解析（证据内 `visionProvider=mock-openai-compatible`），不冒充真实模型质量；真实 Provider 属 G1+。

### 11.9 `NEXT-05-3D-PROCESS`

**目标**：交付完整参数化编辑、比较、五类 recipe 和剩余导入导出，形成可复用建模工作流。  
**证据目录**：`acceptance/next-05-3d-process/`。  
**非范围**：自由形式完整 CAD、云协同、照片级渲染、未声明的制造保证。

- [x] **P1-1 编辑与恢复**：参数编辑 → 预览语义 diff → 应用写盘；白名单 operations；before/after 哈希 + 参数/节点字段/约束 diff；写入前本地修订快照（≤50 条），恢复会先快照当前状态再写回；重复 id/非法引用/越界 fail-closed。
- [x] **P1-2 测量与比较**：画布两点测量（mm 距离 + 连线）、视角书签（按项目持久化）、canvas 截图下载；两份 SceneSpec 语义 diff（参数/节点/约束）与哈希对照。承接 NEXT-04B P3-2：参数提案/预览/应用走同一 diff；图像逐像素差异未做，如实不声称。
- [x] **P1-3 格式与网格**：GLB/STL/OBJ 导出；前端 STL/OBJ 有界几何预览（外部单位按原文件，不伪造参数）；Blender `mesh-reference` 有界导入（≤64MB、仅 stl/obj、路径逃逸拒绝、sourceSha256 篡改拒绝、节点变换烘焙）。网格报告 watertight/非流形/体积；法线/壁厚/间隙未实现，不声称通过。
- [x] **P1-4 recipe 契约**：`model3d-recipes` 五类 recipe 声明输入/默认值/输出/验收/missingInfo/版本；`model3d_recipe` 工具 dryRun 只生成候选；workflow 宿主 `recipe` 原语复用同一 runner，dryRun/执行/resume/取消（AbortSignal 终止 Blender）统一。
- [x] **P2-1 `modeling/box-enclosure`**：箱体 + 正面端口凸台；真实 Blender 四视图 + GLB/STL/OBJ + manifest，watertight。
- [x] **P2-2 `modeling/bracket`**：底座 + 立板 + 加强筋 + 螺栓凸台；验收尺寸/位置；通孔未做（凸台示意）。
- [x] **P2-3 `modeling/room-layout`**：地板 + 四面墙 + 桌/柜体块；验收房间边界与体块不穿墙。
- [x] **P2-4 `modeling/experiment-rig`**：平台 + 容器 + 均匀分布传感器体块；验收位置关系。
- [x] **P2-5 `modeling/from-table`**：表格行 → 有界箱体阵列（≤40 行）；逐行数值严格校验，异常行显式报错，不静默跳过。
- [x] **P3-1 工作流证据**：五类 recipe 均 dryRun（零写盘）→ 执行 → 四视图 → GLB/STL/OBJ → manifest；另验 recipe workflow 成功链与 cancel/resume（resume 复用 dryRun phase，只重跑 execute）。
- [x] **P3-2 复杂度与恢复**：节点/参数/约束上限沿用 SceneSpec，表格 ≤40 行，mesh 导入 ≤64MB，修订 ≤50，Blender 180s 超时可取消；失败不写半份 manifest；hash 篡改拒绝。
- [x] **P4-1 收口**：五 recipe 分项证据 + 工具/格式/路径/实机 + closeout 13/13；STL/OBJ 文件预览 CSP `connect-src blob:` 实机抓真已修并加回归。

**完成判据**：五类想法均可经同一 TaskSpec/workflow/SceneSpec/Artifact 主链形成可审阅成果，而不是五个独立提示词演示。

### 11.10 `NEXT-02B-UI-VISUAL-CONVERGENCE`

**目标**：黄金路径稳定后收敛全局视觉、布局和剩余体验面。  
**证据目录**：`acceptance/next-02b-ui-visual-convergence/`。  
**非范围**：推翻海军蓝 token、换字体栈、为美观降低工程信息量、重写已验证窗口架构。

- [x] **P0-1 漂移清单**：`acceptance/next-02b-ui-visual-convergence/ui-drift-inventory.md` 对 UI-A~F 逐项对账（已实现/漂移/证据债）；旧 SideChatDock 仅历史引用未复活。
- [x] **P1-1 视觉与控件**：theme-token-contract 17/17；3D 三面板全部 token、无新按钮类/裸 font-size；明暗 token 实际切换已实机验证。
- [x] **P1-2 壳层与布局**：3D workSurface/QA/编辑面板改用容器查询（340px 右栏内单列/窄行），矩阵四视口 + 2x DPR 无横向溢出；壳层/独立窗沿用既有 BLOCK-321c/321 证据，未重写。
- [x] **P2-1 会话与工具呈现**：沿 NEXT-01/02A 已验证的工作流/工具/轨迹/证据面；本轮矩阵覆盖其布局与主题，不重复宣称新实现。
- [x] **P2-2 Composer 与工作面**：composer 在 592px 视口 551.88px、无横向溢出，焦点可达；TaskSpec/workflow/3D 面板沿用统一 token 与状态语言。
- [x] **P2-3 性能与韧性**：窄窗/高 DPI/暗色/reduced motion 矩阵通过；WebGL 丢失与错误边界沿用既有实现；截图不可得如实标注，不冒充视觉证据。
- [x] **P3-1 实机矩阵**：`next02b-ui-matrix-live-live.json` 19/19；布局几何与计算样式为主，截图 `screenshot_unavailable`。
- [x] **P4-1 收口**：theme-token-contract 17/17、布局测试 2/2、矩阵 19/19 + closeout 13/13；71 条存量 in_progress 证据债逐条保留（不用新 UI 覆盖）。

**完成判据**：用户在不同页面、面板和窗口中获得一致的层级、状态、焦点、错误反馈与恢复体验。

### 11.11 `NEXT-06-CONVERGENCE`

**目标**：验证全链组合、异常恢复与可复现证据，复盘蓝图而非集中补造完成记录。  
**证据目录**：`acceptance/next-06-convergence/`。  
**非范围**：G1+、Provider 矩阵、packaged/GA、B-rep/STEP、为通过而放宽既有门禁。

- [x] **P0-1 证据矩阵**：`acceptance/next-06-convergence/evidence-matrix.md` 映射八包证据与未覆盖边界；不把文档勾选当证据。
- [x] **P1-1 黄金路径**：`golden-path.json` 12/12：120mm dryRun → 构建/四视图/GLB-STL-OBJ/manifest → 130mm（rev-000001）→ resolve 后重渲染（bounds 130×80×40、volume 416000）→ manifest sceneHash 对账。**Artifact Revision 未接 Result Studio，如实标 partial。**
- [x] **P1-2 五 recipe 抽验**：五类 recipe 各自独立 SceneSpec/outDir/manifest（NEXT-05 live 46/46），from-table 逐行校验、STL 导入与篡改拒绝。
- [x] **P2-1 异常与压力**：vision 缺席、Blender 取消/超时、导出/导入失败、慢后端/模型超时、WebGL 丢失 + 刷新恢复（5/5）均有证据；**长会话/内存 soak 未做，明确未覆盖**。
- [x] **P2-2 可复现对账**：同 SceneSpec/provider 重跑，规范几何（mesh/bounds/renderEngine）与 manifest sceneHash 一致；GLB/STL/OBJ sha 相同，PNG 渲染图 sha 不同，按纪律只记录不强求。
- [x] **P2-3 指标基线**：dryRun 0ms、构建+渲染+导出 1578ms、重渲染 1399ms；长会话响应/内存未测，列为未覆盖。
- [x] **P3-1 用户路径与交接复核**：`agent-replay.md` 独立只读 Agent 重放；发现 120→130 未改几何的严重缺陷，已修（recipe 参数引用 + resolve）并重采 12/12。
- [x] **P4-1 蓝图复盘**：逐项判定 delivered/partial/deferred/reopen（`evidence-matrix.md` §8）；roadmap/handoff/backlog/AUDIT-LOG 已更新，剩余事项保留为 partial/deferred，不以文档勾选补位。

**完成判据**：全链可由另一名 Agent 独立恢复和复核，所有未覆盖项有明确边界，蓝图不以“任务都写过”冒充“产品都验证过”。

### 11.12 换模型/换会话恢复协议

任何新 Agent 按以下顺序恢复，禁止从聊天猜测：

1. 阅读 `AGENTS.md` 与 `docs/AUDIT-LOG.md`，先处理真实 🔴/🟢；运行 `npm run state`。
2. 执行 `git status --short --branch`、查看当前 diff 和最近提交；未知 WIP 是用户或其它 Agent 资产，不 reset、不 checkout、不覆盖。
3. 阅读本文件 §3 执行表与当前包任务卡，再以 roadmap/handoff 确认 active 包、P 阶段和最近完成边界。
4. 阅读当前包 `acceptance/<package-id>/` 与相关 UI 台账；代码/证据与文档冲突时，先降级文档结论并登记，不选择对实现最方便的一份。
5. 若当前无 active：首个候选为 `NEXT-02A-UI-TRUST-CORE`，取得用户发令后才启动；若已有 active：不得另开新包。
6. 若当前有 active：从当前阶段首个“无当前证据”的任务继续；先复核最近红测/测试/实机状态，不重跑无关全量套件。
7. 模型切换时不重写计划、不改包号、不换执行器；确需改架构/顺序时，先写回 canonical 并保留原因，再动代码。
8. 子 Agent 的完成声明不构成交付；主 Agent 必须复核 diff、测试和证据后才可集成。
9. 每次交付按 NEXT-STEP-BRIEF 输出一个 Jev 后续建议、真实计数与 active 状态；建议不等于开工。
10. 遇到依赖新增、Blender 外部安装、真实凭据、破坏性动作、范围扩大或 G1+，暂停在明确决策点；除此之外按既定默认值推进，不制造人造阻塞。

### 11.13 全阶段完成定义

只有同时满足以下条件，下一阶段才可标记 completed：

- §3 八个执行包均有各自完成语义所需的当前证据；partial/environment_pending 不计 completed。
- 黄金路径与五类 recipe 均可恢复、可解释、可导出，且没有第二执行器、第二 recipe 入口、第二 Artifact/Composer 真相。
- Blender、视觉、Three.js 的真实能力边界与缺席降级均有证据；mock 不冒充真实外部进程。
- UI 核心路径的状态、键盘、异常、长内容与跨窗行为达到本文件验收；截图不是唯一证据。
- 所有 canonical 状态、UI 台账、Acceptance、roadmap/handoff/backlog 一致，`npm run docs:reconcile` 与 `npm run docs:check` 通过。
- 未覆盖范围进入 reopen/backlog，不以 G0 开发期纪律掩盖本阶段已承诺但未交付的事项。

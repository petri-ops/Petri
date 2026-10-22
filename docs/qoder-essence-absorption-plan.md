---
capability: qoder-essence-absorption
goal: 以 Qoder 0.4.8 反编译产物为对照样本，只汲取 agent 内核与桌面 UI/UX 的行为合同与体验精华，不做形态复刻；用 Q-MATRIX 地毯式对照确认更新点，按 Q0–Q9 多波次落地，把 Petri 的存量机制变成用户可感、可审计、可恢复的一流体验。
acceptance:
  - 方向级验收 = 各波以独立工作包立项后按其 plan 验收为准；本文件只承载对照矩阵、波次判据与排序，不承载运行时证据
  - 总纲达成判据 = Q-MATRIX 中全部 🟡/🔴 行在收口波次后有明确落点（✅ 实现并有证据，或经用户显式裁决 ⛔），且「已有且不弱」清单无一被重复实现
  - 每波出口 = 定向测试 + 前端测试 + dev-verify 实机 flow + UI 台账条目 + 截图/断言证据；无实机证据不得标 verified
  - 插件架构 = B（§2.5）；联网检索/抓取 = Q2b（DeepSeek Search/Fetch 首 provider，默认关）；电脑控制 = Q9 启用项；三者独立立项验收，本文件不承载运行时证据。
reopen: 波次启动逐波用户发令（单工作包串行不变）；Q-MATRIX 重估 = Qoder 对标样本换代 / 用户对标尺改判 / G1+ 阶段启动；DeepSeek Search/Fetch 价格/限流/字段变更需复核；插件 host API 版本变更需重估；hooks 与 i18n 仍按 stage-3-4 runlist 的 ⛔ 门处理，除非用户显式解锁
status: planned
---

# Qoder 0.4.8 精华汲取总纲（QODER-ESSENCE-ABSORPTION）

> 立项溯源（用户裁决，2026-10-20）：「能做的当然都要做，做个巨无霸计划，地毯式对比确认更新的点。并建立多波次详细升级计划，记住不是要复刻形式，是要汲取精华完善内容和优化使用体验。」
>
> 对标样本：`D:\1.WorkDir\reverse\qoder-0.4.8\`（Qoder 0.4.8 CN，win32-x64，Electron 43.1.1；已有 `REPORT.md` / `sections/01–43` / `data/` / `src/` 反编译树）。
>
> 职责分工：本文件 = Qoder 对标增量清单、Q-MATRIX、波次判据与排序的 canonical；**方向母纲**是 [`agent-competitiveness-program.md`](./agent-competitiveness-program.md)（ZCode/Codex 行业标尺）。本文件不重开母纲已完成的 CP-1–CP-22，只登记 Qoder 样本暴露出的**新增或更细**的体验点。排队序唯一登记在 [`pending-work-backlog.md`](./pending-work-backlog.md)；波次发令时才入队列。
>
> 阶段纪律：G0 开发期常态 · 不外推 packaged/Provider/GA。hooks 产品化与 i18n 资源层仍按 [`stage-3-4-execution-runlist.md`](./stage-3-4-execution-runlist.md) §「不在本表范围」的 ⛔ 门处理；Worktree 仍按 `G0-RS-WT0 deferred`，本计划不重启。

## 0. 先回答：上一轮分析全面吗？

上一轮回答覆盖了 **agent 内核**（工具/权限/子代理/提示词/编排/MCP/崩溃/端点），结论仍成立；但**前端 UI/UX 只给了总表，没有做面到面的行为对照**。本轮补全：

1. **Qoder 侧**：把 `sections/24–29` 的渲染层结构与 `data/ui-i18n-zh.tsv`、`data/ui-feature-index.tsv`、`data/feature-to-handler.tsv` 交叉，再下钻反编译模块，拿到审批卡、计划卡、会话时间线、composer、团队、工作区标签、产物预览、外壳可靠性的**交互合同**（字段/状态机/文案/失败分支）。
2. **Petri 侧**：把 `docs/ui-productization-audit.md` 的 372 条 UI 台账与 `frontend/src` 实际组件逐面核对，区分「已有且不弱 / 部分可增强 / 真缺 / 阶段禁区」。
3. **输出**：本文件的 Q-MATRIX（102 个对照点）+ Q0–Q9 十波计划（含 Q2b 联网检索、Q4b 工作流与 Q-DOMAIN 垂直去核化三个子波）。任何一条 🟡/🔴 都有波次归属；任何一条 ✅ 都写明「不要重建」的理由。

## 1. 证据与方法

### 1.1 Qoder 侧证据

| 证据面 | 用途 | 位置 |
| --- | --- | --- |
| 渲染层结构 | surface 分发、preload 面、UI→channel→handler 四段链 | `sections/24-renderer-surfaces.md`、`sections/25-ui-to-channel-chain.md`、`sections/28-feature-to-handler-index.md` |
| UI 功能面 | 主包切开、中文文案全表、功能→模块索引 | `sections/26-ui-feature-surface.md`、`data/ui-i18n-zh.tsv`、`data/ui-feature-index.tsv` |
| 审批卡 | 变体/意图解释/命令预览/允许范围/失败分支 | `src/renderer/renderer__CMOdY8kL/permission/01871_PermissionCard.js`、`.../DIR8HOYO/permission/02934_mB.js` |
| 会话/团队/速记 | 团队 roster、后台子代理、后台进程、侧边任务、目标、composer、划词、速记、工作区标签、产物预览 | `src/renderer/renderer__DIR8HOYO/agent/02937_u21.js` |
| 时间线/轨迹 | 活动卡类型、执行轨迹筛选、工具输入/过程/响应、recorded-only 诚实 | `src/renderer/renderer__DIR8HOYO/permission/02938_h21.js` |
| Composer | 上下文标签、权限档、模型档、附件、建议、语音、发送 | `src/renderer/renderer__DIR8HOYO/permission/02936_d21.js` |
| 外壳可靠性 | 通知/启动/崩溃同意/渲染错误/更新/退出/托盘/深链 | `src/renderer/renderer__DIR8HOYO/permission/02930_r21.js` |
| Workflow/StructuredOutput | 脚本编排 API、schema 输出、journal/resume | `data/pretty/qoder-worker-runtime.deob.pretty.js:83340`、`:126496`、`:127224` |
| updatedInput | 审批可改写输入 + 审计事件 | `data/pretty/qoder-worker-runtime.deob.pretty.js:92559`、`:11549` |
| Hooks / MCP | 事件枚举、exec-form、per-server trust、OAuth | `sections/11-agent-and-mcp-internals.md` §3/§5、pretty `:83304` |

### 1.2 Petri 侧证据

- UI 台账：`docs/ui-productization-audit.md`（372 条，最近 UI-528）。
- 会话：`frontend/src/components/copilot/SimpleChat.tsx`、`ConversationTimeline.tsx`、`ToolActivityList.tsx`、`ToolActivityDock.tsx`、`ContextBudgetBar.tsx`、`RunStatsBar.tsx`、`LlmTranscriptViewer.tsx`、`CommandPalette.tsx`。
- 审批/计划：`SimpleChat/GuardAckCard.tsx`、`SimpleChat/PlanApprovalCard.tsx`、`agent-tool-policy.js`。
- 多智能体：`AgentRunPanel.tsx`、`OrchestrationGraph.tsx`、`spawn-agent-tools.js`、`subagent-profile.js`。
- 工作区/成果：`WorkingTreeReview/`、`BottomTerminal.tsx`、`BrowserPanel.tsx`、`ResultArtifactShell.tsx`、`viewerRegistry.ts`、`conversationChangesStore.ts`。
- 设置/记忆：`DesktopSettingsPanel/`、`MemoryPanel`、`AgentRulesPanel`、`KeymapPanel`、`ReasoningDefaultsPanel`。
- 自动化占位：`ScheduledWorkspacePanel.tsx`（「定时分析…即将推出」）。
- 母纲：`docs/agent-competitiveness-program.md`（CP-1–CP-22）。

### 1.3 边界与方法

- 只读分析，不执行 Qoder 代码、不实例化其 wasm、不发网络请求。
- **只借行为合同与结构形状，不搬代码/资产**；Qoder `out/` 自研代码、内联 wasm、SecurityGuardSDK、第三方 SDK 均无再分发授权。
- 视觉一律走 Petri 设计 token（`$petri-css-theme` / 设计宪章 BLOCK-167），不复制 Qoder 皮肤。
- 所有新依赖默认「不加」；确需（如 PPTX/DOCX 渲染）先过 `references/DEPENDENCY-CHECKLIST.md` 并取得用户裁决。

## 2. 三条横切线（先立规矩）

1. **借魂不借形**：只吸收「状态可见、来源可追、动作可达、风险可逆、成本可控、局部可审计」这些体验法则；不复制 Qoder 的 VS Code 式皮肤、云侧账号/额度/数据政策、宠物/语音浮层。
2. **存量优先**：Petri 已有且更深的 18 个面（见 §3）一律不重建；只做接线、投影、文案与状态补齐。
3. **单工作包串行**：Q0–Q9 逐波发令；同一时间只有一个 active BLOCK。波内允许并行子任务，但文件面必须隔离。

### 2.5 插件架构与联网/电脑控制口径（2026-10-20 用户裁决增补）

**插件化口径 = B：边缘插件化、内核不插件化**（用户 2026-10-20「按照推荐的来」）。不是 dsh 式「一切皆插件」。

- **不可插件化的内核**：agent loop、审批/策略、事件账本、数据/产物真值、上下文预算、模型网关/凭据、IPC 安全边界。
- **提供 host API、只允许贡献的宿主面**：统一 tab、`@` 菜单、命令、MCP/扩展治理、viewer host、agent role host、定时任务 host。
- **可插件化**：分析插件、skills、MCP server、连接器、viewer、UI 视图、agent 角色、定时任务类型。
- **结果面（Result Studio）**：它是**生信专属产品面**，不是通用文件浏览器；B 口径下由 pack 提供 `resultSurfaces`（viewers/compare/annotations/methods/export），核心只保留 artifact/truth/evidence/repository host 与 tab/viewer 宿主；pack 缺失时不伪装通用结果页。
- **5 条默认**：①UI 插件走 iframe sandbox + 窄桥（复用 Gen UI）；②后端插件走外部进程/MCP/runtime，内核 in-process；③统一 manifest（id/version/kind/permissions/contributes）+ host API semver + capability negotiation，未知能力 fail-closed；④复用 pack 权限词表 + MCP 信任位 + `permission.resolved` 审计；⑤G0 只做本地 pack/sideload，不做 marketplace/云。
- **落地位置**：Q0.5 ADR（§6-Q0.5）；Q2 连接器/上下文源、Q4 agent role 贡献、Q5 统一 tab 作为 view plugin host、Q6 viewer/批注贡献、Q8 manifest/权限/生命周期/深链安全。
- **Qoder 自身的证据**：核心工具宇宙 41 枚（含 `WebSearch`/`WebFetch`/`ImageSearch`）+ 浏览器连接器 + **插件化** `qoder-computer-use`（随包离线插件 + `qoder.computer-control` 技能 + 原生 addon + 插件宿主）。它不是「一切皆插件」，正好支持 B。

**联网检索与电脑控制现状（2026-10-20 实码核查）**：

| 能力 | Petri 现状 | 结论 |
| --- | --- | --- |
| 公网搜索 | 无 `web_search`；`query/read_page/search` 是项目资源/内容插件教程/项目记忆；`knowledge_search` 是本地知识库 | **缺一等工具**；`tool-router.js` 的 browser 域描述「网页浏览/搜索」与实际工具面不符（claim drift，待修） |
| 网页抓取 | 无 `web_fetch`；`defuddle` 技能 + CLI 可把单个 URL 提取成 markdown（本机已装），但不是搜索、无来源/引用/权限统一面 | **有 skill 级近似，缺一等工具** |
| 电脑控制 | 8 个 `computer_*` 工具 + macOS/Windows sidecar 源码 + block48/63 测试；但 `sidecars/*/bin/` 未构建，当前调用报 `sidecar_not_built` | **实现面在库，本机未就绪**；Q9 启用 |
| 浏览器 | `BrowserPanel` 是 UI；Agent 无网页操作工具 | **UI-only**；浏览器连接器属 Q9/后续 |

**DeepSeek Search/Fetch 作为首个联网 provider**：见 Q2b。它是用户自配的可选外部 provider（默认关、出站审计、成本可见），不是 Petri 云服务；不违反 §10「不做云侧」。

### 2.6 外部接口边界（Qoder 专属接口一律不复刻）

**规则：只借行为合同，不借接口/账号/SDK；能本地实现就本地，不能本地实现就用用户自配的第三方 provider（默认关、可审计）；Qoder 专属外部接口一律不复刻。**

| Qoder 专属外部面 | 用在哪 | 我们的处置 |
| --- | --- | --- |
| `/api/v1/webSearch/unifiedSearch`、`/oneSearch`、`/algo/api/v1/webSearch/oneSearch`、`/algo/api/v2/service/pro/imageSearch` | Qoder WebSearch / ImageSearch | **不复刻**；Q2b 用 DeepSeek/本地 SearXNG/MCP 的 provider 抽象，默认关 |
| `/sdk/browser-use/v1`、`@qoder-space/browser-use`、browser-connector native messaging | Qoder 浏览器连接器 | **不复刻 Qoder SDK/端点**；L3 只保留行为合同，Petri 自建连接器或复用 `BrowserPanel`，未定前 deferred |
| Qoder 云模型路由 / 账号 / 额度 / 13 个 model purpose | Qoder 模型层 | **不复刻**；Petri 用自己的 model gateway 与用户凭据 |
| Qoder cloud auth / PAT / Lark / collaboration | 审批变体 / OAuth | **不复刻**；A7 只借审批卡形态，Q8 OAuth 走目标 MCP server 自己的授权端点 |
| Qoder marketplace / 扩展注册 / cloud collaboration / QMind / Sites / cloud-automation | Qoder 云服务 | **不复刻**；Petri 只做本地 pack/skills/MCP 与自有联邦 |
| Qoder update / signing / UMID / SecurityGuard / fast-update | Qoder 发行与安全基础设施 | **G1+ 且不复刻**；本计划不涉及 |
| ImageGen / VideoGen / VideoGenRetrieve | Qoder 生成式媒体 | **L7 ⛔**；不做云端生成媒体 |

**允许的外部面（不是 Qoder 专属）**：DeepSeek Search/Fetch（Q2b，用户自配 key、默认关）、第三方 MCP server（Q8，用户信任位/默认拒绝/审计）、现有模型 provider（用户自配）。这些是 Petri 自己选择的 provider，不是 Qoder 端点。

## 3. Petri 已有且不弱（不要重建清单）

> 这些面在 Petri 已有实现或台账 verified；Qoder 只作对照，不立项。任何波次若触碰它们，只允许 additive 接线，不允许换一套。

| # | 面 | Petri 证据 | 与 Qoder 的关系 |
| --- | --- | --- | --- |
| 1 | 工作区审阅/历史/blame/stash/提交 | `WorkingTreeReview/`、UI-204–UI-249 | Petri 更深；不借 Qoder 的 per-turn patch 形态 |
| 2 | 上下文水位/预算环/运行计量 | `ContextBudgetBar.tsx`、`RunStatsBar.tsx`、UI-523 | Petri 更深；不重做 |
| 3 | 记忆事实/替代链/审计 | `MemoryPanel`、UI-510、BLOCK-182 | Petri 更深；不借 Qoder 的云同步记忆 |
| 4 | 设置搜索/分区/导出/导入/重置 | UI-514–UI-518、BLOCK-200/201 | Petri 更深；不重做 |
| 5 | 键位单源/推理档位 | UI-514/515、BLOCK-200 | Petri 更深；不重做 |
| 6 | 编排 DAG | `OrchestrationGraph.tsx`、UI-501 | Petri 已有；Qoder 的 team roster 是另一种面，见 Q4 |
| 7 | 审批风险片段 + 两步武装 + requestId | `GuardAckCard.tsx`、UI-509 | Petri 独有；Q1 只补「意图解释/范围选项/可改写参数」，不替换武装语义 |
| 8 | 队列/steer/插队/编辑/排序 | BLOCK-178、UI-508 | Petri 已对齐或更深；不重做 |
| 9 | 侧边任务/侧聊/悬浮卡 | `SideChatDock.tsx`、UI-448 | Petri 独有；不借 Qoder 的 side chat 形态 |
| 10 | 命令面板 | `CommandPalette.tsx`、UI-528 | Petri 已对齐；只可在 Q2 增加上下文命令 |
| 11 | 文件多 tab/拖拽排序/关闭菜单 | UI-451 | Petri 已对齐；Q5 只做「统一工作面」抽象，不重做文件 tab |
| 12 | 终端多 tab/上限 | `BottomTerminal.tsx`、UI-363 | Petri 已对齐；Q5 只评估分屏 |
| 13 | 内置浏览器 | `BrowserPanel.tsx` | Petri 已有；不重做 |
| 14 | 扩展中心/技能货架/依赖徽章 | UI-480/506/507/527 | Petri 已对齐或更深；Q8 只补 MCP 治理与自进化建议 |
| 15 | 结果产物/血缘/查看器/分屏/选择总线 | Result Studio、UI-460/463/464/465 | Petri 独有且**生信专属**；Q-DOMAIN P2b 把 resultSurface 下沉 pack，核心只留 artifact/truth/evidence host；Q6 只补「批注→加入任务」；**不得通用化** |
| 16 | 知识空间/检索/引用 | KnowledgeSpacePanel、BLOCK-160 | Petri 独有；不借 Qoder 的 knowledge center 形态 |
| 17 | SSH/联邦/投影 | UI-468/471/482/512 | Petri 独有；不借 Qoder 的云协作 |
| 18 | 主题/字号/动效/设计 token | UI-488/489/525、BLOCK-167 | Petri 更深；不复制 Qoder 视觉 |

## 4. Qoder 的十条体验精华（不是十个功能）

1. **每个异步面都有状态机**：`queued / preparing / thinking / usingTool / waitingConfirmation / background / stopping / completed / failed / stopped`（`agentRunStage`），并且状态文案、颜色、可执行动作同源。
2. **每个输出都有来源**：文件改动区分「当前工作区版本」与「工具记录内容」（`generatedFiles`），计划有 `pending/approved/accepted` 与 `edited/notEdited`，回复有「由 AI 生成」披露。
3. **每个选择都有动作**：划词即可复制/加入任务/侧聊提问/加入速记/批注（`selectionActions`、`selectionAnnotations`）。
4. **每个风险动作都有预览、确认、撤销/回退、部分失败诚实**：审批命令可折叠、计划可反馈、编辑重发可回退文件并提示「部分修改未完整记录」。
5. **每笔昂贵操作都是显式 opt-in + 硬预算**：Workflow 需要用户明确说「workflow/ultracode/fan out」；`budget` 是硬上限，花完 `agent()` 直接抛错；有界覆盖必须 `log()` 说明丢了什么。
6. **每个列表都有空/载/错/部分态，且不静默截断**：执行轨迹有 `recordedOnly` 说明、工具输出截断有标记、文件预览有「当前版本未提供渲染」的诚实降级。
7. **渐进披露**：审批卡命令 240px 折叠、计划正文可折叠、工具输入/过程/响应分段、思考默认收起。
8. **上下文装配是一等界面**：一个 `@` 菜单统一文件/技能/插件/连接器/Agent/任务/Issue，标签带来源与限制（附件 20、单指令、引用会话上限）。
9. **多智能体是「团队」不是「日志」**：leader/member、成员会话、整体停止、部分成员未确认的诚实回执、后台子代理暂停/停止/打开工作区。
10. **工作区是稳定标签面**：code/files/browser/changes/spec/terminal/evidence/agent/sidechat/plugin 统一标签，单例/序号/关闭菜单/固定身份；任务与文件不再散落在多个抽屉。

## 5. Q-MATRIX（102 点地毯式对照）

> 状态：✅ 已有且不弱（不重建） · 🟡 部分/可增强 · 🔴 真缺 · ⛔ 阶段禁区/不做。
> 「波次」列 = 建议归属；最终以波次立项时的 plan 为准。每波收口必须回写本表（只改状态与证据，不删行）。

### A. 信任与审批

| # | 体验面 | Qoder 0.4.8 行为（证据） | Petri 现状（证据） | 判定 | 汲取的精华 | 波次 |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | 通用工具审批卡 | 允许一次/本任务/始终/选项下拉；`allowOnce/allowSession/allowAlways/allowOptions` | GuardAckCard 三变体 + once/task/always 范围（BLOCK-243）；非 guard 触发的通用工具审批门未做 | 🟡 | 范围选项与审批语义分层 | Q1 |
| A2 | 审批意图解释 | 「解释」按钮、分析中骨架、失败仍可允许/拒绝 | 确定性意图解释已交付（BLOCK-243）；模型/本地模型解释未做 | 🟡 | 让用户「看懂再批」 | Q1 |
| A3 | 命令预览折叠/展开 | 240px 上限、`line-clamp-2`、展开完整内容 | 风险片段高亮 + 长命令折叠（BLOCK-243） | ✅ | 渐进披露 + 风险可见 | Q1 |
| A4 | 审批可改写参数 | `updatedInput` 执行前替换，审计记原始/生效 | updatedInput 重校验 + 一次性参数替换 + 审计（BLOCK-243） | ✅ | 审批从闸门升级为控制面 | Q1 |
| A5 | 重复工具调用检测 | 同参连续 N 次提示可能循环，继续/终止 | pending 重复合并/计数（BLOCK-243）；同参连续 N 次循环检测 + 继续/终止未做 | 🟡 | 防死循环的显式确认 | Q1 |
| A6 | 多请求排队计数 | `pendingCount`「还有 N 个权限请求」 | pendingCount + duplicatePending（BLOCK-243） | ✅ | 多审批不淹没 | Q1 |
| A7 | 审批变体 | MCP / PAT / Lark / 目录 / 协作 / sideTask 变体 | MCP trust 审批变体已交付（BLOCK-243）；sideTask 变体未做；PAT/Lark/协作按 §2.6 不复刻 | 🟡 | 只借审批卡变体形态；Lark/PAT/协作服务不接入（§2.6） | Q8 |
| A8 | 工具允许/拒绝列表 | `agentToolAllow/deny` + 说明（允许不是「一律禁止」） | AgentRulesPanel + 全局策略；逐工具 allow/deny 完整面与放行说明未做（BLOCK-243 未覆盖） | 🟡 | 把「为什么放行」讲清楚 | Q1 |
| A9 | 审批审计 | `permission.resolved` 记 decision/reason/updated_input/duration | `task_events`、决策面板已有 | ✅ | 不重建；Q1 只补字段 | — |
| A10 | 两步武装 | 无 | `GuardAckCard` 先武装后使用 | ✅ | Petri 独有，不借 | — |

### B. 计划与目标

| # | 体验面 | Qoder 行为 | Petri 现状 | 判定 | 精华 | 波次 |
| --- | --- | --- | --- | --- | --- | --- |
| B1 | 计划批准三选一 | 开始实现/调整/暂不实施 | `PlanApprovalCard` 批准/清上下文执行/继续计划 | ✅ | Petri 已对齐且更细 | — |
| B2 | 计划反馈回路 | `requestChanges` 输入「告诉 Qoder 计划需要如何调整」 | 无 | 🔴 | 计划不是只读弹窗 | Q2 |
| B3 | 计划版本/状态/复制/下载 | `specArtifact` 版本 tabs、pending/approved/accepted、copy/download | Q5 计划面基础（BLOCK-216）；修订版本 tabs 未做 | 🟡 | 计划作为可追溯产物 | Q5 |
| B4 | 目标模式 | active/completed/paused/blocked/usage/budget + elapsed | 无 | 🔴 | 长跑目标的状态机 | Q7 |
| B5 | 目标用量/预算受限 | `usageLimited/budgetLimited` | 只有成本上限提示 | 🟡 | 目标级预算可见 | Q7 |
| B6 | 目标工具契约 | GetGoal/CreateGoal/UpdateGoal 三件 | 只有 `spawn_agent` 的 goals 参数；无独立目标工具 | 🟡 | 目标可查询/可更新 | Q7 |

### C. 会话与消息

| # | 体验面 | Qoder 行为 | Petri 现状 | 判定 | 精华 | 波次 |
| --- | --- | --- | --- | --- | --- | --- |
| C1 | 时间线/锚点/滚到最新 | `anchorNav`、`scrollToLatest`、turn fallback | `ConversationTimeline` 已有；无锚点导航 | 🟡 | 长会话快速定位 | Q3 |
| C2 | 活动卡类型 | 思考/工具/文件改动/命令/压缩/子代理/提问/失败/图像生成 | Petri 多数已有；缺压缩/提问/hook/失败卡 | 🟡 | 事件类型完整、状态同源 | Q3 |
| C3 | 执行轨迹视图 | 对话/轨迹切换、9 类筛选、跟随最新、recorded-only | `LlmTranscriptViewer` 是模型 I/O，不是事件轨迹 | 🔴 | 事件级可观测 | Q3 |
| C4 | 消息动作 | 复制 MD/加入任务/从回复建分支/评价/结果统计 | 复制/导出/编辑已有；无分支/加入上下文/评价 | 🟡 | 每条消息可再利用 | Q2/Q3 |
| C5 | 编辑重发 + 文件回退 | 回退本轮文件修改并重发；部分未记录时诚实警告 | 编辑重发已有；workspace-checkpoint 回退未做（BLOCK-243 明确 reopen） | 🔴 | 可逆的对话修正 | Q1 |
| C6 | 队列/steer/插队/打断 | send now/steer/interrupt and run/edit/reorder | BLOCK-178 已对齐 | ✅ | 不重建 | — |
| C7 | 后台子代理面板 | 运行/暂停/停止/打开工作区/阶段性回复 | `AgentRunPanel` 有中断/留言/续派；无暂停 | 🟡 | 长任务可暂停 | Q4 |
| C8 | 后台进程面板 | 日志/停止/命令折叠/失联 | `ToolActivityDock` 已对齐 | ✅ | 不重建 | — |
| C9 | 侧边任务/侧聊 | 独立会话、继承上下文、文件变更 | `SideChatDock` 已对齐 | ✅ | 不重建 | — |
| C10 | 团队活动/关联会话 | leader/member、需要处理、查看执行 | 无 | 🔴 | 团队不是黑盒 | Q4 |
| C11 | 图片预览 | 缩放/复制/保存/多图/缩放预设 | `ImagePreviewModal` 已有 | 🟡 | 补保存/多图导航即可 | Q2 |
| C12 | 划词操作 | 复制/加入任务/侧聊提问/加入速记/批注 | `selectionBus` + 引用已有；无速记/批注 | 🟡 | 选中即行动 | Q2/Q6 |
| C13 | 速记板 | 片段/图片/搜索/来源会话/图片批注 | 无 | 🔴 | 学习型产品的捕获面 | Q2/Q6 |
| C14 | 后续建议/提示词润色 | `followupSuggestions`、`polishPrompt` | Gen UI follow-up 已有；composer 无 | 🟡 | 降低下一句成本 | Q9 |
| C15 | 统一 `@` 上下文菜单 | 任务/指令/Skill/插件/连接器/Agent/文件/会话 | 文件引用 + 斜杠；未统一 | 🟡 | 一个入口装配上下文 | Q2 |
| C16 | 附件形态 | 文件夹/选中文本/选中代码/应用快照/20 上限 | 图片/文件已有；缺文件夹/代码/快照 | 🟡 | 上下文形态完整 | Q2 |
| C17 | 跨会话引用 | `chatSessionDrop`、引用上限 | 无 | 🟡 | 会话作为上下文资源 | Q2 |
| C18 | 语音/实时语音/纪要 | live voice、纪要、超时、权限错误 | 无 | ⛔ | 与当前主线不符，暂不做 | — |
| C19 | 结构化提问 | AskUserQuestion（选项/多选/自由输入） | 无结构化提问；审批卡/guard 确认不是 AskUserQuestion（Q1/Q2 未做） | 🔴 | 让 Agent 在长任务中可结构化提问 | Q1/Q2 |

### D. 模型与权限选择

| # | 体验面 | Qoder 行为 | Petri 现状 | 判定 | 精华 | 波次 |
| --- | --- | --- | --- | --- | --- | --- |
| D1 | 模型选择器状态 | 分类/失效/无权限/Workspace 限制/加载失败/低峰折扣 | 目录状态/缺密钥/隐藏逐行可见（BLOCK-224）；低峰折扣/权限/价格/缓存未做 | 🟡 | 失败可解释 | Q9 |
| D2 | 每模型思考/上下文/可见性 | 模型设置表：effort/contextWindow/visible | 逐模型可见性/上下文/默认思考档（BLOCK-224） | ✅ | 模型能力透明 | Q9 |
| D3 | 访问权限选择器 | 三档描述 + 完全访问确认（能力清单/风险提示） | 四档选择器已有；完全访问确认弹层未做（BLOCK-243 明确 reopen） | 🟡 | 高危档位显式确认 | Q1 |
| D4 | 自动选模型 | Auto 档 | Auto 按任务/附件选模（BLOCK-225）；复杂度/成本权重/审计/覆盖确认未做 | 🟡 | 任务适配 | Q9 |

### E. 工作区与文件

| # | 体验面 | Qoder 行为 | Petri 现状 | 判定 | 精华 | 波次 |
| --- | --- | --- | --- | --- | --- | --- |
| E1 | 统一工作面标签 | code/files/browser/changes/spec/terminal/evidence/agent/sidechat/plugin | Q5 右轨统一（BLOCK-216）；工作区 URL 模式/底部终端/侧聊仍各宿主 | 🟡 | 工作面稳定可寻 | Q5 |
| E2 | 标签关闭菜单/单例/序号 | close others/right/all、single、ordinal | **Q5 已交付**：统一 close/others/right/all、单例/序号模型、按项目持久化、tab 右键菜单；文件 tab 原有关闭策略保留 | ✅ | 标签生命周期一致 | Q5 |
| E3 | 生成文件视图 | 当前工作区版本 vs 工具记录、空/错/无证据 | **Q5 已交付生成文件面**：会话改动 + 工作区版本/工具记录来源 + empty/loading/error/no-evidence 四态；工具记录无内容时如实说明 | ✅ | AI 产物可追溯 | Q5 |
| E4 | 文件预览动作 | 默认应用打开/文件管理器显示 | 系统应用打开已有；file:show-in-folder IPC 已补（BLOCK-216），OS 文件管理器实际行为未点验 | 🟡 | 系统级衔接 | Q5 |
| E5 | 文档产物批注 | PDF/PPTX/DOCX/XLSX/图片 → 批注加入任务 | PDF/图像矩形批注 + 椭圆/箭头入口（BLOCK-219/238）；画笔/文字/马赛克/Office/文本批注未做 | 🟡 | 读-批-问闭环 | Q6 |
| E6 | 内置浏览器 | 有 | `BrowserPanel` 已有 | ✅ | 不重建 | — |
| E7 | 电脑使用画中画 | PiP 显示/隐藏/会话级隐藏 | Windows sidecar/status/probe/设置面板（BLOCK-229）；macOS/PiP/真实 click-type 未做 | 🟡 | 自动化过程可见 | Q9 |
| E8 | 终端多 tab/上限 | 有 | `BottomTerminal` 已有 | ✅ | 不重建 | — |
| E9 | 终端分屏 | terminal split limit | 无终端分屏；Q5 明确 deferred | 🟡 | 多命令并行 | Q5 reopen |
| E10 | 审阅/历史/blame | per-turn patch + push | Petri 更深 | ✅ | 不借 | — |
| E11 | 工作树 UI | Enter/Exit/恢复/清理 | G0 deferred | ⛔ | 阶段禁区 | — |
| E12 | Notebook 单元格编辑 | NotebookEdit（cell 级读写/执行） | 无 Notebook cell 级编辑工具 | 🟡 | 数据科学工作流一等公民 | Q5 |
| E13 | 生信 Result Studio 结果面 | Qoder 无同等对照（其结果为通用 artifact 预览） | P2b 主 body + BLOCK-236 tab/compare（UI-544/545 实机未跑）；lineage/history/selection/revisions/annotations/methods/export 全量未做 | 🟡 | 结果页保持生信专属；核心只做 artifact/truth host | Q-DOMAIN P2b reopen |

### F. 多智能体与编排

| # | 体验面 | Qoder 行为 | Petri 现状 | 判定 | 精华 | 波次 |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | 团队 roster | leader/member/成员会话/整体停止/部分确认 | DAG + AgentRunPanel；无 roster/stop-all | 🔴 | 团队是一等实体 | Q4 |
| F2 | 子代理角色标签 | 前端/后端/QA/评审/调研/UX/运维/诊断等 | `agent-roles` 已有 | ✅ | 不重建 | — |
| F3 | 结构化输出 | `agent({schema})` 强制 `StructuredOutput` + 校验 + 重试上限 | spawn 只回文本 | 🔴 | 结果机器可验 | Q4 |
| F4 | 子代理工具约束 | `disallowedTools/additionalTools/requiredTools/omitAgentsMd` | profile 只有 role/model/concurrency/reportGuard | 🔴 | 最小权限子代理 | Q4 |
| F5 | 子代理 journal | `journal.jsonl` 一行一结果；诊断前先读 | 有 task_events；无运行级 journal | 🔴 | 可诊断的编排 | Q4 |
| F6 | 编排 DAG | 有 team 视图 | Petri DAG 已有 | ✅ | 不重建 | — |
| F7 | 多窗格/分屏 | panes split/maximize/resize | ArtifactPinPane 分屏已有；通用 pane split/maximize/resize 未做 | 🟡 | 通用窗格模型 | Q5 |
| F8 | 工作流脚本 | agent/parallel/pipeline/phase/log/budget/resume | 无 | 🔴 | 确定性多代理编排 | Q4b（大包，单列） |
| F9 | 代码库调查员 | CodebaseInvestigator（专用调查 Agent） | 有 codegraph_* 查询 + spawn_agent；无同名专用角色 | 🟡 | 调查可复核、可复用 | Q4 |

### G. 上下文、记忆与计量

| # | 体验面 | Qoder 行为 | Petri 现状 | 判定 | 精华 | 波次 |
| --- | --- | --- | --- | --- | --- | --- |
| G1 | 上下文水位/计量 | autoCompact 阈值/预警 | ContextBudgetBar/RunStatsBar 更深 | ✅ | 不重建 | — |
| G2 | 自动压缩状态 | compacting/noop/threshold/失败诚实 | compaction + 设置已有 | ✅ | 不重建 | — |
| G3 | 压缩摘要/转写指针 | 摘要 + transcript 指针 | 已有 | ✅ | 不重建 | — |
| G4 | 记忆事实/替代链/审计 | 记忆设置/同步 | MemoryPanel 更深 | ✅ | 不重建 | — |
| G5 | 记忆导入/迁移 | WorkBuddy/QoderWork 迁移 | 数据管理部分 | ⛔ | 云迁移不做 | — |
| G6 | 缓存命中/成本 | cache tokens/credits | ai_usage + UI-523 更深 | ✅ | 不重建 | — |

### H. 知识与成果

| # | 体验面 | Qoder 行为 | Petri 现状 | 判定 | 精华 | 波次 |
| --- | --- | --- | --- | --- | --- | --- |
| H1 | 知识空间/检索/引用 | knowledge center | Petri 更深 | ✅ | 不重建 | — |
| H2 | 结果产物/血缘/分屏/查看器 | 无同等 | Result Studio 独有 | ✅ | 不重建 | — |
| H3 | 证据/核验状态 | evidence tab / result status | Q5 证据槽位基础（BLOCK-216）；事件级轨迹随 Q3 | 🟡 | 证据面统一 | Q3/Q5 |
| H4 | 计划/规格 artifact 版本 | specArtifact | Q5 计划面基础（BLOCK-216）；修订版本 tabs 未做 | 🟡 | 计划可追溯 | Q5 |

### I. 自动化与任务

| # | 体验面 | Qoder 行为 | Petri 现状 | 判定 | 精华 | 波次 |
| --- | --- | --- | --- | --- | --- | --- |
| I1 | 定时任务 | cron/启停/运行历史/立即运行 | `ScheduledWorkspacePanel` 占位「即将推出」 | 🔴 | 科学分析可定时重跑 | Q7 |
| I2 | 自动化入口 | composer 插件「创建定时任务」 | 无 | 🔴 | 从一次分析到周期分析 | Q7 |
| I3 | 任务看板 | 「构建团队分析看板」提示 | 定时面板占位 | 🟡 | 多任务编排视图 | Q7 |
| I4 | 常驻任务意图卡 | 有 | `resident_task_*` 已更深 | ✅ | 不重建 | — |
| I5 | 计划提醒/唤醒 | ScheduleWakeup | 无 | 🟡 | 长跑提醒 | Q7 |

### J. 扩展与 MCP

| # | 体验面 | Qoder 行为 | Petri 现状 | 判定 | 精华 | 波次 |
| --- | --- | --- | --- | --- | --- | --- |
| J1 | 扩展中心/技能货架 | 有 | UI-480/506/507/527 更深 | ✅ | 不重建 | — |
| J2 | 技能自进化建议 | 建议列表/一键建任务/忽略 | 无 | 🟡 | 技能可演进 | Q8 |
| J3 | 插件视图 tab | plugin view host | Q5 surface host + pack views（BLOCK-216） | ✅ | 插件即工作面 | Q8 |
| J4 | MCP 信任/默认拒绝/OAuth/懒加载 | per-server trust、项目级默认不批准、authenticate tool、discovered_tool_ | HTTP OAuth（BLOCK-239）+ 懒加载（BLOCK-241）+ trust ask/destructive 门（BLOCK-243）+ 四 hint（BLOCK-240）；agent authenticate/stdio/SSE/非 destructive 默认策略未做 | 🟡 | 不可信 MCP 默认拒绝；OAuth 走目标 server 自己的端点 | Q8 |
| J5 | 深链安装安全警告 | 名称/来源/下载地址/大小/SHA-256/风险 | 深链安装安全面（BLOCK-242） | ✅ | 安装前看清来源 | Q8 |
| J6 | Agent builder | 自定义 Agent/角色 | agent roles 只有内置 | 🟡 | 用户自定义专长 | Q8/Q9 |

### K. 外壳、可靠性与个性化

| # | 体验面 | Qoder 行为 | Petri 现状 | 判定 | 精华 | 波次 |
| --- | --- | --- | --- | --- | --- | --- |
| K1 | 分段错误边界 | 应用/页面/预览/轮次/工具五级 | 页面/预览段错误边界（BLOCK-222）；轮次/工具/应用级未做 | 🟡 | 局部崩溃不白屏 | Q9 |
| K2 | 崩溃同意/本地解析 | consent + minidump 本地解析 | 本地崩溃记录/横幅（BLOCK-228）；minidump 解析/上传未做 | 🟡 | 隐私边界 + 证据 | Q9 |
| K3 | 退出/更新运行摘要 | 运行/后台/排队/等待交互计数 | 退出摘要三选一（BLOCK-223）；逐项操作未做 | 🟡 | 退出不误杀工作 | Q9 |
| K4 | 托盘/系统通知 | 托盘最小化、轮次完成/失败/权限/提问通知 | 系统通知/托盘/通知中心/免打扰（BLOCK-223/226）；点击跳转/系统历史/审批穿透/声音/类型开关未做 | 🟡 | 长跑可离开窗口 | Q9 |
| K5 | 命令面板 | 有 | UI-528 已对齐 | ✅ | 不重建 | — |
| K6 | 设置搜索/导出/重置 | 有 | UI-516/517/518 更深 | ✅ | 不重建 | — |
| K7 | 键位/推理档位 | 有 | UI-514/515 更深 | ✅ | 不重建 | — |
| K8 | 主题/字号/动效 | 有 | UI-488/489/525 更深 | ✅ | 不重建 | — |
| K9 | 引导/数据导入 | 首启 overlay/角色揭示/导入 | 角色揭示（BLOCK-227）；分步引导/数据导入未做 | 🟡 | 首启即建立心智 | Q9 |
| K10 | 国际化 | zh/en | i18n ⛔ | ⛔ | 阶段禁区 | — |
| K11 | 宠物/伴随/语音浮层 | desktop pet/companion/live voice | 无 | ⛔ | 与 Petri 人设不符 | — |
| K12 | 数据政策/积分/云额度/更新 | 有 | 不做云侧 | ⛔ | 本地优先 | — |

### L. 联网、电脑与插件宿主（2026-10-20 增补）

| # | 体验面 | Qoder 0.4.8 行为（证据） | Petri 现状（证据） | 判定 | 汲取的精华 | 波次 |
| --- | --- | --- | --- | --- | --- | --- |
| L1 | 联网搜索 | 核心工具 `WebSearch`，云端 `/api/v1/webSearch/unifiedSearch`、`/oneSearch` | 无公网搜索；只有本地 `knowledge_search`/项目检索 | 🔴 | 只借行为合同（summary/来源/权威度）；**不接 Qoder 端点** | Q2b |
| L2 | 网页抓取 | 核心工具 `WebFetch`，云端抓取 + 独立 model purpose | 无 `web_fetch`；`defuddle` 技能仅单 URL 提取 | 🔴 | 只借行为合同（URL→Markdown/来源）；**不接 Qoder 端点** | Q2b |
| L3 | 浏览器连接器 | Chrome/Edge 扩展 + native messaging + `/sdk/browser-use/v1` | `BrowserPanel` UI；无 Agent 网页操作 | 🟡 | 只借行为合同（浏览器可操作）；**不复刻 Qoder SDK/端点** | Q9 |
| L4 | 电脑控制 | 随包 `qoder-computer-use` 插件 + `qoder.computer-control` 技能 + 原生 addon | 8 个 `computer_*` + macOS/Windows sidecar（未构建）+ block48/63 | 🟡 | 只借行为合同（语义树+确认门）；**不搬 Qoder 插件代码** | Q9 |
| L5 | 插件宿主契约 | plugin host（utility process + WebContentsView）+ 离线内容寻址插件包 | Q5 surface/pack host API 已交付（BLOCK-216）；通用 utility-process host/sandbox 未做 | 🟡 | manifest + host API + sandbox | Q0.5/Q5 |
| L6 | 插件权限/生命周期/审计 | 深链安装显示来源/哈希/风险；插件离线包 | 深链安装（BLOCK-242）+ trust（BLOCK-243）已交付；插件生命周期/审计统一未做 | 🟡 | 默认拒绝 + 可授权 + 审计 | Q8 |
| L7 | 生成式媒体 | ImageSearch/ImageGen/VideoGen/VideoGenRetrieve | 只有 `read_image`（读图）；无图像/视频搜索与生成 | ⛔ | 不纳入 G0；重开=用户明确需求 + Provider 预算 | — |
| L8 | 垂直领域完全插件化 | Qoder 以插件/扩展承载领域能力 | P2-UI/P2b/P3/P4 结构片已交付；P4 高级 Result Studio/域中性白名单余项未清 | 🟡 | 核心零领域硬编码；领域能力随包交付；结果页仍生信专属 | Q-DOMAIN P2b reopen/P3/P4 |

> **工具宇宙映射（2026-10-20 抽查）**：Qoder 41 工具中，Monitor/TaskStop/BashInput/BashOutput/BashResize/TaskCreate/TaskGet/TaskUpdate/TaskList/UpdateTopic/CompleteTask 已有 process/terminal/todo/plan 等价物，不单列矩阵行；CodebaseInvestigator 记 F9（待核）；ImageSearch/ImageGen/VideoGen/VideoGenRetrieve 记 L7（⛔）；AskUserQuestion/NotebookEdit 记 C19/E12（待补）。

**矩阵统计（2026-10-22 BLOCK-243 回写，机械计数）**：✅ 32 · 🟡 47 · 🔴 16 · ⛔ 7 = **102 点**（A3/A4/A6/D2/J3/J5 → ✅；A2/A5/J4/L5 → 🟡；E5/E13/K*/D*/E7/L6/L8 现状按证据更新）。Q1–Q9 剩余以 §6.5 为准；⛔ 不进入波次。**口径已同步**：DOC-REGISTRY 注记与 §12 更新记录统一为 102/32/47/16/7。

## 6. 多波次计划（Q0–Q9）

> 排序原则：先补「用户可感的信任与上下文」（Q1–Q2），再补「可观测与编排」（Q3–Q4），再补「工作面与学习闭环」（Q5–Q6），再做「自动化与治理」（Q7–Q8），最后做「外壳与打磨」（Q9）。Q4b（工作流脚本）单列，避免吞掉 Q4a 的可交付性。

### Q0 — 基线与设计法（0.5–1 天，零产品改动）

**目标**：把本文件立成可执行基线，防止后续波次重复开发或漏项。

**交付物**
- 本文件（Q-MATRIX 102 点 + 10 条设计法 + 18 项「不要重建」）。
- 在 UI 台账追加一条 `UI-### Qoder 对标基线`（状态 `in_progress`，仅登记不改产品）。
- 在 `pending-work-backlog.md` 登记 Q0–Q9 + Q2b/Q4b 候选（计划性登记，不排队）。
- 明确每波的证据目录命名：`acceptance/<block-id>/`、`flow`、截图、断言 JSON。

**验收**
- `npm run docs:check`、`npm run ui:audit:check` 绿。
- 矩阵每行有「判定/波次/证据」三列；无空行、无未归属项。
- 不触碰任何产品代码与当前 BLOCK-211 WIP。

**不做**：不改任何组件、不引入依赖、不启动工作包。

### Q0.5 — 插件架构 ADR（0.5–1 天，零产品代码）

**目标**：在 Q1/Q5/Q8 动工前把 §2.5 的 B 口径落成可执行的 host 契约，防止 Q5 的 tab 模型与 Q8 的信任模型各自长出第二套插件协议。

**交付物**
- ADR：插件边界（内核/宿主/插件三层）、不可插件化清单、5 条默认（隔离/契约/权限/分发）。
- **三条领域归属规则**：①领域内容只进 pack（核心生产代码零领域词，domain-neutrality baseline 目标 0）；②结果数据/truth 留核心，结果页/UI 由 pack 的 `resultSurfaces` 提供；③新领域=新 pack，不改核心；host API 不够时泛化 host，不加领域分支。
- Manifest v1 草案：`id/version/kind/contributes/requires/permissions/hostApiVersion`；未知 kind/能力 fail-closed。
- Host API 草案（**11 类贡献点**）：skills、promptFragments、uiActions、view/tab、resultSurfaces、command、context source、agent role、viewer、scheduled job、dataModelExtensions；semver + capability negotiation。
- Result surface 契约：`id/domain/artifactTypes/viewers/compare/annotations/methods/export/emptyState/priority`；host 挂载 pack surface，卸载即移除；结果数据仍由核心 repository/artifact truth 读取，不建第二真相。
- 权限/审计映射：复用 pack 权限词表 + MCP 信任位 + `permission.resolved`；插件安装前显示来源/哈希/风险；G0 仅本地 pack/sideload。
- 迁移策略：现有分析插件/skills/MCP/领域包如何映射到新契约；不重写现有 `plugin-loader`/`pack-registry`，只加宿主层。

**验收**
- `docs:check`/`ui:audit:check` 绿；ADR 经用户过目；不改产品代码、不引入依赖。
- Q5/Q8 的 plan 必须引用本 ADR 的 manifest/host API/permission 章节；不得各自定义第二套。

**不做**：不做 marketplace/云分发；不把内核信任面插件化；不新建第二套插件注册表。

### Q1 — 信任与审批（约 1 周）

**目标**：把「审批」从闸门升级为可理解、可编辑、可审计的控制面；补齐可逆的对话修正。

**范围**
- A1/A2/A3/A4/A5/A6/A8 + C5 + D3。
- 审批卡 v2：变体（danger/info/warning/sideTask）、意图解释（先做服务端规则/本地模型可选，失败可继续）、命令折叠、明细项、配置链接、多请求计数、重复调用检测。
- 允许范围：一次/本任务/始终（任务级，结束失效），与现有 `GuardAckCard` 的「两步武装」共存而非替换。
- `updatedInput`：批准时编辑参数 → 重新跑 schema/preflight/policy → 重新计算指纹 → 审计原始/生效参数。
- 编辑重发：可选「回退本轮文件修改并重发」，复用 `workspace-checkpoint`；部分未记录时显式警告。
- 访问权限选择器：三档描述 + 完全访问确认弹层（能力清单/风险提示/可随时关闭）。

**后端依赖**
- `agent-tool-policy.js` 决策形状扩展（`updatedInput?`、`scope: once|task|always`）。
- `approval-request-store` 支持任务级范围与审计字段。
- `task_events` 增 `permission.resolved` 形状（decision/behavior/reason/updated_input/duration）。
- `workspace-checkpoint` 与编辑重发链路接线（若已有 checkpoint API，只接线）。

**验收**
- 契约测试：updatedInput 重校验、范围失效、重复调用检测、审计字段。
- 前端测试：审批卡四变体、命令折叠、意图解释三态、编辑重发回退。
- 实机 flow：mock provider 触发 guard → 意图解释 → 编辑参数 → 批准 → 审计可查；截图 3 张。
- 回归：现有 GuardAckCard/审批/队列测试全绿。

**风险**：编辑参数不得绕过风险策略；「始终」必须有界且可见；意图解释不得伪造，失败要如实降级。

> 2026-10-22：**BLOCK-243 已交付 Q1 主体**（A1 三变体+once/task/always 范围、A3 命令折叠、A4 updatedInput 重校验/一次性替换、A6 计数、MCP trust）。剩余见 §6.5 Q1-REM；矩阵已回写：A3/A4/A6 ✅，A2/A5/A7/A8/D3 🟡，C5/C19 🔴。

### Q2 — 上下文装配与捕获（约 1–2 周）

**目标**：把「上下文」从零散引用变成一个可理解、可限制、可复用的装配面。

**范围**
- C4/C11/C12/C13/C15/C16/C17 + B2。
- 统一 `@` 菜单：文件/文件夹/技能/插件/连接器/Agent/任务/结果产物/知识空间；每项带来源标签与限制。
- 划词操作：复制/加入任务/侧聊提问/加入速记；批注评论（先做文本批注，图片批注放 Q6）。
- 速记板：片段 + 图片 + 来源会话 + 搜索 + 加入任务；图片批注基础工具（矩形/箭头/马赛克/文字）放 Q6。
- 跨会话引用：任务作为上下文资源，带上限与不可用提示。
- 附件形态：文件夹（若后端支持）、选中文本/代码摘要、附件 20 上限提示。
- 消息动作：复制 Markdown、加入任务、从回复创建分支会话。
- 计划反馈：计划卡增加「告诉 Qoder 如何调整」输入。

**验收**
- 组件测试：@ 菜单过滤/上限/来源标签；划词动作；速记持久化/来源；计划反馈。
- 实机 flow：选文件+技能+任务 → 发送 → 引用标签在场；划词 → 速记 → 加入任务；截图 4 张。
- 诚实边界：不可用引用显示「（不可用）」；附件/引用超限明确提示，不静默丢弃。

**风险**：上下文膨胀与隐私；所有引用必须可见、可移除；速记是本地文件/DB，遵守数据目录治理。

### Q2b — 联网检索与抓取（约 1 周，DeepSeek Search/Fetch 首 provider）

**目标**：给 Agent 补上一等 `web_search` / `web_fetch`，但保持 Petri 的本地主权：provider 可插拔、默认关、出站可审计、成本可见、抓取内容按不可信处理。

**范围**
- 新工具：`web_search(query, count?, needContent?, site?, lang?, after?, before?, oriQuestion?)` 与 `web_fetch(url)`；返回统一信封（results/citations/source/provider/usage），不把 provider 原始字段直接漏给模型。provider 负责把 `site/lang/after/before` 映射为 DeepSeek 查询操作符（`site:`/`lang:`/`after:`/`before:`），工具层不直接暴露 provider 方言。
- **DeepSeek Search/Fetch 首 provider**（官方 2026-10-17 上线；指南 https://api-docs.deepseek.com/zh-cn/guides/search）：**不是 Qoder 的 webSearch 端点**——Qoder 云端 `/api/v1/webSearch/*`、`/algo/.../imageSearch` 一律不复刻；provider 由 Petri 自持，复用现有 DeepSeek 凭据。
  - Base `https://api.deepseek.com`；Bearer 鉴权（复用现有 DeepSeek 凭据，不明文入盘/日志）；`POST /v1/tools/search`、`POST /v1/tools/fetch`。
  - Search：`query` 1–128 字符必填；`count` 1–50 默认 10；`need_content` 默认 false；`ori_question`（用户原话）可选；`localization` 可选；支持 `site:`/`lang:`/`after:`/`before:`/引号/减号。响应含 `title/url/snippet(100–200)/summary(600–800，给模型)/date(UTC，nullable)/rerank_score(0–3，≥1.5 高质量)/authority/可选 content`。
  - Fetch：`url` 必须 HTTP/HTTPS、≤8192 字符、不得带用户名密码；返回 `title` + `content`（Markdown）；404=无正文、402=余额不足、403=安全策略、429=限流；408/429/5xx 退避重试。
  - 计费：每 1000 次成功且有结果的请求 ¥5（约 $0.75/1k）；`count` 不影响单价；失败/空结果/超时不收费。**注**：直接调用 DeepSeek API 自上线即按此计费；报道中的「2026-11-01 前免费」只适用于 DSH/Claude Code/Codex 的服务端工具调用，Petri 直连 API 不适用，以官方账单为准。**限流口径**：官方文档抓取显示 Search 100 QPS / Fetch 25 QPS，另有报道称账号级 5 QPS；实现前以官方文档复核，客户端做节流 + 429 退避，不把数值写死成唯一真相。
- **provider 抽象**：`WebRetrievalProvider`（search/fetch/capabilities）；DeepSeek 为首个实现；预留 `searxng`（本地自托管）与 `mcp`（第三方搜索 MCP）两种 provider；provider 由设置页选择，默认 `off`。
- **本地优先/安全红线**：①默认关，首次使用需用户显式开启并确认出站；②`web_fetch` 拒绝 localhost/私网/元数据地址（SSRF），限制重定向、大小、content-type、超时；③抓取正文按不可信输入处理（提示词注入隔离、引用块标注来源、不执行其中指令）；④审计只记 provider/query hash/url host/status/bytes/latency/成本估算，不记凭据与全文；⑤域名白/黑名单与每次/自动审批可配；⑥失败/空结果/被拒如实显示，不静默降级。
- **配置**：新族 `web-retrieval`（默认 off；provider、maxResults、needContent、maxBytes、timeoutMs、allowDomains/denyDomains、requireApproval），按 BLOCK-199 规则注册（默认值=现状、零新依赖、写侧未知键拒绝）。
- **UI**：设置页「联网检索」节（provider/凭据状态/测试连接/域名策略/成本提示）；聊天引用来源标签；失败与限流诚实提示。
- **非范围**：图片/视频搜索与生成见 L7（⛔，G0 不做）；浏览器连接器（L3）另属 Q9；不照搬 Qoder 云搜索账号/额度体系；不默认开启；真实调用不进入默认门禁。

**验收**
- 契约测试（mock HTTP，零真实 API）：Search/Fetch 请求形状、字段映射、空结果、402/403/404/429、超时、重试；SSRF/重定向/私网/超大响应/错误 content-type 拒绝；provider 切换与关闭；审计字段。
- 前端测试：设置节、来源标签、失败态；`web_search`/`web_fetch` 工具卡呈现。
- 实机 flow：mock provider 下完整「搜索→抓取→引用→回答」链；真实 DeepSeek 调用需用户显式预算，单独记录成本与引用，不混入默认门禁。
- 度量：每次调用的 provider/延迟/成本估算入 `ai_usage` 或专用台账；`test:changed` + `quality:types` + `closeout`。

**风险**：网页内容不可信（提示词注入/虚假来源）；SSRF 与抓取合规；DeepSeek 价格/限流/字段可能变更；真实调用成本与隐私边界。**默认关 + 显式授权 + 审计**是底线。

### Q-DOMAIN — 垂直领域去核化（生信 pack 完整性；跨波次轨道）

**目标**：把生信垂直从“执行层在 pack、知识/交互/结果/数据层仍在核心”的混合形态，逐步收敛为“**核心零生信硬编码 + 生信 pack 自包含**”。**结果页是生信专属产品面，不做通用化**；完全插件化不等于把 Result Studio 变成通用文件浏览器。

> 2026-10-20：**P1 已立项 [BLOCK-214](./block-214-qdomain-p1-pack-skills-plan.md)（completed）**——3 个生信 skill 迁入 pack + `provides.skills` + skill-registry 发现/卸载；**P2a prompt（[BLOCK-215](./block-215-qdomain-p2a-prompt-decoring-plan.md)，completed）**——核心 prompt 去生信化 + pack `promptFragments`；**Q5 host（[BLOCK-216](./block-216-q5-work-surface-host-plan.md)，completed）**——surface 注册表/tab 状态机/pack 贡献投影/`petri-pack://`/生成文件·计划·证据面；**P2-UI actions（[BLOCK-217](./block-217-qdomain-p2ui-actions-plan.md)，completed）**——核心 act 去域 + pack `uiActions` 动态描述/执行校验/前端 host ack；**P2b 垂直切片（[BLOCK-218](./block-218-qdomain-p2b-result-surface-plan.md)，completed）**——result mode 主 body 由 pack `resultSurfaces` 渲染，核心高级 tab 过渡；**下一包=Q6（批注）→ P3 → P4**。

**现状（2026-10-20 只读核对）**
- ✅ 已在 pack：7 个分析插件 + dormant、scripts、demo-data、confirmationHooks、artifactTypes。
- ❌ 核心残留：3 个生信 skills（`resources/skills`）；`agent-runner.js` 生信 prompt；`act-tools.js`/`plan-ui-tools.js` 单细胞动作与标签；`api-data.js`/`db/schema.js` 默认 `single-cell`；`methods-export.js`/`learning.js`/`result-scientific-compare.js` 生信语义；`core/shared-backend/tool-registry.js` 内联 10 个生信工具；域中性 baseline **135 键 / 326 处 / 49 文件**。
- Result Studio 当前是核心里的生信专属面（`frontend/src/components/result-studio/*` + `core/shared-backend/result-studio-*`），**不是 pack 提供**；这正是本轨道要解决的核心缺口。

**切片**
1. **P1 Skills（1–2 周）**：pack `provides.skills` + `skills/`；skill-registry 发现已安装 pack、卸载即隐藏；3 个生信 skill 移出 `resources/skills`；`skills:check` 在 pack 在位时仍 14/14、缺失时只剩通用 skills。
2. **P2 Prompt + UI actions（1–2 周）**：**P2a prompt（BLOCK-215，completed）**核心 prompt 去生信化 + pack promptFragments；**P2-UI actions（BLOCK-217，completed）**核心 `act` 去域（只留 6 个中性动作）+ pack `uiActions` 动态描述/执行校验/前端 host 分发 ack；核心不留单细胞动作/标签。真实生信动作随 P2b pack 结果面提供。
3. **P2b Result Surface（1–2 周）**：**垂直切片（BLOCK-218，completed）**——result mode 主 body 由 pack `resultSurfaces` 渲染（图/表/文本/report 源码），核心保留 context bar/composer 与 code/compare/history 过渡面，只读有界数据桥；**剩余 reopen**——lineage/compare/history/selection/revisions/annotations/methods/export 全量迁 pack。依赖 Q0.5 `resultSurfaces` 契约与 Q5 host；**结果页保持生信专属 UX**，不得通用化。
4. **P3 Methods / 学习 / legacy registry（1–2 周）**：`methods-export.js`、`learning.js`、`result-*-tools`、`artifact-profiles.js`、`agent-workflow.js` 生信内容下沉；删除 `core/shared-backend/tool-registry.js` 内联工具，保持单一注册源。
   > 2026-10-20：**垂直切片已立项并收口 [BLOCK-220](./block-220-qdomain-p3-methods-plan.md)（completed）**——化石注册表删除（单一注册源）+ methods 引用/工具标签下沉 pack `provides.methods`（pack 0.2.0），域中性 261→208 处。**reopen**：`_pythonEquivalent` 脚本模板（余 24 处主力）、`artifact-profiles`、`agent-workflow`、`learning`、`result-*-tools`。
5. **P4 数据模型 / 权限（2–4 周，独立结构包）**：`modality` 默认 `general`，pack 声明扩展值；单细胞权限分支改通用资源权限；迁移/兼容层；现有项目、Result Studio、导出、联邦过基线。

**验收**
- **pack 缺失**：无生信 skills/tools/prompt/UI 动作/result surface；结果页不伪装通用生信页，显示通用 artifact/evidence 或“安装生信包”。
- **pack 在位**：3 个生信 skills、7 个插件、生信结果面（viewers/compare/annotations/methods/export）全部出现；现有生信项目可读。
- **卸载**：skills/tools/prompt/UI/result surface 全部消失；数据/artifact truth 保留；无第二真相。
- **域中性**：baseline 135/326/49 → **0**；每片下调，不新增。
- **Result Studio**：生信专属 UX 保真（volcano/heatmap/DEG/table/lineage/单细胞），不得被 Q5 压成通用文件浏览器。

**非范围**：不把 artifact truth/repository/lineage 原语搬进 pack；不做通用化结果页；不做第二套 result/annotation truth；不引入新依赖；不把内核插件化。

### Q3 — 执行轨迹与可观测性（约 1 周）

**目标**：让用户能看懂「这一轮到底发生了什么」，并能定位失败。

**范围**
- C1/C2/C3/H3 + K1。
- 会话/轨迹双视图：事件级时间线，支持按工具/文本/思考/错误/压缩/用户/助手/系统筛选；跟随最新；`recordedOnly` 诚实说明。
- 活动卡补齐：上下文压缩、等待回答、轮次失败卡、文件改动 diff 不可用/过大/无写入前内容三种诚实态。
- 分段错误边界：轮次级、工具级、预览级，局部失败不白屏。
- 证据面：把 artifact truth、决策事件、task_events 聚合成一个可筛选的 evidence 视图（可与 Q5 的 evidence tab 合并）。

**验收**
- 组件测试：筛选/跟随/空态/截断标记；错误边界注入测试。
- 实机 flow：真实/模拟长会话 → 切换轨迹 → 筛选 → 定位失败；截图 3 张。
- 不重复 `LlmTranscriptViewer`：轨迹是事件级，transcript 是模型 I/O，二者互相链接。

**风险**：事件量大；前端要虚拟化/分页；不得把未上报的时间/耗时显示成 0。

### Q4 — 多智能体团队（Q4a，约 1–2 周）

**目标**：把子智能体从「一个面板」升级为「一个团队」。

**范围**
- C7/C10/F1/F3/F4/F5。
- 团队 roster：leader/member、成员会话、当前会话、整体停止（部分成员未确认时诚实回执）。
- 后台子代理：暂停/恢复（若后端支持）、停止、打开工作区、阶段性回复引用。
- 结构化输出：`spawn_agent` 可选 `schema`，隐藏 `structured_output` 工具，校验失败重试上限；结果机器可读。
- 子代理工具约束：profile 增 `tools:{allow,deny}`，只收紧；`omitAgentsMd`；禁工具时同步禁用对应 agent 类型。
- `journal.jsonl`：每次多代理运行一个目录，一行一个 agent 的最终返回值 + 血缘；提示词加「诊断前先读 journal」。

**验收**
- 后端契约测试：schema 校验/重试上限/tool deny 级联/journal 落盘。
- 前端测试：roster/成员切换/整体停止/部分确认。
- 实机 flow：主代理派 3 个子代理 → roster 可见 → 打开成员 → 停止团队 → 部分确认回执；journal 可读；截图 3 张。

**风险**：团队停止的竞态；部分确认必须如实；schema 输出不得伪造，失败要回传错误。

### Q4b — 工作流脚本（单列大包，约 2–3 周）

**目标**：把「确定性多代理编排」做成 Petri 原生的本地脚本面，而不是复刻 Qoder 的 Workflow 形态。

**范围**
- F8：本地 JS worker 执行 `export const meta` 脚本；`agent/parallel/pipeline/phase/log/budget/workflow`；schema 输出；并发帽；总代理数帽；预算硬上限；按 `resumeFromRunId` 复用未变更前缀；`journal.jsonl`。
- 确定性约束：禁 `Date.now/Math.random/new Date`、禁 fs/net；时间/随机数经 `args` 传入。
- 用户 opt-in：只有用户明确要求「工作流/多代理编排/大规模 fan-out」才允许；成本预估先展示。
- 本地差异化：脚本、journal、血缘、预算全部落本地，可审计。

**验收**
- 纯函数/契约测试：脚本解析、meta 校验、并发帽、预算硬停、resume 前缀命中、journal 完整。
- 离线回放：同脚本同 args 100% 命中；修改一处只重跑后续。
- 实机：一个小型 review/fan-out 工作流跑通；预算耗尽时明确失败；截图/日志。

**风险**：这是新执行面，必须单独立项；不得与 Q4a 同包；脚本沙箱必须 fail-closed；先做最小可用，不做 Qoder 全量语法。

### Q5 — 统一工作面与生成文件（约 1–2 周）

> **2026-10-20：BLOCK-216 已收口（completed，closeout 十三门 + 9223 live 19/19）**。交付=右轨 surface 注册表/tab 状态机/pack `views`·`resultSurfaces`·`uiActions` 贡献投影 + `petri-pack://` 独立 origin + 生成文件/计划/证据面 + 文件管理器显示 IPC。边界=终端分屏 E9 deferred；工作区 URL 模式/底部终端/侧聊维持现有宿主；P2b result 主面已由 pack 渲染（BLOCK-218 垂直切片），高级 tab 仍核心过渡。
>
> 2026-10-22 对账：Q5 主体已完成；剩余 E1/E4/F7/B3/H4/H3/E9 见 §6.5 Q5-REM。

**目标**：把散落在面板/抽屉/浮层里的工作面收成稳定标签，并让 AI 生成文件可追溯。

**范围**
- E1/E2/E3/E4/E9/F7/B3/H4/H3。
- 统一 tab 模型：code/files/browser/changes/spec/terminal/evidence/agent/sidechat/plugin；稳定 id、单例/序号、关闭菜单（close/others/right/all）。
- Result surface host：统一 tab 模型必须把 pack 提供的 `resultSurfaces` 当一等公民；**不得把 Result Studio 生信结果页压成通用文件浏览器**；bio surface 保持生信语义。
- 生成文件 tab：当前工作区版本 vs 工具记录内容；空/载/错/无证据四态。
- 文件预览动作：默认应用打开/文件管理器显示。
- 终端分屏（若成本可控）；通用窗格 split/maximize/resize（扩展现有 ArtifactPinPane）。
- 计划/规格 artifact tab：版本、状态、复制/下载、反馈入口。
- Evidence tab：与 Q3 证据面合并，避免两套。

**验收**
- 纯函数测试：tab 身份/单例/关闭策略；生成文件来源判定。
- 前端测试：tab 打开/关闭/切换/持久化；生成文件四态。
- 实机 flow：从聊天打开文件/审阅/计划/终端/证据 → 标签保持 → 关闭其他；截图 3 张。
- 拆前基线：现有文件 tab/面板/分屏测试全绿；拆后同测试全绿。

**风险**：这是结构性重构，必须成对基线；不要重写 WorkingTreeReview；不要引入第二套路由/面板真相；**Q5 不得在 Q0.5 `resultSurfaces` 契约前定稿，也不得把 Result Studio 通用化。**

### Q6 — 产物批注与学习闭环（约 1–2 周）

> 2026-10-20：**垂直切片已立项并收口 [BLOCK-219](./block-219-q6-annotation-host-plan.md)（completed）**——核心 annotation host（`result_annotations` 旁路元数据 + 归一化 0..1 坐标 + 有界/项目隔离）+ PDF 页与图像区域批注（结果面/工作区预览）+「加入任务」经 `petri:copilot-ask`；实机 13/13，批注不写原始产物。**未做（reopen）**：椭圆/箭头/画笔/文字/马赛克与撤销重做、文本选中批注与速记板（C13 随 Q2）、PPTX/DOCX/XLSX、pack iframe 面批注（需窄桥契约）、Agent 侧批注读取工具。
>
> 2026-10-22：**椭圆/箭头创建入口已由 BLOCK-238 交付**（UI-546 无实机腿）。剩余画笔/文字/马赛克/文本批注/C13/Office/pack iframe/Agent 读取，见 §6.5 Q6-REM。

**目标**：让「读产物 → 批注 → 追问/继续分析」成为闭环，服务 Petri 的学习/科研场景。

**范围**
- C12/C13/E5 + H2 的 additive。
- PDF/图片批注：页/区域、矩形/椭圆/箭头/画笔/文字/马赛克、颜色/粗细/撤销/重做 → 加入任务。
- PPTX/DOCX/XLSX 预览与批注：优先复用系统应用/现有 viewer；如需新依赖，先过依赖检查单，默认不加。
- 文本批注：选中文本 + 评论 + 加入任务/速记。
- 速记板图片批注：与 Q2 速记板合并，不建第二套。
- 批注元数据：来源 artifact/revision/page、坐标、作者、时间；进任务时作为结构化引用。
- Result Studio 的生信批注/方法/比较属于 domain surface；核心只提供通用 annotation host，内容由 pack 提供，不硬编码生信语义。

**验收**
- viewer 测试：批注坐标/缩放/撤销/导出；无依赖路径的诚实降级。
- 实机 flow：PDF 页批注 → 加入任务 → 聊天出现引用 → 继续分析；截图 3 张。
- 依赖门：任何新库需用户裁决与许可记录；无新库则用系统应用打开并诚实说明。

**风险**：文档渲染重、性能/内存；批注坐标跨缩放必须可复现；不得把批注写进原始产物（只存旁路元数据）；不得把生信语义硬编码进核心 annotation host。

### Q7 — 定时任务与目标（约 1–2 周）

**目标**：把 Petri 的「驻留任务」升级为可调度、可回看、可通知的周期分析；补齐目标状态机。

**范围**
- I1/I2/I3/I5 + B4/B5。
- 定时任务：cron 表达式、启停、立即运行、运行历史、失败通知；复用 `resident_task_*` 意图卡与后台进程。
- 自动化入口：composer 增加「创建定时任务」（从当前分析固化参数）。
- 任务看板：定时任务/运行记录/下次运行时间/最近状态。
- 目标模式：active/completed/paused/blocked/usageLimited/budgetLimited；elapsed；与 plan/todo 的关系明确（目标不是计划）。
- 唤醒/提醒：本地通知 + 应用内提醒；应用未运行时诚实说明「未执行」。

**验收**
- 调度器纯函数测试（fake clock）：时区/夏令时/错过运行/重入；不引入 cron 库（或经依赖裁决）。
- 实机 flow：创建每 N 分钟任务 → 立即运行 → 历史一条 → 停用 → 不再运行；截图 3 张。
- 诚实边界：应用关闭期间不假装执行；错过运行显示「已错过」而非「成功」。

**风险**：调度可靠性；重复执行/并发；本地应用生命周期；不得把定时任务做成云端依赖。

### Q8 — MCP 与扩展治理（约 1 周）

> 2026-10-20：**垂直切片已立项并收口 [BLOCK-221](./block-221-q8-mcp-governance-plan.md)（completed）**——MCP 状态面凭据脱敏（修掉解密 env 明文下发）+ 服务级 `{trust, allow, block}` 策略与投影过滤 + 策略读写路由 + 清单摘要。**reopen**：trust 降档接审批层（随 Q1）、OAuth per-server authenticate、大目录懒加载、深链安装安全面（SHA-256/大小/风险）、destructive/openWorld/idempotent 三 hint 进策略、技能自进化建议、货架 UI 操作面。
>
> 2026-10-22：**货架 UI 操作面已由 UI-547 交付（verified dev Electron；allow/block 编辑 + 生效投影计数 + 400 diagnostics）**；trust 仍只读（随 Q1）。**reopen 剩余**：trust 降档接审批（随 Q1）、OAuth、懒加载、深链安装、三 hint 进策略、技能自进化建议。
>
> 2026-10-22：**HTTP MCP OAuth 已由 BLOCK-239 交付（completed；UI-548 verified dev Electron；SDK provider/auth + localhost callback + 密文 token store）**。**reopen 剩余**：stdio/SSE OAuth、token revoke/账号切换、agent 主动 authenticate 工具、真实第三方 provider 矩阵（G1+）、trust 降档接审批（随 Q1）、大目录懒加载、深链安装安全面、三 hint 进策略、技能自进化建议。
>
> 2026-10-22：**三 hint 进策略已由 Q8 轻量批交付**（destructive/openWorld 覆盖 readOnly 降档；idempotent 记录；零 annotations 零漂移）。**剩余**：大目录懒加载、深链安装安全面、技能自进化建议、Agent builder；trust 降档随 Q1；stdio/SSE OAuth 等随 BLOCK-239 reopen。
>
> 2026-10-22：**大目录懒加载已由 BLOCK-241 交付（completed；UI-549 verified dev Electron；catalog R1 + call R2 代理，调用时复核策略）**。**剩余**：深链安装安全面、技能自进化建议、Agent builder；trust 随 Q1；OAuth 余项随 BLOCK-239 reopen。
>
> 2026-10-22：**深链安装安全面已由 BLOCK-242 交付（completed；UI-550 verified dev Electron；`petri-install://` pack/mcp 预览/替换警告/sha 双验/env 禁止）**。**Q8 剩余**：trust 降档接审批（随 Q1）、技能自进化建议与 Agent builder（可选）；packaged 真机唤起/签名/allowlist 属 G1+。
>
> 2026-10-22：**trust 降档已随 BLOCK-243 交付**——`trust='ask'` 对 destructiveHint 工具要求审批，`trust='allow'` 自动放行，货架可改回 ask。**Q8 剩余 = §6.5 Q8-REM**：J2/J6（可选）+ J4 reopen（agent authenticate/stdio/SSE/非 destructive 默认策略）+ OAuth revoke/账号切换 + G1+ 项。

**目标**：把 MCP 从「能用」升级为「默认不信任、可授权、可解释」；补齐扩展安装安全面。

**范围**
- A7/J2/J3/J4/J5/J6。
- MCP 逐 server 信任位、项目级默认不自动批准、允许/阻断列表、环境变量脱敏。
- OAuth：per-server authenticate 工具，「单独调用、下一轮工具出现」；失败可解释。
- 懒加载：大目录先列目录、schema 按需加载；工具名带来源前缀。
- 注解扩展：readOnlyHint/destructiveHint/openWorldHint/idempotentHint 进策略。
- 技能自进化建议：建议列表/一键建任务/忽略（可选，若成本高则留 Q8b）。
- 深链安装扩展：名称/来源/下载地址/大小/SHA-256/风险提示；MCP 配置替换警告。
- Agent builder：内置角色之外的轻量自定义（可选，若与 subagent-profile 重叠则只做 UI）。

**验收**
- 契约测试：默认拒绝/信任位/注解映射/OAuth 状态机/配置替换警告。
- 实机 flow：添加一个需 OAuth 的 mock server → authenticate → 下一轮工具出现；截图 2 张。
- 安全：未信任 server 不自动执行；环境变量不出现在日志/导出。

**风险**：安全面最大；默认拒绝优先；任何自动批准都要有用户可见的信任来源。

### Q9 — 外壳可靠性与打磨（约 1 周）

> 2026-10-21：**Q9 续项垂直切片已立项并收口 [BLOCK-223](./block-223-q9-desktop-shell-plan.md)（completed）**——系统通知（回合完成/失败/待审批；聚焦抑制 + 3s 去重）+ 托盘最小化（`closeToTray` 默认关，关窗=隐藏）+ 退出摘要（活动计数 → 取消 / 最小化到托盘 / 停止并退出）。**reopen**：模型选择器深度（D1/D2/D4）、电脑控制 sidecar（E7/L4）、崩溃同意（K2）、首启揭示（K9）、通知中心/免打扰、摘要逐项操作。
>
> 2026-10-21：**模型选择器 D1+D2 已立项并收口 [BLOCK-224](./block-224-q9-model-selector-depth-plan.md)（completed）**——目录状态诚实（加载/发现失败/缺密钥/隐藏逐行可见）+ 每模型可见性/上下文/默认思考档；**reopen**：D4 Auto（按任务/附件自动选模）、低峰折扣、Workspace 权限、价格用量、发现缓存 TTL。
>
> 2026-10-21：**D4 Auto 已立项并收口 [BLOCK-225](./block-225-q9-auto-model-plan.md)（completed）**——有图→vision 绑定/能力；无图→agent 绑定/tools；回落当前；`userPrefs.autoModel` 默认关，发送时解析不改手动选择。**reopen**：复杂度分级/成本权重/审计落盘/自动档覆盖确认。
>
> 2026-10-21：**通知中心/免打扰已立项并收口 [BLOCK-226](./block-226-q9-notification-center-plan.md)（completed）**——标题栏铃铛/未读/列表（回合终态/待审批留痕）+ `quietHours` 只压系统 toast；**reopen**：点击跳转/系统历史/审批穿透/声音/类型开关/跨设备。
>
> 2026-10-21：**K9 首启角色揭示已立项并收口 [BLOCK-227](./block-227-q9-onboarding-role-reveal-plan.md)（completed）**——欢迎页一次性三卡 + 显式「开始使用」，`roleRevealSeen` 落盘；**reopen**：分步引导/数据导入/动画/重播/插画。
>
> 2026-10-21：**K2 崩溃同意/本地提示已立项并收口 [BLOCK-228](./block-228-q9-crash-consent-plan.md)（completed）**——crashReporter 仅本地、session-health 异常退出检测、dump 文件名清单、`crashNotice` 偏好与横幅；**reopen**：minidump 栈解析/上传/崩溃率/版本聚合/自动诊断包。
>
> 2026-10-21：**E7 电脑控制（Windows 边界内）已立项并收口 [BLOCK-229](./block-229-e7-computer-use-plan.md)（completed）**——sidecar/axfixture 构建、host status、后端 status/probe、设置面板；**reopen**：macOS 构建/权限、PiP、真实 click/type 端到端。
>
> 2026-10-21：**P4 数据模型第一片已立项并收口 [BLOCK-230](./block-230-qdomain-p4-modality-plan.md)（completed）**——modality 默认 general + pack `provides.modalities` + 未知回落；**reopen**：权限通用化/域中性归零/RS 保真/导出联邦基线/dataModelExtensions。
>
> 2026-10-21：**P4-C S5 已收口 [BLOCK-234](./block-234-qdomain-p4c-tail-plan.md)（active）**——result/RS 科学语义（compare/rerun/cohort/planner/selection/heavy/interpret）下沉 pack `provides.scientificProfiles`（pack 0.2.6），核心只留有界引擎与不变量；域中性 **103→48 处**；剩余 S6 前端/桌面 + 兼容白名单。**P4 仍 open**：权限/域中性归零/RS 保真/导出联邦基线/dataModelExtensions（其中权限已于 BLOCK-232 收口）。
>
> 2026-10-21：**P4-C 收尾 [BLOCK-234](./block-234-qdomain-p4c-tail-plan.md) completed（S2–S6）**——S6 前端/桌面 37 处清零，剩余 11 处 / 6 键为显式兼容白名单（permissions/guest/modality/schema/runtime-bundle/security-extension，门禁逐键一致）；pack 0.2.7 `provides.examplePrompts`。域中性 **179→11 处 / 85→6 键**。**无 active 工作包**；P4 余项=导出/联邦基线、dataModelExtensions（需独立阶段发令）。
>
> 2026-10-21：**P4-D 余项 [BLOCK-235](./block-235-qdomain-p4d-datamodel-plan.md) completed**——`dataModelExtensions` additive 扩展契约（pack 可新增 artifact 类型/字段，canonical SDC-0 profile 不可覆盖；bounded loader + SDC-0 校验；冲突/非法 fail-closed）+ 导出/联邦域中性基线。域中性保持 **11 处 / 6 键 compat**。**P4 数据模型/权限轨道结构余项收口；无 active 工作包；下一包需用户发令**。G0 开发期常态 · 不外推 packaged/Provider/GA。
>
> 2026-10-22 对账：Q9 八个垂直切片已完成；剩余 K1/K2/K3/K4/K9/D1/D4/E7/C14/L3/L4 见 §6.5 Q9-REM。

**目标**：把「长跑、离开窗口、出错、首启」这些边缘体验补到第一梯队。

**范围**
- D1/D2/D4/C14/E7/K1/K2/K3/K4/K9。
- **电脑控制启用（E7 扩展）**：构建 macOS/Windows sidecar；首调权限引导（屏幕录制/辅助功能）；PiP/控制面板；复用现有 8 个 `computer_*` 工具与 `ackToken` 两段确认；sidecar 缺失时诚实报错。输入注入属于信任内核，不交给第三方插件；自动化配方/视图可作为插件贡献。
- 模型选择器深度：逐模型 effort/context/visible、失效原因、加载失败、自动选择。
- 后续建议/提示词润色：本地启发式或小模型；失败保留草稿。
- 电脑使用画中画：实时屏幕 + 显示/隐藏/会话级隐藏。
- 分段错误边界：应用/页面/预览/轮次/工具。
- 退出摘要：运行/后台/排队/等待交互计数；停止并退出/最小化到托盘。
- 系统通知：轮次完成/失败/权限/提问；托盘最小化。
- 崩溃同意 + 本地解析（可选，机制借、代码不搬）。
- 首启角色揭示/数据导入：只做 Petri 版本，不做 Qoder 复刻。

**验收**
- 组件/纯函数测试：退出计数、通知路由、错误边界、模型状态。
- 实机 flow：长任务运行中退出 → 摘要 → 最小化 → 完成通知；截图 3 张。
- 诚实边界：崩溃解析不可用时只报文件名，不伪造栈。

**风险**：托盘/通知跨平台差异；不要在 G0 碰更新/Provider；崩溃 wasm 许可需另行评估。

### 6.5 剩余队列（2026-10-22 对账，串行）

> 本表把「已立项包未覆盖 / 整波未开工 / 已交付面收尾」收敛为一处；排队序以本表为准，执行仍按单工作包串行与立项检查单。量级继承母纲颗粒度，不含返工与 G1+。

| 序 | ID | 剩余内容 | 依赖/边界 | 量级 |
| --- | --- | --- | --- | --- |
| 1 | Q1-REM | A1 非 guard 通用审批门；A2 模型/本地意图解释；A5 同参连续 N 次循环检测+继续/终止；A8 逐工具 allow/deny 完整面；C5 workspace-checkpoint 编辑重发；C19 AskUserQuestion；D3 完全访问确认层；A7 sideTask 变体（PAT/Lark/协作按 §2.6 不复刻） | BLOCK-243 主体已完成；A9/A10 不重建 | 2–4 天 |
| 2 | Q2 | C15 统一 @ 菜单；C12 划词动作；C13 速记板；C17 跨会话引用；C16 附件形态；C4 消息动作；C11 图片保存/多图；B2 计划反馈 | Q1/Q2 可并行；C13 与 Q6 速记合并 | 1–2 周 |
| 3 | Q2b | L1 web_search + L2 web_fetch；provider 抽象（DeepSeek 首实现，SearXNG/MCP 预留）；设置页；SSRF/重定向/大小/content-type/超时；默认关+授权+来源/成本/审计 | Q2 来源标签最小投影 | 1 周 |
| 4 | Q3 | C1 时间线锚点；C2 活动卡补齐；C3 事件级轨迹+筛选+recordedOnly；H3 证据面；K1 轮次/工具级边界 | Q1/Q2b 事件；与 Q5 evidence tab 合并 | 1 周 |
| 5 | Q4a | C7 子代理暂停；C10 团队活动；F1 roster/stop-all；F3 结构化输出；F4 子代理工具约束；F5 journal；F9 CodebaseInvestigator | Q3 团队活动可见 | 1–2 周 |
| 6 | Q7 | I1 定时任务；I2 composer 入口；I3 任务看板；I5 唤醒提醒；B4 目标状态机；B5 预算；B6 目标工具 | Q4a | 1–2 周 |
| 7 | Q4b | F8 工作流脚本（meta/agent/parallel/pipeline/phase/log/budget/resume）；确定性沙箱；并发/代理/预算帽；journal/血缘；opt-in | Q4a 后单列立项 | 2–3 周 |
| 8 | Q5-REM | E1 工作区 URL/底部终端/侧聊宿主统一；E4 OS 文件管理器点验；F7 通用窗格；B3/H4 修订版本 tabs；H3 事件级证据（随 Q3）；E9 终端分屏 deferred | BLOCK-216 主体已完成 | 0.5–1 周 |
| 9 | Q6-REM | E5 画笔/文字/马赛克+撤销重做；文本选中批注；C13 速记板（与 Q2 合并）；PPTX/DOCX/XLSX；pack iframe 批注窄桥；Agent 批注读取工具；UI-546 实机腿 | BLOCK-219/238 主体已完成；P2b/Q5 已就绪 | 1 周+实机 |
| 10 | Q8-REM | J2 技能自进化建议（可选）；J6 Agent builder（可选）；J4 reopen：agent authenticate/stdio/SSE/非 destructive 默认策略；OAuth revoke/账号切换；真实 provider 矩阵=G1+；packaged 深链/签名/allowlist=G1+ | Q8 主体已完成；G1+ 不计 | 0.5 周（可选） |
| 11 | Q9-REM | K1 轮次/工具/应用级边界；K2 minidump 解析/上传；K3 摘要逐项操作；K4 通知点击/系统历史/审批穿透/声音/类型开关；K9 分步引导/数据导入；D1 低峰/权限/价格/缓存；D4 成本/复杂度/审计/覆盖确认；E7 macOS/PiP/真实 click-type；C14 后续建议/润色；L3 浏览器连接器；L4 电脑控制余项 | Q8 后；可与 Q5/Q6 余项互换 | 1–2 周 |
| 12 | P4-REM | E13 Result Studio 高级 tab 全量迁 pack（lineage/compare/history/selection/revisions/annotations/methods/export）；域中性 11 处/6 键 compat 是否清零（需裁决）；真实结果页保真实机 | 母纲硬约束：最后 | 1–2 周 |
| V | V-REM | UI-544/545/546 实机腿（结果面 tab/compare、图形批注） | 代码+单测已绿；纯验证债 | 1–2 天 |

> 推荐执行序：**Q1-REM → Q2 → Q2b → Q3 → Q4a → Q7 → Q5-REM/Q6-REM → Q8-REM → Q9-REM → P4-REM**；Q4b 在 Q4a 后单列。Q1-REM 可并入 Q2 作为首批 rider；Q5/Q6 余项与 Q9 可在主序中互换。V-REM 随对应 UI 包或独立验证批收口。

## 7. 波次依赖与排序

```
Q0（基线）
 ├─▶ Q1（信任/审批）──┐
 ├─▶ Q2（上下文/捕获）─▶ Q2b（联网检索/抓取）──┴─▶ Q3（轨迹/证据）
 ├─▶ Q4a（团队）──▶ Q4b（工作流，单列）
 │        └─▶ Q7（定时/目标）
 ├─▶ Q5（统一工作面）──▶ Q6（批注/学习闭环）
 └─▶ Q8（MCP/治理）──▶ Q9（外壳/打磨）

Q-DOMAIN（垂直去核化，跨波次）
 Q0.5（插件 ADR）
  ├─▶ P1（skills）─▶ P2（prompt/UI actions）
  ├─▶ P3（methods/learning/legacy registry）
  └─▶ Q5（view/result surface host）─▶ P2b（生信 Result Surface）─▶ Q6
                                                   P4（data model/permissions）最后
```

- **硬依赖**：Q0→全部；**Q0.5（插件 ADR）→ Q5/Q8 的 host 契约**（不占产品波次、零产品代码）；**Q0.5→Q-DOMAIN P1/P2**；Q2→Q2b（上下文标签/来源展示）；Q1→Q3（审批事件进轨迹）；Q2b→Q3（检索/抓取事件进轨迹）；Q3→Q4a（团队活动可见）；Q4a→Q7（定时多代理任务）；**Q-DOMAIN P2→Q5（UI action contribution）；Q5→P2b（result surface host）→Q6（批注）**；Q8→Q9（扩展安装安全面）；**Q-DOMAIN P4 必须最后**。
- **软依赖**：Q1 与 Q2 可并行（文件面不同）；Q2b 与 Q8 的 provider 信任/凭据治理协同（DeepSeek 单 provider 可先落地，多 provider/OAuth 等 Q8）；Q-DOMAIN P1/P2 可独立于 Q1/Q2b 推进；Q4b 可在 Q4a 后独立立项；Q9 最后。
- **推荐顺序**：Q0 → Q0.5 → **Q-DOMAIN P1** → Q1 → Q2 → Q2b → **Q-DOMAIN P2** → Q3 → Q4a → Q7 → Q5 → **Q-DOMAIN P2b** → Q6 → **Q-DOMAIN P3** → Q8 → Q9 → **Q-DOMAIN P4**；Q4b 在 Q4a 收口后另行发令。
- **插队规则**：若用户实机反馈「审批看不懂/上下文引用丢/任务停不下来」，优先 Q1/Q2；若联网检索/抓取是当前痛点，Q2b 可紧跟 Q1，但必须先有来源标签与抓取安全门（Q2 最小投影）；**若生信结果页是当前产品重点，Q5→P2b 可提前到 Q2b 之后，但 P2b 不得早于 Q5 host，Q6 不得早于 P2b**；若定时分析是当前科研痛点，Q7 可提前到 Q4a 后。

## 8. 每波验收与证据规范

| 项 | 要求 |
| --- | --- |
| 立项 | 独立 BLOCK（或 UI 轨，若单面单会话可收口）；plan 写明范围/非范围/依赖/验收/完成语义；用户发令留痕 |
| 测试 | 后端契约/纯函数测试 + 前端组件测试；定向 `npm run test:changed`；`quality:types`/`quality:lint` 绿 |
| 实机 | `dev-verify` flow + 9223 测试实例；截图/断言 JSON 落 `acceptance/<block-id>/`；无实机证据不得 `verified` |
| 台账 | 同提交更新 `docs/ui-productization-audit.md` 的 `UI-###`；状态 `in_progress` → `verified` 必须有实机证据 |
| 矩阵 | 收口时回写 Q-MATRIX 对应行：状态、证据、波次；不得删行；⛔ 需写理由 |
| 门禁 | `npm run docs:check`、`npm run ui:audit:check`、`npm run hygiene:check`；收口跑 `npm run closeout` |
| 诚实 | 空/载/错/部分态必须可见；不得把未跑/跳过/复用证据写成 freshly passed |

## 9. 度量与棘轮

- **Q-MATRIX** 是对标检查表，不是第二套评分卡；外层分数仍用 `scripts/block195-anchors.mjs` 的竞争力锚点。
- 每波至少新增 1 条机械锚（unit/frontend/evals/live）覆盖该波的核心行为；锚点加入 `evals/anchors/competitiveness-8d.json` 的对应点位，跑 `--update` 后 `--check` 对账。
- UI 变化必须有 1 条 dev-verify flow；flow 覆盖「打开 → 操作 → 状态可见 → 失败/空态」至少两条路径。
- 矩阵状态变更纳入 `docs:check` 人工复核；任何「从 🔴 直接标 ✅」必须附实机证据，否则视为虚假收口。

## 10. 明确不做（阶段禁区与反模式）

1. **不做 Qoder 视觉复刻**：不复制其配色/布局/字体/组件皮肤；一律 Petri design token。
2. **不做云侧**：账号/额度/积分/数据政策/云自动化/remote worker/Cosy 签名/UMID/更新流水。
3. **不做 G1+**：Provider 矩阵/公证签名/GA/packaged 验证/远程发布。
4. **hooks 产品化**：仍按 `stage-3-4-execution-runlist.md` ⛔，需用户显式解锁才立项；Q3 只渲染已有事件，不建 hook 系统。
5. **i18n 资源层**：⛔，需用户显式解锁。
6. **Worktree**：G0 deferred，不重启；Q4 只用进程内子代理隔离。
7. **桌面宠物/伴随活动/实时语音浮层/速记浮窗**：与 Petri 人设不符；速记只做应用内面板，不做独立浮窗。
8. **不做 Qoder 的 13 个 model purpose、BYOK 多模型顾问、Advisor 工具**：Petri 已有 model role bindings；不重复造。
9. **不做无限「加映」**：每波范围以 plan 为准；新想法进 Q-MATRIX 候选或 backlog，不夹带。
10. **不为转绿造锚/删行**：矩阵只增不删；状态变更必须有证据。
11. **不做 Qoder 云搜索照搬**：DeepSeek Search/Fetch 是用户自配的可选外部 provider（默认关、出站审计、成本可见），不是 Petri 云服务；不引入 Qoder 账号/额度/数据政策。真实调用需用户显式预算，失败/空结果不伪装成成功。
12. **不把信任内核插件化**：审批/策略、事件账本、数据/产物真值、模型网关/凭据、IPC 安全边界不可由第三方插件替换；插件只做边缘贡献（§2.5 B 口径）。
13. **不复刻 Qoder 专属外部接口**：Qoder webSearch/imageSearch 端点、`/sdk/browser-use/v1`、`@qoder-space/browser-use`、云模型路由/账号/额度、marketplace、cloud collaboration/QMind/Sites/cloud-automation、update/signing/UMID/SecurityGuard、ImageGen/VideoGen 一律不复刻；只借行为合同，改用 Petri 自有实现或用户自配第三方 provider（默认关、可审计）。
14. **不做通用化结果页**：Result Studio 是**生信专属产品面**；由 pack 提供 `resultSurfaces`，核心只做 artifact/truth/evidence/repository host；pack 缺失时不伪装通用结果页，不得把生信结果页压成通用文件浏览器；结果真相永在核心，不搬进 pack。

## 11. 立项与下一步

- **Plan ID**：`QODER-ESSENCE-ABSORPTION`；kind=`vision`；status=`planned`；truthDomain=`qoder-essence-absorption`；entrypoint=`docs/README.md`。
- **母纲**：`AGENT-COMPETITIVENESS-PROGRAM`（方向）；本文件是 Qoder 样本的增量，不重开 CP-1–CP-22。
- **建议首波**：**Q0.5（插件 ADR，0.5–1 天）+ Q-DOMAIN P1（skills 去核，1–2 周）**——先把 host 契约和生信 skills 落进 pack，再按 Q1（信任与审批）→ Q2b（联网检索）→ Q5（工作面 host）→ Q-DOMAIN P2b（生信 Result Surface）→ Q6 推进；Q-DOMAIN P2/P3 可穿插，P4 最后。
- **发令方式**：Q-DOMAIN P1 可独立立项为 BLOCK（P0 ADR / P1 实现）；Q1/Q2b 各自独立发令；**结果页 P2b 不得早于 Q5 host，Q6 不得早于 P2b**。
- **当前状态**：本文件为 planned（方向母纲）；**Q5（BLOCK-216）、P2-UI（BLOCK-217）、P2b 垂直切片（BLOCK-218）、Q6 批注垂直切片（BLOCK-219）、P3 垂直切片（BLOCK-220）、Q8 治理垂直切片（BLOCK-221）、Q9 边界垂直切片（BLOCK-222）、Q9 续项垂直切片（BLOCK-223）、模型选择器 D1+D2（BLOCK-224）、D4 Auto（BLOCK-225）、通知中心/免打扰（BLOCK-226）、首启角色揭示（BLOCK-227）、崩溃同意/本地提示（BLOCK-228）、E7 电脑控制 Windows 切片（BLOCK-229）、P4 数据模型第一片（BLOCK-230）均已收口（completed）**。P4 剩余结构项（权限通用化/域中性归零/RS 保真/导出联邦基线/dataModelExtensions）仍 open，需独立阶段发令。P3 余项（`_pythonEquivalent` 脚本模板/`artifact-profiles`/`agent-workflow`/`learning`/`result-*-tools`）、Q6 余项（六种图形工具/文本批注与速记板/Office/pack 面批注）、P2b 全量高级 tab 迁移、E7 的 macOS/PiP/端到端控制为 reopen。G0 开发期常态 · 不外推 packaged/Provider/GA。

## 12. 附：Q-MATRIX 更新记录

| 日期 | 波次 | 变更 | 证据 |
| --- | --- | --- | --- |
| 2026-10-20 | Q0 | 初始 89 点矩阵落档；✅24 / 🟡40 / 🔴19 / ⛔6（机械计数） | 本文件 §5；Qoder 反编译树 + Petri UI 台账/组件核对 |
| 2026-10-20 | Q0.5/Q2b | 增补插件架构 B 口径（§2.5）、L 组矩阵 L1–L7（联网搜索/抓取、浏览器、电脑控制、插件宿主/权限、生成式媒体 ⛔）、C19/E12/B6/F9 补漏、Q2b DeepSeek Search/Fetch provider 合同与安全红线；矩阵 **89→100**（✅24 / 🟡46 / 🔴23 / ⛔7） | 本文件 §2.5/§5-L/§6-Q2b；DeepSeek 官方 Search/Fetch 指南 + Qoder 反编译树 + Petri 实码 |
| 2026-10-20 | Q-DOMAIN/E13/L8 | 用户强调结果页必须生信专属：新增 E13 Result Studio 生信结果面 + L8 垂直领域完全插件化；Q-DOMAIN P1–P4（P2b resultSurface，结果页保持生信 UX，核心只做 artifact/truth host）；矩阵 **100→102**（✅24 / 🟡47 / 🔴24 / ⛔7） | 本文件 §3-15/§6-Q-DOMAIN；Result Studio 实码 + domain-neutrality baseline 135/326/49 |
| 2026-10-20 | Q5 | BLOCK-216 收口：E2/E3 → ✅；E1 🔴→🟡（右轨统一，工作区模式/终端/侧聊仍各宿主）；矩阵 **✅26 / 🟡46 / 🔴23 / ⛔7 = 102**；E9 明确 deferred | `docs/block-216-q5-work-surface-host-plan.md` §7 + `acceptance/block-216/`（9223 live 19/19） |
| 2026-10-20 | Q-DOMAIN P2-UI | BLOCK-217 收口：L8 🔴→🟡（act 去域 + pack uiActions host；result/data model 仍核心）；矩阵 **✅26 / 🟡47 / 🔴22 / ⛔7 = 102** | `docs/block-217-qdomain-p2ui-actions-plan.md` §6 + `acceptance/block-217/`（9223 live 8/8） |
| 2026-10-20 | Q-DOMAIN P2b | BLOCK-218 垂直切片收口：E13/L8 更新（result mode 主 body 由 pack resultSurface 渲染；高级 tab 核心过渡）；矩阵不变 **✅26 / 🟡47 / 🔴22 / ⛔7**；真实 job live rider | `docs/block-218-qdomain-p2b-result-surface-plan.md` §6 |
| 2026-10-20 | Q9 | BLOCK-222 垂直切片收口：段落级错误边界（预览段）+ 可定位标注；**矩阵计数不变 ✅26 / 🟡47 / 🔴22 / ⛔7 = 102**——K1/K2 部分落地（轮次/工具/应用级未做） | `docs/block-222-q9-segment-boundary-plan.md` §5 |
| 2026-10-21 | Q9/K3/K4 | BLOCK-223 续项垂直切片收口：系统通知 + 托盘最小化 + 退出摘要（活动计数 → 取消/托盘/停止并退出）；**矩阵计数不变 ✅26 / 🟡47 / 🔴22 / ⛔7 = 102**——K3/K4 部分落地（通知中心/免打扰、摘要逐项操作未做） | `docs/block-223-q9-desktop-shell-plan.md` §7 |
| 2026-10-21 | Q9/D1/D2 | BLOCK-224 收口：模型目录状态诚实（加载/发现失败/缺密钥/隐藏逐行可见）+ 每模型可见性/上下文/默认思考档；**矩阵计数不变 ✅26 / 🟡47 / 🔴22 / ⛔7 = 102**——D1/D2 部分落地（D4 Auto、低峰折扣、权限、价格未做） | `docs/block-224-q9-model-selector-depth-plan.md` §7 |
| 2026-10-21 | Q9/D4 | BLOCK-225 收口：按任务/附件每轮解析模型（vision/agent 绑定→能力→回落），`autoModel` 默认关、发送时解析不改手动选择；**矩阵计数不变 ✅26 / 🟡47 / 🔴22 / ⛔7 = 102**——D4 部分落地（复杂度/成本权重未做） | `docs/block-225-q9-auto-model-plan.md` §7 |
| 2026-10-21 | Q9/K4 | BLOCK-226 收口：通知中心（铃铛/未读/列表/全部已读）+ `quietHours` 只压系统 toast、应用内留痕；**矩阵计数不变 ✅26 / 🟡47 / 🔴22 / ⛔7 = 102**——K4 进一步落地（点击跳转/系统历史/审批穿透/声音未做） | `docs/block-226-q9-notification-center-plan.md` §7 |
| 2026-10-21 | Q9/K9 | BLOCK-227 收口：首启角色揭示（三卡 + 显式确认 + `roleRevealSeen` 落盘）；**矩阵计数不变 ✅26 / 🟡47 / 🔴22 / ⛔7 = 102**——K9 部分落地（分步引导/数据导入未做） | `docs/block-227-q9-onboarding-role-reveal-plan.md` §7 |
| 2026-10-21 | Q9/K2 | BLOCK-228 收口：本地崩溃记录（不上传）+ 异常退出横幅 + dump 文件名清单 + `crashNotice`；**矩阵计数不变 ✅26 / 🟡47 / 🔴22 / ⛔7 = 102**——K2 部分落地（栈解析/上传未做） | `docs/block-228-q9-crash-consent-plan.md` §7 |
| 2026-10-21 | Q9/E7 | BLOCK-229 收口：Windows sidecar 构建 + 状态/probe + 设置面板；**矩阵计数不变 ✅26 / 🟡47 / 🔴22 / ⛔7 = 102**——E7 部分落地（macOS/PiP/端到端未做） | `docs/block-229-e7-computer-use-plan.md` §7 |
| 2026-10-21 | Q-DOMAIN/P4 | BLOCK-230 收口：modality 默认 general + pack provides.modalities + 未知回落；**矩阵计数不变 ✅26 / 🟡47 / 🔴22 / ⛔7 = 102**——P4 第一片（权限/域中性/RS 保真/导出联邦未做） | `docs/block-230-qdomain-p4-modality-plan.md` §7 |
| 2026-10-20 | Q8 | BLOCK-221 垂直切片收口：MCP 凭据脱敏 + 服务级 allow/block + 投影过滤 + 策略路由；**矩阵计数不变 ✅26 / 🟡47 / 🔴22 / ⛔7 = 102**——J3/J4 部分落地（无 OAuth、无深链安装、trust 未接审批） | `docs/block-221-q8-mcp-governance-plan.md` §5 |
| 2026-10-20 | Q-DOMAIN P3 | BLOCK-220 垂直切片收口：legacy 化石注册表删除（单一注册源）+ methods 引用/工具标签下沉 pack `provides.methods`；域中性基线 **261→208 处**（tool-registry 31 归零、methods-export 62→24）；**矩阵计数不变 ✅26 / 🟡47 / 🔴22 / ⛔7 = 102**——L8 仍 🟡（data model 与脚本模板未下沉） | `docs/block-220-qdomain-p3-methods-plan.md` §8 |
| 2026-10-20 | Q6 | BLOCK-219 垂直切片收口：E5/C12 部分落地（PDF/图像**矩形**批注 + 加入任务；批次外=椭圆/箭头/画笔/文字/马赛克、文本选中批注、速记板 C13 随 Q2、PPTX/DOCX、pack 面）；**矩阵计数不变 ✅26 / 🟡47 / 🔴22 / ⛔7 = 102**——E5 仍 🟡（PPTX/DOCX 未覆盖），C12 仍 🟡（无速记/批注进侧聊） | `docs/block-219-q6-annotation-host-plan.md` §6 + `acceptance/block-219/`（13/13） |
| 2026-10-22 | Q6/Q8/Q1 汇总回写 | BLOCK-238 椭圆/箭头；BLOCK-239 HTTP OAuth；BLOCK-240 四 hint；BLOCK-241 懒加载；BLOCK-242 深链；BLOCK-243 审批契约+trust；A3/A4/A6/D2/J3/J5→✅，A2/A5/J4/L5→🟡，E5/E13/K*/D*/E7/L6/L8 现状更新；矩阵 **✅32 / 🟡47 / 🔴16 / ⛔7 = 102**；剩余队列 §6.5 | 各 BLOCK plan §收口 + `acceptance/block-243/`、`acceptance/ui-551/` |

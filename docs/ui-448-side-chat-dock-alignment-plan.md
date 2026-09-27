---
capability: side-chat-dock
goal: 把 UI-417 侧边聊天悬浮面（SideChatDock）的展开体验对齐本仓已打磨的「项目摘要」悬浮语言——同一会话单一输入面、内容让位不切腰、视觉 token 同族——消除用户实测指出的「点开后很不和谐」
acceptance:
  - 红绿先行（HK-01）：单输入面/内容让位/compact 占位符三面契约测试先落红，实现后转绿，红→绿证据随收口笔录留痕
  - 中栏单一输入面：悬浮面展开时中栏 composer 让位（让位提示条替代），收起后还原；悬挂面自身 composer 不受影响
  - 内容让位：悬浮面展开时中栏会话内容列收窄避让（不再被 380px 面板拦腰切割），收起还原
  - 视觉对齐：surface 圆角 16px/阴影走新 token --gewu-shadow-float（亮暗双套，摘要浮层同值硬编码收编单源）/入场 280ms + prefers-reduced-motion 降级
  - 窄面适配：悬挂面 SimpleChat compact 占位符（短提示不折行）；表格/长 token 三态实机核对（框内滚动+滚动条可见）
  - 台账同步：docs/ui-productization-audit.md UI-448 条目与实现同一提交；实机走查截图证据落 acceptance/ui-448/
reopen: 用户实机过目后对新形态不满意，或悬浮面与摘要浮层同屏叠置的已知边界升级为真问题时
status: active
---

# UI-448 — 侧边聊天悬浮面体验对齐项目摘要

> 立项：2026-09-26（用户裁决原话「行！ 按照你的建议 开冲」——对主会话核查结论的四点建议整体放行）。
> 前置核查：dev 栈实机复现用户截图，四点不和谐全部坐实（双 composer 并存/380px 拦腰切割/窄面内容挤压/视觉语言与摘要浮层脱节），证据为本 plan §2 与 acceptance/ui-448/ 截图。
> 能力：`side-chat-dock`（HK-04 增量采纳：立项即带 capability front-matter）。
> **2026-09-26 当日整包 completed**（实现提交 bf64ddea）：红绿 4 文件全红→25/25 绿；前端全量 153 文件/1229 用例 0 红；tsc 0；theme 4/4；eslint 0 error；实机三态走查 allPass（acceptance/ui-448/walkthrough.json）。UI 台账 UI-448 `in_progress` 待用户实机过目（过目后翻 verified，见 plan §5 完成语义）。实施记录见 §7。

## 1. 一句话目标与裁决来源

SideChatDock（UI-417）展开后是「同一主视图的第二份拷贝」：380px 全高不透明面板盖在中栏右半，同一会话双份渲染、双 composer 并存，内容被拦腰切割。项目摘要卡（UI-056/351/370 三轮打磨）代表本仓悬浮语言：内容驱动尺寸、让位而非遮挡、token 化视觉。本包把侧边聊天对齐到这套语言，同时保留「交互面 ≠ 只读监控面」的本质差异。

**用户裁决（2026-09-26 原话）**：「行！ 按照你的建议 开冲」。建议四点：① 双输入面裁决（倾向悬浮面打开时中栏 composer 让位，守「同一会话单一输入面」）；② 遮挡哲学对齐（让位/收窄而非覆盖切割）；③ 视觉细节对齐（圆角/阴影/动效/reduced-motion）；④ 窄面内容适配。

## 2. 核查结论（2026-09-26 实机取证）

| # | 不和谐点 | 实测证据 |
| --- | --- | --- |
| 1 | 同一会话双份渲染、双输入面并存 | 悬浮面 composer 351px + 中栏 composer 718px 同屏，两个「完全访问」工具条 |
| 2 | 380px 全高不透明面板拦腰切割中栏内容 | sha256/用户气泡在 token 中间被切断 |
| 3 | 380px 内窄面无适配 | 表格横向滚动、sha256 逐字断行、输入提示折两行 |
| 4 | 视觉语言与摘要浮层脱节 | 圆角 10 vs 16、menu 阴影 vs 大柔和影、160ms vs 280ms、缺 reduced-motion |

摘要浮层参照系（`.workspaceSummaryFloat`）：内容驱动 ≤312px、贴齐右缘、opacity 0.92 hover 回实感、圆角 16px、大柔和阴影、280ms 入场、尊重 prefers-reduced-motion。

## 3. 范围与非范围

**范围内（P1 单阶段一次会话收口）**：
1. 新增 `frontend/src/hooks/sideChatDockStore.ts`（模块级单例 store + `useSyncExternalStore` hook）——SideChatDock 开态从组件 useState 升为共享真相；中性归属 hooks/ 避免 copilot ↔ workspace-panels 反向依赖。
2. SimpleChat：`ownsCopilotAsk` 实例在开态下 composer 让位——渲染轻量提示条（含「返回中栏输入」动作，点击收起悬浮面还原）；新增 `compact?: boolean` prop（悬挂面实例用短占位符「输入消息…」不折行）。
3. CenterPanel：中栏 `.agentMain` 在开态挂让位类（`padding-right: min(432px, calc(100% - 320px))`），会话内容列收窄避让，320px 下限兜底极窄窗口。
4. SideChatDock.module.css 视觉对齐：圆角 16px、`--gewu-shadow-float`、入场 280ms、`prefers-reduced-motion` 降级。
5. custom.css 新增 `--gewu-shadow-float` 亮暗双套；`.workspaceSummaryFloat` 同值硬编码收编为该 token（单源化，零视觉变化）。
6. SideChatDock 把手与 44px 间隙结构**保留**（把手是常驻入口 + 运行呼吸灯载体，「再点收起」D1 契约不破坏；「贴缘」对齐在此处有意部分达成，理由：贴 right:0 则把手无处安放，收益不抵契约破坏）。

**非范围（exclusions）**：
- 不改中央 SimpleChat 的 ownsCopilotAsk/copilotAsk 归属契约（悬挂面仍不承接「问 Agent」）。
- 不做悬浮面宽度拖拽调节/宽度记忆（摘要也无；留观察）。
- 不处理「悬浮面 + 摘要浮层同屏叠置」已知边界（摘要浮层 z-40 在上，z 序既有；升级为真问题走 reopen）。
- 不动 0.92 半透明（交互面不采纳；只读监控面特性）。
- 不新建独立窗口/不改 Electron 壳。

**依赖**：0 新依赖。**并行隔离**：无已知并行包（BLOCK-123/124 已收口）；g04 已提交，git 干净。

## 4. 契约测试面（HK-01 红绿先行）

先落红（实现前必须先见红）：
1. `SideChatDock.test.tsx` 扩：store 共享真相（`setSideChatDockOpen(false)` 重置 + store 开态下挂载即展开）；既有 7 契约（把手/滑出/Esc/外点/事件/空态/呼吸灯）零回归。
2. `CenterPanel.test.tsx` 扩：store 开态 + chat 模式 → `.agentMain` 挂让位类；关态无让位类。
3. SimpleChat 契约（组件测试）：`compact` → 短占位符；`ownsCopilotAsk` + 开态 → composer 不渲染、让位提示条在位；非 owns 实例（悬挂面自身）开态下 composer 照常。

红→绿证据：红名单 + 转绿输出随收口笔录留痕（acceptance/ui-448/）。

## 5. 验收门禁（收口时逐项对账）

| 门禁 | 判据 |
| --- | --- |
| 定向组件契约 | SideChatDock/CenterPanel/SimpleChat 三面 vitest 全绿（红→绿留痕） |
| theme 契约 | `npx vitest run src/styles/theme-token-contract.test.ts` 绿 |
| 类型/lint | `tsc --noEmit -p frontend/tsconfig.json` 0 红；eslint 0 error |
| 实机走查 | dev 栈开→让位→关还原三态截图 + 双 composer 消失断言，落 acceptance/ui-448/ |
| 台账 | docs/ui-productization-audit.md UI-448 条目与实现同提交；ui:audit:check 绿 |
| 文档 | docs:check 绿（本 plan + DOC-REGISTRY + README 三件套齐） |
| 收口 | npm run closeout 十一门绿（test:changed 按影响面） |

**完成语义**：实现 + 实机证据充分 → 条目 `in_progress` 待用户实机过目（本仓最高证据等级先例）；用户过目确认后翻 `verified`。G0 开发期常态 · 不外推 packaged/Provider/GA。

## 6. Jev 决策工具行使记录

- test:suggest（实现前，零改动文件）：零建议（工具如实回报，无文件面可供挖掘）。
- doc:suggest：台账回写前补跑。
- output:judge：收口声明前补跑。

## 7. 实施记录与收口（2026-09-26）

**提交**：立项 4b0916cc → 实现 bf64ddea（21 文件 +470/−17，UI 台账同提交）。

**红绿先行（HK-01）**：契约先落 4 文件全红（sideChatDockStore/ComposerYield 模块未存在 + SideChatDock/CenterPanel 新契约失败）→ 实现 → 25/25 绿（store 3 + ComposerYield 5 + SideChatDock 9 + CenterPanel 8）。

**门禁对账（§5 逐项）**：
| 门禁 | 结果 |
| --- | --- |
| 定向组件契约 | 25/25 绿（红→绿留痕本节+commit） |
| theme 契约 | theme-token-contract 4/4 绿 |
| 类型/lint | tsc 0 红；eslint 0 error（22 warning=CSS 文件配置外忽略告警，无新增违规） |
| 实机走查 | allPass：关（composer 1/无 dock）→开（composers 1、centerHint true、让位 padding 432px、16px 圆角、暗档 float 阴影、compact 单行占位符、零切割）→点「返回中栏输入」（dock 收起、完整占位符还原、让位类/提示条消失）；截图+断言 acceptance/ui-448/ |
| 台账 | UI-448 条目随 bf64ddea 提交，in_progress 待过目；ui:audit:check 收口跑绿 |
| 文档 | 本 plan + DOC-REGISTRY（completed 翻转）+ README 157 号收口注记 |
| 收口 | npm run closeout 十一门（结果见 AUDIT-LOG 收口行） |

**波折如实登记**：SimpleChat composer 尾部条件闭合两次错层（sc-composer-bar 中间层漏数：`)}` 先插早一层、再补挂一个多余 `</div>`），用 typescript 解析探针打印 JsxElement 配对行号定位后修正——教训=大 JSX 块包条件渲染不靠缩进目测，用解析器量。

**Jev 决策工具（§6 补全）**：test:suggest（实现前）零建议（零改动文件）；doc:suggest（台账回写前）planDoc 建议 0.8>0.5 采纳=本 plan §7 承载；output:judge 收口声明判定见 AUDIT-LOG 收口行；decision:session 会话锚随收尾重跑取数。

**并行协调**：BLOCK-125（reject→agent 回路）同日并行收口（b08bfeb4），文件面零重叠，双方提交互认隔离边界。

**G0 开发期常态 · 不外推 packaged/Provider/GA。**

## 8. 加映 v2（2026-09-27，用户实机三点反馈）

用户原话：「背景好像多了一层 地下应该是圆角的即可 要和项目摘要卡片一样的特点」「这个侧边聊天不应该从上到下占据 应该有右下角占一半的高度和 项目摘要卡片可以共存」「侧边聊天应该是带着项目背景的仅聊天 不应该能编辑和修改新增文件 所以下面的输入框功能要做限定」。

1. **去双层背景**：面板内 SimpleChat 自带 `.sc-root` 卡片底（26px 圆角+surface 底+阴影）未被中性化，与悬浮面自身面板形成双层——比照中栏 `.agentMain :global(.sc-root)` 同款中性化，只保留悬浮面自身圆角面板（与摘要卡同特点）。
2. **右下角半高 + 与摘要卡共存**：surface 从全高改为贴底 `height: 50%`（右上角摘要浮层 + 右下角聊天面板同屏各占一角）；中栏让位类保持不变（避免内容切割的原则不随高度改变）。
3. **悬挂面锁只读档**：`useModelAccessMenus` 增 `lockedAccessMode`（初始值锁定 + setAccessMode 失效守卫），SimpleChat 增同名 prop，悬挂面传 `'read'`（read 档=只读工具全放行、全部写入/执行类工具拒绝，后端 agent-tool-policy 权威门禁同口径）；访问档位选择器锁定禁用并提示「文件修改请回中栏」。HK-01 红绿先行：useModelAccessMenus 锁档 harness 契约 + SideChatDock 传参契约先红后绿。

### §8.1 加映 v2 实施记录（2026-09-27 当日收口）

红绿先行：两契约先红（useModelAccessMenus 锁档 harness——锁 read 后初始即 read 且 setAccessMode 失效；SideChatDock 传参——SimpleChat 收到 lockedAccessMode="read"+compact）→ 28/28 绿。前端全量 155 文件/1237 用例 0 红；tsc 0；eslint 0 error。实机三断言 allPass：半高贴底（top 467/bottom 942/h 475）、sc-root 中性化单层面板、只读模式锁定；与摘要卡同屏零重叠（间隙 116px）。证据=acceptance/ui-448/walkthrough-v2.json + 3 截图。

### §8.2 加映 v2 收口（2026-09-27）

实现提交 78f73b5f（UI 台账加映段同提交）；closeout 十一门绿（code-size +4 随批重打，归属本包锁档接线）；plan/registry 状态维持 completed。加映段与 v1 同一条 UI-448 台账；v1 已于 2026-09-27 晨 verified（并行会话联测），v2 为其后新增量 in_progress 待用户过目 v2 形态。G0 开发期常态 · 不外推 packaged/Provider/GA。

## 9. 加映 v3（2026-09-27，用户过目 v2 后三点反馈——「和预期还有些差距」）

用户原话：「主题风格应该和摘要面板保持一致」「侧边聊天只是单纯的聊天不加入主会话agent」「聊天输入框下面不需要那么多的内容了…适当的删减一下 你看看怎么调整 应该是个比较大的任务」。

1. **主题对齐摘要面板**：悬浮面底色 `--gewu-bg-surface` 与摘要卡 `--gewu-bg-elevated` 存在色差（用户截图可见两卡深浅不一）——surface 底色换 `--gewu-bg-elevated`，头部对齐摘要卡顶栏规格（min-height 52px / padding 10px 13px 9px / 分隔线 color-mix(text 6%)）。
2. **独立会话（不加入主会话 agent）**：悬挂面不再镜像中栏 activeConvId——改为**每项目独立的侧聊会话**（localStorage 按 projectId 持久化，空则首发自动建话，复用 useChatStream 既有建话路径），组件签名收缩为只收 projectId；中栏会话与悬挂面互不干扰（各自的 run/消息流）。解释口径：仍带项目背景（read 档只读工具可用），但不是主会话的一部分；主会话的编码 agent 内容不再镜像到悬挂面。reopen：若用户本意是「完全无工具纯 LLM 聊天」，撤 read 锁改直连对话端点（另裁）。
3. **composer 删减**：SimpleChat 增 `slimComposer` prop——隐藏导出/知识空间开关/上下文用量环/模型与供应商/思考档位五组控件，只留「只读模式」锁定徽标 + 发送键。

HK-01 红绿先行：SideChatDock 传参契约重构（独立会话初始 null/持久化回读 + slimComposer=true）先红后绿。

### §9.1 加映 v3 实施记录（2026-09-27 当日收口）

红绿先行：SideChatDock 契约重构 5 红（独立会话持久化回读/初始 null/slimComposer 传参/呼吸灯与空态随签名重构改约）→ 29/29 绿。波折两条如实登记：①空态死路自纠——独立会话为 null 时最初只渲染提示文本不挂 SimpleChat，首发建话无入口，改为始终挂载（null 会话由 SimpleChat 内部建话路径处理）；②新增「project 切换同步 localStorage」effect 触发 react-hooks/set-state-in-effect 增量红——改 CenterPanel 以 key={projectId} 重挂载根治，抑制基线未放宽。端到端探针：悬挂面发消息自动建独立会话+read 档只读回答+中栏零扰动（探针会话已回收）。验证=29/29+前端全量 155 文件/1238 用例 0 红+tsc 0+eslint 0 error。证据=acceptance/ui-448/walkthrough-v3.json。

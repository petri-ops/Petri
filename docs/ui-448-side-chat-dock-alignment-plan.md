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
status: completed
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
### §9.2 加映 v3 收口（2026-09-27）

实现提交 57985dcb（UI 台账加映段同提交）；closeout 十一门绿（code-size +2 随批重打归属本包）；端到端探针取证后已回收清场。v3 in_progress 待用户过目翻 verified。G0 开发期常态 · 不外推 packaged/Provider/GA。

## 10. 加映 v4（2026-09-27，用户过目 v3 后裁决「能否完全一致呢 文字大小 宽度 贴右侧边 其实就是个聊天窗口 但是可以选择模型 对不对」）

实测量差：摘要卡宽 292px/正文 12.13px；悬浮面宽 380px/聊天文字 17.64px。

1. **完全一致（与摘要卡）**：surface 宽 380→300px（同摘要声明宽 + 同款 max-width 夹紧）、贴右侧边（right:44→0，开态与摘要卡同一右缘）；聊天文字降为摘要正文档（sc-root 字号设 caption，级联消息正文）；开态隐藏把手（收起后把手回归；关闭=✕/Esc/外点）。
2. **纯聊天窗但模型可选**：slim 隐藏名单收缩——模型/供应商选择对恢复显示（窄面板自动图标化），知识开关继续隐藏；只读锁/独立会话/compact 不变。

HK-01 红绿先行：开态隐把手 + slim 传参契约重构先红后绿。宽度/贴缘/字级为 CSS 面，实机量测验收。

### §10.1 加映 v4 实施记录（2026-09-27 当日收口）

红绿先行：契约重构 3 红（开态隐把手×2/呼吸灯与 open 解耦）→ 20/20 绿。波折两条如实登记：①max-width 百分比参照系误用——`.dockRoot` 是零宽定位容器，`calc(100%-24px)` 把面板夹塌成边框 2px，改回视口单位并注释留痕（.dockRoot 定位契约的隐蔽陷阱入册）；②字档纠正——摘要卡正文实测是 `--gewu-font-size-sm`（12.13px@scale1.1025）而非 caption（13.23px），首设 caption 经量测推翻后改正，教训=字级对齐以 computed style 实测为准（skill §3 配方）。端到端：模型菜单在 300px 面板内可弹出可选（withinSurface 实证）；两条探针会话回收清场。验证=20/20+前端全量 155 文件/1238 用例 0 红+tsc 0+eslint 0 error。证据=acceptance/ui-448/walkthrough-v4.json。
### §10.2 加映 v4 收口（2026-09-27）

实现提交 a176ec77（UI 台账加映段同提交）；closeout 十一门绿。v4 in_progress 待用户过目翻 verified。G0 开发期常态 · 不外推 packaged/Provider/GA。

## 11. 加映 v5（2026-09-27，用户过目 v4 后两点反馈）

用户原话：「会话这里经过了渲染没有完全的贴窗口左侧导致文字换行过早了」「点击其它地方 会话窗口就折叠了 这不方便使用 应该常驻进行点击图标后折叠或展开 要想项目摘要一样的特性」。

1. **内容贴左、去早换行**：面板内 300px 被三层内缩吃掉 ~60px（sc-body 12px + sc-messages 左 18px 右 18px〔左让位 MessageRail 刻度、右对称〕+ rail 本体）——悬挂面隐藏 MessageRail（slimComposer 条件，小面板消息跳转无意义）+ sc-body/sc-messages 内边距收窄（dock scope 覆写 8px/6px）。
2. **常驻化（摘要卡同特性）**：移除外点收起与 Esc 收起（Esc 在输入时误触），折叠/展开仅经把手与头部 ✕；HK-01 契约反转先红（Esc 不收起/外点不收起/✕ 收起）。

### §11.1 加映 v5 实施记录（2026-09-27 当日收口）

红绿先行：契约反转先红（Esc 不收起+✕ 收起/外点不收起）→ 20/20 绿。实机：外点常驻实证+rail 隐藏+内边距收窄生效。顺带清偿=探针残留「新对话」会话回收（remaining=0）。验证=20/20+前端全量 155 文件/1238 用例 0 红+tsc 0+eslint 0 error。证据=acceptance/ui-448/walkthrough-v5.json。
### §11.2 加映 v5 收口（2026-09-27）

实现提交 0f3dadac（UI 台账加映段同提交）；closeout 十一门绿（code-size +1 随批重打归属本包）。v5 in_progress 待用户过目翻 verified。G0 开发期常态 · 不外推 packaged/Provider/GA。

## 12. 加映 v6（2026-09-27，用户过目 v5 后裁决）

用户原话：「侧边聊天的图标能不能像摘要图标概览按钮一样一直出现呢 卡片是在图标下方的」。

- **把手常驻化（摘要按钮同款）**：把手开/关两态恒显示（恢复 handleActive 激活态与 aria-expanded），位置锚定面板上方（bottom: calc(50% + 14px)）——卡片打开时挂在图标正下方，再点图标收起；✕ 仍可用。D1「再点把手收起」契约恢复。
- HK-01 红绿先行：开态把手恒显契约反转先红。

### §12.1 加映 v6 实施记录（2026-09-27 当日收口）

红绿先行：开态把手恒显契约反转先红→20/20 绿。实机：把手恒显于面板上方（gap 6px）、激活态/aria 正确、再点收起 D1 实证。验证=20/20+前端全量 155 文件/1238 用例 0 红+tsc 0+eslint 0 error。证据=acceptance/ui-448/walkthrough-v6.json。

## 13. 加映 v7（2026-09-27，用户过目 v6 后裁决「图标有些太大了 去掉外框 只要有个气泡就可以」附例图）

- **图标极简化**：把手去掉外框/底板/阴影（例图=裸气泡描边图标），尺寸收缩；运行指示不再用独立圆点——改由图标本体承担（运行时 accent/绿色呼吸），悬停提亮。HK-01：呼吸灯契约随形态重构先红。

### §13.1 加映 v7 实施记录（2026-09-27 当日收口）

红绿先行：呼吸灯契约随形态重构先红（圆点退役断言）→20/20 绿。实机：border 0/transparent 底/无阴影实测、28x28 极简气泡、开态布局不变。验证=20/20+前端全量 155 文件/1238 用例 0 红+tsc 0+eslint 0 error。证据=acceptance/ui-448/walkthrough-v7.json。
### §13.2 加映 v7 收口（2026-09-27）

实现提交 173847a9（v6 实现被中断后随 bb1075f9 已落，v7 图标极简化并入本提交）；closeout 十一门绿。v7 in_progress 待用户过目翻 verified。G0 开发期常态 · 不外推 packaged/Provider/GA。

## 14. 加映 v8（2026-09-27，用户过目 v7 后反馈「点击摘要 会话框向左退了一个距离 点击会话又推了一个距离 这重叠了 项目摘要卡和会话应该共享一个距离 不应该是叠加」）

**根因**：摘要卡（钉住列/悬浮两态）与会话面板分属两个定位参照系（sessionLayout vs centerCol），右缘各自为政——摘要钉住时 300px 列插在会话区右缘，与会话面板（锚定 centerCol 右缘）同域叠加；悬浮态右缘又差 14px 内缩，不共享距离。

**修法（共享右缘坐标系）**：
1. SideChatDock 增 `summaryPinnedWidth` 入参，dockRoot 注入 `--dock-right: calc(14px + 钉住列宽 + 8px 间隙)`——摘要钉住时面板整体让到列左侧，悬浮时 14px 与摘要卡同缘，任何状态两卡右缘协调不叠加；
2. 会话面板打开时摘要悬浮封顶（`workspaceSessionLayoutSideChatOpen .workspaceSummaryFloat { max-height: calc(50% - 24px) }`）——上摘要下会话各占一半永不重叠；
3. yield 让位随钉住扩容（`--side-chat-pinned` 变量加进 agentMainSideChatYield 的 min()），钉住+会话并存时正文仍不被压。

HK-01 红绿先行：钉住宽度注入契约（dockRoot 变量/yield 变量/封顶类）先红后绿。

### §14.1 加映 v8 实施记录（2026-09-27 当日收口）

红绿先行：钉住宽度注入/让位扩容/悬浮封顶三契约先红→22/22 绿。实机：悬浮态摘要右 1325=面板右 1325（horizontalGap 0）、垂直零重叠；sessionLayout 1098<1120 摘要悬浮为 UI-351 正确判定非回归。验证=22/22+前端全量 155 文件/1240 用例 0 红+tsc 0+eslint 0 error。证据=acceptance/ui-448/walkthrough-v8.json。
### §14.2 加映 v8 收口（2026-09-27）

实现提交 5536328d+lint 清偿（UI 台账加映段随提交）；closeout 十一门绿。波折=lint 抓测试三处多余断言与实现一处 `as React.CSSProperties`（接收方本就接受字面量类型），改 querySelector<HTMLElement> 泛型/删断言清偿。v8 in_progress 待用户过目翻 verified。G0 开发期常态 · 不外推 packaged/Provider/GA。

### §14.1 加映 v9 实施记录（2026-09-27 当日收口）

用户实测证伪 v8 的钉住联动偏移（面板被甩到中间偏左、与摘要卡之间大片空白，截图在案）。根因=以 computed 摘要状态（expanded+summaryOpenWidth）驱动面板偏移，computed 与实际渲染形态可脱节。回退=面板恒贴右缘 right:14px（悬浮/钉住通吃），删除 --dock-right/--side-chat-pinned/summaryPinnedWidth 整条耦合链；保留摘要悬浮封顶与布局常驻类。契约替换 21/21 绿；前端全量 155 文件/1239 用例 0 红；窄窗 1000px 实测右缘 delta=0、零重叠。教训=悬浮定位锚点要用「看得见的参照物」（实际渲染形态）而非间接 computed 状态。证据=acceptance/ui-448/walkthrough-v9.json。

### §14.1 加映 v9 实施记录（2026-09-27 当日收口）

用户实测证伪 v8 的钉住联动偏移（面板被甩到中间偏左、与摘要卡之间大片空白，截图在案）。根因=以 computed 摘要状态（expanded+summaryOpenWidth）驱动面板偏移，computed 与实际渲染形态可脱节。回退=面板恒贴右缘 right:14px（悬浮/钉住通吃），删除 --dock-right/--side-chat-pinned/summaryPinnedWidth 整条耦合链；保留摘要悬浮封顶与布局常驻类。契约替换 21/21 绿；前端全量 155 文件/1239 用例 0 红；窄窗 1000px 实测右缘 delta=0、零重叠。教训=悬浮定位锚点要用「看得见的参照物」（实际渲染形态）而非间接 computed 状态。证据=acceptance/ui-448/walkthrough-v9.json。
### §14.2 加映 v9 收口（2026-09-27）

实现提交 6e44656b（UI 台账加映段随提交）；closeout 十一门绿。v9 in_progress 待用户过目翻 verified（v6/v7 形态如一并确认可同批翻 verified）。G0 开发期常态 · 不外推 packaged/Provider/GA。

## 15. 加映 v10（2026-09-27，用户过目 v9 后裁决「推的太狠了…你应该全方位核查一下项目摘要卡片的实现方式 精准识别之后再调整会话卡片 很明显会话卡片和项目摘要卡片不是一个行为方式」）

**全方位核查结论（摘要卡定位链解剖）**：摘要悬浮的定位基准是 `.workspaceSessionLayout`（`position: relative`，右缘经 `.workspaceSessionFrameChat` 的 `padding: 0 14px 0 8px` 内缩），`right: 0` 贴齐布局右缘——与布局共生，随布局变化自动跟随。会话面板却锚在更外层 `main.centerCol`，靠手写 14px 模拟对齐——参照系不同源，这就是「行为方式不一样」的结构性根源（v8/v9 两轮补丁均在给这个错误参照系打补丁）。

**精准调整**：
1. SideChatDock 挂载点迁入 `workspaceSessionLayout`（chat 变体内、摘要宿主同层）——与摘要卡共用 `right: 0` 定位基准，结构性同源；surface right 14px→0。
2. 结果模式跟随摘要行为：chat 投影层隐藏时面板随之隐藏（此前在结果模式常驻，属行为对齐的一部分，plan 留痕）。
3. yield 让位 432→308px（面板 300 + 8 呼吸；把手已上移面板外不再占右缘）——解决「推的太狠」。

HK-01：布局挂载位置契约（dock 在 session layout 内）先红后绿。

### §15.1 加映 v10 实施记录（2026-09-27 当日收口）

红绿先行：挂载位置契约（dock 在 session layout 内）先红→22/22 绿。实机：rightEdgeDeltaVsSummary=0、dockInsideLayout=true、零重叠、让位收窄生效。行为对齐清单=同基准 right:0/同缘/同悬浮语言（16px 圆角+float 阴影 token）/结果模式随投影隐藏（与摘要一致）/常驻不误关/极简把手挂面板上方。教训=v8/v9 两轮补丁的本质是参照系选错——结构性问题应移动挂载点而不是补偿偏移。验证=22/22+前端全量 155 文件/1240 用例 0 红+tsc 0+eslint 0 error。证据=acceptance/ui-448/walkthrough-v10.json。
### §15.2 加映 v10 收口（2026-09-27）

实现提交 66024634（UI 台账加映段随提交）；closeout 十一门绿。v10 in_progress 待用户过目翻 verified（v6~v9 如一并确认可同批）。G0 开发期常态 · 不外推 packaged/Provider/GA。

## 16. 加映 v11（2026-09-27，用户「问题依旧」——直连用户窗口 CDP 诊断定位）

**诊断方法**：复用 dev-verify CdpClient 写只读探针 scripts/ui448-diagnose-user-window.mjs（纯 Runtime.evaluate 读值+截图，禁导航用户窗口红线内），直连 9222 用户主窗口实测。

**实测发现**：用户窗口 viewport **2481×1876**（DPI 缩放 0.937）——此前所有走查均在 1000~1680 窄视口测的是摘要「悬浮」形态；用户宽度下 sessionFrameWidth≥1120，摘要进入**钉住列**形态，行为面完全不同。宽窗钉住态实测：面板右缘与钉住列右缘同为 2127（v10 同基准正确），但 yield 308px 仍叠加在钉住列之上——列自身已把会话内容与面板隔开（列带 1815-2127，面板嵌 1827-2127，会话内容止于 1815），再让位即用户所感「推的太狠/问题依旧」。

**修法（最小精确）**：yield 让位只在摘要非钉住时应用——`summaryCardOpen && visibility==='expanded'` 时跳过（列带即隔离带）。钉住态 dock 嵌列带下半、上摘要卡下会话面板垂直堆叠（与「共享一个距离」一致）；悬浮/关闭态保持 308px 让位。

HK-01：钉住跳过让位/悬浮保持让位两契约先红后绿；双宽度实机（2481 钉住 × 1000 悬浮）零重叠。

### §16.1 加映 v11 实施记录（2026-09-27 当日收口）

红绿先行：钉住跳过让位/悬浮保持让位两契约→13/13 绿。双宽度实机（2481 钉住 / 1000 悬浮）零重叠。诊断工具 scripts/ui448-diagnose-user-window.mjs 入册（只读探针，红线内）。教训两条入册：①窗口宽度是行为面的第一变量——走查必须覆盖用户真实视口（此前只测窄窗悬浮形态）；②有 CDP 就直连用户窗口取证，猜测替代不了测量。验证=13/13+前端全量 155 文件/1242 用例 0 红+tsc 0+eslint 0 error。证据=acceptance/ui-448/walkthrough-v11.json。
### §16.2 加映 v11 收口（2026-09-27）

实现提交 a61d02bf（impact-map 分类旗与 EOL 归一随收口提交）；closeout 十一门绿。v11 in_progress 待用户过目翻 verified（v6~v10 可同批）。G0 开发期常态 · 不外推 packaged/Provider/GA。

## 17. 加映 v12（2026-09-27，用户两点裁决）

用户原话：「会话按钮对应的聊天窗口应该是独立的区域 它只是继承主会话区的聊天记录 但是它不编辑不操作也不主动影响主会话区域的上下文」「另外它应该在窗口宽度不足的情况下 和摘要卡片一样悬浮起来」。

1. **继承但不影响**：首次展开自动 `forkConversation(主会话)`（现成原语：复制消息=继承记录+独立演化）；侧聊往来不写回主会话、不 steer 主任务、不入主上下文；只读锁保留。
2. **响应式双形态**：宽窗（`summaryVisibility==='expanded'`，与摘要同切换点）→ 右轨独立列区（300px，与摘要钉住列垂直堆叠、共享右缘、把手常驻）；窄窗 → 悬浮（右下角浮面 + 把手）。yield 让位仅窄窗悬浮态应用。

红绿先行：fork 三契约 + docked 变体契约 → 28/28 绿；实机双形态 allPass。
### §17.1 加映 v12 收口（2026-09-27）

实现提交 e18853eb（UI 台账加映段随提交）；closeout 十一门绿。v12 in_progress 待用户过目翻 verified（v6~v11 可同批）。G0 开发期常态 · 不外推 packaged/Provider/GA。

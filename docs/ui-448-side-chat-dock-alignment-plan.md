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

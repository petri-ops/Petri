# item 26 创建入口重构方案（owner 语义已拍板 · done-means 含实现 · ✅ 已实现 2026-11-25）

> 来源：Orca bb8dddaf dispatch msg_028c645b6bd0 第三项（owner「行！整吧」+ 授权兴奋拍语义）。
> 核码（C-32/C-43 先核真源）：入口集中在 `LeftPanel.tsx`（QuickActions 新建任务、ProjectTreeHeader ➕ 与 🌐、行内 `SshCreateInlinePanel`）、`AppRail.tsx`/`AppRailContext.tsx`（新建会话真相）、`pages/home.tsx`（工作台创建区「创建新项目」）、`pages/welcome.tsx`（首启创建）。

## §1 四类入口现状与裁决映射

| 入口 | 现状真源 | 裁决语义 | 动作 |
|---|---|---|---|
| 「新建任务」 | `QuickActions.onClick=ctx.handleNavigateToHome`；AppRail 把它映射 `handleNewTask`→`createConversationForProject`（已新建会话），无 currentProject 时 `navigate('/')` | =新建会话（任务页），点即出，不跳项目流 | 保持新建会话真相；修 title 文案去「在工作台选择路径」旧描述；无 currentProject 也走新建会话兜底（不跳首页） |
| 项目创建唯一入口 | home 工作台区已标「创建新项目」+ 三方式（选目录/手输/SSH） | 工作台创建区唯一，明确标「新建项目」 | 文案统一「新建项目」；保留 home 为唯一显式创建面板 |
| 项目区 ➕ | `ProjectTreeHeader` 的 ➕ → `createPanel.onOpen`（旧内联面板） | 撤销（其 createPanel 被拖拽建项目依赖的部分迁移保留、代码去重） | 移除 ➕ 按钮；`createPanel.onOpen` 契约保留（`createPanel.open` 恒 false），拖拽 `onPickExternal` 链零改动 |
| 🌐 SSH 行内 | `SshCreateInlinePanel` 在 LeftPanel 本地态（`sshCreateOpen`），home 也有 `openSshPanel` | 不裸删：SSH 行内建项目能力并入统一创建面板（去重为一个组件） | 左栏 🌐 改为跳转 home 创建区并自动展开 SSH（复用 `?create=ssh` 现成机制），删除行内向导组件调用；能力不丢，组件去重 |

## §2 去重判据（可核对）

- 创建逻辑唯一真相：`AppRailContext.createProjectFromPath` / `sshCreateAt` / `createConversationForProject`（不动）。
- 显式创建面板唯一：`pages/home.tsx` 工作台创建区（保留三方式）。
- 左栏不再有第二套创建面板（`SshCreateInlinePanel` 不再在 LeftPanel 渲染），但 SSH 能力经 `?create=ssh` 并入 home 面板，零能力损失。
- 拖拽建项目：`LeftPanel.handlePanelDrop` → `ctx.createPanel.onPickExternal` 保持原样（红测守护）。

## §3 红测先行（HK-01）

`frontend/src/components/workspace-panels/LeftPanel.test.tsx` + `frontend/src/pages/home.test.tsx` 增量：
- 「新建任务」按钮点击在有/无项目下都走新建会话，不跳首页。
- 项目区不再渲染 ➕ 建项目按钮（`onOpen` 不再被该入口触发）。
- 左栏 🌐 点击跳转 home 且带 `?create=ssh`，不再渲染行内向导。
- 拖拽落盘仍走 `onPickExternal`（守护迁移保留）。
- home 创建区标题明确「新建项目」。

## §4 纪律

- 功能语义重构，非纯观感；观感零代签（新呈现不翻 verified，owner 过目）。
- 单工作包串行、HK-01 红绿先行、定向测试 + closeout 门禁、证据落本目录、六件套回写、本地提交 push 待口令。
- 19 项未跟踪 WIP 与 frogfish 零触碰。G0 开发期常态 · 不外推 packaged/Provider/GA。

## §5 实施结果（2026-11-25）

- QuickActions「新建任务」title 改「在当前项目新建会话（点即出）」；AppRail `handleNewTask` 无当前项目时取 `allProjects[0]` 直接建会话（冷启动零项目才回工作台——诚实边界）。
- 项目区 ➕ 删除；`ctx.createPanel.onOpen` 契约保留、拖拽 `onPickExternal` 链零改动（HK-01 守护）。
- 🌐 改跳 `/?create=ssh`（复用 home 现成 auto-open），`SshCreateInlinePanel.tsx`（417 行行内向导）删除，theme-token 契约条目同步移除——SSH 建项目能力由 home 统一面板等价保留，组件去重为 home 一处。
- home 工作台区标题「创建新项目」→「新建项目」。
- HK-01（`CreateEntryRefactor.test.tsx`）+ 既有 LeftPanel/home/theme-token 测试 45/45 PASS；types/lint 0 error。UI-327 旧行内向导测试 5 项随组件退役改跳转契约（终端式 Tab 补全属被撤销组件交互，非建项目能力）。
- code-size 基线仅更新本包 4 文件指纹/留因；WorkspaceFilePreview.tsx（他方 WIP）漂移如实归属、零触碰。

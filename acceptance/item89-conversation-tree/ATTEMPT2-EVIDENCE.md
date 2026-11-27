# item89 attempt2：会话列表真实点击路径证据

## §1 上笔为何 mock 绿真实红

上笔 `00e157f6e` 修的是命令面板路径（`useAppCommands.selectConversation` → sessionStorage preselect → navigate）与文件树重挂载；owner 复现路径是**左栏会话列表点击**，两条路径不同。

## §2 真实点击链核真

`LeftPanel.tsx` 的会话项（含搜索结果 / 联邦委托 / 项目树内非当前项目）点击时同 tick 调：
- `ctx.switchToProject(projectId)` → `navigate('/project/<id>')`
- `ctx.handleSwitchConversation(convId)` → `setActiveConvId(convId)`

随后 `AppRailContext` 的 `currentProjectId` effect `setActiveConvId(null)`，其种子 effect 又 `setActiveConvId(conversations[0].id)`；被点会话被冲掉，文件面板仍绑 conversations[0] 对应项目。

## §3 真修

- `conversationSelection.ts` 新增 `writeConversationPreselect` / `consumeConversationPreselect`（一次性交接）。
- `AppRailContext` 新增 `switchConversationInProject(conversationId, projectId)`：写 preselect + `setActiveConvId(null)` + `navigate('/project/<pid>/chat')`；种子 effect 用 `resolveActiveConversationId` 消费 preselect 并优先于 conversations[0]。
- `LeftPanel` 三处跨项目点击（项目树会话 / 搜索结果 / 联邦委托）改走新入口；同项目仍走原 `handleSwitchConversation`。

## §4 验证升级

- HK-01 6/6：`conversationSelection.test.ts` 3/3（含 preselect 一次性消费）、`AppRailContext.item89.test.ts` 2/2（seed 消费 + 三处接线）。
- **真实集成测试** `AppRailContext.item89.integration.test.tsx` 1/1：真实 `AppRailProvider` + 真实 `LeftPanel` 会话行 DOM 点击（不 mock 点击 handler），断言导航 `/project/p-b/chat`、文件面板根目录 `/ws-b`、`activeConvId=conv-b2`。外部数据（项目/会话列表）才用 mock。
- 邻域 36/36；11 静态门绿。

**CDP 说明**：开发实例（Vite 3000 / CDP 9222）当前由 crinoid 预览工作区供码，不在本工作区；为避免改动其它 Agent 的工作区，未对其做 CDP 注入，改用 owner 允许的等价真实集成测试。

## §5 待 owner 实机

在左栏会话列表里从 A 项目会话点 B 项目会话 → 文件面板根目录应为 B 项目，且选中被点会话。观感 in_progress 零代签。

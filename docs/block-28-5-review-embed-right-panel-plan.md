# BLOCK-28.5-REVIEW-EMBED-RIGHT-PANEL — 审阅并入右侧边栏 tab 体系 Plan

- **Plan ID**: `BLOCK-28.5-REVIEW-EMBED-RIGHT-PANEL`（用户反馈驱动，2026-08-30）
- **状态**: `completed`（2026-08-30 收口：tsc 0 / 定向 vitest 通过 / ui:audit:check / docs:check；CDP 实机 6/6，证据 `acceptance/ui-214/`）
- **truthDomain**: `block-28-review-embed-right-panel`
- **阶段**: 单 PHASE（UI-214）实施 + CDP 取证 + 收口
- **G0 纪律**: G0 开发期常态 · 不外推 packaged/Provider/GA.

## 1. 用户反馈（2026-08-30）

「审阅这个内容界面应该像其它选项一样嵌入在右侧边栏内部的……目前的像是一个另类」——
BLOCK-28.2 的 `wt-dock`（`position: fixed` 520px 浮层）悬浮在侧栏之上，与
结果/文件/后端/浏览器/聊天/分析的 RightPanel 多 tab 体系不一致。

## 2. 方案（单 PHASE，UI-214）

- `RightPanelMode` 增加 `'review'`；`RIGHT_PANEL_ITEMS` 增加审阅项（「+」菜单
  自动包含，删除 BLOCK-28.4 的 concat hack 与 `onSelectToolItem` 特殊分支）。
- `RightPanel` 新增 `tab === 'review'` 分支：复用 `ReviewMode variant="dock"`
  （横向文件条紧凑形态），退出按钮/Esc = `closeRightPanelTab('review')`。
- 双向同步：全局 `workingTreeOpen`（TitleBar 分支按钮 / agent task-done 圆点）
  翻开 → `openRightPanel('review')`；收起 → 关 tab；用户关 tab → 回写
  `setWorkingTreeOpen(false)`，TitleBar 按钮态保持一致。
- AppShell 浮层降级为兜底：仅 ProjectWorkspace 未挂载的路由（首页 / skills /
  results 页）渲染 `wt-dock`，保证 TitleBar 审阅按钮全局可用。
- 首页启动卡片「审阅」改走 `openRightPanel('review')`（原 `toggleWorkingTree`）。

**非范围**：0 新增 IPC / 0 新依赖 / AI 审阅 0 重新引入 / G1+ 不外推。

## 3. 门禁

tsc 0 / 定向 vitest（WorkingTreeReview 全绿；TitleBar 8 failed 为台账记录的
pre-existing 集合，数量一致）/ ui:audit:check / docs:check；
CDP 断言（面板嵌入 aside、`.wt-dock` count=0、tab 条审阅 pill、退出/Esc 关 tab、
tab 切换 keep-alive），截图落 `acceptance/ui-214/`。G0 开发期常态 · 不外推 packaged/Provider/GA.

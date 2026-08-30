# BLOCK-28.7-CHAT-CHANGES-CARD — 聊天区工作区改动卡片（点击跳审阅） Plan

- **Plan ID**: `BLOCK-28.7-CHAT-CHANGES-CARD`（用户反馈驱动，2026-08-30）
- **状态**: `completed`（2026-08-30 收口：tsc 0 / 定向 vitest 4/4 + copilot 全绿 / ui:audit:check / docs:check；CDP 实机 6/6，证据 `acceptance/ui-216/`）
- **truthDomain**: `block-28-chat-changes-card`
- **阶段**: 单 PHASE（UI-216）实施 + CDP 取证 + 收口
- **G0 纪律**: G0 开发期常态 · 不外推 packaged/Provider/GA.

## 1. 用户反馈（2026-08-30）

「聊天会话区域会有文件改变的详细信息吗？具体到每个文件的变化数量，点击具体的改变信息后可以跳转到审阅查看？」

## 2. 方案（单 PHASE，UI-216）

- 新增 `AgentChangesCard`（copilot/，挂 SimpleChat 输入区上方）：
  订阅 `biof3:agent-task-done` + 挂载时拉取 `git:working-tree-status` +
  `git:diff-for-review`，`computeFileDiffStats` 算每文件 +N −M；git 为唯一
  事实源（提交/还原后重查自动消失/更新）。非 desktop（bridge 缺失）整卡隐藏。
- 卡片结构：头行（折叠/展开 + 「N 个文件」+ 总 ± + 关闭 X）+ 明细行
  （状态字母徽标 A/M/D/? + 路径 + 每文件 ±）+「打开审阅查看全部改动」尾行。
- 点击跳转：新增事件 `biof3:review-open-file { filePath }`——
  ProjectWorkspace 监听 → `openRightPanel('review')`；
  useWorkingTreeReview 监听 → `setSelectedFilePath(filePath)` + refresh。
  「查看全部」派发空 filePath（仅开 tab，不选中）。

**非范围**：0 新增 IPC（复用 git:working-tree-* 全家桶）/ 0 新依赖 /
AI 审阅 0 重新引入 / G1+ 不外推。

## 3. 门禁

tsc 0 / 定向 vitest（AgentChangesCard 4 用例：±明细渲染 / 干净树隐藏 /
点击行派发事件 / agentTaskDone 触发刷新显现）/ ui:audit:check / docs:check；
CDP 实机 6/6（卡片渲染与统计、点行开审阅 tab 且选中该文件并渲染 diff、
折叠展开、查看全部、X 关闭），截图落 `acceptance/ui-216/`。
注：纯浏览器无 preload bridge → 整卡按设计隐藏（Electron 实机走 IPC 生效）。
G0 开发期常态 · 不外推 packaged/Provider/GA.

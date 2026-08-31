# BLOCK-29.7-REVIEW-CHANGES-TREE — 审阅文件导航树化（dock 目录分组树 + 历史版本树） Plan

- **Plan ID**: `BLOCK-29.7-REVIEW-CHANGES-TREE`（用户 2026-08-31：「审阅 增加右侧文件树 体验会比较好…用户会很清楚每个版本每个文件的修改对应的是整个项目结构的变化 规划一下 实现」）
- **状态**: `active`（P0 登记）
- **truthDomain**: `block-29-review-changes-tree`（审阅文件导航树子域；BLOCK-29 系列延续）
- **阶段**: P0 登记 → P1 实现（UI-244）→ P2 实机 + 收口
- **G0 纪律**: G0 开发期常态 · 不外推 packaged/Provider/GA.

## 1. 现状与诊断

- /review 主区已有目录分组可折叠左树（BLOCK-28 P2：`fileGroups` + `collapsedDirs` + `rvw-group-header`）。
- **dock（520px）改动区是平铺手风琴**：目录只以 `rvw-acc-dir` 文字缀在文件名后，文件多目录散时无结构感。
- **历史提交展开详情是横向 `rvw-filestrip` chips**：多文件铺成一片，「这个版本的改动落在项目结构哪里」不可见。

## 2. 方案（P1，UI-244）

1. **dock 改动手风琴 → 目录分组树**：`groupFilesByDirectory(review.status.files)` 分组渲染——组头复用 `rvw-group-header` 交互（折叠态复用组件既有 `collapsedDirs` + `toggleDir`，与 /review 主区共享同一状态语义），文件行缩进 + 缩进参考线，行内三操作（编辑/历史/放弃）与统计保留，删除冗余 `rvw-acc-dir` 目录后缀。
2. **历史提交详情 filestrip → 左 mini 树 + 右 diff**：`CommitDetail` 内部布局改 grid——左 168px 目录分组树（`groupFilesByDirectory(diff.files)`，组件局部 `collapsed` state，组头/文件行复用分组样式，chip 的选中语义改为树行选中），右侧 diff 占余宽。
- 共享渲染语义：两处与 /review 主区左树同构（组头 caret + 名称 + 计数）。
- 0 新增 IPC / 0 新依赖 / 审阅内核（diff/hunk/提交/历史数据流）不动。

## 3. 门禁与实机

tsc 0 / ReviewMode 定向 vitest / docs:check / ui:audit:check；实机（dev Electron CDP，intent-to-add fixture）：dock 分组树折叠/展开/行内操作、历史提交树选中切 diff、多目录结构可见性；截图 `acceptance/ui-244/`；台账同提交同步。

G0 开发期常态 · 不外推 packaged/Provider/GA.

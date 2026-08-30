# BLOCK-29.1-ACCORDION-FILE-LIST — 审阅 dock 手风琴文件列表（一级文件行 + 点击展开 diff） Plan

- **Plan ID**: `BLOCK-29.1-ACCORDION-FILE-LIST`（用户反馈驱动，2026-08-30）
- **状态**: `completed`（2026-08-30 收口：tsc 0 / 定向 vitest 21/21 / ui:audit:check / docs:check；CDP 实机 6/6，证据 `acceptance/ui-220/`）
- **truthDomain**: `block-29-accordion-file-list`
- **阶段**: 单 PHASE（UI-220）实施 + CDP 取证 + 收口
- **G0 纪律**: G0 开发期常态 · 不外推 packaged/Provider/GA.

## 1. 用户反馈（2026-08-30）

「审阅界面中改动的文件名字在最上层，我希望是改动的文件名是一级，点击之后向下展开，
这样可以一次性看到有哪些文件发生改动，点击展开后看到详细的改动信息」（参考
Cursor 例图：文件行 = 图标 + 文件名 + 目录 + ±统计 + 展开箭头）。

## 2. 方案（单 PHASE，UI-220）

- ReviewMode **dock 变体**弃用「横向文件条 + 底部单文件 diff 区」，改为
  **纵向手风琴列表**（`.rvw-accordion`）：一行一文件（caret + WorkspaceFileIcon
  类型图标 + 文件名 + 目录路径灰字 + +N −M / 已审 ✓），点击行向下展开该文件
  行内 diff（含 accept/reject 控件，多行可同开）；未跟踪文件展示占位说明。
- 当前选中文件默认展开；聊天卡片跳转（selectedFilePath 变化）自动展开对应行。
- **mode 变体**（/review 全页）保持「侧栏 + 大 diff 区」布局不变。
- 历史/提交 diff 分区不受影响。

**非范围**：0 新增 IPC / 0 新依赖 / AI 审阅 0 重新引入 / G1+ 不外推。

## 3. 门禁

tsc 0 / 定向 vitest 21/21（新增 dock 手风琴用例：默认展开选中文件 / 点击收起
/ 再点展开）/ ui:audit:check / docs:check；CDP 实机 6/6（无 filechip/diff-area
残留、两行文件行、默认展开、行内绿色新增行、未跟踪占位、收起、接受后提交条），
截图落 `acceptance/ui-220/`。G0 开发期常态 · 不外推 packaged/Provider/GA.

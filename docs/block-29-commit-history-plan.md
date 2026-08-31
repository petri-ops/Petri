# BLOCK-29-COMMIT-HISTORY — 审阅面板「提交历史」分区（第一期 git 工具） Plan

- **Plan ID**: `BLOCK-29-COMMIT-HISTORY`（用户反馈驱动，2026-08-30）
- **状态**: `completed`（2026-08-30 收口：tsc 0 / 定向 vitest 20/20 / ui:audit:check / docs:check；CDP 实机 6/6，证据 `acceptance/ui-219/`）
- **truthDomain**: `block-29-commit-history`
- **阶段**: 单 PHASE（UI-219）实施 + CDP 取证 + 收口
- **G0 纪律**: G0 开发期常态 · 不外推 packaged/Provider/GA.

## 1. 用户反馈（2026-08-30）

「审阅中，关于版本控制 git 工具这些的使用是不是要加入？类似于 VS Code 中？」
经盘点（git-adapter 已有任意提交间 diff/showFile，缺 log/checkout/unstage），用户
裁决第一期只做**提交历史**；分支切换/暂存区/push-pull 明确排除。

## 2. 方案（单 PHASE，UI-219）

- **adapter**（core/shared-backend/git-adapter.js）：新增 `log({limit, ref, file})`
  ——NUL 分隔 `%H%x00%h%x00%an%x00%aI%x00%s` 解析，limit ≤200，ref 拒绝 `-` 开头。
- **IPC**（src/ipc/working-tree-review.js）3 条只读通道：
  `git:commit-log`（列表）/ `git:commit-diff`（单提交 vs 第一父提交，根提交回退
  空树比较，复用 parseDiffFiles）/ `git:commit-file-content`（父提交与本提交两版
  全文，缺失侧返回空串）。sha 走 hex 白名单校验。
- **preload**：`workingTreeReview.commitLog / commitDiff / commitFileContent`。
- **前端**：
  - useWorkingTreeReview：`historyView('changes'|'history')`、`commits`、
    `selectedCommit`、`commitDiff`、`loadHistory / openCommit / backToCommitList`。
  - CodeMirrorDiffView：新增 `revisionOverride` prop（跳过 HEAD/WORKTREE 桥加载，
    供提交 diff 只读复用；无 accept/reject 控件）。
  - ReviewMode：summary 条「改动 | 历史」分段切换；历史列表（shortSha + subject +
    author · 时间）；点提交 → 文件条 + 只读 diff（CommitDiffFileView 组装两版全文）。
    历史分区下 A/R/↑↓ 键盘流禁用（只读）。

**非范围**：分支切换 / unstage / push-pull / stash-tag-blame（见盘点结论分期）；
0 新增依赖 / AI 审阅 0 重新引入。

## 3. 门禁

tsc 0 / 定向 vitest 20/20（新增历史用例：列表渲染 + 点提交加载 diff 与两版全文）/
ui:audit:check / docs:check；adapter.log 经测试项目真实仓库验证；
CDP 实机 6/6（分区切换、历史列表、点开提交 diff 绿色新增行、返回、切回改动），
截图落 `acceptance/ui-219/`。G0 开发期常态 · 不外推 packaged/Provider/GA.

## 增量记录

- **UI-230 / UI-231（2026-08-30，用户反馈驱动）**：UI-230 完整提交说明默认直接展开（去 details 折叠，见 BLOCK-29.3 plan 增量记录）；UI-231 历史列表点击提交改为**行内向下展开详情**（自包含 `ExpandedCommitDetail`，列表不跳转、可同开多条、返回按钮移除；hook 移除 openCommit/selectedCommit 跳转式状态），见 ui-productization-audit.md UI-231 条。G0 开发期常态 · 不外推 packaged/Provider/GA.

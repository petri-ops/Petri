# BLOCK-29.2-GIT-TOOLS-PHASE2 — git 工具二期（放弃更改/文件历史/撤销提交/分页） Plan

- **Plan ID**: `BLOCK-29.2-GIT-TOOLS-PHASE2`（用户反馈驱动，2026-08-30）
- **状态**: `completed`（2026-08-30 收口：tsc 0 / 定向 vitest 22/22 + copilot 全绿 / ui:audit:check / docs:check；adapter 真实仓库 4 项快测通过；CDP 实机核心断言通过，证据 `acceptance/ui-221/`）
- **truthDomain**: `block-29-git-tools-phase2`
- **阶段**: 单 PHASE（UI-221）实施 + 真实仓库快测 + CDP 取证 + 收口
- **G0 纪律**: G0 开发期常态 · 不外推 packaged/Provider/GA.

## 1. 用户反馈（2026-08-30）

「工作进度已经变了（BLOCK-30 单后端收敛本地落地）。确认之后，重点优化 git 工具
在审阅中的不全，看看 VS Code 有哪些功能有必要再更新。」——经 VS Code SCM 功能
对照盘点，用户多选裁决二期做 4 项：单文件放弃更改 / 文件级历史 / 撤销上次提交 /
历史分页加载。暂存区/分支切换/push-pull 维持排除。

## 2. 方案（单 PHASE，UI-221）

- **adapter**：新增 `discardFile({path})`（tracked → checkout HEAD 还原；
  untracked → 删除文件，路径限制 workTree 内、用 `pathModule` 避免模块内遮蔽）、
  `undoLastCommit()`（mixed reset HEAD~1，根提交显式拒绝）、`log` 增加 `skip`
  分页参数（--skip=N）。
- **IPC**：`git:discard-file` / `git:undo-last-commit` 两条通道（前端确认后调用）；
  preload 暴露 `discardFile / undoLastCommit`。
- **前端**：
  - dock 手风琴行 hover 操作（span 嵌于按钮行内）：`clock` 查看该文件历史
    （loadHistory({file}) 切历史分区）、`trash` 放弃更改（window.confirm 确认，
    untracked 提示将被删除）。
  - 历史分区头部：文件过滤徽标（可清除）+「撤销上次提交」按钮（confirm 后
    mixed reset，内容回工作区重新审阅，自动刷新 status 与历史）。
  - 历史列表尾「加载更多」（skip 分页 append，每页 50，返回不满 50 条即末页）。
- 期间修复：git-adapter 内 `path` 模块名被函数局部变量遮蔽的历史陷阱
  （顶部既有 `pathModule` 别名，本包沿用）。

**非范围**：暂存区 / 分支切换 / push-pull / stash-tag-blame（维持排除）；
0 新增依赖 / AI 审阅 0 重新引入。

## 3. 门禁

tsc 0 / 定向 vitest 22/22 + copilot 200/200（新增用例：行内放弃→discardFile、
行内历史→file 过滤、清除过滤→file:null、撤销→undoLastCommit，均含 confirm）/
ui:audit:check / docs:check；**adapter 真实仓库快测 4 项**（log skip 分页页序、
discard tracked 还原、discard untracked 删除、undo mixed reset 后恢复提交）全过；
CDP 实机核心断言通过（discard/undo 调用计数、文件过滤徽标、撤销入口、分页
append 机制 50→51 验证），截图落 `acceptance/ui-221/`。
G0 开发期常态 · 不外推 packaged/Provider/GA.

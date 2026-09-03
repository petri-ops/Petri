# BLOCK-50 — 审阅「file not found」修复：已删除/已消失文件的结构化兜底

## 1. 背景（用户报障 2026-09-03）

审阅（ReviewMode dock / 悬停预览 / 会话改动卡片）中点开或悬停部分文件时报 `file not found: docs/archive/.git-quick-ref.md`，且「经常存在」。根因：审阅列表把**已删除（D）文件**作为合法变更条目展示，但取内容端点 `git:working-tree-file-content` 的 WORKTREE 分支在磁盘上找不到文件时直接抛 `GitAdapterError('file_missing')`；前端 [CodeMirrorDiffView.tsx](../frontend/src/components/desktop/WorkingTreeReview/CodeMirrorDiffView.tsx) 对 `!ok` 一律 setError，于是报错。

受影响链路（同一端点三处消费方）：

1. 审阅详情 diff（CodeMirrorDiffView，HEAD+WORKTREE 双请求）。
2. 悬停预览体（ReviewMode 内嵌 CodeMirrorDiffView，UI-250）。
3. 未跟踪文件只读预览（ReviewMode `UntrackedFilePreview`，BLOCK-29.5）。

## 2. 方案

**后端**（[src/ipc/working-tree-review.js](../src/ipc/working-tree-review.js) `git:working-tree-file-content` WORKTREE 分支）：磁盘缺失时不再 throw，按 HEAD 可得性结构化兜底：

- HEAD 存在该文件 → `{ content: '', encoding: 'utf-8', size: 0, deleted: true }`（modified 侧为空 = 删除语义，diff 自然呈现全文删除）。
- HEAD 也没有 → `{ content: '', encoding: 'utf-8', size: 0, missing: true }`（历史上变动过、现已彻底消失的文件，如归档移动/会话历史残留）。

**前端**：

- `CodeMirrorDiffView`：`deleted` → 正常渲染删除 diff，顶部轻提示「工作区已删除」；`missing` → 占位「文件已不在工作区与 HEAD 中」，不再走 error。
- `UntrackedFilePreview`：`deleted`/`missing` → 占位文案，不置 failed。
- [electron.d.ts](../frontend/src/lib/electron.d.ts) `fileContent` 返回类型补 `deleted?/missing?`。

## 3. 非范围

- 不改 diff/文件列表逻辑；不动 `git:commit-file-content`（已有 try/catch 兜底）。
- 不做「恢复已删除文件」操作（revert 已有 `git:working-tree-revert`）。
- G1+ 不外推。

## 4. 阶段

- **P0 立项**：本计划 + DOC-REGISTRY + README + roadmap + AUDIT-LOG。
- **P1 实现**：后端结构化兜底 + 前端三消费方适配 + 类型。
- **P2 定向门禁**：后端 node --test（working-tree-review 相关）+ 前端 vitest（CodeMirrorDiffView / ReviewMode）+ tsc + docs:check + ui:audit:check。
- **P3 dev Electron 实机**：复现原报障场景（app 仓库含已删除文件或构造临时删除），验证删除文件显示删除 diff / missing 显示占位、无「file not found」报错；证据 `acceptance/block-50/`。
- **P4 收口**：registry completed、roadmap active 清空、AUDIT-LOG 收口行、提交。

## 5. 验收门

- P2 定向测试全绿 + 治理门禁 PASS。
- P3 实机证据落盘 `acceptance/block-50/`。
- 收口笔录用语：「G0 开发期常态 · 不外推 packaged/Provider/GA」一句。

## 6. 进度记录

- 2026-09-03 P0 立项：用户报障审阅「file not found: docs/archive/.git-quick-ref.md」反复出现；定位为已删除/已消失文件在 WORKTREE 内容端点抛错，裁决修复。
- 2026-09-03 P1 实现：后端 `git:working-tree-file-content` WORKTREE 分支结构化兜底（HEAD 有→`deleted:true`；HEAD 无→`missing:true`，`showFile` 返回 null 判定而非 try/catch）；前端 CodeMirrorDiffView 新增 `worktreeDeleted`/`worktreeMissing` 状态（删除提示条 `.wt-diff-deleted-note` / 占位 `.wt-diff-missing`）、ReviewMode `UntrackedFilePreview` 占位化、electron.d.ts 类型补齐。
- 2026-09-03 P2 定向门禁：后端 node --test 4/4（新增 `test/working-tree-review-file-content.test.mjs`：删除/消失/正常/HEAD 回归）；WorkingTreeReview vitest 43/43（CodeMirrorDiffView 新增 deleted/missing 2 用例）；tsc 0。
- 2026-09-03 P3 dev Electron 实机（证据 `acceptance/block-50/`）：复现用户原场景 ThinkSpace `docs/archive/.git-quick-ref.md`——展开行无 `[role=alert]`、删除提示条+删除 diff 渲染（截图 b50-deleted-row-expanded.png）；悬停未展开删除行 `ARCHITECTURE.md`——预览浮窗 `+0−237` 删除 diff 无报错（截图 b50-hover-preview.png）；verdict 全 true 落盘 b50-live-check.json。验收注：悬停目标行须先 scrollIntoView，视口外坐标 CDP 鼠标事件不触发。
- 2026-09-03 P4 收口：UI-250 台账修复记录转 verified、DOC-REGISTRY completed、roadmap active 清空、AUDIT-LOG 收口行。G0 开发期常态 · 不外推 packaged/Provider/GA。
